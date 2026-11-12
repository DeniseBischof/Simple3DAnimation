// ===== Ton: Geräusche, Stimmen-Aufnahme, eigene Musik, Lippen-Sync =====
// Clip im Projekt: { id, f (Startbild), src: 'fx:boing' | 'v:<id>', fig: Slot oder null, lip: true/false, vol }
// Stimme/Datei in project.voices[id]: { kind:'mic', sr, mu (8-Bit-µ-law, base64), dur } | { kind:'file', name, data (base64), dur }
import { FPS } from './anim.js';

let AC = null;
export function audio() {
  if (!AC) { const A = window.AudioContext || window.webkitAudioContext; if (!A) return null; AC = new A(); }
  if (AC.state === 'suspended') AC.resume();
  return AC;
}

// ---------- Geräusche (live erzeugt, keine Dateien nötig) ----------
function kit(ctx, dest) {
  const G = (v = 0) => { const g = ctx.createGain(); g.gain.value = v; return g; };
  const env = (g, t, a, peak, d) => { g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(.0001, t + a + d); };
  let NB = null; const noiseBuf = () => { if (!NB) { NB = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate); const d = NB.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; } return NB; };
  const noise = (t, dur) => { const s = ctx.createBufferSource(); s.buffer = noiseBuf(); s.loop = true; s.start(t); s.stop(t + dur); return s; };
  const osc = (type, fr, t, dur) => { const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(fr, t); o.start(t); o.stop(t + dur); return o; };
  const filt = (type, fr, q = 1) => { const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = fr; f.Q.value = q; return f; };
  const chain = (...n) => { for (let i = 0; i < n.length - 1; i++) n[i].connect(n[i + 1]); return n[n.length - 1]; };
  const tone = (type, fr, t, a, peak, d, to) => { const o = osc(type, fr, t, a + d + .05); if (to) o.frequency.exponentialRampToValueAtTime(to, t + a + d); const g = G(); env(g, t, a, peak, d); chain(o, g, dest); return o; };
  return { G, env, noise, osc, filt, chain, tone, dest };
}
const notes = (base, semis) => semis.map(s => base * Math.pow(2, s / 12));
export const FX = [
  { id: 'boing', name: 'Boing', icon: '🌀', dur: .7, fn(k, t) { const o = k.tone('sine', 520, t, .01, .5, .6, 110); const l = k.osc('sine', 18, t, .7), lg = k.G(40); l.connect(lg); lg.connect(o.frequency); } },
  { id: 'plopp', name: 'Plopp', icon: '🫧', dur: .2, fn(k, t) { k.tone('sine', 900, t, .004, .6, .12, 260); } },
  { id: 'wusch', name: 'Wusch', icon: '💨', dur: .7, fn(k, t) { const bp = k.filt('bandpass', 300, 3); bp.frequency.setValueAtTime(300, t); bp.frequency.exponentialRampToValueAtTime(3500, t + .35); bp.frequency.exponentialRampToValueAtTime(600, t + .65); const g = k.G(); k.env(g, t, .2, .8, .45); k.chain(k.noise(t, .7), bp, g, k.dest); } },
  { id: 'ding', name: 'Ding', icon: '🔔', dur: 2, fn(k, t) { for (const [r, v, d] of [[1, .35, 1.8], [2.76, .12, 1], [5.4, .06, .6]]) k.tone('sine', 1046 * r, t, .004, v, d); } },
  { id: 'klingel', name: 'Türklingel', icon: '🚪', dur: 1.6, fn(k, t) { k.tone('sine', 784, t, .005, .35, .7); k.tone('sine', 622, t + .5, .005, .35, 1); } },
  { id: 'klopf', name: 'Klopfen', icon: '✊', dur: .8, fn(k, t) { for (const s of [t, t + .22, t + .44]) { const lp = k.filt('lowpass', 900), g = k.G(); k.env(g, s, .003, .9, .08); k.chain(k.noise(s, .12), lp, g, k.dest); k.tone('sine', 140, s, .003, .5, .09, 70); } } },
  { id: 'schritte', name: 'Schritte', icon: '👣', dur: 1.8, fn(k, t) { for (let i = 0; i < 4; i++) { const s = t + i * .42, lp = k.filt('lowpass', 600), g = k.G(); k.env(g, s, .005, .7, .1); k.chain(k.noise(s, .16), lp, g, k.dest); k.tone('sine', 100, s, .005, .4, .1, 50); } } },
  { id: 'applaus', name: 'Applaus', icon: '👏', dur: 3, fn(k, t) { for (let i = 0; i < 90; i++) { const s = t + Math.pow(Math.random(), .8) * 2.6, bp = k.filt('bandpass', 1200 + Math.random() * 1800, 1.5), g = k.G(); k.env(g, s, .002, .25 + Math.random() * .2, .05); k.chain(k.noise(s, .08), bp, g, k.dest); } } },
  { id: 'tusch', name: 'Tusch', icon: '🥁', dur: 2.6, fn(k, t) {
    for (let i = 0; i < 22; i++) { const s = t + i * .05, bp = k.filt('bandpass', 2500, .8), g = k.G(); k.env(g, s, .002, .15 + i * .012, .04); k.chain(k.noise(s, .06), bp, g, k.dest); }
    const e = t + 1.15; for (const f of notes(262, [0, 4, 7, 12])) k.tone('sawtooth', f, e, .01, .07, 1.3);
    const hp = k.filt('highpass', 4000), g = k.G(); k.env(g, e, .003, .5, 1.2); k.chain(k.noise(e, 1.3), hp, g, k.dest); } },
  { id: 'magie', name: 'Magie', icon: '✨', dur: 1.6, fn(k, t) { notes(880, [0, 4, 7, 12, 16, 19, 24, 28]).forEach((f, i) => k.tone('sine', f, t + i * .07, .005, .16, .6)); } },
  { id: 'fail', name: 'Wah-wah', icon: '🎺', dur: 2.2, fn(k, t) { notes(392, [0, -1, -2]).forEach((f, i) => { const lp = k.filt('lowpass', 1200), o = k.osc('sawtooth', f, t + i * .45, .5), g = k.G(); k.env(g, t + i * .45, .03, .25, .4); k.chain(o, lp, g, k.dest); });
    const s = t + 1.35, o = k.osc('sawtooth', 330, s, .9); o.frequency.linearRampToValueAtTime(300, s + .8); const l = k.osc('sine', 6, s, .9), lg = k.G(8); l.connect(lg); lg.connect(o.frequency); const lp = k.filt('lowpass', 1100), g = k.G(); k.env(g, s, .03, .25, .8); k.chain(o, lp, g, k.dest); } },
  { id: 'handy', name: 'Handy', icon: '📱', dur: 2.2, fn(k, t) { for (let r = 0; r < 2; r++) for (let i = 0; i < 6; i++) k.tone('square', i % 2 ? 1320 : 1760, t + r * 1.1 + i * .08, .004, .08, .07); } },
  { id: 'donner', name: 'Donner', icon: '⛈️', dur: 3, fn(k, t) { const lp = k.filt('lowpass', 1400); lp.frequency.setValueAtTime(1400, t); lp.frequency.exponentialRampToValueAtTime(90, t + 2.4); const g = k.G(); k.env(g, t, .015, 1, 2.6); k.chain(k.noise(t, 2.8), lp, g, k.dest); } },
  { id: 'herz', name: 'Herzschlag', icon: '💓', dur: 2.4, fn(k, t) { for (let i = 0; i < 3; i++) for (const [dt, v] of [[0, .9], [.24, .55]]) k.tone('sine', 85, t + i * .8 + dt, .01, v, .22, 38); } },
  { id: 'mfroh', name: 'Musik: fröhlich', icon: '🎵', dur: 8, fn(k, t) {
    const prog = [[0, 4, 7], [5, 9, 12], [7, 11, 14], [0, 4, 7]];
    prog.forEach((ch, b) => { for (let i = 0; i < 8; i++) k.tone('triangle', notes(262, [ch[i % 3] + (i > 3 ? 12 : 0)])[0], t + b * 2 + i * .25, .01, .12, .22); k.tone('sine', notes(131, [ch[0]])[0], t + b * 2, .02, .25, 1.9); }); } },
  { id: 'mspannung', name: 'Musik: spannend', icon: '🎻', dur: 8, fn(k, t) {
    for (const f of [55, 82.4]) { const o = k.osc('sawtooth', f, t, 8), lp = k.filt('lowpass', 300, 4), g = k.G(); lp.frequency.setValueAtTime(200, t); lp.frequency.linearRampToValueAtTime(900, t + 7.5); g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.18, t + 2); g.gain.setValueAtTime(.18, t + 7.4); g.gain.exponentialRampToValueAtTime(.0001, t + 8); k.chain(o, lp, g, k.dest); }
    for (let i = 0; i < 16; i++) k.tone('sine', 55, t + i * .5, .01, .5, .2, 40); } },
  { id: 'mtraurig', name: 'Musik: traurig', icon: '🎹', dur: 8, fn(k, t) {
    [[9, 12, 16], [5, 9, 12], [0, 4, 7], [7, 11, 14]].forEach((ch, b) => { for (const s of ch) k.tone('sine', notes(220, [s])[0], t + b * 2, .3, .07, 1.7); k.tone('triangle', notes(440, [ch[2] + 3])[0], t + b * 2 + 1, .05, .06, .9); }); } },
];
export const FX_BY = Object.fromEntries(FX.map(f => [f.id, f]));

