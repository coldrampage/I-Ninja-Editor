import assert from 'node:assert/strict';
import { installPrefabManager } from '../js/prefabs.js';

const elements = new Map();
function element(id) {
  if (!elements.has(id)) elements.set(id, {
    id, value: '', innerHTML: '', textContent: '', checked: false,
    options: [], selectedOptions: [], style: {},
    parentNode: { after() {} },
    insertAdjacentHTML(_where, html) { this.insertedHTML = (this.insertedHTML || '') + html; },
    querySelectorAll() { return []; },
  });
  return elements.get(id);
}

globalThis.document = { createElement: tag => element('created-' + tag) };
globalThis.innerWidth = 1000;
globalThis.innerHeight = 700;

const source = { i: 0, n: 'TestPrefab', p: [1, 2, 3], params: [] };
const level = { id: '10-00', all0: [source], ents: [source], nb: 1 };
const project = {
  app: 'ininja-editor', v: 1,
  wads: { '10-00.LCS': { adds: [{ id: 4 }], mods: {}, del: [], classes: [] } }
};
const wadA = new Uint8Array(0x400), wadB = new Uint8Array(1);
const wadView = new DataView(wadA.buffer);
const h = 0x20, ins = 0x100, lnk = 0x200;
wadView.setUint32(h + 0x28, ins, true);
wadView.setUint16(h + 0x30, 2, true);
wadView.setUint32(h + 0x2c, lnk, true);
wadView.setUint16(h + 0x32, 2, true);
for (let i = 0; i < 2; i++) {
  const off = ins + i * 0x3c, ip = 0x300 + i * 0x20;
  wadView.setFloat32(off + 0x10, i ? 10 : 1, true);
  wadView.setFloat32(off + 0x14, i ? 4 : 2, true);
  wadView.setFloat32(off + 0x18, i ? 13 : 3, true);
  wadView.setUint32(off + 0x2c, ip, true);
  wadView.setUint32(ip, i ? 0 : 1, true);
}
wadView.setUint16(lnk, 0, true); wadView.setUint16(lnk + 2, 0, true);
wadView.setUint16(lnk + 4, 1, true); wadView.setUint16(lnk + 6, 0, true);
let linkMode = false;

const Viewer = {
  D: [level], files: [], sel: null, all: [],
  $: element,
  refresh() {}, inspect() {},
  ggame: p => p,
  camera: { position: { clone() { return this; }, addScaledVector() { return this; } } },
  fwd: () => ({}),
};
const manager = installPrefabManager({
  Viewer,
  EC: { prefabCheck: () => null },
  getProject: () => project,
  wadOf: id => id + '.LCS',
  getWad: () => ({ cls: new Set(['TestPrefab']), A: wadA, B: wadB }),
  readWad: () => [wadA, wadB],
  instances: () => [], fixups: () => linkMode ? { [0x8000010e]: [h] } : {}, siWad: () => ({ classes: [] }),
  volOf: () => '10.vol', avlOk: () => false, vbase: s => String(s).replace(/\.(vol|avl)$/i, ''),
  WS: w => project.wads[w] || (project.wads[w] = { adds: [], mods: {}, del: [], classes: [] }),
  r3: x => Math.round(x * 1000) / 1000,
  sndPlan: () => undefined, summary() {},
  getGround: () => () => [0, 0, 0],
  getEntityRecord: () => null, updateEntity() {},
});

assert.equal(typeof element('ed_lv').onfocus, 'function', 'prefab target selector receives its discovery handler');
assert.equal(typeof element('ed_cl').onchange, 'function', 'prefab class selector receives its report handler');
assert.equal(typeof element('ed_add').onclick, 'function', 'prefab Add button receives its placement handler');
assert.equal(manager.sourceClass({ from: { w: '10-00.LCS', i: 0 } }), 'TestPrefab');
assert.equal(manager.addMaxId(), 4, 'new linked-copy IDs start above all project IDs');

const add = { from: { w: '10-00.LCS', i: 0 }, p: [5, 0, 6], regs: {} };
assert.equal(manager.pushAdds('10-00.LCS', add), 1, 'pushAdds returns the insertion ordinal');
assert.equal(project.wads['10-00.LCS'].adds[1], add, 'a normal prefab is recorded in the live project');

// Exercise the actual deep-copy link walk: root -> child and child -> root.
manager.resetCaches();
linkMode = true;
element('ed_deep').checked = true;
const deepStart = manager.pushAdds('10-00.LCS', {
  from: { w: '10-00.LCS', i: 0 }, p: [5, 0, 6], dy: 0, regs: {}
});
const deepAdds = project.wads['10-00.LCS'].adds.slice(deepStart);
assert.equal(deepAdds.length, 2, 'deep copy includes the linked child');
assert.deepEqual(deepAdds[0].lk, [[0, deepAdds[1].id]], 'root is rewired to its copied child');
assert.deepEqual(deepAdds[1].lk, [[0, deepAdds[0].id]], 'child is rewired back to its copied root');
assert.deepEqual(deepAdds[1].p, [14, 2, 16], 'child placement preserves its source offset from the root');
linkMode = false;

const links = { from: { w: '10-00.LCS', i: 0 }, regs: { 0: 123 }, lk: [[1, 99]] };
manager.stripLinkRegs(links);
assert.deepEqual(links.lk, [], 'cross-level source links are cleared before a standalone copy');
assert.equal(typeof manager.ensureClass, 'function');
assert.equal(typeof manager.injectMoveControl, 'function');
manager.resetCaches();
manager.invalidateChecks();

console.log('PASS prefab module installs its UI handlers');
console.log('PASS prefab module resolves source entities and class names');
console.log('PASS prefab module creates project additions and allocates stable IDs');
console.log('PASS prefab module deep-copies linked children and rewires both link directions');
console.log('PASS prefab module exposes dependency, link-cleanup and cache services');
