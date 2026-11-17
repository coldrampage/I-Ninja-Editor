import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseVol, readWad, parseLcm } from '../js/vol-core.js';

const file = process.env.ININJA_TEST_30_VOL;
if (!file) {
  console.log('SKIP level part material integration (set ININJA_TEST_30_VOL to 30.vol)');
  process.exit(0);
}
const bytes = fs.readFileSync(file);
const archive = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const entries = parseVol(archive).filter(x => x.name.toLowerCase().endsWith('.lcm'));
let levels = 0, groups = 0, sourceParts = 0, alphaTest400 = 0, alphaTest800 = 0, nonOpaquePartAlpha = 0, nonWhitePartTint = 0;
for (const entry of entries) {
  const [A, B] = readWad(archive, entry);
  const level = parseLcm(A, B);
  if (!level) continue;
  levels++;
  for (const buffer of level.bufs) for (const group of buffer.groups) {
    groups++;
    assert.ok(Number.isInteger(group.partColor), 'level group retains part colour word at +0x14');
    assert.ok(Number.isInteger(group.partFlags), 'level group retains part flags at +0x40');
    assert.ok(Array.isArray(group.partOffsets) && group.partOffsets.length > 0, 'group retains its contributing part offsets');
    sourceParts += group.partOffsets.length;
    if (group.partFlags & 0x400) alphaTest400 += group.partOffsets.length;
    if (group.partFlags & 0x800) alphaTest800 += group.partOffsets.length;
    if ((group.partColor >>> 24) !== 255) nonOpaquePartAlpha += group.partOffsets.length;
    if ((group.partColor & 0x00FFFFFF) !== 0x00FFFFFF) nonWhitePartTint += group.partOffsets.length;
  }
}
assert.ok(levels > 0 && groups > 0, '30.vol contains parseable level geometry');
assert.ok(sourceParts > 0, 'part references are retained after geometry grouping');
assert.ok(alphaTest400 > 0 && alphaTest800 > 0, 'both native part alpha-test modes occur in the level archive');
assert.ok(nonOpaquePartAlpha > 0, 'level parts include native fixed-alpha values below 255');
assert.ok(nonWhitePartTint > 0, 'level parts include non-white BGRA tint values');
console.log(`PASS 30.vol part material scan: ${levels} LCM levels, ${groups} material/flags/colour groups representing ${sourceParts} source parts; alpha-test 0x400=${alphaTest400}, 0x800=${alphaTest800}, non-opaque part alpha=${nonOpaquePartAlpha}, non-white part tint=${nonWhitePartTint}`);
