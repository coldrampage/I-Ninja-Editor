// ES-module coordinator for the existing editor UI.
// Parser, editor, assembler, and viewer APIs are imported directly.
import {
  parseVol, readWad, r2, siWad, instances, fixups
} from './vol-core.js';
import { EC } from './editor-core.js?v=step22-logturret-name-lookup';
import { IA } from './strat-assembler.js';
import { Viewer, setTriggerOverlayRender, setPathOverlayRender } from './viewer.js?v=step22-logturret-name-lookup';
import { installModelEditor } from './models-panel.js?v=step22-logturret-name-lookup';
import { installScriptEditor } from './script-editor.js';
import { installProjectManager } from './project-manager.js?v=step14-camera-source-variants';
import { installEntityEditor } from './entity-editor.js?v=step22-logturret-name-lookup';
import { installPrefabManager } from './prefabs.js?v=step22-logturret-name-lookup';

// Shared viewer state is accessed only through the imported Viewer API. No viewer
// properties are published on window.


// ---- editor UI: edits live in a project (json); the game files are never modified, a patched copy is built on demand
(()=>{
let PRJ={app:'ininja-editor',v:1,vol:null,wads:{},prefabs:[]},volName='vol',AVLS={},WC={},inR=0;
let resetModelCaches=()=>{},buildScriptWadsFp=()=>({}),edUpdate=()=>{},rec=()=>null,ground=()=>null,srcEnt=()=>null;

// Create the editor panel before installing feature handlers. The entity editor
// owns the live inspector contents, while this coordinator owns the shared
// project/prefab controls; prefabs.js attaches its own handlers after insertion.
const ui=document.createElement('div');ui.id='ed';
ui.innerHTML='<hr><b>Editor</b> <span class=h>edits go in a project file; game files are never touched</span><details style="margin:3px 0"><summary class=h>current scope</summary><div class=h><b>Rotation:</b> yaw, pitch and roll are editable. Yaw turns about world up; pitch (local X) and roll (local Z) are applied on top of the original orientation and shown as changes from it.<br><b>No LCM edits:</b> only .LCS strat data can be edited. The project format is per-wad, so LCM edits can slot in later.</div></details><div style="margin:3px 0"><button id=ed_open>open project</button> <button id=ed_save>save project</button> <button id=ed_patch>build patched .vol</button> <button id=ed_md>models</button> <button id=ed_stb>copier self-test</button></div><input type=file id=ed_pf style=display:none accept=.json><div id=ed_sum class=h></div><div id=ed_rm class=h></div><div id=ed_sel class=h>click an entity to edit it</div>'
  +'<div style="margin-top:4px"><span class=h>add prefab to</span> <select id=ed_lv style="max-width:90px"></select> <select id=ed_cl style="max-width:170px"></select> <button id=ed_add>add</button><br><label class=h title="A spawner links to the objects it spawns. Tick this to copy those objects too, as separate objects that link to each other, so the copy spawns its own set."><input type=checkbox id=ed_deep> also copy the objects it links to</label></div>'
  +'<details id=ed_fav_panel style="margin-top:5px"><summary class=h>Prefab favourites <span id=ed_fav_count>(0)</span></summary>'
  +'<div class=h>Project-wide library. Source .vol/.avl archives are accessed on demand from the game folder.</div>'
  +'<button id=ed_fav_folder title=\"Grant temporary access to the folder containing the game .vol/.avl files\">set source folder</button> <input id=ed_fav_folder_files type=file webkitdirectory multiple hidden>'
  +'<div style="margin:3px 0"><input id=ed_fav_name type=text placeholder="Favourite name" maxlength=80 style="width:125px"> <input id=ed_fav_category type=text placeholder="Category" maxlength=32 style="width:85px"></div>'
  +'<label class=h title="Copy the source instance\'s linked children too and reconnect links between the copies."><input type=checkbox id=ed_fav_links checked> include linked children</label>'
  +'<button id=ed_fav_save>★ Save selected</button>'
  +'<select id=ed_fav_list size=5 style="display:block;width:100%;max-width:240px;margin:3px 0"></select>'
  +'<div><button id=ed_fav_place>place favourite</button> <button id=ed_fav_delete>remove</button></div>'
  +'<div style="margin-top:3px"><button id=ed_fav_export>export library</button> <button id=ed_fav_import>import library</button><input id=ed_fav_file type=file accept=.json style=display:none></div>'
  +'<div id=ed_fav_info class=h style="white-space:pre-wrap;margin-top:3px"></div></details>';
Viewer.$('ctl').insertBefore(ui,Viewer.$('ctl').firstChild);
Viewer.$('ed_fav_folder').onclick=async()=>{try{Viewer.$('ed_fav_info').textContent=await chooseSourceFolder()}catch(e){if(e&&e.name!=='AbortError')Viewer.$('ed_fav_info').textContent='Could not access source folder: '+e}};
Viewer.$('ed_fav_folder_files').onchange=e=>{rememberSourceFolderFiles([...e.target.files]);Viewer.$('ed_fav_info').textContent=sourceFolderFiles.size?'Remembered '+sourceFolderFiles.size+' .vol/.avl file(s) from the selected folder. Missing source archives will be loaded when a favourite is placed.':'No .vol/.avl files found in that folder.';e.target.value=''};
Viewer.$('ed_open').onclick=()=>Viewer.$('ed_pf').click();
const r3=x=>Math.round(x*1000)/1000,wadOf=L=>Viewer.levels[L]&&Viewer.levels[L].LCS?Viewer.levels[L].LCS.name:null,lvOf=w=>w.replace(/\.LCS$/i,'');
const isVol=()=>Viewer.files.some(f=>f.vol&&f.buf&&f.buf.byteLength>16&&new DataView(f.buf).getUint32(0,true)===0x544c4f56);
// Cached parsed LCS access used by prefab/resource checks, model overlays, script editing,
// entity editing and project export. This was accidentally dropped during the Step 9 split.
const getWad=w=>{if(WC[w])return WC[w];const f=Viewer.files.find(x=>x.name===w);if(!f)return null;const[A,B]=readWad(f.buf,f);return WC[w]={A,B,cls:new Set(siWad(A,B).classes.map(c=>c.name))}};
const vbase=n=>String(n||'').replace(/\.(vol|avl)$/i,'').toLowerCase(),volOf=w=>{const f=Viewer.files.find(x=>x.name===w);return f&&f.vol},loadedVols=()=>[...new Set(Viewer.files.filter(f=>f.vol).map(f=>f.vol))];
const avlOk=v=>!!v&&!!AVLS[vbase(v)];
// The browser will not reveal the parent directory of a File selected with the
// ordinary file picker. Keep the File objects returned by a folder selection,
// and use the File System Access API as an on-demand fallback when a favourite
// refers to a volume that was not loaded at startup.
let sourceDirectoryHandle=null,sourceFolderFiles=new Map();
const archiveName=s=>String(s||'').split('/').pop().toLowerCase();
function rememberSourceFolderFiles(list){
 const groups=new Map();
 for(const f of list||[]){
  if(!/\.(vol|avl)$/i.test(f.name))continue;
  const rel=f.webkitRelativePath||f.__relativePath||'';
  if(!rel)continue;
  const dir=rel.includes('/')?rel.slice(0,rel.lastIndexOf('/')):'';
  if(!groups.has(dir))groups.set(dir,new Map());
  groups.get(dir).set(archiveName(f.name),f);
 }
 if(!groups.size)return;
 const best=[...groups.entries()].sort((a,b)=>{
  const count=m=>[...m[1].keys()].filter(n=>n.endsWith('.vol')).length;
  return count(b)-count(a);
 })[0];
 if(best&&best[1].size)sourceFolderFiles=best[1]
}
async function chooseSourceFolder(){
 if(typeof window.showDirectoryPicker==='function'){
  sourceDirectoryHandle=await window.showDirectoryPicker({mode:'read'});
  return 'source folder access granted for this editor session';
 }
 Viewer.$('ed_fav_folder_files').click();
 return 'choose the game folder in the folder picker';
}
async function sourceFolderFile(name){
 const key=archiveName(name);
 if(sourceFolderFiles.has(key))return sourceFolderFiles.get(key);
 if(sourceDirectoryHandle){
  try{
   const exact=await sourceDirectoryHandle.getFileHandle(name,{create:false});
   return await exact.getFile();
  }catch(e){
   for await(const [entryName,entry] of sourceDirectoryHandle.entries()){
    if(entry.kind==='file'&&archiveName(entryName)===key)return await entry.getFile();
   }
  }
 }
 return null;
}
async function sourceFolderVolumes(){
 const out=[...sourceFolderFiles.entries()].filter(([n])=>n.endsWith('.vol')).map(([,f])=>f);
 if(sourceDirectoryHandle){
  for await(const [name,entry] of sourceDirectoryHandle.entries()){
   if(entry.kind==='file'&&/\.vol$/i.test(name)&&!out.some(f=>archiveName(f.name)===archiveName(name)))out.push(await entry.getFile());
  }
 }
 return out;
}
async function registerPairedAvl(volumeName){
 if(!volumeName)return null;
 const key=vbase(volumeName);if(AVLS[key])return AVLS[key];
 const file=await sourceFolderFile(key+'.avl');
 if(!file)return null;
 return AVLS[key]={file,name:file.name,buf:null,list:null};
}
async function locateVolumeForWad(wadName,preferredVolume){
 const preferred=preferredVolume||String(wadName).split('-')[0]+'.vol';
 let file=await sourceFolderFile(preferred);
 if(file){
  try{
   const ab=await file.arrayBuffer(),entries=parseVol(ab);
   if(entries.some(e=>e.name.toLowerCase()===wadName.toLowerCase()))return {file,ab};
  }catch(e){}
 }
 // Imported favourites can predate the saved volume field, or use a custom
 // archive name. Scan the selected folder's VOL directory table before reading
 // the matching archive into the viewer.
 for(const candidate of await sourceFolderVolumes()){
  if(file&&archiveName(candidate.name)===archiveName(file.name))continue;
  const ab=await candidate.arrayBuffer();
  try{if(parseVol(ab).some(e=>e.name.toLowerCase()===wadName.toLowerCase()))return {file:candidate,ab}}catch(e){}
 }
 return null;
}
async function ensureSourceArchives(favorite,{targetW}={}){
 const nodes=Array.isArray(favorite.nodes)&&favorite.nodes.length?favorite.nodes:[{from:favorite.from,vol:favorite.vol}];
 const wants=new Map();
 for(const n of nodes){if(n&&n.from&&n.from.w)wants.set(n.from.w,n.vol||favorite.vol||null)}
 if(targetW){const tf=Viewer.files.find(f=>f.name.toLowerCase()===String(targetW).toLowerCase());if(tf&&tf.vol)wants.set(targetW,tf.vol)}
 const missingWad=[...wants].some(([wadName,vol])=>!Viewer.files.some(f=>f.name.toLowerCase()===wadName.toLowerCase()&&(!vol||!f.vol||f.vol.toLowerCase()===vol.toLowerCase())));
 const missingAvl=[...wants].some(([wadName,vol])=>{const f=Viewer.files.find(x=>x.name.toLowerCase()===wadName.toLowerCase()),v=f&&f.vol||vol;return !!v&&!avlOk(v)&&!sourceFolderFiles.has(archiveName(v)+'.avl')});
 // showDirectoryPicker requires transient user activation. Run it before the
 // first await in this function, while the Place button's activation is live.
 if(!sourceDirectoryHandle&&!sourceFolderFiles.size&&(missingWad||missingAvl)&&typeof window.showDirectoryPicker==='function'){
  sourceDirectoryHandle=await window.showDirectoryPicker({mode:'read'});
 }
 for(const [wadName,vol] of wants){
  const already=Viewer.files.some(f=>f.name.toLowerCase()===wadName.toLowerCase()&&(!vol||!f.vol||f.vol.toLowerCase()===vol.toLowerCase()));
  if(!already){
   const found=await locateVolumeForWad(wadName,vol);
   if(!found)throw 'could not find '+(vol||String(wadName).split('-')[0]+'.vol')+' containing '+wadName+'. Use “set source folder” to grant access to the game folder.';
   Viewer.addVolumes([{name:found.file.name,ab:found.ab}]);
   if(!Viewer.files.some(f=>f.name.toLowerCase()===wadName.toLowerCase()&&f.vol&&f.vol.toLowerCase()===found.file.name.toLowerCase()))throw 'loaded '+found.file.name+' but it does not expose '+wadName;
   WC={};prefabManager.resetCaches();resetModelCaches();
  }
  const actual=Viewer.files.find(f=>f.name.toLowerCase()===wadName.toLowerCase());
  const actualVol=actual&&actual.vol||vol;
  await registerPairedAvl(actualVol||vol);
 }
 // If the target VOL was selected manually, its matching AVL may be in the
 // same directory even though it was not selected alongside it.
 if(targetW){const tf=Viewer.files.find(f=>f.name.toLowerCase()===String(targetW).toLowerCase());if(tf&&tf.vol)await registerPairedAvl(tf.vol)}
 prefabManager.invalidateChecks();
}
// the .avl is only read when a patched one has to be built
async function avlLoad(v){const a=AVLS[vbase(v)];if(!a)throw'no '+vbase(v)+'.avl loaded (it holds the sounds of '+v+')';if(!a.buf){a.buf=await a.file.arrayBuffer();a.list=parseVol(a.buf)}return a}
// Sound resources live in the .PCA inside a paired .avl. Both prefab dependency
// checks and patched VOL/AVL export use the same target-level sound plan.
const sndPlan=w=>{if(!avlOk(volOf(w)))return undefined;const f=Viewer.files.find(x=>x.name===w);if(!f)return undefined;const dv=new DataView(f.buf,f.off),p=EC.SoundPlan(dv.getUint32(0x78,true),dv.getUint32(0x7c,true)),add=p.add;p.add=r=>{const sv=volOf(r.w);if(!avlOk(sv))throw'its sounds come from '+r.w+' and need '+vbase(sv)+'.avl loaded';return add(r)};return p};
const WS=w=>{const P=PRJ.wads[w]||(PRJ.wads[w]={vol:volOf(w)||volName,mods:{},adds:[]});P.del=P.del||[];P.classes=P.classes||[];return P};
const qm=(a,b)=>[a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1],a[3]*b[1]-a[0]*b[2]+a[1]*b[3]+a[2]*b[0],a[3]*b[2]+a[0]*b[1]-a[1]*b[0]+a[2]*b[3],a[3]*b[3]-a[0]*b[0]-a[1]*b[1]-a[2]*b[2]];
const base=e=>e.base||(e.base={p:e.p.slice(),b:e.b&&e.b.slice(),poly:e.poly&&e.poly.slice(),path:e.path&&e.path.map(n=>n.slice()),shape:e.shape,pathbox:!!e.pathbox,xzOnly:!!e.xzOnly,r:e.r,q:e.q&&e.q.slice(),pv:e.params.map(p=>p.v)});
function put(e,m){const B=base(e),d=m.d||[0,0,0],dy=m.dy||0,dp=m.dp||0,dr=m.dr||0;e.p=B.p.map((v,k)=>r2(v+d[k]));e.b=B.b&&B.b.map((v,k)=>r2(v+d[k%3]));e.poly=B.poly&&B.poly.map((v,k)=>r2(v+d[k%3]));e.shape=B.shape;e.pathbox=B.pathbox;e.xzOnly=B.xzOnly;
 if(m.trigger){const t=m.trigger;e.shape=t.ty;e.pathbox=false;e.xzOnly=[0,2,5].includes(t.ty);e.b=t.box.map((v,k)=>r2(v+e.p[k%3]));e.poly=t.poly?t.poly.map((v,k)=>r2(v+e.p[k%3])):null}
 e.path=m.path?m.path.map(n=>n.map((v,k)=>r2(v+e.p[k]))):B.path&&B.path.map(n=>n.map((v,k)=>r2(v+d[k])));
 if(e.pathbox&&e.path&&e.path.length>=2){const a=e.path[0],b=e.path[1];e.b=[0,1,2].map(k=>Math.min(a[k],b[k])).concat([0,1,2].map(k=>Math.max(a[k],b[k])));}
 e.r=B.r+dy;if(B.q){const g2=x=>x/4096*2*Math.PI,ay=g2(dy),ap=g2(dp),ar=g2(dr);e.q=qm(qm([0,Math.sin(ay/2),0,Math.cos(ay/2)],B.q),qm([Math.sin(ap/2),0,0,Math.cos(ap/2)],[0,0,Math.sin(ar/2),Math.cos(ar/2)]))}
 e.params=e.params.map((p,k)=>m.regs&&m.regs[k]!==undefined&&!p.s?{...p,v:m.regs[k]>>>0}:{...p,v:B.pv[k]})}
const unzero=m=>m.d.some(x=>x)||m.dy||m.dp||m.dr||Object.keys(m.regs).length||(m.lk&&m.lk.length)||!!m.trigger||!!m.path;
// Shared project status and removed-entity restoration UI. These stayed in the
// coordinator when entity editing moved into entity-editor.js because Models
// and Entity Editor both use them.
function summary(){let m=0,a=0,n=0,r=0;for(const w in PRJ.wads){const x=Object.values(PRJ.wads[w].mods).filter(unzero).length,y=PRJ.wads[w].adds.length,z=(PRJ.wads[w].del||[]).length;m+=x;a+=y;r+=z;if(x||y||z)n++}Viewer.$('ed_sum').textContent=m+' moved/edited, '+a+' added, '+r+' removed in '+n+' level(s)'+(PRJ.prefabs&&PRJ.prefabs.length?', '+PRJ.prefabs.length+' prefab favourite(s)':'')+(Object.keys(PRJ.vols||{}).length>1?' ['+Object.keys(PRJ.vols).join(', ')+']':'')}
function rmList(){const out=[];for(const lv of Viewer.D){const w=wadOf(lv.id),P=w&&PRJ.wads[w];if(!P||!lv.all0)continue;for(const i of P.del||[])if(lv.all0[i])out.push([w,i,lv.all0[i].n,lv.id])}
 Viewer.$('ed_rm').innerHTML=out.length?'removed: '+out.slice(0,12).map(([w,i,n,L])=>L+'#'+i+' '+Viewer.esc(n)+' <a href=# data-w="'+w+'" data-i='+i+'>restore</a>').join(' &middot; ')+(out.length>12?' &hellip;':''):'';
 Viewer.$('ed_rm').querySelectorAll('a').forEach(a=>a.onclick=e=>{e.preventDefault();const P=PRJ.wads[a.dataset.w];P.del=P.del.filter(x=>x!=+a.dataset.i);Viewer.refresh()})}
// re-derive every loaded level from the base data + project (idempotent)
function applyEdits(){for(const lv of Viewer.D){const w=wadOf(lv.id);if(!w)continue;if(!lv.all0){lv.all0=lv.ents.slice();lv.nb=lv.all0.length}
  const orig=lv.all0,P=PRJ.wads[w],del=new Set(P&&P.del||[]);for(const e of orig){if(e.base)put(e,{})}
  if(P)for(const[k,m]of Object.entries(P.mods)){const e=orig[+k];if(e&&e.i==+k)put(e,m)}
  lv.ents=orig.filter(e=>!del.has(e.i));
  if(P)P.adds.forEach((a,k)=>{
   // A prefab can come from any LCS in the loaded VOL, including a level that
   // has not been opened in the 3D viewer. Analyse both ends before trying to
   // attach script/register metadata to the newly added instance.
   const srcLevel=lvOf(a.from.w);
   if(typeof Viewer.analyseLevel==='function'){
    Viewer.analyseLevel(srcLevel);
    Viewer.analyseLevel(lv.id);
   }
   const s=srcEnt(a);if(!s)return;const B=base(s),e={...s,params:s.params.map(p=>({...p})),i:lv.nb+k,added:k+1,base:{...B}};
   put(e,{d:a.p.map((v,j)=>v-B.p[j]),dy:a.dy||0,dp:a.dp||0,dr:a.dr||0,regs:a.regs,trigger:a.trigger,path:a.path});lv.ents.push(e);
   const sl=Viewer.SCR.levels[srcLevel],tl=Viewer.SCR.levels[lv.id];
   if(sl&&sl[s.i]&&tl)tl[e.i]=linkView(lv,P,sl[s.i],a,srcLevel===lv.id,true)
  });
  // moved originals: links changed by hand
  const SL=Viewer.SCR.levels[lv.id];if(SL){lv.scr0=lv.scr0||{};for(const k in lv.scr0)SL[k]=lv.scr0[k];
   if(P)for(const[k,m]of Object.entries(P.mods)){const x=SL[k];if(!x||!((m.lk&&m.lk.length)||Object.keys(m.regs||{}).length))continue;if(!(k in lv.scr0))lv.scr0[k]=x;SL[k]=linkView(lv,P,x,m,true,false)}}}}
// script info of an object with its hand-made links applied: lk = to added objects (by id), regs = to originals (by number); a copied add from ANOTHER level has no valid links of its own
function linkView(lv,P,x,a,sameLevel,isAdd){const y={...x,r:(x.r||[]).slice(),l:sameLevel||!isAdd?x.l.map(q=>q.slice()):x.l.map(q=>[q[0],-1])},set=(rg,v)=>{const q=y.l.find(z=>z[0]==rg);if(q)q[1]=v;else y.l.push([rg,v]);y.r[rg]=v};
 for(const[rg,v]of Object.entries(a.regs||{}))if(x.l.some(q=>q[0]==rg))set(+rg,v>>>0);
 for(const[rg,cid]of(a.lk||[])){const n=P.adds.findIndex(z=>z.id===cid);if(n>=0)set(+rg,lv.nb+n)}
 return y}
const orf=Viewer.refresh;Viewer.refresh=()=>{if(!inR){inR=1;try{applyEdits()}finally{inR=0}}orf();edUpdate()};
// remember the volume's file name; accept project .json through the normal file picker / drop
const oof=Viewer.openFiles;Viewer.openFiles=async fs=>{fs=[...fs];rememberSourceFolderFiles(fs);
 // .avl files are paired with the .vol of the same name (10.avl <-> 10.vol); they are only read when a build needs them
 const avls=fs.filter(f=>/\.avl$/i.test(f.name));for(const a of avls)AVLS[vbase(a.name)]={file:a,name:a.name,buf:null,list:null};if(avls.length)prefabManager.invalidateChecks();
 fs=fs.filter(f=>!avls.includes(f));
 const vs=fs.filter(f=>/\.vol$/i.test(f.name));
 if(vs.length){WC={};prefabManager.resetCaches();resetModelCaches();const vols=[];
  for(const v of vs){Viewer.$('st').textContent='reading '+v.name+' ('+(vols.length+1)+'/'+vs.length+')...';await new Promise(r=>setTimeout(r));vols.push({name:v.name,ab:await v.arrayBuffer()})}
  const dup=Viewer.addVolumes(vols);volName=vs[vs.length-1].name;fs=fs.filter(f=>!vs.includes(f)&&!/\.(lcs|lcm|xbm|xbs)$/i.test(f.name));
  if(dup.length)Viewer.$('st').textContent+='\nskipped duplicate file names (already in another volume): '+dup.slice(0,6).join(', ')+(dup.length>6?', ...':'')}
 if(vs.length||avls.length){const t=Viewer.$('ed_sum');if(t){const L=loadedVols();t.textContent='volumes: '+(L.map(v=>v+' ('+(avlOk(v)?vbase(v)+'.avl found':'no '+vbase(v)+'.avl: sounds of its levels cannot be copied')+')').join(', ')||'none')+(avls.some(a=>!L.some(v=>vbase(v)===vbase(a.name)))?'. Waiting for the .vol that goes with '+avls.filter(a=>!L.some(v=>vbase(v)===vbase(a.name))).map(a=>a.name).join(', '):'')}}
 return fs.length?oof(fs):undefined};
const oi=Viewer.inspect;Viewer.inspect=q=>{oi(q);edUpdate()};

// Install the separate Models feature after shared project services are ready.
const modelEditor=installModelEditor({Viewer,THREE:globalThis.THREE,EC,getProject:()=>PRJ,getWad,wadOf,summary});
resetModelCaches=modelEditor.resetCaches;

// Prefab discovery, dependency checks, deep linked-object copying and cross-level
// movement live in their own module. Entity callbacks are closures because the
// entity editor is installed immediately below and owns the live inspector state.
const prefabManager=installPrefabManager({
  Viewer,EC,getProject:()=>PRJ,wadOf,getWad,readWad,instances,fixups,siWad,
  volOf,avlOk,vbase,WS,r3,sndPlan,summary,
  getGround:()=>ground,
  getEntityRecord:()=>Viewer.sel&&rec(Viewer.sel),
  ensureSourceArchives,
  updateEntity:()=>edUpdate()
});
srcEnt=prefabManager.srcEnt;

// ---- self-test of the data-object copier on the loaded volume (read-only)
Viewer.$('ed_stb').onclick=async()=>{try{if(!isVol())throw'load a .vol first';const ws=Viewer.files.filter(f=>/^\d+-\d+\.LCS$/i.test(f.name)),wads=[];
  for(const f of ws){Viewer.$('ed_sum').textContent='self-test: reading '+f.name+' ('+(wads.length+1)+'/'+ws.length+')...';await new Promise(r=>setTimeout(r));const[A,B]=readWad(f.buf,f);wads.push({name:f.name,A,B})}
  Viewer.$('ed_sum').textContent='self-test: copying class data between levels...';await new Promise(r=>setTimeout(r));const r=EC.copierSelfTest(wads);console.log('copier self-test',r);
  Viewer.$('ed_sum').textContent='copier self-test ('+loadedVols().join(', ')+'): '+r.copied+' of '+r.pairs+' class pairs copied between levels; copy identical to its source '+r.copyEqualsSource+'/'+r.copied+'; same structure as the target level\'s own copy '+r.copyStructEqualsTarget+'/'+r.copied+'; patched wad well-formed '+r.valid+'/'+r.copied+'. Levels whose data differ cannot be paired: '+(r.pairs-r.copied)+'.';
  let rp=Viewer.$('ed_rep');if(!rp){prefabManager.showRep();rp=Viewer.$('ed_rep')}rp.textContent=Object.entries(r.errors).map(([k,n])=>n+' x '+k).concat(r.bad).join('\n');rp.style.whiteSpace='pre-wrap'}catch(x){Viewer.$('ed_sum').textContent='self-test failed: '+x;console.error(x)}};
// The Scripts-tab assembly editor owns code-edit UI and project fingerprint generation.
buildScriptWadsFp=installScriptEditor({Viewer,IA,EC,getWad,wadOf,isVol,volOf,getVolName:()=>volName,getProject:()=>PRJ}).scriptWadsFp;

// Project open/save and VOL/AVL patching are handled by their own module.
const projectManager=installProjectManager({Viewer,EC,IA,getProject:()=>PRJ,setProject:j=>{PRJ=j},isVol,getWad,volOf,getVolName:()=>volName,loadedVols,buildScriptWadsFp,sndPlan,avlLoad,avlOk,vbase,getAvl:v=>AVLS[vbase(v)],sourceClass:prefabManager.sourceClass,unzero,onProjectLoaded:()=>prefabManager.renderFavorites(false)});

const entityEditor=installEntityEditor({
  Viewer,EC,getProject:()=>PRJ,wadOf,getWad,WS,base,put,unzero,srcEnt,
  addMaxId:prefabManager.addMaxId,ensureClass:prefabManager.ensureClass,pushAdds:prefabManager.pushAdds,stripLinkRegs:prefabManager.stripLinkRegs,summary,rmList,r3,setTriggerOverlayRender,setPathOverlayRender
});
edUpdate=entityEditor.update;
rec=entityEditor.rec;
ground=entityEditor.ground;
const oeu=edUpdate;edUpdate=function(){oeu();try{prefabManager.injectMoveControl()}catch(e){console.error(e)}};
edUpdate();
// objects added from another level take their script info from the object they were copied from
const oscr=Viewer.scr;Viewer.scr=function(e){const x=oscr(e);if(x||!e.added||!Viewer.SCR)return x;const w=wadOf(e.L),a=w&&((PRJ.wads[w]||{}).adds||[])[e.added-1];if(!a)return null;const L2=lvOf(a.from.w);if(typeof Viewer.analyseLevel==='function')Viewer.analyseLevel(L2);const y=Viewer.SCR.levels[L2]&&Viewer.SCR.levels[L2][a.from.i];if(!y)return null;const c=Viewer.SCR.classes[y.k];return c?{c,r:y.r,l:y.l}:null};

})();

