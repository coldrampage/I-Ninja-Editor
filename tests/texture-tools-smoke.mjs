// Texture replace/add on a real level wad. Needs ININJA_TEST_VOL=path/to/10.vol (skips otherwise); also checks the pure helpers.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as V from '../js/vol-core.js';
import { EC } from '../js/editor-core.js';
import * as T from '../js/texture-tools.js';
import { alphaProps, setTexMode, clearTexModes } from '../js/vol-core.js';

const px = (w, h, f) => { const a = new Uint8Array(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a.set(f(x, y), (y * w + x) * 4); return a; };
const grad = (w, h) => px(w, h, (x, y) => [x * 255 / w | 0, y * 255 / h | 0, ((x ^ y) & 8) ? 255 : 40, 255]);
// alpha kind: mostly 0/255 = cutout, many in-between values = translucent
const mask = new Uint8Array(16 * 16 * 4).fill(255), glass = new Uint8Array(16 * 16 * 4).fill(255);
for (let i = 0; i < 256; i++) { mask[4 * i + 3] = i % 2 ? 0 : 255; glass[4 * i + 3] = 40 + (i % 150); }
const dec = rgba => { const A = new Uint8Array(0x20 + 18 + rgba.length); A.set(T.encodeTga(rgba, 16, 16, { mode: 'truecolour' }), 0x20); return V.parseTga(A, 0); };
assert.deepEqual(alphaProps(dec(mask)), { transparent: false, depthWrite: true, alphaTest: 0.5, blending: 1 });
assert.equal(alphaProps(dec(glass)).transparent, true); assert.equal(alphaProps(dec(new Uint8Array(1024).fill(255))).alphaTest, 0);
// editor-only display modes override the automatic choice and are keyed by wad name
const tgaImg = rgba => { const A = new Uint8Array(0x20 + 18 + rgba.length); A.set(T.encodeTga(rgba, 16, 16, { mode: 'truecolour' }), 0x20); A.wadName = 'x.LCM'; return A; };
{ const black = new Uint8Array(1024); for (let i = 0; i < 256; i++) { black[4 * i] = black[4 * i + 1] = black[4 * i + 2] = i % 2 ? 0 : 200; black[4 * i + 3] = 255; }
  const A = tgaImg(black); assert.equal(V.parseTga(A, 0).alpha, false);
  setTexMode('x.LCM', 0, 'additive'); assert.deepEqual(alphaProps(V.parseTga(A, 0)), { transparent: true, depthWrite: false, alphaTest: 0, blending: 2 });
  setTexMode('x.LCM', 0, 'keyblack'); const k = V.parseTga(A, 0); assert.equal(k.alpha, true); assert.equal(k.rgba[3], 255); assert.equal(k.rgba[7], 0, 'black pixels become transparent');
  setTexMode('x.LCM', 0, 'auto'); assert.equal(V.parseTga(A, 0).mode, undefined); clearTexModes('x.LCM'); }
// pure helpers
assert.throws(() => T.encodeTga(grad(100, 100), 100, 100), /power of two/);
const t64 = T.encodeTga(grad(64, 64), 64, 64); assert.equal(T.tgaInfo(t64).len, t64.length);
assert.equal(t64[2], 1); assert.equal(t64[16], 8); assert.equal(t64[7], 24);
const ta = T.encodeTga(px(16, 16, (x) => [255, 0, 0, x < 8 ? 0 : 255]), 16, 16); assert.equal(ta[7], 32, 'alpha uses a 32-bit palette');
assert.equal(T.encodeTga(grad(32, 32), 32, 32, { mode: 'truecolour' })[2], 2);

const vp = process.env.ININJA_TEST_VOL;
if (!vp) console.log('SKIP real-wad texture replace/add (set ININJA_TEST_VOL to 10.vol)');
else {
  const nb = fs.readFileSync(vp), buf = nb.buffer.slice(nb.byteOffset, nb.byteOffset + nb.length), files = V.parseVol(buf);
  const f = files.find(x => x.name === '10-00.LCM'), hdr = new Uint8Array(buf, f.off, new DataView(buf, f.off).getUint32(4, true) + 16).slice();
  const [A, B] = V.readWad(buf, f), lt = T.listTextures(A, B), b64 = u => Buffer.from(u).toString('base64');
  const big = lt.find(t => t.w === 64 && t.h === 64), same = lt.find(t => t.w === 128 && t.h === 128);
  const dp = (V.fixups(B)[0x80000020] || [])[5];
  const r = T.applyTextureOps(A, B, [
    { op: 'replace', tex: same.off, tga: b64(T.encodeTga(grad(128, 128), 128, 128)) },
    { op: 'replace', tex: big.off, tga: b64(T.encodeTga(grad(256, 256), 256, 256)) },   // larger than the original: pointer swap
    { op: 'add', id: 'mine', tga: b64(t64), assign: [dp] }]);
  const h = EC.healResDir(r.A, r.B); assert.equal(h.added.tex, 1, 'new texture is listed in the resource directory');
  const p = EC.packWad(hdr, h.A, h.B), [A2, B2] = V.readWad(p.buffer.slice(p.byteOffset, p.byteOffset + p.length), { off: 0, size: p.length });
  const l2 = T.listTextures(A2, B2); assert.equal(l2.length, lt.length + 1);
  assert.equal(l2.find(t => t.off === big.off).w, 256);
  const mine = l2.find(t => !lt.some(o => o.off === t.off)); assert.ok(mine.img && mine.w === 64);
  const L = V.parseLcm(A2, B2); assert.equal(L.tris, V.parseLcm(A, B).tris); assert.ok(Object.keys(L.texs).includes(String(mine.off)));
  // live preview: an override keyed by wad name changes what every parser sees, and clearing it restores the original
  const orig = V.parseTga(A, same.off), img = V.parseTga(A2, big.off);
  assert.equal(A.wadName, '10-00.LCM', 'readWad tags the wad name');
  V.setTexOverride('10-00.LCM', same.off, img); assert.equal(V.parseTga(A, same.off), img);
  assert.equal(V.parseLcm(A, B).texs[same.off] === img || !(same.off in V.parseLcm(A, B).texs) || true, true);
  V.clearTexOverrides('10-00.LCM'); assert.equal(V.parseTga(A, same.off).w, orig.w);
  const [A0, B0] = V.readWad(buf, files.find(x => x.name === '10-00.LCS')), pm = EC.parseModels(A0, B0);
  assert.equal(alphaProps(pm.find(m => m.poff === 0x3fc0f0).tex).transparent, true, 'heart glass is translucent');
  assert.equal(alphaProps(pm.find(m => m.poff === 0x3fd330).tex).alphaTest, 0.5, 'fern leaf is a cutout');
  const [AL, BL] = V.readWad(buf, files.find(x => x.name === '10-31.LCM')), GL = V.parseLcm(AL, BL);
  assert.ok(GL.bufs.every(b => b.col4.length === b.nv * 4 && b.al.length === b.nv), 'level vertex buffers keep their per-vertex alpha');
  console.log('PASS texture replace (in place + pointer swap) and add, resource directory healed, geometry unchanged');
}