// ---------- µ-law (8 Bit) für Aufnahmen: klein und überall abspielbar ----------
const MU = Math.log1p(255);
const muEnc = x => (x < 0 ? 128 : 0) | Math.round(Math.log1p(255 * Math.min(1, Math.abs(x))) / MU * 127);
const muDec = b => (b & 128 ? -1 : 1) * (Math.pow(256, (b & 127) / 127) - 1) / 255;
const b64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192)); return btoa(s); };
const unb64 = b => { const s = atob(b), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };
export const SR = 22050, MAX_REC = 30;

// ---------- Puffer und Lippen-Daten (Zwischenspeicher, nicht im Projekt) ----------
const BUF = new Map(), LIP = new Map();
function decode(ctx, ab) { return new Promise((res, rej) => { try { const p = ctx.decodeAudioData(ab, res, rej); if (p && p.then) p.then(res, rej); } catch (e) { rej(e); } }); }
export async function bufferOf(id, v) {
  if (BUF.has(id)) return BUF.get(id);
  const ctx = audio(); let buf;
  if (v.kind === 'mic') { const u = unb64(v.mu); buf = ctx.createBuffer(1, u.length, v.sr); const d = buf.getChannelData(0); for (let i = 0; i < u.length; i++) d[i] = muDec(u[i]); }
  else buf = await decode(ctx, unb64(v.data).buffer);
  BUF.set(id, buf); LIP.set(id, analyse(buf)); return buf;
}
export const forget = id => { BUF.delete(id); LIP.delete(id); };

