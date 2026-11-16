import assert from 'node:assert/strict';
import fs from 'node:fs';
import { installEntityEditor } from '../js/entity-editor.js';
import { EC } from '../js/editor-core.js';
import { parseVol, readWad, instances } from '../js/vol-core.js';

const volumeSpecs = [
  ['30', process.env.ININJA_TEST_30_VOL, '30-02.LCS'],
  ['40', process.env.ININJA_TEST_40_VOL, '40-01.LCS'],
  ['50', process.env.ININJA_TEST_50_VOL, '50-02.LCS'],
].filter(([, path]) => path && fs.existsSync(path));
if (!volumeSpecs.length) {
  console.log('SKIP music/register type UI (set ININJA_TEST_30_VOL / 40_VOL / 50_VOL)');
  process.exit(0);
}

const wadCache = new Map();
function loadWad(volPath, name) {
  const key = `${volPath}|${name}`;
  if (wadCache.has(key)) return wadCache.get(key);
  const bytes = fs.readFileSync(volPath);
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const file = parseVol(ab).find(f => f.name === name);
  assert(file, `${name} exists in ${volPath}`);
  const [A, B] = readWad(ab, file);
  const out = { A, B };
  wadCache.set(key, out);
  return out;
}
function entitiesOf(wad) {
  return instances(wad.A, wad.B).map(e => ({ ...e, L: wad.id }));
}
const volumeByPrefix = Object.fromEntries(volumeSpecs.map(([prefix, path]) => [prefix, path]));
const gameWads = new Map();
for (const [prefix, volPath, targetName] of volumeSpecs) {
  const target = loadWad(volPath, targetName);
  target.id = targetName.replace(/\.LCS$/i, '');
  const bank = loadWad(volPath, `${prefix}-99.LCS`);
  gameWads.set(targetName, target);
  gameWads.set(`${prefix}-99.LCS`, bank);
}

// Also load the 30-00 hub for the MusicPlayerBank cue strings and AMPC link.
if (volumeByPrefix['30']) {
  const hub = loadWad(volumeByPrefix['30'], '30-00.LCS');
  hub.id = '30-00';
  gameWads.set('30-00.LCS', hub);
}

const levels = [];
for (const [name, wad] of gameWads) {
  if (!/^\d+-\d+\.LCS$/i.test(name) || name.endsWith('-99.LCS')) continue;
  const ents = entitiesOf(wad);
  levels.push({ id: wad.id, ents, nb: ents.length });
}
// Keep the bank levels selectable too: MusicPlayerBank is edited in the -99 LCS.
for (const [prefix] of volumeSpecs) {
  const wad = gameWads.get(`${prefix}-99.LCS`);
  if (wad) { wad.id = `${prefix}-99`; const ents = entitiesOf(wad); levels.push({ id: wad.id, ents, nb: ents.length }); }
}

