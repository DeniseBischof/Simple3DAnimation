// ===== Anime-Szenen: einfache 3D-Orte mit flächigen Farben (Cel-Shading wie bei den Figuren) =====
// Jede Szene baut eine Gruppe und sagt, wie das Licht sein soll. Regeln, damit sie zur App passen:
// - Die Figuren stehen bei x −0,85…0,85, die Kamera startet bei z 4,4: Bereich |x| < 2,5 und z −1,5…5 bleibt frei.
// - Räume sind „Puppenhäuser“: Wände nur von innen sichtbar (BackSide). Was an einer Wand hängt, steckt in deren
//   Gruppe und verschwindet mit ihr, sobald die Kamera draußen ist (walls → stage.tick).
// - Decken mindestens 3,6 m hoch (Feuerauge ist 3,3 m groß).
// - Wiederholtes (Tische, Fenster, Häuser, Blüten) als InstancedMesh oder zusammengefügt: wenige Zeichenaufrufe fürs iPad.
// - Bewegtes (Blüten) hängt an der Filmzeit, damit jede Wiedergabe gleich aussieht.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from '../vendor/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/GLTFLoader.js';

// ---------- Tusche-Umriss (wie bei den Figuren) ----------
// Rückseiten einer Kopie werden im Bildraum nach außen geschoben: gleich breite Linie, egal wie weit weg.
// Für Kästen werden die Ecken-Normalen gemittelt, damit die Linie an Kanten nicht aufreißt.
const INK_GEO = new Map();
function inkGeo(g) {
  if (INK_GEO.has(g.uuid)) return INK_GEO.get(g.uuid);
  let o = new THREE.BufferGeometry(); o.setAttribute('position', g.getAttribute('position')); if (g.index) o.setIndex(g.index);
  o = mergeVertices(o, 1e-4); o.computeVertexNormals(); INK_GEO.set(g.uuid, o); return o;
}
function inkMat(color, px) {
  const m = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
  m.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
      vec3 inkN = normal;
      #ifdef USE_INSTANCING
        inkN = mat3(instanceMatrix) * inkN;
      #endif
      vec4 inkC = projectionMatrix * vec4(normalize(mat3(modelViewMatrix) * inkN), 0.0);
      gl_Position.xy += normalize(inkC.xy + vec2(1e-6)) * ${(px / 500).toFixed(5)} * gl_Position.w;`);
  };
  return m;
}
// Alle Toon-Körper einer Gruppe bekommen einen Umriss (Böden, Raumhülle, Durchsichtiges und Leuchtendes nicht)
function ink(group, color = 0x2b2433, px = 1.4) {
  const mat = inkMat(color, px), list = [];
  group.traverse(o => {
    if (!(o.isMesh) || o.userData.noInk || !o.material || Array.isArray(o.material) || !o.material.isMeshToonMaterial) return;
    if (o.material.side === THREE.BackSide || o.material.transparent || o.material.alphaTest > 0 || o.geometry.type === 'PlaneGeometry' || o.geometry.type === 'CircleGeometry') return;
    list.push(o);
  });
  for (const o of list) {
    const k = o.isInstancedMesh ? new THREE.InstancedMesh(inkGeo(o.geometry), mat, o.count) : new THREE.Mesh(inkGeo(o.geometry), mat);
    if (o.isInstancedMesh) k.instanceMatrix = o.instanceMatrix;
    k.userData.noInk = true; o.add(k);
  }
}
// Gemalte Wolken: Bilder mit hellem Oberteil und schattiger Unterseite, als Sprites am Himmel
function cloudTex(seed, top, bottom) {
  return tex(256, 128, (x, w, h) => {
    const r = rng(seed), blobs = [];
    for (let i = 0; i < 9; i++) blobs.push([30 + r() * 196, 52 + r() * 40 - Math.sin((i / 8) * Math.PI) * 26, 20 + r() * 26]);
    const g = x.createLinearGradient(0, 20, 0, 118); g.addColorStop(0, top); g.addColorStop(.55, top); g.addColorStop(1, bottom);
    x.fillStyle = g; x.beginPath(); for (const [cx, cy, s] of blobs) { x.moveTo(cx + s, cy); x.arc(cx, cy, s, 0, 7); } x.fill();
    x.globalCompositeOperation = 'destination-out'; x.fillRect(0, 108, w, 20);   // flache Unterkante
  });
}
function paintedClouds(parent, n, seed, top, bottom, ring = [80, 130], height = [16, 40], arc = [0, Math.PI * 2]) {
  const r = rng(seed), texs = [0, 1, 2, 3].map(i => cloudTex(seed * 7 + i, top, bottom));
  for (let i = 0; i < n; i++) {
    const a = arc[0] + r() * (arc[1] - arc[0]), d = ring[0] + r() * (ring[1] - ring[0]), s = 18 + r() * 26;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: texs[i % 4], transparent: true, depthWrite: false, fog: false }));
    sp.scale.set(s, s / 2, 1); sp.position.set(Math.cos(a) * d, height[0] + r() * (height[1] - height[0]), Math.sin(a) * d); parent.add(sp);
  }
}
// Wandfarbe mit leichtem Verlauf (unten etwas dunkler): wirkt wie gemalt
function wallTex(top, bottom) { return tex(4, 256, (x, w, h) => { const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, top); g.addColorStop(1, bottom); x.fillStyle = g; x.fillRect(0, 0, w, h); }); }

// ---------- Bausteine ----------
let GRAD = null;
function grad() {   // drei harte Helligkeitsstufen = Anime-Schatten
  if (!GRAD) { GRAD = new THREE.DataTexture(new Uint8Array([120, 200, 255]), 3, 1, THREE.RedFormat); GRAD.minFilter = GRAD.magFilter = THREE.NearestFilter; GRAD.needsUpdate = true; }
  return GRAD;
}
// Gleiche Farbe = gleiches Material (spart Zustandswechsel und erlaubt das Zusammenfügen, siehe mergeStatic)
const MATS = new Map();
function cached(kind, color, o, make) {
  const plain = Object.values(o).every(v => v == null || typeof v !== 'object' || v.isColor);
  if (!plain) return make();
  const k = kind + color + JSON.stringify(o); if (!MATS.has(k)) MATS.set(k, make()); return MATS.get(k);
}
const toon = (color, o = {}) => cached('t', color, o, () => new THREE.MeshToonMaterial({ color, gradientMap: grad(), ...o }));
const flat = (color, o = {}) => cached('f', color, o, () => new THREE.MeshBasicMaterial({ color, ...o }));
function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function tex(w, h, draw, rep) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  if (rep) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep[0], rep[1]); }
  return t;
}
// Kasten mit Unterkante bei y
function box(parent, w, h, d, mat, x, y, z, o = {}) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y + h / 2, z);
  if (o.ry) m.rotation.y = o.ry; m.castShadow = !!o.cast; m.receiveShadow = o.receive !== false; parent.add(m); return m;
}
// Viele Kästen in einem Zeichenaufruf: list = [[x, y, z, ry?, sx?, sy?, sz?], …] (y = Unterkante), colors = Farbe je Stück
function boxes(parent, w, h, d, mat, list, o = {}) {
  const m = new THREE.InstancedMesh(new THREE.BoxGeometry(w, h, d), mat, list.length), M = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  list.forEach(([x, y, z, ry = 0, sx = 1, sy = 1, sz = 1], i) => { q.setFromEuler(e.set(0, ry, 0)); M.compose(new THREE.Vector3(x, y + h * sy / 2, z), q, new THREE.Vector3(sx, sy, sz)); m.setMatrixAt(i, M); if (o.colors) m.setColorAt(i, new THREE.Color(o.colors[i % o.colors.length])); });
  m.castShadow = !!o.cast; m.receiveShadow = true; parent.add(m); return m;
}
function ground(parent, size, mat, y = 0) { const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat); m.rotation.x = -Math.PI / 2; m.position.y = y; m.receiveShadow = true; parent.add(m); return m; }
// Raum als Puppenhaus. Gibt Gruppen je Wand zurück: was dort hängt, verschwindet mit der Wand.
function room(parent, W, H, D, cz, mats) {
  for (const k in mats) { mats[k] = mats[k].clone(); mats[k].side = THREE.BackSide; }
  const m = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), [mats.wall, mats.wall, mats.ceil, mats.floor, mats.wall, mats.wall]);
  m.position.set(0, H / 2, cz); m.receiveShadow = true; parent.add(m);
  const xr = W / 2, zb = cz - D / 2, zf = cz + D / 2, mk = show => { const g = new THREE.Group(); parent.add(g); return { g, show }; };
  const w = { right: mk(p => p.x < xr), left: mk(p => p.x > -xr), back: mk(p => p.z > zb), front: mk(p => p.z < zf), ceil: mk(p => p.y < H) };
  return { w, list: Object.values(w) };
}
// Himmelskuppel mit Farbverlauf und Sonne
function sky(parent, c) {
  const u = { top: { value: new THREE.Color(c.top) }, mid: { value: new THREE.Color(c.mid) }, bot: { value: new THREE.Color(c.bottom) },
    sun: { value: new THREE.Vector3(...(c.sunDir || [0, -1, 0])).normalize() }, sunCol: { value: new THREE.Color(c.sunColor || 0xffffff) }, sunSize: { value: c.sunSize || 0 } };
  const m = new THREE.Mesh(new THREE.SphereGeometry(160, 32, 16), new THREE.ShaderMaterial({ uniforms: u, side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 top, mid, bot, sunCol, sun; uniform float sunSize; varying vec3 vD;
      void main(){ float h = vD.y; vec3 c = h > 0.0 ? mix(mid, top, pow(clamp(h * 1.6, 0.0, 1.0), 0.7)) : mix(mid, bot, clamp(-h * 4.0, 0.0, 1.0));
        float s = max(dot(vD, sun), 0.0); c = mix(c, sunCol, smoothstep(1.0 - sunSize, 1.0 - sunSize * .85, s)) + sunCol * pow(s, 24.0) * .25;
        gl_FragColor = vec4(c, 1.0); }` }));
  m.renderOrder = -1; parent.add(m); return m;
}
// ---------- Fertige CC0-Modelle (Quaternius, Kenney) ----------
// Jedes Modell wird einmal geladen; jedes Teil davon wird zu EINEM InstancedMesh für alle Kopien.
// Materialien werden zu Toon-Materialien (Blätter mit Alpha-Test, ohne Umriss). tint färbt Blätter um (Bild grau, Farbe neu).
const LOADER = new GLTFLoader(), MODEL = new Map(), TOONED = new Map();
function model(url) {
  if (!MODEL.has(url)) MODEL.set(url, LOADER.loadAsync(url).then(g => {
    g.scene.updateMatrixWorld(true); const parts = [];
    g.scene.traverse(o => { if (o.isMesh) parts.push({ geo: o.geometry, mat: o.material, m: o.matrixWorld.clone() }); });
    return { parts };
  }));
  return MODEL.get(url);
}
function grayTex(t) {
  if (!t || !t.image) return t; if (t.userData.gray) return t.userData.gray;
  const im = t.image, c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const x = c.getContext('2d'); x.drawImage(im, 0, 0);
  const d = x.getImageData(0, 0, c.width, c.height), a = d.data;
  for (let i = 0; i < a.length; i += 4) { const L = Math.min(255, (a[i] * 77 + a[i + 1] * 150 + a[i + 2] * 29 >> 8) * 1.1 + 130); a[i] = a[i + 1] = a[i + 2] = L; }
  x.putImageData(d, 0, 0); const g = new THREE.CanvasTexture(c); g.flipY = t.flipY; g.colorSpace = t.colorSpace; g.wrapS = t.wrapS; g.wrapT = t.wrapT; t.userData.gray = g; return g;
}
function tooned(m, tint) {
  const k = m.uuid + (tint || ''); if (TOONED.has(k)) return TOONED.get(k);
  const leaf = m.alphaTest > 0 || m.transparent, t = new THREE.MeshToonMaterial({
    color: tint ? new THREE.Color(tint) : (m.color ? m.color.clone() : new THREE.Color(1, 1, 1)), map: tint ? grayTex(m.map) : m.map, vertexColors: !!m.vertexColors,
    gradientMap: grad(), side: leaf ? THREE.DoubleSide : m.side, alphaTest: leaf ? Math.max(.4, m.alphaTest || 0) : 0 });
  TOONED.set(k, t); return t;
}
// list = [[x, y, z, Drehung, Größe], …]; o.tint = Farbe, o.tintIf = /Leaves/ (welche Materialien) oder o.tints = [[/Name/, Farbe], …];
// o.cast = Schatten werfen (o.castNear = nur im Umkreis), o.ink = Tusche-Umriss (nur für Stämme, Felsen, Holz, Häuser)
async function scatter(parent, url, list, o = {}) {
  if (!list.length) return; const M = await model(url), T = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3();
  for (const p of M.parts) {
    const pick = m => { if (o.tints) { const t = o.tints.find(([re]) => re.test(m.name)); return t ? t[1] : null; } return o.tint && (!o.tintIf || o.tintIf.test(m.name)) ? o.tint : null; };
    const conv = m => tooned(m, pick(m)), mat = Array.isArray(p.mat) ? p.mat.map(conv) : conv(p.mat);
    // Schatten nur in der Nähe der Figuren (o.castNear = Radius), weiter weg kostet es nur Rechenzeit
    const near = o.castNear ? list.filter(([x, , z]) => x * x + z * z < o.castNear ** 2) : o.cast ? list : [], far = list.filter(l => !near.includes(l));
    for (const [part, cast] of [[near, true], [far, false]]) {
      if (!part.length) continue;
      const im = new THREE.InstancedMesh(p.geo, mat, part.length);
      part.forEach(([x, y, z, ry = 0, s = 1], i) => { q.setFromEuler(e.set(0, ry, 0)); T.compose(v.set(x, y, z), q, sc.set(s, s, s)).multiply(p.m); im.setMatrixAt(i, T); });
      im.castShadow = cast; im.receiveShadow = true; im.frustumCulled = false; im.userData.noInk = !o.ink; parent.add(im);
    }
  }
}
// Unbewegliche Teile mit gleichem Material zusammenfügen: aus vielen Zeichenaufrufen werden wenige
function mergeStatic(group) {
  const containers = new Set([group]); group.traverse(o => { if (o.isGroup) containers.add(o); });
  for (const c of containers) {
    const by = new Map();
    for (const o of c.children) {
      if (!o.isMesh || o.isInstancedMesh || o.children.length || Array.isArray(o.material) || o.material.side === THREE.BackSide || o.material.transparent || o.userData.keep) continue;
      const k = o.material.uuid + (o.castShadow ? 'c' : '') + (o.userData.noInk ? 'n' : ''); if (!by.has(k)) by.set(k, []); by.get(k).push(o);
    }
    for (const list of by.values()) {
      if (list.length < 2) continue;
      const geos = list.map(o => { o.updateMatrix(); const g2 = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone(); for (const a of Object.keys(g2.attributes)) if (!['position', 'normal', 'uv'].includes(a)) g2.deleteAttribute(a); g2.applyMatrix4(o.matrix); return g2; });
      if (!geos.every(g2 => g2.attributes.uv)) continue;
      const merged = mergeGeometries(geos); if (!merged) continue;
      const m = new THREE.Mesh(merged, list[0].material); m.castShadow = list[0].castShadow; m.receiveShadow = true; m.userData.noInk = list[0].userData.noInk;
      for (const o of list) { o.removeFromParent(); o.geometry.dispose(); }
      geos.forEach(g2 => g2.dispose()); c.add(m);
    }
  }
}

