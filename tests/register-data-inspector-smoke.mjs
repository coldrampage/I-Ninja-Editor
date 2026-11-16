import assert from 'node:assert/strict';
import fs from 'node:fs';
import { installEntityEditor } from '../js/entity-editor.js';
import { EC } from '../js/editor-core.js';
import { parseVol, readWad, instances } from '../js/vol-core.js';

const volPath = process.env.ININJA_TEST_30_VOL;
if (!volPath || !fs.existsSync(volPath)) {
  console.log('SKIP register data inspector UI (set ININJA_TEST_30_VOL)');
  process.exit(0);
}
const bytes = fs.readFileSync(volPath), ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const lcs = parseVol(ab).find(f => f.name === '30-00.LCS');
assert(lcs, '30-00.LCS exists');
const [A, B] = readWad(ab, lcs), rawEntities = instances(A, B);
const ents = rawEntities.map(e => ({ ...e, L: '30-00' }));
const byName = name => ents.find(e => e.n === name);
assert(byName('Sensei_Intro') && byName('PlantLilly'), 'sample instances are present');

const elements = new Map();
const triggerControls = new Map([
  ['#ed_trigger', { open: true, ontoggle: null }], ['#ed_tr_type', { value: '1', onchange: null }],
  ['#ed_tr_ox', { value: '0', onchange: null }], ['#ed_tr_oy', { value: '0', onchange: null }], ['#ed_tr_oz', { value: '0', onchange: null }],
  ['#ed_tr_sx', { value: '4', onchange: null }], ['#ed_tr_sy', { value: '4', onchange: null }], ['#ed_tr_sz', { value: '4', onchange: null }],
  ['#ed_tr_reset', { onclick: null }],
]);
function element(id) {
  if (!elements.has(id)) elements.set(id, {
    id, value: '', innerHTML: '', textContent: '', dataset: {}, style: {},
    querySelectorAll() { return []; }, querySelector(selector) { return id === 'ed_sel' ? (triggerControls.get(selector) || null) : null; },
    addEventListener() {}, insertAdjacentHTML() {},
  });
  return elements.get(id);
}
globalThis.addEventListener = () => {};
globalThis.innerWidth = 1200; globalThis.innerHeight = 800; globalThis.onmouseup = () => {};
const level = { id: '30-00', ents, nb: ents.length };
const project = { app: 'ininja-editor', v: 1, wads: {} };
const Viewer = {
  D: [level], all: ents, sel: byName('Sensei_Intro'), $: element,
  scr(e) { return { c: { roles: e.n === 'PlantLilly' || e.n === 'PlantFlowers' ? { 1: { ty: 'f', note: 'scale' } } : {} }, l: [] }; },
  col: () => '#abc', esc: x => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'), regTxt: () => '',
  buildEnts() {}, inspect() {}, refresh() {}, need: false, cv: { style: {}, addEventListener() {} },
  camera: { position: { y: 0, clone() { return this; }, addScaledVector() {} } },
  V3: class { unproject() { return this; } sub() { return this; } normalize() { this.y = 1; return this; } },
  ggame: () => [0, 0, 0], mdown: null, drag: null, nearest: () => null,
};
const wadCache = { '30-00.LCS': { A, B } };
const base = e => e.base || (e.base = { p: e.p.slice(), b: e.b && e.b.slice(), poly: e.poly, path: e.path, shape: e.shape, pathbox: e.pathbox, xzOnly: e.xzOnly, r: e.r, q: e.q, pv: e.params.map(p => p.v) });
const put = () => {};
const ws = {};
const WS = w => ws[w] || (ws[w] = project.wads[w] || (project.wads[w] = { mods: {}, adds: [], del: [] }));
const editor = installEntityEditor({
  Viewer, EC, getProject: () => project, wadOf: id => id + '.LCS', getWad: w => wadCache[w] || null,
  WS, base, put, unzero: m => m.d.some(Boolean) || m.dy || m.dp || m.dr || Object.keys(m.regs || {}).length || Object.keys(m.texts || {}).length || Object.keys(m.sounds || {}).length,
  srcEnt: () => null, addMaxId: () => 0, ensureClass: () => null, pushAdds: () => 0, stripLinkRegs() {}, summary() {}, rmList() {}, r3: x => Math.round(x * 1000) / 1000,
});

editor.update();
let html = element('ed_sel').innerHTML;
assert.match(html, /localised dialogue \/ audio table/, 'Sensei dialogue registers display as linked text/audio tables');
assert.match(html, /data-text-slot=/, 'localised text fields are editable');
assert.match(html, /data-sound-slot=/, 'voice pointers are editable sound links');
assert.match(html, /sen_ForestHUB1_eng_01\.wav/, 'sound dropdown resolves its current sound-bank name');
assert.match(html, /Debug Text On/, 'text-only R3 table is resolved rather than shown as an address');

for (const plantName of ['PlantLilly', 'PlantFlowers']) {
  Viewer.sel = byName(plantName);
  editor.update();
  html = element('ed_sel').innerHTML;
  assert.match(html, /data-float-k="1" value="100"/, `${plantName} R1 displays the inferred float value`);
  assert.doesNotMatch(html, /1120403456/, `${plantName} no longer displays the raw float bit pattern`);
}
console.log('PASS Sensei_Intro exposes editable five-language text and sound links');
console.log('PASS PlantLilly and PlantFlowers R1 display 100.0 as float registers');