const elements = new Map();
const controls = new Map();
const triggerControls = new Map([
  ['#ed_trigger', { open: true, ontoggle: null }], ['#ed_tr_type', { value: '1', onchange: null }],
  ['#ed_tr_ox', { value: '0', onchange: null }], ['#ed_tr_oy', { value: '0', onchange: null }], ['#ed_tr_oz', { value: '0', onchange: null }],
  ['#ed_tr_sx', { value: '4', onchange: null }], ['#ed_tr_sy', { value: '4', onchange: null }], ['#ed_tr_sz', { value: '4', onchange: null }],
  ['#ed_tr_reset', { onclick: null }],
]);
function element(id) {
  if (!elements.has(id)) elements.set(id, {
    id, value: '', innerHTML: '', textContent: '', dataset: {}, style: {},
    querySelectorAll(selector) { return controls.get(selector) || []; },
    querySelector(selector) { return id === 'ed_sel' ? (triggerControls.get(selector) || null) : null; },
    addEventListener() {}, insertAdjacentHTML() {},
  });
  return elements.get(id);
}
globalThis.addEventListener = () => {};
globalThis.innerWidth = 1200;
globalThis.innerHeight = 800;
globalThis.onmouseup = () => {};
const project = { app: 'ininja-editor', v: 1, wads: {} };
const Viewer = {
  D: levels,
  all: levels.flatMap(l => l.ents),
  sel: null,
  $: element,
  scr(e) {
    const roles =
      e.n === 'PlantLilly' || e.n === 'PlantFlowers' ? { 1: { ty: 'f', note: 'scale' } } :
      e.n === 'CamControlRegion' ? { 3: { ty: 'a', note: 'camera angle' } } :
      e.n === 'CustomSkydome' ? { 1: { ty: 'b', note: 'shadow model enabled' } } :
      e.n === 'SoundPlayer' ? { 0: { ty: 'p', note: 'Sound_PlayVol.sound' }, 4: { ty: 'f', note: 'Sound_PlayVol.vol' } } :
      {};
    return { c: { roles }, l: [] };
  },
  col: () => '#abc',
  esc: x => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
  regTxt: () => '',
  buildEnts() {}, inspect() {}, refresh() {}, need: false,
  cv: { style: {}, addEventListener() {} },
  camera: { position: { y: 0, clone() { return this; }, addScaledVector() {} } },
  V3: class { unproject() { return this; } sub() { return this; } normalize() { this.y = 1; return this; } },
  ggame: () => [0, 0, 0], mdown: null, drag: null, nearest: () => null,
};
const wadCacheByName = new Map();
for (const [name, wad] of gameWads) wadCacheByName.set(name, wad);
const base = e => e.base || (e.base = {
  p: e.p.slice(), b: e.b && e.b.slice(), poly: e.poly, path: e.path,
  shape: e.shape, pathbox: e.pathbox, xzOnly: e.xzOnly, r: e.r, q: e.q,
  pv: e.params.map(p => p.v),
});
const ws = {};
const WS = w => ws[w] || (ws[w] = project.wads[w] || (project.wads[w] = { mods: {}, adds: [], del: [] }));
const editor = installEntityEditor({
  Viewer, EC, getProject: () => project,
  wadOf: id => id + '.LCS',
  getWad: name => wadCacheByName.get(name) || null,
  WS, base, put() {},
  unzero: m => m.d.some(Boolean) || m.dy || m.dp || m.dr ||
    Object.keys(m.regs || {}).length || Object.keys(m.texts || {}).length || Object.keys(m.sounds || {}).length,
  srcEnt: () => null, addMaxId: () => 0, ensureClass: () => null, pushAdds: () => 0,
  stripLinkRegs() {}, summary() {}, rmList() {}, r3: x => Math.round(x * 1000) / 1000,
});
function select(levelId, name) {
  const level = Viewer.D.find(l => l.id === levelId);
  assert(level, `level ${levelId} is available`);
  const e = level.ents.find(x => x.n === name);
  assert(e, `${name} exists in ${levelId}`);
  Viewer.sel = e;
  controls.clear();
  editor.update();
  return { e, html: element('ed_sel').innerHTML };
}

// The selected MusicStart integer maps to the matching volume's MusicPlayerBank cue list.
const expectedCues = {
  '30': ['logride', 'buzzoff', 'junglesneak', 'psyamon'],
  '40': ['clouding', 'crystalcavern', 'sneakdestroy', 'malakai'],
  '50': ['cryo', 'odor', 'alpha', 'beta', 'emperial'],
};
for (const [prefix, , targetName] of volumeSpecs) {
  const levelId = targetName.replace(/\.LCS$/i, '');
  const { e, html } = select(levelId, 'MusicStart');
  assert.match(html, /data-music-k="0"/, `${prefix} MusicStart has a cue selector`);
  assert.match(html, /data-sound-preview data-sound-music="1"/, `${prefix} MusicStart has an adjacent music preview control`);
  for (const cue of expectedCues[prefix]) assert.ok(html.includes(cue), `${prefix} selector contains ${cue}`);
  const selectControl = { dataset: { musicK: '0' }, value: String(e.params[0].v < 6 ? e.params[0].v + 1 : e.params[0].v - 1) };
  controls.set('select[data-music-k]', [selectControl]);
  editor.update();
  assert.equal(typeof selectControl.onchange, 'function', `${prefix} MusicStart selector is interactive`);
  selectControl.onchange();
  assert.equal(project.wads[`${prefix}-${levelId.slice(3)}.LCS`]?.mods?.[e.i]?.regs?.[0], +selectControl.value,
    `${prefix} MusicStart writes the selected numeric cue id`);
  const sourceWad = gameWads.get(targetName);
  const selectedCue = +selectControl.value;
  const patched = EC.patchLcs(sourceWad.A, sourceWad.B, {
    mods: { [e.i]: { d: [0, 0, 0], regs: { 0: selectedCue } } }
  }, targetName, () => null, {});
  assert.equal(instances(patched.A, patched.B)[e.i].params[0].v, selectedCue,
    `${prefix} selected MusicStart cue survives LCS rebuild`);
}

