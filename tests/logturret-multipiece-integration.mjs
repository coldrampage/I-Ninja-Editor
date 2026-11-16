import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseVol, readWad, instances, siWad, fixups } from '../js/vol-core.js';
import { EC } from '../js/editor-core.js';
import { installPrefabManager } from '../js/prefabs.js';

const sourceVolPath = process.env.ININJA_TEST_30_VOL;
const targetVolPath = process.env.ININJA_TEST_40_VOL;
if (!sourceVolPath || !targetVolPath || !fs.existsSync(sourceVolPath) || !fs.existsSync(targetVolPath)) {
  console.log('SKIP LogTurret multi-piece integration (set ININJA_TEST_30_VOL and ININJA_TEST_40_VOL)');
  process.exit(0);
}
const asBuffer = path => {
  const bytes = fs.readFileSync(path);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};
const sourceVol = asBuffer(sourceVolPath), targetVol = asBuffer(targetVolPath);
const sourceVolName = sourceVolPath.split(/[\\/]/).pop(), targetVolName = targetVolPath.split(/[\\/]/).pop();
const sourceFiles = parseVol(sourceVol), targetFiles = parseVol(targetVol);
const files = [
  ...sourceFiles.map(f => ({ ...f, buf: sourceVol, vol: sourceVolName })),
  ...targetFiles.map(f => ({ ...f, buf: targetVol, vol: targetVolName }))
];
const rawCache = new Map();
const getRaw = name => {
  if (!rawCache.has(name)) {
    const f = files.find(x => x.name === name);
    assert.ok(f, `archive contains ${name}`);
    const [A, B] = readWad(f.buf, f);
    rawCache.set(name, { A, B, f, buf: f.buf });
  }
  return rawCache.get(name);
};

function makeManager(sourceLevel, targetLevelName) {
  const sourceName = sourceLevel + '.LCS', targetName = targetLevelName + '.LCS';
  const source = getRaw(sourceName), target = getRaw(targetName);
  const sourceEntities = instances(source.A, source.B), targetEntities = instances(target.A, target.B);
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
  const targetLevel = { id: targetLevelName, all0: targetEntities, ents: targetEntities, nb: targetEntities.length };
  const Viewer = { files, D: [targetLevel], sel: null, all: [], $: el, refresh() {}, inspect() {}, need: false };
  const WS = w => project.wads[w] || (project.wads[w] = { mods: {}, adds: [], del: [], classes: [] });
  const targetEntry = files.find(f => f.name === targetName);
  const targetHeader = new DataView(targetVol, targetEntry.off);
  const manager = installPrefabManager({
    Viewer, EC, getProject: () => project, wadOf: id => id + '.LCS', getWad, readWad, instances,
    fixups, siWad,
    volOf: w => String(w).startsWith(sourceVolName.slice(0, 2) + '-') ? sourceVolName : targetVolName,
    avlOk: () => false, vbase: value => String(value).replace(/\.(vol|avl)$/i, ''), WS,
    r3: value => Math.round(value * 1000) / 1000,
    sndPlan: () => EC.SoundPlan(targetHeader.getUint32(0x78, true), targetHeader.getUint32(0x7c, true)),
    summary() {}, getGround: () => () => [100, 0, 100], getEntityRecord: () => null, updateEntity() {}
  });
  return {
    manager, project, sourceName, targetName, sourceEntities, targetEntities, el, getRaw,
    sndPlan: () => EC.SoundPlan(targetHeader.getUint32(0x78, true), targetHeader.getUint32(0x7c, true))
  };
}

const capture = (manager, sourceName, entity) => manager.captureFavoriteGraph({
  from: { w: sourceName, i: entity.i },
  record: { e: entity, w: sourceName, m: {} }
}, false);
const namedTurret = graph => graph.nodes.find(n => n.named && n.from.i >= 0);
const addedClasses = (project, targetName, sourceLookup) => (project.wads[targetName].adds || [])
  .map(a => sourceLookup(a.from.w, a.from.i).n);