// Lautstärke und „Helligkeit“ (Nulldurchgänge) je Filmbild → wie weit der Mund aufgeht und welcher Vokal
function analyse(buf) {
  const sr = buf.sampleRate, n = buf.length, W = Math.round(sr / FPS), frames = Math.ceil(n / W);
  const chs = [...Array(buf.numberOfChannels)].map((_, i) => buf.getChannelData(i));
  const rms = new Float32Array(frames), zcr = new Float32Array(frames); let top = 0;
  for (let f = 0; f < frames; f++) {
    let s = 0, z = 0, prev = 0; const a = f * W, b = Math.min(n, a + W);
    for (let i = a; i < b; i++) { let x = 0; for (const c of chs) x += c[i]; x /= chs.length; s += x * x; if ((x >= 0) !== (prev >= 0)) z++; prev = x; }
    rms[f] = Math.sqrt(s / Math.max(1, b - a)); zcr[f] = z / Math.max(1, b - a); if (rms[f] > top) top = rms[f];
  }
  const open = new Float32Array(frames), vow = new Uint8Array(frames); let lv = 0;
  const zs = [...zcr].filter((_, i) => rms[i] > top * .15).sort((x, y) => x - y), q = p => zs.length ? zs[Math.floor(p * (zs.length - 1))] : 0;
  const z1 = q(.25), z2 = q(.5), z3 = q(.75);
  for (let f = 0; f < frames; f++) {
    const target = Math.max(0, Math.min(1, (rms[f] / (top || 1) - .1) / .55));
    lv += (target - lv) * (target > lv ? .8 : .45); open[f] = lv;
    vow[f] = zcr[f] < z1 ? 4 : zcr[f] < z2 ? 0 : zcr[f] < z3 ? 3 : 1;   // O, A, E, I
  }
  return { open, vow };
}
const VOW = ['A', 'I', 'U', 'E', 'O'];
// Mund-Formen einer Figur zur Zeit tSec aus allen ihren Stimmen-Clips (lip an)
export function lipAt(project, slot, tSec) {
  let best = null, w = 0;
  for (const c of project.clips) {
    if (c.fig !== slot || !c.lip || !c.src.startsWith('v:')) continue;
    const L = LIP.get(c.src.slice(2)); if (!L) continue;
    const i = Math.floor((tSec - c.f / FPS) * FPS); if (i < 0 || i >= L.open.length) continue;
    if (L.open[i] > w) { w = L.open[i]; best = VOW[L.vow[i]]; }
  }
  return best && w > .03 ? { [best]: w } : null;
}
export function clipDur(project, c) {
  if (c.src.startsWith('fx:')) return (FX_BY[c.src.slice(3)] || { dur: 1 }).dur;
  const v = project.voices[c.src.slice(2)]; return v ? v.dur : 1;
}
export function clipName(project, c) {
  if (c.src.startsWith('fx:')) { const f = FX_BY[c.src.slice(3)]; return f ? f.icon + ' ' + f.name : '?'; }
  const v = project.voices[c.src.slice(2)]; return v && v.kind === 'file' ? '🎵 ' + (v.name || 'Datei') : '🎙 Stimme';
}

