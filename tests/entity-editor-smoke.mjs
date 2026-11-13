import assert from 'node:assert/strict';
import { installEntityEditor } from '../js/entity-editor.js';

const elements = new Map();
const triggerControls = new Map([
  ['#ed_trigger', { open: true, ontoggle: null }], ['#ed_tr_type', { value: '1', onchange: null }],
  ['#ed_tr_ox', { value: '0', onchange: null }], ['#ed_tr_oy', { value: '0', onchange: null }], ['#ed_tr_oz', { value: '0', onchange: null }],
  ['#ed_tr_sx', { value: '4', onchange: null }], ['#ed_tr_sy', { value: '4', onchange: null }], ['#ed_tr_sz', { value: '4', onchange: null }],
  ['#ed_tr_reset', { onclick: null }],
]);
function element(id) {
  if (!elements.has(id)) elements.set(id, {
    id, value: '', innerHTML: '', textContent: '', dataset: {}, style: {},
    checked: false, options: [], selectedOptions: [], parentNode: { after() {} },
    querySelectorAll() { return []; }, querySelector(selector) { return id === 'ed_sel' ? (triggerControls.get(selector) || null) : null; },
    addEventListener() {}, insertAdjacentHTML() {},
  });
  return elements.get(id);
}
const globalHandlers = new Map();
globalThis.addEventListener = (type, fn) => {
  const list = globalHandlers.get(type) || [];
  list.push(fn);
  globalHandlers.set(type, list);
};
globalThis.innerWidth = 1200;
globalThis.innerHeight = 800;
globalThis.onmouseup = () => {};

const entity = {
  L: '10-00', i: 0, n: 'TestBox', p: [1, 2, 3], b: [0, 0, 0, 4, 4, 4], poly: null, path: [[1, 2, 3], [4, 5, 6]],
  shape: 1, pathbox: false, xzOnly: false, r: 0, q: null, params: [],
};
const level = { id: '10-00', ents: [entity], nb: 1 };
const project = { app: 'ininja-editor', v: 1, wads: {} };
let buildCount = 0;
let copiedPrefab = null;
const Viewer = {
  D: [level], all: [entity], sel: entity,
  $: element,
  scr: () => null,
  col: () => '#abc', esc: x => String(x), regTxt: () => '',
  buildEnts: () => { buildCount++; }, refresh() {
    if (copiedPrefab) {
      const added = { ...entity, i: 1, added: 1, p: copiedPrefab.p.slice(), params: entity.params.map(p => ({ ...p })) };
      level.ents = [entity, added];
      Viewer.all = [entity, added];
      copiedPrefab = null;
    }
  }, inspect() {},
  need: false, cv: { style: {}, addEventListener() {} },
  camera: { position: { y: 0, clone() { return this; }, addScaledVector() { return this; } } },
  V3: class { unproject() { return this; } sub() { return this; } normalize() { this.y = 1; return this; } },
  ggame: () => [0, 0, 0], mdown: null, drag: null, nearest: () => null,
};

function base(e) {
  return e.base || (e.base = { p: e.p.slice(), b: e.b.slice(), poly: e.poly, path: e.path && e.path.map(n => n.slice()), shape: e.shape, pathbox: e.pathbox, xzOnly: e.xzOnly, r: e.r, q: e.q, pv: e.params.map(p => p.v) });
}
function put(e, m) {
  const b = base(e), d = m.d || [0, 0, 0];
  e.p = b.p.map((v, i) => Math.round((v + d[i]) * 1000) / 1000);
  e.b = b.b.map((v, i) => v + d[i % 3]);
  e.shape = b.shape; e.pathbox = b.pathbox; e.xzOnly = b.xzOnly; e.poly = b.poly;
  e.path = m.path ? m.path.map(n => n.map((v, k) => v + e.p[k])) : b.path && b.path.map(n => n.map((v, k) => v + d[k]));
  if (m.trigger) { e.shape = m.trigger.ty; e.pathbox = false; e.xzOnly = [0, 2, 5].includes(m.trigger.ty); e.b = m.trigger.box.map((v, i) => v + e.p[i % 3]); e.poly = m.trigger.poly; }
  e.r = b.r + (m.dy || 0);
  e.params = e.params.map((p, i) => ({ ...p, v: m.regs?.[i] ?? b.pv[i] }));
}
const ws = {};
function WS(w) { return ws[w] || (ws[w] = project.wads[w] || (project.wads[w] = { mods: {}, adds: [], del: [] })); }
const r3 = x => Math.round(x * 1000) / 1000;
const editor = installEntityEditor({
  Viewer, EC: { referrers: () => [], prefabCheck: () => null },
  getProject: () => project, wadOf: id => id + '.LCS', getWad: () => null,
  WS, base, put, unzero: m => m.d.some(Boolean) || m.dy || m.dp || m.dr || Object.keys(m.regs).length || !!m.trigger || !!m.path,
  srcEnt: () => null, addMaxId: () => 0, ensureClass: () => null, setTriggerOverlayRender: fn => { Viewer.triggerOverlay = fn; }, setPathOverlayRender: fn => { Viewer.pathOverlay = fn; },
  pushAdds: (w, a) => { const list = WS(w).adds; const index = list.length; list.push(a); copiedPrefab = a; return index; },
  stripLinkRegs() {}, summary() {}, rmList() {}, r3,
});

