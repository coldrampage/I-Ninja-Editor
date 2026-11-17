// Guard the editor-facing resource inspector wiring without needing a browser DOM.
import assert from 'node:assert/strict';
import fs from 'node:fs';

const panel = fs.readFileSync(new URL('../js/textures-panel.js', import.meta.url), 'utf8');
const tools = fs.readFileSync(new URL('../js/texture-tools.js', import.meta.url), 'utf8');
const core = fs.readFileSync(new URL('../js/vol-core.js', import.meta.url), 'utf8');
assert.match(panel, /listMaterialResources/);
assert.match(panel, /id=tx_res/);
assert.match(panel, /id=tx_res_info/);
assert.match(panel, /function\s+fillResources\s*\(/);
assert.match(panel, /function\s+showResource\s*\(/);
assert.match(panel, /r\.frameOffsets\.forEach/);
assert.match(panel, /picker\.onchange/);
assert.match(panel, /layer\.rawWords\.map\(hex\)/);
assert.match(panel, /axisModeName\(layer\.uMode\)/);
assert.match(panel, /layer\.uFrequency/);
assert.match(panel, /layer\.vFrequency/);
assert.match(tools, /function\s+listMaterialResources\(A, B\)/);
assert.match(core, /function\s+parseMaterialResources\(A,B\)/);
assert.match(core, /materialResources,tris,parts/);
console.log('PASS animated-frame and layered-record inspector is connected to the parsed resource list');
