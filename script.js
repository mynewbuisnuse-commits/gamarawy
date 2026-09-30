/* ============================================================
   gamarawy — جمراوي | سباق الشوارع  (rewritten)
   Vanilla JS + Canvas + Firebase compat. No engine, no framework.

   Layout:
     1. Config      2. Utils      3. Store
     4. Audio       5. Input      6. Net (firebase + bots)
     7. Particles   8. CarArt     9. Traffic   10. Coins
     11. Player     12. Remotes   13. World (street renderer)
     14. Game       15. UI + boot
   ============================================================ */
'use strict';

/* ---------------- 1. Config ---------------- */
const firebaseConfig = {
  apiKey: 'AIzaSyCBYV6y0JuHLc2ThHrV2fdZ-Ofgd5CkigI',
  authDomain: 'mn-13d2a.firebaseapp.com',
  databaseURL: 'https://mn-13d2a-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'mn-13d2a',
  storageBucket: 'mn-13d2a.firebasestorage.app',
  messagingSenderId: '725756592101',
  appId: '1:725756592101:web:244e059383eee987a3f90c',
  measurementId: 'G-C8TQRFMPJ9'
};

const CFG = {
  lanes: 4,
  canvasW: 480,
  canvasHMin: 700,
  canvasHMax: 900,
  playerY: 170,          // distance from bottom
  baseSpeed: 255,        // px/s world scroll at t=0
  maxExtraSpeed: 265,    // added over ~75s
  rampTime: 75,
  scorePerPx: 0.045,     // score trickle per px scrolled
  distPerPx: 0.055,
  coinScore: 50,
  nearScore: 100,
  overScore: 25,
  laneCooldown: 0.14,    // s between lane changes
  invulnTime: 1.2,
  netThrottle: 120,      // ms
  remoteTimeout: 6000,
  maxParticles: 220,
};

const CAR_COLORS = ['#2e7ab8', '#c94f43', '#2f8f83', '#e9b44c', '#7a8450', '#8d4a7a'];

const TRAFFIC_KINDS = [
  { type: 'hatch',   color: '#c94f43', w: 50, h: 84, vMin: 130, vMax: 200 },
  { type: 'sedan',   color: '#7a8450', w: 52, h: 92, vMin: 120, vMax: 190 },
  { type: 'taxi',    color: '#e9b44c', w: 52, h: 92, vMin: 150, vMax: 220 },
  { type: 'compact', color: '#8d99ae', w: 48, h: 80, vMin: 140, vMax: 210 },
  { type: 'pickup',  color: '#9c4e24', w: 54, h: 98, vMin: 110, vMax: 170 },
  { type: 'van',     color: '#efe0bd', w: 56, h: 102, vMin: 100, vMax: 160 },
];

const SHOPS = ['فول عم فوزي', 'كشري التحرير', 'قهوة عبدو', 'فرن بلدي', 'عصير قصب', 'مكتبة النجاح', 'حلاق النجوم', 'بقالة الأمانة'];
const BOT_NAMES = ['عمر', 'محمد', 'يوسف'];
const BOT_COLORS = ['#c94f43', '#2f8f83', '#e9b44c'];

/* ---------------- 2. Utils ---------------- */
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
/** frame-rate independent damping factor */
const damp = (rate, dt) => 1 - Math.exp(-rate * dt);
const rand = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => (Math.random() * (b - a + 1) | 0) + a;
const pick = (arr) => arr[(Math.random() * arr.length) | 0];

/** fast deterministic 0..1 hash from int — no Math.sin, stable across frames */
function hash01(n) {
  n |= 0; n = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  n ^= n >>> 13; n = Math.imul(n, 0xc2b2ae35); n ^= n >>> 16;
  return (n >>> 0) / 4294967296;
}
const AR_D = '٠١٢٣٤٥٦٧٨٩';
const ar = (n) => String(n == null ? '' : n).replace(/[0-9]/g, (d) => AR_D[+d]);
const escapeHtml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

function weekId(d = new Date()) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - day + 3);
  const first = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const w = 1 + Math.round(((t - first) / 864e5 - 3 + ((first.getUTCDay() + 6) % 7)) / 7);
  return t.getUTCFullYear() + '-W' + String(w).padStart(2, '0');
}

/* ---------------- 3. Store ---------------- */
const Store = {
  get(k, fb = '') { try { const v = localStorage.getItem(k); return v == null ? fb : v; } catch { return fb; } },
  set(k, v) { try { localStorage.setItem(k, String(v)); } catch {} },
  getNum(k, fb = 0) { const n = +Store.get(k, fb); return Number.isFinite(n) ? n : fb; },
  getBoard() { try { return JSON.parse(Store.get('gamarawy_local_board', '[]')) || []; } catch { return []; } },
  pushLocal(entry) {
    const arr = Store.getBoard(); arr.push(entry);
    arr.sort((a, b) => b.score - a.score);
    Store.set('gamarawy_local_board', JSON.stringify(arr.slice(0, 20)));
  },
};

/* ---------------- 4. Audio ---------------- */
class AudioManager {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = Store.get('gamarawy_mute', '0') === '1';
    this.eng = null;
  }
  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {}); return true; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(this.ctx.destination);
      return true;
    } catch { return false; }
  }
  setMuted(m) {
    this.muted = !!m;
    Store.set('gamarawy_mute', this.muted ? '1' : '0');
    if (this.muted) this.stopEngine();
  }
  _tone(freq, dur, { type = 'sine', vol = 0.1, slideTo = 0, delay = 0 } = {}) {
    if (this.muted || !this.ensure()) return;
    const t0 = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(30, freq), t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(this.master);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }
  _noise(dur, { vol = 0.12, cutoff = 800, delay = 0 } = {}) {
    if (this.muted || !this.ensure()) return;
    const t0 = this.ctx.currentTime + delay;
    const len = Math.max(1, (this.ctx.sampleRate * dur) | 0);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff;
    const g = this.ctx.createGain(); g.gain.value = vol;
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t0);
  }
  click() { this._tone(520, 0.07, { type: 'triangle', vol: 0.08 }); }
  lane() { this._noise(0.1, { vol: 0.06, cutoff: 1400 }); this._tone(300, 0.09, { vol: 0.045, slideTo: 420 }); }
  coin() { this._tone(880, 0.08, { type: 'square', vol: 0.045 }); this._tone(1318, 0.1, { type: 'square', vol: 0.045, delay: 0.07 }); }
  near() { this._tone(480, 0.2, { type: 'sawtooth', vol: 0.055, slideTo: 1150 }); }
  crash() { this._noise(0.38, { vol: 0.2, cutoff: 520 }); this._tone(130, 0.38, { vol: 0.16, slideTo: 55 }); }
  startJingle() { [262, 330, 392, 523].forEach((f, i) => this._tone(f, 0.13, { type: 'triangle', vol: 0.085, delay: i * 0.095 })); }
  fanfare() { [523, 659, 784].forEach((f, i) => this._tone(f, 0.16, { type: 'triangle', vol: 0.09, delay: i * 0.12 })); }
  startEngine() {
    if (this.muted || this.eng || !this.ensure()) return;
    const o = this.ctx.createOscillator(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    o.type = 'sawtooth'; o.frequency.value = 55;
    f.type = 'lowpass'; f.frequency.value = 280;
    g.gain.value = 0.026;
    o.connect(f); f.connect(g); g.connect(this.master);
    o.start();
    this.eng = { o, g };
  }
  engineSpeed(pxPerSec) {
    if (!this.eng || this.muted) return;
    this.eng.o.frequency.setTargetAtTime(50 + pxPerSec * 0.085, this.ctx.currentTime, 0.09);
  }
  stopEngine() {
    if (!this.eng) return;
    const { o } = this.eng; this.eng = null;
    try { o.stop(this.ctx ? this.ctx.currentTime + 0.05 : 0); } catch {}
  }
}

/* ---------------- 5. Input ---------------- */
class InputManager {
  constructor(game) {
    this.game = game;
    this._cool = 0;
    window.addEventListener('keydown', (e) => this._onKey(e));
    this._bindTouch();
    this._bindButtons();
  }
  _isTyping() {
    const a = document.activeElement;
    return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA');
  }
  _onKey(e) {
    if (this._isTyping()) return; // don't hijack nickname field
    const k = e.key;
    let dir = 0;
    if (k === 'ArrowLeft' || k === 'a' || k === 'A' || k === 'ش') dir = -1;
    else if (k === 'ArrowRight' || k === 'd' || k === 'D' || k === 'ي') dir = 1;
    else return;
    e.preventDefault();
    // key-repeat guard: OS repeat is fine, game has its own cooldown
    this.game.requestMove(dir);
  }
  _bindTouch() {
    const cv = $('game');
    let sx = 0, active = false;
    cv.addEventListener('touchstart', (e) => {
      const t = e.changedTouches[0]; sx = t.clientX; active = true;
    }, { passive: true });
    cv.addEventListener('touchmove', (e) => {
      if (!active) return;
      const t = e.changedTouches[0], dx = t.clientX - sx;
      if (Math.abs(dx) > 34) { this.game.requestMove(dx > 0 ? 1 : -1); sx = t.clientX; }
    }, { passive: true });
    cv.addEventListener('touchend', () => { active = false; }, { passive: true });
  }
  _bindButtons() {
    const bind = (id, dir) => {
      const el = $(id);
      if (!el) return;
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); this.game.requestMove(dir); });
    };
    bind('btnLeft', -1); bind('btnRight', 1);
  }
}

