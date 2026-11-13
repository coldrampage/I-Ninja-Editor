import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const root = new URL('../', import.meta.url);
const read = p => readFileSync(new URL(p, root), 'utf8');
const html = read('index.html');
const bootstrap = read('js/bootstrap.js');
const ui = read('js/editor-ui.js');

assert.match(html, /js\/bootstrap\.js\?v=step9d-summary-rmlist-fix/, 'HTML requests versioned bootstrap');
assert.match(bootstrap, /import\(\'\.\/editor-ui\.js\?v=step9d-summary-rmlist-fix\'\)/, 'bootstrap imports a versioned coordinator');
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