// Blick aus dem Fenster: Himmel, Wolken, Baumkronen, Schulgebäude gegenüber
function windowView(seed, top = '#5aa8f0', bottom = '#d4ecff') {
  return tex(256, 256, (x, w, h) => {
    const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, top); g.addColorStop(1, bottom); x.fillStyle = g; x.fillRect(0, 0, w, h);
    const r = rng(seed); x.fillStyle = '#ffffff';
    for (let i = 0; i < 4; i++) { const cx = r() * w, cy = h * (.15 + r() * .3), s = 14 + r() * 18; x.beginPath(); for (let k = 0; k < 6; k++) { const a = cx + (r() - .5) * s * 2.6, b = cy + (r() - .3) * s * .5, rr = s * (.5 + r() * .4); x.moveTo(a + rr, b); x.arc(a, b, rr, 0, 7); } x.fill(); }
    x.fillStyle = '#e9e1d2'; x.fillRect(150, 120, 106, 136); x.fillStyle = '#9fb8d0'; for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) x.fillRect(158 + j * 24, 132 + i * 34, 16, 20);
    for (const [c, y0] of [['#5f9e57', 175], ['#79b765', 195]]) { x.fillStyle = c; x.beginPath(); for (let i = 0; i < 12; i++) { const cx = i * 24 + r() * 10, rr = 18 + r() * 14; x.moveTo(cx + rr, y0); x.arc(cx, y0, rr, 0, 7); } x.fill(); x.fillRect(0, y0, w, h - y0); }
  });
}
function textTex(text, bg, fg, w = 256, h = 96, font = 'bold 54px system-ui, sans-serif') {
  return tex(w, h, (x) => { x.fillStyle = bg; x.fillRect(0, 0, w, h); x.fillStyle = fg; x.font = font; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text, w / 2, h / 2 + 2); });
}
const plane = (parent, w, h, mat, x, y, z, ry = 0) => { const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat); p.position.set(x, y, z); p.rotation.y = ry; parent.add(p); return p; };
// Topfpflanze: Topf + Blätterbusch
function plant(parent, x, y, z, s = 1, leaf = 0x5aa84a) {
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(.13 * s, .1 * s, .22 * s, 12), toon(0xd87a4a)); pot.position.set(x, y + .11 * s, z); parent.add(pot);
  const r = rng(Math.round(x * 100 + z * 10)), parts = [];
  for (let i = 0; i < 5; i++) { const l = new THREE.IcosahedronGeometry(.12 * s, 1); l.translate(x + (r() - .5) * .16 * s, y + (.3 + r() * .2) * s, z + (r() - .5) * .16 * s); parts.push(l); }
  parent.add(new THREE.Mesh(mergeGeometries(parts), toon(leaf)));
}

