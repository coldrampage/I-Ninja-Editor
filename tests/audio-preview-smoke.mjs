import assert from 'node:assert/strict';
import fs from 'node:fs';
import { decodeXboxAdpcm, encodeXboxAdpcm } from '../js/audio-preview.js';
import { installEntityEditor } from '../js/entity-editor.js';
import { EC } from '../js/editor-core.js';
import { parseVol, readWad, instances } from '../js/vol-core.js';

// A predictor-only Xbox block decodes to a constant signal, so this is a
// deterministic check of header parsing, nibble ordering and sample trimming.
const flatBlock = new Uint8Array(36);
new DataView(flatBlock.buffer).setInt16(0, 1000, true);
const flat = decodeXboxAdpcm(flatBlock, 1, 64)[0];
assert.equal(flat.length, 64);
assert.equal(flat[0], 1000 / 32768);
assert.equal(flat[63], 1000 / 32768);
assert.throws(() => decodeXboxAdpcm(new Uint8Array(35), 1, 64), /whole number of Xbox blocks/);
assert.throws(() => decodeXboxAdpcm(new Uint8Array(36), 3, 64), /mono or stereo/);
for (const channels of [1, 2]) {
  const input = Array.from({length: channels}, (_, ch) => Float32Array.from({length: 777}, (_, i) =>
    0.68 * Math.sin(i * 2 * Math.PI * (ch ? 330 : 440) / 22050) + 0.08 * Math.sin(i * 0.17 + ch)
  ));
  const encoded = encodeXboxAdpcm(input);
  assert.equal(encoded.length, Math.ceil(777 / 64) * 36 * channels, 'encoder emits whole Xbox blocks');
  const decoded = decodeXboxAdpcm(encoded, channels, 777);
  const directOutput = Array.from({ length: channels }, () => new Float32Array(777));
  const directResult = decodeXboxAdpcm(encoded, channels, 777, directOutput);
  assert.equal(directResult, directOutput, 'decoder can write into caller-provided AudioBuffer channel arrays');
  let mse = 0;
  for (let ch = 0; ch < channels; ch++) for (let i = 0; i < 777; i++) {
    assert.equal(directOutput[ch][i], decoded[ch][i], 'direct-to-buffer decoding matches ordinary decode output');
    const delta = input[ch][i] - decoded[ch][i]; mse += delta * delta;
  }
  const rmse = Math.sqrt(mse / (777 * channels));
  assert(rmse < 0.02, `encoder/decoder round-trip quality is acceptable (${channels} ch, RMSE ${rmse})`);
}
console.log('PASS Xbox ADPCM encoder round-trips mono and stereo PCM with low quantization error');
console.log('PASS Xbox ADPCM decoder handles predictor headers, block layout, validation and direct AudioBuffer output');

