// ===== Bühne: Renderer, Kamera, Licht, Orte =====
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import { GroundedSkybox } from 'three/addons/GroundedSkybox.js';
import { SCENES, SCENE_BY, disposeScene } from './scenes.js';

// Orte: Studio, Greenscreen, die selbst gebauten Anime-Szenen (js/scenes.js, kind 'scene')
// und 360°-Fotos von Poly Haven (CC0). h = Höhe der Kamera beim Foto, r = Radius des Bodens (für den „Boden“-Trick).
export const PLACES = [
  { id: 'studio', name: 'Studio' },
  { id: 'green', name: 'Greenscreen' },
  ...SCENES.map(s => ({ id: s.id, name: s.name, kind: 'scene' })),
  { id: 'newman_locker_room', name: 'Spinde', h: 1.7, r: 9 },
  { id: 'newman_cafeteria', name: 'Schulkantine', h: 1.7, r: 8 },
  { id: 'rooftop_day', name: 'Dach am Tag', h: 1.7, r: 30 },
  { id: 'ninomaru_teien', name: 'Japanischer Garten', h: 1.7, r: 20 },
  { id: 'chinese_garden', name: 'Teich-Pavillon', h: 1.7, r: 25 },
  { id: 'venice_sunset', name: 'Abend am Meer', h: 1.7, r: 30 },
  { id: 'lake_pier', name: 'Steg am See', h: 1.7, r: 25 },
  { id: 'cobblestone_street_night', name: 'Gasse bei Nacht', h: 1.7, r: 15 },
  { id: 'theater_01', name: 'Theater', h: 2.2, r: 14 },
  { id: 'spiaggia_di_mondello', name: 'Strand', h: 1.7, r: 40 },
  { id: 'misty_pines', name: 'Nebelwald', h: 1.7, r: 25 },
  { id: 'zavelstein', name: 'Burgruine', h: 1.7, r: 18 },
  { id: 'snowy_park_01', name: 'Schneepark', h: 1.7, r: 35 },
  { id: 'rooftop_night', name: 'Dach bei Nacht', h: 1.7, r: 30 },
  { id: 'shanghai_bund', name: 'Stadt bei Nacht', h: 1.7, r: 30 },
  { id: 'hamburg_hbf', name: 'Bahnhof', h: 2.4, r: 30 },
  { id: 'leadenhall_market', name: 'Markthalle', h: 1.9, r: 18 },
];
export const PLACE_BY = Object.fromEntries(PLACES.map(p => [p.id, p]));
let COLORS = {};
fetch('orte/farben.json').then(r => r.json()).then(j => { COLORS = j; }).catch(() => {});