// ---------- 1 Klassenzimmer ----------
function klasse() {
  const g = new THREE.Group(), W = 10, H = 3.8, D = 11, cz = .9, zb = cz - D / 2, zf = cz + D / 2, xr = W / 2;
  const floorTex = tex(256, 256, (x, w, h) => {   // Holzdielen
    x.fillStyle = '#c99a63'; x.fillRect(0, 0, w, h); const r = rng(3);
    for (let i = 0; i < 8; i++) { x.fillStyle = ['#c48f57', '#cfa36d', '#c2935e'][i % 3]; x.fillRect(0, i * 32, w, 31); x.fillStyle = '#a77a48'; x.fillRect(0, i * 32 + 31, w, 1); x.fillRect((r() * w) | 0, i * 32, 1, 32); }
  }, [W / 2, D / 2]);
  const R = room(g, W, H, D, cz, { floor: toon(0xffffff, { map: floorTex }), wall: toon(0xffffff, { map: wallTex('#f8f1e3', '#e3d4bb') }), ceil: toon(0xf7f3ea) }), w = R.w;
  const pan = toon(0xd9c4a0), wood = toon(0x9c6b3f), white = toon(0xffffff);
  box(w.back.g, W - .02, .9, .04, pan, 0, 0, zb + .03); box(w.left.g, .04, .9, D - .02, pan, -xr + .03, 0, cz); box(w.right.g, .04, .9, D - .02, pan, xr - .03, 0, cz); box(w.front.g, W - .02, .9, .04, pan, 0, 0, zf - .03);
  box(w.back.g, W - .02, .05, .06, wood, 0, .9, zb + .04); box(w.left.g, .06, .05, D - .02, wood, -xr + .04, .9, cz); box(w.right.g, .06, .05, D - .02, wood, xr - .04, .9, cz);
  // Tafel mit Kreide, Schwamm, Stundenplan, Uhr, Fernseher
  const board = tex(1024, 320, (x, ww, h) => {
    x.fillStyle = '#2f5b46'; x.fillRect(0, 0, ww, h); const r = rng(5); x.fillStyle = 'rgba(255,255,255,.05)'; for (let i = 0; i < 40; i++) x.fillRect(r() * ww, r() * h, 120, 6);
    x.fillStyle = '#f4f1e6'; x.font = 'bold 64px "Segoe Print", "Bradley Hand", "Comic Sans MS", cursive'; x.fillText('Heute: Gesichter!', 60, 110);
    x.font = '40px "Segoe Print", "Bradley Hand", "Comic Sans MS", cursive'; x.fillText('😊  😠  😢  😲', 70, 200); x.fillStyle = '#ffd6e8'; x.fillText('Hausaufgabe: Seite 42', 520, 270);
    x.strokeStyle = '#f4f1e6'; x.lineWidth = 4; x.beginPath(); x.arc(860, 120, 60, 0, 7); x.stroke(); x.beginPath(); x.arc(840, 105, 6, 0, 7); x.arc(880, 105, 6, 0, 7); x.fill();
    x.beginPath(); x.arc(860, 130, 30, .3, Math.PI - .3); x.stroke();
  });
  box(w.back.g, 4.6, 1.5, .08, toon(0x6e5034), 0, 1.0, zb + .05);
  plane(w.back.g, 4.4, 1.32, toon(0xffffff, { map: board }), 0, 1.75, zb + .1);
  box(w.back.g, 4.4, .05, .12, toon(0x7a5a3a), 0, 1.0, zb + .14); box(w.back.g, .22, .06, .09, toon(0x3b5aa0), 1.2, 1.05, zb + .16);
  const plan = tex(128, 160, (x, ww, h) => { x.fillStyle = '#fffdf4'; x.fillRect(0, 0, ww, h); x.fillStyle = '#e86a6a'; x.fillRect(0, 0, ww, 22); x.strokeStyle = '#9aa'; for (let i = 1; i < 6; i++) { x.beginPath(); x.moveTo(0, 22 + i * 23); x.lineTo(ww, 22 + i * 23); x.stroke(); x.beginPath(); x.moveTo(i * 21, 22); x.lineTo(i * 21, h); x.stroke(); } const r = rng(8); for (let i = 0; i < 18; i++) { x.fillStyle = ['#ffd36a', '#8fd0ff', '#b6e39a', '#ffb3c7'][i % 4]; x.fillRect(2 + (i % 6) * 21, 25 + Math.floor(i / 6) * 46 + r() * 20, 17, 18); } });
  plane(w.back.g, .6, .75, flat(0xffffff, { map: plan }), 3.2, 1.9, zb + .06);
  const clock = tex(128, 128, (x) => { x.fillStyle = '#fff'; x.beginPath(); x.arc(64, 64, 60, 0, 7); x.fill(); x.lineWidth = 6; x.strokeStyle = '#333'; x.stroke(); x.lineWidth = 5; x.beginPath(); x.moveTo(64, 64); x.lineTo(64, 24); x.moveTo(64, 64); x.lineTo(94, 72); x.stroke(); });
  const ck = new THREE.Mesh(new THREE.CircleGeometry(.28, 24), flat(0xffffff, { map: clock })); ck.position.set(0, 3.05, zb + .06); w.back.g.add(ck);
  box(w.back.g, .9, .55, .12, toon(0x2a2d36), -3.4, 2.55, zb + .35); plane(w.back.g, .8, .45, flat(0x7fb6d8), -3.4, 2.825, zb + .42); box(w.back.g, .08, .4, .3, toon(0x555555), -3.4, 3.1, zb + .2);
  // Pult mit Büchern
  box(g, 1.3, 1.0, .6, wood, 0, 0, zb + 1.1, { cast: true }); box(g, 1.4, .05, .7, toon(0xb98a58), 0, 1.0, zb + 1.1);
  boxes(g, .26, .05, .2, toon(0xffffff), [[-.35, 1.05, zb + 1.1], [-.33, 1.1, zb + 1.08], [-.36, 1.15, zb + 1.12]], { colors: [0xe85a5a, 0x5a8ae8, 0xf2c230] });
  // Fenster rechts: Blick nach draußen, Rahmen, Vorhänge, Pflanzen auf dem Sims, Sonnenstrahlen
  const view = windowView(7), curtain = toon(0xf6eccd);
  const beam = new THREE.MeshBasicMaterial({ color: 0xfff4c8, transparent: true, opacity: .05, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
  for (const z of [-2.4, .6, 3.6]) {
    plane(w.right.g, 2.2, 1.7, flat(0xffffff, { map: view }), xr - .02, 2.05, z, -Math.PI / 2);
    for (const dz of [-1.1, 0, 1.1]) box(w.right.g, .06, 1.74, .06, white, xr - .05, 1.18, z + dz);
    for (const y of [1.18, 2.9]) box(w.right.g, .06, .06, 2.26, white, xr - .05, y, z);
    box(w.right.g, .3, .05, 2.3, white, xr - .15, 1.12, z);
    box(w.right.g, .08, 2.2, .35, curtain, xr - .1, 1.0, z - 1.35); box(w.right.g, .08, 2.2, .35, curtain, xr - .1, 1.0, z + 1.35);
    const b = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 3.6), beam); b.position.set(xr - 1.3, 1.5, z); b.rotation.set(0, 0, -.62); w.right.g.add(b);
  }
  plant(w.right.g, xr - .16, 1.17, -2.8); plant(w.right.g, xr - .16, 1.17, 1.0, 1.1, 0x4f9a43); plant(w.right.g, xr - .16, 1.17, 3.2, .9);
  // Tür mit Klassenschild, Pinnwand
  box(w.left.g, .06, 2.3, 1.2, toon(0xb08355), -xr + .04, 0, -3); box(w.left.g, .07, .12, .3, toon(0x888888), -xr + .08, 1.0, -2.5);
  plane(w.left.g, .5, .2, flat(0xffffff, { map: textTex('2-A', '#ffffff', '#33405a') }), -xr + .03, 2.55, -3, Math.PI / 2);
  box(w.left.g, .04, 1.1, 2.2, toon(0xc8a27a), -xr + .04, 1.3, 1.2);
  [0xffe08a, 0xa8e6ff, 0xffb3c7, 0xc9f2b0, 0xffffff].forEach((c, i) => box(w.left.g, .03, .32, .26, flat(c), -xr + .07, 1.45 + (i % 2) * .45, .5 + i * .35));
  // Spinde-Regal hinten (hinter der Kamera) mit bunten Taschen
  box(w.front.g, 6, 1.2, .45, toon(0xcdb48c), 0, 0, zf - .25);
  const cub = []; for (let i = 0; i < 8; i++) for (let j = 0; j < 2; j++) cub.push([-2.62 + i * .75, .1 + j * .55, zf - .5]);
  boxes(w.front.g, .6, .42, .05, toon(0x8a6a48), cub);
  boxes(w.front.g, .4, .3, .22, toon(0xffffff), cub.filter((_, i) => i % 3 !== 1).map(([x, y, z]) => [x, y + .02, z + .1]), { colors: [0xe85a5a, 0x5a8ae8, 0xf2c230, 0x5ab86a, 0xb07ad8] });
  // Schülertische mit Taschen an den Seiten (Mitte bleibt frei)
  const desks = []; for (const x of [-4.1, -3.0, 3.0, 4.1]) for (const z of [-.6, 1.0, 2.6, 4.2]) desks.push([x, 0, z]);
  const top = toon(0xd9b07c), metal = toon(0x8c949e);
  boxes(g, .62, .03, .44, top, desks.map(([x, , z]) => [x, .7, z]));
  boxes(g, .56, .28, .38, metal, desks.map(([x, , z]) => [x, .42, z]));
  boxes(g, .05, .42, .05, metal, desks.flatMap(([x, , z]) => [[x - .27, 0, z - .18], [x + .27, 0, z - .18], [x - .27, 0, z + .18], [x + .27, 0, z + .18]]));
  // Stühle: vier Beine, Sitz, zwei Lehnenpfosten, Lehne (alles berührt sich)
  boxes(g, .4, .04, .38, top, desks.map(([x, , z]) => [x, .42, z + .5]));
  boxes(g, .03, .42, .03, metal, desks.flatMap(([x, , z]) => [[x - .18, 0, z + .33], [x + .18, 0, z + .33], [x - .18, 0, z + .67], [x + .18, 0, z + .67]]));
  boxes(g, .03, .44, .03, metal, desks.flatMap(([x, , z]) => [[x - .18, .44, z + .67], [x + .18, .44, z + .67]]));
  boxes(g, .4, .2, .03, top, desks.map(([x, , z]) => [x, .66, z + .695]));
  boxes(g, .26, .3, .1, toon(0xffffff), desks.filter((_, i) => i % 2).map(([x, , z]) => [x + (x > 0 ? -.33 : .33), .25, z]), { colors: [0x2f4a7a, 0x7a2f3a, 0x3a6a4a] });
  // Decke: Lampen und zwei Ventilatoren
  boxes(w.ceil.g, 1.4, .06, .3, flat(0xffffff), [[-2.5, H - .07, -1.5], [2.5, H - .07, -1.5], [-2.5, H - .07, 2.5], [2.5, H - .07, 2.5]]);
  for (const x of [-2.2, 2.2]) {
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(.08, .08, .35, 12), toon(0xeeeeee)); hub.position.set(x, H - .18, .5); w.ceil.g.add(hub);
    for (let k = 0; k < 3; k++) box(w.ceil.g, .9, .02, .16, toon(0xf4f4f4), x + Math.cos(k * 2.09) * .45, H - .36, .5 + Math.sin(k * 2.09) * .45, { ry: -k * 2.09 });
  }
  sky(g, { top: 0x4f9ae8, mid: 0xbfe2ff, bottom: 0xdfeefa });
  mergeStatic(g); ink(g, 0x4a3a30, 1.3);
  return { group: g, walls: R.list, light: { sky: 0xfff8ee, ground: 0xc7a782, hemi: 1.15, sun: 0xffe6bf, sunI: 1.6, sunPos: [6, 5, 1.5] }, bg: 0xbfe2ff };
}

