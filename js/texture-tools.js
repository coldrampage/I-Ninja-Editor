// Custom texture support for .LCM / .LCS level wads (no DOM, no Three.js; runs in the browser and in node tests).
//
// Texture object layout (verified on all 3877 textures of 10.vol): 0x20-byte header + one complete TGA.
//   +00 engine vtable pointer (same constant in every texture)   +04 width   +08 height   +0C 0
//   +10 pointer to the TGA bytes (relocated; == obj+0x20 in original levels)
//   +14 byte length of that TGA (18 header + palette bytes + pixel bytes)   +18 1 (3 on a few)   +1C 0
// TGA: type 1 = 8-bit indices + 24/32-bit BGR(A) palette of 1..256 entries, or type 2 = 32-bit BGRA; descriptor 0 = rows bottom-up.
//
// A project stores the user's own TGA bytes (base64) per wad, never any original game data:
//   textures: [{op:'replace', tex:<object offset>, tga:<base64>}, {op:'add', id:'name', tga:<base64>, assign:[<draw-part offsets>]}]
import { EC } from './editor-core.js';
import { fixups, parseTga } from './vol-core.js';

const isPow2 = n => n > 0 && (n & (n - 1)) === 0;
const MIN_DIM = 4, MAX_DIM = 512;

// ---- quantiser: median cut on (r,g,b,a). rgba = Uint8Array(w*h*4) -> {pal:[[r,g,b,a]...], idx:Uint8Array(w*h)}
function quantize(rgba, w, h, maxColors = 256) {
  const n = w * h, key = i => (rgba[4*i] << 24 | rgba[4*i+1] << 16 | rgba[4*i+2] << 8 | rgba[4*i+3]) >>> 0;
  const uniq = new Map();
  for (let i = 0; i < n; i++) { const k = key(i); uniq.set(k, (uniq.get(k) || 0) + 1); }
  const cols = [...uniq].map(([k, c]) => ({ c: [k >>> 24, k >>> 16 & 255, k >>> 8 & 255, k & 255], n: c }));
  let boxes;
  if (cols.length <= maxColors) boxes = cols.map(x => [x]);
  else {
    boxes = [cols];
    const range = b => { const lo = [255,255,255,255], hi = [0,0,0,0]; for (const x of b) for (let k = 0; k < 4; k++) { if (x.c[k] < lo[k]) lo[k] = x.c[k]; if (x.c[k] > hi[k]) hi[k] = x.c[k]; } return hi.map((v, k) => v - lo[k]); };
    while (boxes.length < maxColors) {
      let bi = -1, bs = 0, bk = 0;
      boxes.forEach((b, i) => { if (b.length < 2) return; const r = range(b); let k = 0; for (let q = 1; q < 4; q++) if (r[q] > r[k]) k = q; const s = r[k] * Math.sqrt(b.reduce((t, x) => t + x.n, 0)); if (s > bs) { bs = s; bi = i; bk = k; } });
      if (bi < 0) break;
      const b = boxes[bi].slice().sort((p, q) => p.c[bk] - q.c[bk]), tot = b.reduce((t, x) => t + x.n, 0);
      let acc = 0, cut = 1; for (let i = 0; i < b.length - 1; i++) { acc += b[i].n; cut = i + 1; if (acc >= tot / 2) break; }
      boxes.splice(bi, 1, b.slice(0, cut), b.slice(cut));
    }
  }
  const pal = boxes.map(b => { const t = b.reduce((s, x) => s + x.n, 0), m = [0,0,0,0]; for (const x of b) for (let k = 0; k < 4; k++) m[k] += x.c[k] * x.n; return m.map(v => Math.round(v / t)); });
  const lut = new Map(), idx = new Uint8Array(n);
  const near = c => { let bi = 0, bd = 1e18; for (let i = 0; i < pal.length; i++) { const p = pal[i]; const d = (p[0]-c[0])**2 + (p[1]-c[1])**2 + (p[2]-c[2])**2 + (p[3]-c[3])**2; if (d < bd) { bd = d; bi = i; } } return bi; };
  if (cols.length <= maxColors) boxes.forEach((b, i) => lut.set(key0(b[0].c), i));
  for (let i = 0; i < n; i++) { const k = key(i); let v = lut.get(k); if (v === undefined) { v = near([rgba[4*i], rgba[4*i+1], rgba[4*i+2], rgba[4*i+3]]); lut.set(k, v); } idx[i] = v; }
  return { pal, idx };
}
const key0 = c => (c[0] << 24 | c[1] << 16 | c[2] << 8 | c[3]) >>> 0;

