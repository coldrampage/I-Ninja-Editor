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
    click() {},
  });
  return elements.get(id);
}

globalThis.document = { createElement: tag => element('created-' + tag) };
globalThis.innerWidth = 1000;
globalThis.innerHeight = 700;

const source = { i: 0, n: 'TestPrefab', p: [1, 2, 3], params: [] };
const linkedSource = { i: 1, n: 'LinkedChild', p: [10, 4, 13], params: [] };
const level = { id: '10-00', all0: [source, linkedSource], ents: [source, linkedSource], nb: 2 };
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
let selectedRecord = null;
let archiveEnsures = 0;

const Viewer = {
  D: [level], files: [{name:'10-00.LCS', buf:new ArrayBuffer(1)}], sel: null, all: [],
  $: element,
  refresh() {}, inspect() {}, need: false,
  ggame: p => p,
  camera: { position: { clone() { return this; }, addScaledVector() { return this; } } },
  fwd: () => ({}),
};
const manager = installPrefabManager({
  Viewer,
  EC: { prefabCheck: () => null, fnv: bytes => 'hash-' + bytes.length },
  getProject: () => project,
  wadOf: id => id + '.LCS',
  getWad: () => ({ cls: new Set(['TestPrefab', 'LinkedChild']), A: wadA, B: wadB }),
  readWad: () => [wadA, wadB],
  instances: () => [], fixups: () => linkMode ? { [0x8000010e]: [h] } : {}, siWad: () => ({ classes: [] }),
  volOf: () => '10.vol', avlOk: () => false, vbase: s => String(s).replace(/\.(vol|avl)$/i, ''),
  WS: w => project.wads[w] || (project.wads[w] = { adds: [], mods: {}, del: [], classes: [] }),
  r3: x => Math.round(x * 1000) / 1000,
  sndPlan: () => undefined, summary() {},
  getGround: () => () => [0, 0, 0],
  getEntityRecord: () => selectedRecord,
  ensureSourceArchives: async (favorite, options) => { archiveEnsures++; assert.match(options.targetW, /^10-0[01]\.LCS$/); },
  updateEntity() {},
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


// Save a favourite from the selected entity. Its project-wide recipe retains the
// source reference, root register/rotation overrides and linked-child preference.
linkMode = true;
Viewer.sel = { L: '10-00', i: 0, p: [1, 2, 3], n: 'TestPrefab' };
// A linked child can carry its own register overrides, rotation and a custom
// link to a second copied child. These values must survive save/export/place.
project.wads['10-00.LCS'].mods = {
  1: { d: [1, 0, -1], dy: 64, dp: 8, dr: 0, regs: { 2: 54321 }, lk: [[0, 77]] }
};
project.wads['10-00.LCS'].adds.push({
  from: { w: '10-00.LCS', i: 1 }, p: [16, 4, 19], dy: 32, dp: 0, dr: 0,
  regs: { 3: 67890 }, id: 77, lk: []
});
selectedRecord = {
  e: source, w: '10-00.LCS',
  m: { dy: 256, dp: 16, dr: -8, regs: { 1: 12345 }, lk: [] }
};
element('ed_fav_name').value = 'Shielded Ranx';
element('ed_fav_category').value = 'Generators';
element('ed_fav_links').checked = true;
element('ed_lv').value = '10-00';
element('ed_fav_save').onclick();
assert.equal(project.prefabs.length, 1, 'saving a favourite appends it to the project-wide library');
assert.equal(project.prefabs[0].name, 'Shielded Ranx');
assert.equal(project.prefabs[0].category, 'Generators');
assert.deepEqual(project.prefabs[0].from, { w: '10-00.LCS', i: 0 });
assert.equal(project.prefabs[0].includeLinked, true);
assert.equal(project.prefabs[0].linkedCount, 2, 'favourite records the linked-child count including custom linked children');
assert.equal(project.prefabs[0].nodes.length, 3, 'favourite stores the full linked graph');
assert.equal(project.prefabs[0].nodes[1].dy, 64, 'favourite captures child rotation edits');
assert.equal(project.prefabs[0].nodes[1].regs[2], 54321, 'favourite captures child register overrides');
assert.deepEqual(project.prefabs[0].nodes[1].links, [[0, 2]], 'favourite captures child custom links by graph index');
assert.equal(project.prefabs[0].nodes[2].regs[3], 67890, 'favourite captures added-child register overrides');
assert.equal(project.prefabs[0].dy, 256);
assert.equal(project.prefabs[0].regs[1], 12345);
assert.deepEqual(project.prefabs[0].fp, { A: 'hash-1024', B: 'hash-1' }, 'favourite stores source fingerprints');

// Place from the saved library and verify it uses the existing deep-link copier,
// retaining root overrides and re-linking the copied child to the new root.
element('ed_fav_list').value = String(project.prefabs[0].id);
await element('ed_fav_place').onclick();
const placed = project.wads['10-00.LCS'].adds.slice(-3);
assert.equal(placed.length, 3, 'placing a favourite copies every linked child and custom child');
assert.equal(placed[0].dy, 256, 'favourite root rotation override is applied');
assert.equal(placed[0].regs[1], 12345, 'favourite root register override is applied');
assert.deepEqual(placed[0].lk, [[0, placed[1].id]], 'placed favourite reconnects root to its copied child');
assert.deepEqual(placed[1].lk, [[0, placed[2].id]], 'placed favourite reconnects the edited child to its custom linked child');
assert.equal(placed[1].dy, 64, 'placed linked child keeps its rotation adjustment');
assert.equal(placed[1].regs[2], 54321, 'placed linked child keeps its register overrides');
assert.equal(placed[2].regs[3], 67890, 'placed custom child keeps its own register overrides');
assert.deepEqual(placed[2].lk, [[0, placed[0].id]], 'placed custom child reconnects to the root');

// The same project-wide favourite can be placed in another compatible level.
const otherLevel = { id: '10-01', all0: [], ents: [], nb: 0 };
Viewer.D.push(otherLevel);
element('ed_lv').value = '10-01';
element('ed_fav_list').value = String(project.prefabs[0].id);
await element('ed_fav_place').onclick();
const crossLevel = project.wads['10-01.LCS'].adds;
assert.equal(crossLevel.length, 3, 'favourite can be placed in another loaded level with all linked children');
assert.deepEqual(crossLevel[0].lk, [[0, crossLevel[1].id]], 'cross-level favourite keeps its root-to-child link');
assert.deepEqual(crossLevel[1].lk, [[0, crossLevel[2].id]], 'cross-level favourite keeps the child-to-child link');
assert.equal(crossLevel[0].from.w, '10-00.LCS', 'cross-level favourite retains its original source reference');
assert.equal(crossLevel[1].regs[2], 54321, 'cross-level child register overrides are retained');
assert.ok(archiveEnsures >= 2, 'favourite placement asks the archive resolver for source and target context');

// Import merges unique source/name recipes and ignores duplicate entries.
const imported = {
  app: 'ininja-prefab-library', v: 2,
  prefabs: [
    { name: 'Shielded Ranx', from: { w: '10-00.LCS', i: 0 } },
    { name: 'Beach Switch', category: 'Switches', sourceName: 'Switch', from: { w: '10-02.LCS', i: 9 }, regs: { 2: 77 } }
  ]
};
const favFile = element('ed_fav_file');
favFile.files = [{ name: 'ininja-prefabs.json', text: async () => JSON.stringify(imported) }];
await favFile.onchange({ target: favFile });
assert.equal(project.prefabs.length, 2, 'library import skips duplicate source/name entries');
assert.equal(project.prefabs[1].name, 'Beach Switch');
assert.equal(project.prefabs[1].regs[2], 77);

// Export produces a portable library JSON without embedding game binaries.
let exportedLibraryText = '';
globalThis.Blob = class { constructor(parts) { exportedLibraryText = parts.join(''); } };
globalThis.URL = { createObjectURL: () => 'blob:favourites', revokeObjectURL() {} };
globalThis.setTimeout = callback => { callback(); return 0; };
element('ed_fav_export').onclick();
const exportedLibrary = JSON.parse(exportedLibraryText);
assert.equal(exportedLibrary.app, 'ininja-prefab-library');
assert.equal(exportedLibrary.v, 2, 'exported libraries use the graph-aware v2 schema');
assert.equal(exportedLibrary.prefabs.length, 2);

// Round-trip an exported graph recipe through the standalone library importer.
project.prefabs = [];
favFile.files = [{ name: 'ininja-prefabs.json', text: async () => exportedLibraryText }];
await favFile.onchange({ target: favFile });
const roundTrip = project.prefabs.find(f => f.name === 'Shielded Ranx');
assert.ok(roundTrip, 'exported graph favourite can be imported into a fresh project');
assert.equal(roundTrip.nodes.length, 3, 'library round-trip retains every linked graph node');
assert.equal(roundTrip.nodes[1].regs[2], 54321, 'library round-trip retains child register overrides');
assert.deepEqual(roundTrip.nodes[1].links, [[0, 2]], 'library round-trip retains child link topology');
assert.equal(roundTrip.nodes[2].regs[3], 67890, 'library round-trip retains added-child register overrides');

// Removing the selected item only removes the library entry, not placed project objects.
element('ed_fav_list').value = String(roundTrip.id);
element('ed_fav_delete').onclick();
assert.equal(project.prefabs.some(f => f.name === 'Shielded Ranx'), false, 'remove deletes the selected favourite');
assert.equal(project.wads['10-00.LCS'].adds.length >= 4, true, 'deleting a favourite leaves placed instances intact');
linkMode = false;

console.log('PASS prefab favourites save root and per-child overrides, custom links and source fingerprints');
console.log('PASS prefab favourites place full child graphs with rewired relationships and per-child registers');
console.log('PASS prefab library import deduplicates and removal preserves placed objects');
console.log('PASS prefab library v2 round-trip retains complete child settings and links');


const remainingFavorites = project.prefabs.length;
project.prefabs.push(null, { id: 999, name: 'broken entry' });
manager.renderFavorites(false);
assert.equal(project.prefabs.length, remainingFavorites, 'malformed project favourites are ignored rather than breaking the library UI');
console.log('PASS malformed project favourite entries are filtered safely');

console.log('PASS prefab library export writes portable JSON recipes');
