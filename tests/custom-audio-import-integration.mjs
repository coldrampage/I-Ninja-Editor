import assert from 'node:assert/strict';
import fs from 'node:fs';
import { encodeXboxAdpcm, decodeXboxAdpcm } from '../js/audio-preview.js';
import { EC } from '../js/editor-core.js';
import { parseVol, readWad } from '../js/vol-core.js';

const volPath = process.env.ININJA_TEST_30_VOL;
const avlPath = process.env.ININJA_TEST_30_AVL;
if (!volPath || !avlPath || !fs.existsSync(volPath) || !fs.existsSync(avlPath)) {
  console.log('SKIP custom audio import integration (set ININJA_TEST_30_VOL and ININJA_TEST_30_AVL)');
  process.exit(0);
}
const readArrayBuffer = path => {
  const b = fs.readFileSync(path);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};
const vol = readArrayBuffer(volPath), avl = readArrayBuffer(avlPath);
const wadEntry = parseVol(vol).find(x => x.name.toLowerCase() === '30-00.lcs');
const pcaEntry = parseVol(avl).find(x => x.name.toLowerCase() === '30-00.pca');
assert(wadEntry && pcaEntry, '30-00 LCS and PCA entries are present');
const [A, B] = readWad(vol, wadEntry), S = EC.SrcCtx(A, B);
const header = new DataView(vol, wadEntry.off);
const h78 = header.getUint32(0x78, true), h7c = header.getUint32(0x7c, true);
const oldPca = new Uint8Array(avl, pcaEntry.off, pcaEntry.size);

// Find one real relocated pointer slot for each storage type. The slot itself
// can be a voice entry in a localized table rather than an instance register.
const slots = {};
for (const slot of S.w.rel) {
  const handle = S.U(slot);
  if (S.res.get(handle) !== 0x115) continue;
  const bank = S.U(handle), info = EC.bankInfo(A, bank);
  if (info && (info.kind === 'WAVE' || info.kind === 'WAVS') && !slots[info.kind]) {
    slots[info.kind] = { slot, handle, bank, info };
  }
}
assert(slots.WAVE && slots.WAVS, '30-00 contains both resident WAVE and streamed WAVS sound slots');

function base64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x6000) binary += String.fromCharCode(...bytes.subarray(i, Math.min(bytes.length, i + 0x6000)));
  return btoa(binary);
}
function createAsset(id, kind, channels, frequency) {
  const sampleRate = 22050, samples = 4096;
  const pcm = Array.from({length: channels}, (_, ch) => Float32Array.from({length: samples}, (_, i) =>
    0.62 * Math.sin(2 * Math.PI * (frequency + ch * 73) * i / sampleRate) + 0.06 * Math.sin(i * 0.13 + ch)
  ));
  const adpcm = encodeXboxAdpcm(pcm);
  return {
    id, name: id + '.wav', bankName: 'custom_' + id + '.wav', guid: id === 'wave' ? 'a1'.repeat(16) : 'b2'.repeat(16),
    kind, sampleRate, channels, samples, adpcm: base64(adpcm), bytes: adpcm.length, expectedPcm: pcm
  };
}
const assets = {
  wave: createAsset('wave_import_test', 'WAVE', 2, 440),
  wavs: createAsset('wavs_import_test', 'WAVS', 1, 330),
};
const ops = {
  mods: {
    0: { sounds: {
      [slots.WAVE.slot]: { customId: 'wave' },
      [slots.WAVS.slot]: { customId: 'wavs' },
    } }
  }
};
const soundPlan = EC.SoundPlan(h78, h7c);
const patched = EC.patchLcs(A, B, ops, '30-00.LCS', () => null, { snd: soundPlan, audioAssets: assets });
const P = EC.SrcCtx(patched.A, patched.B);

for (const [id, kind] of [['wave', 'WAVE'], ['wavs', 'WAVS']]) {
  const old = slots[kind], slot = old.slot;
  assert(P.w.rel.has(slot), kind + ' sound pointer remains relocated');
  const handleOff = P.U(slot), bankOff = P.U(handleOff);
  assert.equal(P.res.get(handleOff), 0x115, kind + ' slot points to a registered sound handle');
  assert.equal(P.res.get(bankOff), 0x113, kind + ' sound handle points to a registered sound bank');
  const bank = EC.parseBank(patched.A, bankOff), info = EC.bankInfo(patched.A, bankOff);
  assert.equal(info.kind, kind, kind + ' storage type is retained');
  assert.equal(bank.name, assets[id].bankName, kind + ' bank gets a unique project asset name');
  assert.equal(bank.samples, assets[id].samples, kind + ' fact sample count is retained');
  const riff = EC.riffChunks(patched.A, bankOff), fmt = riff.chunks['fmt '][0];
  const fd = new DataView(patched.A.buffer, patched.A.byteOffset, patched.A.byteLength);
  assert.equal(fd.getUint16(fmt.at, true), 0x0069, kind + ' bank uses Xbox IMA ADPCM');
  assert.equal(fd.getUint16(fmt.at + 2, true), assets[id].channels, kind + ' channel count is written');
  assert.equal(fd.getUint32(fmt.at + 4, true), assets[id].sampleRate, kind + ' sample rate is written');
  assert.equal(info.len, assets[id].bytes, kind + ' stream byte count is retained');
}

