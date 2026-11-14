// Texture replace/add on a real level wad. Needs ININJA_TEST_VOL=path/to/10.vol (skips otherwise); also checks the pure helpers.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as V from '../js/vol-core.js';
import { EC } from '../js/editor-core.js';
import * as T from '../js/texture-tools.js';

const px = (w, h, f) => { const a = new Uint8Array(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a.set(f(x, y), (y * w + x) * 4); return a; };
const grad = (w, h) => px(w, h, (x, y) => [x * 255 / w | 0, y * 255 / h | 0, ((x ^ y) & 8) ? 255 : 40, 255]);
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
  console.log('PASS texture replace (in place + pointer swap) and add, resource directory healed, geometry unchanged');
}