// ---- TGA writer in the same shape the game's own textures use. rgba is top-down RGBA.
// mode: 'palette' (default, <=256 colours, 24-bit palette unless some alpha<255 -> 32-bit) | 'truecolour' (type 2, 32-bit)
function encodeTga(rgba, w, h, opts = {}) {
  if (!isPow2(w) || !isPow2(h) || w < MIN_DIM || h < MIN_DIM || w > MAX_DIM || h > MAX_DIM) throw 'texture size must be a power of two between ' + MIN_DIM + ' and ' + MAX_DIM + ' (got ' + w + 'x' + h + ')';
  if (rgba.length !== w * h * 4) throw 'pixel buffer does not match ' + w + 'x' + h;
  const hasAlpha = opts.alpha === undefined ? rgba.some((v, i) => (i & 3) === 3 && v < 255) : !!opts.alpha;
  const hd = new Uint8Array(18); hd[12] = w & 255; hd[13] = w >> 8; hd[14] = h & 255; hd[15] = h >> 8;
  if (opts.mode === 'truecolour') {
    hd[2] = 2; hd[16] = 32; const out = new Uint8Array(18 + w * h * 4); out.set(hd);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const s = ((h - 1 - y) * w + x) * 4, q = 18 + (y * w + x) * 4; out[q] = rgba[s+2]; out[q+1] = rgba[s+1]; out[q+2] = rgba[s]; out[q+3] = hasAlpha ? rgba[s+3] : 255; }
    return out;
  }
  const src = hasAlpha ? rgba : rgba.map((v, i) => (i & 3) === 3 ? 255 : v);
  const { pal, idx } = quantize(src, w, h, Math.min(256, opts.maxColors || 256)), pb = hasAlpha ? 4 : 3;
  hd[1] = 1; hd[2] = 1; hd[5] = pal.length & 255; hd[6] = pal.length >> 8; hd[7] = pb * 8; hd[16] = 8;
  const out = new Uint8Array(18 + pal.length * pb + w * h); out.set(hd); let p = 18;
  for (const c of pal) { out[p++] = c[2]; out[p++] = c[1]; out[p++] = c[0]; if (pb === 4) out[p++] = c[3]; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[p + y * w + x] = idx[(h - 1 - y) * w + x];
  return out;
}

// read a TGA's size/type without needing a wad (validates anything the user supplies)
function tgaInfo(t) {
  if (!(t instanceof Uint8Array) || t.length < 18) throw 'not a TGA';
  const w = t[12] | t[13] << 8, h = t[14] | t[15] << 8, typ = t[2];
  if (!((typ === 1 && t[16] === 8 && t[1] === 1) || (typ === 2 && t[16] === 32))) throw 'unsupported TGA (need 8-bit paletted or 32-bit truecolour)';
  if (!isPow2(w) || !isPow2(h) || w < MIN_DIM || h < MIN_DIM || w > MAX_DIM || h > MAX_DIM) throw 'texture size must be a power of two between ' + MIN_DIM + ' and ' + MAX_DIM + ' (got ' + w + 'x' + h + ')';
  const need = 18 + t[0] + (typ === 1 ? ((t[5] | t[6] << 8) * (t[7] >> 3)) : 0) + (typ === 1 ? w * h : w * h * 4);
  if (t.length < need) throw 'TGA is truncated';
  return { w, h, typ, len: need };
}

// ---- apply the project's texture ops to one wad (A,B) -> {A,B,report}. Offsets are those of the ORIGINAL wad; anything appended keeps them valid.
function applyTextureOps(A0, B0, ops) {
  if (!ops || !ops.length) return { A: A0, B: B0, report: [] };
  const imp = fixups(B0), texs = imp[0x80000001] || [], ts = new Set(texs);
  if (!texs.length) throw 'this wad has no textures to model a new one on';
  const bld = EC.Builder(A0, B0), report = [], b64 = s => (typeof s === 'string') ? Uint8Array.from(atob(s), c => c.charCodeAt(0)) : new Uint8Array(s);
  const vt = bld.U(texs[0]), f18 = 1;
  const byId = new Map();
  for (const op of ops) {
    const tga = b64(op.tga), inf = tgaInfo(tga), data = tga.subarray(0, inf.len);
    if (op.op === 'replace') {
      if (!ts.has(op.tex)) throw 'replace: no texture object at 0x' + op.tex.toString(16);
      const t = op.tex, oldLen = bld.U(t + 0x14), dp = bld.U(t + 0x10);
      if (dp === t + 0x20 && data.length <= oldLen) { // fits where the original data lives: overwrite in place
        bld.A.fill(0, t + 0x20, t + 0x20 + oldLen); bld.A.set(data, t + 0x20);
      } else { // does not fit: new block, same texture object (every part/material keeps pointing at it)
        const p = bld.alloc(data.length, 16); bld.A.set(data, p); bld.W(t + 0x10, p); bld.addRel(t + 0x10);
      }
      bld.W(t + 4, inf.w); bld.W(t + 8, inf.h); bld.W(t + 0x14, data.length);
      report.push('replaced texture @0x' + t.toString(16) + ' with ' + inf.w + 'x' + inf.h);
    } else if (op.op === 'add') {
      const o = bld.alloc(0x20 + data.length, 16);
      bld.W(o, vt); bld.W(o + 4, inf.w); bld.W(o + 8, inf.h); bld.W(o + 0x0c, 0); bld.W(o + 0x10, o + 0x20); bld.W(o + 0x14, data.length); bld.W(o + 0x18, f18); bld.W(o + 0x1c, 0);
      bld.A.set(data, o + 0x20); bld.addRel(o + 0x10); bld.addSpec(1, o, [o + 0x10]);
      if (op.id) byId.set(op.id, o);
      for (const p of op.assign || []) { bld.W(p + 0x10, o); bld.addRel(p + 0x10); }
      report.push('added texture "' + (op.id || '') + '" ' + inf.w + 'x' + inf.h + ' @0x' + o.toString(16) + ', assigned to ' + (op.assign || []).length + ' part(s)');
    } else throw 'unknown texture op ' + op.op;
  }
  const r = bld.finish();
  return { A: r.A, B: r.B, report, added: byId };
}

// texture objects of a wad with sizes, for the UI list
function listTextures(A, B) {
  const imp = fixups(B), d = new DataView(A.buffer, A.byteOffset, A.length), out = [];
  for (const t of imp[0x80000001] || []) { const w = d.getUint32(t + 4, true), h = d.getUint32(t + 8, true), x = parseTga(A, t); out.push({ off: t, w, h, tgaLen: d.getUint32(t + 0x14, true), img: x }); }
  return out.sort((a, b) => a.off - b.off);
}

export { quantize, encodeTga, tgaInfo, applyTextureOps, listTextures, isPow2 };