// ---------- 2 Schuldach im Sonnenuntergang ----------
async function dach() {
  const g = new THREE.Group();
  const tiles = tex(128, 128, (x, w, h) => { x.fillStyle = '#c4b5ad'; x.fillRect(0, 0, w, h); x.fillStyle = '#ad9e97'; x.fillRect(0, 0, w, 3); x.fillRect(0, 0, 3, h); x.fillStyle = '#cdbfb7'; x.fillRect(10, 10, 50, 50); }, [10, 10]);
  ground(g, 20, toon(0xffffff, { map: tiles }));
  const conc = toon(0xd8c8bd), iron = toon(0x55606e);
  const fence = tex(64, 64, (x, w, h) => { x.clearRect(0, 0, w, h); x.strokeStyle = '#4c5865'; x.lineWidth = 3; x.beginPath(); x.moveTo(0, 0); x.lineTo(w, h); x.moveTo(w, 0); x.lineTo(0, h); x.stroke(); });
  const posts = [];
  for (const [x, z, ry, len] of [[0, -6, 0, 16], [-8, 1, Math.PI / 2, 14], [8, 1, Math.PI / 2, 14], [0, 8, 0, 16]]) {
    box(g, len, .5, .3, conc, x, 0, z, { ry });
    const ft = fence.clone(); ft.needsUpdate = true; ft.wrapS = ft.wrapT = THREE.RepeatWrapping; ft.repeat.set(len * 3, 6);
    const f = new THREE.Mesh(new THREE.PlaneGeometry(len, 2), toon(0xffffff, { map: ft, transparent: true, alphaTest: .4, side: THREE.DoubleSide })); f.position.set(x, 1.5, z); f.rotation.y = ry; g.add(f);
    box(g, len, .07, .07, iron, x, 2.5, z, { ry });
    for (let t = -len / 2; t <= len / 2 + .01; t += 2) posts.push(ry ? [x, .5, z + t] : [x + t, .5, z]);
  }
  boxes(g, .08, 2.05, .08, iron, posts);
  // Treppenhaus mit Tür und Schild, Wassertank, Lüftung, Bank
  box(g, 3.2, 3.2, 3, toon(0xeadbc8), -5, 0, -3.8, { cast: true }); box(g, 3.4, .2, 3.2, toon(0x8f8a85), -5, 3.2, -3.8);
  box(g, 1.1, 2.1, .06, toon(0x55776a), -4.4, 0, -2.28); box(g, .08, .08, .06, toon(0xd8c070), -4.0, 1.0, -2.24);
  plane(g, .9, .3, flat(0xffffff, { map: textTex('DACH', '#2f6a55', '#ffffff') }), -4.4, 2.45, -2.27);
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 1.6, 24), toon(0xd8e2ea)); tank.position.set(5, 2.6, -3.8); tank.castShadow = true; g.add(tank);
  const lid = new THREE.Mesh(new THREE.ConeGeometry(1.15, .4, 24), toon(0xb8c6d2)); lid.position.set(5, 3.6, -3.8); g.add(lid);
  boxes(g, .12, 1.8, .12, iron, [[4.3, 0, -4.5], [5.7, 0, -4.5], [4.3, 0, -3.1], [5.7, 0, -3.1]]);
  boxes(g, .9, .7, .6, toon(0xcfd6db), [[6.5, 0, 2], [6.5, 0, 3.2]]);
  box(g, 1.6, .08, .45, toon(0x9c6b3f), -4.2, .45, 3.4); boxes(g, .08, .45, .4, iron, [[-4.9, 0, 3.4], [-3.5, 0, 3.4]]); box(g, 1.6, .4, .06, toon(0x9c6b3f), -4.2, .55, 3.62);
  // Stadt in der Ferne, dahinter Berge
  const r = rng(11), city = { sky: [], low: [] };
  for (let i = 0; i < 70; i++) { const a = r() * Math.PI * 2, d = 45 + r() * 50, k = r() < .45 ? 'sky' : 'low'; city[k].push([Math.cos(a) * d, -14, Math.sin(a) * d, r() * 6.3, 7 + r() * 3]); }
  for (let j = 0; j < 5; j++) await scatter(g, `modelle/stadt/commercial/building-skyscraper-${'abcde'[j]}.glb`, city.sky.filter((_, i) => i % 5 === j));
  for (let j = 0; j < 8; j++) await scatter(g, `modelle/stadt/commercial/low-detail-building-${'abcdefgh'[j]}.glb`, city.low.filter((_, i) => i % 8 === j));
  const mts = []; const mr = rng(6);
  for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2 + mr() * .3, d = 125 + mr() * 15, m = new THREE.SphereGeometry(16 + mr() * 14, 12, 6); m.scale(1.8, .5 + mr() * .4, 1); m.translate(Math.cos(a) * d, -6, Math.sin(a) * d); mts.push(m); }
  const mt = new THREE.Mesh(mergeGeometries(mts), toon(0x6a5a8a, { fog: false })); mt.userData.noInk = true; g.add(mt);
  sky(g, { top: 0x3a3f8f, mid: 0xff9a6a, bottom: 0xffc79a, sunDir: [-.7, .06, -.7], sunColor: 0xfff0b0, sunSize: .006 });
  paintedClouds(g, 16, 21, '#ffc29a', '#a86a9a', [85, 130], [14, 38]);
  const birds = []; const br = rng(3); for (let i = 0; i < 7; i++) { const x = -40 + br() * 25, y = 18 + br() * 8, z = -45 - br() * 10, s = .6 + br() * .4; birds.push(x - s, y + s * .4, z, x, y, z, x, y, z, x + s, y + s * .4, z); }
  const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.Float32BufferAttribute(birds, 3)); g.add(new THREE.LineSegments(bg, new THREE.LineBasicMaterial({ color: 0x3a2a40, fog: false })));
  mergeStatic(g); ink(g, 0x3a2838, 1.3);
  return { group: g, maxDist: 10, light: { sky: 0xffc2a8, ground: 0x8a6a7a, hemi: 1.25, sun: 0xffb27a, sunI: 2.0, sunPos: [-6, 3, -1] }, bg: 0xff9a6a, fog: [0xf2a08a, 25, 130] };
}

