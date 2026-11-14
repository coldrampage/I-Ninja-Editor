import assert from 'node:assert/strict';
import { sourceClassVariants } from '../js/prefabs.js';

const src = {
  RanxBlocker: { bytes: 24, kinds: { class: 1 }, strs: [], classes: ['EnemyGeneratorShield'] },
  EnemyGeneratorShield: { bytes: 96, kinds: { class: 3 }, strs: [], classes: ['AnimatedCamera'] },
  AnimatedCamera: { bytes: 48, kinds: { material: 1, string: 1 }, strs: ['camera_attach'], classes: [] }
};
const dst = {
  EnemyGeneratorShield: { bytes: 96, kinds: { class: 3 }, strs: [], classes: ['AnimatedCamera'] },
  AnimatedCamera: { bytes: 48, kinds: { 'level data': 1, string: 1 }, strs: ['camera_attach'], classes: [] }
};

const variants = sourceClassVariants(src, dst, 'RanxBlocker', '10-05.LCS');
assert.deepEqual(variants, [
  { name: 'AnimatedCamera', alias: 'AnimatedCamera__source_10_05', alreadyImported: false }
]);
const alreadyPresent = sourceClassVariants(src, dst, 'RanxBlocker', '10-05.LCS',
  new Set(['RanxBlocker', 'EnemyGeneratorShield', 'AnimatedCamera', 'AnimatedCamera__source_10_05']));
assert.equal(alreadyPresent[0].alreadyImported, true,
  'a source-specific camera variant already imported in this target can be reused');
console.log('PASS source class variant detection follows nested class dependencies and aliases resource mismatches');

// The importer copies every class in a shared code block. A resource-different
// sibling therefore requires private aliases for all colliding block members,
// including Splash itself when only its Inner/Outer helpers differ.
const groupedSource = {
  LogTurret: { bytes: 12, kinds: { class: 1 }, strs: [], classes: ['LogturretRocket'] },
  LogturretRocket: { bytes: 20, kinds: { class: 1 }, strs: [], classes: ['Splash'] },
  Splash: { bytes: 516, kinds: { class: 6 }, strs: [], classes: ['Splash_Circle', 'Splash_Inner_Upshoot', 'Splash_Outer_Upshoot', 'Splash_Particles'] },
  Splash_Circle: { bytes: 32, kinds: { class: 1 }, strs: [], classes: [] },
  Splash_Inner_Upshoot: { bytes: 200, kinds: { 'level data': 1 }, strs: [], classes: [] },
  Splash_Outer_Upshoot: { bytes: 296, kinds: { 'level data': 1 }, strs: [], classes: [] },
  Splash_Particles: { bytes: 24, kinds: { class: 1 }, strs: [], classes: [] }
};
const groupedTarget = {
  Splash: { ...groupedSource.Splash },
  Splash_Circle: { ...groupedSource.Splash_Circle },
  Splash_Inner_Upshoot: { bytes: 200, kinds: { string: 1 }, strs: ['pv.'], classes: [] },
  Splash_Outer_Upshoot: { bytes: 296, kinds: { string: 1 }, strs: [' v.'], classes: [] },
  Splash_Particles: { ...groupedSource.Splash_Particles }
};
const groupNames = Object.keys(groupedSource);
const blockByClass = new Map([
  ['LogTurret', 0x100], ['LogturretRocket', 0x200],
  ...['Splash', 'Splash_Circle', 'Splash_Inner_Upshoot', 'Splash_Outer_Upshoot', 'Splash_Particles'].map(n => [n, 0x300])
]);
const groupedWad = {
  classes: groupNames.map((name, i) => ({ name, off: i * 0x2c })),
  U: offset => blockByClass.get(groupNames[Math.floor((offset - 0x0c) / 0x2c)])
};
const groupedVariants = sourceClassVariants(
  groupedSource, groupedTarget, 'LogTurret', '30-23.LCS', new Set(Object.keys(groupedTarget)), groupedWad
);
assert.deepEqual(groupedVariants.map(v => v.name), [
  'Splash', 'Splash_Circle', 'Splash_Inner_Upshoot', 'Splash_Outer_Upshoot', 'Splash_Particles'
]);
assert.ok(groupedVariants.some(v => v.name === 'Splash'),
  'identical-report Splash sibling must be aliased because its whole code block is copied with variant helpers');
console.log('PASS source class variants alias every colliding class in a resource-divergent shared code block');