// ---------- Abspielen ----------
// Spielt alle Clips ab startSec. Gibt eine Stopp-Funktion zurück.
export function playClips(project, startSec, ctx = audio(), dest = null) {
  if (!ctx) return () => {};
  const bus = ctx.createGain(); bus.connect(dest || ctx.destination);
  const t0 = ctx.currentTime + .05, srcs = [];
  for (const c of project.clips) {
    const at = c.f / FPS - startSec, vol = c.vol ?? 1;
    const g = ctx.createGain(); g.gain.value = vol; g.connect(bus);
    if (c.src.startsWith('fx:')) {
      const fx = FX_BY[c.src.slice(3)]; if (!fx || at < -.05) continue;
      try { fx.fn(kit(ctx, g), t0 + Math.max(0, at)); } catch (e) {}
    } else {
      const id = c.src.slice(2), buf = BUF.get(id); if (!buf || at + buf.duration < 0) continue;
      const s = ctx.createBufferSource(); s.buffer = buf; s.connect(g); s.start(t0 + Math.max(0, at), Math.max(0, -at)); srcs.push(s);
    }
  }
  return () => { for (const s of srcs) try { s.stop(); } catch (e) {} try { bus.disconnect(); } catch (e) {} };
}
export function previewFx(id) { const ctx = audio(), fx = FX_BY[id]; if (!ctx || !fx) return; const g = ctx.createGain(); g.connect(ctx.destination); fx.fn(kit(ctx, g), ctx.currentTime + .02); }
export async function previewVoice(id, v) { const ctx = audio(), b = await bufferOf(id, v); const s = ctx.createBufferSource(); s.buffer = b; s.connect(ctx.destination); s.start(); return () => { try { s.stop(); } catch (e) {} }; }

