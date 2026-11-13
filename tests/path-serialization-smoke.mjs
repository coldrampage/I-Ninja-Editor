import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseVol, readWad, instances, fixups } from '../js/vol-core.js';
import { EC } from '../js/editor-core.js';

const volPath = process.env.ININJA_TEST_VOL;
if (!volPath) {
  console.log('SKIP real waypoint serialization integration (set ININJA_TEST_VOL to 10.vol)');
  process.exit(0);
}
const buf = fs.readFileSync(volPath);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const files = parseVol(ab);
let done = false;
for (const f of files.filter(x => /\.LCS$/i.test(x.name))) {
  const [A, B] = readWad(ab, f), list = instances(A, B);
  const source = list.find(e => e.path && e.path.length >= 2);
  if (!source) continue;
  const local = source.path.map(n => n.map((v, k) => v - source.p[k]));
  const edited = local.map(n => n.slice());
  edited[0][0] += 7.25;
  if (edited.length > 1) edited[1][2] -= 3.5;
  const addLocal = local.map(n => n.map((v, k) => v + (k === 1 ? 2 : 0)));
  const addPos = [source.p[0] + 10, source.p[1] + 1, source.p[2] - 5];
  const movedBy = [2, 1, -2];
  const ops = {
    mods: {
      [source.i]: { d: movedBy, dy: 0, dp: 0, dr: 0, regs: {}, path: edited }
    },
    adds: [{
      from: { w: f.name, i: source.i },
      p: addPos, dy: 0, dp: 0, dr: 0, regs: {}, path: addLocal
    }]
  };
  const out = EC.patchLcs(A, B, ops, f.name, () => null, {});
  const parsed = instances(out.A, out.B);
  const editedSource = parsed.find(e => e.i === source.i);
  const added = parsed[parsed.length - 1];
  assert.equal(editedSource.path.length, source.path.length, 'original waypoint count is unchanged');
  assert.equal(added.path.length, source.path.length, 'copied waypoint count is unchanged');
  // The first prev and final next fields are null, not relocatable pointers.
  const outImp = fixups(out.B), outHeader = (outImp[0x8000010e] || [])[0];
  const outView = new DataView(out.A.buffer, out.A.byteOffset, out.A.byteLength);
  const U = o => outView.getUint32(o, true);
  const outInstances = U(outHeader + 0x28), sourceNode = U(outInstances + source.i * 0x3c + 0x30);
  let tail = sourceNode, seen = new Set();
  while (U(tail + 4) && !seen.has(tail)) { seen.add(tail); tail = U(tail + 4); }
  assert.equal(U(sourceNode), 0, 'cloned path begins with a null previous pointer');
  assert.equal(U(tail + 4), 0, 'cloned path ends with a null next pointer');
  assert.equal(outImp.rel.has(sourceNode), false, 'null previous pointer is not emitted as a relocation');
  assert.equal(outImp.rel.has(tail + 4), false, 'null next pointer is not emitted as a relocation');
  const expected = edited.map(n => n.map((v, k) => v + source.p[k] + movedBy[k]));
  expected.forEach((p, i) => p.forEach((v, k) =>
    assert.ok(Math.abs(editedSource.path[i][k] - v) < 0.002, `edited path node ${i} axis ${k} round-trips`)));
  const expectedAdd = addLocal.map(n => n.map((v, k) => v + addPos[k]));
  expectedAdd.forEach((p, i) => p.forEach((v, k) =>
    assert.ok(Math.abs(added.path[i][k] - v) < 0.002, `added path node ${i} axis ${k} round-trips`)));
  done = true;
  console.log('PASS real LCS waypoint path override serialization:', f.name, source.n, source.path.length, 'nodes');
  break;
}
assert.ok(done, 'could not find an LCS with a waypoint path');
