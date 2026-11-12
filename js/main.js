// ===== Mimik-Studio: alles zusammenstecken =====
import * as THREE from 'three';
import { makeStage, PLACES } from './stage.js';
import { MODELS, MODEL_BY, PARTS, lookKey, loadCustom, applyLook, loadFigure, disposeFigure, applyBody, applyHead, applyFaceBefore, applyFaceAfter, makeHandles, placeHandles, handlePos, HANDLES, readQ } from './figure.js';
import { FPS, CHANNELS, CH_NAME, FACE, EMOTIONS, POSES, newProject, newFigure, evalFig, evalCh, setKey, findKey, delKey, moveKey, keyFrames, mirrorBones, roundQ, cloneVal } from './anim.js';
import { FX, VOICE_FX, applyVoiceFx, audio, playClips, previewFx, previewVoice, bufferOf, lipAt, micProblem, startRecording, fileToVoice } from './sound.js';
import { makeTimeline } from './timeline.js';
import { MP4_mux, MP4_check, MP4_tick, MP4_bytes, MP4_drain, MP4_i420, MP4_CS } from './mp4.js';
import { idbGet, idbSet, download, pickFile, slug } from './store.js';

const $ = id => document.getElementById(id);
const COLORS = ['#ff8a3d', '#2ec4b6', '#b48cff'];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmtT = f => (f / FPS).toFixed(1).replace('.', ',') + ' s';
let toastT = 0;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 2600); }

// ---------- Zustand ----------
let P = newProject();
const UI = { frame: 0, playing: false, sel: null, selFig: null, tab: 'face', profi: false, joint: null, moveMode: false,
  clip: null, film: false, rec: null, strength: { brow: 1, eye: 1, mouth: 1, talk: 1 } };
const RT = {};   // Slot → { model, fig, handles, ring }
// Anzeigename: eigener Name (nur bei eigenen Figuren) oder der Name aus der Liste
const nameOf = pf => (pf.look && pf.name) || (MODEL_BY[pf.model] || {}).name || 'Figur';
const esc = t => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const selPF = () => P.figs.find(f => f.slot === UI.selFig) || null;
const selRT = () => { const r = RT[UI.selFig]; return r && r.fig ? r : null; };
const curF = () => Math.round(UI.frame);

const stage = makeStage($('c3d'));

// ---------- Rückgängig ----------
const undoS = [], redoS = [];
const snap = () => JSON.stringify({ title: P.title, len: P.len, place: P.place, figs: P.figs, clips: P.clips });
function checkpoint() { undoS.push(snap()); if (undoS.length > 80) undoS.shift(); redoS.length = 0; syncUndo(); }
function syncUndo() { $('bUndo').disabled = !undoS.length; $('bRedo').disabled = !redoS.length; }
function restore(s) { Object.assign(P, JSON.parse(s)); UI.sel = null; afterProjectChange(); }
$('bUndo').onclick = () => { if (!undoS.length) return; redoS.push(snap()); restore(undoS.pop()); syncUndo(); };
$('bRedo').onclick = () => { if (!redoS.length) return; undoS.push(snap()); restore(redoS.pop()); syncUndo(); };

// ---------- Speichern im Gerät ----------
let saveT = 0;
function scheduleSave() { clearTimeout(saveT); saveT = setTimeout(() => { pruneVoices(); idbSet('auto', JSON.stringify(P)); }, 700); }
function pruneVoices() { const used = new Set(P.clips.filter(c => c.src.startsWith('v:')).map(c => c.src.slice(2))); for (const id in P.voices) if (!used.has(id) && !undoS.some(s => s.includes('v:' + id))) delete P.voices[id]; }
function changed() { poke(); tl.draw(); refreshPanel(); syncKeyActs(); scheduleSave(); }

// ---------- Figuren laden ----------
let loadingN = 0;
function loading(d, txt) { loadingN += d; $('loading').hidden = loadingN <= 0; if (txt) $('loading').querySelector('span').textContent = txt; }
// Schlüssel einer Figur: ändert er sich, wird sie neu geladen (Farben gehen ohne Neuladen, siehe applyLook)
const figKey = pf => pf.model + (pf.look ? '|' + lookKey(pf.look) : '');
function syncFigures() {
  for (const slot of Object.keys(RT)) {
    const pf = P.figs.find(f => f.slot === +slot), rt = RT[slot];
    if (!pf || figKey(pf) !== rt.key) { if (rt.fig) { disposeFigure(rt.fig); stage.scene.remove(rt.handles.group); } delete RT[slot]; }
    else if (rt.fig && pf.look) applyLook(rt.fig, pf.look);
  }
  for (const pf of P.figs) if (!RT[pf.slot]) loadSlot(pf);
  if (!P.figs.some(f => f.slot === UI.selFig)) UI.selFig = P.figs.length ? P.figs[0].slot : null;
  $('empty').hidden = P.figs.length > 0;
  renderChips();
}
async function loadSlot(pf) {
  const rt = RT[pf.slot] = { model: pf.model, key: figKey(pf), fig: null }, name = nameOf(pf);
  loading(1, `Lade ${name} …`);
  try {
    const prog = p => loading(0, `Lade ${name} … ${Math.round(p * 100)} %`);
    const fig = pf.look ? await loadCustom(pf.look, prog) : await loadFigure(`figuren/${pf.model}.vrm`, prog);
    if (RT[pf.slot] !== rt) { disposeFigure(fig); return; }
    rt.fig = fig; stage.scene.add(fig.root); poke();
    rt.handles = makeHandles(fig, COLORS[pf.slot]); stage.scene.add(rt.handles.group);
    rt.ring = new THREE.Mesh(new THREE.RingGeometry(.34, .39, 48), new THREE.MeshBasicMaterial({ color: COLORS[pf.slot], transparent: true, opacity: .85, depthWrite: false }));
    rt.ring.rotation.x = -Math.PI / 2; rt.ring.position.y = .012; fig.root.add(rt.ring);
    poseFig(pf, rt, UI.frame, 0); fig.vrm.springBoneManager && fig.vrm.springBoneManager.reset();
    renderPanel(); if (pf.slot === UI.selFig && UI.tab === 'face') camTo('face');
  } catch (e) { console.error(e); toast(`${name} ließ sich nicht laden`); if (RT[pf.slot] === rt) delete RT[pf.slot]; }
  loading(-1);
}

// ---------- Jedes Bild: Werte ausrechnen und anwenden ----------
const fract = x => x - Math.floor(x);
function blinkAt(slot, t) {   // eigenes Blinzeln, jedes Mal gleich (wichtig fürs Wiederholen)
  const per = 3.4, off = slot * 1.27, k = Math.floor((t - off) / per);
  for (const j of [k, k - 1]) { const s = off + j * per + fract(Math.sin((j + 7) * 12.9898 + slot * 78.233) * 43758.5453) * 1.6, u = (t - s) / .2; if (u >= 0 && u <= 1) return Math.min(1, 2.2 * (1 - Math.abs(u * 2 - 1))); }
  return 0;
}
function poseFig(pf, rt, ft, dt) {
  const v = evalFig(pf, ft), t = ft / FPS;
  const face = { brow: v.brow, eye: { ...v.eye }, mouth: v.mouth, talk: { ...v.talk } };
  if (pf.blink) { const b = blinkAt(pf.slot, t); if (b > 0) face.eye.Close = Math.max(face.eye.Close || 0, b); }
  const lip = lipAt(P, pf.slot, t); if (lip) for (const k in lip) face.talk[k] = Math.max(face.talk[k] || 0, lip[k]);
  applyBody(rt.fig, v.body); applyHead(rt.fig, v.head); applyFaceBefore(rt.fig, face, v.head);
  rt.fig.vrm.update(dt);
  if (rt.fig.eyeLink) for (const [from, to] of rt.fig.eyeLink) to.quaternion.copy(from.quaternion);   // eigene Figuren: Blick aufs mitgebrachte Gesicht
  applyFaceAfter(rt.fig, face);
  const show = !UI.film && UI.tab === 'body' && UI.selFig === pf.slot && !UI.moveMode;
  rt.handles.group.visible = show; if (show) placeHandles(rt.fig, rt.handles, UI.joint);
  rt.ring.visible = !UI.film && UI.selFig === pf.slot && P.figs.length > 1;
}
let last = performance.now();
// Leistung: (1) nichts zeichnen, wenn eine Weile nichts passiert (spart Akku), (2) Auflösung an das Gerät anpassen
let lastActive = performance.now();
const poke = () => { lastActive = performance.now(); };
for (const ev of ['pointerdown', 'wheel', 'keydown', 'resize']) window.addEventListener(ev, poke, { capture: true, passive: true });
window.addEventListener('pointermove', e => { if (e.buttons) poke(); }, { capture: true, passive: true });
const DPR_MAX = Math.min(window.devicePixelRatio || 1, matchMedia('(pointer: coarse)').matches ? 1.5 : 2), perf = { dpr: DPR_MAX, sum: 0, n: 0 };
stage.renderer.setPixelRatio(perf.dpr);
function adapt(dt) {
  perf.sum += dt; if (++perf.n < 90) return;
  const avg = perf.sum / perf.n; perf.sum = perf.n = 0;
  const next = avg > 1 / 38 ? Math.max(1, perf.dpr - .25) : avg < 1 / 57 ? Math.min(DPR_MAX, perf.dpr + .25) : perf.dpr;
  if (next !== perf.dpr) { perf.dpr = next; stage.renderer.setPixelRatio(next); }
}
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(.05, Math.max(0, (now - last) / 1000)); last = now;
  if (UI.exporting) return;   // der Export zeichnet selbst
  if (!UI.playing && !UI.rec && !UI.film && now - lastActive > 2500) return;   // Ruhe: Bild bleibt stehen
  adapt(dt);
  if (UI.playing) {
    const f = (UI.playFrom + (now - UI.playT0) / 1000) * FPS;
    if (f >= P.len * FPS) { UI.frame = P.len * FPS; stopPlay(); if (UI.film) setTimeout(exitFilm, 1200); } else UI.frame = Math.max(UI.playFrom * FPS, f);
    $('tTime').textContent = fmtT(UI.frame); tl.draw();
  }
  stage.resize();
  for (const pf of P.figs) { const rt = RT[pf.slot]; if (rt && rt.fig) poseFig(pf, rt, UI.frame, dt); }
  stage.tick(UI.frame / FPS);
  stage.renderer.render(stage.scene, stage.camera);
}

