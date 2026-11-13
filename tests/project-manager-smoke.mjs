import assert from 'node:assert/strict';
import { installProjectManager } from '../js/project-manager.js';

const ids = ['ed_pf','ed_sum','st','ed_save','ed_patch'];
const elements = Object.fromEntries(ids.map(id => [id, {id, textContent:'', value:'', files:[], onclick:null, onchange:null}]));
let project = {app:'ininja-editor', v:1, vol:null, wads:{}};
let refreshes = 0, originalLoads = 0;
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
  isVol:()=>false, getWad:()=>null, volOf:()=>null, getVolName:()=> 'vol', loadedVols:()=>[],
  buildScriptWadsFp:()=>({}), sndPlan:noOp, avlLoad:async()=>{}, avlOk:()=>false, vbase:x=>String(x||'').replace(/\.(vol|avl)$/i,'').toLowerCase(),
  getAvl:()=>null, sourceClass:()=>null, unzero:()=>false
});

await elements.ed_pf.onchange({target:{files:[{name:'test.json', text:async()=>JSON.stringify({app:'ininja-editor',v:1,wads:{'10-00.LCS':{adds:[{}]}}})}], value:'x'}});
assert.equal(project.wads['10-00.LCS'].mods.constructor, Object);
assert.deepEqual(project.models, {});
assert.deepEqual(project.scripts, {});
assert.equal(refreshes, 1);
assert.match(elements.ed_sum.textContent, /project loaded: test\.json/);

const result = await Viewer.loadJson({name:'another.json',text:async()=>JSON.stringify({app:'ininja-editor',v:1,wads:{}})});
assert.equal(result, undefined);
assert.equal(refreshes, 1);
assert.equal(originalLoads, 0);

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
