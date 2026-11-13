// Models panel: browsing parsed meshes, previewing and assigning 3D overlays.
import { siWad, SiAn } from './vol-core.js';
import { setEntityOverlayRefresh } from './viewer.js?v=step18-waypoint-insert';

export function installModelEditor({Viewer, THREE, EC, getProject, getWad, wadOf, summary}) {
// ---- models: browse the object meshes of any strat wad, assign one to an entity (or a class) so it is drawn in the 3D view; assignments are saved in the project
let MC={},GC={},mgrp=null,mCur=null,mGroupFocus=null;
// The Robot Beach Hub (10-00.LCS) has several independently inspected model ranges.
// Apply these as a small, level-specific ground-truth layer after parsing the native references.
// This does not alter the raw geometry or the generic parser used for other levels.
function applyRobotBeachGroundTruth(L){
 if(!L||L.modelGroundTruthApplied||L.length<177)return L;
 const specs=[
  {id:'rbh:seagull',parts:[88,89],name:'Low-poly seagull',internal:'bird',classes:['Gull','FlockOfGulls'],natives:['Strat_SetModelEx']},
  {id:'rbh:crab',parts:[110,111],name:'Crab',internal:'Leg_L_4',partLabels:{110:'leg',111:'body'},classes:['Crab'],natives:['Strat_SetModelEx']},
  {id:'rbh:yang',parts:Array.from({length:23},(_,i)=>112+i),name:'Yang',internal:'arrelo',classes:['Guardian_Yang'],natives:[]},
  {id:'rbh:yellow-door',parts:[135,136,137,138,139],name:'Mission door — yellow lighting',internal:'Line02',classes:[],natives:['Strat_SetModelEx']},
  {id:'rbh:standard-door',parts:[140,141,142,143,144],name:'Mission door — standard lighting',internal:'Line02',classes:[],natives:['Strat_SetModelEx']},
  {id:'rbh:master-door',parts:[145,146,147,148,149,150,151,152],name:'Mission door — master grade',internal:'Line18',classes:['Robot_HubStartDoor'],natives:['Strat_SetModelEx']},
  {id:'rbh:sensei',parts:Array.from({length:24},(_,i)=>153+i),name:'Sensei',internal:'sensei',classes:['Sensei','Sensei_Intro'],natives:['Strat_SetModelEx']},
  {id:'rbh:kyza-door',parts:[90],name:'Kyza mission door',internal:'roy foot door',classes:[],natives:[]},
  {id:'rbh:robot-eyeball',parts:[91,92,93,94,95],name:'Robot eyeball',internal:'eyeball_latest',classes:['RobotHub_CutsceneBall'],natives:['Strat_SetModelEx']},
  {id:'rbh:robot-heart',parts:Array.from({length:14},(_,i)=>96+i),name:'Robot heart',internal:'heart_new',classes:['RobotHub_CutsceneBall','RobotHub_RobotPiece_Heart'],natives:['Strat_SetModelEx']}
 ];
 const registry=L.modelGroupById instanceof Map?L.modelGroupById:new Map((L.modelGroups||[]).map(g=>[g.id,g]));
 const makePrimary=(M,g,k)=>{M.modelGroup=g.id;M.modelKind=g.kind;M.modelSource=g.source;M.modelName=g.displayName||g.name;M.modelInternalName=g.internalName||g.name;M.modelClasses=g.classes||[];M.modelNatives=g.natives||[];M.modelDescriptor=g.descriptor;M.modelVerified=g.source==='groundtruth';M.modelPartIndex=k+1;M.modelPartCount=g.parts.length;M.modelPartLabel=g.partLabels?.[L.indexOf(M)]||'';M.modelAlsoIn=(M.modelMemberships||[]).filter(id=>id!==g.id);};
 for(const spec of specs){const rows=spec.parts.map(i=>L[i]);if(rows.some(x=>!x))continue;
  const original=L.modelGroups.find(g=>g.parts?.some(p=>p.p===rows[0].poff)&&g.source==='script')||L.modelGroups.find(g=>g.parts?.some(p=>p.p===rows[0].poff));
  const g={id:spec.id,descriptor:original?.descriptor??null,name:spec.name,displayName:spec.name,internalName:spec.internal,partLabels:spec.partLabels||null,kind:'model',source:'groundtruth',confidence:'confirmed',verifiedBy:'user-confirmed 10-00.LCS ranges',classes:spec.classes,natives:spec.natives,roots:original?.roots||[],rootDetails:original?.rootDetails||[],refs:original?.refs||0,parts:rows.map(M=>({m:M.off,p:M.poff})),evidence:rows.map(M=>({p:M.poff,via:'user-confirmed-part-range',partIndex:L.indexOf(M)}))};
  L.modelGroups.push(g);registry.set(g.id,g);
  rows.forEach((M,k)=>{M.modelMemberships=M.modelMemberships||[];if(!M.modelMemberships.includes(g.id))M.modelMemberships.unshift(g.id);makePrimary(M,g,k)});
 }
 // #139: see note below (moved into the yellow door).
 /* #139 now belongs to the yellow door: descriptor chain 135-139 and its geometry matches #141 of the standard door (same 68 vertices/107 indices). */
 // The second `roy foot door` at #51 is a separate descriptor/mesh, despite
 // sharing the internal name and texture atlas with the confirmed #90 door.
 const doorCandidate=L[51],candidate=L.modelGroups.find(g=>g.source==='descriptor'&&g.parts?.some(p=>p.p===doorCandidate?.poff));
 if(doorCandidate&&candidate){candidate.name='Mission door candidate — Kyza texture';candidate.displayName=candidate.name;candidate.internalName='roy foot door';candidate.reviewNote='Separate descriptor candidate at part #51. Its 256x128 texture is byte-identical to confirmed Kyza door #90, but geometry differs; class ownership is unproven.';doorCandidate.modelReviewNote=candidate.reviewNote;doorCandidate.modelInternalName='roy foot door';}
 L.modelGroups.sort((a,b)=>{const ia=L.findIndex(M=>M.poff===a.parts?.[0]?.p),ib=L.findIndex(M=>M.poff===b.parts?.[0]?.p);return ia-ib});
 L.modelGroupById=registry;
 // Recompute memberships and primary metadata after adding the verified layer.
 for(const M of L){const ids=[...new Set(M.modelMemberships||[])];M.modelMemberships=ids;const gs=ids.map(id=>registry.get(id)).filter(Boolean);if(M.modelPrimaryLock){const g=registry.get(M.modelPrimaryLock);if(g)makePrimary(M,g,g.parts.findIndex(p=>p.p===M.poff));}else if(M.modelVerified){const g=registry.get(M.modelGroup);if(g)M.modelAlsoIn=ids.filter(id=>id!==g.id)}else if(gs.length){gs.sort((a,b)=>((b.source==='script'?700:b.source==='descriptor'?200:0)+(b.refs||0))-((a.source==='script'?700:a.source==='descriptor'?200:0)+(a.refs||0)));const g=gs[0];makePrimary(M,g,g.parts.findIndex(p=>p.p===M.poff));}}
 L.modelGroundTruthApplied=true;L.modelGroundTruthLevel='10-00.LCS';L.modelGraph=L.modelGraph||{};L.modelGraph.groundTruthGroups=specs.length;return L;
}
const modelsOf=w=>MC[w]||(MC[w]=(()=>{const g=getWad(w);if(!g)return[];const L=EC.parseModels(g.A,g.B);if(/^10-00\.LCS$/i.test(String(w).split(/[\\/]/).pop()))applyRobotBeachGroundTruth(L);return L})());
const modelGroupOf=(L,M)=>{const g=M?.modelGroup&&L.modelGroupById?.get(M.modelGroup);if(g)return(g.parts||[]).map(p=>L.find(x=>x.poff===p.p)).filter(Boolean);return M?[M]:[]};
const modelGroupCaption=(M,n)=>{if(!M?.modelGroup)return'unverified linked group · '+n+' part'+(n===1?'':'s');const role=M.modelVerified?'user-confirmed model':M.modelSource==='descriptor-review'?'descriptor review':({model:'PC model',collision:'collision mesh',attachment:'attached model',shadow:'skydome model (SetShadowModel)',component:'descriptor candidate',unverified:'unverified linked parts'}[M.modelKind]||'PC model');const alias=M.modelInternalName&&M.modelInternalName!==M.modelName?' ('+M.modelInternalName+')':'';const desc=M.modelDescriptor!=null?' · descriptor 0x'+M.modelDescriptor.toString(16):'';const shared=M.modelAlsoIn?.length?' · '+M.modelAlsoIn.length+' alternate membership(s) retained':'';return role+' · '+M.modelName+alias+(M.modelClasses?.length?' · '+M.modelClasses.join(', '):'')+desc+' · '+n+' part'+(n===1?'':'s')+shared};
const registryGroupCaption=(g,n)=>{const role=g.source==='groundtruth'?'confirmed':g.source==='script'?({model:'script model',collision:'collision',attachment:'attachment',shadow:'skydome (SetShadowModel)'}[g.kind]||'script component'):g.source==='descriptor'?'descriptor candidate':g.source==='descriptor-review'?'descriptor review':g.source==='part-chain'?'part-link fallback':g.source||'model';const desc=g.descriptor!=null?' @0x'+g.descriptor.toString(16):'';const cls=g.classes?.length?' · '+g.classes.join(', '):'';const review=g.suppressed?' · REVIEW ONLY (oversized)':'';return role+' · '+(g.displayName||g.name||g.id)+cls+desc+' · '+n+' part'+(n===1?'':'s')+review};
const texOf=t=>{if(!t)return null;if(t.x)return t.x;const x=new THREE.DataTexture(t.rgba,t.w,t.h,THREE.RGBAFormat);x.wrapS=x.wrapT=THREE.RepeatWrapping;x.magFilter=THREE.LinearFilter;x.minFilter=THREE.LinearMipmapLinearFilter;x.generateMipmaps=true;x.needsUpdate=true;return t.x=x};
const geoOf=(w,m,p)=>{const k=w+'|'+m+'|'+(p??'');if(GC[k])return GC[k];const M=modelsOf(w).find(x=>p!=null?x.poff===p:x.off===m);if(!M)return null;const g=new THREE.BufferGeometry();
 g.setAttribute('position',new THREE.BufferAttribute(M.pos,3));g.setAttribute('normal',new THREE.BufferAttribute(M.nrm,3));g.setAttribute('uv',new THREE.BufferAttribute(M.uv,2));g.setIndex(new THREE.BufferAttribute(M.idx,1));
 return GC[k]={g,M,mat:new THREE.MeshBasicMaterial({map:texOf(M.tex),color:M.tex?0xffffff:0xb0b8d0,side:THREE.DoubleSide,alphaTest:M.tex&&M.tex.alpha?.5:0})}};
// auto model fallback: an instance init register that points at a 16-byte model-table record {descriptor ptr,0,0,0}
const AUTOC={};
function autoModel(q,w){const g=getWad(w);if(!g)return null;const AL=modelsOf(w);if(!AL.modelGroups)return null;
 const dv=new DataView(g.A.buffer,g.A.byteOffset,g.A.length),U=o=>o>=0&&o+16<=g.A.length?dv.getUint32(o,true):0;
 for(const p of q.params||[]){const v=p.v>>>0;if(v<0x1000||v&3)continue;const k=w+'|'+v;if(k in AUTOC){if(AUTOC[k])return AUTOC[k];continue}
  const d=U(v);let hit=null;if(d&&!U(v+4)&&!U(v+8)&&!U(v+12)){const gs=AL.modelGroups.filter(x=>x.descriptor===d&&x.parts?.length&&!x.suppressed);hit=gs.find(x=>x.source==='script'&&x.kind==='model')||gs.find(x=>x.source==='descriptor')||gs[0]||null}
  AUTOC[k]=hit;if(hit)return hit}
 const ck='c|'+w+'|'+q.n;if(!(ck in AUTOC)){const cg=AL.modelGroups.filter(x=>x.parts?.length&&!x.suppressed&&(x.classes||[]).includes(q.n)&&(x.source==='groundtruth'||(x.source==='script'&&x.kind==='model'))),ix=x=>AL.findIndex(m=>m.poff===x.parts[0].p);
  cg.sort((a,b)=>((b.source==='groundtruth')-(a.source==='groundtruth'))||ix(a)-ix(b));AUTOC[ck]=cg[0]||null}
 return AUTOC[ck]}

// ground snap: only for classes whose spawn-time script (entry + called subroutines) calls Strat_ProbeGround and then copies GroundHeight (prop 71) into PosY (prop 10)
const SNAPC={},SNAPY={};
function snapInfo(w,name){let S=SNAPC[w];
 if(!S){S=SNAPC[w]={cls:{}};const g=getWad(w),sw=g&&siWad(g.A,g.B);if(sw){S.sw=sw;S.az=new SiAn(sw)}}
 if(name in S.cls)return S.cls[name];let res=null;
 try{const sw=S.sw,az=S.az,c=sw&&sw.classes.find(x=>x.name===name);
  if(c&&az.ins.has(c.entry)){const[o0,calls]=az.reach([c.entry]),offs=new Set(o0),pend=[...calls],seen=new Set();
   while(pend.length){const s=pend.pop();if(seen.has(s))continue;seen.add(s);const[o,cl]=az.reach([s]);for(const x of o)offs.add(x);for(const x of cl)pend.push(x)}
   const seq=[...offs].sort((a,b)=>a-b).map(o=>az.ins.get(o)).filter(Boolean),nat=i=>(i.mn==='native'||i.mn==='native_y')?az.native(i)[0]:null,imm=i=>sw.U(i.off)&0xfff,s8=v=>v>127?v-256:v,f32=u=>{const b=new DataView(new ArrayBuffer(4));b.setUint32(0,u>>>0);return b.getFloat32(0)};
   for(let k=0;k<seq.length&&!res;k++){if(nat(seq[k])!=='Strat_ProbeGround')continue;let h=null;
    for(let j=k+1;j<Math.min(k+12,seq.length);j++){const n=seq[j];if(nat(n)==='Strat_ProbeGround')break;
     if(n.mn==='getvar'&&n.form==='gv_i12'&&(n.b>>4)===1&&imm(n)===71)h={r:n.a,off:0};
     else if(h&&n.mn==='fadd'&&n.b===h.r){if(n.form==='rri8')h={r:n.a,off:h.off+s8(n.c)*0.125};else if(n.form==='rri32')h={r:n.a,off:h.off+f32(n.ext[0])};else h=null}
     else if(h&&n.mn==='setvar'&&n.form==='sv_i12_r'&&(n.b>>4)===1&&imm(n)===10&&n.a===h.r){
      let tmp=false;for(let b=k-1;b>=Math.max(0,k-40);b--){const nn=nat(seq[b]);if(nn==='Strat_RestoreTransform')break;if(nn==='Strat_SaveTransform'){tmp=true;break}}if(tmp)break;/* probe at a temporarily moved position, not a self snap */
      let guard=null;for(let b=Math.max(0,k-3);b<k;b++){const p=seq[b];if((p.mn==='jz'||p.mn==='jnz')&&p.a<c.ninit)guard={reg:p.a,nz:p.mn==='jz'}}
      res={off:h.off,guard};break}}}}}catch(e){console.error('snapInfo',name,e)}
 return S.cls[name]=res}
const snapOk=(si,q)=>si&&(!si.guard||(()=>{const v=(q.params&&q.params[si.guard.reg]||{}).v||0;return si.guard.nz?v!==0:v===0})());
function groundY(p,cs){if(!cs.length)return null;const k=cs.length+'|'+p.join(',');if(k in SNAPY)return SNAPY[k];Viewer.root.updateMatrixWorld(true);const RC=new THREE.Raycaster();RC.set(Viewer.root.localToWorld(new Viewer.V3(p[0],p[1]+1,p[2])),new Viewer.V3(0,-1,0));RC.far=1001;const h=RC.intersectObjects(cs,false);return SNAPY[k]=h.length?Viewer.root.worldToLocal(h[0].point.clone()).y:null}

function drawModels(){if(!mgrp)mgrp=new THREE.Group();if(mgrp.parent!==Viewer.root)Viewer.root.add(mgrp);for(const c of[...mgrp.children])mgrp.remove(c);mgrp.scale.z=1;/* root already mirrors Z (root.scale.z=mz); mirroring mgrp again put overlays at +z */const sh=Viewer.$('md_show');mgrp.visible=!sh||sh.checked;
 const MS=getProject().models||{},au=Viewer.$('md_auto'),useAuto=!au||au.checked,sn=Viewer.$('md_snap'),useSnap=!sn||sn.checked;let csn=null;for(const q of Viewer.all){const w0=wadOf(q.L),M=MS[w0]||{};
  // an object added from another level still points into its SOURCE level's data (until the patched .vol is built), so its model is looked up there
  const ad=q.added&&w0&&((getProject().wads[w0]||{}).adds||[])[q.added-1],ws=ad&&ad.from.w,xl=!!ws&&ws!==w0,Ms=xl?(MS[ws]||{}):M;
  let a=M['i:'+q.i]||(ad&&Ms['i:'+ad.from.i])||M['c:'+q.n]||(xl&&Ms['c:'+q.n]);if(!a&&useAuto&&w0){const aw=xl?ws:w0,ag=autoModel(q,aw);if(ag)a={w:aw,groupId:ag.id,auto:true}}if(!a)continue;
  // New projects store an explicit part list; older group/single-part assignments remain supported.
  const AL=modelsOf(a.w),AG=a.groupId&&AL.modelGroupById?.get(a.groupId),list=Array.isArray(a.parts)?a.parts.map(x=>geoOf(a.w,x.m,x.p)):AG?(AG.parts||[]).map(x=>geoOf(a.w,x.m,x.p)):a.g!==undefined?(typeof a.g==='string'?AL.filter(x=>x.modelGroup===a.g):AL.filter(x=>x.gid===a.g||x.legacyGid===a.g)).map(x=>geoOf(a.w,x.off,x.poff)):[geoOf(a.w,a.m,a.p)];
  const extra=(a.more||[]).flatMap(mm=>(mm.parts||[]).map(x=>geoOf(a.w,x.m,x.p)));let py=q.p[1];
  if(useSnap){const si=snapInfo(xl?ws:w0,q.n);if(snapOk(si,q)){csn=csn||(()=>{const r=[];Viewer.root.traverse(o=>{if(o.isMesh&&o.userData.kind==='coll')r.push(o)});return r})();const gy=groundY(q.p,csn);if(gy!==null)py=gy+si.off}}
  for(const G of [...list,...extra]){if(!G)continue;const o=new THREE.Mesh(G.g,G.mat);o.position.set(q.p[0],py,q.p[2]);if(q.q){o.quaternion.set(q.q[0],q.q[1],q.q[2],q.q[3]);if(a.ry)o.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new Viewer.V3(0,1,0),a.ry*Math.PI/180))}mgrp.add(o)}}Viewer.need=true}