// ---------- Abspielen ----------
function resetSprings() { for (const k in RT) { const f = RT[k].fig; if (f && f.vrm.springBoneManager) f.vrm.springBoneManager.reset(); } }
async function play() {
  if (UI.playing) { stopPlay(); return; }
  if (UI.rec || UI.starting) return;
  // iPad: Ton erst nach einem Tippen freigeschaltet. Bild und Ton erst starten, wenn er wirklich läuft, sonst läuft der Mund vorweg.
  const ctx = audio(); if (ctx && ctx.state !== 'running') { UI.starting = true; try { await ctx.resume(); } catch (e) {} UI.starting = false; }
  if (UI.frame >= P.len * FPS - 1) UI.frame = 0;
  UI.playing = true; UI.playFrom = UI.frame / FPS; UI.playT0 = performance.now() + 50; UI.stopAudio = playClips(P, UI.playFrom, undefined, UI.recDest || null);
  $('tPlay').textContent = '⏸'; resetSprings();
}
function stopPlay() {
  if (!UI.playing) return; UI.playing = false; if (UI.stopAudio) UI.stopAudio(); UI.stopAudio = null;
  $('tPlay').textContent = '▶'; UI.frame = curF(); $('tTime').textContent = fmtT(UI.frame); tl.draw(); refreshPanel();
}
function setFrame(f) {
  poke();
  f = clamp(Math.round(f), 0, P.len * FPS); if (UI.playing) stopPlay();
  if (Math.abs(f - UI.frame) > 3) resetSprings();
  UI.frame = f; $('tTime').textContent = fmtT(f); tl.draw(); refreshPanel();
}
$('tPlay').onclick = play;
$('tStart').onclick = () => setFrame(0);
$('tPrev').onclick = () => setFrame(curF() - 1);
$('tNext').onclick = () => setFrame(curF() + 1);
const jumpKey = dir => { const pf = selPF(); if (!pf) return; const fs = keyFrames(pf, UI.profi && UI.sel && UI.sel.ch ? [UI.sel.ch] : CHANNELS), c = curF();
  const f = dir < 0 ? fs.filter(x => x < c).pop() : fs.find(x => x > c); if (f != null) { setFrame(f); UI.sel = { kind: 'key', slot: pf.slot, ch: null, f }; syncKeyActs(); tl.draw(); } };
$('kPrev').onclick = () => jumpKey(-1); $('kNext').onclick = () => jumpKey(1);

// ---------- Film ansehen (groß, ohne Knöpfe) ----------
function film() {
  if (!P.figs.length) { toast('Sucht zuerst Figuren aus'); return; }
  UI.film = true; document.body.classList.add('film'); $('filmExit').hidden = false;
  UI.frame = 0; play();
  try { if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {}); } catch (e) {}
}
function exitFilm() {
  if (!UI.film) return; UI.film = false; stopPlay(); if (UI.onFilmEnd) { UI.onFilmEnd(); UI.onFilmEnd = null; } document.body.classList.remove('film'); $('filmExit').hidden = true;
  try { if (document.fullscreenElement) document.exitFullscreen(); } catch (e) {}
}
$('bFilm').onclick = film;

// ---------- Film als Video speichern ----------
// Schneller Weg: jedes Bild einzeln rechnen (30 pro Sekunde, 1280×720) und mit WebCodecs zu MP4 verpacken.
// Kann der Browser das nicht (z. B. ältere iPads), wird der Film beim Abspielen mitgeschnitten (MediaRecorder).
let MP4_cfg = null; MP4_check().then(c => { MP4_cfg = c; });
const slugT = () => (P.title || 'film').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'film';
async function videoExport() {
  if (!P.figs.length) { toast('Sucht zuerst Figuren aus'); return; }
  if (UI.playing) stopPlay();
  if (!MP4_cfg) { videoRecord(); return; }
  const job = { cancel: false }, show = q => loading(0, `Video wird gemacht … ${Math.round(q * 100)} %  (tippen = abbrechen)`);
  UI.exporting = job; loading(1, 'Video wird gemacht …'); $('loading').onclick = () => { job.cancel = true; };
  const R = stage.renderer, cam = stage.camera, old = { dpr: R.getPixelRatio(), size: R.getSize(new THREE.Vector2()), aspect: cam.aspect, frame: UI.frame };
  let aenc = null, venc = null, err = null; const fail = e => { err = err || e || new Error('encoder'); }, stop = () => { if (job.cancel) throw { code: 'cancelled' }; };
  try {
    const rate = 30, N = Math.max(1, Math.round(P.len * rate)), W = 1280, H = 720, sr = MP4_cfg.a.sampleRate;
    // --- Ton: alle Clips in einem stillen Rechen-Kontext
    for (const [id, v] of Object.entries(P.voices)) await bufferOf(id, v);
    const O = window.OfflineAudioContext || window.webkitOfflineAudioContext, off = new O(2, Math.ceil(N / rate * sr), sr);
    playClips(P, 0, off, off.destination);
    const pcm = await off.startRendering(); stop();
    const L = pcm.length, ch = [0, 1].map(i => pcm.getChannelData(Math.min(i, pcm.numberOfChannels - 1))), aS = []; let asc = null;
    aenc = new AudioEncoder({ output: (c, m) => { const d = new Uint8Array(c.byteLength); c.copyTo(d); aS.push({ d }); const x = m && m.decoderConfig && m.decoderConfig.description; if (x && !asc) asc = MP4_bytes(x); }, error: fail });
    aenc.configure(MP4_cfg.a);
    for (let o = 0; o < L; o += sr) {
      const n = Math.min(sr, L - o), data = new Float32Array(n * 2); data.set(ch[0].subarray(o, o + n), 0); data.set(ch[1].subarray(o, o + n), n);
      const ad = new AudioData({ format: 'f32-planar', sampleRate: sr, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round(o / sr * 1e6), data }); aenc.encode(ad); ad.close();
      await MP4_drain(aenc); stop(); if (err) throw err;
    }
    await aenc.flush(); if (err) throw err;
    if (!asc) { const fi = sr === 44100 ? 4 : 3; asc = new Uint8Array([2 << 3 | fi >> 1, (fi & 1) << 7 | 2 << 3]); }
    show(.05);
    // --- Bild: Bühne auf 1280×720 stellen, Griffe und Ringe aus (UI.film), jedes Bild rechnen
    R.setPixelRatio(1); R.setSize(W, H, false); cam.aspect = W / H; cam.updateProjectionMatrix(); UI.film = true; resetSprings();
    const c2 = document.createElement('canvas'); c2.width = W; c2.height = H; const x2 = c2.getContext('2d', { willReadFrequently: true }), yuv = new Uint8Array(W * H * 3 / 2), vS = [];
    let avcC = null;
    venc = new VideoEncoder({ output: (c, m) => { const d = new Uint8Array(c.byteLength); c.copyTo(d); vS.push({ d, key: c.type === 'key', n: Math.round(c.timestamp * rate / 1e6) }); const dc = m && m.decoderConfig; if (dc && dc.description && !avcC) avcC = MP4_bytes(dc.description); }, error: fail });
    venc.configure({ ...MP4_cfg.v, width: W, height: H, framerate: rate });
    for (let n = 0; n < N; n++) {
      UI.frame = n / rate * FPS;
      for (const pf of P.figs) { const rt = RT[pf.slot]; if (rt && rt.fig) poseFig(pf, rt, UI.frame, 1 / rate); }
      stage.tick(UI.frame / FPS); R.render(stage.scene, cam);
      x2.drawImage(R.domElement, 0, 0, W, H);   // gleich nach dem Rendern, solange das Bild noch da ist
      const f = new VideoFrame(MP4_i420(x2.getImageData(0, 0, W, H).data, W, H, yuv), { timestamp: Math.round(n * 1e6 / rate), duration: Math.round(1e6 / rate), format: 'I420', codedWidth: W, codedHeight: H, colorSpace: MP4_CS });
      venc.encode(f, { keyFrame: n % (rate * 2) === 0 }); f.close();
      await MP4_drain(venc); if (n % 3 === 2) { show(.05 + .93 * n / N); await MP4_tick(); }
      stop(); if (err) throw err;
    }
    await venc.flush(); if (err) throw err;
    if (!avcC || vS.length !== N) throw new Error('video incomplete');
    const blob = MP4_mux({ w: W, h: H, scale: 12000, delta: 12000 / rate, samples: vS, avcC, color: [1, 1, 1, false] }, { sr, ch: 2, bitrate: MP4_cfg.a.bitrate, samples: aS, asc });
    UI.lastVideo = blob.size;
    await download(slugT() + '.mp4', blob); toast('Video gespeichert');
  } catch (e) {
    if (!(e && e.code === 'cancelled')) { console.error(e); MP4_cfg = null; toast('Das schnelle Video ging hier nicht. Tippt nochmal, dann wird der Film beim Abspielen aufgenommen.'); }
  } finally {
    for (const e of [aenc, venc]) try { if (e && e.state !== 'closed') e.close(); } catch (x) {}
    UI.film = false; UI.exporting = null; $('loading').onclick = null; loading(-1);
    R.setPixelRatio(old.dpr); R.setSize(old.size.x, old.size.y, false); cam.aspect = old.aspect; cam.updateProjectionMatrix(); UI.frame = old.frame; resetSprings(); poke();
  }
}
// Notlösung: Film abspielen und Bild + Ton mitschneiden
function videoRecord() {
  const M = window.MediaRecorder, cvs = stage.renderer.domElement;
  const type = M && cvs.captureStream && ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'].find(t => { try { return M.isTypeSupported(t); } catch (e) { return false; } });
  if (!type) { toast('Dieser Browser kann kein Video speichern'); return; }
  const ac = audio(), dest = ac.createMediaStreamDestination(), chunks = [];
  const ms = new MediaStream([...cvs.captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()]), rec = new M(ms, { mimeType: type, videoBitsPerSecond: 5e6 });
  rec.ondataavailable = e => e.data.size && chunks.push(e.data);
  rec.onstop = async () => { ms.getTracks().forEach(t => t.stop()); UI.recDest = null; if (!chunks.length) return; await download(`${slugT()}.${type.includes('mp4') ? 'mp4' : 'webm'}`, new Blob(chunks, { type })); toast('Video gespeichert'); };
  UI.recDest = dest; UI.onFilmEnd = () => { if (rec.state === 'recording') rec.stop(); };
  rec.start(500); film(); toast('Der Film wird aufgenommen …');
}