// ---------- 3 Kirschblütenpark ----------
const N_ = 'modelle/natur/', C_ = 'modelle/stadt/';
async function park() {
  const g = new THREE.Group(), r = rng(9);
  ground(g, 240, toon(0x8fcf6a));
  const path = tex(64, 64, (x, w, h) => { x.fillStyle = '#ead6ab'; x.fillRect(0, 0, w, h); const q = rng(2); x.fillStyle = '#d8c094'; for (let i = 0; i < 30; i++) x.fillRect(q() * w, q() * h, 3, 2); }, [20, 1.5]);
  const p = ground(g, 1, toon(0xffffff, { map: path }), .01); p.scale.set(60, 3.2, 1);
  const free = (x, z) => Math.abs(z) > 2.3 && !(Math.abs(x) < 3 && z > -2.5 && z < 6);
  // Kirschbäume: gedrehte Bäume mit rosa gefärbten Blättern; dahinter ein paar grüne Bäume
  const sak = [[-4.2, -3.4], [3.8, -3.6], [-7.5, 1], [7.5, 1.8], [-3, -8.5], [4.5, -9], [-9.5, -6], [10, -6.5], [-5.5, 9.5], [5.5, 10], [0, -13], [-12.5, 4], [12.5, 6]];
  for (let k = 0; k < 3; k++) await scatter(g, `${N_}TwistedTree_${k + 1}.gltf`, sak.filter((_, i) => i % 3 === k).map(([x, z]) => [x, 0, z, r() * 6.3, .28 + r() * .06]), { tint: k === 1 ? '#ffb0cc' : '#ffcade', tintIf: /Leaves/, castNear: 10, ink: true });
  const green = []; for (let i = 0; i < 10; i++) { const a = r() * Math.PI * 2, d = 18 + r() * 14; green.push([Math.cos(a) * d, 0, Math.sin(a) * d - 4, r() * 6, .6 + r() * .3]); }
  for (let k = 0; k < 3; k++) await scatter(g, `${N_}CommonTree_${k + 1}.gltf`, green.filter((_, i) => i % 3 === k));
  // Büsche mit Blüten, Blumen, Gras und Trittsteine am Weg
  const bush = [], flowers = [], grass = [], stones = [];
  for (let x = -14; x <= 14; x += 3.4 + r()) for (const z of [-2.9, 2.9]) if (free(x, z)) bush.push([x, 0, z + (r() - .5) * .4, r() * 6, .45 + r() * .2]);
  for (let i = 0; i < 60; i++) { const x = (r() - .5) * 30, z = (r() < .5 ? -1 : 1) * (2.2 + r() * 2.5); if (free(x, z)) flowers.push([x, 0, z, r() * 6, .2 + r() * .1]); }
  for (let i = 0; i < 110; i++) { const x = (r() - .5) * 36, z = (r() - .5) * 36; if (free(x, z)) grass.push([x, 0, z, r() * 6, .18 + r() * .12]); }
  for (let x = -14; x <= 14; x += .9) for (const z of [-1.75, 1.75]) stones.push([x + (r() - .5) * .2, 0, z, r() * 6, .25]);
  await scatter(g, `${N_}Bush_Common_Flowers.gltf`, bush);
  await scatter(g, `${N_}Flower_3_Group.gltf`, flowers.filter((_, i) => i % 2)); await scatter(g, `${N_}Flower_4_Group.gltf`, flowers.filter((_, i) => !(i % 2)));
  await scatter(g, `${N_}Grass_Common_Short.gltf`, grass);
  for (let k = 0; k < 3; k++) await scatter(g, `${N_}RockPath_Round_Small_${k + 1}.gltf`, stones.filter((_, i) => i % 3 === k));
  // Bänke, Steinlaternen, Laterne, Teich mit Steinen, Torii, Hügel
  for (const x of [-3.4, 3.4]) { box(g, 1.6, .06, .45, toon(0xa8693f), x, .45, 2.3); box(g, 1.6, .4, .06, toon(0xa8693f), x, .55, 2.55); boxes(g, .08, .45, .4, toon(0x4a4a4a), [[x - .7, 0, 2.3], [x + .7, 0, 2.3]]); }
  for (const x of [-2.6, 2.6]) { box(g, .5, .25, .5, toon(0xb7b3a8), x, 0, -2); box(g, .22, .7, .22, toon(0xb7b3a8), x, .25, -2); box(g, .5, .35, .5, toon(0xd8d2c0, { emissive: 0x332a10 }), x, .95, -2); box(g, .7, .12, .7, toon(0xa29e94), x, 1.3, -2); }
  box(g, .1, 3, .1, toon(0x3a4a3a), -6, 0, -1.7); box(g, .35, .45, .35, toon(0xfff2c8, { emissive: 0x554422 }), -6, 3, -1.7); box(g, .45, .08, .45, toon(0x3a4a3a), -6, 3.45, -1.7);
  const pond = new THREE.Mesh(new THREE.CircleGeometry(2.3, 32), toon(0x6fb7e8, { emissive: 0x10304a })); pond.rotation.x = -Math.PI / 2; pond.position.set(7, .02, -5); g.add(pond);
  const ps = []; for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; ps.push([7 + Math.cos(a) * 2.45, 0, -5 + Math.sin(a) * 2.45, a, .3]); }
  await scatter(g, `${N_}Rock_Medium_2.gltf`, ps, { ink: true });
  const red = toon(0xd9402f);
  boxes(g, .5, 6, .5, red, [[-2.6, 0, -22], [2.6, 0, -22]]); box(g, 7.6, .5, .7, red, 0, 5.2, -22); box(g, 8.6, .45, .8, toon(0x2b2b2b), 0, 6, -22); box(g, 6.2, .3, .4, red, 0, 4.2, -22);
  const hills = []; const hr = rng(4);
  for (let i = 0; i < 9; i++) { const a = Math.PI * (1.1 + i * .1) + hr() * .2, d = 60 + hr() * 20, h = new THREE.SphereGeometry(18 + hr() * 14, 16, 8); h.scale(1.6, .55, 1); h.translate(Math.cos(a) * d, -2, Math.sin(a) * d); hills.push(h); }
  const hm = new THREE.Mesh(mergeGeometries(hills), toon(0x6fa96a)); hm.userData.noInk = true; g.add(hm);
  sky(g, { top: 0x3e8fe0, mid: 0xbfe4ff, bottom: 0xdff2ff });
  paintedClouds(g, 18, 5, '#ffffff', '#b8c8e8');
  // Fallende Blüten, gesteuert von der Filmzeit
  const N = 260, pet = new THREE.InstancedMesh(new THREE.PlaneGeometry(.06, .045), flat(0xffb7cf, { side: THREE.DoubleSide }), N), M = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  const pr = rng(31), P = [...Array(N)].map(() => [(pr() - .5) * 14, (pr() - .5) * 12 - 1, pr() * 5, .25 + pr() * .3, pr() * 6.28, .5 + pr()]);
  g.add(pet);
  const update = t => {
    P.forEach(([x, z, h0, sp, ph, sw], i) => {
      const y = 4.6 - ((h0 + t * sp) % 4.6);
      v.set(((x + 7 + t * .15) % 14 + 14) % 14 - 7 + Math.sin(t * sw + ph) * .5, y, z + Math.cos(t * .7 + ph) * .3);
      q.setFromEuler(e.set(t * 2 + ph, t * 1.3 + ph, ph)); M.compose(v, q, one); pet.setMatrixAt(i, M);
    });
    pet.instanceMatrix.needsUpdate = true;
  };
  update(0);
  mergeStatic(g); ink(g, 0x3a3030, 1.3);
  return { group: g, update, maxDist: 9, light: { sky: 0xfffaf0, ground: 0x9ab87a, hemi: 1.2, sun: 0xfff2dc, sunI: 1.9, sunPos: [4, 6, 5] }, bg: 0xbfe4ff, fog: [0xd6ecff, 30, 150] };
}