/* ---------------- 6. Net ---------------- */
class NetManager {
  constructor() {
    this.ok = false;
    this.uid = 'local-' + Math.random().toString(36).slice(2, 10);
    this.name = 'سواق'; this.car = CAR_COLORS[0];
    this.remotes = new Map();
    this.online = 1;
    this.lastPush = 0;
    this._botTimer = 0;
    this._bots = [];
    this.onRace = null; this.onPresence = null; this.onConn = null;
  }
  init({ onRace, onPresence, onConn }) {
    this.onRace = onRace; this.onPresence = onPresence; this.onConn = onConn;
    let started = false;
    const goOffline = () => { if (!started) { started = true; this._startBots(); this.onConn && this.onConn(false); } };
    try {
      if (typeof firebase === 'undefined') throw new Error('firebase sdk missing');
      firebase.initializeApp(firebaseConfig);
      this.db = firebase.database();
      firebase.auth().signInAnonymously().then((cred) => {
        if (started) return; started = true;
        this.uid = cred.user.uid;
        this.ok = true;
        this._stopBots();
        this._bindPresence(); this._bindRace();
        this.onConn && this.onConn(true);
      }).catch(goOffline);
      setTimeout(() => { if (!this.ok && !started) goOffline(); }, 6000);
    } catch { goOffline(); }
  }
  _ref(p) { return this.db.ref(p); }
  _bindPresence() {
    const me = this._ref('gamarawy/presence/' + this.uid);
    me.onDisconnect().remove().catch(() => {});
    const hello = { name: this.name, car: this.car, ts: firebase.database.ServerValue.TIMESTAMP };
    this.db.ref('.info/connected').on('value', (s) => { if (s.val() === true) me.set(hello); });
    me.set(hello).catch(() => {});
    this._ref('gamarawy/presence').on('value', (s) => {
      const v = s.val() || {};
      this.online = Math.max(1, Object.keys(v).length);
      this.onPresence && this.onPresence(this.online);
    });
  }
  _bindRace() {
    const ref = this._ref('gamarawy/race');
    this._myRef = ref.child(this.uid);
    this._myRef.onDisconnect().remove().catch(() => {});
    const upsert = (snap) => {
      if (snap.key === this.uid) return;
      const p = snap.val(); if (!p) return;
      if (Date.now() - (p.lastUpdate || 0) > CFG.remoteTimeout) return;
      this.remotes.set(snap.key, p);
      this._emit();
    };
    const remove = (snap) => { this.remotes.delete(snap.key); this._emit(); };
    ref.on('child_added', upsert);
    ref.on('child_changed', upsert);
    ref.on('child_removed', remove);
    // periodic stale sweep
    setInterval(() => {
      const now = Date.now(); let changed = false;
      this.remotes.forEach((p, k) => { if (now - (p.lastUpdate || 0) > CFG.remoteTimeout) { this.remotes.delete(k); changed = true; } });
      if (changed) this._emit();
    }, 3000);
  }
  _emit() { this.onRace && this.onRace(this.remotes); }
  setIdentity(name, car) {
    this.name = String(name || 'سواق').slice(0, 14);
    this.car = car;
    if (!this.ok) return;
    try { this._ref('gamarawy/presence/' + this.uid).update({ name: this.name, car }); } catch {}
  }
  pushRace({ score, dist, lane, fx, alive }) {
    if (!this.ok || !this._myRef) return;
    const now = Date.now();
    if (now - this.lastPush < CFG.netThrottle) return;
    this.lastPush = now;
    this._myRef.set({
      n: this.name, c: this.car,
      s: clamp(Math.floor(score), 0, 999999),
      d: clamp(Math.floor(dist), 0, 999999),
      l: clamp(lane | 0, 0, CFG.lanes - 1),
      fx: +clamp(fx, 0, 1).toFixed(3),
      a: alive ? 1 : 0,
      lastUpdate: now,
    }).catch(() => {});
  }
  leaveRace() { try { this.ok && this._myRef && this._myRef.remove(); } catch {} }
  async submitScore(score, dist) {
    score = clamp(Math.floor(score), 0, 999999);
    dist = clamp(Math.floor(dist), 0, 999999);
    const entry = { name: this.name, score, dist, ts: Date.now(), uid: this.uid };
    const best = Store.getNum('gamarawy_best', 0);
    if (score > best) Store.set('gamarawy_best', score);
    if (!this.ok) { Store.pushLocal(entry); return entry; }
    try {
      const sv = firebase.database.ServerValue.TIMESTAMP;
      await this._ref('gamarawy/scores').push({ ...entry, ts: sv });
      await this._ref('gamarawy/weekly/' + weekId()).push({ ...entry, ts: sv });
    } catch {}
    return entry;
  }
  async fetchTop(kind = 'global') {
    if (!this.ok) return Store.getBoard().slice(0, 10);
    try {
      const path = kind === 'weekly' ? 'gamarawy/weekly/' + weekId() : 'gamarawy/scores';
      const snap = await this._ref(path).orderByChild('score').limitToLast(10).once('value');
      return Object.values(snap.val() || {}).sort((a, b) => (b.score || 0) - (a.score || 0));
    } catch { return []; }
  }
  /* offline bots so the street never feels empty */
  _startBots() {
    this._stopBots();
    this._bots = BOT_NAMES.map((n, i) => ({
      key: 'bot' + i, n, c: BOT_COLORS[i % BOT_COLORS.length],
      s: rand(200, 800), d: rand(100, 900), l: randi(0, CFG.lanes - 1),
      fx: 0, a: 1, lastUpdate: Date.now(),
    }));
    const tick = () => {
      const m = new Map();
      for (const b of this._bots) {
        b.s += rand(2, 9); b.d += rand(1, 4);
        if (Math.random() < 0.025) b.l = randi(0, CFG.lanes - 1);
        b.fx = (b.l + 0.5) / CFG.lanes; b.lastUpdate = Date.now();
        m.set(b.key, b);
      }
      this.remotes.forEach((v, k) => m.set(k, v));
      this.onRace && this.onRace(m);
      this.online = m.size + 1;
      this.onPresence && this.onPresence(this.online);
    };
    tick();
    this._botTimer = setInterval(tick, 600);
  }
  _stopBots() { if (this._botTimer) clearInterval(this._botTimer); this._botTimer = 0; this._bots = []; }
}

/* ---------------- 7. Particles (pooled) ---------------- */
class Particles {
  constructor() { this.list = []; }
  _add(p) {
    if (this.list.length >= CFG.maxParticles) this.list.shift();
    this.list.push(p);
  }
  dust(x, y, n = 1) {
    for (let i = 0; i < n; i++) this._add({
      x: x + rand(-8, 8), y: y + rand(-4, 6),
      vx: rand(-30, 30), vy: rand(-90, -30),
      r: rand(2, 5), life: rand(0.4, 0.8), t: 0, col: '210,190,150',
    });
  }
  spark(x, y, n = 14) {
    for (let i = 0; i < n; i++) this._add({
      x, y, vx: rand(-220, 220), vy: rand(-260, 60),
      r: rand(1.5, 3.5), life: rand(0.3, 0.7), t: 0, col: '201,79,67',
    });
  }
  coinFx(x, y) {
    for (let i = 0; i < 8; i++) this._add({
      x, y, vx: rand(-90, 90), vy: rand(-160, -40),
      r: rand(1.5, 3), life: rand(0.3, 0.6), t: 0, col: '233,180,76',
    });
  }
  update(dt) {
    const l = this.list;
    for (let i = l.length - 1; i >= 0; i--) {
      const p = l[i];
      p.t += dt;
      if (p.t >= p.life) { l.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 120 * dt;
    }
  }
  draw(ctx) {
    for (const p of this.list) {
      const a = (1 - p.t / p.life) * 0.85;
      ctx.fillStyle = 'rgba(' + p.col + ',' + a.toFixed(2) + ')';
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (1 + p.t * 2), 0, 6.2832); ctx.fill();
    }
  }
  clear() { this.list.length = 0; }
}

/* ---------------- 8. CarArt — hand-inked, each type has a silhouette ---------------- */
function setInk(ctx, w) {
  ctx.strokeStyle = '#2a2018'; ctx.lineWidth = w;
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
}
/** lighten/darken hex color by amt (-1..1) */
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (amt >= 0) { r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt; }
  else { r *= 1 + amt; g *= 1 + amt; b *= 1 + amt; }
  return 'rgb(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ')';
}
/** deterministic wobble offsets for a seed */
function wobbles(seed) {
  const out = [];
  for (let k = 1; k <= 12; k++) out.push((hash01((seed | 0) * 31 + k * 17) - 0.5) * 4);
  return out;
}
function traceBody(ctx, x, y, w, h, j, type) {
  // per-type silhouette: van/pickup are boxier, hatch is stubby, sedan is sleek
  const boxy = (type === 'van' || type === 'pickup') ? 1 : 0;
  const nose = boxy ? 6 : 10;   // front taper
  const tail = boxy ? 6 : 8;    // rear taper
  ctx.beginPath();
  ctx.moveTo(x - w / 2 + 4 + j[0], y - h / 2 + nose);
  ctx.quadraticCurveTo(x - w / 2 - 2 + j[1], y - h * 0.1, x - w / 2 + 3 + j[2], y + h / 2 - tail);
  ctx.quadraticCurveTo(x - w / 2 + 9, y + h / 2 + 2 + j[3], x, y + h / 2 + 1 + j[4]);
  ctx.quadraticCurveTo(x + w / 2 - 8, y + h / 2 + 2, x + w / 2 - 3 + j[5], y + h / 2 - tail);
  ctx.quadraticCurveTo(x + w / 2 + 2 + j[6], y - h * 0.1, x + w / 2 - 5 + j[7], y - h / 2 + nose);
  ctx.quadraticCurveTo(x + w / 4, y - h / 2 - 3 + j[8], x, y - h / 2 - 2 + j[9]);
  ctx.quadraticCurveTo(x - w / 4, y - h / 2 - 3, x - w / 2 + 4 + j[0], y - h / 2 + nose);
  ctx.closePath();
}

