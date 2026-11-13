import vm from 'node:vm';

class Vector3 {
  constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;}
  set(x,y,z){this.x=x;this.y=y;this.z=z;return this;}
  normalize(){return this;}
  clone(){return new Vector3(this.x,this.y,this.z);}
  add(){return this;} addScaledVector(){return this;} sub(){return this;}
  crossVectors(){return this;} project(){return this;} unproject(){return this;}
  distanceTo(){return 0;} copy(v){this.x=v.x;this.y=v.y;this.z=v.z;return this;}
}
class Color { constructor(v){this.value=v;} setHSL(){} setScalar(){} }
class Group { constructor(){this.children=[];this.scale={x:1,y:1,z:1};this.userData={};this.parent=null;} add(o){this.children.push(o);o.parent=this;} remove(o){this.children=this.children.filter(x=>x!==o);o.parent=null;} traverse(fn){fn(this);for(const c of this.children)fn(c);} }
class Scene extends Group {}
class Camera { constructor(){this.rotation={order:'',set(){}};this.position=new Vector3();this.aspect=1;} updateProjectionMatrix(){} }
class Renderer { constructor({canvas}){this.canvas=canvas;} setPixelRatio(){} setSize(){} render(){} }
class Plane { constructor(n,c){this.normal=n;this.constant=c;} }
const THREE={Vector3,Color,Group,Scene,PerspectiveCamera:Camera,WebGLRenderer:Renderer,Plane};
globalThis.window=globalThis;
globalThis.THREE=THREE;
globalThis.devicePixelRatio=1;globalThis.innerWidth=1200;globalThis.innerHeight=800;
globalThis.addEventListener=()=>{};globalThis.requestAnimationFrame=()=>1;
globalThis.performance={now:()=>0};
// Core/editor/assembler helpers must now come from ES-module imports, not globals.
const forbiddenCoreGlobals=['parseVol','wadName','readWad','instances','analyseStrats','EC','IA'];
for(const name of forbiddenCoreGlobals){
  if(Object.prototype.hasOwnProperty.call(globalThis,name))throw new Error('unexpected core global before viewer import: '+name);
}
const ctx={clearRect(){},stroke(){},beginPath(){},arc(){},moveTo(){},lineTo(){},fillRect(){},fillText(){},measureText(){return{width:1}}};
const elements=new Map();
function el(id){if(!elements.has(id))elements.set(id,{id,style:{},dataset:{},classList:{toggle(){},add(){},remove(){}},checked:false,value:'',disabled:false,innerHTML:'',textContent:'',width:0,height:0,options:[],selectedOptions:[],children:[],addEventListener(type,fn){(this._listeners||(this._listeners={}))[type]=fn},hasAttribute(){return false},getContext(){return ctx},querySelectorAll(){return[]},querySelector(){return null},appendChild(){},closest(){return null}});return elements.get(id);}
globalThis.document={getElementById:el,querySelectorAll(){return[]},addEventListener(){},createElement(){return el('script')},head:{appendChild(){} }};
const viewer = await import('../js/viewer.js');
for(const name of forbiddenCoreGlobals){
  if(Object.prototype.hasOwnProperty.call(globalThis,name))throw new Error('viewer leaked core global: '+name);
}
const globalNames=['$','D','SCR','V3','addVolumes','all','buildEnts','camera','col','cv','drag','esc','files','fwd','ggame','goto_','inspect','labels','levels','loadJson','mdown','mz','nearest','need','openClass','openFiles','pick','pitch','refresh','regTxt','root','scr','scrDetail','scrIx','scrSel','scrVar','sel','show','shown','tab','wrap','yaw'];
const leaked=globalNames.filter(k=>Object.prototype.hasOwnProperty.call(globalThis,k));
if(leaked.length)throw new Error('viewer published global aliases: '+leaked.join(', '));
const api=viewer.Viewer;
if(!api||typeof api.$!=='function'||!api.camera||!api.root)throw new Error('Viewer API is incomplete');
const originalFiles=api.files,originalSel=api.sel,originalRefresh=api.refresh;
api.files=[{name:'api-check'}];api.sel={test:true};api.refresh=()=>42;
if(api.files[0].name!=='api-check')throw new Error('Viewer.files setter failed');
if(!api.sel.test)throw new Error('Viewer.sel setter failed');
if(api.refresh()!==42)throw new Error('Viewer.refresh setter failed');
api.files=originalFiles;api.sel=originalSel;api.refresh=originalRefresh;
let overlayRefreshes=0;
if(typeof viewer.setEntityOverlayRefresh!=='function')throw new Error('missing explicit entity overlay refresh hook');
viewer.setEntityOverlayRefresh(()=>{overlayRefreshes++});
api.buildEnts();
if(overlayRefreshes!==1)throw new Error('entity rebuild did not notify the overlay renderer');
viewer.setEntityOverlayRefresh(null);
api.buildEnts();
if(overlayRefreshes!==1)throw new Error('cleared overlay renderer was still called');
const insp=el('insp'),click=insp._listeners?.click;
if(typeof click!=='function')throw new Error('inspector delegated click handler was not installed');
const originalAll=api.all;
const entity={L:'10-00',i:7,n:'navigation-test',p:[1,2,3],r:0};
api.all=[entity];
click({target:{closest(){return{hasAttribute(){return false},dataset:{gotoKey:'10-00#7'}}}}});
if(api.sel!==entity)throw new Error('inspector entity-navigation action failed');
api.sel={id:1};
click({target:{closest(){return{hasAttribute(name){return name==='data-inspector-close'},dataset:{}}}}});
if(api.sel!==null)throw new Error('inspector close action failed');
api.all=originalAll;
console.log('PASS viewer imports core APIs without global parser/editor/assembler bindings');
console.log('PASS Viewer API live state and function accessors');
console.log('PASS no legacy viewer globals published on globalThis');
console.log('PASS entity overlay refresh callback');
console.log('PASS delegated inspector close action');