export function makeStage(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, .05, 300);
  camera.position.set(0, 1.25, 4.4);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 1.0, 0); controls.enableDamping = true; controls.dampingFactor = .12;
  controls.minDistance = .35; controls.maxDistance = 14; controls.maxPolarAngle = Math.PI * .58;
  controls.update();

  const hemi = new THREE.HemisphereLight(0xffffff, 0x777777, 1.6); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(2.5, 5, 4);
  sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024); sun.shadow.bias = -.0005;
  Object.assign(sun.shadow.camera, { left: -3, right: 3, top: 3, bottom: -2, near: .5, far: 15 });
  scene.add(sun, sun.target);
  // Unsichtbarer Boden, der nur Schatten zeigt
  const catcher = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), new THREE.ShadowMaterial({ opacity: .28 }));
  catcher.rotation.x = -Math.PI / 2; catcher.receiveShadow = true; scene.add(catcher);
  // Studio-Boden: runde Scheibe mit weichem Rand
  const floorTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d');
    const g = x.createRadialGradient(128, 128, 10, 128, 128, 128); g.addColorStop(0, '#7b8294'); g.addColorStop(.7, '#4a4f5c'); g.addColorStop(1, 'rgba(40,43,52,0)');
    x.fillStyle = g; x.fillRect(0, 0, 256, 256); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const floor = new THREE.Mesh(new THREE.CircleGeometry(6, 48), new THREE.MeshBasicMaterial({ map: floorTex, transparent: true }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -.002; scene.add(floor);

  let sky = null, placeId = null, set = null;
  const texLoader = new THREE.TextureLoader(), SUN0 = sun.position.clone();
  // Gibt ein Promise zurück: Anime-Szenen laden ihre Modelle nach (main.js zeigt solange „Lade Ort …“)
  async function setPlace(id) {
    const p = PLACE_BY[id] || PLACES[0];
    if (p.id === placeId) return; placeId = p.id;
    if (sky) { scene.remove(sky); sky.material.map.dispose(); sky.material.dispose(); sky.geometry.dispose(); sky = null; }
    if (set) { disposeScene(set.group); set = null; }
    floor.visible = p.id === 'studio'; catcher.visible = p.kind !== 'scene'; scene.fog = null;
    hemi.intensity = 1.6; sun.intensity = 2.2; sun.position.copy(SUN0);
    controls.maxDistance = 14;
    if (p.id === 'studio') { scene.background = new THREE.Color(0x282b34); light([200, 210, 230], [70, 70, 80]); return; }
    if (p.id === 'green') { scene.background = new THREE.Color(0x00b140); light([235, 245, 235], [120, 140, 120]); return; }
    if (p.kind === 'scene') {   // selbst gebaute Anime-Szene: eigenes Licht, eigener Boden mit Schatten
      const built = await SCENE_BY[p.id].build();
      if (placeId !== p.id) { disposeScene(built.group); return; }   // inzwischen anderer Ort gewählt
      set = built; scene.add(set.group);
      const L = set.light; hemi.color.set(L.sky); hemi.groundColor.set(L.ground); hemi.intensity = L.hemi;
      sun.color.set(L.sun); sun.intensity = L.sunI; sun.position.fromArray(L.sunPos);
      scene.background = new THREE.Color(set.bg); if (set.fog) scene.fog = new THREE.Fog(set.fog[0], set.fog[1], set.fog[2]);
      if (set.maxDist) controls.maxDistance = set.maxDist;
      return;
    }
    scene.background = new THREE.Color(0x222222);
    texLoader.load(`orte/${p.id}.jpg`, t => {
      if (placeId !== p.id) { t.dispose(); return; }
      t.mapping = THREE.EquirectangularReflectionMapping; t.colorSpace = THREE.SRGBColorSpace;
      sky = new GroundedSkybox(t, p.h, p.r); sky.position.y = p.h - .01; scene.add(sky);
    });
    const c = COLORS[p.id]; light(c ? c.sky : [220, 220, 220], c ? c.ground : [110, 100, 90]);
  }
  // Lichtfarbe aus dem Foto, aufgehellt, damit die Figuren nie im Dunkeln stehen
  function light(skyRGB, groundRGB) {
    const soft = (rgb, k) => new THREE.Color(...rgb.map(v => (v / 255) * (1 - k) + k));
    hemi.color.copy(soft(skyRGB, .55)); hemi.groundColor.copy(soft(groundRGB, .35)); sun.color.copy(soft(skyRGB, .7));
  }

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight; if (!w || !h) return;
    if (canvas.width !== Math.round(w * renderer.getPixelRatio()) || canvas.height !== Math.round(h * renderer.getPixelRatio())) {
      renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    }
  }
  // Kamera sanft zu einem Ziel fahren (für „Gesicht nah“, „ganze Bühne“ …)
  let fly = null;
  function flyTo(pos, target, ms = 450) { fly = { p0: camera.position.clone(), t0: controls.target.clone(), p1: pos, t1: target, start: performance.now(), ms }; }
  function tick(filmSec = 0) {
    if (set && set.update) set.update(filmSec);   // z. B. fallende Blüten, an der Filmzeit
    if (set && set.walls) for (const w of set.walls) w.g.visible = w.show(camera.position);   // Puppenhaus: Wanddeko nur von innen
    if (fly) {
      const u = Math.min(1, (performance.now() - fly.start) / fly.ms), e = u * u * (3 - 2 * u);
      camera.position.lerpVectors(fly.p0, fly.p1, e); controls.target.lerpVectors(fly.t0, fly.t1, e); if (u >= 1) fly = null;
    }
    controls.update();
  }
  return { renderer, scene, camera, controls, setPlace, resize, flyTo, tick, get place() { return placeId; } };
}
