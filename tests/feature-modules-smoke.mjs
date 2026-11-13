import assert from 'node:assert/strict';

class Vector3 {
  constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;}
  set(x,y,z){this.x=x;this.y=y;this.z=z;return this;}
  normalize(){return this;}
  clone(){return new Vector3(this.x,this.y,this.z);}
  add(){return this;} addScaledVector(){return this;} sub(){return this;}
  crossVectors(){return this;} project(){return this;} unproject(){return this;}
  distanceTo(){return 0;} copy(v){this.x=v.x;this.y=v.y;this.z=v.z;return this;}
}
class Group {
  constructor(){this.children=[];this.scale={x:1,y:1,z:1};this.userData={};this.parent=null;}
  add(o){this.children.push(o);o.parent=this;}
  remove(o){this.children=this.children.filter(x=>x!==o);o.parent=null;}
  traverse(fn){fn(this);for(const c of this.children)fn(c);}
}
class Color { constructor(v){this.value=v;} setHSL(){} setScalar(){} }
class Renderer { constructor({canvas}){this.canvas=canvas;} setPixelRatio(){} setSize(){} render(){} }
class Scene extends Group {}
class Camera { constructor(){this.position=new Vector3();this.rotation={order:'',set(){}};this.aspect=1;} lookAt(){} updateProjectionMatrix(){} }
class Plane { constructor(normal,constant){this.normal=normal;this.constant=constant;} }
const THREE={Vector3,Group,Color,Scene,WebGLRenderer:Renderer,PerspectiveCamera:Camera,Plane};
globalThis.window=globalThis;
globalThis.THREE=THREE;
globalThis.devicePixelRatio=1;globalThis.innerWidth=1200;globalThis.innerHeight=800;
globalThis.addEventListener=()=>{};globalThis.requestAnimationFrame=()=>1;
globalThis.performance={now:()=>0};
const ctx={clearRect(){},stroke(){},beginPath(){},arc(){},moveTo(){},lineTo(){},fillRect(){},fillText(){},measureText(){return{width:1}}};
const elements=new Map();
function el(id){
  if(!elements.has(id))elements.set(id,{id,style:{},dataset:{},classList:{toggle(){},add(){},remove(){}},checked:false,value:'',disabled:false,innerHTML:'',textContent:'',width:340,height:240,options:[],selectedOptions:[],children:[],addEventListener(){},appendChild(){},insertedHTML:'',insertAdjacentHTML(_where,html){this.insertedHTML+=html},querySelectorAll(){return[]},querySelector(){return null},getContext(){return ctx}});
  return elements.get(id);
}
globalThis.document={getElementById:el,querySelectorAll(){return[]},addEventListener(){},createElement(tag){return el('created-'+tag+'-'+elements.size)},body:{appendChild(){}}};

const {Viewer}=await import('../js/viewer.js');
const {installModelEditor}=await import('../js/models-panel.js');
const {installScriptEditor}=await import('../js/script-editor.js');
assert.equal(typeof installModelEditor,'function');
assert.equal(typeof installScriptEditor,'function');

let project={app:'ininja-editor',v:1,wads:{},models:{},scripts:{}};
const modelEditor=installModelEditor({
  Viewer,THREE,EC:{parseModels(){return[]}},getProject:()=>project,
  getWad:()=>null,wadOf:()=>null,summary:()=>{}
});
assert.equal(typeof modelEditor.resetCaches,'function');
modelEditor.resetCaches();

let openFilesCalls=0,scrDetailCalls=0;
Viewer.openFiles=async files=>{openFilesCalls++;return files;};
Viewer.scrDetail=()=>{scrDetailCalls++;};
const scriptEditor=installScriptEditor({
  Viewer,IA:{},EC:{fnv(bytes){return 'hash-'+bytes.length}},
  getWad:()=>({A:new Uint8Array(3),B:new Uint8Array(5)}),
  wadOf:level=>level+'.LCS',isVol:()=>false,
  volOf:()=>null,getVolName:()=> '10.vol',getProject:()=>project
});
assert.equal(typeof scriptEditor.scriptWadsFp,'function');
assert.deepEqual(scriptEditor.scriptWadsFp(),{});
project={app:'ininja-editor',v:1,scripts:{'10-00.LCS':{blocks:{'0x40':'block text'}}}};
assert.deepEqual(scriptEditor.scriptWadsFp(),{'10-00.LCS':{vol:'10.vol',fp:{A:'hash-3',B:'hash-5'},blocks:{'0x40':'block text'}}});
const marker=[{name:'smoke'}];
assert.equal(await Viewer.openFiles(marker),marker);
assert.equal(openFilesCalls,1);
Viewer.scrDetail();
assert.equal(scrDetailCalls,1);

// Exercise the actual assembly-editor render path. This catches missing
// dependencies that an installer-only smoke test would not invoke.
Viewer.scrIx={by:{TestClass:{name:'TestClass',vars:{testVar:{levels:['10-00']}}}}};
Viewer.scrSel='TestClass';
Viewer.scrVar='testVar';
const sdet=el('sdet');
sdet.insertedHTML='';
const loggedErrors=[];
const oldConsoleError=console.error;
console.error=(...args)=>loggedErrors.push(args);
try { Viewer.scrDetail(); } finally { console.error=oldConsoleError; }
assert.equal(loggedErrors.length,0,'script assembly panel should render without scope errors');
assert.match(sdet.insertedHTML,/Edit assembly of this class/,'assembly editor details panel should be inserted');
assert.match(sdet.insertedHTML,/Open the original \.vol first/,'missing source volume guidance should render');

console.log('PASS model panel module imports and installs');
console.log('PASS model panel cache reset API');
console.log('PASS assembly editor module imports and installs');
console.log('PASS assembly editor returns project fingerprint callback');
console.log('PASS assembly editor reads replaced project state through the live getter');
console.log('PASS assembly editor preserves file-open and script-detail hooks');
console.log('PASS assembly editor detail pane renders with explicitly injected wadOf/isVol services');