// ---------- Keys setzen (automatisch beim Verändern) ----------
const curVal = ch => cloneVal(evalCh(selPF(), ch, UI.frame));
function keyNow(ch, v) {
  const pf = selPF(); if (!pf) return; const f = curF(); UI.frame = f;
  setKey(pf.keys[ch], f, v); UI.sel = { kind: 'key', slot: pf.slot, ch: UI.profi ? ch : null, f };
  changed();
}
function selKeys() {   // [[keys-Array, Key]] des ausgewählten Schlüsselbilds
  const s = UI.sel; if (!s || s.kind !== 'key') return [];
  const pf = P.figs.find(f => f.slot === s.slot); if (!pf) return [];
  return (s.ch ? [s.ch] : CHANNELS).map(c => [pf.keys[c], findKey(pf.keys[c], s.f), c]).filter(x => x[1]);
}
function syncKeyActs() {
  const ks = selKeys(), clip = UI.sel && UI.sel.kind === 'clip';
  $('kDel').disabled = !ks.length && !clip; $('kCopy').disabled = !ks.length; $('kPaste').disabled = !UI.clip || !selPF();
  $('kEase').disabled = !ks.length; $('kEase').textContent = ks.length && ks.every(([, k]) => k.s) ? 'plötzlich' : 'weich';
}
$('kDel').onclick = () => {
  const s = UI.sel; if (!s) return; checkpoint();
  if (s.kind === 'clip') P.clips = P.clips.filter(c => c.id !== s.id);
  else for (const [keys, k] of selKeys()) delKey(keys, k.f);
  UI.sel = null; changed(); renderPanel();
};
$('kCopy').onclick = () => { const ks = selKeys(); if (!ks.length) return; UI.clip = Object.fromEntries(ks.map(([, k, c]) => [c, cloneVal(k.v)])); toast('Kopiert. Gelbe Linie verschieben, dann „Einfügen“.'); syncKeyActs(); };
$('kPaste').onclick = () => {
  const pf = selPF(); if (!UI.clip || !pf) return; checkpoint();
  for (const c in UI.clip) { const v = cloneVal(UI.clip[c]); if (c === 'body') v.p = evalCh(pf, 'body', UI.frame).p.slice(); setKey(pf.keys[c], curF(), v); }
  UI.sel = { kind: 'key', slot: pf.slot, ch: null, f: curF() }; changed();
};
$('kEase').onclick = () => { const ks = selKeys(); if (!ks.length) return; checkpoint(); const on = !ks.every(([, k]) => k.s); for (const [, k] of ks) { if (on) k.s = 1; else delete k.s; } changed(); };

// ---------- Zeitleiste ----------
const tl = makeTimeline($('tlc'), {
  project: () => P, frame: () => UI.frame, setFrame,
  sel: () => UI.sel, setSel: s => { UI.sel = s; if (s && s.kind === 'clip') { setTab('sound'); } syncKeyActs(); renderClipBox(); },
  selFig: () => UI.selFig, setSelFig: slot => { if (slot !== UI.selFig) selectFig(slot); },
  profi: () => UI.profi, color: s => COLORS[s], figName: s => { const pf = P.figs.find(f => f.slot === s); return pf ? nameOf(pf) : ''; },
  moveKeys(slot, ch, from, to) {
    const pf = P.figs.find(f => f.slot === slot); if (!pf) return; checkpoint();
    for (const c of ch ? [ch] : CHANNELS) moveKey(pf.keys[c], from, to);
    UI.sel = { kind: 'key', slot, ch, f: to }; setFrame(to); changed();
  },
  moveClip(id, f) { const c = P.clips.find(x => x.id === id); if (!c) return; checkpoint(); c.f = f; changed(); },
});
$('tProfi').onchange = e => { UI.profi = e.target.checked; tl.draw(); };
const LENS = [5, 10, 15, 20, 30, 45, 60];
$('tLen').innerHTML = LENS.map(s => `<option value="${s}">${s} s</option>`).join('');
$('tLen').onchange = e => { checkpoint(); P.len = +e.target.value; setFrame(Math.min(UI.frame, P.len * FPS)); changed(); };

// ---------- Figuren-Auswahl oben in der Leiste ----------
function renderChips() {
  $('figChips').innerHTML = [...P.figs].sort((a, b) => a.slot - b.slot).map(pf =>
    `<button class="chip ${pf.slot === UI.selFig ? 'on' : ''}" data-slot="${pf.slot}" style="color:${COLORS[pf.slot]}"><img src="figuren/${pf.model}.png" alt=""><span style="color:var(--text)">${esc(nameOf(pf))}</span></button>`).join('')
    || '<p class="note" style="padding:0 4px">Noch keine Figur. Oben auf „👥 Figuren“ tippen.</p>';
}
$('figChips').onclick = e => { const b = e.target.closest('.chip'); if (b) selectFig(+b.dataset.slot); };
function selectFig(slot) {
  UI.selFig = slot; UI.joint = null; renderChips(); renderPanel(); tl.draw();
  if (UI.tab === 'face') camTo('face'); else if (UI.tab === 'body') camTo('body');
}

