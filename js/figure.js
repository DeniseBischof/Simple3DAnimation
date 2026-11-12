// ===== Figuren: VRM laden, Gesicht und Gelenke setzen, Gelenk-Griffe =====
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { BODY_BONES, FACE, FACE_CH, eulerQ } from './anim.js';

// Die eingebauten Figuren, alle CC0 (siehe README.md).
// anime: VRoid-Beispielfiguren von pixiv, volles Gesicht (Brauen, Augen, Mund einzeln).
// wesen: 100Avatars Reihe 3 von Polygonal Mind, Gefühle wirken aufs ganze Gesicht, dazu Sprechen und Blinzeln.
// eigen: selbst zusammengestellt aus Gesicht, Frisur und Outfit verschiedener VRoid-Figuren (siehe loadCustom).
const A = (id, name) => ({ id, name, kind: 'anime' }), W = (id, name) => ({ id, name, kind: 'wesen' });
const E = (id, name, look) => ({ id, name, kind: 'eigen', look });
export const MODELS = [
  E('eigen1', 'Eigene 1', { outfit: 'kaito', face: 'fumiriya', hair: 'basis', hairColor: '#3b2a20', skin: null }),
  E('eigen2', 'Eigene 2', { outfit: 'kaito', face: 'shibu', hair: 'vivi', hairColor: '#1d1b22', skin: '#d9a882' }),
  A('fumiriya', 'Haru'), A('kaito', 'Kaito'), A('hiro', 'Hiro'), A('yuki', 'Yuki'), A('shibu', 'Aiko'), A('shino', 'Nami'), A('sakura', 'Sakura'), A('mika', 'Mika'),
  A('darkshibu', 'Rin'), A('victoria', 'Hana'), A('vivi', 'Momo'),
  W('tiger', 'Tiger'), W('fuchs', 'Füchsin'), W('hai', 'Hai'), W('kiba', 'Kiba'), W('katze', 'Katze'), W('nekomata', 'Nekomata'),
  W('dino', 'Dino'), W('hoernchen', 'Eichhörnchen'), W('biene', 'Biene'), W('yeti', 'Yeti'), W('zyklop', 'Zyklop'), W('ziegengeist', 'Ziegengeist'),
  W('crowley', 'Kapuzenkater'), W('feuerauge', 'Feuerauge'), W('motte', 'Mottenkatze'),
  W('schlangenbot', 'Schlangen-Bot'), W('hasenbot', 'Hasen-Bot'), W('kosmobot', 'Kosmo-Bot'), W('badbot', 'Grummel-Bot'), W('mecha', 'Mecha'),
];
export const MODEL_BY = Object.fromEntries(MODELS.map(m => [m.id, m]));

// Bausteine für eigene Figuren: Datei-ID → Name. „basis“ ist das VRoid-Grundmodell (nur für die Raspelkurz-Frisur).
export const PARTS = {
  face: [['fumiriya', 'Haru'], ['kaito', 'Kaito'], ['shibu', 'Aiko'], ['shino', 'Nami'], ['mika', 'Mika'], ['darkshibu', 'Rin'], ['victoria', 'Hana'], ['vivi', 'Momo']],
  hair: [['basis', 'Raspelkurz'], ['fumiriya', 'Wuschelig'], ['kaito', 'Fransig'], ['shibu', 'Bob'], ['darkshibu', 'Bob mit Strähnen'], ['vivi', 'Kurz mit Knoten'],
    ['shino', 'Lang'], ['victoria', 'Seitenzopf'], ['mika', 'Zöpfe mit Katzenohren']],
  outfit: [['kaito', 'Hoodie'], ['fumiriya', 'Schuluniform mit Hose'], ['shibu', 'Schuluniform mit Rock'], ['darkshibu', 'Gothic-Kleid'], ['victoria', 'Rüschenkleid'], ['vivi', 'Sommerkleid']],
  hairColor: [null, '#1d1b22', '#3b2a20', '#6b4a32', '#a8743f', '#e7c983', '#c9cfd8', '#b73a2e', '#d97aa8', '#4a6fd0', '#4fa37a', '#8a5cc8'],
  skin: [null, '#fff1e6', '#f3d2b8', '#d9a882', '#b07a52', '#7d4f32', '#4f3122'],
};
export const lookKey = l => [l.outfit, l.face, l.hair].join('+');   // ändert sich das, muss neu zusammengesetzt werden