// Keep model overlays in sync whenever the viewer rebuilds entity visuals. This is
// especially important for a copied instance whose model assignment comes from a
// different source level; the copy should appear immediately without reloading a VOL.
setEntityOverlayRefresh(drawModels);
const mp=document.createElement('div');mp.id='md';mp.style.cssText='position:fixed;right:10px;bottom:10px;width:380px;max-height:92vh;overflow:auto;background:#1b1e24f2;border:1px solid #444;padding:6px;display:none;z-index:20;font-size:12px';
mp.innerHTML='<b>Models</b> <span class=h>mesh parts from a level wad</span> <button id=md_x style=float:right>x</button><br><select id=md_w style="width:100%"></select><input id=md_q type=search placeholder="Filter by part #, name, texture size…" style="box-sizing:border-box;width:100%;margin:4px 0"><select id=md_l size=8 multiple style="width:100%" title="Ctrl/Cmd-click to select multiple parts"></select><div style="display:flex;gap:4px;margin:4px 0"><select id=md_groups style="flex:1;min-width:0" title="Choose any model record, including alternate and unverified evidence groups"><option value="">Choose model record…</option></select><button id=md_usegroup title="Select the exact parts in the chosen model record">preview record</button></div><div class=h>Robot Beach Hub includes your confirmed ranges. Group labels show descriptor addresses and exact part numbers. Grouping sources are now consolidated into one registry; shared/alternate memberships are retained rather than merged or discarded. #51 is a separate &quot;roy foot door&quot; descriptor from the confirmed Kyza door #90; it uses the same texture atlas and is marked as a likely alternate door, not confirmed. Ctrl/Cmd-click to assemble parts.</div><canvas id=md_c width=340 height=240 style="width:340px;height:240px;background:#0d0f12"></canvas><div id=md_i class=h></div><label id=md_rawwrap style=display:none><input type=checkbox id=md_raw> show extracted raw mesh instead of expected debug cube</label><div>extra yaw&deg; <input id=md_r type=number value=0 step=90 style="width:55px"> <button id=md_a title="Save a 3D-view overlay assignment in the editor project">overlay on selected</button> <button id=md_k title="Save a 3D-view overlay assignment for this class">overlay on class</button> <button id=md_n>clear</button></div><div><button id=md_g title="Select the named PC model, collision, attachment or unverified linked group">select model group</button> <button id=md_s>clear part selection</button> <label><input type=checkbox id=md_whole checked> expand one selected part to linked group</label></div><label><input type=checkbox id=md_show checked> draw assigned overlays in the 3D view</label><label title=\"Instances with no manual assignment: follow init-register model pointers (e.g. SwingingObject r0) to a model descriptor\"><input type=checkbox id=md_auto checked> auto-draw models from instance registers (fallback)</label><label title=\"Only classes whose spawn-time script calls Strat_ProbeGround and copies the ground height into PosY are moved; guarded by their init register when the script does so\"><input type=checkbox id=md_snap checked> snap to ground where the script does</label><label title=\"Add the selected parts to this entity/class assignment as another group instead of replacing it\"><input type=checkbox id=md_add> add as extra group (don&#39;t replace)</label><div class=h>Overlay assignments are saved in the project; they do not yet copy mesh/texture resources into the game level.</div>';
document.body.appendChild(mp);
const r2c=document.getElementById('md_c'),ren=new THREE.WebGLRenderer({canvas:r2c,antialias:true}),sc2=new THREE.Scene(),cam2=new THREE.PerspectiveCamera(40,340/240,.01,5000);ren.setSize(340,240,false);
let oy=.6,op=.35,od=5,oc=new Viewer.V3();
function pv(){cam2.position.set(oc.x+od*Math.sin(oy)*Math.cos(op),oc.y+od*Math.sin(op),oc.z+od*Math.cos(oy)*Math.cos(op));cam2.lookAt(oc);ren.render(sc2,cam2)}
function preview(){for(const c of[...sc2.children])sc2.remove(c);const w=Viewer.$('md_w').value,L=modelsOf(w),selEl=Viewer.$('md_l');
 const chosen=[...selEl.selectedOptions].map(o=>L[+o.value]).filter(Boolean);if(!chosen.length){mCur=null;Viewer.$('md_i').textContent='Select one part, or Ctrl/Cmd-click several parts to make an exact set.';Viewer.$('md_rawwrap').style.display='none';Viewer.$('md_a').disabled=Viewer.$('md_k').disabled=false;pv();return}
 const M=chosen[0],focusedGroup=mGroupFocus?L.modelGroupById?.get(mGroupFocus):null,groupMembers=focusedGroup?(focusedGroup.parts||[]).map(p=>L.find(x=>x.poff===p.p)).filter(Boolean):modelGroupOf(L,M),whole=!focusedGroup&&chosen.length===1&&Viewer.$('md_whole').checked&&groupMembers.length>1,mem=focusedGroup?chosen:(whole?groupMembers:chosen);
 const groupOnly=mem.length===groupMembers.length&&groupMembers.every(x=>mem.includes(x));
 const debugModel=chosen.length===1&&M.modelName==='debug'&&(M.modelClasses||[]).some(x=>x==='FlagSetter'||x==='CheatPickups');
 const debugProxy=debugModel&&!Viewer.$('md_raw').checked;
 Viewer.$('md_rawwrap').style.display=debugModel?'block':'none';
 Viewer.$('md_a').disabled=Viewer.$('md_k').disabled=!!debugProxy;
 const activeGroup=focusedGroup||L.modelGroupById?.get(M.modelGroup)||null;mCur={w,parts:mem.map(x=>({m:x.off,p:x.poff})),g:activeGroup?.id||M.modelGroup||M.gid,groupId:activeGroup?.id||M.modelGroup||null,gn:groupMembers.length,groupOnly,modelName:activeGroup?.displayName||M.modelName||null,modelKind:activeGroup?.kind||M.modelKind||null,modelSource:activeGroup?.source||M.modelSource||null,modelInternalName:activeGroup?.internalName||M.modelInternalName||activeGroup?.name||null,modelDescriptor:activeGroup?.descriptor??M.modelDescriptor??null,modelVerified:activeGroup?.source==='groundtruth'||!!M.modelVerified,modelMemberships:M.modelMemberships||[],modelClasses:activeGroup?.classes||M.modelClasses||[],modelNatives:activeGroup?.natives||M.modelNatives||[],previewProxy:!!debugProxy};
 const mn=[1e9,1e9,1e9],mx=[-1e9,-1e9,-1e9];let tris=0,verts=0,drawn=0;const texSet=new Set();
 if(debugProxy){const G=geoOf(w,M.off,M.poff);if(G){const box=new THREE.BoxGeometry(.9,.9,.9),mat=new THREE.MeshBasicMaterial({map:G.mat.map||null,color:G.mat.color||0xffffff,side:THREE.DoubleSide,alphaTest:G.mat.alphaTest||0});sc2.add(new THREE.Mesh(box,mat));drawn=1;tris=12;verts=8;if(M.tex)texSet.add(M.tex.w+'x'+M.tex.h);mn[0]=mn[1]=mn[2]=-.45;mx[0]=mx[1]=mx[2]=.45}}
 else for(const x of mem){const G=geoOf(w,x.off,x.poff);if(!G)continue;sc2.add(new THREE.Mesh(G.g,G.mat));drawn++;tris+=x.idx.length/3;verts+=x.nv;if(x.tex)texSet.add(x.tex.w+'x'+x.tex.h);for(let q=0;q<3;q++){mn[q]=Math.min(mn[q],x.bb[0][q]);mx[q]=Math.max(mx[q],x.bb[1][q])}}
 if(!drawn){mCur=null;Viewer.$('md_i').textContent='The selected parts do not have renderable geometry.';pv();return}
 oc.set((mn[0]+mx[0])/2,(mn[1]+mx[1])/2,(mn[2]+mx[2])/2);od=Math.max(mx[0]-mn[0],mx[1]-mn[1],mx[2]-mn[2],.1)*2.2;
 const rows=[...selEl.selectedOptions],hidden=rows.filter(o=>o.hidden).length;
 let label=focusedGroup?registryGroupCaption(focusedGroup,mem.length):(whole?modelGroupCaption(M,mem.length):'exact selection: '+mem.length+' part'+(mem.length===1?'':'s'));
 if(chosen.length===1&&groupMembers.length>1&&!whole)label+=' ('+modelGroupCaption(M,groupMembers.length)+')';
 if(chosen.length===1&&groupMembers.length>=32&&whole&&(!M.modelGroup||M.modelKind==='component'))label+=' — large unverified group; inspect before using';
 if(hidden)label+='; '+hidden+' selected part'+(hidden===1?' is':'s are')+' hidden by filter';
 const partList=mem.map(x=>'#'+L.indexOf(x)+(x.modelPartLabel?' '+x.modelPartLabel:'')).join(', ');
 const group=focusedGroup||L.modelGroupById?.get(M.modelGroup)||L.modelGroups?.find(g=>g.id===M.modelGroup),desc=(group?.descriptor??M.modelDescriptor)!=null?' · descriptor 0x'+(group?.descriptor??M.modelDescriptor).toString(16):'',roots=group?.rootDetails?.length?' · roots: '+group.rootDetails.map(r=>'+'+r.offset.toString(16)+'→#'+L.findIndex(x=>x.poff===r.part)+' '+r.role).join('; '):'';
 const classes=(group?.classes?.length||M.modelClasses?.length)?' · class: '+(group?.classes||M.modelClasses).join(', '):'';
 const span=(mx[0]-mn[0]).toFixed(1)+' × '+(mx[1]-mn[1]).toFixed(1)+' × '+(mx[2]-mn[2]).toFixed(1);
 let detail='parts: '+partList+desc+roots+classes;if(M.modelMembershipConflict)detail+=' · WARNING: multiple script model descriptors claim this part';if(M.modelAlsoIn?.length)detail+=' · retained alternate memberships: '+M.modelAlsoIn.map(id=>L.modelGroupById?.get(id)?.displayName||id).join(', ');
 if(M.modelReviewNote)detail+=' · '+M.modelReviewNote;if(M.modelCandidateGroups?.length)detail+=' · oversized/unverified descriptor candidates: '+M.modelCandidateGroups.map(id=>{const g=L.modelGroupById?.get(id);return(g?.name||id)+(g?.descriptor!=null?' @0x'+g.descriptor.toString(16):'')}).join(', ');
 if(debugProxy)detail+=' · expected debug-cube proxy only; raw part #0 currently parses as three narrow planes. Overlay/copy actions are disabled while this proxy is shown.';
 Viewer.$('md_i').textContent=label+' · '+verts+' verts · '+tris+' tris · '+span+' · textures: '+(texSet.size?[...texSet].join(', '):'none')+' · '+detail;pv()}