// ---------- Kamera ----------
function camTo(kind) {
  poke();
  const rt = selRT();
  if (kind === 'all' || !rt) { stage.flyTo(new THREE.Vector3(0, 1.25, 4.4), new THREE.Vector3(0, 1, 0)); return; }
  const r = rt.fig.root.rotation.y, fwd = new THREE.Vector3(Math.sin(r), 0, Math.cos(r));
  if (kind === 'face') {
    // Ziel: Mitte zwischen Hals und Kopf-Oberkante, Abstand nach Kopfgröße (VRoid-Kopf ≈ 0,29 m → 0,78 m)
    const hs = rt.fig.headSize, neck = (rt.fig.bone('neck') || rt.fig.bone('head')).getWorldPosition(new THREE.Vector3());
    const hp = neck.add(new THREE.Vector3(0, hs * .5, 0));
    stage.flyTo(hp.clone().addScaledVector(fwd, Math.max(.7, hs * 2.7)).add(new THREE.Vector3(0, .02, 0)), hp);
  } else {
    const H = rt.fig.height, mid = rt.fig.root.position.clone().add(new THREE.Vector3(0, H * .5, 0));
    stage.flyTo(mid.clone().addScaledVector(fwd, Math.max(2.2, H * 1.7)).add(new THREE.Vector3(0, .25, 0)), mid);
  }
}
$('camBar').onclick = e => { const b = e.target.closest('button'); if (b) camTo(b.dataset.cam); };

// ---------- Seitenleiste: Reiter ----------
function setTab(t) {
  if (UI.tab === t) return; UI.tab = t; UI.moveMode = false;
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  for (const id of ['face', 'body', 'sound']) $('tab' + id[0].toUpperCase() + id.slice(1)).hidden = id !== t;
  renderPanel(); if (t === 'face') camTo('face'); if (t === 'body') camTo('body');
}
document.querySelector('.tabs').onclick = e => { const b = e.target.closest('button'); if (b) setTab(b.dataset.tab); };

// Kleine Bildchen für Brauen, Augen und Mund
const S = (d, extra = '') => `<svg viewBox="0 0 44 28" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">${d}${extra}</svg>`;
const eyeO = (x, r = 4.5) => `<circle cx="${x}" cy="15" r="${r}"/><circle cx="${x}" cy="15" r="1.6" fill="currentColor"/>`;
const eyeC = x => `<path d="M${x - 6} 15 Q${x} 19 ${x + 6} 15"/>`;
const ICON = {
  brow: { '': S('<path d="M5 14H18M26 14H39"/>'), Joy: S('<path d="M5 16Q11 7 18 13M26 13Q33 7 39 16"/>'), Fun: S('<path d="M5 15Q11 11 18 14M26 14Q33 11 39 15"/>'),
    Angry: S('<path d="M5 9L18 17M26 17L39 9"/>'), Sorrow: S('<path d="M5 17L18 9M26 9L39 17"/>'), Surprised: S('<path d="M5 12Q11 2 18 8M26 8Q33 2 39 12"/>') },
  eye: { '': S(eyeO(12) + eyeO(32)), Close: S(eyeC(12) + eyeC(32)), Close_R: S(eyeC(12) + eyeO(32)), Close_L: S(eyeO(12) + eyeC(32)),
    Joy: S('<path d="M6 18Q12 8 18 18M26 18Q32 8 38 18"/>'), Angry: S(eyeO(12, 4) + eyeO(32, 4) + '<path d="M5 8L19 12M25 12L39 8"/>'),
    Sorrow: S(eyeO(12, 4) + eyeO(32, 4) + '<path d="M5 11L19 8M25 8L39 11"/>'), Surprised: S(eyeO(12, 6.5) + eyeO(32, 6.5)) },
  mouth: { '': S('<path d="M13 15H31"/>'), Joy: S('<path d="M10 10H34Q31 25 22 25Q13 25 10 10Z" fill="currentColor" fill-opacity=".25"/>'), Fun: S('<path d="M10 11Q22 23 34 11"/>'),
    Up: S('<path d="M12 12Q22 20 32 12"/>'), Down: S('<path d="M12 19Q22 11 32 19"/>'), Angry: S('<path d="M10 11H34L31 20H13Z"/><path d="M14 15.5H30" stroke-width="1.4"/>'),
    Sorrow: S('<path d="M10 21Q22 8 34 21"/>'), Surprised: S('<ellipse cx="22" cy="15" rx="6" ry="8"/>') },
  talk: { '': S('<path d="M13 15H31"/>'), A: S('<ellipse cx="22" cy="14" rx="8" ry="9"/>'), I: S('<ellipse cx="22" cy="14" rx="13" ry="3.5"/>'),
    U: S('<ellipse cx="22" cy="14" rx="4.5" ry="5.5"/>'), E: S('<ellipse cx="22" cy="14" rx="11" ry="6"/>'), O: S('<ellipse cx="22" cy="14" rx="7.5" ry="8.5"/>') },
};
const NEUTRAL = { brow: 'normal', eye: 'offen', mouth: 'normal', talk: 'zu' };

function renderPanel() {
  const pf = selPF(), rt = selRT();
  const none = '<p class="note">Wählt oben eine Figur aus.</p>';
  if (UI.tab === 'face') {
    if (!pf) { $('tabFace').innerHTML = none; return; }
    // Was kann das Gesicht? VRoid-Figuren alles einzeln, die Wesen zeigen Gefühle mit dem ganzen Gesicht.
    const can = (ch, id) => !rt || rt.fig.can(FACE[ch].find(s => s.id === id));
    const full = !rt || FACE.brow.some(s => rt.fig.can(s));
    const emoOk = E => E.id === 'neutral' || ['brow', 'eye', 'mouth'].some(ch => Object.keys(E[ch]).some(id => can(ch, id)));
    let h = `<h3>Gefühl <span class="kd" data-kd="emo"></span></h3><p class="note">${full ? 'Setzt Brauen, Augen und Mund auf einmal. Danach könnt ihr jedes Teil einzeln ändern.'
      : 'Bei dieser Figur wirkt ein Gefühl auf das ganze Gesicht. Einzelne Augenbrauen hat sie nicht.'}</p>
      <div class="btns wide" id="emo">${EMOTIONS.map(e => `<button data-emo="${e.id}" ${emoOk(e) ? '' : 'disabled'}><span class="em">${e.icon}</span>${e.name}</button>`).join('')}</div>`;
    for (const ch of ['brow', 'eye', 'mouth', 'talk']) {
      if (rt && !FACE[ch].some(s => rt.fig.can(s))) continue;
      h += `<h3>${ch === 'mouth' && !full ? 'Gesichtsausdruck' : CH_NAME[ch]} <span class="kd" data-kd="${ch}"></span></h3><div class="btns" data-ch="${ch}">
        <button data-shape="">${ICON[ch]['']}<span>${NEUTRAL[ch]}</span></button>
        ${FACE[ch].map(s => `<button data-shape="${s.id}" ${rt && !rt.fig.can(s) ? 'disabled' : ''}>${ICON[ch][s.id] || ''}<span>${s.name}</span></button>`).join('')}</div>
        <div class="str">Stärke <input type="range" min="10" max="100" step="5" data-str="${ch}"></div>`;
      if (ch === 'talk') h += `<p class="note">Tipp: Im Reiter 🔊 Ton eure Stimme aufnehmen, dann spricht der Mund von selbst.</p>`;
    }
    h += `<h3>Kopf &amp; Blick <span class="kd" data-kd="head"></span></h3>
      <div class="pads">${rt && !rt.fig.canLook ? '<div class="pad">👀 Blick<p class="note">Diese Figur kann die Augen nicht bewegen. Dreht dafür den Kopf.</p></div>'
        : '<div class="pad">👀 Blick<div class="box" data-pad="look"><div class="dot"></div></div></div>'}
      <div class="pad">🙂 Kopf drehen<div class="box" data-pad="head"><div class="dot"></div></div></div></div>
      <div class="str">Kopf neigen <input type="range" min="-30" max="30" step="1" data-tilt></div>
      <div class="row" style="margin-top:8px"><button data-headreset>Kopf gerade</button><label class="tog"><input type="checkbox" data-blink ${pf.blink ? 'checked' : ''}> Von selbst blinzeln</label></div>`;
    $('tabFace').innerHTML = h;
  } else if (UI.tab === 'body') {
    if (!pf) { $('tabBody').innerHTML = none; return; }
    $('tabBody').innerHTML = `<p class="note">Tippt einen <b>Punkt</b> an der Figur an und zieht: So dreht ihr das Körperteil. Für Bewegungen nach vorn oder hinten die Bühne seitlich drehen.</p>
      <div class="row"><button data-jreset>Gelenk zurück</button><button data-mirror>⇋ Spiegeln</button></div>
      <h3>Posen <span class="kd" data-kd="body"></span></h3>
      <div class="btns wide">${Object.entries(POSES).map(([id, p]) => `<button data-pose="${id}"><span class="em">${p.icon}</span>${p.name}</button>`).join('')}</div>
      <h3>Bewegen</h3>
      <div class="row"><button data-move class="${UI.moveMode ? 'accent' : ''}">✋ ${UI.moveMode ? 'Verschieben an' : 'Verschieben'}</button>
        <button data-turn="-45">↺ 45°</button><button data-turn="45">↻ 45°</button></div>
      <div class="str">Drehen <input type="range" min="-180" max="180" step="5" data-rot></div>
      <div class="str">Höhe (Hüpfen) <input type="range" min="0" max="80" step="1" data-hop></div>`;
  } else {
    const name = pf ? esc(nameOf(pf)) : '';
    $('tabSound').innerHTML = `${pf ? `<h3>Stimme von ${name}</h3>
      <button class="recbtn ${UI.rec ? 'rec' : ''}" data-rec>${UI.rec ? '■ Stopp' : '🎙 Aufnehmen'}</button>
      <p class="note">Die Aufnahme beginnt an der gelben Linie, der Film läuft dabei ohne Ton mit. Der Mund von ${name} bewegt sich von selbst.</p>` : ''}
      <h3>Geräusche &amp; Musik</h3><p class="note">Tippen = anhören und an der gelben Linie einfügen.</p>
      <div class="btns wide">${FX.map(f => `<button data-fx="${f.id}"><span class="em">${f.icon}</span>${f.name}</button>`).join('')}</div>
      <h3>Eigene Datei</h3><button data-file>📂 Musik oder Geräusch laden (mp3, m4a, wav)</button>
      <div id="clipBox"></div>`;
    renderClipBox();
  }
  refreshPanel();
}