const loader = new GLTFLoader(); loader.register(p => new VRMLoaderPlugin(p));

// Gelenk-Griffe. Der Griff sitzt am Ende eines Körperteils (z. B. am Ellbogen für den Oberarm):
// Zieht man ihn, dreht sich das Teil um sein Gelenk (pivot) in der Bildebene. „head“ steuert die Kopf-Spur.
const H = (name, bones, pivot, tip, off) => ({ name, bones, pivot, tip, off });
export const HANDLES = {
  torso: H('Oberkörper', ['spine', 'chest'], 'spine', 'neck'),
  head: H('Kopf', [], 'head', 'head', [0, .17, 0]),
  leftUpperArm: H('Oberarm links', ['leftUpperArm'], 'leftUpperArm', 'leftLowerArm'),
  leftLowerArm: H('Unterarm links', ['leftLowerArm'], 'leftLowerArm', 'leftHand'),
  leftHand: H('Hand links', ['leftHand'], 'leftHand', 'leftMiddleProximal', [.07, 0, 0]),
  rightUpperArm: H('Oberarm rechts', ['rightUpperArm'], 'rightUpperArm', 'rightLowerArm'),
  rightLowerArm: H('Unterarm rechts', ['rightLowerArm'], 'rightLowerArm', 'rightHand'),
  rightHand: H('Hand rechts', ['rightHand'], 'rightHand', 'rightMiddleProximal', [-.07, 0, 0]),
  leftUpperLeg: H('Oberschenkel links', ['leftUpperLeg'], 'leftUpperLeg', 'leftLowerLeg'),
  leftLowerLeg: H('Unterschenkel links', ['leftLowerLeg'], 'leftLowerLeg', 'leftFoot'),
  leftFoot: H('Fuß links', ['leftFoot'], 'leftFoot', 'leftToes', [0, -.05, .1]),
  rightUpperLeg: H('Oberschenkel rechts', ['rightUpperLeg'], 'rightUpperLeg', 'rightLowerLeg'),
  rightLowerLeg: H('Unterschenkel rechts', ['rightLowerLeg'], 'rightLowerLeg', 'rightFoot'),
  rightFoot: H('Fuß rechts', ['rightFoot'], 'rightFoot', 'rightToes', [0, -.05, .1]),
};

