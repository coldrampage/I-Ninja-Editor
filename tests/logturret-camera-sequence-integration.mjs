import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  parseVol, readWad, instances, siWad, fixups
} from '../js/vol-core.js';
import { EC } from '../js/editor-core.js';
import { installPrefabManager, discoverNamedCompanionInstances } from '../js/prefabs.js';

// Real-game regression. Supply the paired archives to exercise 30-23.LCS -> 10-00.LCS.
const sourceVolPath = process.env.ININJA_TEST_30_VOL;
const targetVolPath = process.env.ININJA_TEST_VOL;
if (!sourceVolPath || !targetVolPath || !fs.existsSync(sourceVolPath) || !fs.existsSync(targetVolPath)) {
  console.log('SKIP LogTurret wall/camera companion integration (set ININJA_TEST_30_VOL and ININJA_TEST_VOL)');
  process.exit(0);
}
const sourceAvlPath = process.env.ININJA_TEST_30_AVL || sourceVolPath.replace(/\.vol$/i, '.avl');
const targetAvlPath = process.env.ININJA_TEST_AVL || targetVolPath.replace(/\.vol$/i, '.avl');
if (!fs.existsSync(sourceAvlPath) || !fs.existsSync(targetAvlPath)) {
  console.log('SKIP LogTurret sound/PCA integration (paired source or target .avl not found)');
  process.exit(0);
}
const asBuffer = path => {
  const bytes = fs.readFileSync(path);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};
const sourceVol = asBuffer(sourceVolPath), targetVol = asBuffer(targetVolPath);
const sourceAvl = asBuffer(sourceAvlPath), targetAvl = asBuffer(targetAvlPath);
const sourceVolName = sourceVolPath.split(/[\\/]/).pop(), targetVolName = targetVolPath.split(/[\\/]/).pop();
const sourceBase = sourceVolName.replace(/\.vol$/i, ''), targetBase = targetVolName.replace(/\.vol$/i, '');
const sourceFiles = parseVol(sourceVol), targetFiles = parseVol(targetVol);
const files = [
  ...sourceFiles.map(f => ({ ...f, buf: sourceVol, vol: sourceVolName })),
  ...targetFiles.map(f => ({ ...f, buf: targetVol, vol: targetVolName }))
];
const wadCache = new Map();
const getRaw = name => {
  if (!wadCache.has(name)) {
    const f = files.find(x => x.name === name);
    assert.ok(f, `archive contains ${name}`);
    const [A, B] = readWad(f.buf, f);
    wadCache.set(name, { A, B, f, buf: f.buf });
  }
  return wadCache.get(name);
};
const sourceName = '30-23.LCS', targetName = '10-00.LCS';
assert.equal(sourceBase, '30');
assert.equal(targetBase, '10');
const source = getRaw(sourceName), target = getRaw(targetName);
const sourceEntities = instances(source.A, source.B), targetEntities = instances(target.A, target.B);
const wall = sourceEntities.find(e => e.n === 'LogTurretWall');
const turret = sourceEntities.find(e => e.n === 'LogTurret');
assert.equal(wall?.i, 60, 'known LogTurretWall source instance');
assert.equal(turret?.i, 59, 'known matching LogTurret source instance');