// ---------- Aufnehmen ----------
export function micProblem() {
  if (window.isSecureContext === false) return 'Das Mikrofon geht nur über https:// (GitHub Pages) oder localhost.';
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) return 'Dieser Browser kann nicht aufnehmen.';
  return '';
}
export async function startRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  const M = window.MediaRecorder, type = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'].find(t => { try { return M.isTypeSupported(t); } catch (e) { return false; } });
  const rec = new M(stream, type ? { mimeType: type } : undefined), chunks = [];
  rec.ondataavailable = e => e.data.size && chunks.push(e.data);
  rec.start(250);
  const timer = setTimeout(() => rec.state === 'recording' && rec.stop(), MAX_REC * 1000);
  return {
    stop: () => new Promise(res => {
      rec.onstop = async () => { clearTimeout(timer); stream.getTracks().forEach(t => t.stop()); try { res(await toVoice(await new Blob(chunks).arrayBuffer())); } catch (e) { res(null); } };
      if (rec.state === 'recording') rec.stop(); else rec.onstop();
    }),
  };
}
// Entpacken, auf 22 kHz mono bringen, Stille vorn/hinten weg, lauter machen, als µ-law speichern
async function toVoice(ab) {
  let buf; const O = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  try { buf = await decode(new O(1, 1, SR), ab.slice(0)); } catch (e) { buf = await decode(audio(), ab); }
  const n = buf.length, x = new Float32Array(n);
  for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < n; i++) x[i] += d[i] / buf.numberOfChannels; }
  let y = x, sr = buf.sampleRate;
  if (sr !== SR) { const k = sr / SR, m = Math.floor(n / k); y = new Float32Array(m); for (let i = 0; i < m; i++) y[i] = x[Math.floor(i * k)]; sr = SR; }
  const W = 256; let top = 0; const win = []; for (let i = 0; i < y.length; i += W) { let s = 0; for (let j = i; j < Math.min(y.length, i + W); j++) s += y[j] * y[j]; const r = Math.sqrt(s / W); win.push(r); if (r > top) top = r; }
  if (top < .003) return null;
  let a = 0, b = win.length - 1; while (a < b && win[a] < top * .08) a++; while (b > a && win[b] < top * .08) b--;
  const s0 = Math.max(0, (a - 3) * W), s1 = Math.min(y.length, (b + 8) * W), z = y.slice(s0, s1);
  let pk = 0; for (const v of z) pk = Math.max(pk, Math.abs(v)); const g = Math.min(.9 / (pk || 1), 30);
  const u = new Uint8Array(z.length); for (let i = 0; i < z.length; i++) u[i] = muEnc(z[i] * g);
  return { kind: 'mic', sr, mu: b64(u), dur: Math.round(z.length / sr * 100) / 100, lead: s0 / sr };   // lead: abgeschnittene Stille vorn
}
// Eigene Musik oder Geräusch-Datei (mp3, m4a, wav): Datei unverändert speichern, damit nichts schlechter klingt
export async function fileToVoice(file) {
  if (file.size > 8e6) throw { code: 'big' };
  const ab = await file.arrayBuffer(), buf = await decode(audio(), ab.slice(0));
  return { kind: 'file', name: file.name.replace(/\.[^.]+$/, '').slice(0, 30), data: b64(new Uint8Array(ab)), dur: Math.round(buf.duration * 100) / 100 };
}