export async function loadFigure(url, onProgress) {
  const g = await loader.loadAsync(url, e => onProgress && e.total && onProgress(e.loaded / e.total));
  const vrm = g.userData.vrm; if (!vrm) throw new Error('keine VRM-Datei');
  const v0 = vrm.meta && vrm.meta.metaVersion === '0';
  // Shape-Namen stehen bei VRoid-Dateien an den Primitiven (extras.targetNames); three.js kennt dann nur Nummern
  const J = g.parser.json, morphs = {};
  vrm.scene.traverse(o => {
    if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; }
    if (!o.morphTargetInfluences) return;
    const a = g.parser.associations.get(o); if (!a || a.meshes == null) return;
    const m = J.meshes[a.meshes], p = m.primitives[a.primitives || 0];
    const names = (p.extras && p.extras.targetNames) || (m.extras && m.extras.targetNames) || Object.keys(o.morphTargetDictionary || {});
    names.forEach((n, i) => { const k = String(n).replace(/^.*Fcl_/, ''); (morphs[k] ||= []).push([o, i]); });
  });
  VRMUtils.rotateVRM0(vrm);
  const root = new THREE.Group(); root.add(vrm.scene);
  const expr = new Set((vrm.expressionManager ? vrm.expressionManager.expressions : []).map(e => e.expressionName));
  if (vrm.lookAt) vrm.lookAt.autoUpdate = false;
  const fig = { vrm, root, v0, morphs, expr, bone: n => vrm.humanoid.getNormalizedBoneNode(n) };
  // Was kann dieses Gesicht? Ein Ausdruck zählt nur, wenn er wirklich an Shapes gebunden ist (manche Dateien haben leere Ausdrücke).
  const em = vrm.expressionManager;
  fig.bound = name => { const e = em && em.getExpression(name); return !!(e && e.binds && e.binds.length); };
  fig.can = s => !!(morphs[s.m] || (s.x && fig.bound(s.x)));
  // Blick: über Augen-Knochen oder, wenn es keine gibt, über die Blick-Ausdrücke der Figur
  fig.eyes = !!vrm.humanoid.getNormalizedBoneNode('leftEye');
  fig.canLook = fig.eyes || ['lookLeft', 'lookRight', 'lookUp', 'lookDown'].some(fig.bound);
  // Manche Dateien zählen „links“ vom Betrachter aus. Nachmessen, welche Seite blinkLeft schließt
  // und wohin lookLeft die Augen schiebt (links von der Figur = +X in der Welt).
  root.updateMatrixWorld(true);
  fig.swapBlink = moved(em, 'blinkLeft', 'pos') < 0;
  fig.swapLook = moved(em, 'lookLeft', 'delta') < 0;
  // Kopfgröße für die Gesichts-Kamera (große Tierköpfe brauchen mehr Abstand)
  const top = new THREE.Box3().setFromObject(vrm.scene).max.y, neck = fig.bone('neck') || fig.bone('head');
  fig.headSize = Math.max(.2, top - neck.getWorldPosition(new THREE.Vector3()).y); fig.height = top;
  return fig;
}

// ---------- Eigene Figuren: Teile verschiedener VRoid-Figuren zusammensetzen ----------
// Alle VRoid-Figuren haben gleich benannte Knochen. Das Gesicht („Face“) und die Frisur („Hair001“) einer Figur werden
// auf das Skelett der Outfit-Figur umgebunden: Knochen gleichen Namens werden ersetzt, die Haarknochen wandern samt
// Wipp-Einstellungen unter den Kopf. Die Haut sitzt dabei relativ zum Kopfknochen.
export async function loadCustom(look, onProgress) {
  const ids = [...new Set([look.outfit, look.face, look.hair])], prog = {}, got = {};
  await Promise.all(ids.map(async id => {
    got[id] = await loadFigure(`figuren/${id}.vrm`, p => { prog[id] = p; onProgress && onProgress(ids.reduce((s, k) => s + (prog[k] || 0), 0) / ids.length); });
  }));
  const fig = got[look.outfit];
  if (look.face !== look.outfit) transplant(fig, got[look.face], 'face');
  if (look.hair !== look.outfit) transplant(fig, got[look.hair], 'hair');
  for (const id of ids) if (got[id] !== fig) disposeFigure(got[id]);
  fig.vrm.springBoneManager.setInitState();
  const top = new THREE.Box3().setFromObject(fig.vrm.scene).max.y, neck = fig.bone('neck') || fig.bone('head');
  fig.headSize = Math.max(.2, top - neck.getWorldPosition(new THREE.Vector3()).y); fig.height = top;
  applyLook(fig, look);
  return fig;
}
function findPart(vrm, kind) { let f = null; vrm.scene.traverse(o => { if (!f && o.name === (kind === 'face' ? 'Face' : 'Hair001')) f = o; }); return f; }
const underHair = b => { for (let o = b; o; o = o.parent) if (o.name.startsWith('HairJoint')) return true; return false; };
function transplant(fig, src, kind) {
  const part = findPart(src.vrm, kind), old = findPart(fig.vrm, kind); if (!part) return;
  const bHead = fig.vrm.humanoid.getRawBoneNode('head'), sHead = src.vrm.humanoid.getRawBoneNode('head'), moved = new Set();
  const byName = new Map(); fig.vrm.scene.traverse(o => { if (!byName.has(o.name)) byName.set(o.name, o); });
  // Alles unterhalb des Spender-Kopfes, was zu diesem Teil gehört, wandert mit (Haarknochen bzw. Augenknochen):
  // so passen die gespeicherten Bindungen genau, auch wenn die Skelette die Knochen anders benennen.
  const mine = c => kind === 'hair' ? c.name.startsWith('HairJoint') : !c.name.startsWith('HairJoint');
  for (const t of sHead.children.filter(mine)) { bHead.add(t); t.traverse(o => moved.add(o)); }
  if (kind === 'hair') {
    const sm = fig.vrm.springBoneManager;
    for (const j of [...sm.joints]) if (underHair(j.bone) && !moved.has(j.bone)) sm.deleteJoint(j);   // alte Frisur wippt nicht mehr
    const groups = [...sm.colliderGroups];
    for (const j of [...src.vrm.springBoneManager.joints]) if (moved.has(j.bone)) { j.colliderGroups = groups; sm.addJoint(j); }
  } else {
    // Die mitgewanderten Augen drehen sich mit den Augen der Figur (Blickrichtung)
    fig.eyeLink = ['leftEye', 'rightEye'].map(b => [fig.vrm.humanoid.getRawBoneNode(b), src.vrm.humanoid.getRawBoneNode(b)]).filter(([a, b]) => a && b && moved.has(b));
  }
  // Fehlt ein Knochen im Skelett der Figur, wird er mit gleicher Lage unter seinem (umgebundenen) Elternknochen angelegt
  const map = b => {
    if (moved.has(b)) return b;
    const hit = byName.get(b.name); if (hit) return hit;
    const c = new THREE.Bone(); c.name = b.name; c.position.copy(b.position); c.quaternion.copy(b.quaternion); c.scale.copy(b.scale);
    (b.parent && b.parent !== src.vrm.scene ? map(b.parent) : bHead).add(c); byName.set(b.name, c); return c;
  };
  part.traverse(o => {
    if (!o.isSkinnedMesh) return;
    o.bind(new THREE.Skeleton(o.skeleton.bones.map(map), o.skeleton.boneInverses), o.bindMatrix);
  });
  const parent = old ? old.parent : fig.vrm.scene;
  if (old) { old.removeFromParent(); disposeObj(old); }
  parent.add(part);
  if (kind === 'face') fig.morphs = src.morphs;   // Gesichts-Shapes kommen mit dem Gesicht
}
function disposeObj(root) {
  root.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) for (const m of [].concat(o.material)) { for (const k in m) if (m[k] && m[k].isTexture) m[k].dispose(); m.dispose(); }
  });
}

