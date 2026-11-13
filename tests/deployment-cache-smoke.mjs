import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const root = new URL('../', import.meta.url);
const read = p => readFileSync(new URL(p, root), 'utf8');
const html = read('index.html');
const htmlAlias = read('ininja_editor_consolidated_models_v18.html');
const bootstrap = read('js/bootstrap.js');
const ui = read('js/editor-ui.js');
const prefabs = read('js/prefabs.js');

assert.match(html, /js\/bootstrap\.js\?v=step15-trigger-editor/, 'index.html requests versioned bootstrap');
assert.match(htmlAlias, /js\/bootstrap\.js\?v=step15-trigger-editor/, 'consolidated HTML alias requests versioned bootstrap');
assert.match(bootstrap, /import\(\'\.\/editor-ui\.js\?v=step15-trigger-editor\'\)/, 'bootstrap imports a versioned coordinator');
assert.match(ui, /const\s+getWad\s*=\s*w\s*=>/, 'coordinator defines getWad');
assert.match(ui, /installModelEditor\(\{[\s\S]{0,400}getWad/, 'getWad is injected into Models');
assert.match(ui, /installScriptEditor\(\{[\s\S]{0,400}getWad/, 'getWad is injected into Scripts');
assert.match(ui, /installProjectManager\(\{[\s\S]{0,500}getWad/, 'getWad is injected into Project Manager');
assert.match(ui, /installEntityEditor\(\{[\s\S]{0,400}getWad/, 'getWad is injected into Entity Editor');
assert.match(ui, /function\s+summary\s*\(\)\s*\{/, 'coordinator defines summary');
assert.match(ui, /function\s+rmList\s*\(\)\s*\{/, 'coordinator defines rmList');
assert.match(ui, /installModelEditor\(\{[\s\S]{0,400}summary/, 'summary is injected into Models');
assert.match(ui, /installEntityEditor\(\{[\s\S]{0,400}summary,\s*rmList/, 'summary and rmList are injected into Entity Editor');
console.log('Deployment cache smoke test passed.');

assert.match(ui, /import \{ installPrefabManager \} from '\.\/prefabs\.js\?v=step15-trigger-editor'/, 'coordinator imports the prefab module');
assert.match(ui, /installPrefabManager\(\{[\s\S]{0,500}getWad/, 'coordinator injects archive lookup into Prefabs');
assert.match(prefabs, /export function installPrefabManager/, 'prefab installer is an exported ES-module API');
console.log('Prefab-module deployment smoke test passed.');

assert.match(ui, /import \{ installProjectManager \} from '\.\/project-manager\.js\?v=step14-camera-source-variants'/, 'coordinator imports the updated project manager with a cache key');

assert.match(ui, /editor-core\.js\?v=step15-trigger-editor/, 'coordinator imports updated editor core');
assert.match(ui, /viewer\.js\?v=step15-trigger-editor/, 'coordinator imports the updated viewer');
assert.match(ui, /entity-editor\.js\?v=step15-trigger-editor/, 'coordinator imports the updated entity editor');
assert.match(ui, /models-panel\.js\?v=step15-trigger-editor/, 'model panel is reloaded to share the updated viewer instance');
const modelPanel = read('js/models-panel.js');
assert.match(modelPanel, /viewer\.js\?v=step15-trigger-editor/, 'Models panel imports the exact same versioned Viewer instance as the coordinator');
assert.match(readFileSync(new URL('../js/entity-editor.js', import.meta.url), 'utf8'), /trigger-editor\.js\?v=step15-trigger-editor/, 'entity editor imports trigger editor');
console.log('Trigger editor deployment cache smoke test passed.');
