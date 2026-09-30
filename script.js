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
  playerY: 186,          // distance from bottom
  baseSpeed: 320,        // px/s world scroll at t=0
  maxExtraSpeed: 480,    // added over ~75s (cruise tops at 800)
  rampTime: 75,
  scorePerPx: 0.045,     // score trickle per px scrolled
  distPerPx: 0.055,
  coinScore: 50,
  nearScore: 100,
  overScore: 25,
  laneCooldown: 0.14,    // s between lane changes
  gasBoost: 0.8,         // gas pedal adds up to +80% over cruise (~1440 top)
  brakeCut: 0.55,        // brake pedal cuts down to 45% of cruise
  accelUp: 1.8,          // how fast speed rises toward target
  accelDown: 3.5,        // brakes bite harder than the engine pulls
  invulnTime: 1.2,
  netThrottle: 120,      // ms
  remoteTimeout: 6000,
  maxParticles: 220,
};

const CAR_COLORS = ['#2e7ab8', '#c94f43', '#2f8f83', '#e9b44c', '#7a8450', '#8d4a7a'];

const TRAFFIC_TYPES = ['hatch', 'sedan', 'taxi', 'old', 'pickup', 'van'];

const SHOPS = ['فول عم فوزي', 'كشري التحرير', 'قهوة عبدو', 'فرن بلدي', 'عصير قصب', 'مكتبة النجاح', 'حلاق النجوم', 'بقالة الأمانة'];

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
const isTouchDevice = () => (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || 'ontouchstart' in window;
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
  thud() { this._noise(0.3, { vol: 0.14, cutoff: 250, delay: 0.12 }); }
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
    this.tilt = { on: false, base: 0, gamma: 0, needBase: false, timer: 0 };
    window.addEventListener('keydown', (e) => this._onKey(e));
    window.addEventListener('deviceorientation', (e) => {
      if (e.gamma == null) return;
      this.tilt.gamma = e.gamma;
      if (this.tilt.needBase) { this.tilt.needBase = false; this.tilt.base = e.gamma; }
    });
    window.addEventListener('keyup', (e) => {
      const k = e.key;
      if (k === 'ArrowUp' || k === 'w' || k === 'W' || k === 'ص') this.game.setPedal('gas', false);
      if (k === 'ArrowDown' || k === 's' || k === 'S' || k === 'س') this.game.setPedal('brake', false);
    });
    this._bindTouch();
    this._bindButtons();
  }
  _isTyping() {
    const a = document.activeElement;
    // range slider is a game control — arrows still drive while it's focused
    return a && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && a.type !== 'range'));
  }
  _onKey(e) {
    if (this._isTyping()) return; // don't hijack nickname field
    const k = e.key;
    if (k === 'ArrowUp' || k === 'w' || k === 'W' || k === 'ص') { e.preventDefault(); this.game.setPedal('gas', true); return; }
    if (k === 'ArrowDown' || k === 's' || k === 'S' || k === 'س') { e.preventDefault(); this.game.setPedal('brake', true); return; }
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
    const holdPedal = (id, which) => {
      const el = $(id);
      if (!el) return;
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); this.game.setPedal(which, true); });
      el.addEventListener('pointerup', (e) => { e.preventDefault(); this.game.setPedal(which, false); });
      el.addEventListener('pointerleave', () => this.game.setPedal(which, false));
      el.addEventListener('pointercancel', () => this.game.setPedal(which, false));
    };
    holdPedal('btnGas', 'gas'); holdPedal('btnBrake', 'brake');
    holdPedal('btnUp', 'gas'); holdPedal('btnDown', 'brake');
    // mobile d-pad: hold to keep shifting lanes
    const repeat = (id, fn) => {
      const el = $(id);
      if (!el) return;
      let t = 0;
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault(); fn();
        if (t) clearInterval(t);
        t = setInterval(fn, 170);
      });
      const end = () => { if (t) { clearInterval(t); t = 0; } };
      el.addEventListener('pointerup', end);
      el.addEventListener('pointerleave', end);
      el.addEventListener('pointercancel', end);
    };
    repeat('btnL', () => this.game.requestMove(-1));
    repeat('btnR', () => this.game.requestMove(1));
    const tiltBtn = $('btnTilt');
    if (tiltBtn) tiltBtn.addEventListener('click', () => this.toggleTilt());
    const tiltBtnD = $('btnTiltD');
    if (tiltBtnD) tiltBtnD.addEventListener('click', () => this.toggleTilt());
    // joystick: sideways notches shift lanes, up = gas, down = brake
    const base = $('joyBase'), knob = $('joyKnob');
    if (base && knob) {
      const R = 38;
      let active = false, pid = null, cx = 0, cy = 0, jx = 0, jy = 0, timer = 0;
      const paint = () => { knob.style.transform = 'translate(' + jx + 'px,' + jy + 'px)'; };
      const stop = () => {
        active = false; pid = null; jx = 0; jy = 0;
        knob.style.transition = 'transform .15s ease-out'; paint();
        this.game.setPedal('gas', false); this.game.setPedal('brake', false);
        if (timer) { clearInterval(timer); timer = 0; }
      };
      base.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        active = true; pid = e.pointerId;
        const r = base.getBoundingClientRect();
        cx = r.left + r.width / 2; cy = r.top + r.height / 2;
        knob.style.transition = 'none';
        try { base.setPointerCapture(pid); } catch {}
        this.game.audio.ensure();
        if (!timer) timer = setInterval(() => {
          if (!active) return;
          if (jx > 15) this.game.requestMove(1);
          else if (jx < -15) this.game.requestMove(-1);
          this.game.setPedal('gas', jy < -20);
          this.game.setPedal('brake', jy > 20);
        }, 100);
      });
      base.addEventListener('pointermove', (e) => {
        if (!active || e.pointerId !== pid) return;
        let dx = e.clientX - cx, dy = e.clientY - cy;
        const m = Math.hypot(dx, dy);
        if (m > R) { dx = dx / m * R; dy = dy / m * R; }
        jx = dx; jy = dy; paint();
      });
      base.addEventListener('pointerup', stop);
      base.addEventListener('pointercancel', stop);
    }
  }
  calibrateTilt() {
    if (this.tilt.gamma != null) this.tilt.base = this.tilt.gamma;
    else this.tilt.needBase = true;
  }
  _tiltLabel(t) {
    for (const id of ['tiltState', 'tiltStateD']) {
      const el = $(id);
      if (el) el.textContent = t;
    }
  }
  async toggleTilt() {
    this.game.audio.ensure(); this.game.audio.click();
    if (this.tilt.on) {
      this.tilt.on = false;
      if (this.tilt.timer) { clearInterval(this.tilt.timer); this.tilt.timer = 0; }
      this._tiltLabel('مقفولة');
      return;
    }
    // iOS needs explicit permission from a tap
    try {
      const DOE = window.DeviceOrientationEvent;
      if (DOE && typeof DOE.requestPermission === 'function') {
        if (await DOE.requestPermission() !== 'granted') return;
      } else if (typeof DOE === 'undefined') { this.game.popup('الميل بيشتغل من الموبايل بس 📱'); return; } // no sensor at all
    } catch { return; }
    this.tilt.on = true;
    this.calibrateTilt();
    this._tiltLabel('مفتوحة');
    this.game.popup('ميل الموبايل يمين وشمال 📱');
    if (!this.tilt.timer) this.tilt.timer = setInterval(() => {
      if (!this.tilt.on) return;
      const g = this.game;
      if (g.state !== 'racing' || g.paused) return;
      const d = (this.tilt.gamma || 0) - (this.tilt.base || 0);
      if (d > 12) g.requestMove(1);
      else if (d < -12) g.requestMove(-1);
    }, 130);
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
  /* offline: empty street, no fake rivals */
  _startBots() {
    this._stopBots();
    this.online = 1;
    this.onRace && this.onRace(new Map());
    this.onPresence && this.onPresence(1);
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
  skid(x, y) {
    for (let i = 0; i < 6; i++) this._add({
      x: x + rand(-14, 14), y: y + rand(-2, 4),
      vx: rand(-20, 20), vy: rand(20, 70),
      r: rand(2, 4), life: rand(0.35, 0.6), t: 0, col: '80,76,68',
    });
  }
  exhaust(x, y) {
    this._add({
      x: x + rand(-2, 2), y, vx: rand(-12, 12), vy: rand(40, 90),
      r: rand(1.5, 3), life: rand(0.25, 0.45), t: 0, col: '130,125,118',
    });
  }
  fire(x, y, n = 12) {
    for (let i = 0; i < n; i++) this._add({
      x: x + rand(-12, 12), y: y + rand(-10, 10),
      vx: rand(-60, 60), vy: rand(-160, -40),
      r: rand(3, 7), life: rand(0.3, 0.6), t: 0,
      col: Math.random() < 0.5 ? '250,150,40' : '250,210,90', shrink: true, grav: -60,
    });
  }
  smoke(x, y, n = 6) {
    for (let i = 0; i < n; i++) this._add({
      x: x + rand(-10, 10), y: y + rand(-8, 8),
      vx: rand(-25, 25), vy: rand(-70, -30),
      r: rand(4, 8), life: rand(0.8, 1.4), t: 0, col: '90,88,84', grav: -30,
    });
  }
  debris(x, y, n = 10) {
    for (let i = 0; i < n; i++) this._add({
      x, y, vx: rand(-260, 260), vy: rand(-300, 40),
      r: rand(1.5, 4), life: rand(0.4, 0.9), t: 0,
      col: Math.random() < 0.4 ? '233,180,76' : '40,34,28', grav: 500, shrink: true,
    });
  }
  update(dt) {
    const l = this.list;
    for (let i = l.length - 1; i >= 0; i--) {
      const p = l[i];
      p.t += dt;
      if (p.t >= p.life) { l.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += (p.grav == null ? 120 : p.grav) * dt;
    }
  }
  draw(ctx) {
    for (const p of this.list) {
      const a = (1 - p.t / p.life) * 0.85;
      const rr = p.shrink ? p.r * Math.max(0.2, 1 - (p.t / p.life) * 0.75) : p.r * (1 + p.t * 2);
      ctx.fillStyle = 'rgba(' + p.col + ',' + a.toFixed(2) + ')';
      ctx.beginPath(); ctx.arc(p.x, p.y, rr, 0, 6.2832); ctx.fill();
    }
  }
  clear() { this.list.length = 0; }
}

/* ---------------- 8. Cars — ported from the ok/ prototype ----------------
   Lightweight vector cars: wobble polygon body + ink outline.
   dims scaled x1.65 from the 360-wide prototype to our 480 canvas. */
const OK_KINDS = {
  hatch:  { w: 46, h: 76, hood: 0.28 },
  sedan:  { w: 50, h: 92, hood: 0.30 },
  taxi:   { w: 50, h: 89, hood: 0.30 },
  old:    { w: 45, h: 79, hood: 0.36 },
  pickup: { w: 53, h: 102, hood: 0.26 },
  van:    { w: 56, h: 112, hood: 0.15 },
};
const OK_PAINTS = ['#d98b2b', '#b8453a', '#7a9e5a', '#e9dfc8', '#8a6fa8', '#3f8f8b', '#c9a227'];
const OK_REMOTE_KINDS = ['hatch', 'sedan', 'old', 'taxi'];
function okStyle(seed, kind, color) {
  const k = OK_KINDS[kind] || OK_KINDS.sedan;
  const sd = seed | 0;
  return {
    w: k.w, h: k.h, hood: k.hood, kind, seed: sd || 1,
    color: color || (kind === 'taxi' ? '#e6b422' : OK_PAINTS[Math.floor(hash01(sd + 7) * OK_PAINTS.length) % OK_PAINTS.length]),
  };
}
function playerStyle(color, seed) {
  return { w: 50, h: 88, hood: 0.3, kind: 'player', seed: (seed | 0) || 3, color };
}
function okWob(c, pts, s, j) {
  c.beginPath();
  pts.forEach(([x, y], i) => {
    x += (hash01(s + i) - 0.5) * j * 2;
    y += (hash01(s + i + 40) - 0.5) * j * 2;
    if (i) c.lineTo(x, y); else c.moveTo(x, y);
  });
  c.closePath();
}
function okInked(c, col, lw) {
  c.fillStyle = col; c.fill();
  c.lineWidth = lw || 2; c.strokeStyle = '#2a2018'; c.lineJoin = 'round'; c.stroke();
}
/* drawCar(c, style, x, y, tilt, t) — t is elapsed seconds (wheel spin + idle bob) */
function drawCar(c, s, x, y, tilt, t) {
  const w = s.w, h = s.h, hw = w / 2, hh = h / 2, hd = s.hood * h, sd = s.seed || 1;
  c.save(); c.translate(x, y);
  c.fillStyle = 'rgba(42,33,24,.28)';
  c.beginPath(); c.ellipse(5, 6, hw + 3, hh + 2, 0, 0, 6.2832); c.fill();
  c.rotate(tilt || 0); c.translate(0, Math.sin(t * 10 + sd) * 0.8);
  c.fillStyle = '#2a2018';
  const wr = (t * 40) % 8;
  for (const sx of [-1, 1]) for (const sy of [-0.6, 0.6]) {
    c.fillRect(sx * hw - (sx > 0 ? 2 : 3), sy * hh - 5, 5, 10);
    c.fillStyle = '#8a7d6b';
    c.fillRect(sx * hw - (sx > 0 ? 2 : 3), sy * hh - 5 + wr % 10, 5, 1.5);
    c.fillStyle = '#2a2018';
  }
  okWob(c, [[-hw, hh], [-hw, -hh + hd * 0.6], [-hw + 4, -hh], [hw - 4, -hh], [hw, -hh + hd * 0.6], [hw, hh]], sd, 1);
  okInked(c, s.color);
  if (s.kind === 'pickup') {
    okWob(c, [[-hw + 3, 2], [hw - 3, 2], [hw - 3, hh - 3], [-hw + 3, hh - 3]], sd + 5, 0.8);
    okInked(c, 'rgba(0,0,0,.13)', 1.5);
    c.fillStyle = '#8a5a2b'; c.fillRect(-6, hh - 18, 10, 9); c.strokeRect(-6, hh - 18, 10, 9);
  }
  if (s.kind === 'van') {
    okWob(c, [[-hw + 3, -hh + hd + 12], [hw - 3, -hh + hd + 12], [hw - 3, hh - 3], [-hw + 3, hh - 3]], sd + 7, 0.8);
    okInked(c, 'rgba(255,255,255,.33)', 1.5);
    c.beginPath(); c.moveTo(0, -hh + hd + 12); c.lineTo(0, hh - 3); c.stroke();
  }
  if (s.kind === 'taxi') { c.fillStyle = '#fffaf0'; c.fillRect(-6, -2, 12, 6); c.strokeRect(-6, -2, 12, 6); }
  okWob(c, [[-hw + 4, -hh + hd], [hw - 4, -hh + hd], [hw - 6, -hh + hd + 10], [-hw + 6, -hh + hd + 10]], sd + 2, 0.6);
  okInked(c, '#bfe3e0', 1.5);
  if (s.kind === 'sedan' || s.kind === 'hatch' || s.kind === 'old' || s.kind === 'taxi' || s.kind === 'player') {
    okWob(c, [[-hw + 5, hh - 14], [hw - 5, hh - 14], [hw - 4, hh - 7], [-hw + 4, hh - 7]], sd + 3, 0.5);
    okInked(c, '#9fcbc6', 1.5);
  }
  c.fillStyle = '#fff3b0';
  for (const sx of [-1, 1]) {
    c.beginPath();
    if (sd % 2 < 1) c.arc(sx * (hw - 5), -hh + 3, 2.6, 0, 6.2832);
    else c.rect(sx * (hw - 5) - 2, -hh + 1, 4, 4);
    c.fill(); c.lineWidth = 1.3; c.stroke();
  }
  c.strokeStyle = 'rgba(255,255,255,.67)'; c.lineWidth = 1.5;
  c.beginPath(); c.moveTo(-hw + 6, -hh + 5); c.lineTo(-hw + 6, -hh + hd - 2); c.stroke();
  c.strokeStyle = 'rgba(0,0,0,.33)'; c.lineWidth = 1;
  c.beginPath(); c.moveTo(hw - 9, hh - 20); c.lineTo(hw - 4, hh - 26); c.stroke();
  if (hash01(sd + 11) > 0.5) {
    c.fillStyle = '#e0a82e'; c.beginPath(); c.arc(hw - 8, hh / 3, 2.5, 0, 6.2832); c.fill();
    c.lineWidth = 1; c.strokeStyle = '#2a2018'; c.stroke();
  }
  c.restore();
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
  update(dt, speed, elapsed, H) {
    this.timer -= dt;
    const diff = clamp(elapsed / CFG.rampTime, 0, 1);
    if (this.timer <= 0) {
      // spawn density follows road speed so fast driving stays busy
      const density = clamp(300 / Math.max(200, speed), 0.45, 1.4);
      this.timer = lerp(1.05, 0.45, diff) * rand(0.7, 1.3) * density;
      // candidates with room; always leave >=1 lane free near spawn
      const free = [];
      for (let l = 0; l < this.lanes; l++) if (!this._blocked(l, H)) free.push(l);
      if (free.length >= 2) {
        // never take the last free lane — keeps a way through
        const take = free.length === this.lanes ? randi(1, 2) : 1;
        for (let k = 0; k < take && free.length >= 2; k++) {
          const li = randi(0, free.length - 1);
          const lane = free.splice(li, 1)[0];
          const kind = pick(TRAFFIC_TYPES);
          const seed = randi(1, 99999);
          this.list.push({
            lane, fx: (lane + 0.5) / this.lanes, y: H + 130, prevY: H + 130,
            style: okStyle(seed, kind), type: kind,
            // upward speed: always faster than the scroll, scales a bit
            // with road speed so boosting stays spicy
            vr: -(rand(150, 260) + diff * 90 + speed * 0.12),
            seed, wob: rand(0, 6.28), counted: false, nearLock: 0,
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
    // car-following: a faster car never ghosts through a slower one
    // in the same lane — it queues up behind it instead
    for (let l = 0; l < this.lanes; l++) {
      const inLane = this.list.filter((c) => c.lane === l).sort((a, b) => a.y - b.y);
      let ahead = null;
      for (const c of inLane) {
        if (ahead) {
          const gap = (c.style.h + ahead.style.h) / 2 + 26;
          if (c.y - ahead.y < gap) c.y = ahead.y + gap;
        }
        ahead = c;
      }
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
    this.style = playerStyle(color, this.seed);
    this.throttle = 0; // -1 brake .. +1 gas
    this.invuln = CFG.invulnTime;
    this.moveCool = 0;
  }
  tryMove(dir) { return this.tryLane(Math.round(this.lane) + dir); }
  tryLane(nl) {
    nl = clamp(nl, 0, CFG.lanes - 1);
    if (!this.alive || this.moveCool > 0 || nl === this.lane) return false;
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
      if (!v) {
        // stable look per rival, like the ok/ prototype
        const c0 = key.charCodeAt(0) || 0, c1 = key.charCodeAt(1) || 0, c2 = key.charCodeAt(2) || 0;
        v = { dx: p.fx ?? 0.5, dy: 0, style: okStyle(c0 + c1, OK_REMOTE_KINDS[c2 % OK_REMOTE_KINDS.length]) };
        this.items.set(key, v);
      }
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
      // rivals are ghosts: clearly see-through so they never read as a pile-up
      ctx.save(); ctx.globalAlpha = 0.42;
      drawCar(ctx, v.style, x, y, 0, game.elapsed);
      ctx.restore();
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
    for (let yy = -26 + ((g.scroll * 0.999) % 26); yy < H; yy += 26) {
      ctx.beginPath(); ctx.moveTo(roadL - sw, yy); ctx.lineTo(roadL, yy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(roadR, yy); ctx.lineTo(roadR + sw, yy); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(42,32,24,.4)'; ctx.lineWidth = 2;
    ctx.strokeRect(roadL - sw, -4, sw, H + 8); ctx.strokeRect(roadR, -4, sw, H + 8);
    // weathered curbs (faded paint, chips) — flowing downward as you drive up
    const bh = 30;
    const coff = g.scroll % bh;
    for (let y = -bh + coff; y < H + bh; y += bh) {
      const idx = Math.floor((y - g.scroll) / bh);
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
      const py = ((hash01(k * 77) * 900 + g.scroll) % (H + 200) + H + 200) % (H + 200) - 100;
      const px = roadL + hash01(k * 31) * roadW * 0.6;
      const pw2 = 34 + hash01(k) * 30, ph2 = 22 + hash01(k * 3) * 18;
      ctx.fillStyle = 'rgba(0,0,0,.12)'; ctx.fillRect(px, py, pw2, ph2);
      ctx.strokeStyle = 'rgba(0,0,0,.18)'; ctx.lineWidth = 1.5; ctx.strokeRect(px, py, pw2, ph2);
    }
    ctx.fillStyle = 'rgba(20,16,12,.22)';
    for (let k = 0; k < 3; k++) {
      const oy = ((hash01(k * 51 + 9) * 900 + g.scroll) % (H + 120) + H + 120) % (H + 120) - 60;
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
    const dMin = Math.floor((-g.scroll - cyc) / cyc);
    const dMax = Math.ceil((H - g.scroll) / cyc) + 1;
    for (let l = 1; l < CFG.lanes; l++) {
      const x = roadL + (roadW * l) / CFG.lanes;
      for (let idx = dMin; idx <= dMax; idx++) {
        const y = idx * cyc + g.scroll;
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
    // worn painted arrow, drifting down with the road
    const ay = -60 + (g.scroll % (H + 120));
    ctx.save(); ctx.globalAlpha = 0.42; ctx.fillStyle = '#ece0bd';
    ctx.translate(roadL + roadW / 2, ay);
    ctx.beginPath();
    ctx.moveTo(0, -22); ctx.lineTo(12, -6); ctx.lineTo(4, -6); ctx.lineTo(4, 18);
    ctx.lineTo(-4, 18); ctx.lineTo(-4, -6); ctx.lineTo(-12, -6);
    ctx.closePath(); ctx.fill(); ctx.restore();
  }
  _blocks(ctx, W, H, roadL, roadR) {
    const segH = 230;
    const sc = this.g.scroll;
    const iMin = Math.floor((-sc - segH) / segH);
    const iMax = Math.ceil((H - sc) / segH) + 1;
    for (let i = iMin; i <= iMax; i++) {
      const y = i * segH + sc;
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
    this.bounce = 0; this.shake = 0;
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
  setPedal(which, on) {
    if (which === 'gas') this.pedalGas = on; else this.pedalBrake = on;
    if (this.player) this.player.throttle = (this.pedalGas ? 1 : 0) + (this.pedalBrake ? -1 : 0);
  }
  requestMove(dir) {
    if ((this.state !== 'racing' && this.state !== 'countdown') || !this.player || this.paused) return;
    if (this.player.tryMove(dir)) {
      this.audio.lane();
      this.parts.dust(this.player.x, this.player.y + 30, 4);
      this.parts.skid(this.player.x, this.player.y + 34);
    }
  }
  start(nick) {
    this.audio.ensure(); this.audio.click(); this.audio.startEngine();
    if (nick && nick.trim()) { this.name = nick.trim().slice(0, 14); Store.set('gamarawy_name', this.name); }
    if (!this.name) this.name = 'سواق';
    Store.set('gamarawy_car', this.carColor);
    this.net.setIdentity(this.name, this.carColor);
    this.state = 'countdown';
    this.countT = 2.1; this.countShown = 4;
    this.scroll = 0; this.elapsed = 0; this.shake = 0; this.speed = 0;
    this.flash = 0; this.hitstop = 0; this.smokeT = 0;
    this.pedalGas = false; this.pedalBrake = false;
    if (this.input && this.input.tilt.on) this.input.calibrateTilt();
    this.traffic.reset(); this.traffic.timer = 1.4; this.coins.reset(); this.parts.clear();
    this.player = new Player(this.carColor, this.laneCenters[1]);
    this.player.y = this.H - CFG.playerY;
    $('lobby').classList.add('hidden'); $('gameover').classList.add('hidden');
    $('hud').classList.remove('hidden'); $('liveTag').classList.remove('hidden');
    // mobile gets big buttons, desktop keeps the joystick deck
    const touch = isTouchDevice();
    $('touchControls').classList.toggle('hidden', touch);
    $('dpad').classList.toggle('hidden', !touch);
    this.bigMsg('استعد…');
  }
  toLobby() {
    this.audio.click();
    this.state = 'lobby';
    this.net.leaveRace();
    this.player = null;
    $('gameover').classList.add('hidden'); $('lobby').classList.remove('hidden');
    $('hud').classList.add('hidden'); $('touchControls').classList.add('hidden'); $('dpad').classList.add('hidden');
    $('lobbyBest').textContent = ar(this.best);
  }
  crash() {
    const p = this.player;
    if (!p || !p.alive || this.state !== 'racing') return;
    // state FIRST so a later error can never soft-lock the game
    p.alive = false;
    p.wreckRot = 0;
    p.wreckSpin = (Math.random() < 0.5 ? -1 : 1) * rand(4.5, 7.5);
    p.wreckSlide = rand(-40, 40);
    this.state = 'over-anim';
    this.overTimer = 1.25; this.overReason = 'crash';
    this.shake = 22; this.flash = 1; this.hitstop = 0.12;
    this.bigMsg('متخبطش!');
    this.parts.spark(p.x, p.y, 18);
    this.parts.fire(p.x, p.y, 14);
    this.parts.debris(p.x, p.y, 12);
    this.parts.smoke(p.x, p.y, 8);
    try {
      this.audio.crash();
      this.audio.thud();
      this.audio.stopEngine();
    } catch (err) { console.error(err); }
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
    $('overNear').textContent = ar(p.nearN);
    $('overCoins').textContent = ar(p.coinsN);
    $('newRecord').classList.toggle('hidden', !isRec);
    if (isRec) this.audio.fanfare();
    $('overKicker').textContent = 'خبطت يا معلم…';
    $('overTitle').textContent = isRec ? 'رقم جديد! عاش!' : (s > 1500 ? 'سواقة معلمين!' : 'المرة الجاية أحسن!');
    $('gameover').classList.remove('hidden');
    $('touchControls').classList.add('hidden'); $('dpad').classList.add('hidden');
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
    // never let one bad frame freeze the whole game
    try { this._update(dt); } catch (err) { console.error(err); }
    try { this._render(); } catch (err) { console.error(err); }
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
    if (this.state === 'countdown' && this.player) {
      const p = this.player;
      this.countT -= dt;
      this.scroll += 50 * dt;
      this.bounce += dt * 6;
      this.parts.update(dt);
      if (p.moveCool > 0) p.moveCool -= dt;
      p.laneF = lerp(p.laneF, p.lane, damp(14, dt));
      p.x = this.laneX(p.laneF);
      const n = Math.ceil(this.countT / 0.7);
      if (n !== this.countShown && n >= 1 && n <= 3) {
        this.countShown = n; this.bigMsg(ar(n)); this.audio.click();
      }
      if (this.countT <= 0) {
        this.state = 'racing'; this.elapsed = 0;
        p.invuln = CFG.invulnTime;
        this.bigMsg('السباق بدأ!');
        this.audio.startJingle();
      }
    } else if (this.state === 'racing' && this.player) {
      const p = this.player;
      this.elapsed += dt;
      // cruise speed ramps up; pedals ease actual speed toward a target
      const cruise = this.speedNow();
      const thr = p.throttle || 0;
      const target = cruise * (thr >= 0 ? 1 + CFG.gasBoost * thr : 1 - CFG.brakeCut * -thr);
      this.speed = lerp(this.speed, target, damp(target > this.speed ? CFG.accelUp : CFG.accelDown, dt));
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
      p.dist += this.speed * dt * CFG.distPerPx;
      p.score += this.speed * dt * CFG.scorePerPx;

      this.traffic.update(dt, this.speed, this.elapsed, this.H);
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
        const hitX = dx < (pw + c.style.w) * 0.36;
        const hitY = dy < (ph + c.style.h) * 0.38;
        if (p.invuln <= 0 && hitX && hitY) { this.crash(); break; }
        // traffic zooms upward past you: crossing is prevY > p.y -> y <= p.y
        if (!c.counted && c.prevY > p.y && c.y <= p.y && c.nearLock <= 0) {
          const gap = dx - (pw + c.style.w) / 2;
          if (!hitX && gap < 22) {
            c.counted = true; c.nearLock = 1;
            p.nearN++; p.combo++; p.comboT = 4;
            const bonus = CFG.nearScore + (p.combo >= 3 ? 50 : 0);
            p.score += bonus;
            this.audio.near();
            this.popup(p.combo >= 3 ? 'ياااه! سلسلة! +' + ar(bonus) : 'ياااه! +' + ar(bonus), true);
            this.parts.dust(p.x, p.y, 6);
          } else if (dx > (pw + c.style.w) / 2) {
            c.counted = true; p.score += CFG.overScore; p.overN++;
          }
        } else if (!c.counted && c.y < p.y - 140) {
          c.counted = true;
          if (dx > (pw + c.style.w) / 2) { p.score += CFG.overScore; p.overN++; }
        }
      }
      if (Math.random() < dt * 22) this.parts.dust(p.x + rand(-10, 10), p.y + 36, 1);
      if ((p.throttle || 0) > 0) {
        this.exhT = (this.exhT || 0) - dt;
        if (this.exhT <= 0) { this.exhT = 0.09; this.parts.exhaust(p.x + 13, p.y + 42); }
      }
      this.parts.update(dt);
      if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 30);
      this.remoteView.update(dt, this.remotes, p.dist);

      $('hudScore').textContent = ar(Math.floor(p.score));
      $('hudDist').textContent = ar(Math.floor(p.dist)) + ' م';
      $('hudRank').textContent = '#' + ar(this.liveRank());
      const sf = $('speedFill');
      if (sf) sf.style.width = (clamp((this.speed - 110) / (1450 - 110), 0, 1) * 100).toFixed(1) + '%';
      const sfm = $('speedFillM');
      if (sfm) sfm.style.width = (clamp((this.speed - 110) / (1450 - 110), 0, 1) * 100).toFixed(1) + '%';
    } else if (this.state === 'over-anim') {
      const p = this.player;
      if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 2.4);
      if (this.hitstop > 0) { this.hitstop -= dt; return; } // frozen impact frame
      const sdt = dt * 0.35; // slow-mo wreck
      this.overTimer -= dt;
      this.scroll += this.speed * sdt * 0.3;
      this.speed = Math.max(0, this.speed - sdt * 400);
      if (p && !p.alive) {
        p.wreckRot = (p.wreckRot || 0) + (p.wreckSpin || 5) * sdt;
        p.x += (p.wreckSlide || 0) * sdt;
        this.smokeT = (this.smokeT || 0) - sdt;
        if (this.smokeT <= 0) { this.smokeT = 0.07; this.parts.smoke(p.x + rand(-8, 8), p.y - 10, 2); }
      }
      this.parts.update(sdt);
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
    // speed streaks past ~650px/s: more speed, more streaks
    if (this.state === 'racing' && this.speed > 650) {
      const n = Math.min(14, ((this.speed - 650) / 60) | 0);
      ctx.strokeStyle = 'rgba(255,250,235,.10)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const sx = rand(0, this.W), sy = rand(0, this.H), ln = rand(40, 120);
        ctx.moveTo(sx, sy); ctx.lineTo(sx, sy + ln);
      }
      ctx.stroke();
    }
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
    // remotes first (ghosts), then solid traffic over them
    this.remoteView.draw(ctx, this);
    // traffic — ok/ prototype cars
    for (const c of this.traffic.list) {
      const x = this.laneCenters[c.lane] + Math.sin(c.wob) * 1.5;
      drawCar(ctx, c.style, x, c.y, Math.sin(c.wob) * 0.02, this.elapsed);
    }
    // player
    const p = this.player;
    if (p && (this.state === 'racing' || this.state === 'over-anim' || this.state === 'countdown')) {
      const blink = p.invuln > 0 && this.state === 'racing' && (p.invuln * 10 | 0) % 2 === 0;
      if (!blink) {
        if (p.alive) drawCar(ctx, p.style, p.x, p.y + Math.sin(this.bounce) * 1.6, p.tilt, this.elapsed);
        else drawCar(ctx, p.style, p.x, p.y, p.tilt * 0.4 + (p.wreckRot || 0), this.elapsed);
      }
    }
    this.parts.draw(ctx);
    const vg = ctx.createRadialGradient(this.W / 2, this.H / 2, this.H * 0.36, this.W / 2, this.H / 2, this.H * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(42,32,24,.20)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, this.W, this.H);
    // impact flash: hot white + red edges
    if (this.flash > 0) {
      ctx.fillStyle = 'rgba(255,238,200,' + (this.flash * 0.5).toFixed(3) + ')';
      ctx.fillRect(0, 0, this.W, this.H);
      ctx.strokeStyle = 'rgba(180,40,30,' + (this.flash * 0.4).toFixed(3) + ')';
      ctx.lineWidth = 26;
      ctx.strokeRect(0, 0, this.W, this.H);
    }
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
        : 'مش متوصل • بتسوق لوحدك 🟡';
      UI.refreshBoards();
    },
  });
  setTimeout(() => UI.loadMini(), 2500);
  // expose for debugging
  window.__gamarawy = { game, net, audio };
})();
