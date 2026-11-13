import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseVol, readWad, siWad, fixups } from '../js/vol-core.js';
import { EC } from '../js/editor-core.js';
import { sourceClassVariants } from '../js/prefabs.js';

// Optional integration regression. Set ININJA_TEST_VOL to a PC 10.vol containing
// 10-05.LCS and 10-00.LCS to exercise the real EnemyGeneratorShield dependency.
const volPath = process.env.ININJA_TEST_VOL;
if (!volPath || !fs.existsSync(volPath)) {
  console.log('SKIP real AnimatedCamera variant integration (set ININJA_TEST_VOL to 10.vol)');
  process.exit(0);
}
const raw = fs.readFileSync(volPath);
const buf = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
const files = parseVol(buf);
const load = name => {
  const f = files.find(x => x.name === name);
  assert.ok(f, `missing ${name} in ${volPath}`);
  const [A, B] = readWad(buf, f);
  return { A, B };
};
const source = load('10-05.LCS');
const target = load('10-00.LCS');
const S = EC.SrcCtx(source.A, source.B);
S.wadName = '10-05.LCS';
const sourceReports = EC.classReports(source.A, source.B);
const targetReports = EC.classReports(target.A, target.B);
const targetNames = new Set(siWad(target.A, target.B).classes.map(c => c.name));
const variants = sourceClassVariants(sourceReports, targetReports, 'EnemyGeneratorShield', '10-05.LCS', targetNames);
assert.ok(variants.some(v => v.name === 'AnimatedCamera'),
  'the source EnemyGeneratorShield dependency should preserve its source AnimatedCamera variant');
const ops = { classes: [{ from: { w: '10-05.LCS', name: 'EnemyGeneratorShield' }, variants }], mods: {}, adds: [], del: [] };
const built = EC.patchLcs(target.A, target.B, ops, '10-00.LCS', name => name === '10-05.LCS' ? source : null);
const parsed = siWad(built.A, built.B);
const names = parsed.classes.map(c => c.name);
const alias = variants.find(v => v.name === 'AnimatedCamera').alias;
assert.ok(names.includes('AnimatedCamera'), 'original hub AnimatedCamera stays available');
assert.ok(names.includes(alias), 'source AnimatedCamera is added under a private alias');
const report = EC.classReports(built.A, built.B).EnemyGeneratorShield;
const classRefs = report.ptrs.filter(p => p[0] === 'class').map(p => parsed.classes.find(c => c.off === p[1])?.name);
assert.ok(classRefs.includes(alias), 'EnemyGeneratorShield points to its source AnimatedCamera variant');
const imp = fixups(built.B), dv = new DataView(built.A.buffer, built.A.byteOffset, built.A.byteLength);
for (const at of imp.rel) {
  assert.ok(at + 4 <= built.A.length, `relocation location @${at.toString(16)} stays in the rebuilt LCS`);
  assert.ok(dv.getUint32(at, true) <= built.A.length,
    `relocation target @${dv.getUint32(at, true).toString(16)} stays in the rebuilt LCS`);
}
console.log('PASS real 10-05 EnemyGeneratorShield imports source AnimatedCamera variant into 10-00 without replacing hub AnimatedCamera');
