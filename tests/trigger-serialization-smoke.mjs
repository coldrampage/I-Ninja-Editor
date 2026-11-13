import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseVol, readWad, instances } from '../js/vol-core.js';
import { EC } from '../js/editor-core.js';

const volPath = process.env.ININJA_TEST_VOL;
if (!volPath) {
  console.log('SKIP real trigger serialization integration (set ININJA_TEST_VOL to 10.vol)');
  process.exit(0);
}
const buf = fs.readFileSync(volPath);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const files = parseVol(ab);
let done = false;
for (const f of files.filter(x => /\.LCS$/i.test(x.name))) {
  const [A, B] = readWad(ab, f), list = instances(A, B);
  const primitive = list.find(e => e.b && e.shape === 1);
  const polygon = list.find(e => e.b && e.shape === 5 && e.poly && e.poly.length >= 9);
  if (!primitive || !polygon) continue;
  const toLocal = e => e.b.map((v, k) => v - e.p[k % 3]);
  const polyLocal = e => e.poly.map((v, k) => v - e.p[k % 3]);
  const primitiveBox = toLocal(primitive);
  const polygonBox = toLocal(polygon);
  const scaledPolygonBox = polygonBox.map((v, k) => v + (k < 3 ? -1 : 1));
  const ops = {
    mods: {
      [primitive.i]: { d: [0, 0, 0], dy: 0, dp: 0, dr: 0, regs: {}, trigger: { ty: 4, box: [primitiveBox[0], primitiveBox[1], primitiveBox[2], primitiveBox[3], primitiveBox[4], primitiveBox[5] + 4], poly: null } },
      [polygon.i]: { d: [0, 0, 0], dy: 0, dp: 0, dr: 0, regs: {}, trigger: { ty: 6, box: scaledPolygonBox, poly: polyLocal(polygon).map((v, k) => v + (k % 3 === 0 ? -1 : k % 3 === 2 ? 1 : 0)) } },
    },
    adds: [{ from: { w: f.name, i: primitive.i }, p: [primitive.p[0] + 8, primitive.p[1], primitive.p[2] + 8], trigger: { ty: 5, box: primitiveBox, poly: [primitiveBox[0], primitiveBox[1], primitiveBox[2], primitiveBox[3], primitiveBox[1], primitiveBox[2], primitiveBox[3], primitiveBox[1], primitiveBox[5], primitiveBox[0], primitiveBox[1], primitiveBox[5]] } }],
  };
  const out = EC.patchLcs(A, B, ops, f.name, () => null, {});
  const parsed = instances(out.A, out.B);
  const p1 = parsed.find(e => e.i === primitive.i), p2 = parsed.find(e => e.i === polygon.i), added = parsed[parsed.length - 1];
  assert.equal(p1.shape, 4, 'primitive trigger type is converted to sphere');
  assert.ok(p1.b && p1.b.every(Number.isFinite), 'sphere bounds are valid after reparse');
  assert.deepEqual(p1.b, primitive.b.map((v, k) => v + (k === 5 ? 4 : 0)), 'edited bounds and entity-relative offsets serialize to the expected world coordinates');
  assert.equal(p2.shape, 6, 'polygon trigger converts from XZ-only to 3D polygon');
  assert.equal(p2.poly.length, polygon.poly.length, 'polygon vertex count survives serialization');
  assert.deepEqual(p2.b, polygon.b.map((v, k) => v + (k < 3 ? -1 : 1)), 'polygon bounds resize symmetrically around the requested offset');
  const expectedPoly = polygon.poly.map((v, k) => v + (k % 3 === 0 ? -1 : k % 3 === 2 ? 1 : 0));
  assert.ok(p2.poly.every((v, k) => Math.abs(v - expectedPoly[k]) < 0.001), 'polygon vertices follow the edited bounds');
  assert.equal(added.shape, 5, 'added instance can carry a project-edited polygon trigger');
  assert.equal(added.poly.length, 12, 'new polygon vertices survive relocation/serialization');
  done = true;
  console.log('PASS real LCS trigger type, bounds, polygon and project-added instance serialization:', f.name);
  break;
}
assert.ok(done, 'could not find a level with both primitive and polygon triggers');