// Knöpfe und Regler an den aktuellen Wert anpassen (nach Scrubben, Rückgängig …)
function refreshPanel() {
  const pf = selPF(); if (!pf || UI.playing) return;
  const f = curF(), kd = ch => pf.keys[ch].some(k => k.f === f) ? '◆ Schlüsselbild' : '';
  if (UI.tab === 'face') {
    for (const ch of ['brow', 'eye', 'mouth', 'talk']) {
      const v = evalCh(pf, ch, UI.frame), on = Object.keys(v).filter(k => v[k] > .05), box = document.querySelector(`[data-ch="${ch}"]`); if (!box) continue;
      box.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.shape ? on.includes(b.dataset.shape) : !on.length));
      const mx = Math.max(0, ...Object.values(v)); const s = document.querySelector(`[data-str="${ch}"]`); if (s) s.value = Math.round((on.length ? mx : UI.strength[ch]) * 100);
      const k = document.querySelector(`[data-kd="${ch}"]`); if (k) k.textContent = kd(ch);
    }
    const hv = evalCh(pf, 'head', UI.frame);
    const put = (pad, x, y) => { const d = document.querySelector(`[data-pad="${pad}"] .dot`); if (d) { d.style.left = (50 + x * 42) + '%'; d.style.top = (50 + y * 42) + '%'; } };
    put('look', hv.lx, hv.ly); put('head', hv.y / 60, hv.p / 35);
    const t = document.querySelector('[data-tilt]'); if (t) t.value = -hv.t;
    const k = document.querySelector('[data-kd="head"]'); if (k) k.textContent = kd('head');
  } else if (UI.tab === 'body') {
    const bv = evalCh(pf, 'body', UI.frame);
    const r = document.querySelector('[data-rot]'); if (r) r.value = ((bv.r + 180) % 360 + 360) % 360 - 180;
    const hop = document.querySelector('[data-hop]'); if (hop) hop.value = Math.round(bv.p[1] * 100);
    const k = document.querySelector('[data-kd="body"]'); if (k) k.textContent = kd('body');
  }
}

// ---------- Gesicht bedienen ----------
let gesture = false;   // ein Regler-Zug = ein Rückgängig-Schritt
const once = () => { if (!gesture) { checkpoint(); gesture = true; } };
window.addEventListener('pointerup', () => { gesture = false; });
window.addEventListener('change', () => { gesture = false; });
$('tabFace').addEventListener('click', e => {
  const pf = selPF(); if (!pf) return;
  const emo = e.target.closest('[data-emo]');
  if (emo) { const E = EMOTIONS.find(x => x.id === emo.dataset.emo); checkpoint(); for (const ch of ['brow', 'eye', 'mouth']) keyNow(ch, { ...E[ch] }); return; }
  const sb = e.target.closest('[data-shape]');
  if (sb) { const ch = sb.parentElement.dataset.ch, id = sb.dataset.shape; checkpoint(); keyNow(ch, id ? { [id]: UI.strength[ch] } : {}); return; }
  if (e.target.closest('[data-headreset]')) { checkpoint(); keyNow('head', { ...curVal('head'), y: 0, p: 0, t: 0, lx: 0, ly: 0 }); return; }
});
$('tabFace').addEventListener('input', e => {
  const pf = selPF(); if (!pf) return;
  const s = e.target.dataset.str;
  if (s) {
    const w = e.target.value / 100; UI.strength[s] = w; const v = curVal(s), mx = Math.max(0, ...Object.values(v));
    if (mx > 0) { once(); for (const k in v) v[k] = Math.min(1, v[k] / mx * w); keyNow(s, v); }
    return;
  }
  if (e.target.dataset.tilt !== undefined) { once(); keyNow('head', { ...curVal('head'), t: -e.target.value }); }
});
$('tabFace').addEventListener('change', e => { if (e.target.dataset.blink !== undefined) { const pf = selPF(); checkpoint(); pf.blink = e.target.checked; scheduleSave(); } });
// Blick- und Kopf-Feld: mit dem Finger ziehen
$('tabFace').addEventListener('pointerdown', e => {
  const box = e.target.closest('.box'); if (!box || !selPF()) return;
  e.preventDefault(); box.setPointerCapture(e.pointerId); checkpoint();
  const move = ev => {
    const r = box.getBoundingClientRect(), x = clamp(((ev.clientX - r.left) / r.width - .5) / .42, -1, 1), y = clamp(((ev.clientY - r.top) / r.height - .5) / .42, -1, 1);
    const v = curVal('head'); if (box.dataset.pad === 'look') { v.lx = x; v.ly = y; } else { v.y = x * 60; v.p = y * 35; }
    keyNow('head', v);
  };
  move(e); box.onpointermove = move; box.onpointerup = box.onpointercancel = () => { box.onpointermove = null; };
});

// ---------- Körper bedienen ----------
$('tabBody').addEventListener('click', e => {
  const pf = selPF(); if (!pf) return;
  const pz = e.target.closest('[data-pose]');
  if (pz) { checkpoint(); const v = curVal('body'); v.b = cloneVal(POSES[pz.dataset.pose].b); keyNow('body', v); return; }
  if (e.target.closest('[data-mirror]')) { checkpoint(); const v = curVal('body'); v.b = mirrorBones(v.b); keyNow('body', v); return; }
  if (e.target.closest('[data-jreset]')) {
    if (!UI.joint) { toast('Tippt zuerst einen Punkt an der Figur an'); return; }
    checkpoint(); if (UI.joint === 'head') { keyNow('head', { ...curVal('head'), y: 0, p: 0, t: 0 }); return; }
    const v = curVal('body'); for (const b of HANDLES[UI.joint].bones) { if (POSES.stehen.b[b]) v.b[b] = cloneVal(POSES.stehen.b[b]); else delete v.b[b]; } keyNow('body', v); return;
  }
  if (e.target.closest('[data-move]')) { UI.moveMode = !UI.moveMode; stage.controls.enabled = !UI.moveMode; renderPanel(); if (UI.moveMode) toast('Zieht jetzt auf der Bühne, um die Figur zu verschieben'); return; }
  const t = e.target.closest('[data-turn]'); if (t) { checkpoint(); const v = curVal('body'); v.r += +t.dataset.turn; keyNow('body', v); }
});
$('tabBody').addEventListener('input', e => {
  if (!selPF()) return; const d = e.target.dataset;
  if (d.rot !== undefined) { once(); const v = curVal('body'); v.r = +e.target.value; keyNow('body', v); }
  if (d.hop !== undefined) { once(); const v = curVal('body'); v.p[1] = e.target.value / 100; keyNow('body', v); }
});

