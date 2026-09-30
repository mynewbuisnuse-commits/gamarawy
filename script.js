/* ============================================================
   gamarawy — جمراوي | سباق الشوارع
   Vanilla JS + Canvas + Firebase (compat)
   Structure: Utils / AudioManager / InputManager / FirebaseManager
              Particles / CarArt / TrafficManager / Game / UI
   NOTE on cheating: browser score is never fully cheat-proof.
   We do basic sanity checks (rate-limit, plausibility) + server
   timestamp ordering. Real anti-cheat needs Cloud Functions.
   ============================================================ */
'use strict';

/* ---------------- Firebase config (from owner) ---------------- */
const firebaseConfig = {
  apiKey: "AIzaSyCBYV6y0JuHLc2ThHrV2fdZ-Ofgd5CkigI",
  authDomain: "mn-13d2a.firebaseapp.com",
  databaseURL: "https://mn-13d2a-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "mn-13d2a",
  storageBucket: "mn-13d2a.firebasestorage.app",
  messagingSenderId: "725756592101",
  appId: "1:725756592101:web:244e059383eee987a3f90c",
  measurementId: "G-C8TQRFMPJ9"
};

/* ---------------- Utils ---------------- */
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b + 1));
const AR_D = '٠١٢٣٤٥٦٧٨٩';
const ar = (n) => String(n).replace(/[0-9]/g, (d) => AR_D[+d]);
function hash(n) { let x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
function weekId(d = new Date()) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - day + 3);
  const first = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const w = 1 + Math.round(((t - first) / 864e5 - 3 + ((first.getUTCDay() + 6) % 7)) / 7);
  return t.getUTCFullYear() + '-W' + String(w).padStart(2, '0');
}
const SHOPS = ['فول عم فوزي', 'كشري التحرير', 'قهوة عبدو', 'فرن بلدي', 'عصير قصب', 'مكتبة النجاح', 'حلاق النجوم', 'بقالة الأمانة'];
const BOT_NAMES = ['عمر', 'محمد', 'يوسف', 'حبّة', 'الشبح', 'ميدو'];

/* ---------------- AudioManager (WebAudio, subtle) ---------------- */
class AudioManager {
  constructor() {
    this.ctx = null; this.muted = localStorage.getItem('gamarawy_mute') === '1';
    this.engineOsc = null; this.engineGain = null; this.engineFilter = null;
  }
  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
  }
  setMuted(m) { this.muted = m; localStorage.setItem('gamarawy_mute', m ? '1' : '0'); if (m) this.stopEngine(); }
  tone(freq, dur, type = 'sine', vol = 0.12, slide = 0) {
    if (this.muted) return; this.ensure(); if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.ctx.destination); o.start(t); o.stop(t + dur + 0.02);
  }
  noise(dur = 0.2, vol = 0.15, low = 400) {
    if (this.muted) return; this.ensure(); if (!this.ctx) return;
    const t = this.ctx.currentTime, len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = low;
    const g = this.ctx.createGain(); g.gain.value = vol;
    src.connect(f).connect(g).connect(this.ctx.destination); src.start(t);
  }
  click() { this.tone(520, 0.07, 'triangle', 0.08); }
  lane() { this.noise(0.12, 0.07, 1200); this.tone(300, 0.1, 'sine', 0.05, 120); }
  coin() { this.tone(880, 0.09, 'square', 0.05); setTimeout(() => this.tone(1320, 0.12, 'square', 0.05), 70); }
  near() { this.tone(500, 0.22, 'sawtooth', 0.06, 700); }
  crash() { this.noise(0.4, 0.22, 500); this.tone(120, 0.4, 'sine', 0.18, -60); }
  start() { [262, 330, 392, 523].forEach((f, i) => setTimeout(() => this.tone(f, 0.14, 'triangle', 0.09), i * 95)); }
  fanfare() { [523, 659, 784].forEach((f, i) => setTimeout(() => this.tone(f, 0.18, 'triangle', 0.1), i * 120)); }
  startEngine() {
    if (this.muted || this.engineOsc) return; this.ensure(); if (!this.ctx) return;
    this.engineOsc = this.ctx.createOscillator(); this.engineGain = this.ctx.createGain();
    this.engineFilter = this.ctx.createBiquadFilter();
    this.engineOsc.type = 'sawtooth'; this.engineOsc.frequency.value = 55;
    this.engineFilter.type = 'lowpass'; this.engineFilter.frequency.value = 300;
    this.engineGain.gain.value = 0.028;
    this.engineOsc.connect(this.engineFilter).connect(this.engineGain).connect(this.ctx.destination);
    this.engineOsc.start();
  }
  engineSpeed(s) {
    if (!this.engineOsc || this.muted) return;
    const f = 50 + s * 0.09;
    this.engineOsc.frequency.setTargetAtTime(f, this.ctx.currentTime, 0.1);
  }
  stopEngine() {
    try { this.engineOsc && this.engineOsc.stop(); } catch (e) {}
    this.engineOsc = null;
  }
}

/* ---------------- InputManager ---------------- */
class InputManager {
  constructor(game) {
    this.g = game;
    this.leftHeld = false; this.rightHeld = false;
    window.addEventListener('keydown', (e) => {
      if (['ArrowLeft', 'ArrowRight', 'a', 'A', 'd', 'D', 'أ', 'ش'].includes(e.key)) e.preventDefault();
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A' || e.key === 'ش') this.g.move(-1);
      if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D' || e.key === 'ي') this.g.move(1);
    });
    // swipe
    let sx = 0, sy = 0, on = false;
    const cv = $('game');
    cv.addEventListener('touchstart', (e) => { const t = e.changedTouches[0]; sx = t.clientX; sy = t.clientY; on = true; }, { passive: true });
    cv.addEventListener('touchend', (e) => {
      if (!on) return; on = false;
      const t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy;
      if (Math.abs(dx) > 28 && Math.abs(dx) > Math.abs(dy)) this.g.move(dx > 0 ? 1 : -1);
      else if (Math.abs(dx) < 10 && Math.abs(dy) < 10) { /* tap = nothing */ }
    }, { passive: true });
    const bl = $('btnLeft'), br = $('btnRight');
    const hold = (el, dir) => {
      el.addEventListener('touchstart', (e) => { e.preventDefault(); this.g.move(dir); }, { passive: false });
      el.addEventListener('mousedown', (e) => { e.preventDefault(); this.g.move(dir); });
    };
    hold(bl, -1); hold(br, 1);
  }
}