const project = { app: 'ininja-editor', v: 1, wads: {}, prefabs: [] };
const cache = new Map();
const getWad = name => {
  if (!cache.has(name)) {
    const { A, B } = getRaw(name);
    cache.set(name, { A, B, cls: new Set(siWad(A, B).classes.map(c => c.name)) });
  }
  return cache.get(name);
};
const elements = new Map();
const el = id => {
  if (!elements.has(id)) elements.set(id, {
    id, value: '', innerHTML: '', textContent: '', checked: false, options: [], selectedOptions: [], style: {},
    parentNode: { after() {} }, insertAdjacentHTML() {}, querySelectorAll() { return []; }, click() {}
  });
  return elements.get(id);
};
globalThis.document = { createElement: tag => el('created-' + tag) };
globalThis.innerWidth = 1280;
globalThis.innerHeight = 720;
const targetLevel = { id: '10-00', all0: targetEntities, ents: targetEntities, nb: targetEntities.length };
const Viewer = { files, D: [targetLevel], sel: null, all: [], $: el, refresh() {}, inspect() {}, need: false };
const WS = w => project.wads[w] || (project.wads[w] = { mods: {}, adds: [], del: [], classes: [] });
const targetEntry = files.find(f => f.name === targetName);
const targetHeader = new DataView(targetVol, targetEntry.off);
const avlEntries = { [sourceBase]: parseVol(sourceAvl), [targetBase]: parseVol(targetAvl) };
const avlBytes = { [sourceBase]: sourceAvl, [targetBase]: targetAvl };
const pcaFor = wad => {
  const base = wad.replace(/\.LCS$/i, '').split('-')[0];
  const entry = avlEntries[base].find(f => f.name === wad.replace(/\.LCS$/i, '.PCA'));
  assert.ok(entry, `matching ${wad.replace(/\.LCS$/i, '.PCA')} exists in its AVL`);
  return new Uint8Array(avlBytes[base], entry.off, entry.size);
};
const headerFor = wad => {
  const f = files.find(x => x.name === wad);
  const d = new DataView(f.buf, f.off);
  return { h78: d.getUint32(0x78, true), h7c: d.getUint32(0x7c, true) };
};
const manager = installPrefabManager({
  Viewer, EC, getProject: () => project, wadOf: id => id + '.LCS', getWad, readWad, instances, fixups, siWad,
  volOf: w => String(w).startsWith(sourceBase + '-') ? sourceVolName : targetVolName,
  avlOk: () => true, vbase: value => String(value).replace(/\.(vol|avl)$/i, ''), WS,
  r3: value => Math.round(value * 1000) / 1000,
  sndPlan: () => EC.SoundPlan(targetHeader.getUint32(0x78, true), targetHeader.getUint32(0x7c, true)),
  summary() {}, getGround: () => () => [100, 0, 100], getEntityRecord: () => null, updateEntity() {}
});

// This is the critical regression: the wall's helper class performs the name
// lookup. The companion walker must traverse class dependencies before parsing
// the lookup, and must not mistake arbitrary string constants for instance refs.
const sourceInfo = {
  ...source, ents: sourceEntities, rep: EC.classReports(source.A, source.B),
  w: siWad(source.A, source.B), cls: new Set(siWad(source.A, source.B).classes.map(c => c.name))
};
const found = discoverNamedCompanionInstances(sourceInfo, 'LogTurretWall', {
  excludeClasses: ['LogTurretWall'],
  canCopy: e => !EC.prefabCheck(source.A, source.B, e.i)
});
// Each handler is disassembled into one multi-instruction text block. The
// scanner must capture both calls in LogTurretCutscene, not only the first
// Strat_BroadcastName call at the start of that block.
assert.deepEqual([...sourceInfo.lookupNames.LogTurretCutscene].sort(), ['LogTurret', 'LogTurretCamera']);
assert.deepEqual(found.map(x => [x.name, x.i, x.via]), [['LogTurret', 59, 'LogTurretCutscene']]);

// Capturing a new favourite or upgrading an older root-only favourite should
// include the matching turret at the offset of the wall's second waypoint.
const graph = manager.captureFavoriteGraph({
  from: { w: sourceName, i: wall.i }, record: { e: wall, w: sourceName, m: {} }
}, false);
assert.deepEqual(graph.nodes.map(n => [n.from.i, n.named, n.namedVia]), [
  [60, false, null], [59, true, 'LogTurretCutscene']
]);
const legacy = {
  from: { w: sourceName, i: wall.i }, name: 'Log Turret Wall', vol: sourceVolName,
  nodes: [{ from: { w: sourceName, i: wall.i }, offset: [0, 0, 0], links: [], named: false }]
};
assert.equal(manager.augmentNamedRuntimeCompanions(legacy), 1);
assert.equal(legacy.nodes[1].from.i, turret.i);
assert.equal(legacy.nodes[1].named, true);

