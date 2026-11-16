import assert from 'node:assert/strict';
import fs from 'node:fs';
import { installProjectManager } from '../js/project-manager.js';
import { EC } from '../js/editor-core.js';
import { parseVol, readWad } from '../js/vol-core.js';
import { encodeXboxAdpcm } from '../js/audio-preview.js';

const volPath = process.env.ININJA_TEST_30_VOL;
const avlPath = process.env.ININJA_TEST_30_AVL;
if (!volPath || !avlPath || !fs.existsSync(volPath) || !fs.existsSync(avlPath)) {
  console.log('SKIP custom audio project build integration (set ININJA_TEST_30_VOL and ININJA_TEST_30_AVL)');
  process.exit(0);
}
const readArrayBuffer = path => { const b = fs.readFileSync(path); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const sourceVol = readArrayBuffer(volPath), sourceAvl = readArrayBuffer(avlPath);
const wadEntry = parseVol(sourceVol).find(x => x.name.toLowerCase() === '30-00.lcs');
const pcaEntry = parseVol(sourceAvl).find(x => x.name.toLowerCase() === '30-00.pca');
assert(wadEntry && pcaEntry, 'real level LCS and PCA are available');
const [A, B] = readWad(sourceVol, wadEntry), S = EC.SrcCtx(A, B);
const sourceHeader = new DataView(sourceVol, wadEntry.off);
const musicWadEntry = parseVol(sourceVol).find(x => x.name.toLowerCase() === '30-99.lcs');
const musicPcaEntry = parseVol(sourceAvl).find(x => x.name.toLowerCase() === '30-99.pca');
assert(musicWadEntry && musicPcaEntry, '30-99 bank LCS and PCA are available');
const [musicA, musicB] = readWad(sourceVol, musicWadEntry), musicSource = EC.SrcCtx(musicA, musicB);
const musicHeader = new DataView(sourceVol, musicWadEntry.off);
const musicInfo = { h78: musicHeader.getUint32(0x78, true), h7c: musicHeader.getUint32(0x7c, true) };
const musicPlayer = musicSource.w.instances.find(i => musicSource.w.classes[i.cls]?.name === 'MusicPlayerBank');
assert(musicPlayer, '30-99 MusicPlayerBank is present');
const musicAmcpOff = musicSource.U(musicSource.U(musicPlayer.init));
const musicCue = EC.ampcTracks(musicSource, musicAmcpOff).tracks.find(t => t.cueName.toLowerCase() === 'logride');
assert(musicCue && musicCue.replaceable && musicCue.kind === 'WAVS', '30-99 LogRide is an editable WAVS music cue');
const senseiIndex = S.w.instances.findIndex(instance => S.w.classes[instance.cls]?.name === 'Sensei_Intro');
assert(senseiIndex >= 0, 'Sensei_Intro is present');
const soundSlot = S.w.instances[senseiIndex].init + 4; // its first dialogue table pointer is R1; edit one voice within it below
const dialogueTable = S.U(soundSlot), audioSlot = dialogueTable + 4;
const audioHandle = S.U(audioSlot);
assert.equal(S.res.get(audioHandle), 0x115, 'selected dialogue audio slot is a sound handle');
assert.equal(EC.bankInfo(A, S.U(audioHandle)).kind, 'WAVS', 'selected dialogue audio is streamed WAVS');

const channels = [Float32Array.from({length: 3072}, (_, i) => 0.55 * Math.sin(i * 2 * Math.PI * 523.25 / 22050))];
const adpcm = encodeXboxAdpcm(channels);
let binary = ''; for (let i = 0; i < adpcm.length; i += 0x6000) binary += String.fromCharCode(...adpcm.subarray(i, i + 0x6000));
const asset = { id: 'build_sfx', name: 'build_sfx.wav', bankName: 'custom_build_sfx.wav', guid: 'c3'.repeat(16), kind: 'WAVS', sampleRate: 22050, channels: 1, samples: channels[0].length, adpcm: btoa(binary), bytes: adpcm.length };
const musicPcm = [Float32Array.from({ length: 4096 }, (_, i) => 0.5 * Math.sin(i * 2 * Math.PI * 261.63 / 22050))];
const musicAdpcm = encodeXboxAdpcm(musicPcm);
let musicBinary = ''; for (let i = 0; i < musicAdpcm.length; i += 0x6000) musicBinary += String.fromCharCode(...musicAdpcm.subarray(i, i + 0x6000));
const musicAsset = { id: 'build_music', name: 'build_music.wav', bankName: 'custom_build_music.wav', guid: 'd4'.repeat(16), kind: 'WAVS', isMusic: true, sampleRate: 22050, channels: 1, samples: musicPcm[0].length, adpcm: btoa(musicBinary), bytes: musicAdpcm.length };

const levelFile = { name: '30-00.LCS', vol: '30.vol', buf: sourceVol, off: wadEntry.off, size: wadEntry.size };
const musicLevelFile = { name: '30-99.LCS', vol: '30.vol', buf: sourceVol, off: musicWadEntry.off, size: musicWadEntry.size };
const loadedAvls = new Map();
const avlObj = { name: '30.avl', file: {name:'30.avl'}, buf: sourceAvl, list: parseVol(sourceAvl) };
loadedAvls.set('30', avlObj);
const project = {
  app: 'ininja-editor', v: 1, vols: {}, models: {}, prefabs: [], scripts: {}, textures: {}, tints: {}, display: {},
  audioAssets: { build_sfx: asset, build_music: musicAsset },
  wads: {
    '30-00.LCS': {
      vol: '30.vol', fp: { A: EC.fnv(A), B: EC.fnv(B) }, adds: [], del: [],
      mods: { [senseiIndex]: { sounds: { [audioSlot]: { owner: dialogueTable, slot: audioSlot, ownerKind: 'data', customId: 'build_sfx' } } } }
    },
    '30-99.LCS': {
      vol: '30.vol', fp: { A: EC.fnv(musicA), B: EC.fnv(musicB) }, adds: [], del: [], mods: {},
      music: { [musicCue.bankOff]: 'build_music' }
    }
  }
};
const elements = Object.fromEntries(['ed_pf','ed_sum','st','ed_save','ed_patch'].map(id => [id, { id, textContent:'', value:'', files:[], onclick:null, onchange:null }]));
const Viewer = { $: id => elements[id] || null, D: [], files: [levelFile, musicLevelFile], refresh(){}, loadJson: async()=>{}, };
const downloads = [];
const oldDocument = globalThis.document, oldBlob = globalThis.Blob, oldURL = globalThis.URL, oldTimeout = globalThis.setTimeout;
globalThis.document = { createElement: () => ({ href:null, download:'', click(){ downloads.push({name:this.download, blob:this.href}); } }) };
globalThis.Blob = class { constructor(parts, options){ this._parts=parts; this.type=options?.type; } };
globalThis.URL = { createObjectURL(blob){ return blob; }, revokeObjectURL(){} };
globalThis.setTimeout = callback => { callback(); return 0; };

installProjectManager({
  Viewer, EC, IA: {}, getProject:()=>project, setProject:p=>Object.assign(project,p),
  isVol:()=>true, getWad:w=>w==='30-00.LCS'?{A,B}:w==='30-99.LCS'?{A:musicA,B:musicB}:null, volOf:w=>String(w).endsWith('.LCS')?'30.vol':String(w),
  getVolName:()=> '30.vol', loadedVols:()=>['30.vol'], buildScriptWadsFp:()=>({}),
  sndPlan:w=>w==='30-00.LCS'?EC.SoundPlan(sourceHeader.getUint32(0x78,true), sourceHeader.getUint32(0x7c,true)):EC.SoundPlan(musicInfo.h78,musicInfo.h7c),
  avlLoad:async v=>{ assert.equal(v,'30.vol'); return avlObj; }, avlOk:()=>true, vbase:x=>String(x||'').replace(/\.(vol|avl)$/i,''), getAvl:()=>loadedAvls.get('30'),
  sourceClass:()=>null, unzero:m=>!!(m.sounds && Object.keys(m.sounds).length),
});
await elements.ed_patch.onclick();
assert.match(elements.ed_sum.textContent, /built 30\.patched\.vol \+ 30\.patched\.avl/, 'build reports both patched volume files');
const volDownload = downloads.find(x => x.name === '30.patched.vol');
const avlDownload = downloads.find(x => x.name === '30.patched.avl');
assert(volDownload && avlDownload, 'build downloads patched VOL and AVL');
function concat(parts) {
  const list = parts.flat().map(p => p instanceof Uint8Array ? p : new Uint8Array(p));
  const size = list.reduce((n,p)=>n+p.length,0), out = new Uint8Array(size); let at=0;
  for(const p of list){out.set(p,at);at+=p.length;} return out.buffer;
}
const patchedVolBlob = volDownload.blob;
const patchedAvlBlob = avlDownload.blob;
assert(patchedVolBlob && patchedAvlBlob, 'patched files are emitted as temporary Blob downloads, not persistent browser storage');
const patchedVol = concat(patchedVolBlob._parts), patchedAvl = concat(patchedAvlBlob._parts);
const builtWadEntry = parseVol(patchedVol).find(x => x.name.toLowerCase() === '30-00.lcs');
const builtPcaEntry = parseVol(patchedAvl).find(x => x.name.toLowerCase() === '30-00.pca');
assert(builtWadEntry && builtPcaEntry, 'rebuilt archives contain the updated LCS and PCA');
const [builtA, builtB] = readWad(patchedVol, builtWadEntry), built = EC.SrcCtx(builtA, builtB);
const builtSensei = built.w.instances[senseiIndex], builtTable = built.U(builtSensei.init + 4), builtHandle = built.U(builtTable + 4), builtBank = built.U(builtHandle);
assert.equal(built.res.get(builtHandle), 0x115, 'built LCS retains a sound handle');
assert.equal(EC.parseBank(builtA, builtBank).name, asset.bankName, 'built LCS points to the imported custom bank');
const builtPca = new Uint8Array(patchedAvl, builtPcaEntry.off, builtPcaEntry.size);
const info = EC.bankInfo(builtA, builtBank), builtHeader = new DataView(patchedVol, builtWadEntry.off);
const streamAt = Math.ceil(builtHeader.getUint32(0x78,true)/0x800)*0x800 + info.off;
assert(streamAt + info.len <= builtPca.length, 'built AVL contains the imported WAVS stream');
console.log('PASS project Build patched .vol writes the custom WAVS bank, relocated handle and paired .patched.avl stream');
const builtMusicEntry = parseVol(patchedVol).find(x => x.name.toLowerCase() === '30-99.lcs');
const builtMusicPcaEntry = parseVol(patchedAvl).find(x => x.name.toLowerCase() === '30-99.pca');
assert(builtMusicEntry && builtMusicPcaEntry, 'patched archives contain the 30-99 music bank and its paired PCA');
const [builtMusicA, builtMusicB] = readWad(patchedVol, builtMusicEntry), builtMusic = EC.SrcCtx(builtMusicA, builtMusicB);
const builtCue = EC.ampcTracks(builtMusic, musicAmcpOff).tracks.find(t => t.cueName.toLowerCase() === 'logride');
assert(builtCue && builtCue.bankOff === musicCue.bankOff, 'project build keeps the original MusicPlayerBank AMPC GUID target');
assert.equal(EC.parseBank(builtMusicA, builtCue.bankOff).samples, musicAsset.samples, 'project build updates the selected music stream metadata');
const builtMusicPca = new Uint8Array(patchedAvl, builtMusicPcaEntry.off, builtMusicPcaEntry.size);
const builtMusicInfo = EC.bankInfo(builtMusicA, builtCue.bankOff), builtMusicHeader = new DataView(patchedVol, builtMusicEntry.off);
const builtMusicStreamAt = Math.ceil(builtMusicHeader.getUint32(0x78,true)/0x800)*0x800 + builtMusicInfo.off;
assert(builtMusicStreamAt + builtMusicInfo.len <= builtMusicPca.length, 'patched AVL contains the new music WAVS stream');
console.log('PASS project Build patched 30-99 music cue in place and writes the paired music PCA stream');

globalThis.document=oldDocument;globalThis.Blob=oldBlob;globalThis.URL=oldURL;globalThis.setTimeout=oldTimeout;