function drawCar(ctx, o) {
  const w = o.w, h = o.h;
  const seed = o.seed | 0 || 1;
  const j = o._j || (o._j = wobbles(seed));
  const type = o.type || 'sedan';
  const boxy = (type === 'van' || type === 'pickup');
  const flip = !!o.flip; // optional 180° turn (kept for future use)
  ctx.save();
  ctx.translate(o.x, o.y);
  if (o.tilt) ctx.rotate(o.tilt);
  if (flip) ctx.rotate(Math.PI);
  // readable text even when the car is flipped
  const inkText = (txt, x, y, font) => {
    ctx.save(); ctx.translate(x, y); if (flip) ctx.rotate(Math.PI);
    ctx.fillStyle = '#2a2018'; ctx.font = font; ctx.textAlign = 'center';
    ctx.fillText(txt, 0, 0); ctx.restore();
  };
  const paperText = (txt, x, y, font) => {
    ctx.save(); ctx.translate(x, y); if (flip) ctx.rotate(Math.PI);
    ctx.fillStyle = '#f6ecd4'; ctx.font = font; ctx.textAlign = 'center';
    ctx.fillText(txt, 0, 0); ctx.restore();
  };
  // --- ground shadow: layered soft (lift) + hard ink offset
  ctx.fillStyle = 'rgba(30,23,16,.14)';
  ctx.beginPath(); ctx.ellipse(5, h / 2 + 5, w / 2 + 8, 11, 0, 0, 6.2832); ctx.fill();
  ctx.fillStyle = 'rgba(30,23,16,.22)';
  ctx.beginPath(); ctx.ellipse(4, h / 2 + 3, w / 2 + 4, 9, 0, 0, 6.2832); ctx.fill();
  ctx.fillStyle = 'rgba(30,23,16,.30)';
  ctx.beginPath(); ctx.ellipse(1, h / 2 - 1, w / 2, 6, 0, 0, 6.2832); ctx.fill();

  // --- wheels: 3D tire + hub + lugs, with arch shadows
  const wy = h * 0.18;
  const spin = (o.spin || 0) % 6.2832;
  for (let s = -1; s <= 1; s += 2) {
    for (const yy of [wy, -wy]) {
      const wx = s * (w / 2 + 1);
      // arch shadow carved into body
      ctx.fillStyle = 'rgba(20,14,10,.45)';
      ctx.beginPath(); ctx.ellipse(wx - s * 2, yy, 8.5, 15, 0, 0, 6.2832); ctx.fill();
      ctx.save(); ctx.translate(wx, yy);
      const tg = ctx.createLinearGradient(-7, 0, 7, 0);
      tg.addColorStop(0, '#0f0c08'); tg.addColorStop(0.45, '#2c241a');
      tg.addColorStop(0.62, '#3d3325'); tg.addColorStop(1, '#0f0c08');
      ctx.fillStyle = tg;
      ctx.beginPath(); ctx.ellipse(0, 0, 7.5, 13, 0, 0, 6.2832); ctx.fill();
      setInk(ctx, 2); ctx.stroke();
      // hubcap with depth
      const hg = ctx.createLinearGradient(-3, -6, 3, 6);
      hg.addColorStop(0, '#efe7d6'); hg.addColorStop(0.55, '#c9bfae'); hg.addColorStop(1, '#8f8574');
      ctx.fillStyle = hg;
      ctx.beginPath(); ctx.ellipse(0, 0, 3.6, 6.2, 0, 0, 6.2832); ctx.fill();
      ctx.strokeStyle = '#2a2018'; ctx.lineWidth = 1.4; ctx.stroke();
      // rotating lug hint
      const la = spin * 2;
      ctx.fillStyle = '#2a2018';
      ctx.beginPath(); ctx.arc(Math.cos(la) * 1.8, Math.sin(la) * 3.4, 1, 0, 6.2832); ctx.fill();
      ctx.beginPath(); ctx.arc(-Math.cos(la) * 1.8, -Math.sin(la) * 3.4, 1, 0, 6.2832); ctx.fill();
      // tire shine
      ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.ellipse(-2, 0, 4.5, 10, 0, 3.6, 5.6); ctx.stroke();
      ctx.restore();
    }
  }
  // --- side mirrors
  ctx.fillStyle = shade(o.color, -0.25);
  ctx.fillRect(-w / 2 - 4, -h * 0.12, 5, 7);
  ctx.fillRect(w / 2 - 1, -h * 0.12, 5, 7);
  setInk(ctx, 1.6);
  ctx.strokeRect(-w / 2 - 4, -h * 0.12, 5, 7);
  ctx.strokeRect(w / 2 - 1, -h * 0.12, 5, 7);

  // --- body base: cylindrical pseudo-3D shading (light from upper-left)
  traceBody(ctx, 0, 0, w, h, j, type);
  const bg = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
  bg.addColorStop(0, shade(o.color, -0.38));
  bg.addColorStop(0.22, shade(o.color, -0.08));
  bg.addColorStop(0.42, shade(o.color, 0.22));
  bg.addColorStop(0.62, o.color);
  bg.addColorStop(1, shade(o.color, -0.42));
  ctx.fillStyle = bg; ctx.fill();
  ctx.save(); traceBody(ctx, 0, 0, w, h, j, type); ctx.clip();
  // spine highlight down the middle = dome of the body
  const sg = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
  sg.addColorStop(0, 'rgba(255,252,240,.30)');
  sg.addColorStop(0.35, 'rgba(255,252,240,.07)');
  sg.addColorStop(0.7, 'rgba(0,0,0,.06)');
  sg.addColorStop(1, 'rgba(0,0,0,.16)');
  ctx.fillStyle = sg;
  ctx.fillRect(-w * 0.18, -h / 2, w * 0.36, h);
  // door seam + handles
  ctx.strokeStyle = 'rgba(42,32,24,.45)'; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(-w / 2 + 5, h * 0.02); ctx.lineTo(w / 2 - 5, h * 0.02); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-w / 2 + 5, h * 0.10); ctx.lineTo(w / 2 - 5, h * 0.10); ctx.stroke();
  ctx.fillStyle = 'rgba(42,32,24,.55)';
  ctx.fillRect(-9, h * 0.045, 7, 2.4);
  ctx.fillRect(2, h * 0.045, 7, 2.4);
  ctx.restore();
  setInk(ctx, 3); traceBody(ctx, 0, 0, w, h, j, type); ctx.stroke();

  // --- bumpers with top sheen
  const bw = w * 0.72;
  for (const by of [-h / 2 + 3, h / 2 - 2]) {
    const bgr = ctx.createLinearGradient(0, by - 4.5, 0, by + 4.5);
    bgr.addColorStop(0, '#5a5148'); bgr.addColorStop(0.5, '#3a332b'); bgr.addColorStop(1, '#211b14');
    ctx.fillStyle = bgr;
    ctx.beginPath(); ctx.ellipse(0, by, bw / 2, 4.5, 0, 0, 6.2832); ctx.fill();
    setInk(ctx, 2);
    ctx.beginPath(); ctx.ellipse(0, by, bw / 2, 4.5, 0, 0, 6.2832); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.3)'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.ellipse(0, by - 1.5, bw / 2 - 3, 2, 0, 3.4, 6); ctx.stroke();
  }

  // --- glasshouse: deep gradient glass + hot reflection
  const glassG = (x0, y0, x1, y1) => {
    const gg = ctx.createLinearGradient(x0, y0, x1, y1);
    gg.addColorStop(0, '#e8f4f8'); gg.addColorStop(0.35, '#bcd9e4');
    gg.addColorStop(0.75, '#7fa5b8'); gg.addColorStop(1, '#5d8296');
    return gg;
  };
  setInk(ctx, 2.4);
  if (boxy) {
    // tall windshield + side glass band
    ctx.fillStyle = glassG(0, -h * 0.36, 0, -h * 0.36 + 22);
    ctx.beginPath(); ctx.rect(-w / 2 + 7, -h * 0.36, w - 14, 22); ctx.fill(); ctx.stroke();
    // reflection streak
    ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-w / 2 + 12, -h * 0.36 + 18); ctx.lineTo(-w / 2 + 24, -h * 0.36 + 4); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.4)'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(-w / 2 + 18, -h * 0.36 + 19); ctx.lineTo(-w / 2 + 28, -h * 0.36 + 7); ctx.stroke();
  } else {
    // windshield
    ctx.fillStyle = glassG(0, -h * 0.30, 0, -h * 0.06);
    ctx.beginPath();
    ctx.moveTo(-w / 2 + 8, -h * 0.30);
    ctx.lineTo(w / 2 - 8, -h * 0.30);
    ctx.lineTo(w / 2 - 12, -h * 0.06);
    ctx.lineTo(-w / 2 + 12, -h * 0.06);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-w / 2 + 13, -h * 0.09); ctx.lineTo(-w / 2 + 23, -h * 0.27); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.4)'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(-w / 2 + 19, -h * 0.08); ctx.lineTo(-w / 2 + 27, -h * 0.24); ctx.stroke();
    // rear window
    ctx.fillStyle = glassG(0, h * 0.20, 0, h * 0.34);
    setInk(ctx, 2.2);
    ctx.beginPath();
    ctx.moveTo(-w / 2 + 10, h * 0.20); ctx.lineTo(w / 2 - 10, h * 0.20);
    ctx.lineTo(w / 2 - 8, h * 0.34); ctx.lineTo(-w / 2 + 8, h * 0.34);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // roof panel: domed gradient + left edge light
    const rg = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
    rg.addColorStop(0, shade(o.color, 0.30)); rg.addColorStop(0.4, shade(o.color, 0.16));
    rg.addColorStop(0.75, shade(o.color, -0.02)); rg.addColorStop(1, shade(o.color, -0.22));
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.moveTo(-w / 2 + 11, -h * 0.04); ctx.lineTo(w / 2 - 11, -h * 0.04);
    ctx.lineTo(w / 2 - 10, h * 0.18); ctx.lineTo(-w / 2 + 10, h * 0.18);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(42,32,24,.4)'; ctx.lineWidth = 1.4; ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(-w / 2 + 13, -h * 0.03); ctx.lineTo(-w / 2 + 12, h * 0.17); ctx.stroke();
  }

  // --- type personality
  if (type === 'taxi') {
    ctx.save(); ctx.beginPath(); ctx.rect(-w / 2 + 2, -3, w - 4, 9); ctx.clip();
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = i % 2 ? '#1e1710' : '#f6ecd4';
      ctx.fillRect(-w / 2 + 2 + (i * (w - 4)) / 6, -3, (w - 4) / 6, 9);
    }
    ctx.restore();
    setInk(ctx, 2); ctx.strokeRect(-w / 2 + 2, -3, w - 4, 9);
    // roof sign with tiny dome light
    ctx.fillStyle = '#f6ecd4'; ctx.fillRect(-12, -h * 0.20, 24, 10);
    setInk(ctx, 2); ctx.strokeRect(-12, -h * 0.20, 24, 10);
    inkText('تاكسي', 0, -h * 0.20 + 7.5, 'bold 7.5px "El Messiri",sans-serif');
  } else if (type === 'pickup') {
    // open bed + crates + spare
    ctx.fillStyle = '#6b4c2c'; ctx.fillRect(-w / 2 + 7, h * 0.14, w - 14, 16);
    setInk(ctx, 2); ctx.strokeRect(-w / 2 + 7, h * 0.14, w - 14, 16);
    ctx.fillStyle = '#8a6b42';
    ctx.fillRect(-w / 2 + 10, h * 0.16, 10, 8);
    ctx.fillRect(w / 2 - 20, h * 0.18, 11, 8);
    setInk(ctx, 1.4);
    ctx.strokeRect(-w / 2 + 10, h * 0.16, 10, 8);
    ctx.strokeRect(w / 2 - 20, h * 0.18, 11, 8);
    ctx.strokeStyle = 'rgba(42,32,24,.5)'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(-w / 2 + 10, h * 0.20); ctx.lineTo(-w / 2 + 20, h * 0.20); ctx.stroke();
  } else if (type === 'van') {
    ctx.strokeStyle = 'rgba(42,32,24,.5)'; ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.moveTo(w / 2 - 6, -h * 0.1); ctx.lineTo(w / 2 - 6, h * 0.32); ctx.stroke();
    inkText('توصيل', 0, h * 0.10, 'bold 9px "El Messiri",sans-serif');
    // rear wiper hint
    ctx.strokeStyle = 'rgba(42,32,24,.4)'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(0, h * 0.30); ctx.lineTo(8, h * 0.24); ctx.stroke();
  } else if (type === 'hatch') {
    // rear spoiler
    ctx.fillStyle = shade(o.color, -0.3);
    ctx.fillRect(-w / 2 + 2, h / 2 - 12, w - 4, 6);
    setInk(ctx, 1.8); ctx.strokeRect(-w / 2 + 2, h / 2 - 12, w - 4, 6);
    // star sticker
    ctx.fillStyle = '#f6ecd4';
    ctx.beginPath(); ctx.arc(8, h * 0.30, 6, 0, 6.2832); ctx.fill();
    setInk(ctx, 1.6); ctx.stroke();
    ctx.fillStyle = '#c94f43'; ctx.font = 'bold 8px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('★', 8, h * 0.30 + 3);
  } else if (type === 'compact') {
    // big round charm + flower sticker
    ctx.fillStyle = '#f6ecd4';
    ctx.beginPath(); ctx.arc(-w / 2 + 10, h * 0.28, 5, 0, 6.2832); ctx.fill();
    setInk(ctx, 1.5); ctx.stroke();
    ctx.fillStyle = '#7a8450'; ctx.font = '8px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('✿', -w / 2 + 10, h * 0.28 + 3);
  } else {
    // sedan chrome strip
    ctx.strokeStyle = 'rgba(246,236,212,.65)'; ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.moveTo(-w / 2 + 6, h * 0.16); ctx.lineTo(w / 2 - 6, h * 0.16); ctx.stroke();
  }

  if (o.isPlayer) {
    // twin racing stripes over the roof
    ctx.fillStyle = 'rgba(246,236,212,.92)';
    ctx.fillRect(-6, -h * 0.045, 4.5, h * 0.23);
    ctx.fillRect(1.5, -h * 0.045, 4.5, h * 0.23);
    // racing number + flag + antenna
    ctx.fillStyle = '#f6ecd4';
    ctx.beginPath(); ctx.arc(w / 2 - 11, h * 0.30, 8.5, 0, 6.2832); ctx.fill();
    setInk(ctx, 2); ctx.stroke();
    ctx.fillStyle = '#2a2018'; ctx.font = 'bold 11px "Aref Ruqaa",serif'; ctx.textAlign = 'center';
    ctx.fillText('٧', w / 2 - 11, h * 0.30 + 4);
    ctx.fillStyle = '#c94f43'; ctx.fillRect(-w / 2 + 5, h * 0.28, 7, 4.5);
    ctx.fillStyle = '#f6ecd4'; ctx.fillRect(-w / 2 + 5, h * 0.28 + 4.5, 7, 4.5);
    ctx.fillStyle = '#1e1710'; ctx.fillRect(-w / 2 + 5, h * 0.28 + 9, 7, 4.5);
    setInk(ctx, 1.2); ctx.strokeRect(-w / 2 + 5, h * 0.28, 7, 13.5);
    // antenna
    ctx.strokeStyle = '#2a2018'; ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.moveTo(w / 2 - 6, -h / 2 + 4); ctx.lineTo(w / 2 - 2, -h / 2 - 8); ctx.stroke();
    ctx.fillStyle = '#c94f43';
    ctx.beginPath(); ctx.arc(w / 2 - 2, -h / 2 - 9, 2.4, 0, 6.2832); ctx.fill();
    // hood scratch (human touch)
    ctx.strokeStyle = 'rgba(246,236,212,.55)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(-7, -h * 0.38); ctx.lineTo(3, -h * 0.34); ctx.stroke();
  } else if (hash01(seed + 5) > 0.55) {
    ctx.fillStyle = '#e9b44c';
    ctx.beginPath(); ctx.arc(-w / 2 + 10, h * 0.32, 4.5, 0, 6.2832); ctx.fill();
    setInk(ctx, 1.5); ctx.stroke();
  }
  // --- lights with glow
  const glow = (x, y, r, col) => {
    const gr = ctx.createRadialGradient(x, y, 1, x, y, r * 2.6);
    gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(255,235,160,0)');
    ctx.fillStyle = gr;
    ctx.beginPath(); ctx.arc(x, y, r * 2.6, 0, 6.2832); ctx.fill();
  };
  glow(-w / 2 + 9, -h / 2 + 7, 4.5, 'rgba(255,232,150,.55)');
  glow(w / 2 - 9, -h / 2 + 7, 4.5, 'rgba(255,232,150,.55)');
  ctx.fillStyle = '#ffedb0';
  ctx.beginPath(); ctx.arc(-w / 2 + 9, -h / 2 + 7, 4.6, 0, 6.2832); ctx.fill();
  ctx.beginPath(); ctx.arc(w / 2 - 9, -h / 2 + 7, 4.6, 0, 6.2832); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.9)';
  ctx.beginPath(); ctx.arc(-w / 2 + 7.5, -h / 2 + 5.5, 1.5, 0, 6.2832); ctx.fill();
  ctx.beginPath(); ctx.arc(w / 2 - 10.5, -h / 2 + 5.5, 1.5, 0, 6.2832); ctx.fill();
  setInk(ctx, 2);
  ctx.beginPath(); ctx.arc(-w / 2 + 9, -h / 2 + 7, 4.6, 0, 6.2832); ctx.stroke();
  ctx.beginPath(); ctx.arc(w / 2 - 9, -h / 2 + 7, 4.6, 0, 6.2832); ctx.stroke();
  ctx.fillStyle = '#d13b2e';
  ctx.fillRect(-w / 2 + 4, h / 2 - 7, 9, 4.5);
  ctx.fillRect(w / 2 - 13, h / 2 - 7, 9, 4.5);
  setInk(ctx, 1.4);
  ctx.strokeRect(-w / 2 + 4, h / 2 - 7, 9, 4.5);
  ctx.strokeRect(w / 2 - 13, h / 2 - 7, 9, 4.5);
  // front grille between headlights
  ctx.fillStyle = '#241c12';
  ctx.fillRect(-9, -h / 2 + 1, 18, 5);
  setInk(ctx, 1.4); ctx.strokeRect(-9, -h / 2 + 1, 18, 5);
  ctx.strokeStyle = 'rgba(246,236,212,.5)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(-7, -h / 2 + 3.5); ctx.lineTo(7, -h / 2 + 3.5); ctx.stroke();
  // rear license plate (reads correctly thanks to flip-aware text)
  ctx.fillStyle = '#f6ecd4';
  ctx.fillRect(-9, h / 2 - 13, 18, 6);
  setInk(ctx, 1.2); ctx.strokeRect(-9, h / 2 - 13, 18, 6);
  ctx.save(); ctx.translate(0, h / 2 - 8.2); if (flip) ctx.rotate(Math.PI);
  ctx.fillStyle = '#2a2018'; ctx.font = 'bold 5.5px "El Messiri",sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('مصر', 0, 0); ctx.restore();
  // exhaust pipe, rear corner
  ctx.fillStyle = '#1e1710';
  ctx.fillRect(w / 2 - 12, h / 2 - 3, 6, 4);
  setInk(ctx, 1.2); ctx.strokeRect(w / 2 - 12, h / 2 - 3, 6, 4);
  ctx.restore();
}