// Haar- und Hautfarbe (geht ohne Neuladen). Haarbilder werden dafür grau, die Farbe kommt aus dem Material.
const WHITE = new THREE.Color(1, 1, 1), SKIN0 = new THREE.Color('#ffe4d2');
export function applyLook(fig, look) {
  fig.vrm.scene.traverse(o => {
    if (!o.isMesh) return;
    for (const m of [].concat(o.material)) {
      if (!m || !m.isMToonMaterial) continue;
      const n = (m.name || '').toUpperCase();
      if (!n.includes('SKIN') && !n.includes('HAIR')) continue;
      const O = m.userData.orig || (m.userData.orig = { color: m.color.clone(), shade: m.shadeColorFactor.clone(), emissive: m.emissive.clone(), map: m.map, shadeTex: m.shadeMultiplyTexture });
      m.color.copy(O.color); m.shadeColorFactor.copy(O.shade); m.emissive.copy(O.emissive);
      if (n.includes('SKIN') && look.skin) {
        const t = new THREE.Color(look.skin), k = new THREE.Color(Math.min(1, t.r / SKIN0.r), Math.min(1, t.g / SKIN0.g), Math.min(1, t.b / SKIN0.b));
        m.color.multiply(k); m.shadeColorFactor.multiply(k);
      }
      if (n.includes('HAIR')) {
        const c = look.hairColor && new THREE.Color(look.hairColor), map = c ? grayOf(O.map) : O.map, sh = c ? grayOf(O.shadeTex) : O.shadeTex;
        if (m.map !== map || m.shadeMultiplyTexture !== sh) { m.map = map; m.shadeMultiplyTexture = sh; m.needsUpdate = true; }
        if (c) { m.color.copy(c); m.shadeColorFactor.copy(c).multiplyScalar(.62); if (O.emissive.getHex()) m.emissive.copy(c).lerp(WHITE, .35).multiplyScalar(.45); }
      }
    }
  });
}
// Graustufen-Fassung eines Bildes (Schattierung bleibt, hellste Stellen weiß, dunkelste 45 % grau)
function grayOf(tex) {
  if (!tex || !tex.image) return tex;
  if (tex.userData.gray) return tex.userData.gray;
  const img = tex.image, w = img.width, h = img.height, c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d'); x.drawImage(img, 0, 0); const d = x.getImageData(0, 0, w, h), a = d.data, hist = new Uint32Array(256); let n = 0;
  for (let i = 0; i < a.length; i += 4) if (a[i + 3] > 25) { hist[(a[i] * 77 + a[i + 1] * 150 + a[i + 2] * 29) >> 8]++; n++; }
  const pct = q => { let s = 0; for (let i = 0; i < 256; i++) { s += hist[i]; if (s >= n * q) return i; } return 255; };
  const lo = pct(.05), hi = Math.max(lo + 1, pct(.98)), base = .45;
  for (let i = 0; i < a.length; i += 4) {
    const L = (a[i] * 77 + a[i + 1] * 150 + a[i + 2] * 29) >> 8, g = 255 * (base + Math.min(1, Math.max(0, (L - lo) / (hi - lo))) * (1 - base));
    a[i] = a[i + 1] = a[i + 2] = g;
  }
  x.putImageData(d, 0, 0);
  const t = new THREE.CanvasTexture(c); t.flipY = tex.flipY; t.colorSpace = tex.colorSpace; t.wrapS = tex.wrapS; t.wrapT = tex.wrapT;
  t.magFilter = tex.magFilter; t.minFilter = tex.minFilter; t.channel = tex.channel; t.anisotropy = tex.anisotropy;
  tex.userData.gray = t; return t;
}

