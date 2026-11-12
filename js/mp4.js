// ===== Film als MP4 (übernommen aus Spukkino, dort getestet) =====
// MP4-Datei selbst schreiben: H.264 (Bild) und AAC (Ton) kommen aus den Encodern des Browsers (WebCodecs).
// Kann der Browser das nicht, liefert MP4_check null und main.js schneidet den Film beim Abspielen mit.
// ----- MP4-Datei schreiben (ISO BMFF: ftyp, moov, mdat) -----
const MP4_u32 = n => [n >>> 24 & 255, n >>> 16 & 255, n >>> 8 & 255, n & 255], MP4_u16 = n => [n >> 8 & 255, n & 255], MP4_str = s => [...s].map(ch => ch.charCodeAt(0));
function MP4_box(type, ...parts) {
  let n = 8; for (const p of parts) n += p.length;
  const out = new Uint8Array(n); out.set(MP4_u32(n)); out.set(MP4_str(type), 4);
  let o = 8; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
const MP4_full = (type, ver, flags, ...parts) => MP4_box(type, [ver, flags >> 16 & 255, flags >> 8 & 255, flags & 255], ...parts);
function MP4_tab(nums) { const a = new Uint8Array(nums.length * 4), dv = new DataView(a.buffer); for (let i = 0; i < nums.length; i++) dv.setUint32(i * 4, nums[i]); return a; }
// Gleiche Werte hintereinander zusammenfassen: [Anzahl, Wert, Anzahl, Wert, …]
function MP4_runs(vals) { const out = []; for (const v of vals) { if (out.length && out[out.length - 1] === v) out[out.length - 2]++; else out.push(1, v); } return out; }
// Farbangaben des Encoders in die Nummern der Norm übersetzen (colr-Kasten), damit Player die Farben nicht raten müssen
function MP4_color(cs) {
  const P = { bt709: 1, bt470bg: 5, smpte170m: 6 }, T = { bt709: 1, smpte170m: 6, 'iec61966-2-1': 13 }, M = { rgb: 0, bt709: 1, bt470bg: 5, smpte170m: 6 };
  return cs && P[cs.primaries] && T[cs.transfer] && cs.matrix in M ? [P[cs.primaries], T[cs.transfer], M[cs.matrix], !!cs.fullRange] : null;
}
// V = { w, h, scale, delta, samples: [{ d, key, n }], avcC, color }   n = an welcher Stelle das Bild gezeigt wird
// A = { sr, ch, bitrate, samples: [{ d }], asc }                      je Ton-Stück 1024 Abtastwerte
function MP4_mux(V, A) {
  const Z = n => new Uint8Array(n), MAT = MP4_tab([0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000]);
  // Bild i wird zur Zeit i·delta entpackt und zur Zeit n·delta gezeigt. Liefert ein Encoder die Bilder umsortiert,
  // steht der Unterschied in ctts; damit er nie negativ wird, rutscht alles um shift nach hinten (und elst holt es zurück).
  const offs = V.samples.map((s, i) => (s.n - i) * V.delta); let shift = 0; for (const o of offs) if (-o > shift) shift = -o;
  const vDur = V.samples.length * V.delta, aDur = A.samples.length * 1024, ms = (d, scale) => Math.round(d / scale * 1000);
  const movDur = Math.max(ms(vDur, V.scale), ms(aDur, A.sr));
  // Daten abwechselnd in Stücken von einer halben Sekunde, damit Bild und Ton in der Datei beieinanderliegen
  const order = [], vChunks = [], aChunks = []; let vi = 0, ai = 0, pos = 0;
  const take = (S, i, per, chunks, t) => { const first = i; let size = 0; while (i < S.length && i * per < t) { order.push(S[i].d); size += S[i].d.length; i++; } if (i > first) { chunks.push({ pos, n: i - first }); pos += size; } return i; };
  for (let t = .5; vi < V.samples.length || ai < A.samples.length; t += .5) { vi = take(V.samples, vi, V.delta / V.scale, vChunks, t); ai = take(A.samples, ai, 1024 / A.sr, aChunks, t); }
  if (pos > 0xFFF00000) throw new Error('mp4 too big');
  const stbl = (S, chunks, base, entry, tables) => {
    const sc = []; chunks.forEach((c, i) => { if (!i || chunks[i - 1].n !== c.n) sc.push(i + 1, c.n, 1); });
    return MP4_box('stbl', MP4_full('stsd', 0, 0, MP4_u32(1), entry), ...tables,
      MP4_full('stsc', 0, 0, MP4_u32(sc.length / 3), MP4_tab(sc)),
      MP4_full('stsz', 0, 0, MP4_u32(0), MP4_u32(S.length), MP4_tab(S.map(s => s.d.length))),
      MP4_full('stco', 0, 0, MP4_u32(chunks.length), MP4_tab(chunks.map(c => base + c.pos))));
  };
  const trak = (id, isV, scale, dur, box) => MP4_box('trak',
    MP4_full('tkhd', 0, 3, MP4_u32(0), MP4_u32(0), MP4_u32(id), MP4_u32(0), MP4_u32(ms(dur, scale)), Z(8), MP4_u16(0), MP4_u16(0), MP4_u16(isV ? 0 : 0x100), MP4_u16(0), MAT, MP4_u32(isV ? V.w * 65536 : 0), MP4_u32(isV ? V.h * 65536 : 0)),
    ...(isV && shift ? [MP4_box('edts', MP4_full('elst', 0, 0, MP4_u32(1), MP4_u32(ms(dur, scale)), MP4_u32(shift), MP4_u32(0x10000)))] : []),
    MP4_box('mdia',
      MP4_full('mdhd', 0, 0, MP4_u32(0), MP4_u32(0), MP4_u32(scale), MP4_u32(dur), MP4_u16(0x55C4), MP4_u16(0)),
      MP4_full('hdlr', 0, 0, MP4_u32(0), MP4_str(isV ? 'vide' : 'soun'), Z(12), MP4_str(isV ? 'Spukkino Bild\0' : 'Spukkino Ton\0')),
      MP4_box('minf', isV ? MP4_full('vmhd', 0, 1, Z(8)) : MP4_full('smhd', 0, 0, Z(4)), MP4_box('dinf', MP4_full('dref', 0, 0, MP4_u32(1), MP4_full('url ', 0, 1))), box)));
  const colr = V.color ? [MP4_box('colr', MP4_str('nclx'), MP4_u16(V.color[0]), MP4_u16(V.color[1]), MP4_u16(V.color[2]), [V.color[3] ? 0x80 : 0])] : [];
  const avc1 = MP4_box('avc1', Z(6), MP4_u16(1), Z(16), MP4_u16(V.w), MP4_u16(V.h), MP4_u32(0x480000), MP4_u32(0x480000), MP4_u32(0), MP4_u16(1), Z(32), MP4_u16(0x18), [255, 255], MP4_box('avcC', V.avcC), ...colr);
  const dsi = [5, A.asc.length, ...A.asc], dcd = [4, 13 + dsi.length, 0x40, 0x15, 0, 0, 0, ...MP4_u32(A.bitrate), ...MP4_u32(A.bitrate), ...dsi], sl = [6, 1, 2];
  const mp4a = MP4_box('mp4a', Z(6), MP4_u16(1), Z(8), MP4_u16(A.ch), MP4_u16(16), Z(4), MP4_u32(A.sr * 65536), MP4_full('esds', 0, 0, [3, 3 + dcd.length + sl.length, 0, 0, 0, ...dcd, ...sl]));
  const keys = []; V.samples.forEach((s, i) => { if (s.key) keys.push(i + 1); });
  const vTabs = [MP4_full('stts', 0, 0, MP4_u32(1), MP4_u32(V.samples.length), MP4_u32(V.delta))];
  if (offs.some(o => o !== 0)) { const r = MP4_runs(offs.map(o => o + shift)); vTabs.push(MP4_full('ctts', 0, 0, MP4_u32(r.length / 2), MP4_tab(r))); }
  if (keys.length < V.samples.length) vTabs.push(MP4_full('stss', 0, 0, MP4_u32(keys.length), MP4_tab(keys)));
  const aTabs = [MP4_full('stts', 0, 0, MP4_u32(1), MP4_u32(A.samples.length), MP4_u32(1024))], sound = A.samples.length > 0;
  // Erst das Verzeichnis (moov), dann die Daten: so kann ein Player sofort loslegen. Wo die Daten liegen, hängt von der
  // Größe des Verzeichnisses ab, deshalb wird es zweimal gebaut (die Größe ändert sich dabei nicht).
  const build = base => MP4_box('moov',
    MP4_full('mvhd', 0, 0, MP4_u32(0), MP4_u32(0), MP4_u32(1000), MP4_u32(movDur), MP4_u32(0x10000), MP4_u16(0x100), Z(10), MAT, Z(24), MP4_u32(sound ? 3 : 2)),
    trak(1, true, V.scale, vDur, stbl(V.samples, vChunks, base, avc1, vTabs)),
    ...(sound ? [trak(2, false, A.sr, aDur, stbl(A.samples, aChunks, base, mp4a, aTabs))] : []));
  const ftyp = MP4_box('ftyp', MP4_str('isom'), MP4_u32(0x200), MP4_str('isomiso2avc1mp41')), moov = build(ftyp.length + build(0).length + 8);
  return new Blob([ftyp, moov, new Uint8Array([...MP4_u32(pos + 8), ...MP4_str('mdat')]), ...order], { type: 'video/mp4' });
}

// ----- Kann dieser Browser das? -----
async function MP4_check() {
  try {
    if (!window.VideoEncoder || !window.AudioEncoder || !window.VideoFrame || !window.AudioData || !(window.OfflineAudioContext || window.webkitOfflineAudioContext)) return null;
    let v = null, a = null;
    for (const codec of ['avc1.640028', 'avc1.4d0028', 'avc1.42001f']) { const c = { codec, width: 1280, height: 720, bitrate: 4e6, framerate: 30, avc: { format: 'avc' } }; if ((await VideoEncoder.isConfigSupported(c)).supported) { v = c; break; } }
    for (const sampleRate of [48000, 44100]) { const c = { codec: 'mp4a.40.2', sampleRate, numberOfChannels: 2, bitrate: 128000 }; if ((await AudioEncoder.isConfigSupported(c)).supported) { a = c; break; } }
    return v && a ? { v, a } : null;
  } catch (e) { return null; }
}

// ----- Film rechnen -----
// Kurz Luft holen, damit die Anzeige mitkommt und „Schließen“ ankommt. Kein setTimeout: das bremst der Browser im Hintergrund auf eine Sekunde.
const MP4_tick = () => new Promise(r => { const ch = new MessageChannel(); ch.port1.onmessage = () => r(); ch.port2.postMessage(0); });
const MP4_bytes = d => d instanceof ArrayBuffer ? new Uint8Array(d.slice(0)) : new Uint8Array(d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength));
// Dem Encoder nicht mehr geben, als er schafft
async function MP4_drain(enc) { while (enc.encodeQueueSize > 4) await new Promise(r => { const t = setTimeout(r, 60); enc.addEventListener('dequeue', () => { clearTimeout(t); r(); }, { once: true }); }); }
// Farben selbst umrechnen: RGB der Leinwand → YUV 4:2:0 nach BT.709 im üblichen Video-Bereich (16…235).
// Überlässt man das dem Browser, schreibt er den vollen Bereich (0…255); manche Fernseher und ältere Player
// beachten das nicht und zeigen dunkle Szenen dann zu dunkel. Ganzzahlen, damit es schnell geht.
function MP4_i420(px, W, H, out) {
  const cw = W >> 1, n = W * H; let ui = n, vi = n + cw * (H >> 1);
  for (let y = 0; y < H; y += 2) {
    let p = y * W * 4, q = p + W * 4, a = y * W, b = a + W;
    for (let x = 0; x < W; x += 2, p += 8, q += 8, a += 2, b += 2) {
      const r0 = px[p], g0 = px[p + 1], b0 = px[p + 2], r1 = px[p + 4], g1 = px[p + 5], b1 = px[p + 6], r2 = px[q], g2 = px[q + 1], b2 = px[q + 2], r3 = px[q + 4], g3 = px[q + 5], b3 = px[q + 6];
      out[a] = 47 * r0 + 157 * g0 + 16 * b0 + 4224 >> 8; out[a + 1] = 47 * r1 + 157 * g1 + 16 * b1 + 4224 >> 8;
      out[b] = 47 * r2 + 157 * g2 + 16 * b2 + 4224 >> 8; out[b + 1] = 47 * r3 + 157 * g3 + 16 * b3 + 4224 >> 8;
      const r = r0 + r1 + r2 + r3, g = g0 + g1 + g2 + g3, bl = b0 + b1 + b2 + b3;
      out[ui++] = -26 * r - 86 * g + 112 * bl + 131584 >> 10; out[vi++] = 112 * r - 102 * g - 10 * bl + 131584 >> 10;
    }
  }
  return out;
}
const MP4_CS = { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false };

export { MP4_mux, MP4_check, MP4_tick, MP4_bytes, MP4_drain, MP4_i420, MP4_CS };