// Placing a wall-only legacy favourite must copy both the wall and its runtime
// LogTurret partner, and import the private Splash block variants used by the
// source turret without replacing the hub's original Splash classes.
manager.pushFavoriteGraph(targetName, legacy, [100, 0, 100]);
const targetProject = project.wads[targetName];
assert.deepEqual(targetProject.adds.map(a => a.from.i), [60, 59]);
assert.deepEqual(targetProject.adds[1].p, [147.98, -5.3, 76.34]);
assert.ok(targetProject.classes.some(c => c.from.name === 'LogTurretWall'));
assert.ok(targetProject.classes.some(c => c.from.name === 'LogTurret'));
const turretClassImport = targetProject.classes.find(c => c.from.name === 'LogTurret');
assert.deepEqual(turretClassImport.variants.map(v => v.name), [
  'Splash', 'Splash_Circle', 'Splash_Inner_Upshoot', 'Splash_Outer_Upshoot', 'Splash_Particles'
]);

// The game broadcasts to every LogTurretCamera and finds the paired LogTurret
// by name near the wall path's second waypoint. Refuse duplicate pairs which
// could make two sequences steal one another's camera and softlock.
assert.throws(() => manager.pushFavoriteGraph(targetName, legacy, [160, 0, 160]), /LogTurret already exists/);

const soundPlan = EC.SoundPlan(targetHeader.getUint32(0x78, true), targetHeader.getUint32(0x7c, true));
const built = EC.patchLcs(target.A, target.B, {
  ...targetProject, mods: {}, del: []
}, targetName, name => name === sourceName ? source : null, { snd: soundPlan });
const rebuiltEntities = instances(built.A, built.B);
const added = rebuiltEntities.slice(targetEntities.length);
assert.deepEqual(added.map(e => e.n), ['LogTurretWall', 'LogTurret']);
const rebuiltWall = added[0], rebuiltTurret = added[1];
assert.ok(rebuiltWall.path && rebuiltWall.path.length >= 2, 'the wall retains its break/cutscene waypoint path');
const endpoint = rebuiltWall.path[rebuiltWall.path.length - 1];
const endpointDistance = Math.hypot(...endpoint.map((v, k) => v - rebuiltTurret.p[k]));
assert.ok(endpointDistance < 1.25, `wall's second waypoint remains near its matching turret (${endpointDistance})`);
const classNames = siWad(built.A, built.B).classes.map(c => c.name);
for (const name of [
  'LogTurretWall', 'LogTurretWallPiece', 'LogTurretCutscene', 'LogTurret', 'LogturretRocket', 'LogTurretCamera',
  'Splash', 'Splash__source_30_23', 'Splash_Circle__source_30_23', 'Splash_Inner_Upshoot__source_30_23',
  'Splash_Outer_Upshoot__source_30_23', 'Splash_Particles__source_30_23'
]) assert.ok(classNames.includes(name), `copied class/dependency ${name}`);
assert.ok(soundPlan.adds.length > 0, 'LogTurret sound resources are scheduled for the destination PCA');
const rebuiltPca = EC.buildPca(pcaFor(targetName), soundPlan, wad => ({ pca: pcaFor(wad), ...headerFor(wad) }));
assert.ok(rebuiltPca.length >= pcaFor(targetName).length, 'destination PCA rebuild includes copied LogTurret audio');
const relocations = fixups(built.B).rel, d = new DataView(built.A.buffer, built.A.byteOffset, built.A.byteLength);
for (const r of relocations) assert.ok(d.getUint32(r, true) < built.A.length, `valid relocation at 0x${r.toString(16)}`);
console.log('PASS LogTurretWall captures LogTurretCutscene name companion and copies a complete paired sequence');
console.log('PASS LogTurret imports source-specific Splash shared-code-block variants without colliding with the hub');
console.log('PASS LogTurret singleton guard prevents duplicate camera sequences');
console.log('PASS LogTurret LCS and PCA resources rebuild with valid pointers');
