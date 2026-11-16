import assert from 'node:assert/strict';
import fs from 'node:fs';
import { encodeXboxAdpcm, decodeXboxAdpcm } from '../js/audio-preview.js';
import { EC } from '../js/editor-core.js';
import { parseVol, readWad } from '../js/vol-core.js';

const readBuffer = path => {
  const bytes = fs.readFileSync(path);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};
const volumePaths = Object.fromEntries(['30', '40', '50'].map(prefix => [prefix, process.env[`ININJA_TEST_${prefix}_VOL`]]));
const present = Object.entries(volumePaths).filter(([, path]) => path && fs.existsSync(path));
if (!present.length) {
  console.log('SKIP music bank replacement integration (set ININJA_TEST_30_VOL / 40_VOL / 50_VOL)');
  process.exit(0);
}
function getEntry(buffer, name) {
  const entry = parseVol(buffer).find(x => x.name.toLowerCase() === name.toLowerCase());
  assert(entry, `${name} exists in archive`);
  return entry;
}
function loadLcs(vol, name) {
  const entry = getEntry(vol, name), [A, B] = readWad(vol, entry);
  const header = new DataView(vol, entry.off);
  return { A, B, entry, h78: header.getUint32(0x78, true), h7c: header.getUint32(0x7c, true) };
}
function readMusicBank(lcs, label) {
  const S = EC.SrcCtx(lcs.A, lcs.B);
  const inst = S.w.instances.find(x => S.w.classes[x.cls]?.name === 'MusicPlayerBank');
  assert(inst, `${label} has a MusicPlayerBank instance`);
  const handle = S.U(inst.init), bankOff = S.U(handle);
  assert.equal(S.res.get(handle), 0x115, `${label} MusicPlayerBank has a sound-bank handle`);
  assert.equal(S.res.get(bankOff), 0x113, `${label} handle points to AMPC resource`);
  return { S, inst, handle, bankOff, catalog: EC.ampcTracks(S, bankOff) };
}
const expected = {
  '30': ['buzzoff', 'logride', 'psyamon', 'junglesneak'],
  '40': ['clouding', 'crystalcavern', 'malakai', 'sneakdestroy'],
  '50': ['alpha', 'beta', 'cryo', 'emperial', 'odor'],
};
for (const [prefix, path] of present) {
  const vol = readBuffer(path), lcs = loadLcs(vol, `${prefix}-99.LCS`), bank = readMusicBank(lcs, `${prefix}-99`);
  const found = bank.catalog.tracks.map(t => t.cueName);
  for (const cue of expected[prefix]) assert.ok(found.some(x => x.toLowerCase() === cue), `${prefix}-99 AMPC maps ${cue}`);
  assert.ok(bank.catalog.tracks.every(t => t.bankOff != null), `${prefix}-99 maps named cues to real WAVE/WAVS banks`);
  assert.ok(bank.catalog.tracks.every(t => t.kind === 'WAVS'), `${prefix}-99 music uses streamed WAVS resources`);
  for (const track of bank.catalog.tracks) {
    const riff = EC.riffChunks(lcs.A, track.bankOff), fmt = riff.chunks['fmt '][0], d = new DataView(lcs.A.buffer, lcs.A.byteOffset, lcs.A.byteLength);
    const channels = d.getUint16(fmt.at + 2, true), rate = d.getUint32(fmt.at + 4, true);
    assert(track.samples <= rate * 300, `${prefix} ${track.cueName} fits the 5-minute music preview limit`);
    assert(track.samples * channels * 4 <= 96 * 1024 * 1024, `${prefix} ${track.cueName} fits the temporary preview-memory limit`);
  }
  if (prefix === '50') {
    const odor = bank.catalog.tracks.find(t => t.cueName.toLowerCase() === 'odor');
    assert(odor, 'Moon Base Odor cue is present');
    assert.equal(odor.replaceable, false, 'Odor replacement stays disabled while Odor2/Odor3 related streams are unresolved');
    assert.deepEqual(odor.related.map(x => x.name), ['Odor2.wav', 'Odor3.wav']);
  }
  console.log(`PASS ${prefix}-99 AMPC catalogue: ${bank.catalog.tracks.length} named cue(s), ${bank.catalog.unmapped.length} extra stream(s)`);
}