// Reproduce the intended manual workflow end-to-end: place a second wall away
// from the existing turret, edit its cutscene waypoint onto that turret, then
// rebuild the destination LCS and verify both walls resolve to the same turret.
{
  const ctx = makeManager('30-02', '40-00');
  const wall = ctx.sourceEntities.find(e => e.n === 'LogTurretWall' && e.i === 17);
  const graph = capture(ctx.manager, ctx.sourceName, wall);
  ctx.manager.pushFavoriteGraph(ctx.targetName, graph, [100, 0, 100]);
  ctx.manager.pushFavoriteGraph(ctx.targetName, graph, [200, 0, 200]);
  const P = ctx.project.wads[ctx.targetName];
  assert.deepEqual(addedClasses(ctx.project, ctx.targetName, (w, i) => {
    const level = ctx.getRaw(w);
    return instances(level.A, level.B).find(e => e.i === i);
  }), ['LogTurretWall', 'LogTurret', 'LogTurretWall']);

  const secondWall = P.adds[2], turret = P.adds[1];
  secondWall.path = wall.path.map(node => node.map((v, k) => v - wall.p[k]));
  secondWall.path[secondWall.path.length - 1] = turret.p.map((v, k) => v - secondWall.p[k]);

  const target = ctx.getRaw(ctx.targetName);
  const built = EC.patchLcs(target.A, target.B, { ...P, mods: {}, del: [] }, ctx.targetName,
    name => ctx.getRaw(name), { snd: ctx.sndPlan() });
  const rebuilt = instances(built.A, built.B).slice(ctx.targetEntities.length);
  assert.deepEqual(rebuilt.map(e => e.n), ['LogTurretWall', 'LogTurret', 'LogTurretWall']);
  for (const [i, rebuiltWall] of [[0, rebuilt[0]], [1, rebuilt[2]]]) {
    assert.ok(rebuiltWall.path && rebuiltWall.path.length >= 2, `wall ${i + 1} retains its cutscene waypoint path`);
    const endpoint = rebuiltWall.path[rebuiltWall.path.length - 1];
    const distance = Math.hypot(...endpoint.map((v, k) => v - rebuilt[1].p[k]));
    assert.ok(distance < (i === 0 ? 2.5 : 1.25),
      `wall ${i + 1} waypoint resolves to the one shared turret (${distance})`);
  }
}

// 30-02 is the regression layout: two LogTurretWalls share one LogTurret.
{
  const ctx = makeManager('30-02', '40-00');
  const wall1 = ctx.sourceEntities.find(e => e.n === 'LogTurretWall' && e.i === 17);
  const wall2 = ctx.sourceEntities.find(e => e.n === 'LogTurretWall' && e.i === 18);
  const turret = ctx.sourceEntities.find(e => e.n === 'LogTurret');
  assert.ok(wall1 && wall2 && turret, '30-02 contains the two known walls and their turret');
  const graph1 = capture(ctx.manager, ctx.sourceName, wall1);
  const graph2 = capture(ctx.manager, ctx.sourceName, wall2);
  assert.equal(graph1.nodes.filter(n => n.named).length, 1, 'first wall graph includes its name-looked-up turret');
  assert.equal(graph2.nodes.filter(n => n.named).length, 1, 'second wall graph includes the same named turret');
  const base1 = [100, 0, 100];
  const offset1 = namedTurret(graph1).offset;
  const offset2 = namedTurret(graph2).offset;
  const base2 = base1.map((v, k) => v + offset1[k] - offset2[k]);
  ctx.manager.pushFavoriteGraph(ctx.targetName, graph1, base1);
  ctx.manager.pushFavoriteGraph(ctx.targetName, graph2, base2);
  const names = addedClasses(ctx.project, ctx.targetName, (w, i) => {
    const level = getRaw(w);
    return instances(level.A, level.B).find(e => e.i === i);
  });
  assert.equal(names.filter(n => n === 'LogTurretWall').length, 2, 'both wall pieces are added');
  assert.equal(names.filter(n => n === 'LogTurret').length, 1, 'the common turret is added exactly once');

  // A third wall can be placed even when its copied waypoint does not yet
  // coincide with the one level-wide turret. The editor warns that the wall
  // waypoint must be moved before running the level; it does not add a second
  // turret or block placement while the user is still arranging the prefab.
  ctx.manager.pushFavoriteGraph(ctx.targetName, graph1, [350, 0, 350]);
  const afterMisalignedPlacement = addedClasses(ctx.project, ctx.targetName, (w, i) => {
    const level = getRaw(w);
    return instances(level.A, level.B).find(e => e.i === i);
  });
  assert.equal(afterMisalignedPlacement.filter(n => n === 'LogTurretWall').length, 3,
    'a wall can be placed before its waypoint is adjusted');
  assert.equal(afterMisalignedPlacement.filter(n => n === 'LogTurret').length, 1,
    'a misaligned wall reuses the existing turret rather than creating another');
  assert.match(ctx.el('ed_sum').textContent, /waypoint adjustment required before running/i,
    'the placement status warns that the new wall waypoint needs adjustment');
}

// The existing turret may have been introduced by a separate prefab (for
// example, a totem from 30-25) rather than by this wall's source level. Reuse
// that one runtime-name companion and let the user align the wall waypoint.
{
  const ctx = makeManager('30-25', '40-00');
  const pole = ctx.sourceEntities.find(e => e.n === 'LogTurretTotemPole' && [102, 103].includes(e.i));
  assert.ok(pole, '30-25 has a reusable totem pole root');
  const poleGraph = capture(ctx.manager, ctx.sourceName, pole);
  const wallWad = ctx.getRaw('30-02.LCS');
  const wallEntity = instances(wallWad.A, wallWad.B).find(e => e.n === 'LogTurretWall' && e.i === 17);
  assert.ok(wallEntity, '30-02 has the wall to place beside the imported totem');
  const wallGraph = ctx.manager.captureFavoriteGraph({
    from: { w: '30-02.LCS', i: wallEntity.i },
    record: { e: wallEntity, w: '30-02.LCS', m: {} }
  }, false);

  ctx.manager.pushFavoriteGraph(ctx.targetName, poleGraph, [100, 0, 100]);
  ctx.manager.pushFavoriteGraph(ctx.targetName, wallGraph, [300, 0, 300]);
  const names = addedClasses(ctx.project, ctx.targetName, (w, i) => {
    const level = ctx.getRaw(w);
    return instances(level.A, level.B).find(e => e.i === i);
  });
  assert.equal(names.filter(n => n === 'LogTurret').length, 1,
    'a wall from another source level reuses the existing favourite turret');
  assert.equal(names.filter(n => n === 'LogTurretTotemPole').length, 1,
    'the original totem remains in the graph');
  assert.equal(names.filter(n => n === 'LogTurretWall').length, 1,
    'the additional wall can be placed');
  assert.match(ctx.el('ed_sum').textContent, /waypoint adjustment required before running/i);
}