// Auf der Bühne: Gelenk-Punkte ziehen, Figur verschieben, Figur antippen
const view = $('view'), cvs = $('c3d'), _p = new THREE.Vector3();
const local = e => { const r = cvs.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
const screenOf = v => { _p.copy(v).project(stage.camera); return { x: (_p.x + 1) / 2 * cvs.clientWidth, y: (1 - _p.y) / 2 * cvs.clientHeight, z: _p.z }; };
function pickHandle(rt, p) {
  let best = null, bd = 34;
  for (const id in rt.handles.items) { const s = screenOf(rt.handles.items[id].position), d = Math.hypot(s.x - p.x, s.y - p.y); if (s.z < 1 && d < bd) { bd = d; best = id; } }
  return best;
}
const ray = new THREE.Raycaster();
function groundHit(p, y = 0) {
  ray.setFromCamera(new THREE.Vector2(p.x / cvs.clientWidth * 2 - 1, -(p.y / cvs.clientHeight) * 2 + 1), stage.camera);
  return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), new THREE.Vector3());
}
function dragJoint(id, prev, cur) {
  const rt = selRT(), fig = rt.fig;
  if (id === 'head') { const v = curVal('head'); v.y = clamp(v.y + (cur.x - prev.x) * .35, -75, 75); v.p = clamp(v.p + (cur.y - prev.y) * .35, -40, 45); keyNow('head', v); return; }
  const d = HANDLES[id], v = curVal('body'); applyBody(fig, v);
  const pv = screenOf(fig.bone(d.pivot).getWorldPosition(new THREE.Vector3()));
  const a = { x: prev.x - pv.x, y: prev.y - pv.y }, b = { x: cur.x - pv.x, y: cur.y - pv.y };
  if (Math.hypot(a.x, a.y) < 6 || Math.hypot(b.x, b.y) < 6) return;
  const ang = Math.atan2(a.x * b.y - a.y * b.x, a.x * b.x + a.y * b.y);
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(stage.camera.quaternion);
  const qd = new THREE.Quaternion().setFromAxisAngle(fwd, ang / d.bones.length);
  for (const bn of d.bones) {
    const node = fig.bone(bn); if (!node) continue;
    const pq = node.parent.getWorldQuaternion(new THREE.Quaternion());
    node.quaternion.premultiply(pq.clone().invert().multiply(qd).multiply(pq));
    v.b[bn] = roundQ(readQ(node, fig.v0));
  }
  keyNow('body', v);
}
function pickFigure(p) {
  let best = null, bd = 1e9;
  for (const pf of P.figs) {
    const rt = RT[pf.slot]; if (!rt || !rt.fig) continue;
    const top = screenOf(rt.fig.bone('head').getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, .15, 0))), foot = screenOf(rt.fig.root.position);
    const h = foot.y - top.y, w = h * .22, cx = (top.x + foot.x) / 2;
    if (p.y > top.y - 10 && p.y < foot.y + 10 && Math.abs(p.x - cx) < w) { const d = Math.abs(p.x - cx); if (d < bd) { bd = d; best = pf.slot; } }
  }
  return best;
}
let down = null;
view.addEventListener('pointerdown', e => {
  if (UI.film) { exitFilm(); e.stopPropagation(); return; }
  if (e.target !== cvs || down) return;
  const p = local(e); down = { id: e.pointerId, x: p.x, y: p.y, last: p, moved: false, mode: null };
  const rt = selRT();
  if (rt && UI.tab === 'body' && !UI.moveMode) {
    const h = pickHandle(rt, p);
    if (h) { down.mode = 'joint'; down.h = h; UI.joint = h; checkpoint(); $('jointName').textContent = HANDLES[h].name; $('jointName').hidden = false; e.stopPropagation(); return; }
  }
  if (rt && UI.moveMode) {
    const y0 = evalCh(selPF(), 'body', UI.frame).p[1];
    down.mode = 'move'; down.g0 = groundHit(p, y0); down.p0 = evalCh(selPF(), 'body', UI.frame).p.slice(); checkpoint(); e.stopPropagation();
  }
}, true);
window.addEventListener('pointermove', e => {
  if (!down || e.pointerId !== down.id) return; const p = local(e);
  if (Math.hypot(p.x - down.x, p.y - down.y) > 6) down.moved = true;
  if (down.mode === 'joint') dragJoint(down.h, down.last, p);
  else if (down.mode === 'move' && down.g0) { const g = groundHit(p, down.p0[1]); if (g) { const v = curVal('body'); v.p = [clamp(down.p0[0] + g.x - down.g0.x, -6, 6), down.p0[1], clamp(down.p0[2] + g.z - down.g0.z, -6, 6)]; keyNow('body', v); } }
  down.last = p;
});
const up = e => {
  if (!down || e.pointerId !== down.id) return; const d = down; down = null; $('jointName').hidden = true;
  if (!d.mode && !d.moved) { const s = pickFigure(d); if (s != null && s !== UI.selFig) selectFig(s); }
};
window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);

// ---------- Ton bedienen ----------
let clipN = Date.now() % 100000;
const newId = () => (clipN++).toString(36) + Math.random().toString(36).slice(2, 6);
$('tabSound').addEventListener('click', async e => {
  const fx = e.target.closest('[data-fx]');
  if (fx) { previewFx(fx.dataset.fx); checkpoint(); const c = { id: newId(), f: curF(), src: 'fx:' + fx.dataset.fx, fig: null, vol: 1 }; P.clips.push(c); UI.sel = { kind: 'clip', id: c.id }; changed(); renderClipBox(); return; }
  if (e.target.closest('[data-rec]')) { if (UI.rec) stopRec(); else startRec(); return; }
  if (e.target.closest('[data-file]')) {
    const file = await pickFile('audio/*,.mp3,.m4a,.wav,.aac,.ogg'); if (!file) return;
    try {
      const v = await fileToVoice(file), id = newId(); P.voices[id] = v; await bufferOf(id, v);
      checkpoint(); const c = { id: newId(), f: curF(), src: 'v:' + id, fig: null, vol: 1 }; P.clips.push(c); UI.sel = { kind: 'clip', id: c.id };
      changed(); renderClipBox(); toast('Datei eingefügt');
    } catch (err) { toast(err && err.code === 'big' ? 'Die Datei ist zu groß (höchstens 8 MB)' : 'Diese Datei kann der Browser nicht abspielen'); }
    return;
  }
  const vb = e.target.closest('[data-vfx]');
  if (vb) {   // Stimme verändern: neue Fassung aus dem Original rechnen (Rückgängig bleibt möglich)
    const c = P.clips.find(x => UI.sel && x.id === UI.sel.id), v = c && P.voices[c.src.slice(2)]; if (!v || v.kind !== 'mic' || (v.fx || 'normal') === vb.dataset.vfx) return;
    loading(1, 'Stimme wird verändert …');
    try { const nv = await applyVoiceFx(v, vb.dataset.vfx), nid = newId(); P.voices[nid] = nv; await bufferOf(nid, nv); checkpoint(); c.src = 'v:' + nid; changed(); renderClipBox(); previewVoice(nid, nv); }
    catch (err) { console.error(err); toast('Das ging hier leider nicht'); }
    loading(-1); return;
  }
  const cb = e.target.closest('[data-clip]'); if (!cb) return;
  const c = P.clips.find(x => UI.sel && x.id === UI.sel.id); if (!c) return;
  const act = cb.dataset.clip;
  if (act === 'play') { if (c.src.startsWith('fx:')) previewFx(c.src.slice(3)); else previewVoice(c.src.slice(2), P.voices[c.src.slice(2)]); }
  if (act === 'del') { checkpoint(); P.clips = P.clips.filter(x => x !== c); UI.sel = null; changed(); renderClipBox(); }
  if (act === 'here') { checkpoint(); c.f = curF(); changed(); }
});
$('tabSound').addEventListener('input', e => {
  const c = UI.sel && P.clips.find(x => x.id === UI.sel.id); if (!c) return;
  if (e.target.dataset.vol !== undefined) { once(); c.vol = e.target.value / 100; scheduleSave(); }
});
$('tabSound').addEventListener('change', e => {
  const c = UI.sel && P.clips.find(x => x.id === UI.sel.id); if (!c) return;
  if (e.target.dataset.lip !== undefined) { checkpoint(); c.lip = e.target.checked; c.fig = c.lip ? (c.fig ?? UI.selFig) : c.fig; changed(); }
  if (e.target.dataset.who !== undefined) { checkpoint(); c.fig = e.target.value === '' ? null : +e.target.value; if (c.fig == null) c.lip = false; changed(); renderClipBox(); }
});
function renderClipBox() {
  const box = $('clipBox'); if (!box) return;
  const c = UI.sel && UI.sel.kind === 'clip' && P.clips.find(x => x.id === UI.sel.id);
  if (!c) { box.innerHTML = ''; return; }
  const isVoice = c.src.startsWith('v:'), name = c.src.startsWith('fx:') ? (FX.find(f => 'fx:' + f.id === c.src) || {}).name : (P.voices[c.src.slice(2)] || {}).name || 'Stimme';
  box.innerHTML = `<div class="clipbox"><b>Ausgewählt: ${name || 'Ton'}</b> <span class="note">bei ${fmtT(c.f)}</span>
    <div class="row" style="margin-top:8px"><button data-clip="play">▶ Anhören</button><button data-clip="here">⇥ an gelbe Linie</button><button data-clip="del" class="danger">🗑 Löschen</button></div>
    <div class="str">Lautstärke <input type="range" min="0" max="150" step="5" value="${Math.round((c.vol ?? 1) * 100)}" data-vol></div>
    ${isVoice ? `<div class="row" style="margin-top:6px">Mund von <select data-who><option value="">niemand</option>${P.figs.map(f => `<option value="${f.slot}" ${c.fig === f.slot ? 'selected' : ''}>${esc(nameOf(f))}</option>`).join('')}</select>
      <label class="tog"><input type="checkbox" data-lip ${c.lip ? 'checked' : ''} ${c.fig == null ? 'disabled' : ''}> bewegt sich mit</label></div>` : ''}
    ${isVoice && (P.voices[c.src.slice(2)] || {}).kind === 'mic' ? `<h3 style="margin-top:10px">Stimme verändern</h3><div class="btns wide">${VOICE_FX.map(f => `<button data-vfx="${f.id}" class="${((P.voices[c.src.slice(2)] || {}).fx || 'normal') === f.id ? 'on' : ''}"><span class="em">${f.icon}</span>${f.name}</button>`).join('')}</div>` : ''}
    <p class="note">In der Zeitleiste könnt ihr den Ton verschieben.</p></div>`;
}
async function startRec() {
  const pf = selPF(); if (!pf) return;
  const prob = micProblem(); if (prob) { toast(prob); return; }
  if (UI.playing) stopPlay();
  try { UI.rec = { r: await startRecording(), f0: curF(), slot: pf.slot }; }
  catch (e) { toast(e && e.name === 'NotAllowedError' ? 'Das Mikrofon ist nicht erlaubt. In den Einstellungen freigeben.' : 'Das Mikrofon ging nicht an'); return; }
  renderPanel();
  // Film stumm mitlaufen lassen, damit man passend sprechen kann
  UI.playing = true; UI.playFrom = UI.frame / FPS; UI.playT0 = performance.now(); UI.stopAudio = null; $('tPlay').textContent = '⏸';
}
async function stopRec() {
  const R = UI.rec; if (!R) return; UI.rec = null; stopPlay(); renderPanel();
  loading(1, 'Aufnahme wird vorbereitet …');
  const v = await R.r.stop(); loading(-1);
  if (!v) { toast('Es war nichts zu hören. Nochmal und etwas lauter?'); return; }
  const id = newId(), lead = v.lead || 0; delete v.lead; P.voices[id] = v; await bufferOf(id, v);
  checkpoint(); const c = { id: newId(), f: Math.min(P.len * FPS, R.f0 + Math.round(lead * FPS)), src: 'v:' + id, fig: R.slot, lip: true, vol: 1 };
  P.clips.push(c); UI.sel = { kind: 'clip', id: c.id }; setFrame(R.f0); changed(); renderClipBox(); toast('Aufnahme eingefügt. Drückt ▶ zum Anhören.');
}