/* ---------------- FirebaseManager ---------------- */
class FirebaseManager {
  constructor() {
    this.ok = false; this.uid = 'local-' + Math.random().toString(36).slice(2, 9);
    this.name = 'ضيف'; this.car = '#2e7ab8';
    this.remotes = new Map(); this.online = 1;
    this.lastPush = 0; this.useFake = false;
    this.fakeBots = [];
  }
  init(onRace, onPresence, onConn) {
    this.onRace = onRace; this.onPresence = onPresence; this.onConn = onConn;
    try {
      if (typeof firebase === 'undefined' || !firebaseConfig.apiKey) throw new Error('no sdk');
      firebase.initializeApp(firebaseConfig);
      this.db = firebase.database();
      this.auth = firebase.auth();
      this.auth.signInAnonymously().then((cred) => {
        this.uid = cred.user.uid;
        this.ok = true; onConn && onConn(true);
        this.bindPresence(); this.bindRace();
      }).catch(() => { this.startFake(); onConn && onConn(false); });
      // connection watchdog
      setTimeout(() => { if (!this.ok) { this.startFake(); onConn && onConn(false); } }, 6000);
    } catch (e) { this.startFake(); onConn && onConn(false); }
  }
  ref(p) { return this.db.ref(p); }
  bindPresence() {
    const me = this.ref('gamarawy/presence/' + this.uid);
    const info = { name: this.name, car: this.car, ts: firebase.database.ServerValue.TIMESTAMP };
    this.db.ref('.info/connected').on('value', (s) => {
      if (s.val() === true) me.onDisconnect().remove().then(() => me.set(info));
    });
    me.set(info);
    this.presenceRef = this.ref('gamarawy/presence');
    this.presenceRef.on('value', (s) => {
      const v = s.val() || {}; const now = Date.now();
      this.online = Object.keys(v).length || 1;
      this.onPresence && this.onPresence(this.online, v);
    });
    // keep name fresh
    setInterval(() => { try { me.update({ name: this.name, car: this.car, ts: firebase.database.ServerValue.TIMESTAMP }); } catch (e) {} }, 20000);
  }
  bindRace() {
    this.raceRef = this.ref('gamarawy/race');
    this.myRef = this.raceRef.child(this.uid);
    this.myRef.onDisconnect().remove();
    this.raceRef.on('value', (s) => {
      const v = s.val() || {}; const now = Date.now();
      const out = new Map();
      for (const k of Object.keys(v)) {
        if (k === this.uid) continue;
        const p = v[k];
        if (!p || now - (p.lastUpdate || 0) > 6000) continue; // stale prune
        out.set(k, p);
      }
      this.remotes = out;
      this.onRace && this.onRace(out);
    });
  }
  updatePresenceName() {
    if (!this.ok) return;
    try {
      this.ref('gamarawy/presence/' + this.uid).update({ name: this.name, car: this.car });
    } catch (e) {}
  }
  /* throttled race write: 150ms, tiny payload */
  pushRace(state) {
    if (!this.ok) return;
    const now = Date.now();
    if (now - this.lastPush < 150) return;
    this.lastPush = now;
    // basic plausibility: never send decreasing-safe huge jumps; Game clamps score
    try {
      this.myRef.set({
        n: String(this.name).slice(0, 14),
        c: this.car, s: Math.floor(state.score), d: Math.floor(state.dist),
        l: state.lane, fx: +state.fx.toFixed(3), a: state.alive ? 1 : 0,
        lastUpdate: now
      });
    } catch (e) {}
  }
  removeRace() { try { this.ok && this.myRef.remove(); } catch (e) {} }
  async submitScore(score, dist) {
    score = Math.floor(score); dist = Math.floor(dist);
    // sanity: cap absurd values
    if (score < 0 || score > 999999 || dist < 0 || dist > 999999) return null;
    const entry = { name: String(this.name).slice(0, 14) || 'سواق', score, dist, ts: Date.now(), uid: this.uid };
    // local best always
    try {
      const k = 'gamarawy_best';
      if (score > +(localStorage.getItem(k) || 0)) localStorage.setItem(k, String(score));
    } catch (e) {}
    if (!this.ok) {
      // local board fallback
      try {
        const arr = JSON.parse(localStorage.getItem('gamarawy_local_board') || '[]');
        arr.push(entry); arr.sort((a, b) => b.score - a.score);
        localStorage.setItem('gamarawy_local_board', JSON.stringify(arr.slice(0, 20)));
      } catch (e) {}
      return entry;
    }
    try {
      await this.ref('gamarawy/scores').push({ ...entry, ts: firebase.database.ServerValue.TIMESTAMP });
      await this.ref('gamarawy/weekly/' + weekId()).push({ ...entry, ts: firebase.database.ServerValue.TIMESTAMP });
    } catch (e) {}
    return entry;
  }
  async fetchTop(kind = 'global') {
    if (!this.ok) {
      try { return JSON.parse(localStorage.getItem('gamarawy_local_board') || '[]').slice(0, 10); }
      catch (e) { return []; }
    }
    try {
      const path = kind === 'weekly' ? 'gamarawy/weekly/' + weekId() : 'gamarawy/scores';
      const snap = await this.ref(path).orderByChild('score').limitToLast(10).once('value');
      const v = snap.val() || {};
      return Object.values(v).sort((a, b) => (b.score || 0) - (a.score || 0));
    } catch (e) { return []; }
  }
  /* ---- offline fallback: fake street so game feels alive ---- */
  startFake() {
    if (this.useFake) return; this.useFake = true;
    this.fakeBots = BOT_NAMES.slice(0, 3).map((n, i) => ({
      n, c: ['#c94f43', '#2f8f83', '#e9b44c'][i], s: rand(200, 800), d: rand(100, 900),
      l: randi(0, 3), fx: 0.2 + i * 0.2, a: 1, lastUpdate: Date.now(), bot: true
    }));
    setInterval(() => {
      this.fakeBots.forEach((b) => {
        b.s += rand(2, 9); b.d += rand(1, 4);
        if (Math.random() < 0.02) b.l = randi(0, 3);
        b.fx = (b.l + 0.5) / 4; b.lastUpdate = Date.now();
      });
      const m = new Map(this.fakeBots.map((b, i) => ['bot' + i, b]));
      // merge real remotes if any arrived later
      this.remotes.forEach((v, k) => m.set(k, v));
      this.onRace && this.onRace(m);
      this.online = m.size + 1;
      this.onPresence && this.onPresence(this.online, {});
    }, 600);
  }
}

