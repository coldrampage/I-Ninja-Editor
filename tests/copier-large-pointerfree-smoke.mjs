import assert from 'node:assert/strict';
import { EC } from '../js/editor-core.js';

const START = 0x500;
const LENGTH = 118756; // exact oversized level-data extent reported for LogTurretTotemPole

function sourceWithLargeData(pointerful = false) {
  const A = new Uint8Array(START + LENGTH);
  for (let i = START; i < A.length; i++) A[i] = (i * 37 + 11) & 0xff;
  const d = new DataView(A.buffer);
  const rel = new Set();
  if (pointerful) {
    rel.add(START + 4);
    d.setUint32(START + 4, 0x90000, true);
  }
  return {
    A,
    U: offset => d.getUint32(offset, true),
    w: { rel },
    imp: {},
    res: new Map(),
    classes: new Map(),
    code: A.length + 0x1000,
    codeEnd: A.length + 0x2000,
    clEnd: 0x300,
    bindStart: A.length + 0x3000,
    ins0: A.length + 0x4000,
    next: () => A.length,
    str: () => null
  };
}

function builder(capacity = START + LENGTH + 0x1000) {
  const A = new Uint8Array(capacity);
  const d = new DataView(A.buffer);
  return {
    A, len: START, newRel: [], newSpec: [], rel: new Set(),
    alloc(size, alignment = 16) {
      const at = Math.ceil(this.len / alignment) * alignment;
      if (at + size > this.A.length) throw new Error('test builder overflow');
      this.len = at + size;
      return at;
    },
    W(offset, value) { d.setUint32(offset, value >>> 0, true); },
    addRel(offset) { this.rel.add(offset); this.newRel.push(offset); },
    addRelTo(rows, offset) { this.rel.add(offset); rows.push(offset); },
    addSpec(kind, loc, rels) { this.newSpec.push({ kind, loc, rels }); }
  };
}

const source = sourceWithLargeData(false);
const output = builder();
const map = EC.copyGraph(source, output, [START], {}, { addRes: true });
assert.ok(map.has(START), 'large opaque data object receives a destination mapping');
assert.equal(map.sizes.get(map.get(START)), LENGTH, 'the complete 118,756-byte extent is retained');
assert.deepEqual(
  output.A.subarray(map.get(START), map.get(START) + LENGTH),
  source.A.subarray(START),
  'pointer-free object bytes are copied without truncation or interpretation'
);

const pointerful = sourceWithLargeData(true);
assert.throws(
  () => EC.copyGraph(pointerful, builder(), [START], {}, { addRes: true }),
  /data @500 is too large to copy safely \(118756 bytes\)/,
  'large blocks containing relocations remain guarded because their layout is unknown'
);

const tooLarge = sourceWithLargeData(false);
const oversizeA = new Uint8Array(START + (8 << 20) + 1);
const oversizeD = new DataView(oversizeA.buffer);
Object.assign(tooLarge, {
  A: oversizeA,
  U: offset => oversizeD.getUint32(offset, true),
  next: () => oversizeA.length
});
assert.throws(
  () => EC.copyGraph(tooLarge, builder(START + (8 << 20) + 0x1000), [START], {}, { addRes: true }),
  /data @500 is too large to copy safely/,
  'the hard 8 MiB allocation ceiling is unchanged'
);

console.log('PASS copyGraph safely copies large pointer-free opaque data while retaining relocation and size guards');