// Exercise the actual Place Favourite handler as well as the graph helper: a
// successful placement must show the waypoint warning in the favourite panel.
{
  const ctx = makeManager('30-02', '40-00');
  const wall = ctx.sourceEntities.find(e => e.n === 'LogTurretWall' && e.i === 17);
  const graph = capture(ctx.manager, ctx.sourceName, wall);
  ctx.manager.pushFavoriteGraph(ctx.targetName, graph, [350, 0, 350]);
  ctx.project.prefabs.push({
    id: 77, name: 'Waypoint warning test', from: { w: ctx.sourceName, i: wall.i },
    nodes: graph.nodes, includeLinked: false
  });
  ctx.el('ed_lv').value = '40-00';
  ctx.el('ed_fav_list').value = '77';
  await ctx.manager.placeFavorite();
  assert.match(ctx.el('ed_fav_info').textContent, /Placed "Waypoint warning test" in 40-00/i);
  assert.match(ctx.el('ed_fav_info').textContent, /Waypoint adjustment needed before running this level/i);
}

// The reported failure is the 30-02 TotemPole class itself (including its
// 118,756-byte opaque data block). Make sure that exact source class can be
// preflighted and queued for a destination which does not already contain it.
{
  const ctx = makeManager('30-02', '40-00');
  const pole = ctx.sourceEntities.find(e => e.n === 'LogTurretTotemPole' && e.i === 19);
  assert.ok(pole, '30-02 contains the reported LogTurretTotemPole instance #19');
  const graph = capture(ctx.manager, ctx.sourceName, pole);
  ctx.manager.pushFavoriteGraph(ctx.targetName, graph, [150, 0, 150]);
  assert.ok((ctx.project.wads[ctx.targetName].classes || []).some(c =>
    c.from.w === ctx.sourceName && c.from.name === 'LogTurretTotemPole'),
    'the exact 30-02 LogTurretTotemPole class passes the destination copy preflight');
}

// 30-25 contains several totem poles which use a shared LogTurret name lookup.
// Place two of them so their source-relative offsets converge on the same turret.
{
  const ctx = makeManager('30-25', '40-00');
  const poles = ctx.sourceEntities.filter(e => e.n === 'LogTurretTotemPole' && [102, 103].includes(e.i));
  const turret = ctx.sourceEntities.find(e => e.n === 'LogTurret');
  assert.equal(poles.length, 2, '30-25 contains both selected totem-pole instances');
  assert.ok(turret, '30-25 contains the shared LogTurret');
  const graph1 = capture(ctx.manager, ctx.sourceName, poles[0]);
  const graph2 = capture(ctx.manager, ctx.sourceName, poles[1]);
  assert.equal(graph1.nodes.filter(n => n.named).length, 1, 'first totem graph includes its name-looked-up turret');
  assert.equal(graph2.nodes.filter(n => n.named).length, 1, 'second totem graph includes its name-looked-up turret');
  const base1 = [200, 0, 200];
  const offset1 = namedTurret(graph1).offset;
  const offset2 = namedTurret(graph2).offset;
  const base2 = base1.map((v, k) => v + offset1[k] - offset2[k]);
  ctx.manager.pushFavoriteGraph(ctx.targetName, graph1, base1);
  ctx.manager.pushFavoriteGraph(ctx.targetName, graph2, base2);
  const names = addedClasses(ctx.project, ctx.targetName, (w, i) => {
    const level = getRaw(w);
    return instances(level.A, level.B).find(e => e.i === i);
  });
  assert.equal(names.filter(n => n === 'LogTurretTotemPole').length, 2, 'both totem poles are added');
  assert.equal(names.filter(n => n === 'LogTurret').length, 1, 'both totems share a single imported turret');
}

// A private alias cannot safely replace a root name when the source's own
// controller scripts test that literal class name. Verify the importer blocks
// this ambiguous same-root collision instead of adding a boss that its controller
// would fail to recognise.
{
  const ctx = makeManager('30-06', '40-30');
  const reason = ctx.manager.ensureClass(ctx.targetName, ctx.sourceName, 'RaxCaptain');
  assert.match(String(reason), /literal class name in .*Captain_Game/i,
    'same-name RaxCaptain collision is refused when Captain_Game tests the literal class name');
}

console.log('PASS LogTurret multi-piece integration: two walls and two totem poles reuse one matching turret');