// ---------- 4 Stadtstraße am Nachmittag ----------
async function strasse() {
  const g = new THREE.Group(), r = rng(17), S = 6;   // Kenney-Stadtteile: 1 Einheit = 6 m
  const walk = tex(64, 64, (x, w, h) => { x.fillStyle = '#b9b2a6'; x.fillRect(0, 0, w, h); x.fillStyle = '#a49c90'; x.fillRect(0, 0, w, 2); x.fillRect(0, 0, 2, h); }, [80, 6]);
  const side = ground(g, 1, toon(0xffffff, { map: walk }), .02); side.scale.set(120, 9, 1); side.position.z = 2.6;
  const far = ground(g, 1, toon(0xffffff, { map: walk.clone() }), .02); far.scale.set(120, 4, 1); far.position.z = -9.5; far.material.map.needsUpdate = true;
  ground(g, 300, toon(0x9aa58c), -.01);
  // Straße aus Kenney-Teilen, mit Zebrastreifen
  const road = []; for (let x = -42; x <= 42; x += S) road.push([x, 0, -4.5, Math.PI / 2, S]);
  await scatter(g, `${C_}roads/road-straight.glb`, road.filter(([x]) => x !== 6)); await scatter(g, `${C_}roads/road-crossing.glb`, [[6, 0, -4.5, Math.PI / 2, S]]);
  // Häuser mit Läden hinter der Straße, Hochhäuser dahinter, flache Häuser hinter der Kamera
  const fronts = 'abcdefghijklmn'.split(''), row = [];
  for (let x = -36, i = 0; x < 36; i++) { const id = fronts[(i * 5 + 3) % fronts.length], w = 5.6; row.push([id, x + w / 2]); x += w + .2; }
  for (const id of new Set(row.map(([id]) => id))) await scatter(g, `${C_}commercial/building-${id}.glb`, row.filter(([k]) => k === id).map(([, x]) => [x, 0, -14.5, 0, S]), { ink: true });
  const tall = []; for (let i = 0; i < 14; i++) tall.push(['abcde'[i % 5], -40 + i * 6.2 + r() * 2, -27 - r() * 8]);
  for (const id of 'abcde') await scatter(g, `${C_}commercial/building-skyscraper-${id}.glb`, tall.filter(([k]) => k === id).map(([, x, z]) => [x, 0, z, 0, S]), { ink: true });
  const back = []; for (let x = -36, i = 0; x < 36; i++) { back.push(['abcdefgh'[i % 8], x + 3]); x += 6.4; }
  for (const id of 'abcdefgh') await scatter(g, `${C_}commercial/low-detail-building-${id}.glb`, back.filter(([k]) => k === id).map(([, x]) => [x, 0, 13, Math.PI, S]));
  // Gehweg: Laternen, Bäume in Kübeln, Ampel, Müllcontainer
  await scatter(g, `${C_}roads/light-curved.glb`, [-18, -6, 18, 30].map(x => [x, 0, -1.25, Math.PI / 2, S]), { ink: true });
  await scatter(g, `${C_}roads/light-curved.glb`, [-12, 12, 24].map(x => [x, 0, -7.9, -Math.PI / 2, S]), { ink: true });
  await scatter(g, `${C_}suburban/tree-large.glb`, [-9, 15, -24, 27].map(x => [x, 0, -.4, r() * 6, 3.2]), { castNear: 12, ink: true });
  await scatter(g, `${C_}roads/traffic-light.glb`, [[9.3, 0, -1.3, Math.PI / 2, S]], { ink: true });
  await scatter(g, `${C_}roads/dumpster.glb`, [[-15, 0, -9.2, 0, S]], { ink: true });
  box(g, 120, .14, .25, toon(0x9a98a8), 0, 0, -1.45); box(g, 120, .14, .25, toon(0x9a98a8), 0, 0, -7.55);
  // Getränkeautomaten
  const vm = tex(128, 256, (x, w, h) => {
    x.fillStyle = '#f4f7ff'; x.fillRect(0, 0, w, h); const cols = ['#e8463c', '#3c8de8', '#f2c230', '#46b86a', '#ff8ac0', '#8a5cd8'];
    for (let i = 0; i < 4; i++) for (let j = 0; j < 5; j++) { x.fillStyle = cols[(i * 5 + j) % 6]; x.fillRect(10 + j * 22, 20 + i * 40, 14, 28); x.fillStyle = '#ddd'; x.fillRect(10 + j * 22, 50 + i * 40, 14, 4); }
    x.fillStyle = '#d23a36'; x.fillRect(0, 190, w, 66); x.fillStyle = '#222'; x.fillRect(30, 210, 68, 30);
  });
  for (const [vx, c] of [[-3.9, 0xd23a36], [-3.0, 0x2f6fd0]]) { box(g, .85, 1.85, .7, toon(c), vx, 0, -.6, { cast: true }); plane(g, .72, 1.5, flat(0xffffff, { map: vm }), vx, 1.0, -.24); }
  sky(g, { top: 0x4a8fe0, mid: 0xcfe6ff, bottom: 0xf2e6d0, sunDir: [-.5, .35, .8], sunColor: 0xfff6d8, sunSize: .004 });
  paintedClouds(g, 16, 8, '#ffffff', '#c6d2e8');
  mergeStatic(g); ink(g, 0x2e2a36, 1.2);
  return { group: g, maxDist: 8.5, light: { sky: 0xfff4e6, ground: 0x9a8f80, hemi: 1.2, sun: 0xffe2b8, sunI: 2.0, sunPos: [-5, 6, 6] }, bg: 0xcfe6ff, fog: [0xd8e4f0, 30, 140] };
}