const volPath = process.env.ININJA_TEST_30_VOL;
const avlPath = process.env.ININJA_TEST_30_AVL;
if (!volPath || !avlPath || !fs.existsSync(volPath) || !fs.existsSync(avlPath)) {
  console.log('SKIP real WAVE/WAVS preview tests (set ININJA_TEST_30_VOL and ININJA_TEST_30_AVL)');
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
const wadHeader = new DataView(vol).getUint32(wadEntry.off + 0x78, true);
const pca = new Uint8Array(avl, pcaEntry.off, pcaEntry.size);
const banks = [];
for (const [off, type] of S.res) {
  if (type !== 0x113) continue;
  const info = EC.bankInfo(A, off), bank = EC.parseBank(A, off), riff = EC.riffChunks(A, off);
  if (!info || !bank || !riff || !['WAVE', 'WAVS'].includes(info.kind)) continue;
  const fmt = riff.chunks['fmt '] && riff.chunks['fmt '][0];
  if (!fmt || fmt.n < 20) continue;
  const d = new DataView(A.buffer, A.byteOffset, A.byteLength);
  const channels = d.getUint16(fmt.at + 2, true), sampleRate = d.getUint32(fmt.at + 4, true);
  const start = (info.kind === 'WAVE' ? 0 : Math.ceil(wadHeader / 0x800) * 0x800) + info.off;
  assert(start + info.len <= pca.length, `${bank.name} stream is inside PCA`);
  const pcm = decodeXboxAdpcm(pca.subarray(start, start + info.len), channels, bank.samples);
  let energy = 0;
  for (const channel of pcm) for (const sample of channel) energy += sample * sample;
  assert(energy > 0 && Number.isFinite(energy), `${bank.name} produces non-silent finite PCM`);
  banks.push({ off, bank, info, channels, sampleRate, start, pcm });
}
const wave = banks.find(x => x.info.kind === 'WAVE');
const waveS = banks.find(x => x.info.kind === 'WAVS' && x.channels === 1);
const stereoWavS = banks.find(x => x.info.kind === 'WAVS' && x.channels === 2);
assert(wave && waveS && stereoWavS, 'resident WAVE, streamed mono WAVS and stereo WAVS samples decode');
console.log(`PASS real resident WAVE preview decode: ${wave.bank.name} (${wave.sampleRate} Hz)`);
console.log(`PASS real streamed mono WAVS preview decode: ${waveS.bank.name} (${waveS.sampleRate} Hz)`);
console.log(`PASS real streamed stereo WAVS preview decode: ${stereoWavS.bank.name} (${stereoWavS.sampleRate} Hz)`);

// Exercise the rendered button's play -> pause -> resume path with a tiny
// WebAudio test double while loading real PCA bytes and real LCS sound metadata.
const lcsEntry = wadEntry;
const entities = instances(A, B).map(e => ({ ...e, L: '30-00' }));
const sensei = entities.find(e => e.n === 'Sensei_Intro');
assert(sensei, 'Sensei_Intro provides editable localized voice links');
sensei.b = null; sensei.path = null; // keep this smoke test focused on register/audio UI
const elements = new Map();
const previewButton = { dataset: {}, textContent: '▶', title: '', disabled: false, setAttribute() {}, onclick: null };
const importInput = { dataset: {}, files: [], value: '', click() {}, onchange: null };
const importButton = { dataset: {}, onclick: null, parentNode: { querySelector: () => importInput } };
let selectMock = null, pagehideHandler = null;
function element(id) {
  if (!elements.has(id)) elements.set(id, {
    id, value: '', innerHTML: '', textContent: '', dataset: {}, style: {},
    querySelectorAll(selector) {
      if (id !== 'ed_sel') return [];
      if (selector === 'button[data-sound-preview]') return [previewButton];
      if (selector === 'select[data-sound-slot]') return selectMock ? [selectMock] : [];
      if (selector === 'button[data-sound-import]') return [importButton];
      if (selector === 'input[data-sound-import-file]') return [importInput];
      return [];
    },
    querySelector() { return null; }, addEventListener() {}, insertAdjacentHTML() {},
  });
  return elements.get(id);
}
const oldAddEvent = globalThis.addEventListener;
globalThis.addEventListener = (name, callback) => { if (name === 'pagehide') pagehideHandler = callback; };
globalThis.innerWidth = 1200; globalThis.innerHeight = 800; globalThis.onmouseup = () => {};
class FakeAudioContext {
  constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {}; this.starts = 0; this.closed = false; }
  async decodeAudioData() {
    const samples = 777, data = Float32Array.from({length: samples}, (_, i) => 0.65 * Math.sin(i * 2 * Math.PI * 440 / 22050));
    return { numberOfChannels: 1, length: samples, sampleRate: 22050, getChannelData() { return data; } };
  }
  async close() { this.closed = true; }
  createBuffer(channels, length, sampleRate) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { numberOfChannels: channels, length, sampleRate, duration: length / sampleRate,
      copyToChannel(source, ch) { data[ch].set(source); }, getChannelData(ch) { return data[ch]; } };
  }
  createBufferSource() {
    const owner = this;
    return { buffer: null, onended: null, connect() {}, start() { owner.starts++; }, stop() {} };
  }
}
const oldAudioContext = globalThis.AudioContext;
globalThis.AudioContext = FakeAudioContext;
const project = { app: 'ininja-editor', v: 1, wads: {} };
const level = { id: '30-00', ents: entities, nb: entities.length };
const Viewer = {
  D: [level], all: entities, sel: sensei, $: element, scr: () => ({ c: { roles: {} }, l: [] }),
  col: () => '#abc', esc: x => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'), regTxt: () => '',
  buildEnts() {}, inspect() {}, refresh() {}, need: false, cv: { style: {}, addEventListener() {} },
  camera: { position: { y: 0, clone() { return this; }, addScaledVector() {} } },
  V3: class { unproject() { return this; } sub() { return this; } normalize() { this.y = 1; return this; } },
  ggame: () => [0, 0, 0], mdown: null, drag: null, nearest: () => null,
};
const base = e => e.base || (e.base = { p: e.p.slice(), b: e.b && e.b.slice(), poly: e.poly, path: e.path, shape: e.shape, pathbox: e.pathbox, xzOnly: e.xzOnly, r: e.r, q: e.q, pv: e.params.map(p => p.v) });
const wadCache = { '30-00.LCS': { A, B } };
const ws = {};
const WS = w => ws[w] || (ws[w] = project.wads[w] || (project.wads[w] = { mods: {}, adds: [], del: [] }));
const getAudioPca = async () => ({ pca, h78: wadHeader });
const editor = installEntityEditor({
  Viewer, EC, getProject: () => project, wadOf: id => id + '.LCS', getWad: w => wadCache[w] || null,
  WS, base, put() {}, unzero: () => false, srcEnt: () => null,
  addMaxId: () => 0, ensureClass: () => null, pushAdds: () => 0, stripLinkRegs() {},
  summary() {}, rmList() {}, r3: x => Math.round(x * 1000) / 1000, getAudioPca,
});
editor.update();
const rendered = element('ed_sel').innerHTML;
const buttonMatch = /data-sound-wad="([^"]+)" data-sound-bank-off="(\d+)"/.exec(rendered);
assert(buttonMatch, 'voice dropdown renders a playable sound-bank handle');
previewButton.dataset.soundWad = buttonMatch[1];
previewButton.dataset.soundBankOff = buttonMatch[2];
const selectMatch = /<select data-sound-slot="(\d+)" data-sound-owner="(\d+)" data-sound-owner-kind="([^"]+)">([\s\S]*?)<\/select>/.exec(rendered);
assert(selectMatch, 'voice dropdown exposes its sound options');
const options = [...selectMatch[4].matchAll(/<option value="(\d+)" data-bank-off="(\d+)"/g)].map(m => ({ value: m[1], dataset: { bankOff: m[2] } }));
const replacement = options.find(o => o.dataset.bankOff && o.dataset.bankOff !== previewButton.dataset.soundBankOff);
assert(replacement, 'dropdown has another sound to preview before committing it');
selectMock = { value: replacement.value, options, dataset: { soundSlot: selectMatch[1], soundOwner: selectMatch[2], soundOwnerKind: selectMatch[3] }, parentNode: { querySelector: () => previewButton } };
editor.update();
assert.equal(typeof selectMock.onchange, 'function', 'sound dropdown receives a change handler');
selectMock.onchange();
assert.equal(previewButton.dataset.soundBankOff, replacement.dataset.bankOff, 'changing the dropdown retargets the preview button to the replacement sound');
assert.equal(typeof previewButton.onclick, 'function', 'preview button receives a click handler');
await previewButton.onclick();
assert.equal(previewButton.textContent, 'Ⅱ', 'click starts preview and changes the button to pause');
await previewButton.onclick();
assert.equal(previewButton.textContent, '▶', 'second click pauses playback');
await previewButton.onclick();
assert.equal(previewButton.textContent, 'Ⅱ', 'third click resumes the same clip');
assert.equal(previewButton.disabled, false);
assert.equal(previewButton.title, 'Pause audio preview');
assert.equal((await Promise.resolve(1)), 1);
console.log('PASS changing the sound dropdown retargets the adjacent preview button');
console.log('PASS preview button starts, pauses and resumes a real replacement bank using the matching PCA');

