
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { installEntityEditor } from '../js/entity-editor.js';
import { EC } from '../js/editor-core.js';
import { parseVol, readWad, instances, analyseStrats } from '../js/vol-core.js';

const volPath = process.env.ININJA_TEST_40_VOL;
if (!volPath || !fs.existsSync(volPath)) {
  console.log('SKIP EnemyGenerator linked-slot UI (set ININJA_TEST_40_VOL)');
  process.exit(0);
}
const bytes=fs.readFileSync(volPath),ab=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
const file=parseVol(ab).find(f=>f.name==='40-01.LCS');assert(file);
const [A,B]=readWad(ab,file),ents=instances(A,B).map(e=>({...e,L:'40-01'}));
const gen=ents.find(e=>e?.n==='EnemyGenerator');assert(gen);
assert.equal(gen.params.length,27);
const classes={},si=analyseStrats(A,B,classes);
const siFor = q => {const row=si[q.i];return row?{...row,c:classes[row.k]}:{c:{roles:{}},l:[]}};
const elements=new Map(),fakeButtons=new Map();
const triggerControls=new Map([
  ['#ed_trigger',{open:true,ontoggle:null}],['#ed_tr_type',{value:'1',onchange:null}],
  ['#ed_tr_ox',{value:'0',onchange:null}],['#ed_tr_oy',{value:'0',onchange:null}],['#ed_tr_oz',{value:'0',onchange:null}],
  ['#ed_tr_sx',{value:'4',onchange:null}],['#ed_tr_sy',{value:'4',onchange:null}],['#ed_tr_sz',{value:'4',onchange:null}],
  ['#ed_tr_reset',{onclick:null}],
]);
function element(id){if(!elements.has(id))elements.set(id,{id,value:'',innerHTML:'',textContent:'',dataset:{},style:{},querySelectorAll(selector){if(id!=='ed_sel')return[];const attr=selector==='button[data-lk]'?'data-lk':selector==='button[data-lkr]'?'data-lkr':null;if(!attr)return[];return Array.from(this.innerHTML.matchAll(new RegExp('<button '+attr+'=(\\d+)', 'g')),m=>{const id=attr+':'+m[1];if(!fakeButtons.has(id))fakeButtons.set(id,{dataset:{[attr==='data-lk'?'lk':'lkr']:m[1]},style:{},onclick:null});return fakeButtons.get(id);});},querySelector(selector){return id==='ed_sel'?(triggerControls.get(selector)||null):null;},addEventListener(){},insertAdjacentHTML(){}});return elements.get(id);}
globalThis.addEventListener=()=>{};globalThis.innerWidth=1200;globalThis.innerHeight=800;globalThis.onmouseup=()=>{};
const level={id:'40-01',ents,nb:ents.length};
const project={app:'ininja-editor',v:1,wads:{}};
const Viewer={D:[level],all:ents,sel:gen,$:element,scr:siFor,col:()=>'#abc',esc:x=>String(x).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'),regTxt:()=>'',buildEnts(){},inspect(){},refresh(){},need:false,cv:{style:{},addEventListener(){}},camera:{position:{y:0,clone(){return this;},addScaledVector(){}}},V3:class{unproject(){return this;}sub(){return this;}normalize(){this.y=1;return this;}},ggame:()=>[0,0,0],mdown:null,drag:null,nearest:()=>null};
const wadCache={'40-01.LCS':{A,B}},base=e=>e.base||(e.base={p:e.p.slice(),b:e.b&&e.b.slice(),poly:e.poly,path:e.path,shape:e.shape,pathbox:e.pathbox,xzOnly:e.xzOnly,r:e.r,q:e.q,pv:e.params.map(p=>p.v)});
const ws={},WS=w=>ws[w]||(ws[w]=project.wads[w]||(project.wads[w]={mods:{},adds:[],del:[]}));
const editor=installEntityEditor({Viewer,EC,getProject:()=>project,wadOf:id=>id+'.LCS',getWad:w=>wadCache[w]||null,WS,base,put(){},unzero:m=>m.d.some(Boolean)||m.dy||m.dp||m.dr||Object.keys(m.regs||{}).length||Object.keys(m.texts||{}).length||Object.keys(m.sounds||{}).length,srcEnt:()=>null,addMaxId:()=>0,ensureClass:()=>null,pushAdds:()=>0,stripLinkRegs(){},summary(){},rmList(){},r3:x=>Math.round(x*1000)/1000});
editor.update();
const html=element('ed_sel').innerHTML;
assert.match(html,/r0 <input[^>]*data-wave-count-k=0[^>]*>/,'R0 is an editable numeric wave-size field');
assert.match(html,/0 spawns all configured enemies at once/,'R0 explains the all-at-once setting');
for(const k of [1,6,7,12,20])assert.match(html,new RegExp('data-lk='+k+'(?: |>)'),`R${k} is available as an enemy link slot`);
assert.doesNotMatch(html,/r20 <input type=number/,'R20 is not exposed as a numeric textbox');
assert.match(html,/enemy slot 20/,'the final supported enemy slot is clearly labelled');
const link20=element('ed_sel').querySelectorAll('button[data-lk]').find(b=>b.dataset.lk==='20');assert(link20&&link20.onclick,'R20 link picker is wired');
const target=ents.find(e=>e?.n==='Ranx');assert(target,'sample enemy target exists');
link20.onclick();
assert.match(element('ed_sel').innerHTML,/r20 <span class=h>enemy slot 20<\/span> <span class=h>empty enemy slot<\/span> <button data-lk=20 style="background:#fa0">click target\.\.\.<\/button>/,'link picker enters target-picking mode');
Viewer.mdown={b:0,x:20,y:20};Viewer.nearest=()=>target;globalThis.onmouseup({clientX:20,clientY:20,target:Viewer.cv});
const projectMod=WS('40-01.LCS').mods[gen.i];assert.equal(projectMod.regs[20],target.i);assert.deepEqual(projectMod.linkRegs,[20],'choosing an existing enemy marks the new register as a link');
Viewer.sel=target;editor.update();const deleteButton=element('ed_del');assert(deleteButton.onclick,'delete control is wired');deleteButton.onclick();
assert.match(element('ed_sum').textContent,new RegExp('#'+gen.i+' r20 link to it'),'manual EnemyGenerator links block deletion of their target');
assert.deepEqual(WS('40-01.LCS').del,[],'a referenced target is not marked for deletion');
Viewer.sel=gen;editor.update();
const reset20=element('ed_sel').querySelectorAll('button[data-lkr]').find(b=>b.dataset.lkr==='20');assert(reset20&&reset20.onclick,'reset control is wired');reset20.onclick();
assert.equal(projectMod.regs[20],undefined);assert.deepEqual(projectMod.linkRegs,[],'reset removes the newly-added link metadata');
console.log('PASS EnemyGenerator displays R0 wave size and link pickers for every optional enemy slot R1–R20');
console.log('PASS choosing an enemy and resetting an added slot updates the project link metadata');
