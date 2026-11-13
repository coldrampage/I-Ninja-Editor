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
  const source = list.find(e => e.path && e.path.length >= 2 && e.path.length < 64);
  if (!source) continue;
  const local = source.path.map(n => n.map((v, k) => v - source.p[k]));
  const edited = local.map(n => n.slice());
  edited[0][0] += 7.25;
  if (edited.length > 1) edited[1][2] -= 3.5;
  // Duplicate original node 1 after itself. It must inherit that node's full
  // binary template, not simply append an anonymous zero-filled node.
  edited.splice(2, 0, edited[1].slice());
  const editedMap = local.map((_, i) => i);
  editedMap.splice(2, 0, 1);

  const addLocal = local.map(n => n.map((v, k) => v + (k === 1 ? 2 : 0)));
  const addMap = local.map((_, i) => i);
  addLocal.splice(addLocal.length - 1, 0, addLocal[addLocal.length - 1].slice());
  addMap.splice(addMap.length - 1, 0, addMap[addMap.length - 1]);
  const addPos = [source.p[0] + 10, source.p[1] + 1, source.p[2] - 5];
  const movedBy = [2, 1, -2];
  const ops = {
    mods: {
      [source.i]: { d: movedBy, dy: 0, dp: 0, dr: 0, regs: {}, path: edited, pathMap: editedMap }
    },
    adds: [{
      from: { w: f.name, i: source.i },
      p: addPos, dy: 0, dp: 0, dr: 0, regs: {}, path: addLocal, pathMap: addMap
    }]
  };
  const out = EC.patchLcs(A, B, ops, f.name, () => null, {});
  const parsed = instances(out.A, out.B);
  const editedSource = parsed.find(e => e.i === source.i);
  const added = parsed[parsed.length - 1];
  assert.equal(editedSource.path.length, source.path.length + 1, 'existing instance path gains one waypoint');
  assert.equal(added.path.length, source.path.length + 1, 'copied instance path gains one waypoint');

  const expected = edited.map(n => n.map((v, k) => v + source.p[k] + movedBy[k]));
  expected.forEach((p, i) => p.forEach((v, k) =>
    assert.ok(Math.abs(editedSource.path[i][k] - v) < 0.002, `edited path node ${i} axis ${k} round-trips`)));
  assert.deepEqual(editedSource.path[1], editedSource.path[2], 'inserted waypoint duplicates the selected node position');
  const expectedAdd = addLocal.map(n => n.map((v, k) => v + addPos[k]));
  expectedAdd.forEach((p, i) => p.forEach((v, k) =>
    assert.ok(Math.abs(added.path[i][k] - v) < 0.002, `added path node ${i} axis ${k} round-trips`)));
  assert.deepEqual(added.path.at(-2), added.path.at(-1), 'added instance duplicate is inserted before the next/tail waypoint');

  // The linked list is rebuilt in order, and null end-pointers are not relocated.
  const outImp = fixups(out.B), outHeader = (outImp[0x8000010e] || [])[0];
  const outView = new DataView(out.A.buffer, out.A.byteOffset, out.A.byteLength);
  const U = o => outView.getUint32(o, true);
  const outInstances = U(outHeader + 0x28);
  const chain = instanceIndex => {
    let node = U(outInstances + instanceIndex * 0x3c + 0x30), seen = new Set();
    while (U(node) && !seen.has(node)) { seen.add(node); node = U(node); }
    const head = node, result = [], forward = new Set();
    while (node && !forward.has(node)) { forward.add(node); result.push(node); node = U(node + 4); }
    return { head, nodes: result, tail: result.at(-1) };
  };
  const originalImp = fixups(B), originalHeader = (originalImp[0x8000010e] || [])[0];
  const originalView = new DataView(A.buffer, A.byteOffset, A.byteLength);
  const U0 = o => originalView.getUint32(o, true);
  const originalInstances = U0(originalHeader + 0x28);
  const originalPointer = U0(originalInstances + source.i * 0x3c + 0x30);
  const originalChain = (() => {
    let n = originalPointer, seen = new Set();
    while (U0(n) && !seen.has(n)) { seen.add(n); n = U0(n); }
    const outNodes = [], forward = new Set();
    while (n && !forward.has(n)) { forward.add(n); outNodes.push(n); n = U0(n + 4); }
    return outNodes;
  })();
  const originalCurrentIndex = originalChain.indexOf(originalPointer);
  const sourceNodeTemplate = originalChain[1];

  for (const [index, expectedCount] of [[source.i, edited.length], [added.i, addLocal.length]]) {
    const c = chain(index);
    assert.equal(c.nodes.length, expectedCount, 'rebuilt path has the expected number of linked nodes');
    assert.equal(U(c.head), 0, 'cloned path begins with a null previous pointer');
    assert.equal(U(c.tail + 4), 0, 'cloned path ends with a null next pointer');
    assert.equal(outImp.rel.has(c.head), false, 'null previous pointer is not emitted as a relocation');
    assert.equal(outImp.rel.has(c.tail + 4), false, 'null next pointer is not emitted as a relocation');
    c.nodes.forEach((n, i) => {
      assert.equal(U(n + 4), c.nodes[i + 1] || 0, 'next link follows inserted path order');
      assert.equal(U(n), c.nodes[i - 1] || 0, 'previous link follows inserted path order');
    });
  }
  const editedChain = chain(source.i);
  const outputPointer = U(outInstances + source.i * 0x3c + 0x30);
  const expectedCurrentIndex = editedMap.indexOf(originalCurrentIndex);
  assert.equal(outputPointer, editedChain.nodes[expectedCurrentIndex],
    'entity retains its current-node pointer after inserted nodes shift later chain indices');
  const addedChain = chain(added.i);
  const addedPointer = U(outInstances + added.i * 0x3c + 0x30);
  assert.equal(addedPointer, addedChain.nodes[addMap.indexOf(originalCurrentIndex)],
    'copied instance retains its current-node pointer after insertion');
  const insertedNode = editedChain.nodes[2];
  for (let offset = 0x14; offset < 0x40; offset += 4) {
    if (!originalImp.rel.has(sourceNodeTemplate + offset)) {
      assert.equal(U(insertedNode + offset), U0(sourceNodeTemplate + offset),
        `inserted duplicate preserves node template metadata at +0x${offset.toString(16)}`);
    }
  }

  // Deleting the node currently referenced by the instance must re-home the
  // pointer to the nearest surviving source node (prefer previous on a tie).
  const deletedIndex = originalCurrentIndex;
  const deletedPath = local.filter((_, i) => i !== deletedIndex);
  const deletedMap = local.map((_, i) => i).filter(i => i !== deletedIndex);
  const deletedOut = EC.patchLcs(A, B, {
    mods: { [source.i]: { path: deletedPath, pathMap: deletedMap } }
  }, f.name, () => null, {});
  const deletedParsed = instances(deletedOut.A, deletedOut.B).find(e => e.i === source.i);
  assert.equal(deletedParsed.path.length, source.path.length - 1, 'deleted waypoint is omitted from rebuilt path');
  const deletedImp = fixups(deletedOut.B), deletedHeader = (deletedImp[0x8000010e] || [])[0];
  const deletedView = new DataView(deletedOut.A.buffer, deletedOut.A.byteOffset, deletedOut.A.byteLength);
  const UD = o => deletedView.getUint32(o, true);
  const deletedIns = UD(deletedHeader + 0x28);
  const deletedPointer = UD(deletedIns + source.i * 0x3c + 0x30);
  let deletedHead = deletedPointer, seenBack = new Set();
  while (UD(deletedHead) && !seenBack.has(deletedHead)) { seenBack.add(deletedHead); deletedHead = UD(deletedHead); }
  const deletedNodes = [], seenForward = new Set();
  for (let node = deletedHead; node && !seenForward.has(node); node = UD(node + 4)) {
    seenForward.add(node); deletedNodes.push(node);
  }
  assert.equal(deletedNodes.length, deletedPath.length, 'deleted path has a rebuilt linked list with the reduced node count');
  const expectedCurrentSource = deletedIndex > 0 ? deletedIndex - 1 : deletedIndex + 1;
  const expectedCurrentOutput = deletedMap.indexOf(expectedCurrentSource);
  assert.ok(expectedCurrentOutput >= 0, 'nearest surviving node is available');
  assert.equal(deletedPointer, deletedNodes[expectedCurrentOutput],
    'deleting the current waypoint moves the entity current-node pointer to its nearest surviving neighbour');
  deletedNodes.forEach((node, i) => {
    assert.equal(UD(node), deletedNodes[i - 1] || 0, 'deleted chain previous links are rebuilt');
    assert.equal(UD(node + 4), deletedNodes[i + 1] || 0, 'deleted chain next links are rebuilt');
  });
  done = true;
  console.log('PASS real LCS waypoint insertion/deletion serialization:', f.name, source.n, source.path.length, 'source nodes');
  break;
}
assert.ok(done, 'could not find an LCS with an insertable waypoint path');
