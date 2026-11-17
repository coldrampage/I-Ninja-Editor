import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseVol, readWad, parseMaterialResources } from '../js/vol-core.js';
import { EC } from '../js/editor-core.js';

const file = process.env.ININJA_TEST_40_VOL;
if (!file) {
  console.log('SKIP object-model rotation archive integration (set ININJA_TEST_40_VOL to 40.vol)');
  process.exit(0);
}
const bytes = fs.readFileSync(file);
const archive = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const entries = parseVol(archive).filter(x => x.name.toLowerCase().endsWith('.lcs'));
let layeredResources = 0, layerRecords = 0, rotatingLayers = 0, modelPartsWithLayers = 0, nestedAnimatedLayers = 0, animatedFramePointers = 0, partsWithNativeFlags = 0, partsWithPartAlpha = 0, partsWithNonWhiteTint = 0;
for (const entry of entries) {
  const [A, B] = readWad(archive, entry);
  const models = EC.parseModels(A, B);
  const resources = parseMaterialResources(A, B), byOffset = new Map(resources.map(r => [r.offset, r]));
  for (const part of models) {
    assert.ok(Number.isInteger(part.partFlags), 'parsed model part retains +0x40 flags');
    assert.ok(Number.isInteger(part.partColor), 'parsed model part retains +0x14 BGRA colour');
    if (part.partFlags & 0xC00) partsWithNativeFlags++;
    if ((part.partColor >>> 24) !== 255) partsWithPartAlpha++;
    if ((part.partColor & 0x00FFFFFF) !== 0x00FFFFFF) partsWithNonWhiteTint++;
  }
  const seen = new Set();
  for (const part of models) {
    const material = part.material;
    if (!material || material.type !== 'layered' || !material.valid) continue;
    modelPartsWithLayers++;
    if (seen.has(material.offset)) continue;
    seen.add(material.offset);
    layeredResources++;
    for (const layer of material.layers) {
      layerRecords++;
      const child = byOffset.get(layer.textureOffset);
      if (child?.type === 'animated' && child.valid) { nestedAnimatedLayers++; animatedFramePointers += child.frameOffsets.length; assert.ok(child.frameOffsets.length > 0, 'animated kind-6 child retains all frame pointers'); }
      if (Math.abs(layer.rotationVelocity) > 1e-8 || Math.abs(layer.rotationOffset) > 1e-8) rotatingLayers++;
    }
  }
}
assert.ok(layeredResources > 0, '40.vol contains parsed layered material resources');
assert.ok(layerRecords > 0, '40.vol contains kind-7 layer records');
assert.ok(rotatingLayers > 0, '40.vol contains layers with non-zero rotation rate or phase');
assert.ok(partsWithNonWhiteTint > 0, '40.vol contains non-white BGRA part tint values');
console.log(`PASS 40.vol material scan: ${layeredResources} layered resources, ${layerRecords} layers, ${rotatingLayers} rotating layers, ${nestedAnimatedLayers} kind-6 child layers / ${animatedFramePointers} frame pointers across ${entries.length} LCS files (${modelPartsWithLayers} layered model-part references; ${partsWithNativeFlags} parts with native alpha-test flags; ${partsWithPartAlpha} with non-opaque part alpha; ${partsWithNonWhiteTint} with non-white part tint)`);