const escM=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function filterM(){const w=Viewer.$('md_w').value,L=modelsOf(w),sel=Viewer.$('md_l'),q=Viewer.$('md_q').value.trim().toLowerCase().replace(/^#/,'');
 for(const o of sel.options){const M=L[+o.value],hay=[o.textContent,o.value,M?.name,M?.modelName,M?.modelInternalName,M?.modelPartLabel,M?.modelReviewNote,M?.modelKind,M?.modelSource,(M?.modelClasses||[]).join(' '),(M?.modelNatives||[]).join(' '),(M?.modelMemberships||[]).map(id=>{const g=L.modelGroupById?.get(id);return(g?.displayName||g?.name||id)+' '+(g?.classes||[]).join(' ')}).join(' '),(M?.modelCandidateGroups||[]).map(id=>L.modelGroupById?.get(id)?.name||id).join(' '),M?.gid,M?.off?.toString(16),M?.poff?.toString(16),M?.tex?M.tex.w+'x'+M.tex.h:''].join(' ').toLowerCase();o.hidden=!!q&&!hay.includes(q)}
 for(const g of sel.children)if(g.tagName==='OPTGROUP')g.hidden=[...g.children].every(o=>o.hidden);
 preview()}
function fillM(){const w=Viewer.$('md_w').value,L=modelsOf(w),old=new Set([...Viewer.$('md_l').selectedOptions].map(o=>o.value)),order=[],by=new Map(),groupSel=Viewer.$('md_groups');mGroupFocus=null;
 const groups=(L.modelGroups||[]).slice().sort((a,b)=>{const ai=Math.min(...(a.parts||[]).map(p=>L.findIndex(M=>M.poff===p.p)).filter(i=>i>=0),999999),bi=Math.min(...(b.parts||[]).map(p=>L.findIndex(M=>M.poff===p.p)).filter(i=>i>=0),999999);return ai-bi||(a.descriptor??0)-(b.descriptor??0)||String(a.id).localeCompare(String(b.id))});
 groupSel.innerHTML='<option value="">Choose model record…</option>'+groups.map(g=>{const n=(g.parts||[]).length,label=registryGroupCaption(g,n);return'<option value="'+escM(g.id)+'">'+escM(label)+'</option>'}).join('');
 const keyOf=M=>M.modelGroup||'unassigned:'+(M.poff??M.off);
 L.forEach((M,k)=>{const id=keyOf(M);if(!by.has(id)){by.set(id,[]);order.push(id)}by.get(id).push(k)});
 const opt=k=>{const M=L[k],height=(M.bb[1][1]-M.bb[0][1]).toFixed(1),model=M.modelGroup?'  '+M.modelName+(M.modelClasses?.length?' · '+M.modelClasses.join(', '):''):'',partLabel=M.modelPartLabel?'  ['+M.modelPartLabel+']':'',label='#'+k+partLabel+'  '+M.nv+' verts  '+height+' tall'+(M.modelGroup?'  '+M.modelPartIndex+'/'+M.modelPartCount:'')+(M.name?'  '+M.name:'')+model;return'<option value="'+k+'"'+(old.has(String(k))?' selected':'')+'>'+escM(label)+'</option>'};
 let h='',singles='';for(const id of order){const ks=by.get(id),M=L[ks[0]],named=!!M.modelGroup;if(ks.length>1||named){const lo=Math.min(...ks),hi=Math.max(...ks),caption=named?modelGroupCaption(M,ks.length):'unverified linked group · '+ks.length+' parts · #'+lo+'–#'+hi;h+='<optgroup label="'+escM(caption)+'">'+ks.map(opt).join('')+'</optgroup>'}else singles+=opt(ks[0])}
 if(singles)h+='<optgroup label="unassigned / unverified single parts">'+singles+'</optgroup>';Viewer.$('md_l').innerHTML=h;
 if(![...Viewer.$('md_l').selectedOptions].length&&L.length){const first=Viewer.$('md_l').options[0];if(first)first.selected=true}
 filterM();if(!L.length)Viewer.$('md_i').textContent='No object meshes in this wad.';else if(!L.modelGroups?.length)Viewer.$('md_i').textContent='No named PC model references found in this wad; showing unverified linked groups.';else{const sc=L.modelGroups.filter(g=>g.source==='script').length,dc=L.modelGroups.filter(g=>g.source==='descriptor').length,gt=L.modelGroups.filter(g=>g.source==='groundtruth').length;Viewer.$('md_i').textContent=(gt?gt+' user-confirmed groups · ':'')+sc+' script-role groups + '+dc+' descriptor candidates · '+L.modelRefCount+' class-script references · '+(L.modelMembershipConflicts||0)+' conflicting visible-model memberships · '+(L.modelGraph?.possibleNodeEdges?.length||0)+' unmerged node-pointer clues · '+(L.modelGroups.filter(g=>g.suppressed).length)+' oversized candidate chains held for review.'}}
Viewer.$('ed_md').onclick=()=>{mp.style.display=mp.style.display=='none'?'block':'none';if(mp.style.display=='none')return;const ws=Viewer.files.map(f=>f.name).filter(n=>/^\d+-\d+\.LCS$/i.test(n)).sort((a,b)=>a.localeCompare(b,0,{numeric:true})),cur=Viewer.sel&&wadOf(Viewer.sel.L);
 Viewer.$('md_w').innerHTML=ws.map(n=>'<option>'+n+'</option>').join('');if(cur)Viewer.$('md_w').value=cur;Viewer.$('md_q').value='';Viewer.$('md_l').innerHTML='';fillM()};
Viewer.$('md_x').onclick=()=>{mp.style.display='none'};Viewer.$('md_w').onchange=()=>{Viewer.$('md_l').innerHTML='';fillM()};Viewer.$('md_l').onchange=()=>{mGroupFocus=null;Viewer.$('md_groups').value='';preview()};Viewer.$('md_q').oninput=filterM;Viewer.$('md_show').onchange=drawModels;Viewer.$('md_auto').onchange=drawModels;Viewer.$('md_snap').onchange=drawModels;Viewer.$('md_whole').onchange=preview;Viewer.$('md_raw').onchange=preview;
Viewer.$('md_usegroup').onclick=()=>{const L=modelsOf(Viewer.$('md_w').value),id=Viewer.$('md_groups').value,g=L.modelGroupById?.get(id);if(!g)return;const wanted=new Set((g.parts||[]).map(p=>p.p));mGroupFocus=id;for(const o of Viewer.$('md_l').options)o.selected=wanted.has(L[+o.value]?.poff);preview()};
Viewer.$('md_g').onclick=()=>{const L=modelsOf(Viewer.$('md_w').value),s=Viewer.$('md_l'),first=[...s.selectedOptions].map(o=>L[+o.value]).find(Boolean);if(!first)return;const id=mGroupFocus||first.modelGroup,g=id&&L.modelGroupById?.get(id);if(!g)return;Viewer.$('md_groups').value=id;mGroupFocus=id;const wanted=new Set((g.parts||[]).map(p=>p.p));for(const o of s.options)o.selected=wanted.has(L[+o.value]?.poff);preview()};
Viewer.$('md_s').onclick=()=>{for(const o of Viewer.$('md_l').options)o.selected=false;preview()};
let md=null;r2c.onmousedown=e=>{md=[e.clientX,e.clientY]};addEventListener('mouseup',()=>{md=null});addEventListener('mousemove',e=>{if(!md)return;oy-=(e.clientX-md[0])*.01;op=Math.max(-1.5,Math.min(1.5,op+(e.clientY-md[1])*.01));md=[e.clientX,e.clientY];pv()});r2c.onwheel=e=>{e.preventDefault();od*=e.deltaY>0?1.1:.9;pv()};
const asg=cls=>{if(mCur?.previewProxy){Viewer.$('md_i').textContent='Switch to the extracted raw mesh before saving an overlay; the debug cube is an editor-only visual proxy.';return}if(!Viewer.sel||!mCur||!mCur.parts?.length){Viewer.$('md_i').textContent='Select an entity in the 3D view and one or more mesh parts first.';return}const tw=wadOf(Viewer.sel.L);if(!tw)return;getProject().models=getProject().models||{};getProject().scripts=getProject().scripts||{};const M=getProject().models[tw]=getProject().models[tw]||{};const first=mCur.parts[0],entry={w:mCur.w,parts:mCur.parts.map(x=>({m:x.m,p:x.p})),m:first.m,p:first.p,ry:+Viewer.$('md_r').value||0,modelName:mCur.modelName||null,modelKind:mCur.modelKind||null,modelSource:mCur.modelSource||null,modelInternalName:mCur.modelInternalName||null,modelDescriptor:mCur.modelDescriptor??null,groupId:mCur.groupId||null,modelVerified:!!mCur.modelVerified,modelClasses:mCur.modelClasses||[],modelMemberships:mCur.modelMemberships||[],modelNatives:mCur.modelNatives||[]};if(mCur.groupOnly&&mCur.groupId)entry.groupId=mCur.groupId;const key=cls?'c:'+Viewer.sel.n:'i:'+Viewer.sel.i,prev=M[key];if(Viewer.$('md_add')&&Viewer.$('md_add').checked&&prev){prev.more=(prev.more||[]).concat([{parts:entry.parts,groupId:entry.groupId,modelName:entry.modelName}])}else M[key]=entry;drawModels();summary()};
Viewer.$('md_a').onclick=()=>asg(false);Viewer.$('md_k').onclick=()=>asg(true);
Viewer.$('md_n').onclick=()=>{if(!Viewer.sel)return;const M=getProject().models&&getProject().models[wadOf(Viewer.sel.L)];if(M){delete M['i:'+Viewer.sel.i];delete M['c:'+Viewer.sel.n]}drawModels()};


  return { resetCaches(){ MC={}; GC={}; } };
}