/* ---------------- 9. Traffic (fair spawner) ---------------- */
class TrafficManager {
  constructor(lanes) { this.lanes = lanes; this.list = []; this.timer = 0.6; }
  reset() { this.list.length = 0; this.timer = 0.8; }
  /** is lane blocked near the spawn line (bottom)? */
  _blocked(lane, H) {
    for (const c of this.list) if (c.lane === lane && c.y > H - 130) return true;
    return false;
  }
  update(dt, elapsed, H) {
    this.timer -= dt;
    const diff = clamp(elapsed / CFG.rampTime, 0, 1);
    if (this.timer <= 0) {
      this.timer = lerp(1.05, 0.45, diff) * rand(0.7, 1.3);
      // candidates with room; always leave >=1 lane free near spawn
      const free = [];
      for (let l = 0; l < this.lanes; l++) if (!this._blocked(l, H)) free.push(l);
      if (free.length >= 2) {
        // never take the last free lane — keeps a way through
        const take = free.length === this.lanes ? randi(1, 2) : 1;
        for (let k = 0; k < take && free.length >= 2; k++) {
          const li = randi(0, free.length - 1);
          const lane = free.splice(li, 1)[0];
          const kind = pick(TRAFFIC_KINDS);
          this.list.push({
            lane, fx: (lane + 0.5) / this.lanes, y: H + 130, prevY: H + 130,
            w: kind.w, h: kind.h, color: kind.color, type: kind.type,
            // upward speed (px/s, negative y): always faster than the scroll
            // so cars zoom up past you — same direction, no reversing look
            vr: -(rand(150, 260) + diff * 90),
            seed: randi(1, 99999), wob: rand(0, 6.28), counted: false, nearLock: 0,
          });
        }
      }
    }
    for (const c of this.list) {
      c.prevY = c.y;
      c.y += c.vr * dt;
      c.wob += dt * 2;
      if (c.nearLock > 0) c.nearLock -= dt;
    }
    // cull
    for (let i = this.list.length - 1; i >= 0; i--) {
      const c = this.list[i];
      if (c.y < -320 || c.y > H + 320) this.list.splice(i, 1);
    }
  }
}

/* ---------------- 10. Coins ---------------- */
class CoinManager {
  constructor(lanes) { this.lanes = lanes; this.list = []; this.timer = 2; }
  reset() { this.list.length = 0; this.timer = 2.2; }
  update(dt, scrollSpeed, traffic) {
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = rand(1.7, 3.2);
      // avoid spawning inside a car near the top
      const lane = randi(0, this.lanes - 1);
      const clash = traffic.list.some((c) => c.lane === lane && c.y < 120);
      if (!clash) this.list.push({ lane, y: -40, t: rand(0, 6) });
    }
    for (let i = this.list.length - 1; i >= 0; i--) {
      const c = this.list[i];
      c.y += scrollSpeed * dt; c.t += dt;
      if (c.y > 900) this.list.splice(i, 1);
    }
  }
}

/* ---------------- 11. Player ---------------- */
class Player {
  constructor(color, x) {
    this.lane = 1; this.laneF = 1;
    this.x = x; this.y = 0;
    this.tilt = 0; this.alive = true;
    this.score = 0; this.dist = 0;
    this.coinsN = 0; this.nearN = 0; this.overN = 0;
    this.combo = 0; this.comboT = 0;
    this.color = color; this.seed = randi(1, 99999);
    this.invuln = CFG.invulnTime;
    this.moveCool = 0;
  }
  tryMove(dir) {
    if (!this.alive || this.moveCool > 0) return false;
    const nl = clamp(Math.round(this.lane) + dir, 0, CFG.lanes - 1);
    if (nl === this.lane) return false;
    this.lane = nl; this.moveCool = CFG.laneCooldown;
    return true;
  }
}