assert.equal(typeof editor.update, 'function');
assert.equal(typeof editor.rec, 'function');
assert.equal(editor.rec(entity).e, entity, 'entity record should resolve the selected level instance');
editor.update();
assert.match(element('ed_sel').innerHTML, /TestBox/, 'selected entity inspector should render');

editor.setPosition(entity, [8, 2, 9]);
assert.deepEqual(entity.p, [8, 2, 9], 'position change should update the underlying level entity');
assert.deepEqual(project.wads['10-00.LCS'].mods[0].d, [7, 0, 6], 'position change should be represented as project-relative offset');
assert.equal(buildCount, 1, 'transform should rebuild the entity viewport');
assert.equal(Viewer.need, true, 'transform should request a render');
editor.setTrigger(entity, { ty: 4, box: [-2, -2, -2, 2, 2, 2], poly: null });
assert.equal(project.wads['10-00.LCS'].mods[0].trigger.ty, 4, 'trigger edits are stored in the per-entity project modification');
assert.equal(entity.shape, 4, 'trigger edit updates the live entity type');
assert.deepEqual(entity.b, [6, 0, 7, 10, 4, 11], 'trigger bounds remain attached to the moved entity');
assert.equal(typeof Viewer.triggerOverlay, 'function', 'entity editor injects the trigger viewport overlay callback');
assert.equal(typeof Viewer.pathOverlay, 'function', 'entity editor injects the waypoint viewport overlay callback');
editor.setPath(entity, [[9, 4, 9], [12, 5, 15], [12, 5, 15]], [0, 1, 1]);
assert.deepEqual(project.wads['10-00.LCS'].mods[0].path, [[1, 2, 0], [4, 3, 6], [4, 3, 6]],
  'waypoint edits are stored relative to the owning entity');
assert.deepEqual(project.wads['10-00.LCS'].mods[0].pathMap, [0, 1, 1], 'inserted waypoint keeps the source node it duplicates');
assert.deepEqual(entity.path, [[9, 4, 9], [12, 5, 15], [12, 5, 15]], 'waypoint editing updates the live entity path');
editor.setPosition(entity, [9, 3, 10]);
assert.deepEqual(entity.path, [[10, 5, 10], [13, 6, 16], [13, 6, 16]], 'waypoint edits stay attached when the entity is moved');

editor.copy();
editor.paste([10, 2, 11]);
assert.equal(project.wads['10-00.LCS'].adds.length, 1, 'paste should create a project-added instance');
assert.deepEqual(project.wads['10-00.LCS'].adds[0].p, [10, 2, 11], 'paste should preserve the requested placement');
assert.deepEqual(project.wads['10-00.LCS'].adds[0].pathMap, [0, 1, 1], 'copy/paste preserves waypoint source-node templates');
assert.equal(project.wads['10-00.LCS'].adds[0].trigger.ty, 4, 'copy/paste preserves the selected trigger override');
assert.deepEqual(project.wads['10-00.LCS'].adds[0].path, [[1, 2, 0], [4, 3, 6], [4, 3, 6]], 'copy/paste preserves waypoint path overrides');
assert.equal(Viewer.sel.i, 1, 'paste should select the newly created instance');
assert.deepEqual(editor.ground(600, 400, 2), [0, 0, 0], 'ground projection should remain available to the prefab-placement UI');

const handlers = globalHandlers.get('keydown') || [];
assert.equal(handlers.length, 2, 'link-cancel and entity shortcut handlers should be registered');
assert.equal(typeof globalThis.onmouseup, 'function', 'link-pick mouseup handler should preserve the viewer mouseup hook');

console.log('PASS entity editor module installs with explicit services');
console.log('PASS entity selection resolves and inspector renders');
console.log('PASS position editing updates the entity and project delta');
console.log('PASS entity transform rebuilds the viewport and schedules rendering');
console.log('PASS trigger overrides are saved on the selected entity and remain attached after movement');
console.log('PASS waypoint overrides are relative to the entity and remain attached after movement');
console.log('PASS entity editor installs viewport trigger and waypoint overlays and copy/paste retains both settings');
console.log('PASS entity copy/paste creates and selects a project-added instance');
console.log('PASS ground projection remains exposed to the prefab placement control');
console.log('PASS link-pick and entity keyboard handlers install without global entity state');