// ---------- 5 Wald ----------
async function wald() {
  const g = new THREE.Group(), r = rng(41);
  const moss = tex(128, 128, (x, w, h) => { x.fillStyle = '#6aa84c'; x.fillRect(0, 0, w, h); const q = rng(4); for (let i = 0; i < 70; i++) { x.fillStyle = ['#5f9a44', '#79b65a', '#679f49'][i % 3]; x.beginPath(); x.ellipse(q() * w, q() * h, 6 + q() * 14, 4 + q() * 9, q() * 3, 0, 7); x.fill(); } }, [40, 40]);
  ground(g, 240, toon(0xffffff, { map: moss }));
  const px = z => Math.sin(z * .12) * 2.2 * Math.min(1, Math.abs(z) / 8);
  const pathP = []; for (let z = 8; z > -40; z -= .9) pathP.push([px(z), -.005, z]);
  const pm = new THREE.InstancedMesh(new THREE.CylinderGeometry(1.25, 1.25, .02, 20), toon(0xc9a46a), pathP.length), M = new THREE.Matrix4();
  pathP.forEach(([x, y, z], i) => { M.makeTranslation(x, y, z); pm.setMatrixAt(i, M); }); pm.receiveShadow = true; pm.userData.noInk = true; g.add(pm);
  const free = (x, z, d) => Math.abs(x - px(z)) > d && !(Math.abs(x) < 3.2 && z > -3 && z < 7) && x * x + z * z > 20 && Math.abs(z + 8.5) > 1.4;
  // Bäume (Quaternius): Laubbäume, Tannen, ein paar gedrehte Bäume mit rotem Laub
  const trees = { CommonTree: [], Pine: [], TwistedTree: [] };
  for (let i = 0, n = 0; i < 500 && n < 34; i++) {
    const x = (r() - .5) * 48, z = 10 - r() * 50; if (!free(x, z, 3.3)) continue;
    const k = r() < .42 ? 'Pine' : r() < .9 ? 'CommonTree' : 'TwistedTree'; trees[k].push([x, 0, z, r() * 6.3, k === 'TwistedTree' ? .3 : .6 + r() * .35]); n++;
  }
  for (const [k, list] of Object.entries(trees)) { const nn = k === 'TwistedTree' ? 3 : 5; for (let j = 0; j < nn; j++) await scatter(g, `${N_}${k}_${j + 1}.gltf`, list.filter((_, i) => i % nn === j), { castNear: 10, ink: true }); }
  // Unterholz
  const bush = [], fern = [], grass = [], flowers = [], mush = [], rocks = [], pebbles = [], plants = [];
  for (let i = 0; i < 520; i++) {
    const x = (r() - .5) * 34, z = 9 - r() * 38; if (!free(x, z, 1.6)) continue; const k = r(), sp = [x, 0, z, r() * 6.3];
    if (k < .08) bush.push([...sp, .45 + r() * .25]); else if (k < .3) fern.push([...sp, .7 + r() * .4]); else if (k < .55) grass.push([...sp, .2 + r() * .15]);
    else if (k < .65) flowers.push([...sp, .22 + r() * .1]); else if (k < .72) mush.push([...sp, .35 + r() * .25]); else if (k < .82) rocks.push([...sp, .2 + r() * .3]);
    else if (k < .86) plants.push([...sp, .35 + r() * .3]); else pebbles.push([...sp, .3]);
  }
  await scatter(g, `${N_}Bush_Common.gltf`, bush, { tint: '#6aa84f', tintIf: /Leaves/ }); await scatter(g, `${N_}Fern_1.gltf`, fern); await scatter(g, `${N_}Grass_Wispy_Tall.gltf`, grass.filter((_, i) => i % 2)); await scatter(g, `${N_}Grass_Common_Tall.gltf`, grass.filter((_, i) => !(i % 2)));
  await scatter(g, `${N_}Flower_3_Group.gltf`, flowers); await scatter(g, `${N_}Mushroom_Common.gltf`, mush); await scatter(g, `${N_}Plant_1.gltf`, plants.filter((_, i) => i % 2)); await scatter(g, `${N_}Plant_7.gltf`, plants.filter((_, i) => !(i % 2)));
  for (let j = 0; j < 3; j++) await scatter(g, `${N_}Rock_Medium_${j + 1}.gltf`, rocks.filter((_, i) => i % 3 === j), { ink: true });
  await scatter(g, `${N_}Pebble_Round_1.gltf`, pebbles);
  const edge = []; for (let z = 7; z > -30; z -= 1.1) for (const d of [-1.55, 1.55]) if (Math.abs(z + 8.5) > 1.6) edge.push([px(z) + d + (r() - .5) * .2, 0, z, r() * 6, .22]);
  for (let j = 0; j < 3; j++) await scatter(g, `${N_}RockPath_Round_Small_${j + 1}.gltf`, edge.filter((_, i) => i % 3 === j));
  const WOOD = [[/Bark/i, '#6e4a2e'], [/Inner/i, '#d8b07a'], [/wood/i, '#a8743f'], [/stone/i, '#9a9a92']];
  const log = new THREE.Mesh(new THREE.CylinderGeometry(.3, .34, 3.2, 12), toon(0x6e4a2e)); log.rotation.set(0, .6, Math.PI / 2); log.position.set(-4.6, .3, 1.2); log.castShadow = true; log.userData.keep = true; g.add(log);
  for (const sx of [-1, 1]) { const c = new THREE.Mesh(new THREE.CircleGeometry(.29, 12), toon(0xd8b07a)); c.position.set(-4.6 + sx * 1.61 * Math.cos(.6), .3, 1.2 - sx * 1.61 * Math.sin(.6)); c.rotation.y = .6 + Math.PI / 2 * sx; g.add(c); }
  await scatter(g, `${N_}k_stump_old.glb`, [[4.3, 0, 2.4, 1, 2.6]], { ink: true, tints: WOOD });
  // Bach mit Holzbrücke hinter den Figuren
  const water = tex(64, 64, (x, w, h) => { x.fillStyle = '#5ab0e0'; x.fillRect(0, 0, w, h); x.strokeStyle = '#b8e6ff'; x.lineWidth = 2; for (let i = 0; i < 5; i++) { x.beginPath(); x.moveTo(0, 6 + i * 13); x.bezierCurveTo(20, i * 13, 40, 12 + i * 13, 64, 6 + i * 13); x.stroke(); } }, [24, 1]);
  const brook = ground(g, 1, toon(0xffffff, { map: water, emissive: 0x123040 }), .02); brook.scale.set(70, 2.2, 1); brook.position.set(0, .02, -8.5);
  const bz = -8.5, bxp = px(bz);
  await scatter(g, `${N_}k_bridge_wood.glb`, [[bxp, 0, bz, Math.PI / 2, 3]], { cast: true, ink: true, tints: WOOD });
  // Lichtstrahlen, ferne Bäume im Nebel, Himmel
  const beam = new THREE.MeshBasicMaterial({ color: 0xfff6c8, transparent: true, opacity: .07, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
  for (const [bx, bzz, w] of [[-3.5, -4, 1.6], [2.8, -6, 2.2], [-1.2, -11, 1.8], [5.5, -2, 1.4], [-6, -9, 2.4]]) { const b = new THREE.Mesh(new THREE.PlaneGeometry(w, 12), beam); b.position.set(bx, 5, bzz); b.rotation.set(0, .5, .35); g.add(b); }
  const farT = []; for (let i = 0; i < 70; i++) { const a = r() * Math.PI * 2, d = 32 + r() * 28; farT.push([Math.cos(a) * d, 0, Math.sin(a) * d]); }   // ferne Bäume: nur Kegel im Nebel
  const fc = new THREE.InstancedMesh(new THREE.ConeGeometry(2.6, 9, 7), toon(0x3d6e55), farT.length);
  farT.forEach(([x, , z], i) => { M.makeTranslation(x, 4.5, z); fc.setMatrixAt(i, M); }); fc.userData.noInk = true; g.add(fc);
  sky(g, { top: 0x6fb2e8, mid: 0xcfeede, bottom: 0xbfe0c8 });
  paintedClouds(g, 10, 13, '#ffffff', '#c8dcd8', [90, 130], [26, 44]);
  const NM = 140, mp = new Float32Array(NM * 3), mr = rng(77), base = [...Array(NM)].map(() => [(mr() - .5) * 16, .3 + mr() * 3.5, (mr() - .5) * 16 - 3, mr() * 6.28, .3 + mr() * .5]);
  const mg = new THREE.BufferGeometry(); mg.setAttribute('position', new THREE.BufferAttribute(mp, 3));
  g.add(new THREE.Points(mg, new THREE.PointsMaterial({ color: 0xfff2a8, size: 4, sizeAttenuation: false, transparent: true, opacity: .85, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })));
  const update = t => { base.forEach(([x, y, z, ph, sp], i) => { mp[i * 3] = x + Math.sin(t * sp + ph) * .6; mp[i * 3 + 1] = y + Math.sin(t * sp * 1.3 + ph * 2) * .35; mp[i * 3 + 2] = z + Math.cos(t * sp * .8 + ph) * .6; }); mg.attributes.position.needsUpdate = true; };
  update(0);
  mergeStatic(g); ink(g, 0x23301f, 1.3);
  return { group: g, update, maxDist: 8, light: { sky: 0xf0ffe0, ground: 0x5a7a3a, hemi: 1.2, sun: 0xfff0c8, sunI: 1.8, sunPos: [-4, 7, 3] }, bg: 0xcfeede, fog: [0xb8d8b4, 16, 80] };
}

export const SCENES = [
  { id: 'klasse', name: 'Klassenzimmer', build: klasse },
  { id: 'dach', name: 'Schuldach am Abend', build: dach },
  { id: 'park', name: 'Kirschblütenpark', build: park },
  { id: 'strasse', name: 'Stadtstraße', build: strasse },
  { id: 'wald', name: 'Wald mit Bach', build: wald },
];
export const SCENE_BY = Object.fromEntries(SCENES.map(s => [s.id, s]));

export function disposeScene(group) {
  group.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) for (const m of [].concat(o.material)) { for (const k in m) if (m[k] && m[k].isTexture && m[k] !== GRAD) m[k].dispose(); m.dispose(); }
  });
  group.removeFromParent();
}
