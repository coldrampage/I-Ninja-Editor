import assert from 'node:assert/strict';
import { installPathEditor } from '../js/path-editor.js';

const listeners = new Map();
const cv = {
  style: {},
  addEventListener(type, fn) { listeners.set('cv:' + type, fn); }
};
globalThis.addEventListener = (type, fn) => listeners.set('global:' + type, fn);
const q = { L: '10-00', i: 3 };
const path = [[0, 0, 0], [10, 0, 0]];
const R = { e: { path }, m: {} };
const Viewer = { sel: q, cv, drag: null, mdown: null, need: false };
let markup = '', committed = null, overlay = null;
const controls = {
  '#ed_path': { open: true, ontoggle: null },
  '#ed_path_reset': { disabled: false, onclick: null },
};
const inputs = path.flatMap((node, i) => node.map((v, axis) => ({
  dataset: { pathNode: String(i), pathAxis: String(axis) },
  value: String(v), onfocus: null, onchange: null,
})));
const container = {
  insertAdjacentHTML(_where, html) { markup += html; },
  querySelector(selector) { return controls[selector] || null; },
  querySelectorAll(selector) { return selector.includes('data-path-node') ? inputs : []; },
};
const editor = installPathEditor({
  Viewer,
  commit: (_entity, positions) => { committed = positions; },
  setOverlayRender: fn => { overlay = fn; },
});
editor.render(container, q, R);
assert.match(markup, /Waypoint path · 2 nodes/);
assert.match(markup, /data-path-node="1"/, 'each node has numeric coordinate controls');
assert.equal(typeof inputs[0].onchange, 'function');
assert.equal(typeof controls['#ed_path_reset'].onclick, 'function');

const drawCalls = [];
const ctx = {
  save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
  arc() {}, fill() {}, fillText() {}, fillRect() {},
  set lineWidth(v) {}, set strokeStyle(v) {}, set fillStyle(v) {}, set font(v) {},
};
overlay({ ctx, project: p => ({ x: p[0] * 10, y: p[1] * 10, z: 0 }), selected: q });
const down = listeners.get('cv:mousedown');
const move = listeners.get('global:mousemove');
const up = listeners.get('global:mouseup');
const event = (x, y) => ({
  button: 0, clientX: x, clientY: y, target: cv,
  preventDefault() {}, stopImmediatePropagation() {},
});
down(event(15, 0)); // X-axis grip of node 0
assert.equal(cv.style.cursor, 'grabbing');
move(event(25, 0));
up(event(25, 0));
assert.equal(committed[0][0], 1, 'dragging an X grip moves only the selected waypoint X coordinate');
assert.deepEqual(committed[1], [10, 0, 0], 'other waypoint nodes remain unchanged');

inputs[4].value = '12.5'; // node 2, Y coordinate
inputs[4].onchange();
assert.equal(committed[1][1], 12.5, 'numeric waypoint coordinate edits commit');
controls['#ed_path_reset'].onclick();
assert.equal(committed, null, 'reset removes the project path override');
console.log('PASS waypoint path inspector, numeric editing, 3D axis handles and reset');
