// ===== Animation: Schlüsselbilder (Keys), Überblenden, Posen =====
// Reine Rechenlogik ohne three.js, damit sie sich mit node testen lässt.
//
// Jede Figur hat sechs Spuren (Kanäle). Ein Key liegt auf einem Bild (f, 24 pro Sekunde) und hält einen Wert:
//   body   { p:[x,y,z], r:Grad, b:{ Knochen:[qx,qy,qz,qw] } }   Position, Drehung, Gelenke
//   head   { y, p, t, lx, ly }                                  Kopf drehen/nicken/neigen (Grad), Blick (-1…1)
//   brow / eye / mouth / talk   { Form: Stärke 0…1 }            Gesichts-Shapes, leer = neutral
// Quaternionen sind so gespeichert, als schaue die Figur nach +Z (linke Hand = +X). figure.js rechnet für VRM 0.x um.

export const FPS = 24;
export const CHANNELS = ['body', 'head', 'brow', 'eye', 'mouth', 'talk'];
export const CH_NAME = { body: 'Körper', head: 'Kopf & Blick', brow: 'Augenbrauen', eye: 'Augen', mouth: 'Mund', talk: 'Sprechen' };
export const FACE_CH = ['brow', 'eye', 'mouth', 'talk'];

// Knochen, die zur Körper-Spur gehören (Hals und Kopf gehören zur Kopf-Spur)
export const BODY_BONES = ['hips', 'spine', 'chest', 'leftShoulder', 'rightShoulder',
  'leftUpperArm', 'leftLowerArm', 'leftHand', 'rightUpperArm', 'rightLowerArm', 'rightHand',
  'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'rightUpperLeg', 'rightLowerLeg', 'rightFoot'];

// ---------- kleine Mathe ----------
const D2R = Math.PI / 180;
export const ease = u => u * u * (3 - 2 * u);
const lerp = (a, b, u) => a + (b - a) * u;
// Euler (Grad, Reihenfolge XYZ wie in three.js) → Quaternion
export function eulerQ(x = 0, y = 0, z = 0) {
  const c1 = Math.cos(x * D2R / 2), c2 = Math.cos(y * D2R / 2), c3 = Math.cos(z * D2R / 2);
  const s1 = Math.sin(x * D2R / 2), s2 = Math.sin(y * D2R / 2), s3 = Math.sin(z * D2R / 2);
  return [s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 + s1 * s2 * c3, c1 * c2 * c3 - s1 * s2 * s3];
}
export function slerp(a, b, u) {
  let [bx, by, bz, bw] = b, d = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (d < 0) { d = -d; bx = -bx; by = -by; bz = -bz; bw = -bw; }
  let k0 = 1 - u, k1 = u;
  if (d < .9995) { const th = Math.acos(d), s = Math.sin(th); k0 = Math.sin(k0 * th) / s; k1 = Math.sin(k1 * th) / s; }
  const q = [a[0] * k0 + bx * k1, a[1] * k0 + by * k1, a[2] * k0 + bz * k1, a[3] * k0 + bw * k1];
  const n = Math.hypot(...q) || 1; return q.map(v => v / n);
}
const ID = [0, 0, 0, 1];
const r4 = v => Math.round(v * 1e4) / 1e4;
export const roundQ = q => q.map(r4);

// ---------- Posen (Blick von vorn: linke Hand = +X, oben = +Y, vorn = +Z) ----------
// P: Drehungen als Euler-Grad. Arm links hängt bei z −72, rechts bei z +72. Bein nach vorn: x −, Knie beugen: x +.
const P = (o) => Object.fromEntries(Object.entries(o).map(([k, e]) => [k, roundQ(eulerQ(...e))]));
// AIM: Ober- und Unterarm (oder -bein) zeigen in eine Richtung. Leichter zu bauen als Winkel zu raten.
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = v => { const n = Math.hypot(...v) || 1; return v.map(x => x / n); };
export const qInv = q => [-q[0], -q[1], -q[2], q[3]];
export function qRot(q, v) {   // Vektor v mit q drehen
  const [x, y, z, w] = q, t = cross([x, y, z], v).map(c => 2 * c), u = cross([x, y, z], t);
  return [v[0] + w * t[0] + u[0], v[1] + w * t[1] + u[1], v[2] + w * t[2] + u[2]];
}
export function fromTo(a, b) {   // kürzeste Drehung von Richtung a nach b
  a = norm(a); b = norm(b); const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  if (d < -.9999) { const c = norm(cross(a, Math.abs(a[0]) < .9 ? [1, 0, 0] : [0, 1, 0])); return [...c, 0]; }
  return norm([...cross(a, b), 1 + d]);
}
function AIM(o) {
  const b = {};
  for (const [side, rest, up, low] of [['left', [1, 0, 0], 'UpperArm', 'LowerArm'], ['right', [-1, 0, 0], 'UpperArm', 'LowerArm'], ['left', [0, -1, 0], 'UpperLeg', 'LowerLeg'], ['right', [0, -1, 0], 'UpperLeg', 'LowerLeg']]) {
    const d = o[side + up]; if (!d) continue;
    const qU = fromTo(rest, d[0]); b[side + up] = roundQ(qU);
    if (d[1]) b[side + low] = roundQ(fromTo(rest, qRot(qInv(qU), d[1])));
  }
  return b;
}
const STAND_L = [[.35, -1, .02], [.25, -1, .14]], STAND_R = [[-.35, -1, .02], [-.25, -1, .14]];
export const POSES = {
  stehen:   { name: 'Stehen', icon: '🧍', b: AIM({ leftUpperArm: STAND_L, rightUpperArm: STAND_R }) },
  winken:   { name: 'Winken', icon: '👋', b: { ...AIM({ leftUpperArm: STAND_L, rightUpperArm: [[-1, .2, .3], [-.12, 1, .12]] }), ...P({ rightHand: [0, 0, -10] }) } },
  jubeln:   { name: 'Jubeln', icon: '🙌', b: P({ leftUpperArm: [0, -10, 60], rightUpperArm: [0, 10, -60], leftLowerArm: [0, 0, 25], rightLowerArm: [0, 0, -25], spine: [-6, 0, 0] }) },
  huefte:   { name: 'Hände an die Hüfte', icon: '💁', b: P({ leftUpperArm: [0, 15, -50], leftLowerArm: [0, -20, -80], rightUpperArm: [0, -15, 50], rightLowerArm: [0, 20, 80] }) },
  denken:   { name: 'Nachdenken', icon: '🤔', b: { ...AIM({ rightUpperArm: [[-.15, -.7, .65], [.45, .85, -.1]], leftUpperArm: [[.25, -.85, .45], [-.95, 0, .3]] }), ...P({ rightHand: [0, 0, 25], spine: [4, 0, 0] }) } },
  zeigen:   { name: 'Zeigen', icon: '👉', b: AIM({ leftUpperArm: STAND_L, rightUpperArm: [[-.15, .05, 1], [-.15, .05, 1]] }) },
  zucken:   { name: 'Schulterzucken', icon: '🤷', b: { ...AIM({ leftUpperArm: [[.35, -1, -.1], [.5, .25, 1]], rightUpperArm: [[-.35, -1, -.1], [-.5, .25, 1]] }), ...P({ leftShoulder: [0, 0, 14], rightShoulder: [0, 0, -14] }) } },
  schreck:  { name: 'Erschrocken', icon: '😱', b: P({ leftUpperArm: [0, -45, -15], rightUpperArm: [0, 45, 15], leftLowerArm: [0, -70, 35], rightLowerArm: [0, 70, -35], spine: [-8, 0, 0] }) },
  verbeugen:{ name: 'Verbeugen', icon: '🙇', b: P({ spine: [28, 0, 0], chest: [12, 0, 0], leftUpperArm: [0, 0, -80], rightUpperArm: [0, 0, 80] }) },
  laufen:   { name: 'Schritt', icon: '🚶', b: P({ leftUpperLeg: [-25, 0, 0], leftLowerLeg: [12, 0, 0], rightUpperLeg: [20, 0, 0], rightLowerLeg: [35, 0, 0], rightFoot: [-10, 0, 0],
    leftUpperArm: [0, 25, -75], rightUpperArm: [0, 25, 75], leftLowerArm: [0, -20, 0], rightLowerArm: [0, 20, 0] }) },
  rennen:   { name: 'Rennen', icon: '🏃', b: P({ spine: [12, 0, 0], leftUpperLeg: [-55, 0, 0], leftLowerLeg: [60, 0, 0], rightUpperLeg: [25, 0, 0], rightLowerLeg: [70, 0, 0],
    leftUpperArm: [0, 45, -70], rightUpperArm: [0, 50, 70], leftLowerArm: [0, -80, 0], rightLowerArm: [0, 85, 0] }) },
  kreuzen:  { name: 'Arme verschränken', icon: '🙅', b: AIM({ leftUpperArm: [[.3, -.9, .3], [-.95, .2, .25]], rightUpperArm: [[-.3, -.9, .32], [.95, .2, .34]] }) },
};

// Spiegeln: links ↔ rechts tauschen, Drehungen an der Mittelebene spiegeln
const SWAP = n => n.startsWith('left') ? 'right' + n.slice(4) : n.startsWith('right') ? 'left' + n.slice(5) : n;
export function mirrorBones(b) { const o = {}; for (const k in b) { const q = b[k]; o[SWAP(k)] = [q[0], -q[1], -q[2], q[3]]; } return o; }

// ---------- Gesicht ----------
// Formen je Spur. m = Name des VRoid-Shapes (Fcl_…), x = Ersatz-Ausdruck für andere VRM-Figuren.
export const FACE = {
  brow: [
    { id: 'Joy', name: 'froh', m: 'BRW_Joy' }, { id: 'Fun', name: 'locker', m: 'BRW_Fun' }, { id: 'Angry', name: 'wütend', m: 'BRW_Angry' },
    { id: 'Sorrow', name: 'traurig', m: 'BRW_Sorrow' }, { id: 'Surprised', name: 'hoch', m: 'BRW_Surprised' }],
  eye: [
    { id: 'Close', name: 'zu', m: 'EYE_Close', x: 'blink' }, { id: 'Close_R', name: 'zwinkern', m: 'EYE_Close_R', x: 'blinkRight' },
    { id: 'Close_L', name: 'zwinkern', m: 'EYE_Close_L', x: 'blinkLeft' }, { id: 'Joy', name: 'lachend', m: 'EYE_Joy' },
    { id: 'Angry', name: 'böse', m: 'EYE_Angry' }, { id: 'Sorrow', name: 'traurig', m: 'EYE_Sorrow' }, { id: 'Surprised', name: 'groß', m: 'EYE_Surprised' }],
  mouth: [
    { id: 'Joy', name: 'lachen', m: 'MTH_Joy', x: 'happy' }, { id: 'Fun', name: 'lächeln', m: 'MTH_Fun', x: 'relaxed' },
    { id: 'Up', name: 'Winkel hoch', m: 'MTH_Up' }, { id: 'Down', name: 'Winkel runter', m: 'MTH_Down' },
    { id: 'Angry', name: 'wütend', m: 'MTH_Angry', x: 'angry' }, { id: 'Sorrow', name: 'traurig', m: 'MTH_Sorrow', x: 'sad' },
    { id: 'Surprised', name: 'staunen', m: 'MTH_Surprised', x: 'surprised' }],
  talk: [
    { id: 'A', name: 'A', m: 'MTH_A', x: 'aa' }, { id: 'I', name: 'I', m: 'MTH_I', x: 'ih' }, { id: 'U', name: 'U', m: 'MTH_U', x: 'ou' },
    { id: 'E', name: 'E', m: 'MTH_E', x: 'ee' }, { id: 'O', name: 'O', m: 'MTH_O', x: 'oh' }],
};
// Ganze Gefühle = Brauen + Augen + Mund auf einmal (so sieht man, woraus ein Gesichtsausdruck besteht)
export const EMOTIONS = [
  { id: 'neutral', name: 'Neutral', icon: '😐', brow: {}, eye: {}, mouth: {} },
  { id: 'joy', name: 'Fröhlich', icon: '😄', brow: { Joy: 1 }, eye: { Joy: 1 }, mouth: { Joy: 1 } },
  { id: 'fun', name: 'Entspannt', icon: '🙂', brow: { Fun: 1 }, eye: {}, mouth: { Fun: 1 } },
  { id: 'angry', name: 'Wütend', icon: '😠', brow: { Angry: 1 }, eye: { Angry: 1 }, mouth: { Angry: 1 } },
  { id: 'sad', name: 'Traurig', icon: '😢', brow: { Sorrow: 1 }, eye: { Sorrow: 1 }, mouth: { Sorrow: 1 } },
  { id: 'surprised', name: 'Überrascht', icon: '😲', brow: { Surprised: 1 }, eye: { Surprised: 1 }, mouth: { Surprised: 1 } },
  { id: 'smug', name: 'Frech', icon: '😏', brow: { Angry: .35 }, eye: { Close_R: 1 }, mouth: { Up: 1 } },
  { id: 'scared', name: 'Ängstlich', icon: '😨', brow: { Sorrow: 1 }, eye: { Surprised: .8 }, mouth: { Surprised: .5, Down: .6 } },
];

// ---------- Projekt ----------
export const SLOT_X = [-0.85, 0, 0.85];
export function newFigure(slot, model) {
  const keys = Object.fromEntries(CHANNELS.map(c => [c, []]));
  keys.body.push({ f: 0, v: { p: [SLOT_X[slot] ?? 0, 0, 0], r: 0, b: structuredClone(POSES.stehen.b) } });
  return { slot, model, blink: true, size: 1, keys };
}
export function newProject() { return { v: 1, title: 'Mein Film', len: 10, place: 'klasse', figs: [], clips: [], voices: {} }; }

export const DEFAULT = { body: null, head: { y: 0, p: 0, t: 0, lx: 0, ly: 0 } };
const isFace = ch => FACE_CH.includes(ch);
export function defaultVal(ch, fig) {
  if (ch === 'body') return { p: [SLOT_X[fig.slot] ?? 0, 0, 0], r: 0, b: structuredClone(POSES.stehen.b) };
  if (ch === 'head') return { ...DEFAULT.head };
  return {};
}

// ---------- Keys ----------
export function findKey(keys, f) { return keys.find(k => k.f === f) || null; }
export function setKey(keys, f, v) {
  const k = findKey(keys, f); if (k) { k.v = v; return k; }
  const n = { f, v }; let i = keys.findIndex(x => x.f > f); if (i < 0) i = keys.length; keys.splice(i, 0, n); return n;
}
export function delKey(keys, f) { const i = keys.findIndex(k => k.f === f); if (i >= 0) keys.splice(i, 1); }
export function moveKey(keys, from, to) {
  const k = findKey(keys, from); if (!k || from === to) return;
  delKey(keys, to); k.f = to; keys.sort((a, b) => a.f - b.f);
}
// Alle Bilder, auf denen irgendeine Spur der Figur einen Key hat
export function keyFrames(fig, chans = CHANNELS) { const s = new Set(); for (const c of chans) for (const k of fig.keys[c]) s.add(k.f); return [...s].sort((a, b) => a - b); }

// ---------- Überblenden ----------
function mix(ch, a, b, u) {
  if (ch === 'body') {
    const bones = {}; const names = new Set([...Object.keys(a.b), ...Object.keys(b.b)]);
    for (const n of names) bones[n] = slerp(a.b[n] || ID, b.b[n] || ID, u);
    return { p: a.p.map((x, i) => lerp(x, b.p[i], u)), r: lerp(a.r, b.r, u), b: bones };
  }
  if (ch === 'head') { const o = {}; for (const k in a) o[k] = lerp(a[k], b[k] ?? 0, u); return o; }
  const o = {}; for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { const w = lerp(a[k] || 0, b[k] || 0, u); if (w > .001) o[k] = w; }
  return o;
}
// Wert einer Spur zur (gebrochenen) Bildzahl ft. Key mit s=1 („plötzlich“): bis zu ihm bleibt der alte Wert stehen.
export function evalCh(fig, ch, ft) {
  const keys = fig.keys[ch];
  if (!keys.length) return defaultVal(ch, fig);
  if (ft <= keys[0].f) return keys[0].v;
  const last = keys[keys.length - 1]; if (ft >= last.f) return last.v;
  let i = 1; while (keys[i].f < ft) i++;
  const a = keys[i - 1], b = keys[i];
  if (b.s) return a.v;
  return mix(ch, a.v, b.v, ease((ft - a.f) / (b.f - a.f)));
}
export function evalFig(fig, ft) { const o = {}; for (const c of CHANNELS) o[c] = evalCh(fig, c, ft); return o; }
export const cloneVal = v => structuredClone(v);
export { isFace };