// ---------- Stimmeffekte ----------
// Der Effekt wird einmal fertig gerechnet (OfflineAudioContext) und als neue Aufnahme gespeichert; das Original bleibt in
// v.raw, damit man jederzeit umschalten kann. Abspielen, Video und Mundbewegung nutzen danach einfach die bearbeitete Fassung.
export const VOICE_FX = [
  { id: 'normal', name: 'Normal', icon: '🙂' }, { id: 'roboter', name: 'Roboter', icon: '🤖' }, { id: 'monster', name: 'Monster', icon: '👹' },
  { id: 'maus', name: 'Mickymaus', icon: '🐭' }, { id: 'echo', name: 'Echo', icon: '🏔️' }, { id: 'geist', name: 'Geist', icon: '👻' },
  { id: 'radio', name: 'Radio', icon: '📻' }, { id: 'alien', name: 'Alien', icon: '👽' }, { id: 'verzerrt', name: 'Verzerrt', icon: '⚡' },
];
const muToBuf = (ctx, mu, sr) => { const u = unb64(mu), b = ctx.createBuffer(1, u.length, sr), d = b.getChannelData(0); for (let i = 0; i < u.length; i++) d[i] = muDec(u[i]); return b; };
function curve(k) { const c = new Float32Array(1024); for (let i = 0; i < 1024; i++) { const x = i / 1023 * 2 - 1; c[i] = Math.tanh(x * k) / Math.tanh(k); } return c; }
function reverbIR(ctx, sec, decay) { const n = Math.floor(ctx.sampleRate * sec), b = ctx.createBuffer(2, n, ctx.sampleRate); for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay); } return b; }
export async function applyVoiceFx(v, fx) {
  const raw = v.raw || v.mu, O = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (fx === 'normal') return { ...v, mu: raw, raw, fx, dur: Math.round(unb64(raw).length / v.sr * 100) / 100 };
  const rate = { maus: 1.45, monster: .72, alien: 1.15 }[fx] || 1, tail = { echo: 1.6, geist: 2.2, alien: .8 }[fx] || .1;
  const srcLen = unb64(raw).length / v.sr, len = Math.ceil((srcLen / rate + tail) * v.sr), ctx = new O(1, len, v.sr);
  const src = ctx.createBufferSource(); src.buffer = muToBuf(ctx, raw, v.sr); src.playbackRate.value = rate;
  const out = ctx.createGain(); out.connect(ctx.destination);
  const lp = f => { const n = ctx.createBiquadFilter(); n.type = 'lowpass'; n.frequency.value = f; return n; }, bp = (f, q) => { const n = ctx.createBiquadFilter(); n.type = 'bandpass'; n.frequency.value = f; n.Q.value = q; return n; };
  const shaper = k => { const n = ctx.createWaveShaper(); n.curve = curve(k); return n; }, ring = hz => { const g = ctx.createGain(); g.gain.value = 0; const o = ctx.createOscillator(); o.frequency.value = hz; o.connect(g.gain); o.start(); return g; };
  const echo = (t, fb, wet) => { const d = ctx.createDelay(2); d.delayTime.value = t; const f = ctx.createGain(); f.gain.value = fb; const w = ctx.createGain(); w.gain.value = wet; d.connect(f); f.connect(d); d.connect(w); return [d, w]; };
  if (fx === 'roboter') { const r = ring(55), s = shaper(2.5); src.connect(r); r.connect(s); s.connect(out); const [d, w] = echo(.03, .5, .4); s.connect(d); w.connect(out); }
  else if (fx === 'monster') { const s = shaper(3), f = lp(1400); src.connect(s); s.connect(f); f.connect(out); }
  else if (fx === 'maus') { src.connect(out); }
  else if (fx === 'echo') { src.connect(out); const [d, w] = echo(.28, .45, .6); src.connect(d); w.connect(out); }
  else if (fx === 'geist') {
    const c = ctx.createConvolver(); c.buffer = reverbIR(ctx, 2.2, 2.5); const wet = ctx.createGain(), dry = ctx.createGain(); wet.gain.value = .9; dry.gain.value = .5;
    const trem = ctx.createGain(), lfo = ctx.createOscillator(), depth = ctx.createGain(); lfo.frequency.value = 5.5; depth.gain.value = .35; trem.gain.value = .65; lfo.connect(depth); depth.connect(trem.gain); lfo.start();
    src.connect(trem); trem.connect(dry); trem.connect(c); c.connect(wet); dry.connect(out); wet.connect(out);
  }
  else if (fx === 'radio') { const b = bp(1500, 1.2), s = shaper(4); src.connect(b); b.connect(s); s.connect(out); out.gain.value = .7; }
  else if (fx === 'alien') { const r = ring(170), dry = ctx.createGain(); dry.gain.value = .35; src.connect(r); src.connect(dry); dry.connect(out); r.connect(out); const [d, w] = echo(.12, .35, .35); r.connect(d); w.connect(out); }
  else if (fx === 'verzerrt') { const s = shaper(12), f = lp(3800); src.connect(s); s.connect(f); f.connect(out); out.gain.value = .6; }
  src.start();
  const res = await ctx.startRendering(), d = res.getChannelData(0); let pk = 0; for (const x of d) pk = Math.max(pk, Math.abs(x));
  const g = pk > 0 ? Math.min(.9 / pk, 4) : 1, u = new Uint8Array(d.length); for (let i = 0; i < d.length; i++) u[i] = muEnc(d[i] * g);
  return { ...v, mu: b64(u), raw, fx, dur: Math.round(d.length / v.sr * 100) / 100 };
}
