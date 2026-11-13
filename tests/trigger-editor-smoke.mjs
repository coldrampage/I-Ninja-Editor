import assert from 'node:assert/strict';
import { installTriggerEditor, normalizeTriggerBounds, scaleTriggerPolygon } from '../js/trigger-editor.js';

const sphere = normalizeTriggerBounds([0, 0, 0, 10, 20, 30], 4);
assert.deepEqual(sphere, [-10, -5, 0, 20, 25, 30], 'sphere bounds become equal on all axes around the same centre');
const cylinder = normalizeTriggerBounds([0, 0, 0, 10, 2, 30], 3);
assert.equal(cylinder[3] - cylinder[0], cylinder[5] - cylinder[2], 'cylinder footprint remains circular');
const scaled = scaleTriggerPolygon([0, 0, 0, 10, 0, 0, 10, 0, 10, 0, 0, 10], [0, 0, 0, 10, 10, 10], [-5, 0, -5, 15, 10, 15]);
assert.deepEqual(scaled, [-5, 0, -5, 15, 0, -5, 15, 0, 15, -5, 0, 15], 'polygon vertices scale proportionally with bounds');

const listeners = {};
const globalListeners = {};
globalThis.addEventListener = (type, fn, capture) => { globalListeners[type] = { fn, capture }; };
const q = { L: '10-00', i: 4, n: 'TestTrigger' };
const entity = { ...q, p: [0, 0, 0], b: [0, 0, 0, 10, 10, 10], shape: 1, poly: null, pathbox: false };
const R = { e: entity, m: {} };
const Viewer = {
  sel: q, need: false, drag: null, mdown: { b: 0 },
  cv: { style: {}, addEventListener(type, fn, capture) { listeners[type] = { fn, capture }; } },
  projectPoint(p) { return { x: p[0] * 10, y: p[1] * 10, z: 0 }; },
};
let overlay = null, committed = null, markup = '';
const editor = installTriggerEditor({ Viewer, commit: (_q, trigger) => { committed = trigger; }, setOverlayRender: fn => { overlay = fn; } });
const fields = new Map();
for (const [id, value] of [['#ed_trigger', ''], ['#ed_tr_type', '1'], ['#ed_tr_ox', '5'], ['#ed_tr_oy', '5'], ['#ed_tr_oz', '5'], ['#ed_tr_sx', '10'], ['#ed_tr_sy', '10'], ['#ed_tr_sz', '10'], ['#ed_tr_reset', '']]) fields.set(id, { value, onchange: null, onclick: null, disabled: false, open: true });
const container = {
  insertAdjacentHTML(_where, html) { markup += html; },
  querySelector(selector) { return fields.get(selector) || null; },
};
editor.render(container, q, R);
assert.match(markup, /ed_tr_type/, 'trigger type selector is rendered');
assert.match(markup, /ed_tr_sx/, 'trigger dimensions are rendered');
assert.equal(typeof overlay, 'function', 'viewport overlay callback is registered');
let drawn = 0;
const ctx = { fillRect() { drawn++; }, strokeRect() {}, save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} };
overlay({ ctx, project: p => Viewer.projectPoint(p), selected: entity });
assert.equal(drawn, 6, 'six visual handles are drawn for a 3D box');
fields.get('#ed_tr_type').value = '5';
fields.get('#ed_tr_type').onchange();
assert.equal(committed.ty, 5, 'type selector commits a polygon trigger');
assert.deepEqual(committed.poly, [0, 5, 0, 10, 5, 0, 10, 5, 10, 0, 5, 10], 'box-to-polygon conversion makes a rectangular XZ footprint at the bounds centre');
committed = null;

// Drag the positive-X face from x=10 to x=12 in screen space.
listeners.mousedown.fn({ button: 0, clientX: 100, clientY: 50, preventDefault() {}, stopImmediatePropagation() {} });
assert.equal(Viewer.drag, null, 'trigger resize takes ownership of the pointer instead of panning the camera');
globalListeners.mousemove.fn({ clientX: 120, clientY: 50, preventDefault() {}, stopImmediatePropagation() {} });
globalListeners.mouseup.fn({ preventDefault() {}, stopImmediatePropagation() {} });
assert.ok(committed, 'pointer release commits the resized trigger');
assert.equal(committed.box[3], 12, 'dragging the positive-X face expands the trigger bounds');

// Cylinder handles must use the manipulated horizontal axis as the diameter
// source. Otherwise the untouched axis wins Math.max(), leaving the old radius
// and merely shifting the trigger centre when the user drags inward.
assert.deepEqual(
  normalizeTriggerBounds([-5, -1, -5, 3, 1, 5], 3, 0),
  [-5, -1, -4, 3, 1, 4],
  'shrinking the X face of a cylinder also reduces its shared XZ diameter'
);
assert.deepEqual(
  normalizeTriggerBounds([-5, -1, -5, 5, 1, 3], 3, 2),
  [-4, -1, -5, 4, 1, 3],
  'shrinking the Z face of a cylinder also reduces its shared XZ diameter'
);

