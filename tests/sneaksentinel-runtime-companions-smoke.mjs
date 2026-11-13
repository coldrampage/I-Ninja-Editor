import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseVol, readWad, instances, siWad, fixups } from '../js/vol-core.js';
import { EC } from '../js/editor-core.js';
import { installPrefabManager, discoverNamedCompanionInstances } from '../js/prefabs.js';

// Real-game integration. Set ININJA_TEST_VOL and ININJA_TEST_AVL to the matching PC archives.
const volPath = process.env.ININJA_TEST_VOL;
if (!volPath || !fs.existsSync(volPath)) {
  console.log('SKIP real SneakSentinel runtime companion copy (set ININJA_TEST_VOL to 10.vol)');
  process.exit(0);
}
const avlPath = process.env.ININJA_TEST_AVL || volPath.replace(/\.vol$/i, '.avl');
if (!fs.existsSync(avlPath)) {
  console.log('SKIP real SneakSentinel runtime companion copy (matching .avl not found)');
  process.exit(0);
}
const asBuffer = path => {
  const bytes = fs.readFileSync(path);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};
const vol = asBuffer(volPath), avl = asBuffer(avlPath);
const avlFiles = parseVol(avl);
const files = parseVol(vol).map(f => ({ ...f, buf: vol, vol: '10.vol' }));
const rawWad = name => {
  const f = files.find(x => x.name === name);
  assert.ok(f, `missing ${name}`);
  const [A, B] = readWad(vol, f);
  return { A, B, f };
};
const source = rawWad('10-30.LCS'), target = rawWad('10-00.LCS');
const sourceEntities = instances(source.A, source.B);
const root = sourceEntities.find(e => e.i === 10);
assert.equal(root?.n, 'SneakSentinel');

// Discovery follows only exact script-string -> class-name matches and excludes
// all other instances of the root class (the source level contains two Sentinels).
const sourceInfo = {
  ...source, ents: sourceEntities,
  rep: EC.classReports(source.A, source.B),
  cls: new Set(siWad(source.A, source.B).classes.map(c => c.name))
};
const found = discoverNamedCompanionInstances(sourceInfo, 'SneakSentinel', {
  excludeClasses: ['SneakSentinel'],
  canCopy: e => !EC.prefabCheck(source.A, source.B, e.i)
});
assert.deepEqual(found.map(x => [x.name, x.i, x.via]), [
  ['SneakTeleport', 37, 'SneakSentinel'],
  ['TeleportFXController', 2, 'SneakTeleport']
]);

// Install the actual prefab module with real parsers and a minimal DOM/viewer.
const elements = new Map();
const el = id => {
  if (!elements.has(id)) elements.set(id, {
    id, value: '', innerHTML: '', textContent: '', checked: false,
    options: [], selectedOptions: [], style: {},
    parentNode: { after() {} }, insertAdjacentHTML() {}, querySelectorAll() { return []; }, click() {}
  });
  return elements.get(id);
};
globalThis.document = { createElement: tag => el('created-' + tag) };
globalThis.innerWidth = 1280; globalThis.innerHeight = 720;
const project = { app: 'ininja-editor', v: 1, wads: {}, prefabs: [] };
const wadCache = new Map();
const getWad = name => {
  if (!wadCache.has(name)) {
    const g = rawWad(name);
    wadCache.set(name, { A: g.A, B: g.B, cls: new Set(siWad(g.A, g.B).classes.map(c => c.name)) });
  }
  return wadCache.get(name);
};
const viewer = { files, D: [], sel: null, all: [], $: el, refresh() {}, inspect() {}, need: false };
const projectWads = {};
const WS = w => projectWads[w] || (projectWads[w] = { mods: {}, adds: [], del: [], classes: [] });
const volEntry = files.find(f => f.name === '10-00.LCS');
const volHeader = new DataView(vol, volEntry.off);
const manager = installPrefabManager({
  Viewer: viewer, EC, getProject: () => project, wadOf: id => id + '.LCS', getWad,
  readWad, instances, fixups, siWad, volOf: () => '10.vol', avlOk: () => true,
  vbase: value => String(value).replace(/\.(vol|avl)$/i, ''), WS,
  r3: value => Math.round(value * 1000) / 1000,
  sndPlan: () => EC.SoundPlan(volHeader.getUint32(0x78, true), volHeader.getUint32(0x7c, true)),
  summary() {}, getGround: () => () => [100, 0, 100], getEntityRecord: () => null, updateEntity() {}
});

const recipe = {
  from: { w: '10-30.LCS', i: 10 },
  record: { e: root, w: '10-30.LCS', m: {} }
};
const graph = manager.captureFavoriteGraph(recipe, false);
assert.deepEqual(graph.nodes.map(n => [n.from.i, n.named, n.namedVia]), [
  [10, false, null],
  [37, true, 'SneakSentinel'],
  [2, true, 'SneakTeleport']
]);
assert.equal(graph.companionCount, 2);
assert.equal(graph.nodes.filter(n => n.from.i === 39).length, 0, 'the second root-class instance must not be bundled accidentally');

