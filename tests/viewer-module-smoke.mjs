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
const ctx={clearRect(){},stroke(){},beginPath(){},arc(){},moveTo(){},lineTo(){},fillRect(){},fillText(){},measureText(){return{width:1}}};
const elements=new Map();
function el(id){if(!elements.has(id))elements.set(id,{id,style:{},dataset:{},classList:{toggle(){},add(){},remove(){}},checked:false,value:'',disabled:false,innerHTML:'',textContent:'',width:0,height:0,options:[],selectedOptions:[],children:[],addEventListener(){},getContext(){return ctx},querySelectorAll(){return[]},querySelector(){return null},appendChild(){},closest(){return null}});return elements.get(id);}
globalThis.document={getElementById:el,querySelectorAll(){return[]},addEventListener(){},createElement(){return el('script')},head:{appendChild(){} }};
const viewer = await import('../js/viewer.js');
viewer.exposeViewerGlobals(globalThis);
const required=['files','levels','D','all','SCR','sel','show','need','camera','root','cv','V3','ggame','buildEnts','refresh','scr','inspect','openFiles','loadJson','scrDetail','scrIx','scrSel','scrVar','addVolumes','nearest','labels','goto_'];
const missing=required.filter(k=>!(k in globalThis));
if(missing.length)throw new Error('Missing legacy bridge bindings: '+missing.join(', '));
vm.runInThisContext("files = [{name:'bridge-check'}]; sel = {test:true}; refresh = () => 42;");
if(globalThis.files[0].name!=='bridge-check')throw new Error('files identifier setter failed');
if(!globalThis.sel.test)throw new Error('sel identifier setter failed');
if(globalThis.refresh()!==42)throw new Error('function identifier setter failed');
console.log('PASS viewer module initialisation');
console.log('PASS legacy bridge names: '+required.length);
console.log('PASS live state and function setters');
