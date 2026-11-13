// Regression guard for the Step 9 startup failure: the editor controls must
// exist before editor-ui attaches handlers or the feature modules initialise.
import fs from 'node:fs';
import assert from 'node:assert/strict';

const source = fs.readFileSync(new URL('../js/editor-ui.js', import.meta.url), 'utf8');
const panelInsert = source.indexOf("Viewer.$('ctl').insertBefore(ui,Viewer.$('ctl').firstChild)");
assert.notEqual(panelInsert, -1, 'editor panel is inserted into #ctl');

const requiredIds = [
  'ed_open', 'ed_save', 'ed_patch', 'ed_md', 'ed_stb', 'ed_pf',
  'ed_sum', 'ed_rm', 'ed_sel', 'ed_lv', 'ed_cl', 'ed_add', 'ed_deep'
];
const markupStart = source.indexOf("const ui=document.createElement('div');ui.id='ed'");
assert.notEqual(markupStart, -1, 'editor panel markup is created');
const markupEnd = panelInsert;
const markup = source.slice(markupStart, markupEnd);
for (const id of requiredIds) {
  assert.match(markup, new RegExp('id=' + id + '(?:\\s|>|\\")'), `panel contains #${id}`);
}

const firstPrefabHandler = source.indexOf("Viewer.$('ed_lv').onfocus");
const projectManagerInstall = source.indexOf('installProjectManager({');
const entityEditorInstall = source.indexOf('installEntityEditor({');
assert.ok(panelInsert < firstPrefabHandler, 'panel exists before prefab handlers attach');
assert.ok(panelInsert < projectManagerInstall, 'panel exists before project manager attaches');
assert.ok(panelInsert < entityEditorInstall, 'panel exists before entity editor installs');

console.log('PASS: editor panel startup smoke test (' + requiredIds.length + ' required controls)');

// Project/archive access must remain defined in the coordinator before it is
// injected into the model, script, project and entity modules.
assert.match(source, /const\s+getWad\s*=\s*w\s*=>/, 'coordinator defines the cached getWad accessor');
assert.match(source, /installModelEditor\(\{[^}]*getWad/s, 'Models module receives getWad');
assert.match(source, /installScriptEditor\(\{[^}]*getWad/s, 'Script editor receives getWad');
assert.match(source, /installProjectManager\(\{Viewer,EC,IA,getProject:\(\)=>PRJ,setProject:j=>\{PRJ=j\},isVol,getWad/, 'Project manager receives getWad');
assert.match(source, /installEntityEditor\(\{[^}]*getWad/s, 'Entity editor receives getWad');
assert.match(source, /WC\s*=\s*\{\}/, 'parsed WAD cache is reset when a new volume is opened');
console.log('PASS: cached WAD accessor is defined and injected into all dependent modules');

// Shared status/removal helpers must survive the entity-editor extraction.
assert.match(source, /function\s+summary\s*\(\)\s*\{/, 'coordinator defines summary()');
assert.match(source, /function\s+rmList\s*\(\)\s*\{/, 'coordinator defines rmList()');
assert.match(source, /installModelEditor\(\{[^}]*summary/s, 'Models module receives summary()');
assert.match(source, /installEntityEditor\(\{[^}]*summary,\s*rmList/s, 'Entity Editor receives summary() and rmList()');
console.log('PASS: shared summary and removed-entity services are defined and injected');