// Replace LogRide inside 30-99 without touching the cue name, GUID or selector.
const volPath = process.env.ININJA_TEST_30_VOL, avlPath = process.env.ININJA_TEST_30_AVL;
if (!volPath || !avlPath || !fs.existsSync(volPath) || !fs.existsSync(avlPath)) {
  console.log('SKIP 30-99 WAVS/PCA replacement round-trip (set ININJA_TEST_30_VOL and ININJA_TEST_30_AVL)');
  process.exit(0);
}
const vol = readBuffer(volPath), avl = readBuffer(avlPath);
const lcs = loadLcs(vol, '30-99.LCS'), music = readMusicBank(lcs, '30-99');
const track = music.catalog.tracks.find(t => t.cueName.toLowerCase() === 'logride');
assert(track && track.replaceable && track.kind === 'WAVS', 'LogRide is a uniquely mapped, replaceable WAVS cue');
const oldGuidChunk = EC.riffChunks(lcs.A, track.bankOff).chunks.guid[0];
const oldGuid = Buffer.from(lcs.A.subarray(oldGuidChunk.at, oldGuidChunk.at + oldGuidChunk.n)).toString('hex');
const pcaEntry = getEntry(avl, '30-99.PCA'), oldPca = new Uint8Array(avl, pcaEntry.off, pcaEntry.size);
const originalInfo = EC.bankInfo(lcs.A, track.bankOff), originalRiff = EC.riffChunks(lcs.A, track.bankOff);
const originalFmt = originalRiff.chunks['fmt '][0], originalDv = new DataView(lcs.A.buffer, lcs.A.byteOffset, lcs.A.byteLength);
const originalChannels = originalDv.getUint16(originalFmt.at + 2, true), originalRate = originalDv.getUint32(originalFmt.at + 4, true);
const originalPcaBase = Math.ceil(lcs.h78 / 0x800) * 0x800, originalStreamAt = originalPcaBase + originalInfo.off;
assert(originalStreamAt + originalInfo.len <= oldPca.length, 'original LogRide stream lies within paired 30-99.PCA');
{
  const originalPcm = decodeXboxAdpcm(oldPca.subarray(originalStreamAt, originalStreamAt + originalInfo.len), originalChannels, track.samples);
  let energy = 0; for (const channel of originalPcm) for (let i = 0; i < channel.length; i += 257) energy += channel[i] * channel[i];
  assert(energy > 0 && Number.isFinite(energy), 'original LogRide music decodes to finite non-silent PCM');
  console.log(`PASS real ${track.kind} music preview decode: ${track.bankName} (${(track.samples / originalRate).toFixed(1)} seconds)`);
}
const channels = 2, sampleRate = 22050, samples = 32768;
const pcm = Array.from({ length: channels }, (_, ch) => Float32Array.from({ length: samples }, (_, i) =>
  0.55 * Math.sin(2 * Math.PI * (330 + ch * 70) * i / sampleRate) + 0.04 * Math.sin(i * 0.071 + ch)
));
const adpcm = encodeXboxAdpcm(pcm);
const asset = {
  id: 'music-roundtrip', name: 'Music test replacement.wav', bankName: 'custom_music_test.wav', guid: 'cc'.repeat(16),
  kind: 'WAVS', isMusic: true, sampleRate, channels, samples,
  adpcm: Buffer.from(adpcm).toString('base64'), bytes: adpcm.length,
};
const plan = EC.SoundPlan(lcs.h78, lcs.h7c);
const patched = EC.patchLcs(lcs.A, lcs.B, {}, '30-99.LCS', () => null, {
  snd: plan, audioAssets: { 'music-roundtrip': asset }, musicAssets: { [track.bankOff]: 'music-roundtrip' }
});
const patchedCtx = readMusicBank({ A: patched.A, B: patched.B }, 'patched 30-99');
const remapped = patchedCtx.catalog.tracks.find(t => t.cueName.toLowerCase() === 'logride');
assert(remapped && remapped.bankOff === track.bankOff, 'AMPC GUID still resolves to the original bank descriptor offset');
const newGuidChunk = EC.riffChunks(patched.A, track.bankOff).chunks.guid[0];
const newGuid = Buffer.from(patched.A.subarray(newGuidChunk.at, newGuidChunk.at + newGuidChunk.n)).toString('hex');
assert.equal(newGuid, oldGuid, 'replacement preserves the bank GUID used by AMPC amrf');
const newInfo = EC.bankInfo(patched.A, track.bankOff), newBank = EC.parseBank(patched.A, track.bankOff);
assert.equal(newInfo.kind, 'WAVS', 'replacement preserves streamed storage class');
assert.equal(newBank.samples, samples, 'replacement updates the music sample count');
const newPca = EC.buildPca(oldPca, plan, () => null);
const newBase = Math.ceil(plan.h78 / 0x800) * 0x800, streamAt = newBase + newInfo.off;
assert(streamAt + newInfo.len <= newPca.length, 'replacement stream is present in rebuilt 30-99.PCA');
const roundTrip = decodeXboxAdpcm(newPca.subarray(streamAt, streamAt + newInfo.len), channels, samples);
let mse = 0;
for (let ch = 0; ch < channels; ch++) for (let i = 0; i < samples; i++) {
  const diff = pcm[ch][i] - roundTrip[ch][i]; mse += diff * diff;
}
mse /= channels * samples;
assert(Math.sqrt(mse) < 0.025, `replacement PCM round-trip is close (RMSE ${Math.sqrt(mse)})`);
console.log(`PASS 30-99 LogRide replacement: ${newInfo.len} WAVS bytes, cue name/GUID preserved, RMSE ${Math.sqrt(mse).toFixed(4)}`);

// Format mismatch is rejected rather than changing the music resource class.
const badAsset = { ...asset, id: 'wrong-kind', kind: 'WAVE', guid: 'dd'.repeat(16) };
assert.throws(() => EC.patchLcs(lcs.A, lcs.B, {}, '30-99.LCS', () => null, {
  snd: EC.SoundPlan(lcs.h78, lcs.h7c), audioAssets: { 'wrong-kind': badAsset }, musicAssets: { [track.bankOff]: 'wrong-kind' }
}), /music format mismatch/i, 'WAVE cannot silently replace a WAVS music stream');
console.log('PASS music WAVE/WAVS mismatch guard');
