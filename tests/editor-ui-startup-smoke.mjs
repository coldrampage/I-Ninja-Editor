// Regression guard for the Step 9 startup failure: the editor controls must
// exist before editor-ui attaches handlers or the feature modules initialise.
import fs from 'node:fs';
import assert from 'node:assert/strict';

const source = fs.readFileSync(new URL('../js/editor-ui.js', import.meta.url), 'utf8');
const prefabs = fs.readFileSync(new URL('../js/prefabs.js', import.meta.url), 'utf8');
const volCore = fs.readFileSync(new URL('../js/vol-core.js', import.meta.url), 'utf8');
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

const prefabInstall = source.indexOf('installPrefabManager({');
const firstPrefabHandler = prefabs.indexOf("Viewer.$('ed_lv').onfocus");
const projectManagerInstall = source.indexOf('installProjectManager({');
const entityEditorInstall = source.indexOf('installEntityEditor({');
assert.ok(panelInsert < prefabInstall, 'panel exists before the prefab module installs');
assert.notEqual(firstPrefabHandler, -1, 'prefab module installs the target/class selector handlers');
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
assert.match(source, /installPrefabManager\(\{[^}]*getWad/s, 'Prefab module receives getWad');
assert.match(source, /WC\s*=\s*\{\}/, 'parsed WAD cache is reset when a new volume is opened');
console.log('PASS: cached WAD accessor is defined and injected into all dependent modules');

// Shared status/removal helpers must survive the entity-editor extraction.
assert.match(source, /function\s+summary\s*\(\)\s*\{/, 'coordinator defines summary()');
assert.match(source, /function\s+rmList\s*\(\)\s*\{/, 'coordinator defines rmList()');
assert.match(source, /installModelEditor\(\{[^}]*summary/s, 'Models module receives summary()');
assert.match(source, /installEntityEditor\(\{[^}]*summary,\s*rmList/s, 'Entity Editor receives summary() and rmList()');
console.log('PASS: shared summary and removed-entity services are defined and injected');

// Prefab and linked-child behaviour belongs to prefabs.js, not the coordinator.
assert.match(source, /installPrefabManager\(\{/s, 'coordinator installs the prefab feature module');
assert.match(source, /prefabManager\.resetCaches\(\)/, 'new VOL loads reset prefab caches');
assert.match(source, /prefabManager\.invalidateChecks\(\)/, 'new AVL loads invalidate dependency checks');
assert.match(source, /sourceClass:prefabManager\.sourceClass/, 'Project Manager receives source class lookup from Prefabs');
assert.match(source, /ensureClass:prefabManager\.ensureClass/, 'Entity Editor receives class dependency validation from Prefabs');
assert.doesNotMatch(source, /function\s+(?:spLoad|tryClass|pushAdds|relvInject|linkTree)\s*\(/, 'prefab operations are no longer defined in the coordinator');
assert.match(prefabs, /function\s+pushAdds\s*\(/, 'prefab module owns linked-child copy operation');
assert.match(prefabs, /function\s+injectMoveControl\s*\(/, 'prefab module owns cross-level move control');
console.log('PASS: prefab module boundaries and dependency injection');

// The coordinator must explicitly import every parser helper it injects into the prefab module.
assert.match(source, /import\s*\{[^}]*\binstances\b[^}]*\bfixups\b[^}]*\}\s*from ['\"]\.\/vol-core\.js['\"]/, 'coordinator imports instances and fixups from vol-core');
assert.match(volCore, /export\s*\{[^}]*\binstances\b[^}]*\bfixups\b[^}]*\}/s, 'vol-core exports instances and fixups');
assert.match(source, /installPrefabManager\(\{[^}]*\binstances\s*,\s*fixups/s, 'prefab module receives the imported parser helpers');
console.log('PASS: prefab parser helpers are imported, exported and injected');