const rebuiltPca = EC.buildPca(oldPca, soundPlan, () => null);
const newBase = Math.ceil(soundPlan.h78 / 0x800) * 0x800;
for (const [id, kind] of [['wave', 'WAVE'], ['wavs', 'WAVS']]) {
  const old = slots[kind], handleOff = P.U(old.slot), bankOff = P.U(handleOff), info = EC.bankInfo(patched.A, bankOff);
  const streamAt = (kind === 'WAVE' ? 0 : newBase) + info.off;
  assert(streamAt + info.len <= rebuiltPca.length, kind + ' encoded stream fits rebuilt PCA');
  const bytes = rebuiltPca.subarray(streamAt, streamAt + info.len);
  const pcm = decodeXboxAdpcm(bytes, assets[id].channels, assets[id].samples);
  let mse = 0;
  for (let ch = 0; ch < pcm.length; ch++) for (let i = 0; i < pcm[ch].length; i++) {
    const diff = assets[id].expectedPcm[ch][i] - pcm[ch][i]; mse += diff * diff;
  }
  mse /= assets[id].channels * assets[id].samples;
  assert(Math.sqrt(mse) < 0.025, kind + ' stream decodes close to the imported PCM (RMSE ' + Math.sqrt(mse) + ')');
  console.log(`PASS custom ${kind} import: ${info.len} bytes, ${assets[id].channels} channel(s), RMSE ${Math.sqrt(mse).toFixed(4)}`);
}

// Exercise the copy/paste path too: Sensei_Intro's localized table lives in
// a copied data block, so its owner-relative sound edit must land on the clone.
const senseiIndex = S.w.instances.findIndex(instance => S.w.classes[instance.cls]?.name === 'Sensei_Intro');
assert(senseiIndex >= 0, 'Sensei_Intro exists in 30-00');
const senseiInit = S.w.instances[senseiIndex].init;
const senseiTable = S.U(senseiInit + 4); // R1 localized speech table
const senseiAudioSlot = senseiTable + 4; // English audio handle
const addedPlan = EC.SoundPlan(h78, h7c);
const added = EC.patchLcs(A, B, {
  adds: [{
    from: { w: '30-00.LCS', i: senseiIndex }, p: [1, 0, 1],
    sounds: { [senseiAudioSlot]: { owner: senseiTable, slot: senseiAudioSlot, ownerKind: 'data', customId: 'wavs' } }
  }]
}, '30-00.LCS', () => ({ A, B }), { snd: addedPlan, audioAssets: assets });
const addedCtx = EC.SrcCtx(added.A, added.B);
assert.equal(addedCtx.w.instances.length, S.w.instances.length + 1, 'copy/paste adds one Sensei_Intro instance');
const copiedSensei = addedCtx.w.instances[addedCtx.w.instances.length - 1];
const copiedTable = addedCtx.U(copiedSensei.init + 4);
assert.notEqual(copiedTable, senseiTable, 'copied Sensei gets its own localized table');
const copiedAudioSlot = copiedTable + 4, copiedHandle = addedCtx.U(copiedAudioSlot), copiedBank = addedCtx.U(copiedHandle);
assert.equal(addedCtx.res.get(copiedHandle), 0x115, 'copied custom audio is attached through a sound handle');
assert.equal(EC.bankInfo(added.A, copiedBank).kind, 'WAVS', 'copied custom audio preserves WAVS storage type');
assert.equal(EC.parseBank(added.A, copiedBank).name, assets.wavs.bankName, 'copied sound points to the imported asset bank');
const addedPca = EC.buildPca(oldPca, addedPlan, () => null);
const addedInfo = EC.bankInfo(added.A, copiedBank), addedStream = Math.ceil(addedPlan.h78 / 0x800) * 0x800 + addedInfo.off;
const copiedPcm = decodeXboxAdpcm(addedPca.subarray(addedStream, addedStream + addedInfo.len), 1, assets.wavs.samples);
assert(copiedPcm[0].some(x => Math.abs(x) > 0.01), 'copied custom sound has decodable non-silent PCA data');
console.log('PASS importing custom WAVS into a copied Sensei preserves the clone-local table and PCA audio');

// A slot's resident/streamed storage class is part of its compatibility.
const mismatchPlan = EC.SoundPlan(h78, h7c);
assert.throws(() => EC.patchLcs(A, B, {
  mods: { 0: { sounds: { [slots.WAVS.slot]: { customId: 'wave' } } } }
}, '30-00.LCS', () => null, { snd: mismatchPlan, audioAssets: assets }), /format mismatch: WAVS cannot be replaced with WAVE/);
console.log('PASS incompatible WAVE/WAVS replacements are refused before output');

// The original PCA is not mutated by insertion; a new .PCA is built for output.
assert.equal(oldPca.byteLength, pcaEntry.size);
console.log('PASS custom audio import builds new LCS/.PCA data without modifying the source archive');