// ---------- Dialoge ----------
document.querySelectorAll('dialog').forEach(d => d.addEventListener('click', e => { if (e.target.closest('[data-close]') || e.target === d) d.close(); }));
let dSlot = 0;
function renderFigDialog() {
  $('slots').innerHTML = [0, 1, 2].map(s => {
    const pf = P.figs.find(f => f.slot === s), m = pf && MODEL_BY[pf.model];
    return `<div class="slot ${s === dSlot ? 'on' : ''}" data-slot="${s}" style="color:${COLORS[s]}">${m ? `<img src="figuren/${m.id}.png" alt="">` : '<div class="ph">＋</div>'}
      <div style="color:var(--text)"><b>Platz ${s + 1}</b><br><span class="note">${m ? esc(nameOf(pf)) : 'leer'}</span></div>${m ? '<button class="x" data-del>✕</button>' : ''}</div>`;
  }).join('');
  const cur = P.figs.find(f => f.slot === dSlot);
  const card = m => `<button class="card ${cur && cur.model === m.id ? 'on' : ''}" data-model="${m.id}"><img src="figuren/${m.id}.png" alt="" loading="lazy">${m.name}</button>`;
  $('models').innerHTML = (cur && cur.look ? lookEditor(cur) : '')
    + `<h3 class="gh">Eigene Figuren <span class="note">selbst zusammenstellen: Gesicht, Frisur, Outfit, Haar- und Hautfarbe</span></h3>${MODELS.filter(m => m.kind === 'eigen').map(card).join('')}
    <h3 class="gh">Anime-Figuren <span class="note">volles Gesicht: Brauen, Augen, Mund einzeln</span></h3>${MODELS.filter(m => m.kind === 'anime').map(card).join('')}
    <h3 class="gh">Wesen, Tiere &amp; Roboter <span class="note">Gefühle, Sprechen, Blinzeln (ohne einzelne Brauen)</span></h3>${MODELS.filter(m => m.kind === 'wesen').map(card).join('')}`;
}
// Baukasten für eigene Figuren
function lookEditor(pf) {
  const L = pf.look, chips = (part, list) => list.map(([id, name]) => `<button class="${L[part] === id ? 'accent' : ''}" data-part="${part}" data-val="${id}">${name}</button>`).join('');
  const faces = PARTS.face.map(([id, name]) => `<button class="face ${L.face === id ? 'on' : ''}" data-part="face" data-val="${id}"><img src="figuren/${id}.png" alt="">${name}</button>`).join('');
  const dots = (k, list) => list.map(c => `<button class="dot ${(L[k] || '') === (c || '') ? 'on' : ''}" data-color="${k}" data-val="${c || ''}" title="${c ? '' : 'wie im Original'}" style="${c ? 'background:' + c : ''}">${c ? '' : 'Original'}</button>`).join('');
  return `<div class="looked"><h3 class="gh">✏️ Aussehen <span class="note">Platz ${pf.slot + 1}</span></h3>
    <div class="lrow"><b>Name</b><input class="nm" data-name maxlength="14" value="${esc(pf.name || '')}" placeholder="${esc(nameOf(pf))}"></div>
    <div class="lrow"><b>Gesicht</b><div class="faces">${faces}</div></div>
    <div class="lrow"><b>Frisur</b><div class="row">${chips('hair', PARTS.hair)}</div></div>
    <div class="lrow"><b>Haarfarbe</b><div class="row">${dots('hairColor', PARTS.hairColor)}</div></div>
    <div class="lrow"><b>Outfit</b><div class="row">${chips('outfit', PARTS.outfit)}</div></div>
    <div class="lrow"><b>Hautfarbe</b><div class="row">${dots('skin', PARTS.skin)}</div></div></div>`;
}
$('dFig').addEventListener('click', e => {
  const del = e.target.closest('[data-del]'), sl = e.target.closest('.slot'), md = e.target.closest('[data-model]');
  const part = e.target.closest('[data-part]'), col = e.target.closest('[data-color]'), pf0 = P.figs.find(f => f.slot === dSlot);
  if (part && pf0 && pf0.look) { if (pf0.look[part.dataset.part] === part.dataset.val) return; checkpoint(); pf0.look[part.dataset.part] = part.dataset.val; afterProjectChange(); renderFigDialog(); return; }
  if (col && pf0 && pf0.look) { checkpoint(); pf0.look[col.dataset.color] = col.dataset.val || null; const rt = RT[pf0.slot]; if (rt && rt.fig && rt.key === figKey(pf0)) applyLook(rt.fig, pf0.look); scheduleSave(); renderFigDialog(); return; }
  if (del && sl) { checkpoint(); P.figs = P.figs.filter(f => f.slot !== +sl.dataset.slot); P.clips.forEach(c => { if (c.fig === +sl.dataset.slot) { c.fig = null; c.lip = false; } }); afterProjectChange(); renderFigDialog(); return; }
  if (sl) { dSlot = +sl.dataset.slot; renderFigDialog(); return; }
  if (md) {
    const M = MODEL_BY[md.dataset.model], pf = P.figs.find(f => f.slot === dSlot);
    if (pf && pf.model === M.id) return;
    checkpoint();
    if (pf) pf.model = M.id; else P.figs.push(newFigure(dSlot, M.id));
    const now = P.figs.find(f => f.slot === dSlot); if (M.look) now.look = structuredClone(M.look); else delete now.look;
    UI.selFig = dSlot; afterProjectChange();
    // Bei eigenen Figuren auf dem Platz bleiben, damit der Baukasten offen bleibt
    if (!M.look) { const free = [0, 1, 2].find(s => !P.figs.some(f => f.slot === s)); if (free != null) dSlot = free; }
    renderFigDialog(); if (M.look) $('dFig').scrollTop = 0;
  }
});
$('dFig').addEventListener('input', e => {
  if (e.target.dataset.name === undefined) return; const pf = P.figs.find(f => f.slot === dSlot); if (!pf || !pf.look) return;
  once(); pf.name = e.target.value.slice(0, 14); renderChips(); tl.draw(); scheduleSave();
  const n = $('slots').querySelector(`.slot[data-slot="${dSlot}"] .note`); if (n) n.textContent = nameOf(pf);
});
const openFig = () => { dSlot = [0, 1, 2].find(s => !P.figs.some(f => f.slot === s)) ?? (UI.selFig ?? 0); renderFigDialog(); $('dFig').showModal(); };
$('bFig').onclick = openFig; $('bFig2').onclick = openFig;
// Ort wechseln (Anime-Szenen laden ihre Modelle nach)
function placeGo() {
  loading(1, 'Lade Ort …');
  stage.setPlace(P.place).catch(e => { console.error(e); toast('Der Ort ließ sich nicht laden'); }).finally(() => { loading(-1); poke(); });
}
function renderPlaces() {
  const pic = p => p.id === 'studio' ? '<div class="sw" style="background:radial-gradient(#7b8294,#282b34)"></div>' : p.id === 'green' ? '<div class="sw" style="background:#00b140"></div>'
    : `<img src="orte/${p.kind === 'scene' ? 'szenen/' : ''}${p.id}_klein.jpg" alt="" loading="lazy">`;
  const card = p => `<button class="card ${P.place === p.id ? 'on' : ''}" data-place="${p.id}">${pic(p)}${p.name}</button>`;
  $('places').innerHTML = `<h3 class="gh">Anime-Szenen <span class="note">einfache 3D-Orte im Zeichentrick-Stil</span></h3>${PLACES.filter(p => p.kind === 'scene').map(card).join('')}
    <h3 class="gh">Studio</h3>${PLACES.filter(p => !p.kind && !p.h).map(card).join('')}
    <h3 class="gh">Echte Orte <span class="note">360°-Fotos</span></h3>${PLACES.filter(p => p.h).map(card).join('')}`;
}
$('bPlace').onclick = () => { renderPlaces(); $('dPlace').showModal(); };
$('places').onclick = e => {
  const b = e.target.closest('[data-place]'); if (!b) return;
  checkpoint(); P.place = b.dataset.place;
  placeGo(); renderPlaces(); scheduleSave();
};
$('bHelp').onclick = () => $('dHelp').showModal();
$('bMenu').onclick = () => { $('mTitle').value = P.title; $('dMenu').showModal(); };
$('mTitle').oninput = e => { P.title = e.target.value; scheduleSave(); };
$('mVideo').onclick = () => { $('dMenu').close(); videoExport(); };
$('mAbout').onclick = () => { $('dMenu').close(); $('dAbout').showModal(); };
$('mSave').onclick = async () => { pruneVoices(); await download(slug(P.title) + '.mimik.json', new Blob([JSON.stringify(P)], { type: 'application/json' })); toast('Film-Datei gespeichert'); };
$('mOpen').onclick = async () => {
  const f = await pickFile('.json,application/json'); if (!f) return;
  try { const o = sanitize(JSON.parse(await f.text())); checkpoint(); P = o; UI.sel = null; afterProjectChange(); $('dMenu').close(); toast('Film geöffnet'); }
  catch (e) { toast('Diese Datei ist kein Mimik-Film'); }
};
$('mNew').onclick = () => { if (!confirm('Wirklich einen neuen Film anfangen? Der jetzige Film geht verloren, wenn ihr ihn nicht gespeichert habt.')) return; checkpoint(); P = starter(); UI.sel = null; afterProjectChange(); $('dMenu').close(); };