/* ---------------- Particles ---------------- */
class Particles {
  constructor() { this.list = []; }
  dust(x, y, n = 1) {
    for (let i = 0; i < n; i++) this.list.push({ x: x + rand(-8, 8), y: y + rand(-4, 6), vx: rand(-30, 30), vy: rand(-90, -30), r: rand(2, 5), life: rand(.4, .8), t: 0, col: '210,190,150' });
  }
  spark(x, y, n = 14) {
    for (let i = 0; i < n; i++) this.list.push({ x, y, vx: rand(-220, 220), vy: rand(-260, 60), r: rand(1.5, 3.5), life: rand(.3, .7), t: 0, col: '201,79,67' });
  }
  coinFx(x, y) {
    for (let i = 0; i < 8; i++) this.list.push({ x, y, vx: rand(-90, 90), vy: rand(-160, -40), r: rand(1.5, 3), life: rand(.3, .6), t: 0, col: '233,180,76' });
  }
  update(dt) {
    for (const p of this.list) { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 300 * dt * 0.4; }
    this.list = this.list.filter((p) => p.t < p.life);
  }
  draw(ctx) {
    for (const p of this.list) {
      const a = 1 - p.t / p.life;
      ctx.fillStyle = `rgba(${p.col},${(a * 0.85).toFixed(2)})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (1 + p.t * 2), 0, 7); ctx.fill();
    }
  }
}

/* ---------------- Car art (hand-drawn) ---------------- */
function ink(ctx, w = 3) { ctx.strokeStyle = '#2a2018'; ctx.lineWidth = w; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; }
function bodyPath(ctx, x, y, w, h, seed) {
  // slightly asymmetric hand body: narrower roof, wobbly sides
  const j = (k) => (hash(seed + k) - 0.5) * 4;
  ctx.beginPath();
  ctx.moveTo(x - w / 2 + 4 + j(1), y - h / 2 + 10);
  ctx.quadraticCurveTo(x - w / 2 - 2 + j(2), y, x - w / 2 + 3 + j(3), y + h / 2 - 8);
  ctx.quadraticCurveTo(x - w / 2 + 8, y + h / 2 + 2 + j(4), x, y + h / 2 + 1 + j(5));
  ctx.quadraticCurveTo(x + w / 2 - 6, y + h / 2 + 2, x + w / 2 - 3 + j(6), y + h / 2 - 8);
  ctx.quadraticCurveTo(x + w / 2 + 2 + j(7), y, x + w / 2 - 5 + j(8), y - h / 2 + 10);
  ctx.quadraticCurveTo(x + w / 4, y - h / 2 - 3 + j(9), x, y - h / 2 - 2 + j(10));
  ctx.quadraticCurveTo(x - w / 4, y - h / 2 - 3, x - w / 2 + 4 + j(1), y - h / 2 + 10);
  ctx.closePath();
}
function drawCar(ctx, o) {
  // o: {x,y,w,h,color,type,tilt,seed,wheelRot,lights}
  ctx.save();
  ctx.translate(o.x, o.y);
  ctx.rotate(o.tilt || 0);
  const w = o.w, h = o.h, seed = o.seed || 1;
  // shadow (illustrated, offset)
  ctx.fillStyle = 'rgba(30,23,16,.28)';
  ctx.beginPath(); ctx.ellipse(3, h / 2 - 2, w / 2 + 2, 8, 0, 0, 7); ctx.fill();
  // wheels
  const wy = h * 0.18;
  for (const s of [-1, 1]) {
    ctx.save(); ctx.translate(s * (w / 2 - 1), wy); ctx.rotate((o.wheelRot || 0) * s * 0.4);
    ctx.fillStyle = '#1e1710';
    ctx.fillRect(-7, -13, 14, 26);
    ink(ctx, 2); ctx.strokeRect(-7, -13, 14, 26);
    ctx.strokeStyle = '#8f8574'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(0, 8); ctx.stroke();
    ctx.restore();
    ctx.save(); ctx.translate(s * (w / 2 - 1), -wy);
    ctx.fillStyle = '#1e1710'; ctx.fillRect(-7, -12, 14, 24);
    ink(ctx, 2); ctx.strokeRect(-7, -12, 14, 24);
    ctx.restore();
  }
  // body
  bodyPath(ctx, 0, 0, w, h, seed);
  ctx.fillStyle = o.color; ctx.fill();
  ink(ctx, 3); ctx.stroke();
  // hood highlight (tiny reflection, imperfect)
  ctx.fillStyle = 'rgba(255,255,255,.28)';
  ctx.beginPath();
  ctx.moveTo(-w / 2 + 8, -h / 2 + 16);
  ctx.quadraticCurveTo(0, -h / 2 + 12, w / 2 - 10, -h / 2 + 18);
  ctx.quadraticCurveTo(w / 2 - 12, -h / 2 + 24, 0, -h / 2 + 22);
  ctx.quadraticCurveTo(-w / 2 + 10, -h / 2 + 22, -w / 2 + 8, -h / 2 + 16);
  ctx.fill();
  const t = o.type || 'sedan';
  // windshield + roof per type
  ctx.fillStyle = '#cfe3ea';
  ink(ctx, 2.5);
  if (t === 'van' || t === 'pickup') {
    ctx.beginPath(); ctx.rect(-w / 2 + 7, -h * 0.32, w - 14, 20); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(42,32,24,.12)'; ctx.fillRect(-w / 2 + 7, -h * 0.32 + 14, w - 14, 4);
  } else {
    // windshield (front = top of screen? player faces up, so windshield near top)
    ctx.beginPath();
    ctx.moveTo(-w / 2 + 8, -h * 0.28);
    ctx.lineTo(w / 2 - 8, -h * 0.28);
    ctx.lineTo(w / 2 - 12, -h * 0.05);
    ctx.lineTo(-w / 2 + 12, -h * 0.05);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // rear window
    ctx.beginPath();
    ctx.moveTo(-w / 2 + 10, h * 0.22); ctx.lineTo(w / 2 - 10, h * 0.22);
    ctx.lineTo(w / 2 - 8, h * 0.36); ctx.lineTo(-w / 2 + 8, h * 0.36);
    ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  // type details
  if (t === 'taxi') {
    // checkers
    ctx.save(); ctx.beginPath(); ctx.rect(-w / 2 + 2, -2, w - 4, 9); ctx.clip();
    for (let i = 0; i < 6; i++) { ctx.fillStyle = i % 2 ? '#1e1710' : '#f6ecd4'; ctx.fillRect(-w / 2 + 2 + i * ((w - 4) / 6), -2, (w - 4) / 6, 9); }
    ctx.restore();
    ink(ctx, 2); ctx.strokeRect(-w / 2 + 2, -2, w - 4, 9);
    // roof sign
    ctx.fillStyle = '#f6ecd4'; ctx.fillRect(-11, -h * 0.18, 22, 9);
    ink(ctx, 2); ctx.strokeRect(-11, -h * 0.18, 22, 9);
    ctx.fillStyle = '#2a2018'; ctx.font = 'bold 7px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('تاكسي', 0, -h * 0.18 + 7);
  }
  if (t === 'pickup') {
    ctx.strokeStyle = '#2a2018'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-w / 2 + 6, h * 0.12); ctx.lineTo(w / 2 - 6, h * 0.12); ctx.stroke();
    ctx.fillStyle = '#8a6b42';
    ctx.fillRect(-w / 2 + 8, h * 0.15, w - 16, 12);
    ink(ctx, 2); ctx.strokeRect(-w / 2 + 8, h * 0.15, w - 16, 12);
  }
  if (t === 'van') {
    ctx.strokeStyle = 'rgba(42,32,24,.5)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-w / 2 + 5, 6); ctx.lineTo(w / 2 - 5, 6); ctx.stroke();
    ctx.fillStyle = '#f6ecd4'; ctx.font = 'bold 8px sans-serif'; ctx.textAlign = 'center';
    ctx.fillStyle = '#2a2018'; ctx.fillText('توصيل', 0, 22);
  }
  if (o.isPlayer) {
    // number ٧ sticker + tiny flag + mirror
    ctx.fillStyle = '#f6ecd4';
    ctx.beginPath(); ctx.arc(w / 2 - 11, h * 0.28, 8, 0, 7); ctx.fill();
    ink(ctx, 2); ctx.stroke();
    ctx.fillStyle = '#2a2018'; ctx.font = 'bold 11px serif'; ctx.textAlign = 'center';
    ctx.fillText('٧', w / 2 - 11, h * 0.28 + 4);
    // flag sticker
    ctx.fillStyle = '#c94f43'; ctx.fillRect(-w / 2 + 5, h * 0.26, 7, 5);
    ctx.fillStyle = '#f6ecd4'; ctx.fillRect(-w / 2 + 5, h * 0.26 + 5, 7, 5);
    ctx.fillStyle = '#1e1710'; ctx.fillRect(-w / 2 + 5, h * 0.26 + 10, 7, 5);
    // scratch (human touch)
    ctx.strokeStyle = 'rgba(246,236,212,.6)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(-6, 10); ctx.lineTo(4, 14); ctx.stroke();
  } else {
    // random tiny sticker
    if (hash(seed) > 0.5) {
      ctx.fillStyle = '#e9b44c';
      ctx.beginPath(); ctx.arc(-w / 2 + 10, h * 0.3, 4.5, 0, 7); ctx.fill();
      ink(ctx, 1.5); ctx.stroke();
    }
  }
  // headlights (front = up)
  ctx.fillStyle = '#ffe9a8';
  ctx.beginPath(); ctx.arc(-w / 2 + 9, -h / 2 + 6, 4.5, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.arc(w / 2 - 9, -h / 2 + 6, 4.5, 0, 7); ctx.fill();
  ink(ctx, 2);
  ctx.beginPath(); ctx.arc(-w / 2 + 9, -h / 2 + 6, 4.5, 0, 7); ctx.stroke();
  ctx.beginPath(); ctx.arc(w / 2 - 9, -h / 2 + 6, 4.5, 0, 7); ctx.stroke();
  // taillights
  ctx.fillStyle = '#c94f43';
  ctx.fillRect(-w / 2 + 4, h / 2 - 6, 8, 4); ctx.fillRect(w / 2 - 12, h / 2 - 6, 8, 4);
  ctx.restore();
}

/* ---------------- TrafficManager ---------------- */
const TRAFFIC_KINDS = [
  { type: 'hatch', color: '#c94f43', w: 44, h: 78, v: [130, 200] },
  { type: 'sedan', color: '#7a8450', w: 46, h: 86, v: [120, 190] },
  { type: 'taxi', color: '#e9b44c', w: 46, h: 86, v: [150, 220] },
  { type: 'compact', color: '#8d99ae', w: 42, h: 74, v: [140, 210] },
  { type: 'pickup', color: '#9c4e24', w: 48, h: 92, v: [110, 170] },
  { type: 'van', color: '#efe0bd', w: 50, h: 96, v: [100, 160] },
];
class TrafficManager {
  constructor() { this.list = []; this.timer = 0; }
  reset() { this.list = []; this.timer = 0.6; }
  update(dt, lanes, playerSpeed, elapsed) {
    this.timer -= dt;
    const diff = clamp(elapsed / 75, 0, 1); // ramps up
    const interval = lerp(1.05, 0.45, diff);
    if (this.timer <= 0) {
      this.timer = interval * rand(0.7, 1.3);
      // pick lane not colliding at spawn
      const order = [0, 1, 2, 3].sort(() => Math.random() - 0.5);
      for (const ln of order) {
        const blocked = this.list.some((c) => c.lane === ln && c.y < 60);
        if (blocked) continue;
        const k = TRAFFIC_KINDS[randi(0, TRAFFIC_KINDS.length - 1)];
        this.list.push({
          lane: ln, fx: (ln + 0.5) / lanes, y: -130,
          prevY: -130, w: k.w, h: k.h, color: k.color, type: k.type,
          v: rand(k.v[0], k.v[1]) + diff * 40, seed: rand(1, 9999),
          wob: rand(0, 6.28), counted: false
        });
        break;
      }
      // occasional double spawn at high difficulty
      if (diff > 0.55 && Math.random() < 0.35) this.timer = 0.12;
    }
    for (const c of this.list) {
      c.prevY = c.y;
      c.y += (playerSpeed - c.v) * dt;
      c.wob += dt * 2;
    }
    this.list = this.list.filter((c) => c.y < 950 && c.y > -400);
  }
}

/* ---------------- Game ---------------- */
class Game {
  constructor(net, audio) {
    this.net = net; this.audio = audio;
    this.cv = $('game'); this.ctx = this.cv.getContext('2d');
    this.W = 480; this.H = 800;
    this.LANES = 4;
    this.state = 'lobby'; // lobby | racing | over
    this.player = null; this.traffic = new TrafficManager();
    this.parts = new Particles();
    this.coins = [];
    this.remotes = new Map();
    this.scroll = 0; this.elapsed = 0; this.speed = 0;
    this.bounce = 0; this.wheel = 0; this.shake = 0;
    this.coinTimer = 2; this.netTimer = 0;
    this.name = localStorage.getItem('gamarawy_name') || '';
    this.carColor = localStorage.getItem('gamarawy_car') || '#2e7ab8';
    this.best = +(localStorage.getItem('gamarawy_best') || 0);
    this.dpr = 1;
    this.resize(); window.addEventListener('resize', () => this.resize());
    new InputManager(this);
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
    setInterval(() => this.syncNet(), 150);
  }
  resize() {
    const r = this.cv.parentElement.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.W = 480; this.H = Math.round(480 * (r.height / Math.max(1, r.width)));
    this.H = clamp(this.H, 700, 900);
    this.cv.width = this.W * this.dpr; this.cv.height = this.H * this.dpr;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }
  roadGeom() {
    const roadW = Math.min(this.W * 0.74, 400);
    const roadL = (this.W - roadW) / 2;
    return { roadW, roadL, roadR: roadL + roadW };
  }
  laneX(laneFloat) {
    const { roadW, roadL } = this.roadGeom();
    return roadL + (roadW * (laneFloat + 0.5)) / this.LANES;
  }
  move(dir) {
    if (this.state !== 'racing' || !this.player || !this.player.alive) return;
    const p = this.player;
    const nl = clamp(Math.round(p.lane) + dir, 0, this.LANES - 1);
    if (nl !== Math.round(p.lane) || p.lane !== nl) {
      p.lane = nl; this.audio.lane();
      this.parts.dust(p.x, p.y + 30, 4);
    }
  }
  start(nick) {
    this.audio.ensure(); this.audio.click(); this.audio.start(); this.audio.startEngine();
    if (nick) { this.name = nick.slice(0, 14); localStorage.setItem('gamarawy_name', this.name); }
    localStorage.setItem('gamarawy_car', this.carColor);
    this.net.name = this.name || 'سواق'; this.net.car = this.carColor;
    this.net.updatePresenceName();
    this.state = 'racing';
    this.scroll = 0; this.elapsed = 0; this.coins = [];
    this.traffic.reset(); this.parts.list = [];
    this.player = {
      lane: 1, laneF: 1, x: 0, y: this.H - 170,
      tilt: 0, alive: true, score: 0, dist: 0, coinsN: 0, nearN: 0, overN: 0,
      color: this.carColor, seed: rand(1, 999), invuln: 1.2
    };
    this.player.x = this.laneX(1);
    $('lobby').classList.add('hidden'); $('gameover').classList.add('hidden');
    $('hud').classList.remove('hidden'); $('liveTag').classList.remove('hidden');
    if (window.innerWidth < 700 || 'ontouchstart' in window) $('touchControls').classList.remove('hidden');
    this.bigMsg('السباق بدأ!');
    this.coinTimer = 2.5;
  }
  gameOver(reason) {
    if (!this.player || !this.player.alive) return;
    this.player.alive = false;
    this.audio.crash(); this.audio.stopEngine();
    this.shake = 14; this.parts.spark(this.player.x, this.player.y, 22);
    this.state = 'over-anim';
    this.overTimer = 1.1; this.overReason = reason;
    this.bigMsg(reason === 'crash' ? 'متخبطش!' : 'وصلت!');
  }
  finishOver() {
    this.state = 'over';
    const p = this.player;
    const rank = this.liveRank();
    $('overScore').textContent = ar(Math.floor(p.score));
    $('overDist').textContent = ar(Math.floor(p.dist)) + ' م';
    $('overRank').textContent = '#' + ar(rank);
    const isRec = Math.floor(p.score) > this.best;
    if (isRec) { this.best = Math.floor(p.score); localStorage.setItem('gamarawy_best', String(this.best)); }
    $('overBest').textContent = ar(this.best);
    $('newRecord').classList.toggle('hidden', !isRec);
    if (isRec) this.audio.fanfare();
    $('overKicker').textContent = this.overReason === 'crash' ? 'خبطت يا معلم…' : 'سباق جميل!';
    $('overTitle').textContent = isRec ? 'رقم جديد! عاش!' : (p.score > 1500 ? 'سواقة معلمين!' : 'المرة الجاية أحسن!');
    $('gameover').classList.remove('hidden');
    $('touchControls').classList.add('hidden');
    this.net.removeRace();
    this.net.submitScore(p.score, p.dist).then(() => refreshBoards());
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
  popup(text, x, y, big = false) {
    const d = document.createElement('div');
    d.className = 'pop' + (big ? ' big' : ''); d.textContent = text;
    d.style.right = x + '%'; d.style.top = y + '%';
    d.style.transform = `rotate(${rand(-6, 6)}deg)`;
    $('popups').appendChild(d);
    setTimeout(() => d.remove(), 1050);
  }
  syncNet() {
    if (this.state !== 'racing' || !this.player) return;
    this.net.pushRace({
      score: this.player.score, dist: this.player.dist,
      lane: Math.round(this.player.laneF), fx: (this.player.laneF + 0.5) / this.LANES,
      alive: this.player.alive
    });
  }
  setRemotes(m) { this.remotes = m; }
  setOnline(n) {
    $('onlineCount').textContent = ar(n || 1);
    $('liveCount').textContent = ar(n || 1);
  }
  /* ---------- update ---------- */
  update(dt) {
    if (this.state === 'racing' && this.player) {
      const p = this.player;
      this.elapsed += dt;
      const base = 250 + Math.min(270, this.elapsed * 4.2);
      this.speed = p.alive ? base : 0;
      this.scroll += this.speed * dt;
      this.audio.engineSpeed(this.speed);
      // lane smooth + tilt + bounce
      const targetX = this.laneX(p.lane);
      const prevX = p.x;
      p.laneF = lerp(p.laneF, p.lane, 1 - Math.pow(0.001, dt));
      p.x = this.laneX(p.laneF);
      p.tilt = clamp((p.x - prevX) * 0.012, -0.28, 0.28);
      this.bounce += dt * (6 + this.speed * 0.012);
      if (p.invuln > 0) p.invuln -= dt;
      // score: distance trickle
      const gain = this.speed * dt * 0.045;
      p.dist += this.speed * dt * 0.055;
      p.score += gain;
      // traffic
      this.traffic.update(dt, this.LANES, this.speed, this.elapsed);
      // coins
      this.coinTimer -= dt;
      if (this.coinTimer <= 0) {
        this.coinTimer = rand(1.6, 3.4);
        this.coins.push({ lane: randi(0, 3), y: -40, seed: rand(1, 99), t: 0 });
      }
      for (const c of this.coins) { c.y += this.speed * dt; c.t += dt; }
      this.coins = this.coins.filter((c) => c.y < this.H + 40);
      // coin pickup
      for (const c of this.coins) {
        const cx = this.laneX(c.lane);
        if (!c.taken && Math.abs(c.y - p.y) < 42 && Math.abs(cx - p.x) < 34) {
          c.taken = true; p.score += 50; p.coinsN++;
          this.audio.coin(); this.parts.coinFx(cx, c.y);
          this.popup('كسبت نقط! +٥٠', 38, 55);
        }
      }
      this.coins = this.coins.filter((c) => !c.taken);
      this.wheel += dt * (this.speed * 0.02);
      // collisions + near miss + overtake
      const pw = 42, ph = 76;
      for (const t of this.traffic.list) {
        const tx = this.laneX(t.fx * this.LANES - 0.5);
        const dx = Math.abs(tx - p.x), dy = Math.abs(t.y - p.y);
        const overlapX = dx < (pw + t.w) / 2 - 8;
        const overlapY = dy < (ph + t.h) / 2 - 10;
        if (p.invuln <= 0 && overlapX && overlapY) { this.gameOver('crash'); break; }
        // near miss: just passed
        if (!t.counted && t.prevY < p.y && t.y >= p.y && !overlapX && dx < (pw + t.w) / 2 + 22) {
          t.counted = true; p.score += 100; p.nearN++;
          this.audio.near(); this.popup('ياااه! +١٠٠', 30, 40, true);
          this.parts.dust(p.x, p.y, 6);
        } else if (!t.counted && t.y > p.y + 120) {
          t.counted = true;
          // clean overtake
          if (dx > (pw + t.w) / 2) { p.score += 25; p.overN++; }
        }
      }
      // dust
      if (Math.random() < dt * 22) this.parts.dust(p.x + rand(-10, 10), p.y + 36, 1);
      this.parts.update(dt);
      if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 30);
      // HUD
      $('hudScore').textContent = ar(Math.floor(p.score));
      $('hudDist').textContent = ar(Math.floor(p.dist)) + ' م';
      $('hudRank').textContent = '#' + ar(this.liveRank());
    } else if (this.state === 'over-anim') {
      this.overTimer -= dt;
      this.scroll += this.speed * dt * 0.3;
      this.speed = Math.max(0, this.speed - dt * 400);
      this.parts.update(dt);
      if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 30);
      if (this.overTimer <= 0) this.finishOver();
    } else {
      // lobby idle: slow cruise for background life
      this.scroll += 90 * dt;
      this.elapsed += dt;
      this.parts.update(dt);
    }
  }
  /* ---------- render ---------- */
  loop(t) {
    if (!this._last) this._last = t;
    let dt = (t - this._last) / 1000; this._last = t;
    dt = clamp(dt, 0, 0.05);
    this.update(dt);
    this.render();
    requestAnimationFrame(this.loop);
  }
  render() {
    const ctx = this.ctx, W = this.W, H = this.H;
    ctx.save();
    if (this.shake > 0) ctx.translate(rand(-this.shake, this.shake) * 0.5, rand(-this.shake, this.shake) * 0.5);
    this.drawStreet(ctx, W, H);
    this.drawCoins(ctx);
    this.drawTraffic(ctx);
    this.drawRemotes(ctx);
    if (this.player && (this.state === 'racing' || this.state === 'over-anim')) this.drawPlayer(ctx);
    this.parts.draw(ctx);
    // paper vignette
    const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.36, W / 2, H / 2, H * 0.75);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(42,32,24,.20)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
  drawStreet(ctx, W, H) {
    const { roadW, roadL, roadR } = this.roadGeom();
    // base sand
    ctx.fillStyle = '#e3d0a3'; ctx.fillRect(0, 0, W, H);
    // side texture speckles (cheap, stable via hash grid)
    ctx.fillStyle = 'rgba(42,32,24,.06)';
    const sp = 46;
    const yoff = this.scroll % sp;
    for (let y = -sp; y < H + sp; y += sp) {
      const row = Math.floor((y + this.scroll) / sp);
      for (let x = 8; x < W; x += sp) {
        if (hash(row * 7.3 + x) > 0.72) { ctx.fillRect(x + hash(row + x) * 10, y + yoff * 0 + hash(x + row) * 14, 3, 2); }
      }
    }
    const segH = 230;
    const start = Math.floor(this.scroll / segH) - 1;
    const end = start + Math.ceil(H / segH) + 3;
    for (let i = start; i < end; i++) {
      const y = i * segH - this.scroll + (H % segH);
      // buildings both sides
      this.drawSideBlock(ctx, 0, roadL, y, segH, i, -1, W);
      this.drawSideBlock(ctx, roadR, W, y, segH, i, 1, W);
    }
    // sidewalks
    const sw = 26;
    ctx.fillStyle = '#d9c193';
    ctx.fillRect(roadL - sw, 0, sw, H); ctx.fillRect(roadR, 0, sw, H);
    ctx.strokeStyle = 'rgba(42,32,24,.35)'; ctx.lineWidth = 2;
    ctx.strokeRect(roadL - sw, -4, sw, H + 8); ctx.strokeRect(roadR, -4, sw, H + 8);
    // painted curb blocks (imperfect red/white)
    const bh = 30;
    for (let y = -(this.scroll % (bh * 2)); y < H; y += bh) {
      const idx = Math.floor((y + this.scroll) / bh);
      ctx.fillStyle = idx % 2 ? '#c94f43' : '#f6ecd4';
      const wob = (hash(idx * 3.1) - 0.5) * 3;
      ctx.fillRect(roadL - 9 + wob, y, 9, bh - 2);
      ctx.fillRect(roadR - wob, y, 9, bh - 2);
      ctx.strokeStyle = '#2a2018'; ctx.lineWidth = 1.5;
      ctx.strokeRect(roadL - 9 + wob, y, 9, bh - 2);
      ctx.strokeRect(roadR - wob, y, 9, bh - 2);
    }
    // asphalt
    ctx.fillStyle = '#5c5966'; ctx.fillRect(roadL, 0, roadW, H);
    ctx.fillStyle = 'rgba(0,0,0,.10)';
    for (let y = 0; y < H; y += 90) ctx.fillRect(roadL, y + hash(y) * 20, roadW, 2);
    // edge lines (wobbly)
    ctx.strokeStyle = '#f0e6c8'; ctx.lineWidth = 4;
    for (const ex of [roadL + 7, roadR - 7]) {
      ctx.beginPath();
      for (let y = -20; y <= H + 20; y += 40) {
        const x = ex + (hash(y * 0.7 + ex) - 0.5) * 3;
        y === -20 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    // lane dashes (hand dashes)
    ctx.fillStyle = '#f0e6c8';
    const dashH = 34, gap = 30;
    for (let l = 1; l < this.LANES; l++) {
      const x = roadL + (roadW * l) / this.LANES;
      for (let y = -((this.scroll * 1) % (dashH + gap)); y < H + dashH; y += dashH + gap) {
        const wob = (hash(y * 1.3 + l * 50 + Math.floor(this.scroll / (dashH + gap))) - 0.5) * 4;
        const hh = dashH + (hash(y + l) - 0.5) * 8;
        ctx.save(); ctx.translate(x + wob, y); ctx.rotate((hash(l * 9 + y) - 0.5) * 0.06);
        ctx.fillRect(-3, 0, 6, hh);
        ctx.restore();
      }
    }
    // occasional painted arrow + oil stain
    const ay = H - ((this.scroll * 1) % 520) - 60;
    ctx.save(); ctx.globalAlpha = 0.5; ctx.fillStyle = '#f0e6c8';
    ctx.translate(roadL + roadW / 2, ay); ctx.rotate(0.02);
    ctx.beginPath(); ctx.moveTo(0, -22); ctx.lineTo(12, -6); ctx.lineTo(4, -6); ctx.lineTo(4, 18); ctx.lineTo(-4, 18); ctx.lineTo(-4, -6); ctx.lineTo(-12, -6); ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.fillStyle = 'rgba(20,16,12,.25)';
    ctx.beginPath(); ctx.ellipse(roadL + roadW * 0.3, (ay + 200) % H, 14, 7, 0.3, 0, 7); ctx.fill();
  }
  drawSideBlock(ctx, x0, x1, y, segH, idx, side, W) {
    const w = x1 - x0;
    if (w <= 0) return;
    const h1 = hash(idx * 12.7 + side * 3.3), h2 = hash(idx * 4.9 + side * 7.7), h3 = hash(idx * 9.1 + side);
    // building body
    const pal = ['#e8d9b5', '#dfc9a0', '#d8bfa5', '#cfd6c0'];
    ctx.fillStyle = pal[Math.floor(h1 * pal.length)];
    ctx.fillRect(x0 + 2, y + 4, w - 4, segH - 8);
    ctx.strokeStyle = '#2a2018'; ctx.lineWidth = 2.5;
    ctx.strokeRect(x0 + 2, y + 4, w - 4, segH - 8);
    // windows (uneven)
    ctx.fillStyle = '#4d5a6b';
    for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) {
      if (w < 60 && c > 0) continue;
      const wx = x0 + 10 + c * (w / 2 - 4) + (hash(idx + r * 5 + c * 9 + side) - 0.5) * 5;
      const wy = y + 22 + r * 62 + (hash(idx * 2 + r + c) - 0.5) * 6;
      const ww = 20 + hash(idx + c) * 8, wh = 26 + hash(idx + r) * 6;
      ctx.fillStyle = hash(idx + r + c + side) > 0.4 ? '#4d5a6b' : '#6b7c8f';
      ctx.fillRect(wx, wy, ww, wh);
      ctx.strokeStyle = '#2a2018'; ctx.lineWidth = 2; ctx.strokeRect(wx, wy, ww, wh);
      ctx.strokeStyle = 'rgba(42,32,24,.6)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(wx + ww / 2, wy); ctx.lineTo(wx + ww / 2, wy + wh); ctx.stroke();
      // tiny balcony on some
      if (hash(idx * 3 + r + c * 7) > 0.72) {
        ctx.strokeStyle = '#2a2018'; ctx.lineWidth = 2;
        ctx.strokeRect(wx - 3, wy + wh, ww + 6, 10);
        ctx.beginPath(); ctx.moveTo(wx, wy + wh + 10); ctx.lineTo(wx, wy + wh + 18); ctx.moveTo(wx + ww, wy + wh + 10); ctx.lineTo(wx + ww, wy + wh + 18); ctx.stroke();
      }
    }
    // shop at bottom of block every other segment
    if (idx % 2 === 0) {
      const sy = y + segH - 72;
      const shop = SHOPS[Math.abs(idx * side) % SHOPS.length];
      // awning stripes
      for (let s = 0; s < 5; s++) {
        ctx.fillStyle = s % 2 ? '#c96f3b' : '#f6ecd4';
        ctx.fillRect(x0 + 4 + s * ((w - 8) / 5), sy, (w - 8) / 5, 14);
      }
      ctx.strokeStyle = '#2a2018'; ctx.lineWidth = 2; ctx.strokeRect(x0 + 4, sy, w - 8, 14);
      // sign (slightly crooked)
      ctx.save();
      ctx.translate(x0 + w / 2, sy + 30); ctx.rotate((h2 - 0.5) * 0.07);
      ctx.fillStyle = '#f6ecd4'; ctx.strokeStyle = '#2a2018'; ctx.lineWidth = 2.5;
      const tw = ctx.measureText ? 0 : 0;
      ctx.fillRect(-w / 2 + 8, -11, w - 16, 22); ctx.strokeRect(-w / 2 + 8, -11, w - 16, 22);
      ctx.fillStyle = '#2a2018'; ctx.font = 'bold 11px "El Messiri", sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(shop.slice(0, 12), 0, 4);
      ctx.restore();
      // door
      ctx.fillStyle = '#2a2018'; ctx.fillRect(x0 + w / 2 - 9, sy + 42, 18, 26);
    }
    // tree or pole alternating
    const gy = y + 40 + h3 * 100;
    if (hash(idx + side * 13) > 0.5) {
      // tree: trunk + imperfect canopy
      const tx = x0 + w / 2 + (h2 - 0.5) * 20;
      ctx.strokeStyle = '#2a2018'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(tx, gy + 26); ctx.lineTo(tx + 2, gy + 6); ctx.stroke();
      ctx.fillStyle = '#7a8450';
      ctx.beginPath(); ctx.arc(tx, gy, 15 + h1 * 5, 0, 7); ctx.fill();
      ctx.strokeStyle = '#2a2018'; ctx.lineWidth = 2.5; ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,.2)';
      ctx.beginPath(); ctx.arc(tx - 5, gy - 5, 5, 0, 7); ctx.fill();
    } else {
      // utility pole + sagging wire
      const tx = x0 + w / 2;
      ctx.strokeStyle = '#2a2018'; ctx.lineWidth = 3.5;
      ctx.beginPath(); ctx.moveTo(tx, gy - 20); ctx.lineTo(tx + 1, gy + 40); ctx.stroke();
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(tx - 12, gy - 12); ctx.lineTo(tx + 12, gy - 14); ctx.stroke();
      ctx.strokeStyle = 'rgba(42,32,24,.55)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(0, gy - 14); ctx.quadraticCurveTo(W / 2, gy + 6, W, gy - 14); ctx.stroke();
    }
    // tiny pedestrian
    if (h3 > 0.35) {
      const px = x0 + 12 + h1 * (w - 24), py = y + 150 + h2 * 40 + Math.sin((this.scroll + idx * 50) * 0.02) * 3;
      ctx.fillStyle = '#2a2018';
      ctx.beginPath(); ctx.arc(px, py, 4, 0, 7); ctx.fill();
      ctx.fillRect(px - 3, py + 4, 6, 12);
    }
  }
  drawCoins(ctx) {
    for (const c of this.coins) {
      const x = this.laneX(c.lane), y = c.y;
      const bob = Math.sin(c.t * 6) * 2;
      ctx.save(); ctx.translate(x, y + bob); ctx.rotate(Math.sin(c.t * 3) * 0.12);
      ctx.fillStyle = 'rgba(30,23,16,.2)';
      ctx.beginPath(); ctx.ellipse(2, 12, 10, 4, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#e9b44c'; ctx.strokeStyle = '#2a2018'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(0, 0, 11, 0, 7); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#9c4e24'; ctx.font = 'bold 12px "Aref Ruqaa", serif'; ctx.textAlign = 'center';
      ctx.fillText('ج', 0, 4.5);
      ctx.restore();
    }
  }
  drawTraffic(ctx) {
    for (const t of this.traffic.list) {
      const x = this.laneX(t.fx * this.LANES - 0.5) + Math.sin(t.wob) * 1.5;
      drawCar(ctx, { x, y: t.y, w: t.w, h: t.h, color: t.color, type: t.type, seed: t.seed, wheelRot: this.wheel, tilt: Math.sin(t.wob) * 0.02 });
    }
  }
  drawRemotes(ctx) {
    if (!this.player) return;
    this.remotes.forEach((p) => {
      if (!p || p.a === 0) return;
      // smooth: fx lerp via stored display pos
      if (p._dx === undefined) { p._dx = p.fx; p._dy = 0; }
      p._dx = lerp(p._dx, p.fx ?? 0.5, 0.18);
      const targetDy = clamp(((p.d || 0) - this.player.dist) * 2.2, -420, 200);
      p._dy = lerp(p._dy, targetDy, 0.12);
      const x = this.laneX(clamp(p._dx, 0, 1) * this.LANES - 0.5);
      const y = this.player.y - p._dy - 190;
      if (y < -80 || y > this.H + 80) return;
      drawCar(ctx, { x, y, w: 44, h: 80, color: p.c || '#c94f43', type: 'sedan', seed: 7, tilt: 0, wheelRot: this.wheel });
      // name tag (paper label)
      const nm = String(p.n || 'سواق').slice(0, 12);
      ctx.save(); ctx.translate(x, y - 56); ctx.rotate(-0.03);
      ctx.font = 'bold 12px "El Messiri", sans-serif';
      const tw = ctx.measureText(nm).width + 18;
      ctx.fillStyle = '#f6ecd4'; ctx.strokeStyle = '#2a2018'; ctx.lineWidth = 2;
      ctx.beginPath();
      // hand tag
      const r = 8;
      ctx.moveTo(-tw / 2 + r, -11); ctx.lineTo(tw / 2 - r, -11); ctx.quadraticCurveTo(tw / 2, -11, tw / 2, -4);
      ctx.lineTo(tw / 2, 4); ctx.quadraticCurveTo(tw / 2, 11, tw / 2 - r, 11);
      ctx.lineTo(-tw / 2 + r, 11); ctx.quadraticCurveTo(-tw / 2, 11, -tw / 2, 4);
      ctx.lineTo(-tw / 2, -4); ctx.quadraticCurveTo(-tw / 2, -11, -tw / 2 + r, -11);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#2a2018'; ctx.textAlign = 'center'; ctx.fillText(nm, 0, 4);
      ctx.restore();
    });
  }
  drawPlayer(ctx) {
    const p = this.player;
    if (p.invuln > 0 && this.state === 'racing' && Math.floor(p.invuln * 10) % 2 === 0) return; // blink
    const bounceY = Math.sin(this.bounce) * 1.6;
    drawCar(ctx, {
      x: p.x, y: p.y + bounceY, w: 46, h: 84, color: p.color,
      type: 'sedan', seed: p.seed, tilt: p.tilt, wheelRot: this.wheel, isPlayer: true
    });
  }
}

/* ---------------- UI wiring ---------------- */
const audio = new AudioManager();
const net = new FirebaseManager();
const game = new Game(net, audio);

function refreshBoards() { loadMini(); loadBoard(currentTab); }
let currentTab = 'global';

async function loadMini() {
  const el = $('miniTop'); el.innerHTML = '<li>بيحمّل… ✎</li>';
  const top = await net.fetchTop('global');
  el.innerHTML = '';
  if (!top.length) el.innerHTML = '<li><span>لسه مفيش نتايج</span><span>كن أول واحد!</span></li>';
  top.slice(0, 5).forEach((e, i) => {
    const li = document.createElement('li');
    if (e.uid === net.uid) li.className = 'me';
    li.innerHTML = `<span>${ar(i + 1)}. ${escapeHtml(e.name || 'سواق')}</span><span>${ar(e.score || 0)}</span>`;
    el.appendChild(li);
  });
}
async function loadBoard(tab = 'global') {
  currentTab = tab;
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  const el = $('boardList'); el.innerHTML = '<li>بيحمّل المتصدرين…</li>';
  if (tab === 'you') {
    const best = +(localStorage.getItem('gamarawy_best') || 0);
    const nm = localStorage.getItem('gamarawy_name') || 'انت';
    el.innerHTML = `<li class="me"><span>${escapeHtml(nm)} (أحسن نتيجة)</span><span>${ar(best)}</span></li>
      <li><span>ترتيبك اللايف في آخر سباق</span><span>#${ar(game.liveRank())}</span></li>`;
    return;
  }
  const top = await net.fetchTop(tab);
  el.innerHTML = '';
  if (!top.length) el.innerHTML = '<li><span>مفيش نتايج لسه</span><span>—</span></li>';
  top.forEach((e, i) => {
    const medal = i === 0 ? '🥇 ' : i === 1 ? '🥈 ' : i === 2 ? '🥉 ' : '';
    const li = document.createElement('li');
    if (e.uid === net.uid) li.className = 'me';
    li.innerHTML = `<span>${medal}${ar(i + 1)}. ${escapeHtml(e.name || 'سواق')}</span><span>${ar(e.score || 0)} • ${ar(e.dist || 0)}م</span>`;
    el.appendChild(li);
  });
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// car color picker
const COLORS = ['#2e7ab8', '#c94f43', '#2f8f83', '#e9b44c', '#7a8450', '#8d4a7a'];
function buildCarDots() {
  const wrap = $('carColors'); wrap.innerHTML = '';
  COLORS.forEach((c) => {
    const b = document.createElement('button');
    b.className = 'car-dot' + (c === game.carColor ? ' sel' : '');
    b.style.background = c; b.setAttribute('aria-label', c);
    b.onclick = () => { audio.ensure(); audio.click(); game.carColor = c; localStorage.setItem('gamarawy_car', c); buildCarDots(); };
    wrap.appendChild(b);
  });
}

// events
$('btnPlay').onclick = () => {
  const v = $('nickInput').value.trim() || ('سواق' + ar(randi(10, 99)));
  game.start(v);
};
$('nickInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btnPlay').click(); e.stopPropagation(); });
$('btnRetry').onclick = () => { audio.click(); game.start(game.name); };
$('btnLobby').onclick = () => {
  audio.click();
  game.state = 'lobby';
  $('gameover').classList.add('hidden'); $('lobby').classList.remove('hidden');
  $('hud').classList.add('hidden'); $('touchControls').classList.add('hidden');
  $('lobbyBest').textContent = ar(game.best);
};
$('btnBoard').onclick = () => { audio.click(); $('boardDrawer').classList.remove('hidden'); loadBoard(currentTab); };
$('btnCloseBoard').onclick = () => { audio.click(); $('boardDrawer').classList.add('hidden'); };
$('miniRefresh').onclick = (e) => { e.stopPropagation(); loadMini(); };
document.querySelectorAll('.tab').forEach((b) => b.onclick = () => { audio.click(); loadBoard(b.dataset.tab); });
$('btnSound').onclick = () => {
  audio.ensure();
  audio.setMuted(!audio.muted);
  $('btnSound').textContent = audio.muted ? '🔇' : '🔊';
};
// first gesture unlocks audio
window.addEventListener('pointerdown', () => audio.ensure(), { once: true });

// init UI
$('btnSound').textContent = audio.muted ? '🔇' : '🔊';
$('nickInput').value = game.name || '';
$('lobbyBest').textContent = ar(game.best);
buildCarDots();

// net init
net.name = game.name || 'سواق'; net.car = game.carColor;
net.init(
  (m) => game.setRemotes(m),
  (n) => game.setOnline(n),
  (ok) => {
    $('connState').textContent = ok ? 'متصل • السباق أونلاين 🟢' : 'وضع الشارع المحلي (فيه سواقين تجريبيين) 🟡';
    loadMini();
  }
);
setTimeout(() => loadMini(), 2500);
