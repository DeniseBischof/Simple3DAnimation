// ===== Zeitleiste (Canvas) =====
// Zeilen: Lineal, Ton, je Figur eine Zeile mit allen Keys. In der Profi-Ansicht zeigt die gewählte Figur
// zusätzlich jede Spur einzeln (Körper, Kopf & Blick, Brauen, Augen, Mund, Sprechen).
import { FPS, CHANNELS, CH_NAME, keyFrames } from './anim.js';
import { clipDur, clipName } from './sound.js';

const LABEL = 112, RULER = 26, FIG_H = 40, CH_H = 28, LANE = 18;

export function makeTimeline(canvas, api) {
  const ctx = canvas.getContext('2d');
  let rows = [], W = 0, H = 0, drag = null;
  const frames = () => Math.max(1, api.project().len * FPS);
  const pxPer = () => (W - LABEL - 14) / frames();
  const xOf = f => LABEL + 6 + f * pxPer();
  const fOf = x => Math.max(0, Math.min(frames(), Math.round((x - LABEL - 6) / pxPer())));

  function lanesFor(P) {
    const cs = [...P.clips].sort((a, b) => a.f - b.f), ends = [], lane = new Map();
    for (const c of cs) { let l = ends.findIndex(e => e <= c.f); if (l < 0) { l = ends.length; ends.push(0); } ends[l] = c.f + clipDur(P, c) * FPS; lane.set(c.id, l); }
    return { lane, n: Math.max(1, ends.length) };
  }
  function layout() {
    const P = api.project(); rows = []; let y = RULER;
    const L = lanesFor(P); const ch = Math.max(36, L.n * LANE + 8);
    rows.push({ type: 'clips', y, h: ch, lanes: L }); y += ch;
    for (const fig of [...P.figs].sort((a, b) => a.slot - b.slot)) {
      rows.push({ type: 'fig', slot: fig.slot, fig, y, h: FIG_H }); y += FIG_H;
      if (api.profi() && api.selFig() === fig.slot) for (const c of CHANNELS) { rows.push({ type: 'ch', slot: fig.slot, fig, ch: c, y, h: CH_H }); y += CH_H; }
    }
    return Math.max(y + 6, 120);
  }
  function resize() {
    const h = layout(), dpr = Math.min(2, window.devicePixelRatio || 1); W = canvas.parentElement.clientWidth; H = h;
    canvas.style.height = H + 'px'; canvas.style.width = W + 'px';
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function diamond(x, y, r, fill, stroke, square) {
    ctx.beginPath();
    if (square) ctx.rect(x - r * .8, y - r * .8, r * 1.6, r * 1.6); else { ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath(); }
    ctx.fillStyle = fill; ctx.fill(); if (stroke) { ctx.lineWidth = 2.5; ctx.strokeStyle = stroke; ctx.stroke(); }
  }
  function draw() {
    resize();
    const P = api.project(), sel = api.sel(), F = frames(), cur = api.frame();
    ctx.fillStyle = '#171a21'; ctx.fillRect(0, 0, W, H);
    // Lineal
    ctx.fillStyle = '#1f232c'; ctx.fillRect(0, 0, W, RULER);
    ctx.font = '12px system-ui, sans-serif'; ctx.textBaseline = 'middle';
    const step = pxPer() * FPS < 28 ? 5 : pxPer() * FPS < 55 ? 2 : 1;
    for (let s = 0; s <= P.len; s++) {
      const x = xOf(s * FPS);
      ctx.fillStyle = s % step ? '#3a404d' : '#5d6578'; ctx.fillRect(x, s % step ? RULER - 6 : RULER - 11, 1, s % step ? 6 : 11);
      if (s % step === 0) { ctx.fillStyle = '#9aa3b5'; ctx.fillText(s + ' s', x + 3, 9); }
      if (pxPer() * FPS > 60 && s < P.len) for (let q = 1; q < 4; q++) { ctx.fillStyle = '#2f3440'; ctx.fillRect(x + q * pxPer() * FPS / 4, RULER - 4, 1, 4); }
    }
    for (const r of rows) {
      const selRow = (r.type === 'fig' || r.type === 'ch') && api.selFig() === r.slot;
      ctx.fillStyle = r.type === 'ch' ? '#1a1d24' : selRow ? '#242a36' : '#1d2028'; ctx.fillRect(0, r.y, W, r.h);
      ctx.fillStyle = '#2a2f3a'; ctx.fillRect(0, r.y + r.h - 1, W, 1);
      // Beschriftung
      ctx.fillStyle = r.type === 'ch' ? '#8b93a6' : '#d7dce7';
      ctx.font = (r.type === 'ch' ? '12px' : '600 14px') + ' system-ui, sans-serif';
      if (r.type === 'clips') ctx.fillText('🔊 Ton', 10, r.y + r.h / 2);
      else if (r.type === 'fig') {
        ctx.fillStyle = api.color(r.slot); ctx.beginPath(); ctx.arc(16, r.y + r.h / 2, 7, 0, 7); ctx.fill();
        ctx.fillStyle = '#e8ecf4'; ctx.fillText(api.figName(r.slot).slice(0, 11), 30, r.y + r.h / 2);
      } else ctx.fillText(CH_NAME[r.ch], 22, r.y + r.h / 2);
      ctx.fillStyle = '#2a2f3a'; ctx.fillRect(LABEL, r.y, 1, r.h);
      // Inhalt
      if (r.type === 'clips') {
        for (const c of P.clips) {
          const l = r.lanes.lane.get(c.id) || 0, f = drag && drag.kind === 'clip' && drag.id === c.id ? drag.to : c.f;
          const x0 = xOf(f), x1 = Math.min(xOf(F), xOf(f + clipDur(P, c) * FPS)), y = r.y + 4 + l * LANE;
          const isSel = sel && sel.kind === 'clip' && sel.id === c.id;
          ctx.fillStyle = c.fig != null ? api.color(c.fig) + 'b0' : '#5b6b8cb0'; ctx.beginPath(); ctx.roundRect(x0, y, Math.max(8, x1 - x0), LANE - 3, 5); ctx.fill();
          if (isSel) { ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke(); }
          ctx.save(); ctx.beginPath(); ctx.rect(x0, y, Math.max(8, x1 - x0), LANE); ctx.clip();
          ctx.fillStyle = '#fff'; ctx.font = '11px system-ui, sans-serif'; ctx.fillText(clipName(P, c) + (c.lip ? ' 👄' : ''), x0 + 5, y + LANE / 2 - 1); ctx.restore();
        }
      } else {
        const chans = r.type === 'ch' ? [r.ch] : CHANNELS, cy = r.y + r.h / 2, rad = r.type === 'ch' ? 6 : 8;
        // dünne Linie zwischen den Keys zeigt: hier wird übergeblendet
        const fs = keyFrames(r.fig, chans);
        if (fs.length > 1) { ctx.fillStyle = api.color(r.slot) + '55'; ctx.fillRect(xOf(fs[0]), cy - 1.5, xOf(fs[fs.length - 1]) - xOf(fs[0]), 3); }
        for (const f of fs) {
          const isSel = sel && sel.kind === 'key' && sel.slot === r.slot && sel.f === f && (sel.ch === (r.type === 'ch' ? r.ch : null) || (r.type === 'fig' && sel.ch && r.fig.keys[sel.ch].some(k => k.f === f)));
          const moving = drag && drag.kind === 'key' && drag.slot === r.slot && drag.from === f && (drag.ch === null || chans.includes(drag.ch));
          const sudden = chans.some(c => r.fig.keys[c].some(k => k.f === f && k.s));
          diamond(xOf(moving ? drag.to : f), cy, rad, api.color(r.slot), isSel ? '#ffffff' : '#0e1015', sudden);
        }
      }
    }
    // Abspielkopf
    const px = xOf(cur);
    ctx.fillStyle = '#ffd34d'; ctx.fillRect(px - 1, 0, 2, H);
    ctx.beginPath(); ctx.moveTo(px - 7, 0); ctx.lineTo(px + 7, 0); ctx.lineTo(px + 7, 10); ctx.lineTo(px, 17); ctx.lineTo(px - 7, 10); ctx.fill();
  }

  // ---------- Bedienung ----------
  const pos = e => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const rowAt = y => rows.find(r => y >= r.y && y < r.y + r.h);
  function keyAt(r, x) {
    const chans = r.type === 'ch' ? [r.ch] : CHANNELS; let best = null, bd = 16;
    for (const f of keyFrames(r.fig, chans)) { const d = Math.abs(xOf(f) - x); if (d < bd) { bd = d; best = f; } }
    return best;
  }
  function clipAt(r, x, y) {
    const P = api.project();
    for (const c of [...P.clips].reverse()) {
      const l = r.lanes.lane.get(c.id) || 0, y0 = r.y + 4 + l * LANE;
      if (y >= y0 && y < y0 + LANE && x >= xOf(c.f) - 6 && x <= Math.max(xOf(c.f) + 14, xOf(c.f + clipDur(P, c) * FPS))) return c;
    }
    return null;
  }
  canvas.addEventListener('pointerdown', e => {
    const p = pos(e), r = rowAt(p.y); canvas.setPointerCapture(e.pointerId);
    if (p.x < LABEL) { if (r && r.slot != null) api.setSelFig(r.slot); drag = null; draw(); return; }
    if (r && r.type === 'clips') {
      const c = clipAt(r, p.x, p.y);
      if (c) { api.setSel({ kind: 'clip', id: c.id }); drag = { kind: 'clip', id: c.id, from: c.f, to: c.f, x0: p.x, off: fOf(p.x) - c.f, moved: false }; draw(); return; }
    }
    if (r && (r.type === 'fig' || r.type === 'ch')) {
      api.setSelFig(r.slot);
      const f = keyAt(r, p.x);
      if (f != null) {
        const ch = r.type === 'ch' ? r.ch : null;
        api.setSel({ kind: 'key', slot: r.slot, ch, f });
        drag = { kind: 'key', slot: r.slot, ch, from: f, to: f, x0: p.x, moved: false }; draw(); return;
      }
    }
    api.setSel(null); drag = { kind: 'scrub' }; api.setFrame(fOf(p.x)); draw();
  });
  canvas.addEventListener('pointermove', e => {
    if (!drag) return; const p = pos(e);
    if (drag.kind === 'scrub') { api.setFrame(fOf(p.x)); return; }
    if (Math.abs(p.x - drag.x0) > 6) drag.moved = true;
    if (!drag.moved) return;
    drag.to = drag.kind === 'clip' ? Math.max(0, fOf(p.x) - drag.off) : fOf(p.x);
    draw();
  });
  const end = () => {
    if (!drag) return; const d = drag; drag = null;
    if (d.kind === 'key') { if (d.moved && d.to !== d.from) api.moveKeys(d.slot, d.ch, d.from, d.to); else api.setFrame(d.from); }
    if (d.kind === 'clip' && d.moved && d.to !== d.from) api.moveClip(d.id, d.to);
    draw();
  };
  canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
  return { draw };
}
