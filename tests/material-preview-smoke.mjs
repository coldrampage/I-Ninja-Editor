import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { previewFrameIndex, previewUvOffset } from '../js/material-preview.js';

assert.equal(previewFrameIndex(8, 0), 0);
assert.equal(previewFrameIndex(8, 16), 0);
assert.equal(previewFrameIndex(8, 17), 1);
assert.equal(previewFrameIndex(8, 1000), 4);
assert.equal(previewFrameIndex(8, 2000), 0);
assert.equal(previewFrameIndex(0, 1000), 0);
assert.deepEqual(previewUvOffset({uMode:0,vMode:0,uVelocity:0.25,vVelocity:-0.5,uOffset:0,vOffset:0}, 2000), [0.5, -1]);
{ const uv = previewUvOffset({uMode:1,vMode:2,uVelocity:0.5,vVelocity:0.4,uFrequency:Math.PI,vFrequency:Math.PI,uOffset:0.1,vOffset:-0.2}, 500); assert.ok(Math.abs(uv[0] - 0.6) < 1e-12 && Math.abs(uv[1] + 0.2) < 1e-12); }
assert.deepEqual(previewUvOffset({uMode:2,vMode:1,uVelocity:0.4,vVelocity:0.5,uFrequency:Math.PI,vFrequency:Math.PI,uOffset:0,vOffset:0}, 0), [0.4, 0]);
{ const uv = previewUvOffset({uMode:2,vMode:1,uVelocity:0.4,vVelocity:0.5,uFrequency:Math.PI,vFrequency:Math.PI,uOffset:0,vOffset:0}, 1000); assert.ok(Math.abs(uv[0] + 0.4) < 1e-12 && Math.abs(uv[1]) < 1e-12); }
{ const uv = previewUvOffset({uMode:1,vMode:0,uVelocity:0.6,vVelocity:0.25,uFrequency:Math.PI/2,vFrequency:0,uOffset:0.1,vOffset:0.2}, 1000); assert.ok(Math.abs(uv[0] - 0.7) < 1e-12 && Math.abs(uv[1] - 0.45) < 1e-12); }
assert.deepEqual(previewUvOffset({uMode:7,vMode:9,uVelocity:1,vVelocity:1,uFrequency:3,vFrequency:4,uOffset:0.2,vOffset:-0.3}, 1000), [0.2, -0.3]);
assert.deepEqual(previewUvOffset({uMode:0,vMode:0,uVelocity:NaN,vVelocity:Infinity,uOffset:NaN,vOffset:Infinity}, 1000), [0, 0]);

// Guard the viewer integration as well as the pure arithmetic: frame maps must
// be allocated on demand and retexture() must recognise as-yet-unseen frames.
const viewer = readFileSync(new URL('../js/viewer.js', import.meta.url), 'utf8');
assert.match(viewer, /const getMap=off=>/, 'frame texture maps are created lazily');
assert.match(viewer, /u\.getMap\?u\.getMap\(off\)/, 'frame changes request maps on demand');
assert.match(viewer, /u\.frameOffsets&&u\.frameOffsets\.includes\(off\)/, 'texture replacement recognises unvisited animation frames');
assert.match(viewer, /previewFrameIndex\(u\.frameOffsets\.length,elapsedMs,60\)/, 'viewer uses the documented 60-Hz preview approximation');
assert.match(viewer, /previewUvOffset\(scroll,0\)/, 'each kind-7 layer map starts at its native static phase');
assert.match(viewer, /previewUvOffset\(u\.scroll,elapsedMs\)/, 'viewer evaluates decoded linear/sine/cosine UV modes');
assert.match(viewer, /uMode:layer\.uMode,vMode:layer\.vMode/, 'viewer passes independent U/V mode bytes into preview');
console.log('PASS material preview frame stepping, native kind-7 linear/sine/cosine motion and lazy viewer integration');
