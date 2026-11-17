import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const root = new URL('../', import.meta.url);
const read = p => readFileSync(new URL(p, root), 'utf8');
const html = read('index.html');
const htmlAlias = read('ininja_editor_consolidated_models_v18.html');
const bootstrap = read('js/bootstrap.js');
const ui = read('js/editor-ui.js');
const prefabs = read('js/prefabs.js');

assert.match(html, /js\/bootstrap\.js\?v=step43-native-layer-uv/, 'index.html requests versioned bootstrap');
assert.match(htmlAlias, /js\/bootstrap\.js\?v=step43-native-layer-uv/, 'consolidated HTML alias requests versioned bootstrap');
assert.match(html, /#ed_sel \.regdata/, 'index.html includes linked-register editor styles');
assert.match(html, /button\[data-sound-preview\]/, 'index.html styles the new audio preview controls');
assert.match(htmlAlias, /#ed_sel \.regdata/, 'consolidated HTML alias includes linked-register editor styles');
assert.match(htmlAlias, /button\[data-sound-preview\]/, 'consolidated HTML alias styles the new audio preview controls');
assert.match(bootstrap, /import\(\'\.\/editor-ui\.js\?v=step43-native-layer-uv\'\)/, 'bootstrap imports a versioned coordinator');
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

assert.match(ui, /import \{ installPrefabManager \} from '\.\/prefabs\.js\?v=step39-enemy-generator-links'/, 'coordinator imports the prefab module');
assert.match(ui, /installPrefabManager\(\{[\s\S]{0,500}getWad/, 'coordinator injects archive lookup into Prefabs');
assert.match(prefabs, /export function installPrefabManager/, 'prefab installer is an exported ES-module API');
console.log('Prefab-module deployment smoke test passed.');

assert.match(ui, /import \{ installProjectManager \} from '\.\/project-manager\.js\?v=step38-music-preview-replacement'/, 'coordinator imports the updated project manager with a cache key');

assert.match(ui, /editor-core\.js\?v=step43-native-layer-uv/, 'coordinator imports updated editor core');
assert.match(ui, /vol-core\.js\?v=step43-native-layer-uv/, 'coordinator imports the updated register parser');
assert.match(ui, /viewer\.js\?v=step43-native-layer-uv/, 'coordinator imports the updated viewer');
assert.match(ui, /entity-editor\.js\?v=step39-enemy-generator-links/, 'coordinator imports the updated entity editor');
assert.match(read('js/entity-editor.js'), /audio-preview\.js\?v=step38-music-preview-replacement/, 'entity editor imports the Xbox ADPCM preview decoder');
assert.match(read('js/editor-ui.js'), /AVL_CACHE_LIMIT=192\*1024\*1024/, 'full AVL working buffers use a bounded in-memory LRU cache');
assert.match(read('js/editor-ui.js'), /addEventListener\('pagehide',clearAvlCache/, 'loaded AVL buffers are released on pagehide');
assert.match(read('js/project-manager.js'), /const pcaData = new Map\(\)/, 'build copies only the needed PCA streams into temporary memory');
assert.match(read('js/project-manager.js'), /musicAssets:wads\[w\] && wads\[w\]\.music \|\| \{\}/, 'project music replacement mappings are passed into the LCS patcher');
assert.match(read('js/entity-editor.js'), /previewCacheLimit = 64 \* 1024 \* 1024/, 'decoded audio preview cache has a 64 MiB limit');
assert.match(read('js/entity-editor.js'), /maxSeconds = isMusic \? 300 : 180/, 'music preview supports up to five minutes while sound previews keep the three-minute limit');
assert.match(read('js/entity-editor.js'), /data-music-import/, 'MusicPlayerBank exposes music replacement controls');
assert.match(read('js/entity-editor.js'), /function pruneUnusedAudioAssets\(/, 'unused imported audio assets are pruned from project RAM');
assert.match(ui, /function getAudioPca\(/, 'coordinator exposes the paired PCA stream to audio previews');
assert.match(ui, /getAudioPca,setTriggerOverlayRender/, 'coordinator injects PCA access into the entity inspector');
assert.match(ui, /models-panel\.js\?v=step43-native-layer-uv/, 'model panel is reloaded to share the updated viewer instance');
const modelPanel = read('js/models-panel.js');
assert.match(modelPanel, /viewer\.js\?v=step43-native-layer-uv/, 'Models panel imports the exact same versioned Viewer instance as the coordinator');
assert.match(readFileSync(new URL('../js/entity-editor.js', import.meta.url), 'utf8'), /trigger-editor\.js\?v=step16-cylinder-resize/, 'entity editor imports trigger editor');
console.log('Trigger editor deployment cache smoke test passed.');

assert.match(ui, /viewer\.js\?v=step43-native-layer-uv/, 'coordinator imports the waypoint overlay Viewer');
assert.match(ui, /setPathOverlayRender/, 'coordinator injects the waypoint path overlay callback');
assert.match(read('js/entity-editor.js'), /path-editor\.js\?v=step43-native-layer-uv/, 'entity editor imports the waypoint path module');
assert.match(read('js/models-panel.js'), /viewer\.js\?v=step43-native-layer-uv/, 'Models panel shares the waypoint overlay Viewer instance');
console.log('Waypoint path module deployment cache test passed.');