// Mittleres x (Welt) der Punkte, die ein Ausdruck bewegt ('pos'), oder ihrer Verschiebung ('delta'). 0 = nichts gefunden.
function moved(em, name, what) {
  const e = em && em.getExpression(name); if (!e) return 0;
  const v = new THREE.Vector3(), q = new THREE.Quaternion(); let sx = 0, n = 0;
  for (const b of e.binds) for (const mesh of b.primitives || []) {
    const d = mesh.geometry && mesh.geometry.morphAttributes.position && mesh.geometry.morphAttributes.position[b.index]; if (!d) continue;
    const p = mesh.geometry.attributes.position; mesh.getWorldQuaternion(q);
    for (let i = 0; i < d.count; i++) {
      v.fromBufferAttribute(d, i); if (v.lengthSq() < 1e-8) continue;
      if (what === 'pos') v.fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld); else v.applyQuaternion(q);
      sx += v.x; n++;
    }
  }
  return n ? sx / n : 0;
}

export function disposeFigure(fig) {
  fig.root.removeFromParent();
  fig.vrm.scene.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) for (const m of [].concat(o.material)) { for (const k in m) if (m[k] && m[k].isTexture) m[k].dispose(); m.dispose(); }
  });
}

// ---------- Werte anwenden ----------
// VRM 0.x schaut im eigenen Raum nach −Z: dort sind x und z der Drehung gespiegelt
const setQ = (n, q, v0) => v0 ? n.quaternion.set(-q[0], q[1], -q[2], q[3]) : n.quaternion.set(q[0], q[1], q[2], q[3]);
export const readQ = (n, v0) => { const q = n.quaternion; return v0 ? [-q.x, q.y, -q.z, q.w] : [q.x, q.y, q.z, q.w]; };