// Aussehen einer eigenen Figur: nur Teile und Farben aus den Listen zulassen
function cleanLook(l, def) {
  l = l && typeof l === 'object' ? l : {}; const o = {};
  for (const k of ['outfit', 'face', 'hair']) o[k] = PARTS[k].some(([id]) => id === l[k]) ? l[k] : def[k];
  for (const k of ['hairColor', 'skin']) o[k] = PARTS[k].includes(l[k] ?? null) ? (l[k] ?? null) : def[k];
  return o;
}
// Geladene Dateien prüfen: nur bekannte Felder mit passenden Typen übernehmen
function sanitize(o) {
  if (!o || typeof o !== 'object' || !Array.isArray(o.figs)) throw new Error('kein Film');
  const num = (x, d = 0) => Number.isFinite(+x) ? +x : d, P2 = newProject();
  P2.title = String(o.title || 'Mein Film').slice(0, 40); P2.len = LENS.includes(+o.len) ? +o.len : 10;
  P2.place = PLACES.some(p => p.id === o.place) ? o.place : 'klasse';
  const seen = new Set();
  for (const f of o.figs.slice(0, 3)) {
    const slot = num(f.slot, -1); if (![0, 1, 2].includes(slot) || seen.has(slot) || !MODEL_BY[f.model]) continue; seen.add(slot);
    const nf = newFigure(slot, f.model); nf.blink = f.blink !== false;
    if (MODEL_BY[f.model].look) nf.look = cleanLook(f.look, MODEL_BY[f.model].look);
    if (MODEL_BY[f.model].look && typeof f.name === 'string') nf.name = f.name.slice(0, 14);
    for (const ch of CHANNELS) {
      nf.keys[ch] = (Array.isArray(f.keys && f.keys[ch]) ? f.keys[ch] : []).filter(k => k && Number.isInteger(k.f) && k.f >= 0 && k.v && typeof k.v === 'object').map(k => {
        let v;
        if (ch === 'body') v = { p: [0, 1, 2].map(i => num(k.v.p && k.v.p[i])), r: num(k.v.r), b: Object.fromEntries(Object.entries(k.v.b || {}).filter(([n, q]) => /^[a-zA-Z]+$/.test(n) && Array.isArray(q) && q.length === 4).map(([n, q]) => [n, q.map(x => num(x))])) };
        else if (ch === 'head') v = { y: num(k.v.y), p: num(k.v.p), t: num(k.v.t), lx: num(k.v.lx), ly: num(k.v.ly) };
        else v = Object.fromEntries(Object.entries(k.v).filter(([n]) => FACE[ch].some(s => s.id === n)).map(([n, w]) => [n, clamp(num(w), 0, 1)]));
        return k.s ? { f: k.f, v, s: 1 } : { f: k.f, v };
      }).sort((a, b) => a.f - b.f);
    }
    P2.figs.push(nf);
  }
  for (const [id, v] of Object.entries(o.voices || {})) {
    if (!/^[a-z0-9]+$/.test(id) || !v) continue;
    if (v.kind === 'mic' && typeof v.mu === 'string') { P2.voices[id] = { kind: 'mic', sr: num(v.sr, 22050), mu: v.mu, dur: num(v.dur, 1) }; if (typeof v.raw === 'string') P2.voices[id].raw = v.raw; if (VOICE_FX.some(f => f.id === v.fx)) P2.voices[id].fx = v.fx; }
    if (v.kind === 'file' && typeof v.data === 'string') P2.voices[id] = { kind: 'file', name: String(v.name || 'Datei').slice(0, 30), data: v.data, dur: num(v.dur, 1) };
  }
  for (const c of Array.isArray(o.clips) ? o.clips : []) {
    if (!c || typeof c.src !== 'string' || !Number.isInteger(c.f)) continue;
    if (c.src.startsWith('fx:') ? !FX.some(f => 'fx:' + f.id === c.src) : !(c.src.startsWith('v:') && P2.voices[c.src.slice(2)])) continue;
    const fig = P2.figs.some(f => f.slot === c.fig) ? c.fig : null;
    P2.clips.push({ id: String(c.id || newId()).replace(/[^a-z0-9]/gi, '').slice(0, 20) || newId(), f: Math.max(0, c.f), src: c.src, fig, lip: !!c.lip && fig != null, vol: clamp(num(c.vol, 1), 0, 1.5) });
  }
  return P2;
}
async function afterProjectChange() {
  placeGo(); $('tLen').value = P.len; syncFigures(); renderPanel(); syncKeyActs(); syncUndo();
  UI.frame = Math.min(UI.frame, P.len * FPS); $('tTime').textContent = fmtT(UI.frame); tl.draw(); scheduleSave();
  for (const [id, v] of Object.entries(P.voices)) bufferOf(id, v).catch(() => {});
}

// ---------- Tastatur (am Computer) ----------
window.addEventListener('keydown', e => {
  if (e.target.closest && e.target.closest('input, select, textarea') || document.querySelector('dialog[open]')) return;
  if (e.key === ' ') { e.preventDefault(); play(); }
  else if (e.key === 'ArrowLeft') setFrame(curF() - 1);
  else if (e.key === 'ArrowRight') setFrame(curF() + 1);
  else if (e.key === 'Delete' || e.key === 'Backspace') $('kDel').click();
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); (e.shiftKey ? $('bRedo') : $('bUndo')).click(); }
  else if (e.key === 'Escape') exitFilm();
});

// ---------- Start ----------
function starter() { const p = newProject(); p.figs.push(newFigure(1, 'shibu')); return p; }
(async () => {
  let saved = null; try { const s = await idbGet('auto'); if (s) saved = sanitize(JSON.parse(s)); } catch (e) { saved = null; }
  P = saved || starter(); UI.selFig = P.figs.length ? P.figs[0].slot : null;
  await afterProjectChange(); syncUndo();
  if (!(await idbGet('seenHelp'))) { $('dHelp').showModal(); idbSet('seenHelp', 1); }
  requestAnimationFrame(loop);
})();
window.addEventListener('resize', () => tl.draw());
window.MIMIK = { poke, perf, get P() { return P; }, get acState() { const a = audio(); return a && a.state; }, UI, RT, stage, setFrame, keyNow, setTab, selectFig, camTo };   // für Tests
