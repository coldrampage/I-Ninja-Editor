// Kind-6 animated-texture and kind-7 layered-material parsers. No game files required.
import assert from 'node:assert/strict';
import { parseMaterialResources } from '../js/vol-core.js';
import { listMaterialResources } from '../js/texture-tools.js';

const A = new Uint8Array(0x1000);
const d = new DataView(A.buffer);
const W = (o, v) => d.setUint32(o, v >>> 0, true);
const F = (o, v) => d.setFloat32(o, v, true);

// Animated texture wrapper at 0x100 -> animation data -> three ordinary texture pointers.
W(0x100 + 0x10, 0x300);
W(0x300, 3); W(0x304, 0x340);
W(0x340, 0x400); W(0x344, 0x500); W(0x348, 0x600);

// Layered material at 0x200 -> two 0x40-byte layer records.
W(0x204, 256); W(0x208, 128); W(0x20c, 2); W(0x210, 0x700);
W(0x700, 0x400); F(0x704, 0.25); F(0x708, -0.5); W(0x70c, 0x3f800000);
F(0x710, 1); F(0x714, 0.5); F(0x718, 0.25); F(0x71c, 0.75);
W(0x720, 0x0201); F(0x724, 1.5); F(0x728, 2.5); F(0x72c, 0.1); F(0x730, -0.2); F(0x734, 0.25);
W(0x740, 0x500); F(0x744, -1.25); F(0x748, 2.5); W(0x760, 0x11);

// A deliberately invalid animation wrapper tests bounds handling.
W(0x800 + 0x10, 0xfffffff0);
const fixups = [
  0x80000001, 0x400, 0x80000001, 0x500, 0x80000001, 0x600,
  0x80000006, 0x100, 0x80000006, 0x800, 0x80000007, 0x200
];
const B = new Uint8Array(new Uint32Array(fixups).buffer);

const parsed = parseMaterialResources(A, B);
assert.equal(parsed.length, 3);
const anim = parsed.find(x => x.offset === 0x100);
assert.equal(anim.type, 'animated');
assert.equal(anim.valid, true);
assert.equal(anim.frameCount, 3);
assert.equal(anim.animationDataOffset, 0x300);
assert.equal(anim.frameArrayOffset, 0x340);
assert.deepEqual(anim.frameOffsets, [0x400, 0x500, 0x600]);
assert.equal(anim.frameTextureCount, 3);

const layered = parsed.find(x => x.offset === 0x200);
assert.equal(layered.type, 'layered');
assert.equal(layered.valid, true);
assert.deepEqual([layered.targetWidth, layered.targetHeight, layered.layerCount], [256, 128, 2]);
assert.equal(layered.layers[0].textureOffset, 0x400);
assert.equal(layered.layers[0].uVelocity, 0.25);
assert.equal(layered.layers[0].vVelocity, -0.5);
assert.deepEqual(layered.layers[0].color, [1, 0.5, 0.25, 0.75]);
assert.equal(layered.layers[0].rotationRaw, 0x3f800000);
assert.equal(layered.layers[0].rotationVelocity, 1);
assert.equal(layered.layers[0].modeRaw, 0x0201);
assert.equal(layered.layers[0].uMode, 1);
assert.equal(layered.layers[0].vMode, 2);
assert.equal(layered.layers[0].uFrequency, 1.5);
assert.equal(layered.layers[0].vFrequency, 2.5);
assert.equal(layered.layers[0].value24Raw, 0x3fc00000);
assert.equal(layered.layers[0].value28Raw, 0x40200000);
assert.ok(Math.abs(layered.layers[0].uOffset - 0.1) < 1e-6);
assert.ok(Math.abs(layered.layers[0].vOffset + 0.2) < 1e-6);
assert.equal(layered.layers[0].rotationOffset, 0.25);
assert.equal(layered.layers[0].rawWords.length, 16);
assert.equal(layered.layers[1].textureOffset, 0x500);

const invalid = parsed.find(x => x.offset === 0x800);
assert.equal(invalid.valid, false);
assert.match(invalid.error, /pointer is invalid/);
assert.equal(listMaterialResources(A, B).length, 3);
console.log('PASS kind-6 frame-array and kind-7 layer-record parsing; malformed wrapper bounds are rejected');
