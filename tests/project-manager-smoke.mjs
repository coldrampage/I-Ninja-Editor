import assert from 'node:assert/strict';
import { installProjectManager } from '../js/project-manager.js';

const ids = ['ed_pf','ed_sum','st','ed_save','ed_patch'];
const elements = Object.fromEntries(ids.map(id => [id, {id, textContent:'', value:'', files:[], onclick:null, onchange:null}]));
let project = {app:'ininja-editor', v:1, vol:null, wads:{}};
let refreshes = 0, originalLoads = 0, projectLoadHooks = 0, volReady = false, downloadedText = '';
const Viewer = {
  $: id => elements[id] || null,
  D: [], files: [],
  refresh(){ refreshes++; },
  loadJson: async f => { originalLoads++; return `original:${f.name}`; }
};
const noOp = () => {};
installProjectManager({
  Viewer, EC:{}, IA:{},
  getProject:()=>project, setProject:j=>{project=j;},
  isVol:()=>volReady, getWad:()=>null, volOf:()=>null, getVolName:()=> 'vol', loadedVols:()=>[],
  buildScriptWadsFp:()=>({}), sndPlan:noOp, avlLoad:async()=>{}, avlOk:()=>false, vbase:x=>String(x||'').replace(/\.(vol|avl)$/i,'').toLowerCase(),
  getAvl:()=>null, sourceClass:()=>null, unzero:()=>false,
  onProjectLoaded:()=>{ projectLoadHooks++; }
});

await elements.ed_pf.onchange({target:{files:[{name:'test.json', text:async()=>JSON.stringify({app:'ininja-editor',v:1,wads:{'10-00.LCS':{adds:[{}]}},prefabs:[{id:1,name:'Ranx wave',from:{w:'10-00.LCS',i:2}}]})}], value:'x'}});
assert.equal(project.wads['10-00.LCS'].mods.constructor, Object);
assert.deepEqual(project.models, {});
assert.deepEqual(project.scripts, {});
assert.deepEqual(project.prefabs, [{id:1,name:'Ranx wave',from:{w:'10-00.LCS',i:2}}], 'project manager retains the project-wide prefab library');
assert.equal(refreshes, 1);
assert.equal(projectLoadHooks, 1, 'project-open callback refreshes dependent project UI');
assert.match(elements.ed_sum.textContent, /project loaded: test\.json/);

const result = await Viewer.loadJson({name:'another.json',text:async()=>JSON.stringify({app:'ininja-editor',v:1,wads:{}})});
assert.equal(result, undefined);
assert.equal(refreshes, 1);
assert.equal(originalLoads, 0);
assert.equal(projectLoadHooks, 2, 'normal file picker also refreshes dependent project UI');

await Viewer.loadJson({name:'script-info.json',text:async()=>JSON.stringify({classes:{},levels:{}})});
assert.equal(originalLoads, 1);

elements.ed_save.onclick();
assert.match(elements.ed_sum.textContent, /save failed: load a \.vol first/);
const oldError = console.error; console.error = () => {};
await elements.ed_patch.onclick();
console.error = oldError;
assert.match(elements.ed_sum.textContent, /patch failed: load the original \.vol first/);

console.log('PASS project manager module imports and installs');
console.log('PASS editor project file picker loads and normalizes project state');
console.log('PASS viewer JSON loader intercepts editor projects and preserves script-info loading');
console.log('PASS save/build guards report missing base volume without side effects');


const legacyProject = { app: 'ininja-editor', v: 1, wads: {} };
await elements.ed_pf.onchange({target:{
  files:[{name:'legacy.json',text:async()=>JSON.stringify(legacyProject)}],value:'x'
}});
assert.deepEqual(project.prefabs, [], 'older projects without a prefab library normalize to an empty library');
assert.equal(projectLoadHooks, 3, 'legacy project open refreshes dependent project UI');


// Verify the project download payload includes the cross-level favourites library.
const savedProject = { ...project, prefabs: [
  { id: 2, name: 'Ranx shield', from: { w: '10-00.LCS', i: 12 }, includeLinked: true }
] };
project = savedProject;
globalThis.document = { createElement: () => ({ click() {} }) };
globalThis.Blob = class {
  constructor(parts) { downloadedText = parts.join(''); }
};
globalThis.URL = { createObjectURL: () => 'blob:test', revokeObjectURL() {} };
globalThis.setTimeout = callback => { callback(); return 0; };
volReady = true;
elements.ed_save.onclick();
const exportedProject = JSON.parse(downloadedText);
assert.deepEqual(exportedProject.prefabs, savedProject.prefabs, 'Save project JSON includes the prefab favourites library');
assert.match(elements.ed_sum.textContent, /1 prefab favourite/);

console.log('PASS project save payload includes the prefab favourites library');