const inputMatch = /<input type=file accept="audio\/\*,\.wav" data-sound-import-file data-sound-slot="(\d+)" data-sound-owner="(\d+)" data-sound-owner-kind="([^"]+)" data-sound-kind="(WAVE|WAVS)"/.exec(element('ed_sel').innerHTML);
assert(inputMatch, 'sound row exposes a custom audio file input');
importInput.dataset = { soundSlot: inputMatch[1], soundOwner: inputMatch[2], soundOwnerKind: inputMatch[3], soundKind: inputMatch[4] };
importInput.files = [{ name: 'imported-test.wav', size: 128, arrayBuffer: async () => new ArrayBuffer(128) }];
assert.equal(typeof importInput.onchange, 'function', 'custom audio file input receives an import handler');
await importInput.onchange();
const customIds = Object.keys(project.audioAssets || {});
assert.equal(customIds.length, 1, 'import stores one custom asset in the in-memory project');
const customId = customIds[0], customAsset = project.audioAssets[customId];
assert.equal(customAsset.kind, inputMatch[4], 'import retains the target slot storage class');
assert(customAsset.adpcm.length > 0, 'imported asset stores encoded Xbox ADPCM');
previewButton.dataset.soundCustomId = customId;
previewButton.disabled = false;
await previewButton.onclick();
assert.equal(previewButton.textContent, 'Ⅱ', 'imported custom sound can be previewed');
// Replacing the custom sound with an existing game bank removes the now-unused
// import from project memory; the audio preview cache is separately bounded.
selectMock.value = replacement.value;
selectMock.onchange();
assert.equal(Object.keys(project.audioAssets || {}).length, 0, 'unused replaced imports are pruned from project memory');
assert(pagehideHandler, 'editor registers preview cleanup on pagehide');
pagehideHandler();
assert.equal(previewButton.textContent, '▶');
console.log('PASS custom WAV import decodes, encodes, stores as project content and previews in the editor');
console.log('PASS unreferenced imported audio is pruned and preview resources are released on pagehide');

globalThis.AudioContext = oldAudioContext;
globalThis.addEventListener = oldAddEvent;
