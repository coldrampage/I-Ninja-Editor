import assert from 'node:assert/strict';
import { EC } from '../js/editor-core.js';

// Two different source offsets contain the same string. copyGraph should emit
// one shared string payload but retain a relocation mapping for BOTH source
// pointers; otherwise transplantClasses later reports "unresolved pointer in block".
const A = new Uint8Array(0x1000);
const d = new DataView(A.buffer);
const putString = (at, value) => {
  A[at - 1] = 0;
  for (let i = 0; i < value.length; i++) A[at + i] = value.charCodeAt(i);
  A[at + value.length] = 0;
};
putString(0x500, 'Ranx_Shield_Open');
putString(0x640, 'Ranx_Shield_Open');

const S = {
  A,
  U: o => d.getUint32(o, true),
  w: { rel: new Set() },
  imp: {},
  res: new Map(),
  classes: new Map(),
  code: 0x2000,
  codeEnd: 0x2100,
  clEnd: 0x300,
  bindStart: 0x400,
  ins0: 0x2000,
  next: () => A.length,
  str: v => {
    if (!v || A[v - 1] !== 0) return null;
    let end = v;
    while (end < A.length && A[end] !== 0) end++;
    return end > v && end - v <= 80
      ? String.fromCharCode(...A.subarray(v, end))
      : null;
  }
};

function builder() {
  const out = new Uint8Array(0x1000);
  const od = new DataView(out.buffer);
  return {
    A: out,
    len: 0x100,
    rel: new Set(),
    newRel: [],
    newSpec: [],
    alloc(size, align = 16) {
      const at = Math.ceil(this.len / align) * align;
      if (at + size > this.A.length) throw new Error('test builder overflow');
      this.len = at + size;
      return at;
    },
    W(at, value) { od.setUint32(at, value >>> 0, true); },
    addRel(at) { this.rel.add(at); this.newRel.push(at); },
    addRelTo(arr, at) { this.rel.add(at); arr.push(at); },
    addSpec(kind, loc, rels) { this.newSpec.push({ kind, loc, rels }); }
  };
}

for (const [name, copy] of [['copyData', EC.copyData], ['copyGraph', (src, bld, roots) =>
  EC.copyGraph(src, bld, roots, {}, { addRes: true })]]) {
  const map = copy(S, builder(), [0x500, 0x640], {});
  assert.ok(map.has(0x500), name + ' maps the first source string pointer');
  assert.ok(map.has(0x640), name + ' maps the second source string pointer');
  assert.equal(map.get(0x500), map.get(0x640),
    name + ' reuses one copied string address without losing per-pointer mappings');
}

console.log('PASS copyData and copyGraph map every source pointer when identical strings are deduplicated');