// A favourite saved by Step 20 contains only the original root. Placement
// upgrades it in memory so users do not have to recreate an existing library item.
const favourite = { from: recipe.from, vol: '10.vol', name: 'Sneak Sentinel', includeLinked: false };
const recovered = manager.augmentNamedRuntimeCompanions(favourite);
assert.equal(recovered, 2, 'legacy favourite recovers the SneakTeleport and TeleportFXController companions');
assert.deepEqual(favourite.nodes.map(n => [n.from.i, n.named]), [[10, false], [37, true], [2, true]]);
const start = manager.pushFavoriteGraph('10-00.LCS', favourite, [100, 0, 100]);
const placed = WS('10-00.LCS');
assert.equal(start, 0);
assert.deepEqual(placed.adds.map(a => a.from.i), [10, 37, 2]);
assert.equal(placed.adds.filter(a => a.namedCompanion).length, 2);
assert.ok(placed.classes.some(c => c.from.name === 'SneakSentinel'));
assert.ok(placed.classes.some(c => c.from.name === 'SneakTeleport'));
assert.ok(placed.classes.some(c => c.from.name === 'TeleportFXController'));

// Placing the same favourite again should add another Sentinel but reuse the
// project's existing name-addressed companions rather than create duplicates.
const again = manager.pushFavoriteGraph('10-00.LCS', favourite, [130, 0, 120]);
assert.equal(again, 3);
assert.equal(placed.adds.length, 4);
assert.deepEqual(placed.adds.slice(3).map(a => a.from.i), [10]);

// A matching runtime companion already present in the base target is reused.
const sameLevelStart = manager.pushFavoriteGraph('10-30.LCS', favourite, [0, 0, 0]);
assert.equal(sameLevelStart, 0);
assert.deepEqual(WS('10-30.LCS').adds.map(a => a.from.i), [10], 'base SneakTeleport/TeleportFXController instances are reused');
// If the project deletes those base companions, placement must restore them.
WS('10-30.LCS').del = [37, 2];
manager.pushFavoriteGraph('10-30.LCS', favourite, [5, 0, 5]);
assert.deepEqual(WS('10-30.LCS').adds.map(a => a.from.i), [10, 10, 37, 2], 'project-deleted base companions are copied back in');

// Rebuild the destination LCS with the captured graph, exercising the actual
// class/resource/instance copier and validating the added runtime companions.
const soundPlan = EC.SoundPlan(volHeader.getUint32(0x78, true), volHeader.getUint32(0x7c, true));
const built = EC.patchLcs(target.A, target.B, {
  ...placed, mods: {}, del: []
}, '10-00.LCS', name => name === '10-30.LCS' ? source : null, { snd: soundPlan });
const parsed = instances(built.A, built.B);
const added = parsed.filter(e => e.i >= (siWad(target.A, target.B).instances.length));
const addedClasses = added.map(e => e.n);
assert.deepEqual(addedClasses.slice(0, 4), ['SneakSentinel', 'SneakTeleport', 'TeleportFXController', 'SneakSentinel']);
const classNames = siWad(built.A, built.B).classes.map(c => c.name);
for (const name of ['SneakSentinel', 'SneakTeleport', 'TeleportFXController', 'SneakSentinelCloseUp', 'SneakSentinelRanxCloseUp', 'Red_Teleport_Effect']) {
  assert.ok(classNames.includes(name), `copied class dependency ${name}`);
}
assert.ok(soundPlan.adds.length > 0, 'audio dependencies for the capture and follow-up animation are included');
const pcaFor = wad => {
  const name = wad.replace(/\.LCS$/i, '.PCA');
  const entry = avlFiles.find(f => f.name === name);
  assert.ok(entry, `matching ${name} exists in the AVL`);
  return new Uint8Array(avl, entry.off, entry.size);
};
const headerFor = wad => {
  const entry = files.find(f => f.name === wad);
  assert.ok(entry);
  const h = new DataView(vol, entry.off);
  return { h78: h.getUint32(0x78, true), h7c: h.getUint32(0x7c, true) };
};
const rebuiltPca = EC.buildPca(pcaFor('10-00.LCS'), soundPlan, wad => ({
  pca: pcaFor(wad), h78: headerFor(wad).h78
}));
for (const addition of soundPlan.adds) {
  const srcPca = pcaFor(addition.w), srcH78 = headerFor(addition.w).h78;
  const srcAt = addition.kind === 'WAVE' ? addition.off : Math.ceil(srcH78 / 0x800) * 0x800 + addition.off;
  const dstAt = addition.kind === 'WAVE' ? addition.newOff : Math.ceil(soundPlan.h78 / 0x800) * 0x800 + addition.newOff;
  assert.deepEqual(rebuiltPca.subarray(dstAt, dstAt + addition.len), srcPca.subarray(srcAt, srcAt + addition.len), `${addition.kind} audio payload is copied into the destination PCA`);
}
const d = new DataView(built.A.buffer, built.A.byteOffset, built.A.byteLength);
for (const offset of fixups(built.B).rel) {
  assert.ok(offset + 4 <= built.A.length, `relocation site ${offset.toString(16)} is in range`);
  assert.ok(d.getUint32(offset, true) <= built.A.length, `relocation target at ${offset.toString(16)} is in range`);
}

console.log('PASS SneakSentinel discovers SneakTeleport and TeleportFXController by their literal class-name references');
console.log('PASS graph capture excludes unrelated second SneakSentinel instance #39');
console.log('PASS favourite placement copies the named runtime companions and reuses them on a second placement');
console.log('PASS rebuilt 10-00 LCS contains the teleport controller, close-up/animation dependency chain, copied PCA audio and valid relocations');