/* ---------------- 12. Remotes ---------------- */
class RemoteView {
  constructor() { this.items = new Map(); } // key -> {dx, dy}
  update(dt, snapshot, myDist, laneX) {
    const seen = new Set();
    snapshot.forEach((p, key) => {
      if (!p || p.a === 0) return;
      seen.add(key);
      let v = this.items.get(key);
      if (!v) { v = { dx: p.fx ?? 0.5, dy: 0 }; this.items.set(key, v); }
      const k1 = damp(10, dt), k2 = damp(7, dt);
      v.dx = lerp(v.dx, clamp(p.fx ?? 0.5, 0, 1), k1);
      const targetDy = clamp(((p.d || 0) - myDist) * 2.2, -420, 200);
      v.dy = lerp(v.dy, targetDy, k2);
      v._p = p;
    });
    // drop gone players
    this.items.forEach((_, k) => { if (!seen.has(k)) this.items.delete(k); });
  }
  draw(ctx, game) {
    if (!game.player) return;
    this.items.forEach((v) => {
      const p = v._p; if (!p) return;
      const laneF = clamp(v.dx, 0, 1) * CFG.lanes - 0.5;
      const x = game.laneX(laneF);
      const y = game.player.y - v.dy - 190;
      if (y < -80 || y > game.H + 80) return;
      // personality from name hash so each rival keeps their look
      const nm0 = String(p.n || 'سواق');
      let hh = 0; for (let i = 0; i < nm0.length; i++) hh = (hh * 31 + nm0.charCodeAt(i)) | 0;
      const types = ['sedan', 'hatch', 'compact', 'taxi'];
      drawCar(ctx, { x, y, w: 48, h: 86, color: p.c || '#c94f43', type: types[Math.abs(hh) % types.length], seed: Math.abs(hh) + 11, tilt: 0, spin: game.wheel });
      const nm = String(p.n || 'سواق').slice(0, 12);
      ctx.save(); ctx.translate(x, y - 56); ctx.rotate(-0.03);
      ctx.font = 'bold 12px "El Messiri", sans-serif';
      const tw = ctx.measureText(nm).width + 18;
      ctx.fillStyle = '#f6ecd4'; ctx.strokeStyle = '#2a2018'; ctx.lineWidth = 2;
      const r = 8, hw = tw / 2;
      ctx.beginPath();
      ctx.moveTo(-hw + r, -11); ctx.lineTo(hw - r, -11); ctx.quadraticCurveTo(hw, -11, hw, -4);
      ctx.lineTo(hw, 4); ctx.quadraticCurveTo(hw, 11, hw - r, 11);
      ctx.lineTo(-hw + r, 11); ctx.quadraticCurveTo(-hw, 11, -hw, 4);
      ctx.lineTo(-hw, -4); ctx.quadraticCurveTo(-hw, -11, -hw + r, -11);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#2a2018'; ctx.textAlign = 'center'; ctx.fillText(nm, 0, 4);
      ctx.restore();
    });
  }
}

