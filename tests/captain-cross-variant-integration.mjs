import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseVol, readWad, instances, siWad } from '../js/vol-core.js';
import { EC } from '../js/editor-core.js';
import { sourceClassVariants } from '../js/prefabs.js';

const volumePath = process.env.ININJA_TEST_30_VOL;
const targetVolumePath = process.env.ININJA_TEST_40_VOL;
if (!volumePath || !targetVolumePath || !fs.existsSync(volumePath) || !fs.existsSync(targetVolumePath)) {
  console.log('SKIP captain cross-variant integration (set ININJA_TEST_30_VOL and ININJA_TEST_40_VOL)');
  process.exit(0);
}
const sourceAvlPath = process.env.ININJA_TEST_30_AVL || volumePath.replace(/\.vol$/i, '.avl');
const targetAvlPath = process.env.ININJA_TEST_40_AVL || targetVolumePath.replace(/\.vol$/i, '.avl');
if (!fs.existsSync(sourceAvlPath) || !fs.existsSync(targetAvlPath)) {
  console.log('SKIP captain PCA validation (paired source or target .avl not found)');
  process.exit(0);
}
const asBuffer = path => {
  const bytes = fs.readFileSync(path);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};
const sourceVol = asBuffer(volumePath), targetVol = asBuffer(targetVolumePath);
const sourceAvl = asBuffer(sourceAvlPath), targetAvl = asBuffer(targetAvlPath);
const sourceFiles = parseVol(sourceVol), targetFiles = parseVol(targetVol);
const sourceAvlFiles = parseVol(sourceAvl), targetAvlFiles = parseVol(targetAvl);
const getLcs = (vol, files, name) => {
  const f = files.find(x => x.name === name);
  assert.ok(f, `volume contains ${name}`);
  const [A, B] = readWad(vol, f);
  return { A, B, f, vol };
};
const getPca = (avl, files, name) => {
  const pcaName = name.replace(/\.LCS$/i, '.PCA');
  const f = files.find(x => x.name === pcaName);
  assert.ok(f, `AVL contains ${pcaName}`);
  return new Uint8Array(avl, f.off, f.size);
};
const sourceHeader = name => {
  const f = sourceFiles.find(x => x.name === name);
  return new DataView(sourceVol, f.off);
};
const targetHeader = name => {
  const f = targetFiles.find(x => x.name === name);
  return new DataView(targetVol, f.off);
};

function transplant(sourceName, targetName, className) {
  const source = getLcs(sourceVol, sourceFiles, sourceName);
  const target = getLcs(targetVol, targetFiles, targetName);
  const sourceEntities = instances(source.A, source.B);
  const targetEntities = instances(target.A, target.B);
  const sourceEntity = sourceEntities.find(e => e.n === className);
  assert.ok(sourceEntity, `${sourceName} has an instance of ${className}`);
  const otherCaptain = className === 'RaxCaptain' ? 'KappaCaptain' : 'RaxCaptain';
  assert.ok(targetEntities.some(e => e.n === otherCaptain), `${targetName} already contains ${otherCaptain}`);

  const sourceWad = siWad(source.A, source.B), targetWad = siWad(target.A, target.B);
  const sourceReports = EC.classReports(source.A, source.B), targetReports = EC.classReports(target.A, target.B);
  const targetNames = new Set(targetWad.classes.map(c => c.name));
  const variants = sourceClassVariants(sourceReports, targetReports, className, sourceName, targetNames, sourceWad);
  assert.ok(variants.length > 0, `${className} import finds source-specific class dependencies to isolate`);
  assert.ok(variants.some(v => targetNames.has(v.name)), 'at least one colliding dependency is privately aliased');

  const targetH = targetHeader(targetName), sourceH = sourceHeader(sourceName);
  const snd = EC.SoundPlan(targetH.getUint32(0x78, true), targetH.getUint32(0x7c, true));
  const output = EC.patchLcs(target.A, target.B, {
    mods: {},
    adds: [{ from: { w: sourceName, i: sourceEntity.i }, p: sourceEntity.p.slice(), dy: 0, dp: 0, dr: 0, regs: {} }],
    del: [],
    classes: [{ from: { w: sourceName, name: className }, variants }]
  }, targetName, wad => wad === sourceName ? source : null, { snd });

  const builtEntities = instances(output.A, output.B);
  const added = builtEntities.slice(targetEntities.length);
  assert.equal(added.length, 1, 'exactly one captain instance is appended');
  assert.equal(added[0].n, className, 'new instance binds to the requested captain class');
  assert.ok(builtEntities.some(e => e.n === otherCaptain), `pre-existing ${otherCaptain} remains available`);
  assert.equal(EC.prefabCheck(output.A, output.B, added[0].i), null,
    'the imported captain instance and its relocations pass the editor safety check');

  const builtWad = siWad(output.A, output.B);
  const builtNames = new Set(builtWad.classes.map(c => c.name));
  for (const variant of variants) {
    assert.ok(builtNames.has(variant.alias), `private variant ${variant.alias} exists in the built level`);
  }
  const importedReport = EC.classReports(output.A, output.B)[className];
  assert.ok(importedReport && importedReport.fingerprint && !importedReport.fingerprint.startsWith('analysis-error:'),
    'the imported class remains analysable after relocation');
  const sourceModels = EC.parseModels(source.A, source.B).modelGroups
    .filter(group => (group.classes || []).includes(className)).map(group => group.name).sort();
  const importedModels = EC.parseModels(output.A, output.B).modelGroups
    .filter(group => (group.classes || []).includes(className)).map(group => group.name).sort();
  assert.ok(sourceModels.length > 0, 'source captain has parsed model groups');
  for (const modelName of sourceModels) {
    assert.ok(importedModels.includes(modelName), `copied captain retains model group ${modelName}`);
  }

  const sourceBase = sourceName.split('-')[0];
  const targetBase = targetName.split('-')[0];
  const targetPca = getPca(targetAvl, targetAvlFiles, targetName);
  const builtPca = EC.buildPca(targetPca, snd, wad => {
    assert.equal(wad, sourceName, 'only the intended source level contributes sound banks');
    return {
      pca: getPca(sourceAvl, sourceAvlFiles, sourceName),
      h78: sourceH.getUint32(0x78, true),
      h7c: sourceH.getUint32(0x7c, true)
    };
  });
  assert.ok(builtPca instanceof Uint8Array && builtPca.length >= targetPca.length,
    'target PCA can be rebuilt with any imported captain sounds');
  console.log(`PASS ${sourceBase} ${className} -> ${targetBase} ${targetName}: ${variants.length} private class variant(s), model groups retained, ${snd.adds.length} sound import(s)`);
}

// Both directions used to pick up incompatible same-named dependencies from the
// destination, which could result in the other captain's intro animation or a
// broken level at load time.
transplant('30-06.LCS', '40-32.LCS', 'RaxCaptain');
transplant('30-12.LCS', '40-30.LCS', 'KappaCaptain');