// MusicPlayerBank R1 is an AMPC music bank; its cue-name registers are editable strings.
if (volumeByPrefix['30']) {
  const { e, html } = select('30-00', 'MusicPlayerBank');
  assert.match(html, /music bank \(AMPC\)/, 'MusicPlayerBank is identified as an AMPC bank');
  assert.match(html, /junglehub\.amppc\.amc/i, 'the hub AMPC asset is displayed by name');
  assert.match(html, /value="junglehub"/, 'hub music cue name is visible as an editable string');
  assert.match(html, /data-sound-preview data-sound-music="1"/, 'hub cue has a music play/pause control');
  assert.match(html, /data-music-import/, 'hub cue exposes an import/replacement control');
  assert.match(html, /value="junglesensei"/, 'Sensei music cue name is visible as an editable string');
  assert.match(html, /data-text-kind="init"/, 'music cue names are edited at the entity init register');
  const stringMatch = html.match(/data-text-slot="(\d+)" data-text-owner="(\d+)" data-text-kind="init" value="junglehub"/);
  assert(stringMatch, 'hub cue-name input includes its init slot/owner binding');
  const cueInput = { dataset: { textSlot: stringMatch[1], textOwner: stringMatch[2], textKind: 'init' }, value: 'customhubcue' };
  controls.set('[data-text-slot]', [cueInput]);
  editor.update();
  assert.equal(typeof cueInput.onchange, 'function', 'MusicPlayerBank cue-name input is interactive');
  cueInput.onchange();
  assert.equal(project.wads['30-00.LCS'].mods[e.i].texts[stringMatch[1]].value, 'customhubcue',
    'editing a music cue name stores an init-slot text override');
  const hub = gameWads.get('30-00.LCS');
  const source = EC.SrcCtx(hub.A, hub.B);
  const patched = EC.patchLcs(hub.A, hub.B, {
    mods: { [e.i]: { d: [0, 0, 0], regs: {}, texts: {
      [stringMatch[1]]: { owner: +stringMatch[2], slot: +stringMatch[1], ownerKind: 'init', value: 'customhubcue' }
    } } }
  }, '30-00.LCS', () => null, {});
  const rebuilt = EC.SrcCtx(patched.A, patched.B);
  assert.equal(rebuilt.str(rebuilt.U(rebuilt.w.instances[e.i].init + 4)), 'customhubcue',
    'editing a MusicPlayerBank cue string survives LCS rebuild');
  console.log('PASS MusicPlayerBank resolves AMPC asset plus editable cue names');
  const bankLevel = select('30-99', 'MusicPlayerBank');
  assert.match(bankLevel.html, /data-music-import/, '30-99 exposes custom music replacement on its cue registers');
  assert.match(bankLevel.html, /data-sound-preview data-sound-music=\"1\"/, '30-99 music cues have playback controls');
}
if (volumeByPrefix['50']) {
  const moonBank = select('50-99', 'MusicPlayerBank');
  assert.match(moonBank.html, /Odor2\.wav, Odor3\.wav/, 'multi-stream Odor cue shows its unresolved related resources');
  assert.match(moonBank.html, /data-music-import[^>]*disabled/, 'replacement is disabled for the unresolved multi-stream Odor cue');
}
// Exercise the actual music import control: it adds a project-scoped mapping
// to the selected existing cue, and reset prunes the now-unused imported data.
if (volumeByPrefix['30']) {
  const bankHtml = select('30-99', 'MusicPlayerBank').html;
  const importMatch = bankHtml.match(/data-music-import-file data-music-wad=\"30-99\.LCS\" data-music-bank-off=\"(\d+)\" data-music-kind=\"(WAVS)\"/);
  assert(importMatch, '30-99 music cue exposes a WAVS import file input');
  class ImportAudioContext {
    constructor() { this.state = 'running'; }
    async decodeAudioData() {
      const samples = 1024, pcm = Float32Array.from({ length: samples }, (_, i) => 0.5 * Math.sin(i * 0.09));
      return { numberOfChannels: 1, sampleRate: 22050, length: samples, getChannelData() { return pcm; } };
    }
  }
  const previousAudioContext = globalThis.AudioContext;
  globalThis.AudioContext = ImportAudioContext;
  const file = { name: 'replacement-music.wav', size: 128, arrayBuffer: async () => new ArrayBuffer(128) };
  let inputClicked = false;
  const musicInput = { dataset: { musicWad: '30-99.LCS', musicBankOff: importMatch[1], musicKind: importMatch[2] }, files: [file], value: '', click() { inputClicked = true; }, onchange: null };
  const musicImportButton = { disabled: false, parentNode: { querySelector: () => musicInput }, onclick: null };
  const resetButton = { dataset: { musicWad: '30-99.LCS', musicBankOff: importMatch[1] }, onclick: null };
  controls.set('button[data-music-import]', [musicImportButton]);
  controls.set('input[data-music-import-file]', [musicInput]);
  controls.set('button[data-music-reset]', [resetButton]);
  editor.update();
  assert.equal(typeof musicImportButton.onclick, 'function', 'music replacement button receives a click handler');
  musicImportButton.onclick();
  assert.equal(inputClicked, true, 'music replacement button opens its hidden audio file input');
  assert.equal(typeof musicInput.onchange, 'function', 'music file input receives an import handler');
  await musicInput.onchange();
  const projectMusic = project.wads['30-99.LCS'].music;
  const customMusicId = projectMusic[importMatch[1]];
  assert(customMusicId, 'import creates a project music mapping for the existing cue bank');
  assert.equal(project.audioAssets[customMusicId].kind, 'WAVS', 'music import keeps the track storage type');
  assert.equal(project.audioAssets[customMusicId].isMusic, true, 'music import asset is marked for the longer music-preview limits');
  editor.update();
  assert.equal(typeof resetButton.onclick, 'function', 'reset original control receives a click handler');
  resetButton.onclick();
  assert.equal(project.wads['30-99.LCS'].music[importMatch[1]], undefined, 'reset removes the project music mapping');
  assert.equal(project.audioAssets[customMusicId], undefined, 'reset prunes the now-unused imported music from project memory');
  globalThis.AudioContext = previousAudioContext;
  console.log('PASS MusicPlayerBank imports a WAVS replacement, keeps the project mapping, and resets/prunes it');
}

// The existing ordinary SoundPlayer path remains a WAV/WAVS selector, not an AMPC selector.
if (volumeByPrefix['30']) {
  const { e, html } = select('30-02', 'SoundPlayer');
  assert.match(html, /data-sound-slot=/, 'SoundPlayer exposes a sound-handle selector');
  assert.match(html, /WAVE|WAVS/, 'ordinary sound registers are distinguished from music banks');
  const start = html.indexOf('<select data-sound-slot'), end = html.indexOf('</select>', start);
  const selectHtml = html.slice(start, end + 9);
  const binding = selectHtml.match(/data-sound-slot="(\d+)" data-sound-owner="(\d+)" data-sound-owner-kind="init"/);
  assert(binding, 'SoundPlayer sound selector is bound to its init register');
  const optionValues = [...selectHtml.matchAll(/<option value="(\d+)"/g)].map(m => +m[1]);
  const currentMatch = selectHtml.match(/<option value="(\d+)"[^>]* selected>/);
  const replacementOff = optionValues.find(v => v !== +(currentMatch && currentMatch[1]));
  assert(replacementOff !== undefined, 'a second WAVE/WAVS choice is available');
  const soundControl = { dataset: { soundSlot: binding[1], soundOwner: binding[2], soundOwnerKind: 'init' }, value: String(replacementOff) };
  controls.set('select[data-sound-slot]', [soundControl]);
  editor.update();
  assert.equal(typeof soundControl.onchange, 'function', 'SoundPlayer sound selector is interactive');
  soundControl.onchange();
  assert.equal(project.wads['30-02.LCS'].mods[e.i].sounds[binding[1]].off, replacementOff,
    'changing the SoundPlayer bank stores the selected sound handle');
  const sourceWad = gameWads.get('30-02.LCS');
  const patched = EC.patchLcs(sourceWad.A, sourceWad.B, {
    mods: { [e.i]: { d: [0, 0, 0], regs: {}, texts: {}, sounds: {
      [binding[1]]: { owner: +binding[2], slot: +binding[1], off: replacementOff, ownerKind: 'init' }
    } } }
  }, '30-02.LCS', () => null, {});
  const rebuilt = EC.SrcCtx(patched.A, patched.B), rebuiltInit = rebuilt.w.instances[e.i].init;
  const rebuiltSoundBank = rebuilt.U(rebuilt.U(rebuiltInit));
  assert.equal(EC.parseBank(patched.A, rebuiltSoundBank)?.name,
    selectHtml.match(new RegExp('<option value="' + replacementOff + '"[^>]*>([^<]+)'))?.[1],
    'selected SoundPlayer bank survives LCS rebuild as a resource link');
}

// Typed registers use script-provided representations and confirmed class semantics.
if (volumeByPrefix['30']) {
  const { html: angleHtml } = select('30-02', 'CamControlRegion');
  assert.match(angleHtml, /data-angle-k="3"/, 'angle registers display in degrees');
  const { html: boolHtml } = select('30-00', 'CustomSkydome');
  assert.match(boolHtml, /data-bool-k="1"/, 'boolean registers display as checkboxes');
  const { html: floatHtml } = select('30-02', 'PlantLilly');
  assert.match(floatHtml, /data-float-k="1"/, 'float registers display as decimal values');

  const { e: blocker, html: blockerHtml } = select('30-02', 'RanxBlocker');
  assert.match(blockerHtml, /data-ranx-belt-k="3"/, 'RanxBlocker R3 is a belt-level selector');
  assert.match(blockerHtml, /0 · Yellow belt[\s\S]*4 · Black belt/, 'RanxBlocker belt selector uses the 0–4 belt order');
  const blockerControl = { dataset: { ranxBeltK: '3' }, value: '4' };
  controls.set('select[data-ranx-belt-k]', [blockerControl]);
  editor.update();
  assert.equal(typeof blockerControl.onchange, 'function', 'RanxBlocker belt selector is interactive');
  blockerControl.onchange();
  assert.equal(project.wads['30-02.LCS']?.mods?.[blocker.i]?.regs?.[3], 4, 'RanxBlocker belt selector writes its numeric value');

  const { e: mission, html: missionHtml } = select('30-00', 'Sensei_MissionSelect');
  assert.match(missionHtml, /data-mission-type-k="3"/, 'mission replay 1 type is selectable');
  assert.match(missionHtml, /3 · Hunt the enemies/, 'mission type 3 is labelled as hunting enemies');
  assert.match(missionHtml, /data-k=4[^>]*value=90/, 'mission replay 1 goal remains an editable number');
  assert.match(missionHtml, /enemies to defeat/, 'mission replay 1 goal is labelled from the selected mission type');
  assert.match(missionHtml, /data-belt-lock-k="5"/, 'mission replay 1 belt lock is selectable');
  assert.match(missionHtml, /data-mission-type-k="6"/, 'mission replay 2 repeats the mission-type control');
  assert.match(missionHtml, /data-belt-lock-k="8"/, 'mission replay 2 repeats the belt-lock control');
  const missionTypeControl = { dataset: { missionTypeK: '3' }, value: '2' };
  controls.set('select[data-mission-type-k]', [missionTypeControl]);
  editor.update();
  assert.equal(typeof missionTypeControl.onchange, 'function', 'mission type selector is interactive');
  missionTypeControl.onchange();
  assert.equal(project.wads['30-00.LCS']?.mods?.[mission.i]?.regs?.[3], 2, 'mission type selector writes the selected mission type');
  assert.match(element('ed_sel').innerHTML, /score to beat/, 'mission goal hint updates when the mission type changes');
  const beltControl = { dataset: { beltLockK: '5' }, value: '1' };
  controls.set('select[data-belt-lock-k]', [beltControl]);
  editor.update();
  assert.equal(typeof beltControl.onchange, 'function', 'mission belt-lock selector is interactive');
  beltControl.onchange();
  assert.equal(project.wads['30-00.LCS']?.mods?.[mission.i]?.regs?.[5], 1, 'mission belt-lock selector writes the selected belt');

  const { e: boss, html: bossHtml } = select('30-00', 'Sensei_BossSelect');
  assert.match(bossHtml, /textbox text ID/, 'Sensei_BossSelect R0 is identified as an unresolved textbox text ID');
  assert.match(bossHtml, /data-belt-lock-k="1"/, 'Sensei_BossSelect R1 is a belt-lock selector');

  const { html: guardianHtml } = select('30-00', 'Guardian_Twikki');
  assert.match(guardianHtml, /mission goal value · coin count or time target/, 'Guardian numeric goal registers are identified without guessing their unit');
  const { html: guardianPromptHtml } = select('30-00', 'Guardian_FindMePrompt');
  assert.doesNotMatch(guardianPromptHtml, /mission goal value/, 'Guardian prompt helper is not mislabeled as a mission goal');

  const { html: missionDoorHtml } = select('30-00', 'MissionSelectDoor');
  assert.match(missionDoorHtml, /destination level/, 'MissionSelectDoor string is identified as a destination level');
  assert.match(missionDoorHtml, /value="30-21"/, 'MissionSelectDoor destination remains editable as a level string');
  const { html: hubDoorHtml } = select('30-00', 'HUBtoHUBDoor');
  assert.match(hubDoorHtml, /destination level/, 'HUBtoHUBDoor string is identified as a destination level');
}

console.log('PASS MusicStart selectors map volume-local integers to named cue strings');
console.log('PASS WAVE/WAVS SoundPlayer pointers stay distinct from AMPC music banks');
console.log('PASS float, angle, and boolean script-typed register controls render');
console.log('PASS RanxBlocker belt levels, Sensei mission types/goals/belts, boss belt locks and level destinations render/edit');
