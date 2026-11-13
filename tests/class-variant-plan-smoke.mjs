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