// Exercise the actual pointer path in both directions with a projection where
// world X and Z map to independent screen axes.
Viewer.projectPoint = p => ({ x: p[0] * 10, y: p[2] * 10, z: 0 });
const cylinderQ = { L: '10-00', i: 7, n: 'CylinderTrigger' };
const cylinderEntity = { ...entity, ...cylinderQ, p: [0, 0, 0], b: [-5, -1, -5, 5, 1, 5], shape: 3, poly: null };
const cylinderR = { e: cylinderEntity, m: {} };
Viewer.sel = cylinderQ;
editor.render(container, cylinderQ, cylinderR);
drawn = 0;
overlay({ ctx, project: p => Viewer.projectPoint(p), selected: cylinderEntity });
assert.equal(drawn, 4, 'cylinder exposes four horizontal resize handles');

listeners.mousedown.fn({ button: 0, clientX: 50, clientY: 0, preventDefault() {}, stopImmediatePropagation() {} });
globalListeners.mousemove.fn({ clientX: 30, clientY: 0, preventDefault() {}, stopImmediatePropagation() {} });
globalListeners.mouseup.fn({ preventDefault() {}, stopImmediatePropagation() {} });
assert.ok(committed, 'inward cylinder drag commits');
assert.equal(committed.box[3] - committed.box[0], 8, 'inward X drag reduces the cylinder X diameter');
assert.equal(committed.box[5] - committed.box[2], 8, 'inward X drag reduces the cylinder Z diameter to match');
assert.equal(committed.box[0], -5, 'inward X drag keeps the opposite X face anchored');
assert.equal((committed.box[0] + committed.box[3]) / 2, -1, 'inward X drag shifts the centre only by half the face movement');

cylinderEntity.b = [-5, -1, -5, 5, 1, 5];
committed = null;
overlay({ ctx, project: p => Viewer.projectPoint(p), selected: cylinderEntity });
listeners.mousedown.fn({ button: 0, clientX: 50, clientY: 0, preventDefault() {}, stopImmediatePropagation() {} });
globalListeners.mousemove.fn({ clientX: 70, clientY: 0, preventDefault() {}, stopImmediatePropagation() {} });
globalListeners.mouseup.fn({ preventDefault() {}, stopImmediatePropagation() {} });
assert.equal(committed.box[3] - committed.box[0], 12, 'outward X drag increases the cylinder diameter');
assert.equal(committed.box[5] - committed.box[2], 12, 'outward X drag keeps the XZ footprint circular');

// Numeric edits have the same axis-aware rule as viewport handles.
fields.get('#ed_tr_type').value = '3';
fields.get('#ed_tr_ox').value = '0';
fields.get('#ed_tr_oy').value = '0';
fields.get('#ed_tr_oz').value = '0';
fields.get('#ed_tr_sy').value = '2';
fields.get('#ed_tr_sx').value = '6';
fields.get('#ed_tr_sz').value = '10';
fields.get('#ed_tr_sx').onchange();
assert.equal(committed.box[3] - committed.box[0], 6, 'numeric X size edit reduces cylinder X diameter');
assert.equal(committed.box[5] - committed.box[2], 6, 'numeric X size edit synchronizes cylinder Z diameter');
fields.get('#ed_tr_sx').value = '10';
fields.get('#ed_tr_sz').value = '4';
fields.get('#ed_tr_sz').onchange();
assert.equal(committed.box[3] - committed.box[0], 4, 'numeric Z size edit uses Z as the controlling diameter');
assert.equal(committed.box[5] - committed.box[2], 4, 'numeric Z size edit synchronizes cylinder X diameter');
console.log('PASS cylinder resize handles and numeric dimensions shrink and expand symmetrically across XZ');

console.log('PASS trigger geometry constraints and polygon resizing helpers');
console.log('PASS trigger inspector renders editable type, offset and dimensions');
console.log('PASS selected trigger exposes six visual resize handles');
console.log('PASS converting a box to polygon creates a correct rectangular XZ footprint');
console.log('PASS dragging a visual handle commits updated bounds without moving the camera');
const pathEntity = { ...entity, pathbox: true };
markup = '';
editor.render(container, { ...q, i: 5 }, { e: pathEntity, m: {} });
assert.match(markup, /waypoint-defined box/, 'path-derived NextArea trigger is clearly identified');
assert.doesNotMatch(markup, /ed_tr_type/, 'path-derived trigger does not expose an ineffective shape editor');
console.log('PASS path-derived NextArea trigger stays read-only in the shape editor and is handled by the waypoint path editor');