export function applyBody(fig, body) {
  fig.root.position.set(body.p[0], body.p[1], body.p[2]);
  fig.root.rotation.y = body.r * Math.PI / 180;
  for (const name of BODY_BONES) { const n = fig.bone(name); if (n) { const q = body.b[name]; if (q) setQ(n, q, fig.v0); else n.quaternion.identity(); } }
}
export function applyHead(fig, h) {
  const n = fig.bone('neck'), hd = fig.bone('head');
  if (n) setQ(n, eulerQ(h.p * .4, h.y * .4, h.t * .4), fig.v0);
  if (hd) setQ(hd, eulerQ(h.p * .6, h.y * .6, h.t * .6), fig.v0);
  // lx > 0 = vom Betrachter aus nach rechts (Figur schaut zur Kamera). Bei VRM 0.x ist yaw gespiegelt (im Test geprüft).
  const la = fig.vrm.lookAt; if (la) { la.yaw = (fig.v0 ? -1 : 1) * h.lx * 22; la.pitch = -h.ly * 16; }
}

// Ausdrücke als Ersatz (für Figuren ohne VRoid-Shapes) müssen VOR vrm.update gesetzt werden,
// die rohen VRoid-Shapes DANACH (vrm.update setzt gebundene Shapes sonst auf 0 zurück).
export function applyFaceBefore(fig, face, h) {
  const em = fig.vrm.expressionManager; if (!em) return;
  for (const name of fig.expr) em.setValue(name, 0);
  const LR = { blinkLeft: 'blinkRight', blinkRight: 'blinkLeft' };
  for (const ch of FACE_CH) for (const s of FACE[ch]) {
    const w = face[ch][s.id]; if (!w || fig.morphs[s.m] || !s.x || !fig.expr.has(s.x)) continue;
    const x = fig.swapBlink && LR[s.x] || s.x;
    em.setValue(x, Math.min(1, em.getValue(x) + w));
  }
  // Ohne Augen-Knochen: Blick über Ausdrücke. lx > 0 = vom Betrachter aus rechts = links von der Figur aus.
  if (h && !fig.eyes) {
    const set = (n, w) => { if (w > 0 && fig.expr.has(n)) em.setValue(n, Math.min(1, w)); }, sx = fig.swapLook ? -h.lx : h.lx;
    set('lookLeft', sx); set('lookRight', -sx); set('lookDown', h.ly); set('lookUp', -h.ly);
  }
}
const OURS = /^(BRW|EYE|MTH)_/;
export function applyFaceAfter(fig, face) {
  for (const k in fig.morphs) if (OURS.test(k)) for (const [o, i] of fig.morphs[k]) o.morphTargetInfluences[i] = 0;
  for (const ch of FACE_CH) for (const s of FACE[ch]) {
    const w = face[ch][s.id], list = fig.morphs[s.m]; if (!w || !list) continue;
    for (const [o, i] of list) o.morphTargetInfluences[i] = Math.min(1, o.morphTargetInfluences[i] + w);
  }
}

// ---------- Gelenk-Griffe ----------
const HG = new THREE.SphereGeometry(1, 16, 12);
export function makeHandles(fig, color) {
  const group = new THREE.Group(); const items = {};
  for (const id in HANDLES) {
    if (!fig.bone(HANDLES[id].pivot)) continue;
    const mat = new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false, transparent: true, opacity: .92 });
    const m = new THREE.Mesh(HG, mat); m.renderOrder = 999; group.add(m); items[id] = m;
  }
  return { group, items, color };
}
const _v = new THREE.Vector3(), _q = new THREE.Quaternion();
// Weltposition des Griffs: Endpunkt des Körperteils (oder Gelenk + Versatz im Raum der Figur)
export function handlePos(fig, id, out) {
  const d = HANDLES[id], tip = fig.bone(d.tip);
  if (tip && d.tip !== d.pivot) return tip.getWorldPosition(out);
  fig.bone(d.pivot).getWorldPosition(out);
  if (d.off) { _v.fromArray(d.off).applyQuaternion(fig.root.getWorldQuaternion(_q)); out.add(_v); }
  return out;
}
export function placeHandles(fig, h, sel) {
  for (const id in h.items) {
    const m = h.items[id]; handlePos(fig, id, m.position);
    m.material.color.set(id === sel ? 0xffe14d : h.color);
    m.scale.setScalar((id === 'head' ? .04 : .026) * (id === sel ? 1.4 : 1));
  }
}