/* ---------------- 13. World renderer ---------------- */
class World {
  constructor(game) { this.g = game; }
  draw(ctx) {
    const g = this.g, W = g.W, H = g.H;
    const { roadW, roadL, roadR } = g.geom;
    // warm sand base with soft sun wash (sun from upper-left)
    const sun = ctx.createLinearGradient(0, 0, W, H);
    sun.addColorStop(0, '#e8d5a8');
    sun.addColorStop(0.5, '#e3cfa1');
    sun.addColorStop(1, '#d9bf8d');
    ctx.fillStyle = sun; ctx.fillRect(0, 0, W, H);
    this._blocks(ctx, W, H, roadL, roadR);
    // sidewalks with tile seams
    const sw = 26;
    ctx.fillStyle = '#dcc49a';
    ctx.fillRect(roadL - sw, 0, sw, H); ctx.fillRect(roadR, 0, sw, H);
    ctx.strokeStyle = 'rgba(42,32,24,.28)'; ctx.lineWidth = 1.4;
    for (let yy = -((g.scroll * 0.999) % 26); yy < H; yy += 26) {
      ctx.beginPath(); ctx.moveTo(roadL - sw, yy); ctx.lineTo(roadL, yy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(roadR, yy); ctx.lineTo(roadR + sw, yy); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(42,32,24,.4)'; ctx.lineWidth = 2;
    ctx.strokeRect(roadL - sw, -4, sw, H + 8); ctx.strokeRect(roadR, -4, sw, H + 8);
    // weathered curbs (faded paint, chips)
    const bh = 30, off = g.scroll % (bh * 2);
    for (let y = -off - bh; y < H + bh; y += bh) {
      const idx = Math.floor((y + g.scroll) / bh);
      const isRed = ((idx % 2) + 2) % 2 === 1;
      ctx.fillStyle = isRed ? '#c0574a' : '#efe3c2';
      const wob = (hash01(idx * 3 + 11) - 0.5) * 3;
      ctx.fillRect(roadL - 9 + wob, y, 9, bh - 2);
      ctx.fillRect(roadR - wob, y, 9, bh - 2);
      ctx.fillStyle = 'rgba(92,89,102,.35)';
      if (hash01(idx * 17) > 0.6) ctx.fillRect(roadL - 9 + wob + 2, y + 6, 4, 5);
      if (hash01(idx * 23) > 0.6) ctx.fillRect(roadR - wob + 3, y + 15, 4, 5);
      ctx.strokeStyle = '#2a2018'; ctx.lineWidth = 1.5;
      ctx.strokeRect(roadL - 9 + wob, y, 9, bh - 2);
      ctx.strokeRect(roadR - wob, y, 9, bh - 2);
    }
    // asphalt: warm gray + sun/shade falloff + patches + oil
    ctx.fillStyle = '#5e5b68'; ctx.fillRect(roadL, 0, roadW, H);
    ctx.fillStyle = 'rgba(255,255,255,.045)'; ctx.fillRect(roadL, 0, roadW * 0.3, H);
    ctx.fillStyle = 'rgba(0,0,0,.14)'; ctx.fillRect(roadL + roadW * 0.72, 0, roadW * 0.28, H);
    for (let k = 0; k < 5; k++) {
      const py = ((hash01(k * 77) * 900 - g.scroll) % (H + 200) + H + 200) % (H + 200) - 100;
      const px = roadL + hash01(k * 31) * roadW * 0.6;
      const pw2 = 34 + hash01(k) * 30, ph2 = 22 + hash01(k * 3) * 18;
      ctx.fillStyle = 'rgba(0,0,0,.12)'; ctx.fillRect(px, py, pw2, ph2);
      ctx.strokeStyle = 'rgba(0,0,0,.18)'; ctx.lineWidth = 1.5; ctx.strokeRect(px, py, pw2, ph2);
    }
    ctx.fillStyle = 'rgba(20,16,12,.22)';
    for (let k = 0; k < 3; k++) {
      const oy = ((hash01(k * 51 + 9) * 900 - g.scroll) % (H + 120) + H + 120) % (H + 120) - 60;
      ctx.beginPath();
      ctx.ellipse(roadL + roadW * (0.25 + k * 0.22), oy, 12, 6, 0.3 * k, 0, 6.2832);
      ctx.fill();
    }
    // edges (worn, broken in places)
    ctx.strokeStyle = '#ece0bd'; ctx.lineWidth = 4;
    for (const ex of [roadL + 7, roadR - 7]) {
      ctx.beginPath();
      let pen = false;
      for (let y = -20; y <= H + 20; y += 40) {
        if (hash01((y + (((g.scroll / 40) | 0) * 40) + ex) | 0) > 0.88) { pen = false; continue; }
        const x = ex + (hash01((y * 7 + ex) | 0) - 0.5) * 3;
        if (!pen) { ctx.moveTo(x, y); pen = true; } else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    // dashes — stable per dash index so they don't jitter
    ctx.fillStyle = '#ece0bd';
    const dashH = 34, gap = 30, cyc = dashH + gap;
    const baseIdx = Math.floor(g.scroll / cyc);
    for (let l = 1; l < CFG.lanes; l++) {
      const x = roadL + (roadW * l) / CFG.lanes;
      const n = Math.ceil(H / cyc) + 2;
      for (let k = 0; k < n; k++) {
        const idx = baseIdx + k;
        const y = idx * cyc - g.scroll;
        if (y < -dashH || y > H + dashH) continue;
        const wob = (hash01(idx * 13 + l * 101) - 0.5) * 4;
        const hh = dashH + (hash01(idx * 7 + l) - 0.5) * 6;
        ctx.save(); ctx.translate(x + wob, y); ctx.rotate((hash01(idx + l * 7) - 0.5) * 0.05);
        ctx.globalAlpha = 0.92;
        ctx.fillRect(-3, 0, 6, hh);
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
    // worn painted arrow
    const ay = H - (g.scroll % 520) - 60;
    ctx.save(); ctx.globalAlpha = 0.42; ctx.fillStyle = '#ece0bd';
    ctx.translate(roadL + roadW / 2, ay);
    ctx.beginPath();
    ctx.moveTo(0, -22); ctx.lineTo(12, -6); ctx.lineTo(4, -6); ctx.lineTo(4, 18);
    ctx.lineTo(-4, 18); ctx.lineTo(-4, -6); ctx.lineTo(-12, -6);
    ctx.closePath(); ctx.fill(); ctx.restore();
  }
  _blocks(ctx, W, H, roadL, roadR) {
    const segH = 230;
    const start = Math.floor(this.g.scroll / segH) - 1;
    const end = start + Math.ceil(H / segH) + 3;
    for (let i = start; i < end; i++) {
      const y = i * segH - this.g.scroll;
      this._side(ctx, 0, roadL, y, segH, i, -1);
      this._side(ctx, roadR, W, y, segH, i, 1);
    }
  }
  _side(ctx, x0, x1, y, segH, idx, side) {
    const w = x1 - x0;
    if (w <= 4) return;
    // normalize negative modulo
    const mod = (a, n) => ((a % n) + n) % n;
    const h1 = hash01(idx * 12 + side * 3 + 50);
    const h2 = hash01(idx * 5 + side * 7 + 90);
    const h3 = hash01(idx * 9 + side + 130);
    const h4 = hash01(idx * 29 + side * 11 + 7);
    // varied facades: sandstone, faded rose, pale sage, dusty ochre
    const pal = ['#e9dab6', '#dfc9a0', '#d9bfa4', '#cfd3b8', '#e2cfae'];
    ctx.fillStyle = pal[(h1 * pal.length) | 0];
    ctx.fillRect(x0 + 2, y + 4, w - 4, segH - 8);
    // sun shade on one side
    if (side < 0) { ctx.fillStyle = 'rgba(255,250,235,.18)'; ctx.fillRect(x0 + 2, y + 4, w - 4, segH - 8); }
    else { ctx.fillStyle = 'rgba(60,40,20,.08)'; ctx.fillRect(x0 + 2, y + 4, w - 4, segH - 8); }
    ctx.strokeStyle = '#2a2018'; ctx.lineWidth = 2.5;
    ctx.strokeRect(x0 + 2, y + 4, w - 4, segH - 8);
    // cornice line under roof
    ctx.fillStyle = 'rgba(42,32,24,.20)';
    ctx.fillRect(x0 + 2, y + 10, w - 4, 5);
    // windows with shutters / balconies / AC
    const cols = w < 60 ? 1 : 2;
    for (let r = 0; r < 2; r++) for (let c = 0; c < cols; c++) {
      const wx = x0 + 10 + c * Math.max(10, w / 2 - 4) + (hash01(idx + r * 5 + c * 9 + side) - 0.5) * 5;
      const wy = y + 24 + r * 60;
      const ww = 20 + hash01(idx + c + 7) * 8, wh = 26 + hash01(idx + r + 3) * 6;
      const lit = hash01(idx + r + c + side + 40) > 0.55;
      ctx.fillStyle = lit ? '#7d94a8' : '#46586a';
      ctx.fillRect(wx, wy, ww, wh);
      // glass shine
      ctx.fillStyle = 'rgba(255,255,255,.28)';
      ctx.fillRect(wx + 3, wy + 3, 5, wh - 6);
      ctx.strokeStyle = '#2a2018'; ctx.lineWidth = 2; ctx.strokeRect(wx, wy, ww, wh);
      ctx.strokeStyle = 'rgba(42,32,24,.6)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(wx + ww / 2, wy); ctx.lineTo(wx + ww / 2, wy + wh); ctx.stroke();
      const kind = hash01(idx * 3 + r * 11 + c * 7 + side);
      if (kind > 0.72) {
        // balcony with railing
        ctx.strokeStyle = '#2a2018'; ctx.lineWidth = 2;
        ctx.strokeRect(wx - 3, wy + wh, ww + 6, 10);
        ctx.lineWidth = 1.4;
        for (let b = 0; b < 4; b++) {
          const bx = wx - 3 + ((ww + 6) * (b + 0.5)) / 4;
          ctx.beginPath(); ctx.moveTo(bx, wy + wh); ctx.lineTo(bx, wy + wh + 10); ctx.stroke();
        }
        // plant on balcony
        if (hash01(idx + r + c * 3) > 0.5) {
          ctx.fillStyle = '#6f7f46';
          ctx.beginPath(); ctx.arc(wx + ww - 2, wy + wh - 2, 4, 0, 6.2832); ctx.fill();
          ctx.strokeStyle = '#2a2018'; ctx.lineWidth = 1.2; ctx.stroke();
        }
      } else if (kind > 0.5) {
        // side shutters
        ctx.fillStyle = '#a9805a';
        ctx.fillRect(wx - 5, wy + 2, 4, wh - 4);
        ctx.fillRect(wx + ww + 1, wy + 2, 4, wh - 4);
        ctx.strokeStyle = '#2a2018'; ctx.lineWidth = 1.2;
        ctx.strokeRect(wx - 5, wy + 2, 4, wh - 4);
        ctx.strokeRect(wx + ww + 1, wy + 2, 4, wh - 4);
      } else if (kind > 0.34 && w > 50) {
        // AC box humming under window
        ctx.fillStyle = '#cfc6b4';
        ctx.fillRect(wx + 3, wy + wh + 2, 12, 8);
        ctx.strokeStyle = '#2a2018'; ctx.lineWidth = 1.4;
        ctx.strokeRect(wx + 3, wy + wh + 2, 12, 8);
        ctx.beginPath(); ctx.moveTo(wx + 5, wy + wh + 6); ctx.lineTo(wx + 13, wy + wh + 6); ctx.stroke();
      }
    }
    // satellite dish on some roofs
    if (h4 > 0.62 && w > 45) {
      const dx = x0 + w - 16, dy = y + 12;
      ctx.strokeStyle = '#2a2018'; ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.moveTo(dx, dy + 8); ctx.lineTo(dx, dy - 4); ctx.stroke();
      ctx.fillStyle = '#efe6cf';
      ctx.beginPath(); ctx.arc(dx - 3, dy - 5, 6, 0.6, 2.6); ctx.fill();
      ctx.strokeStyle = '#2a2018'; ctx.lineWidth = 1.4; ctx.stroke();
    }
    // laundry line on some
    if (h4 > 0.4 && h4 <= 0.62 && w > 55) {
      const ly = y + 52;
      ctx.strokeStyle = 'rgba(42,32,24,.6)'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(x0 + 6, ly); ctx.quadraticCurveTo(x0 + w / 2, ly + 5, x1 - 6, ly); ctx.stroke();
      const shirtCols = ['#c94f43', '#f6ecd4', '#2f8f83'];
      for (let s = 0; s < 3; s++) {
        ctx.fillStyle = shirtCols[(s + idx) % 3];
        const sx = x0 + 10 + s * ((w - 20) / 3);
        ctx.fillRect(sx, ly + 1, 9, 8);
        ctx.strokeStyle = '#2a2018'; ctx.lineWidth = 1; ctx.strokeRect(sx, ly + 1, 9, 8);
      }
    }
    if (mod(idx, 2) === 0) {
      // ---- shop with scalloped awning + sign + goods
      const sy = y + segH - 72;
      const shop = SHOPS[mod(idx * side, SHOPS.length)];
      const awCols = h2 > 0.5 ? ['#c96f3b', '#f6ecd4'] : ['#2f8f83', '#f6ecd4'];
      const stripes = 5;
      for (let s = 0; s < stripes; s++) {
        ctx.fillStyle = awCols[s % 2];
        ctx.fillRect(x0 + 4 + (s * (w - 8)) / stripes, sy, (w - 8) / stripes, 14);
        // scallop
        ctx.beginPath();
        ctx.arc(x0 + 4 + ((s + 0.5) * (w - 8)) / stripes, sy + 14, (w - 8) / stripes / 2, 0, 3.1416);
        ctx.fill();
      }
      ctx.strokeStyle = '#2a2018'; ctx.lineWidth = 2;
      ctx.strokeRect(x0 + 4, sy, w - 8, 14);
      ctx.save();
      ctx.translate(x0 + w / 2, sy + 32); ctx.rotate((h2 - 0.5) * 0.07);
      const signCols = ['#f6ecd4', '#20303c', '#7a2e26'];
      ctx.fillStyle = signCols[mod(idx + side, 3)];
      const sfill = ctx.fillStyle;
      ctx.fillRect(-w / 2 + 8, -11, Math.max(10, w - 16), 22);
      ctx.strokeStyle = '#2a2018'; ctx.lineWidth = 2.5;
      ctx.strokeRect(-w / 2 + 8, -11, Math.max(10, w - 16), 22);
      ctx.fillStyle = sfill === '#f6ecd4' ? '#2a2018' : '#f6ecd4';
      ctx.font = 'bold 11px "El Messiri", sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(shop.slice(0, 12), 0, 4);
      // hand underline flourish
      ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(-w / 4, 8); ctx.quadraticCurveTo(0, 10, w / 4, 7); ctx.stroke();
      ctx.restore();
      // door + crates + sack outside
      ctx.fillStyle = '#241c12'; ctx.fillRect(x0 + w / 2 - 9, sy + 44, 18, 24);
      ctx.strokeStyle = '#2a2018'; ctx.lineWidth = 1.6; ctx.strokeRect(x0 + w / 2 - 9, sy + 44, 18, 24);
      if (w > 60) {
        ctx.fillStyle = '#a9805a'; ctx.fillRect(x0 + 8, sy + 50, 12, 12);
        ctx.strokeStyle = '#2a2018'; ctx.lineWidth = 1.4; ctx.strokeRect(x0 + 8, sy + 50, 12, 12);
        ctx.beginPath(); ctx.moveTo(x0 + 8, sy + 56); ctx.lineTo(x0 + 20, sy + 56); ctx.stroke();
        ctx.fillStyle = '#d9cfae';
        ctx.beginPath(); ctx.ellipse(x1 - 16, sy + 58, 8, 6, 0, 0, 6.2832); ctx.fill();
        ctx.strokeStyle = '#2a2018'; ctx.stroke();
      }
    }
    const gy = y + 40 + h3 * 100;
    const tx = x0 + w / 2 + (h2 - 0.5) * 16;
    if (hash01(idx + side * 13 + 200) > 0.5) {
      // layered ficus canopy
      ctx.strokeStyle = '#2a2018'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(tx, gy + 26); ctx.lineTo(tx + 2, gy + 6); ctx.stroke();
      ctx.fillStyle = '#6f7f46';
      ctx.beginPath(); ctx.arc(tx - 6, gy + 4, 11, 0, 6.2832); ctx.fill();
      ctx.fillStyle = '#7a8450';
      ctx.beginPath(); ctx.arc(tx + 4, gy - 2, 13 + h1 * 4, 0, 6.2832); ctx.fill();
      ctx.strokeStyle = '#2a2018'; ctx.lineWidth = 2.2; ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,.22)';
      ctx.beginPath(); ctx.arc(tx, gy - 8, 5, 0, 6.2832); ctx.fill();
      // fallen leaves
      ctx.fillStyle = 'rgba(122,132,80,.5)';
      ctx.fillRect(tx - 10, gy + 26, 4, 2); ctx.fillRect(tx + 6, gy + 28, 4, 2);
    } else {
      // pole + tangled Cairo wires
      ctx.strokeStyle = '#2a2018'; ctx.lineWidth = 3.5;
      ctx.beginPath(); ctx.moveTo(tx, gy - 20); ctx.lineTo(tx + 1, gy + 40); ctx.stroke();
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(tx - 12, gy - 12); ctx.lineTo(tx + 12, gy - 14); ctx.stroke();
      ctx.strokeStyle = 'rgba(42,32,24,.5)'; ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.moveTo(tx - 12, gy - 12); ctx.quadraticCurveTo(tx - 30, gy + 2, tx - 44, gy - 10); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(tx + 12, gy - 14); ctx.quadraticCurveTo(tx + 30, gy, tx + 44, gy - 12); ctx.stroke();
    }
    if (h3 > 0.3) {
      // two pedestrians, colored galabeyas
      const cols2 = ['#2f8f83', '#7a2e26', '#4d5a6b'];
      for (let pi = 0; pi < (w > 60 ? 2 : 1); pi++) {
        const px = x0 + 12 + h1 * Math.max(8, w - 24) + pi * 18;
        const py = y + 150 + h2 * 40 + pi * 12;
        ctx.fillStyle = '#2a2018';
        ctx.beginPath(); ctx.arc(px, py, 3.6, 0, 6.2832); ctx.fill();
        ctx.fillStyle = cols2[mod(idx + pi, 3)];
        ctx.beginPath();
        ctx.moveTo(px - 3.4, py + 4); ctx.lineTo(px + 3.4, py + 4);
        ctx.lineTo(px + 4.4, py + 16); ctx.lineTo(px - 4.4, py + 16);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = '#2a2018'; ctx.lineWidth = 1.2; ctx.stroke();
      }
    }
  }
}

/* ---------------- 14. Game ---------------- */
class Game {
  constructor(net, audio) {
    this.net = net; this.audio = audio;
    this.cv = $('game'); this.ctx = this.cv.getContext('2d');
    this.W = CFG.canvasW; this.H = 800;
    this.state = 'lobby';
    this.player = null;
    this.traffic = new TrafficManager(CFG.lanes);
    this.coins = new CoinManager(CFG.lanes);
    this.parts = new Particles();
    this.remotes = new Map();
    this.remoteView = new RemoteView();
    this.world = new World(this);
    this.scroll = 0; this.elapsed = 0; this.speed = 0;
    this.bounce = 0; this.wheel = 0; this.shake = 0;
    this.overTimer = 0; this.overReason = 'crash';
    this.paused = false;
    this.name = Store.get('gamarawy_name', '');
    this.carColor = Store.get('gamarawy_car', CAR_COLORS[0]);
    this.best = Store.getNum('gamarawy_best', 0);
    this.geom = { roadW: 300, roadL: 90, roadR: 390 };
    this.laneCenters = [];
    this._resize();
    window.addEventListener('resize', () => this._resize());
    document.addEventListener('visibilitychange', () => {
      this.paused = document.hidden;
      if (!document.hidden) this._last = 0; // avoid dt jump
    });
    this.input = new InputManager(this);
    this._last = 0;
    this._loop = (t) => this._frame(t);
    requestAnimationFrame(this._loop);
  }
  _resize() {
    const r = this.cv.parentElement.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.dpr = dpr;
    this.W = CFG.canvasW;
    this.H = clamp(Math.round(CFG.canvasW * (r.height / Math.max(1, r.width))), CFG.canvasHMin, CFG.canvasHMax);
    this.cv.width = Math.round(this.W * dpr);
    this.cv.height = Math.round(this.H * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const roadW = Math.min(this.W * 0.74, 400);
    const roadL = (this.W - roadW) / 2;
    this.geom = { roadW, roadL, roadR: roadL + roadW };
    this.laneCenters = [];
    for (let i = 0; i < CFG.lanes; i++) this.laneCenters.push(roadL + (roadW * (i + 0.5)) / CFG.lanes);
    if (this.player) this.player.y = this.H - CFG.playerY;
  }
  laneX(laneF) {
    const i = clamp(laneF, -0.5, CFG.lanes - 0.5);
    const l0 = clamp(Math.floor(i), 0, CFG.lanes - 1);
    const l1 = clamp(l0 + 1, 0, CFG.lanes - 1);
    const t = clamp(i - l0, 0, 1);
    return lerp(this.laneCenters[l0], this.laneCenters[l1], t);
  }
  requestMove(dir) {
    if (this.state !== 'racing' || !this.player || this.paused) return;
    if (this.player.tryMove(dir)) {
      this.audio.lane();
      this.parts.dust(this.player.x, this.player.y + 30, 4);
    }
  }
  start(nick) {
    this.audio.ensure(); this.audio.click(); this.audio.startJingle(); this.audio.startEngine();
    if (nick && nick.trim()) { this.name = nick.trim().slice(0, 14); Store.set('gamarawy_name', this.name); }
    if (!this.name) this.name = 'سواق';
    Store.set('gamarawy_car', this.carColor);
    this.net.setIdentity(this.name, this.carColor);
    this.state = 'racing';
    this.scroll = 0; this.elapsed = 0; this.shake = 0;
    this.traffic.reset(); this.coins.reset(); this.parts.clear();
    this.player = new Player(this.carColor, this.laneCenters[1]);
    this.player.y = this.H - CFG.playerY;
    $('lobby').classList.add('hidden'); $('gameover').classList.add('hidden');
    $('hud').classList.remove('hidden'); $('liveTag').classList.remove('hidden');
    if (window.innerWidth < 700 || 'ontouchstart' in window) $('touchControls').classList.remove('hidden');
    this.bigMsg('السباق بدأ!');
  }
  toLobby() {
    this.audio.click();
    this.state = 'lobby';
    this.net.leaveRace();
    this.player = null;
    $('gameover').classList.add('hidden'); $('lobby').classList.remove('hidden');
    $('hud').classList.add('hidden'); $('touchControls').classList.add('hidden');
    $('lobbyBest').textContent = ar(this.best);
  }
  crash() {
    const p = this.player;
    if (!p || !p.alive || this.state !== 'racing') return;
    p.alive = false;
    this.audio.crash(); this.audio.stopEngine();
    this.shake = 14;
    this.parts.spark(p.x, p.y, 22);
    this.state = 'over-anim';
    this.overTimer = 1.1; this.overReason = 'crash';
    this.bigMsg('متخبطش!');
  }
  _finishOver() {
    this.state = 'over';
    const p = this.player;
    const rank = this.liveRank();
    $('overScore').textContent = ar(Math.floor(p.score));
    $('overDist').textContent = ar(Math.floor(p.dist)) + ' م';
    $('overRank').textContent = '#' + ar(rank);
    const s = Math.floor(p.score);
    const isRec = s > this.best;
    if (isRec) { this.best = s; Store.set('gamarawy_best', s); }
    $('overBest').textContent = ar(this.best);
    $('newRecord').classList.toggle('hidden', !isRec);
    if (isRec) this.audio.fanfare();
    $('overKicker').textContent = 'خبطت يا معلم…';
    $('overTitle').textContent = isRec ? 'رقم جديد! عاش!' : (s > 1500 ? 'سواقة معلمين!' : 'المرة الجاية أحسن!');
    $('gameover').classList.remove('hidden');
    $('touchControls').classList.add('hidden');
    this.net.leaveRace();
    this.net.submitScore(p.score, p.dist).then(() => UI.refreshBoards()).catch(() => {});
  }
  liveRank() {
    if (!this.player) return 1;
    let r = 1;
    this.remotes.forEach((p) => { if ((p.s || 0) > this.player.score) r++; });
    return r;
  }
  bigMsg(t) {
    const el = $('bigMsg'); el.textContent = t; el.classList.remove('hidden');
    clearTimeout(this._bt); this._bt = setTimeout(() => el.classList.add('hidden'), 1300);
  }
  popup(text, big = false) {
    const box = $('popups');
    if (box.childElementCount > 6) box.firstChild.remove();
    const d = document.createElement('div');
    d.className = 'pop' + (big ? ' big' : '');
    d.textContent = text;
    d.style.right = (28 + rand(-6, 10)) + '%';
    d.style.top = (38 + rand(-4, 8)) + '%';
    box.appendChild(d);
    setTimeout(() => d.remove(), 1050);
  }
  setRemotes(m) { this.remotes = m; }
  setOnline(n) {
    $('onlineCount').textContent = ar(n || 1);
    $('liveCount').textContent = ar(n || 1);
  }
  speedNow() {
    return CFG.baseSpeed + Math.min(CFG.maxExtraSpeed, this.elapsed * (CFG.maxExtraSpeed / CFG.rampTime));
  }
  /* ----- frame ----- */
  _frame(t) {
    requestAnimationFrame(this._loop);
    if (!this._last) this._last = t;
    let dt = (t - this._last) / 1000;
    this._last = t;
    if (!(dt > 0)) return;
    dt = clamp(dt, 0, 0.05);
    if (this.paused) return; // freeze while tab hidden
    this._update(dt);
    this._render();
    // net push (throttled inside)
    if (this.state === 'racing' && this.player) {
      this.net.pushRace({
        score: this.player.score, dist: this.player.dist,
        lane: Math.round(this.player.laneF),
        fx: (this.player.laneF + 0.5) / CFG.lanes,
        alive: this.player.alive,
      });
    }
  }
  _update(dt) {
    if (this.state === 'racing' && this.player) {
      const p = this.player;
      this.elapsed += dt;
      this.speed = this.speedNow();
      this.scroll += this.speed * dt;
      this.audio.engineSpeed(this.speed);
      if (p.moveCool > 0) p.moveCool -= dt;
      if (p.invuln > 0) p.invuln -= dt;
      if (p.comboT > 0) { p.comboT -= dt; if (p.comboT <= 0) p.combo = 0; }
      // smooth lateral
      const prevX = p.x;
      p.laneF = lerp(p.laneF, p.lane, damp(14, dt));
      p.x = this.laneX(p.laneF);
      const vx = (p.x - prevX) / Math.max(dt, 1e-4);
      p.tilt = clamp(vx * 0.00045, -0.26, 0.26);
      this.bounce += dt * (6 + this.speed * 0.012);
      this.wheel += dt * this.speed * 0.02;
      p.dist += this.speed * dt * CFG.distPerPx;
      p.score += this.speed * dt * CFG.scorePerPx;

      this.traffic.update(dt, this.elapsed, this.H);
      this.coins.update(dt, this.speed, this.traffic);

      // coins pickup
      for (let i = this.coins.list.length - 1; i >= 0; i--) {
        const c = this.coins.list[i];
        const cx = this.laneCenters[c.lane];
        if (Math.abs(c.y - p.y) < 42 && Math.abs(cx - p.x) < 34) {
          this.coins.list.splice(i, 1);
          p.score += CFG.coinScore; p.coinsN++;
          this.audio.coin();
          this.parts.coinFx(cx, c.y);
          this.popup('كسبت نقط! +' + ar(CFG.coinScore));
        }
      }
      // traffic interaction
      const pw = 46, ph = 82;
      for (const c of this.traffic.list) {
        const tx = this.laneCenters[c.lane];
        const dx = Math.abs(tx - p.x), dy = Math.abs(c.y - p.y);
        const hitX = dx < (pw + c.w) * 0.36;
        const hitY = dy < (ph + c.h) * 0.38;
        if (p.invuln <= 0 && hitX && hitY) { this.crash(); break; }
        // traffic zooms upward past you: crossing is prevY > p.y -> y <= p.y
        if (!c.counted && c.prevY > p.y && c.y <= p.y && c.nearLock <= 0) {
          const gap = dx - (pw + c.w) / 2;
          if (!hitX && gap < 22) {
            c.counted = true; c.nearLock = 1;
            p.nearN++; p.combo++; p.comboT = 4;
            const bonus = CFG.nearScore + (p.combo >= 3 ? 50 : 0);
            p.score += bonus;
            this.audio.near();
            this.popup(p.combo >= 3 ? 'ياااه! سلسلة! +' + ar(bonus) : 'ياااه! +' + ar(bonus), true);
            this.parts.dust(p.x, p.y, 6);
          } else if (dx > (pw + c.w) / 2) {
            c.counted = true; p.score += CFG.overScore; p.overN++;
          }
        } else if (!c.counted && c.y < p.y - 140) {
          c.counted = true;
          if (dx > (pw + c.w) / 2) { p.score += CFG.overScore; p.overN++; }
        }
      }
      if (Math.random() < dt * 22) this.parts.dust(p.x + rand(-10, 10), p.y + 36, 1);
      this.parts.update(dt);
      if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 30);
      this.remoteView.update(dt, this.remotes, p.dist);

      $('hudScore').textContent = ar(Math.floor(p.score));
      $('hudDist').textContent = ar(Math.floor(p.dist)) + ' م';
      $('hudRank').textContent = '#' + ar(this.liveRank());
    } else if (this.state === 'over-anim') {
      this.overTimer -= dt;
      this.scroll += this.speed * dt * 0.3;
      this.speed = Math.max(0, this.speed - dt * 400);
      this.parts.update(dt);
      if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 30);
      if (this.overTimer <= 0) this._finishOver();
    } else {
      this.scroll += 90 * dt;
      this.parts.update(dt);
    }
  }
  _render() {
    const ctx = this.ctx;
    ctx.save();
    if (this.shake > 0) ctx.translate(rand(-this.shake, this.shake) * 0.5, rand(-this.shake, this.shake) * 0.5);
    this.world.draw(ctx);
    // coins
    // coins: brass جنيه with inner ring + shine
    for (const c of this.coins.list) {
      const x = this.laneCenters[c.lane];
      const bob = Math.sin(c.t * 6) * 2;
      ctx.save(); ctx.translate(x, c.y + bob); ctx.rotate(Math.sin(c.t * 3) * 0.1);
      ctx.fillStyle = 'rgba(30,23,16,.2)';
      ctx.beginPath(); ctx.ellipse(2, 12, 10, 4, 0, 0, 6.2832); ctx.fill();
      ctx.fillStyle = '#d9962e'; ctx.strokeStyle = '#2a2018'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(0, 0, 11, 0, 6.2832); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#e9b44c';
      ctx.beginPath(); ctx.arc(0, 0, 7.5, 0, 6.2832); ctx.fill();
      ctx.strokeStyle = '#9c4e24'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(0, 0, 7.5, 0, 6.2832); ctx.stroke();
      ctx.fillStyle = '#fff3cf';
      ctx.beginPath(); ctx.arc(-2.5, -2.5, 2, 0, 6.2832); ctx.fill();
      ctx.fillStyle = '#7a3f16'; ctx.font = 'bold 10px "Aref Ruqaa", serif'; ctx.textAlign = 'center';
      ctx.fillText('ج', 0.5, 4);
      ctx.restore();
    }
    // traffic — same direction as you, faster, zooming upward past you
    for (const c of this.traffic.list) {
      const x = this.laneCenters[c.lane] + Math.sin(c.wob) * 1.5;
      drawCar(ctx, { x, y: c.y, w: c.w, h: c.h, color: c.color, type: c.type, seed: c.seed, tilt: Math.sin(c.wob) * 0.02, spin: this.wheel, _j: c._j || (c._j = wobbles(c.seed)) });
    }
    this.remoteView.draw(ctx, this);
    // player
    const p = this.player;
    if (p && (this.state === 'racing' || this.state === 'over-anim')) {
      const blink = p.invuln > 0 && this.state === 'racing' && (p.invuln * 10 | 0) % 2 === 0;
      if (!blink) {
        // squash on lane change: widen slightly with tilt
        const squash = 1 + Math.min(0.06, Math.abs(p.tilt) * 0.18);
        ctx.save();
        ctx.translate(p.x, p.y + Math.sin(this.bounce) * 1.6);
        ctx.scale(squash, 1 / Math.sqrt(squash));
        ctx.translate(-p.x, -(p.y + Math.sin(this.bounce) * 1.6));
        drawCar(ctx, {
          x: p.x, y: p.y + Math.sin(this.bounce) * 1.6,
          w: 50, h: 90, color: p.color, type: 'sedan',
          seed: p.seed, tilt: p.tilt, spin: this.wheel, isPlayer: true,
        });
        ctx.restore();
      }
    }
    this.parts.draw(ctx);
    const vg = ctx.createRadialGradient(this.W / 2, this.H / 2, this.H * 0.36, this.W / 2, this.H / 2, this.H * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(42,32,24,.20)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, this.W, this.H);
    ctx.restore();
  }
}

/* ---------------- 15. UI ---------------- */
const UI = {
  tab: 'global',
  init(game, net, audio) {
    this.game = game; this.net = net; this.audio = audio;
    $('btnPlay').onclick = () => {
      const v = $('nickInput').value.trim();
      game.start(v || 'سواق');
    };
    $('nickInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') $('btnPlay').click();
      e.stopPropagation();
    });
    $('btnRetry').onclick = () => game.start(game.name);
    $('btnLobby').onclick = () => game.toLobby();
    $('btnBoard').onclick = () => { audio.click(); $('boardDrawer').classList.remove('hidden'); this.loadBoard(this.tab); };
    $('btnCloseBoard').onclick = () => { audio.click(); $('boardDrawer').classList.add('hidden'); };
    $('miniRefresh').onclick = (e) => { e.stopPropagation(); this.loadMini(); };
    document.querySelectorAll('.tab').forEach((b) => { b.onclick = () => { audio.click(); this.loadBoard(b.dataset.tab); }; });
    $('btnSound').onclick = () => {
      audio.ensure();
      audio.setMuted(!audio.muted);
      $('btnSound').textContent = audio.muted ? '🔇' : '🔊';
    };
    window.addEventListener('pointerdown', () => audio.ensure(), { once: true });
    $('btnSound').textContent = audio.muted ? '🔇' : '🔊';
    $('nickInput').value = game.name || '';
    $('lobbyBest').textContent = ar(game.best);
    this.buildCarDots();
    // touch controls visibility is handled on start; hide on desktop non-touch
  },
  buildCarDots() {
    const wrap = $('carColors'); wrap.innerHTML = '';
    for (const c of CAR_COLORS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'car-dot' + (c === this.game.carColor ? ' sel' : '');
      b.style.background = c;
      b.setAttribute('aria-label', 'لون ' + c);
      b.onclick = () => {
        this.audio.ensure(); this.audio.click();
        this.game.carColor = c;
        Store.set('gamarawy_car', c);
        this.buildCarDots();
      };
      wrap.appendChild(b);
    }
  },
  refreshBoards() { this.loadMini(); this.loadBoard(this.tab); },
  async loadMini() {
    const el = $('miniTop');
    el.innerHTML = '<li>بيحمّل… ✎</li>';
    try {
      const top = await this.net.fetchTop('global');
      el.innerHTML = '';
      if (!top.length) { el.innerHTML = '<li><span>لسه مفيش نتايج</span><span>كن أول واحد!</span></li>'; return; }
      top.slice(0, 5).forEach((e, i) => {
        const li = document.createElement('li');
        if (e.uid === this.net.uid) li.className = 'me';
        const s1 = document.createElement('span'); s1.textContent = ar(i + 1) + '. ' + (e.name || 'سواق');
        const s2 = document.createElement('span'); s2.textContent = ar(e.score || 0);
        li.append(s1, s2); el.appendChild(li);
      });
    } catch { el.innerHTML = '<li><span>النت مش واصل</span><span>—</span></li>'; }
  },
  async loadBoard(tab = 'global') {
    this.tab = tab;
    document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    const el = $('boardList');
    el.innerHTML = '<li>بيحمّل المتصدرين…</li>';
    try {
      if (tab === 'you') {
        const best = Store.getNum('gamarawy_best', 0);
        const nm = Store.get('gamarawy_name', 'انت') || 'انت';
        el.innerHTML = '';
        const li = document.createElement('li'); li.className = 'me';
        const s1 = document.createElement('span'); s1.textContent = nm + ' (أحسن نتيجة)';
        const s2 = document.createElement('span'); s2.textContent = ar(best);
        li.append(s1, s2); el.appendChild(li);
        const li2 = document.createElement('li');
        const t1 = document.createElement('span'); t1.textContent = 'ترتيبك اللايف في آخر سباق';
        const t2 = document.createElement('span'); t2.textContent = '#' + ar(this.game.liveRank());
        li2.append(t1, t2); el.appendChild(li2);
        return;
      }
      const top = await this.net.fetchTop(tab);
      el.innerHTML = '';
      if (!top.length) { el.innerHTML = '<li><span>مفيش نتايج لسه</span><span>—</span></li>'; return; }
      top.forEach((e, i) => {
        const medal = i === 0 ? '🥇 ' : i === 1 ? '🥈 ' : i === 2 ? '🥉 ' : '';
        const li = document.createElement('li');
        if (e.uid === this.net.uid) li.className = 'me';
        const s1 = document.createElement('span'); s1.textContent = medal + ar(i + 1) + '. ' + (e.name || 'سواق');
        const s2 = document.createElement('span'); s2.textContent = ar(e.score || 0) + ' • ' + ar(e.dist || 0) + 'م';
        li.append(s1, s2); el.appendChild(li);
      });
    } catch { el.innerHTML = '<li><span>النت مش واصل</span><span>—</span></li>'; }
  },
};

/* ---------------- boot ---------------- */
(function boot() {
  const audio = new AudioManager();
  const net = new NetManager();
  const game = new Game(net, audio);
  UI.init(game, net, audio);
  net.name = game.name || 'سواق';
  net.car = game.carColor;
  net.init({
    onRace: (m) => game.setRemotes(m),
    onPresence: (n) => game.setOnline(n),
    onConn: (ok) => {
      $('connState').textContent = ok
        ? 'متصل • السباق أونلاين 🟢'
        : 'وضع الشارع المحلي (فيه سواقين تجريبيين) 🟡';
      UI.refreshBoards();
    },
  });
  setTimeout(() => UI.loadMini(), 2500);
  // expose for debugging
  window.__gamarawy = { game, net, audio };
})();
