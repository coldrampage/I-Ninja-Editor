// Models panel: browsing parsed meshes, previewing and assigning 3D overlays.
import { siWad, SiAn, alphaProps, parseTga, parseMaterialResources } from './vol-core.js?v=step146-strat-appearance-preview';
import { parseIninjaModelBundle, bytesToBase64, base64ToBytes, editorPreviewUvs } from './custom-models.js?v=step146-strat-appearance-preview';
import { setEntityOverlayRefresh, setEntityOverlayUpdater, setExtraEntityProvider } from './viewer.js?v=step146-strat-appearance-preview';
import { resolveEntryModelSelection } from './entry-models.js?v=step146-strat-appearance-preview';
import { resolveModelMaterialPasses, modelMaterialPassIsDynamic, modelMaterialPassState } from './model-material-preview.js?v=step146-strat-appearance-preview';

export function installModelEditor({Viewer, THREE, EC, getProject, getWad, wadOf, summary}) {
// ---- models: browse the object meshes of any strat wad, assign one to an entity (or a class) so it is drawn in the 3D view; assignments are saved in the project
let MC={},GC={},mgrp=null,cmgrp=null,mCur=null,mGroupFocus=null, customSeq=0;
const modelMaterialResources=new Map(), modelTextureCache=new Map(), modelPreviewDynamicMaterials=new Set(), modelOverlayDynamicMaterials=new Set();
const customParsed=new Map(), customTextures=new Map(), customGeometries=new Map(), customMaterials=new Map(), collisionGeometries=new Map(), collisionStyleMaterials=new Map(), primitivePreviewGeometries=new Map();
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
  {id:'rbh:kyza-door',parts:[90],name:'Kyza mission door',internal:'roy foot door',classes:['BossDoor_Kyza','BossDoor'],natives:[]},
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
function modelMaterialResourcesOf(w){if(modelMaterialResources.has(w))return modelMaterialResources.get(w);const wad=getWad(w);const rows=wad?parseMaterialResources(wad.A,wad.B):[];const byOffset=new Map(rows.map(r=>[r.offset,r]));modelMaterialResources.set(w,byOffset);return byOffset}
function modelTextureOf(w,offset){if(!Number.isInteger(offset)||offset<=0)return null;const key=w+'|'+offset;if(modelTextureCache.has(key))return modelTextureCache.get(key);const wad=getWad(w),image=wad?parseTga(wad.A,offset):null;if(!image?.rgba){modelTextureCache.set(key,null);return null}const record={image,texture:texOf(image)};modelTextureCache.set(key,record);return record}
function makeModelMaterials(w,M){
 const resources=modelMaterialResourcesOf(w),specs=resolveModelMaterialPasses(M.materialOffset,resources,M.texOffset),prepared=[];
 for(const spec of specs){
  const frames=spec.frameOffsets.map(offset=>({offset,record:modelTextureOf(w,offset)})).filter(x=>x.record);
  if(!frames.length)continue;
  const layer=spec.layer||null,independent=!!layer,maps=new Map(),frameOffsets=frames.map(x=>x.offset);
  const getMap=offset=>{if(maps.has(offset))return maps.get(offset);const record=modelTextureOf(w,offset);if(!record)return null;const map=independent?record.texture.clone():record.texture;map.wrapS=map.wrapT=THREE.RepeatWrapping;if(independent){map.center.set(.5,.5);map.offset.set(0,0);map.rotation=0}maps.set(offset,map);return map};
  const first=frames[0],firstMap=getMap(first.offset),rgba=(Array.isArray(layer?.color)?layer.color:[1,1,1,1]).map(v=>Number.isFinite(v)?v:1),opacity=Math.max(0,Math.min(1,rgba[3]));
  const alpha={...alphaProps(first.record.image)},layerCount=specs.length,layerIndex=prepared.length,forceTransparent=layerCount>1||opacity<.999;
  if(forceTransparent)alpha.transparent=true;if(layerCount>1&&layerIndex>0)alpha.depthWrite=false;
  const material=new THREE.MeshBasicMaterial({map:firstMap,color:new THREE.Color(rgba[0],rgba[1],rgba[2]),opacity,side:THREE.DoubleSide,...alpha,polygonOffset:true,polygonOffsetFactor:layerCount>1?-layerIndex:1,polygonOffsetUnits:layerCount>1?-layerIndex:1});
  const pass={...spec,frameOffsets};material.userData={modelMaterialPreview:true,w,pass,maps,getMap,frameIndex:0,previewStart:performance.now(),layer,layerIndex,layerCount,forceTransparent,opacity,hasUvMotion:!!layer&&modelMaterialPassIsDynamic({...pass,frameOffsets:[]})};
  prepared.push(material);
 }
 if(prepared.length)return prepared;
 const fallback=M.tex?texOf(M.tex):null;return[new THREE.MeshBasicMaterial({map:fallback,color:fallback?0xffffff:0xb0b8d0,side:THREE.DoubleSide,...alphaProps(M.tex)})];
}
const geoOf=(w,m,p)=>{const k=w+'|'+m+'|'+(p??'');if(GC[k])return GC[k];const M=modelsOf(w).find(x=>p!=null?x.poff===p:x.off===m);if(!M)return null;const g=new THREE.BufferGeometry();
 g.setAttribute('position',new THREE.BufferAttribute(M.pos,3));g.setAttribute('normal',new THREE.BufferAttribute(M.nrm,3));g.setAttribute('uv',new THREE.BufferAttribute(M.uv,2));g.setIndex(new THREE.BufferAttribute(M.idx,1));
 const materials=makeModelMaterials(w,M);return GC[k]={g,M,materials,mat:materials[0]}};
function cloneModelMaterial(source){const clone=source.clone(),meta=source.userData||{},dynamic=modelMaterialPassIsDynamic(meta.pass);if(dynamic&&typeof meta.getMap==='function')clone.map=meta.getMap(meta.pass?.frameOffsets?.[0]);clone.userData={...meta,maps:meta.maps,getMap:meta.getMap,modelDynamicClone:true};return clone}
function updateModelMaterialPreviews(now){const previewVisible=typeof mp!=='undefined'&&mp.style.display!=='none',active=new Set(modelOverlayDynamicMaterials);if(previewVisible)for(const material of modelPreviewDynamicMaterials)active.add(material);let previewChanged=false,overlayChanged=false;for(const material of active){const u=material?.userData;if(!u?.pass)continue;const elapsed=Math.max(0,now-u.previewStart),state=modelMaterialPassState(u.pass,elapsed);let changed=false;
  if((u.pass.frameOffsets||[]).length>1&&state.frameIndex!==u.frameIndex){u.frameIndex=state.frameIndex;const record=modelTextureOf(u.w,state.textureOffset),map=u.getMap(state.textureOffset);material.map=map;const alpha={...alphaProps(record?.image||null)};if(u.forceTransparent)alpha.transparent=true;if(u.layerCount>1&&u.layerIndex>0)alpha.depthWrite=false;Object.assign(material,alpha);material.opacity=u.opacity;material.needsUpdate=true;changed=true}
  if(u.layer&&u.hasUvMotion){const uv=state.uvOffset,maps=[...u.maps.values()].filter(Boolean),uvChanged=maps.some(map=>Math.abs(map.offset.x-uv[0])>1e-7||Math.abs(map.offset.y-uv[1])>1e-7||Math.abs(map.rotation-state.rotation)>1e-7);if(uvChanged){for(const map of maps){map.offset.set(uv[0],uv[1]);map.center.set(.5,.5);map.rotation=state.rotation}changed=true}}
  if(changed){if(previewVisible&&modelPreviewDynamicMaterials.has(material))previewChanged=true;if(modelOverlayDynamicMaterials.has(material))overlayChanged=true}
 }
 if(previewChanged)pv();return overlayChanged}
// Native CollMesh data is linked from the Strat_SetModelCollide model table.
// Decode once per (LCS, CollMesh offset), then share the geometry between the
// model preview and placed-instance overlays. This is read-only inspection.
function collisionOf(w,offset){
 const key=w+'|'+offset,hit=collisionGeometries.get(key);if(hit)return hit;
 const wad=getWad(w);if(!wad||!Number.isInteger(offset))return null;
 const data=EC.parseCollisionMesh(wad.A,wad.B,offset);if(!data?.valid){const out={data};collisionGeometries.set(key,out);return out}
 const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.BufferAttribute(data.positions,3));
 const colors=new Float32Array(data.positions.length),C=new THREE.Color();
 for(let t=0;t<data.triangleCount;t++){C.setHSL(((data.materials[t]*0.137)%1+1)%1,.78,.58);for(let v=0;v<3;v++)colors.set([C.r,C.g,C.b],t*9+v*3)}
 geo.setAttribute('color',new THREE.BufferAttribute(colors,3));geo.computeVertexNormals();geo.computeBoundingSphere();
 const edges=new THREE.EdgesGeometry(geo,1);
 const out={data,geo,edges};collisionGeometries.set(key,out);return out;
}
// Preview the primitive shape and bounds used by the native writer. The
// collision controls are per placed instance, so preview cache keys include both
// material policies rather than reusing one asset-wide visual.
function collisionPreviewGeometry(trianglePositions,triangleMaterials){
 const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.BufferAttribute(trianglePositions,3));
 const colours=new Float32Array(trianglePositions.length),colour=new THREE.Color();
 for(let t=0;t<triangleMaterials.length;t++){
  const tag=triangleMaterials[t];
  if(tag===0x0001)colour.setHex(0x55b9e8);
  else if(tag===0x000A)colour.setHex(0x55d6a5);
  else colour.setHSL(((tag*0.61803398875)%1+1)%1,0.72,0.58);
  for(let v=0;v<3;v++)colours.set([colour.r,colour.g,colour.b],t*9+v*3);
 }
 geo.setAttribute('color',new THREE.BufferAttribute(colours,3));geo.computeVertexNormals();geo.computeBoundingSphere();
 return{geo,edges:new THREE.EdgesGeometry(geo,1)};
}
function customPrimitiveCollision(w,a,data,type,settings={}){
 const {topTagMode='slidey',sideTagMode='slidey'}=settings;
 const key=w+'|'+a.id+'|'+type+'|'+topTagMode+'|'+sideTagMode+'|'+(settings.upwardMaterialTag??'')+'|'+(settings.sideMaterialTag??'')+'|'+(settings.otherMaterialTag??'')+'|'+a.bundle.length,hit=primitivePreviewGeometries.get(key);if(hit)return hit;
 const mn=[Infinity,Infinity,Infinity],mx=[-Infinity,-Infinity,-Infinity];
 for(const mesh of data.meshes)for(let i=0;i<mesh.positions.length;i+=3)for(let k=0;k<3;k++){const v=mesh.positions[i+k];if(!Number.isFinite(v))continue;mn[k]=Math.min(mn[k],v);mx[k]=Math.max(mx[k],v)}
 if(mn.some((v,k)=>!Number.isFinite(v)||!Number.isFinite(mx[k])||mx[k]-v<1e-5))return null;
 const shape=EC.buildPrimitiveCollisionShape(type,[mn,mx],{...settings,upwardMaterialTag:settings.upwardMaterialTagRaw,sideMaterialTag:settings.sideMaterialTagRaw,otherMaterialTag:settings.otherMaterialTagRaw}),visual=collisionPreviewGeometry(shape.trianglePositions,shape.triangleMaterials),out={...visual,shape};primitivePreviewGeometries.set(key,out);return out;
}
// The exact indexed model surface is also the mesh-collider preview. Tag colours
// are copied onto an expanded triangle view; the visible render mesh remains
// indexed and untouched. Z is kept in editor coordinates so the parent group
// applies the normal mirrored-level transform exactly once.
function customMeshCollisionPreview(w,a,data,settings={}){
 const {topTagMode='slidey',sideTagMode='slidey'}=settings;
 const mesh=data.meshes?.[0];if(!mesh)return null;
 const key=w+'|'+a.id+'|mesh-preview|'+topTagMode+'|'+sideTagMode+'|'+(settings.upwardMaterialTag??'')+'|'+(settings.sideMaterialTag??'')+'|'+(settings.otherMaterialTag??'')+'|'+a.bundle.length,hit=primitivePreviewGeometries.get(key);if(hit)return hit;
 const shape=EC.buildMeshCollisionShape(mesh,{...settings,upwardMaterialTag:settings.upwardMaterialTagRaw,sideMaterialTag:settings.sideMaterialTagRaw,otherMaterialTag:settings.otherMaterialTagRaw}),positions=new Float32Array(mesh.indices.length*3),materials=new Uint16Array(mesh.indices.length/3),base=mesh.positions;
 for(let t=0;t<materials.length;t++){
  materials[t]=shape.triangles[t].materialTag;
  for(let v=0;v<3;v++){const index=mesh.indices[t*3+v];positions.set(base.subarray(index*3,index*3+3),t*9+v*3)}
 }
 const visual=collisionPreviewGeometry(positions,materials),out={...visual,shape};primitivePreviewGeometries.set(key,out);return out;
}
function collisionMaterials(mode){
 if(collisionStyleMaterials.has(mode))return collisionStyleMaterials.get(mode);
 const fill=mode==='wire'?null:new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.DoubleSide,transparent:true,opacity:mode==='solid'?.34:.13,depthWrite:false});
 const line=new THREE.LineBasicMaterial({color:mode==='ghost'?0xffc06a:0xff536f,transparent:mode==='ghost',opacity:mode==='ghost'?.72:.98,depthWrite:false});
 const result={fill,line};collisionStyleMaterials.set(mode,result);return result;
}
function addCollisionVisual(parent,source,mode){
 if(!source?.geo||mode==='off')return;
 const mats=collisionMaterials(mode);
 if(mats.fill){const mesh=new THREE.Mesh(source.geo,mats.fill);mesh.renderOrder=900;mesh.userData.kind='object-collision';parent.add(mesh)}
 const lines=new THREE.LineSegments(source.edges,mats.line);lines.renderOrder=901;lines.userData.kind='object-collision';parent.add(lines);
}
const kdLineMaterial=(options)=>THREE.LineBasicMaterial?new THREE.LineBasicMaterial(options):null;
const kdAxisMaterials={x:kdLineMaterial({color:0xff6677,transparent:true,opacity:.9}),y:kdLineMaterial({color:0x72df9a,transparent:true,opacity:.9}),z:kdLineMaterial({color:0x69aaff,transparent:true,opacity:.9})};
const kdBoundsMaterial=kdLineMaterial({color:0xe0e5ee,transparent:true,opacity:.6}),kdLeafRegionMaterial=kdLineMaterial({vertexColors:true,transparent:true,opacity:.72}),kdGeometryCache=new WeakMap();
function addKdTreeVisual(parent,data,showSplits=true,showLeaves=false){
 const k=data?.kdTree,b=k?.bounds;if(!k?.valid||!b||(!showSplits&&!showLeaves))return;
 let cached=kdGeometryCache.get(data);if(!cached){
  const byAxis={x:[],y:[],z:[]},leafLines=[],leafColors=[];
  const edge=(out,a,c)=>out.push(...a,...c);
  const boxLines=(out,box,colour=null)=>{
   const mn=box.min||box[0],mx=box.max||box[1],corners=[[mn[0],mn[1],mn[2]],[mx[0],mn[1],mn[2]],[mn[0],mx[1],mn[2]],[mx[0],mx[1],mn[2]],[mn[0],mn[1],mx[2]],[mx[0],mn[1],mx[2]],[mn[0],mx[1],mx[2]],[mx[0],mx[1],mx[2]]];
   for(const [a,c] of [[0,1],[0,2],[1,3],[2,3],[4,5],[4,6],[5,7],[6,7],[0,4],[1,5],[2,6],[3,7]]){edge(out,corners[a],corners[c]);if(colour)for(let q=0;q<2;q++)leafColors.push(colour.r,colour.g,colour.b)}
  };
  for(const n of k.nodes){if(n.type!=='internal'||!n.region)continue;const p=n.split,r=n.region,mn=r.min,mx=r.max,out=byAxis[n.axisName];
   // Every split is drawn only inside the spatial region inherited from its ancestors.
   if(n.axis===0){const q=[[p,mn[1],mn[2]],[p,mx[1],mn[2]],[p,mx[1],mx[2]],[p,mn[1],mx[2]]];for(let i=0;i<4;i++)edge(out,q[i],q[(i+1)%4])}
   else if(n.axis===1){const q=[[mn[0],p,mn[2]],[mx[0],p,mn[2]],[mx[0],p,mx[2]],[mn[0],p,mx[2]]];for(let i=0;i<4;i++)edge(out,q[i],q[(i+1)%4])}
   else{const q=[[mn[0],mn[1],p],[mx[0],mn[1],p],[mx[0],mx[1],p],[mn[0],mx[1],p]];for(let i=0;i<4;i++)edge(out,q[i],q[(i+1)%4])}
  }
  for(const n of k.nodes){if(n.type!=='leaf'||!n.region)continue;const colour=new THREE.Color().setHSL(((n.index*0.61803398875)%1+1)%1,.7,.62);boxLines(leafLines,n.region,colour)}
  const planes={};for(const axis of ['x','y','z'])if(byAxis[axis].length){const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.BufferAttribute(Float32Array.from(byAxis[axis]),3));planes[axis]=geo}
  const leafGeo=new THREE.BufferGeometry();leafGeo.setAttribute('position',new THREE.BufferAttribute(Float32Array.from(leafLines),3));leafGeo.setAttribute('color',new THREE.BufferAttribute(Float32Array.from(leafColors),3));
  const allBounds=[],rootBox={min:b[0],max:b[1]};boxLines(allBounds,rootBox);const boundsGeo=new THREE.BufferGeometry();boundsGeo.setAttribute('position',new THREE.BufferAttribute(Float32Array.from(allBounds),3));
  cached={planes,leafRegions:leafGeo,bounds:boundsGeo};kdGeometryCache.set(data,cached);
 }
 if(showSplits)for(const axis of ['x','y','z'])if(cached.planes[axis]&&kdAxisMaterials[axis]){const lines=new THREE.LineSegments(cached.planes[axis],kdAxisMaterials[axis]);lines.renderOrder=902;lines.userData.kind='object-kd-splits';parent.add(lines)}
 if(showLeaves&&kdLeafRegionMaterial){const lines=new THREE.LineSegments(cached.leafRegions,kdLeafRegionMaterial);lines.renderOrder=903;lines.userData.kind='object-kd-leaf-regions';parent.add(lines)}
 if(kdBoundsMaterial){const boxLines=new THREE.LineSegments(cached.bounds,kdBoundsMaterial);boxLines.renderOrder=901;boxLines.userData.kind='object-kd-bounds';parent.add(boxLines)}
}
function collisionSummary(c){
 if(!c)return'No linked CollMesh found through the selected model record.';
 const d=c.data;if(!d?.valid)return'CollMesh reference exists, but could not be decoded: '+(d?.error||'unknown error');
 const mats=Object.entries(d.materialCounts).sort((a,b)=>Number(a[0])-Number(b[0])).map(([id,n])=>'material '+id+': '+n).join(', ')||'none',k=d.kdTree;
 return'CollMesh A+0x'+d.offset.toString(16)+' · KD '+(k?.valid?'valid':'warning')+' · '+(k?.internalCount||0)+' split nodes / '+(k?.leafCount||0)+' leaves · max depth '+(k?.maxDepth||0)+' · records '+d.vertexCount+' ('+d.validRecords+' valid) · triangles '+d.triangleCount+' · '+mats+' · sphere centre '+d.centre.map(x=>x.toFixed(3)).join(', ')+' · radius '+d.radius.toFixed(3);
}
function collisionDetail(c){
 if(!c)return'No CollMesh pointer is associated with this selected model record. It may use another collision path (for example a trigger volume or script-driven collision); that is not inferred here.';
 const d=c.data;if(!d?.valid)return'CollMesh parse failed: '+(d?.error||'unknown error');
 const k=d.kdTree,b=k?.bounds||d.kdBounds,fmtChild=x=>x==null?'—':String(x).padStart(3,'0'),fmtRegion=r=>r?'X '+r.min[0].toFixed(3)+'..'+r.max[0].toFixed(3)+' Y '+r.min[1].toFixed(3)+'..'+r.max[1].toFixed(3)+' Z '+r.min[2].toFixed(3)+'..'+r.max[2].toFixed(3):'region unavailable';
 const nodeLines=(k?.nodes||[]).map(n=>{const depth=k.depths[n.index]??'?';if(n.type==='leaf')return String(n.index).padStart(3,'0')+'  depth '+String(depth).padStart(2)+'  LEAF  records '+n.firstRecord+'..'+n.lastRecord+' ('+n.recordCount+')  tris '+(n.triangleCount??'?')+'  '+fmtRegion(n.region)+'  raw='+n.rawWord0.toString(16).padStart(8,'0')+'/'+n.rawWord1.toString(16).padStart(8,'0');return String(n.index).padStart(3,'0')+'  depth '+String(depth).padStart(2)+'  '+n.axisName.toUpperCase()+'='+n.split.toFixed(6).padStart(11)+'  A below='+fmtChild(n.childA)+' B above='+fmtChild(n.childB)+'  '+fmtRegion(n.region)+'  raw='+n.rawWord0.toString(16).padStart(8,'0')+'/'+n.rawWord1.toString(16).padStart(8,'0')}).join('\n');
 const rawNodes=d.nodes.slice(0,6).map(n=>String(n.index).padStart(3,'0')+'  '+n.hex0+'  '+n.hex1).join('\n');
 const bounds=b?'X '+b[0][0].toFixed(4)+' .. '+b[1][0].toFixed(4)+'\nY '+b[0][1].toFixed(4)+' .. '+b[1][1].toFixed(4)+'\nZ '+b[0][2].toFixed(4)+' .. '+b[1][2].toFixed(4):'unavailable';
 const records=d.records.map(r=>String(r.index).padStart(3,'0')+'  '+r.position.map(v=>v.toFixed(4).padStart(10)).join(' ')+'  '+r.flagsHex+(r.valid?'':'  invalid/sentinel')).join('\n');
 const lr=k?.leafRanges||{},se=k?.sideEvidence||{};
 const kdText=[
  'PC KD TREE DECODE',
  'Evidence: unmodified retail 10.vol, 95 CollMeshes',
  'Nodes 0..5: Xmin, Xmax, Ymin, Ymax, Zmin, Zmax; signed int32 / 8192',
  `Root: ${k?.root??'unknown'} · internal: ${k?.internalCount??'?'} · leaves: ${k?.leafCount??'?'} · max depth: ${k?.maxDepth??'?'} · graph: ${k?.valid?'valid':'WARN'}`,
  'Leaf word1: first record = word1 >>> 8; record count = word1 & 0xff',
  `Leaf coverage: ${lr.valid?'exact':'WARNING'} · ${lr.coveredRecords??0}/${d.vertexCount} records, gaps ${lr.uncoveredRecords??'?'}, overlaps ${lr.overlappedRecords??'?'}`,
  `Header +0x28 raw word: ${d.headerWord28??d.leafBase} (equals nodeCount in stock 10.vol: ${k?.leafBaseMatchesNodeCount}; custom Suzanne test value was 0; PC meaning unresolved)`,
  `Leaf streams: ${k?.leafStreams?.valid?`all ${k.leafStreams.leafCount} leaves start valid and end with exactly one zero-flag terminator`:'WARNING: '+JSON.stringify(k?.leafStreams)}`,
  'Child order in PC data: high16 child A = below/negative side; low16 child B = above/positive side',
  `Leaf-bound side evidence (strict 0.05 tolerance): A-below ${se.high16Below??0}, B-above ${se.low16Above??0}, fully opposite ${se.contradictions??0}, mixed/straddling ${se.mixed??0}`,
  `Triangle-centroid side observations (each triangle counted once per ancestor split): A-below ${k?.triangleCentroidEvidence?.high16Below??0}, A-above ${k?.triangleCentroidEvidence?.high16Above??0}, A-near ${k?.triangleCentroidEvidence?.high16Near??0}; B-above ${k?.triangleCentroidEvidence?.low16Above??0}, B-below ${k?.triangleCentroidEvidence?.low16Below??0}, B-near ${k?.triangleCentroidEvidence?.low16Near??0}`,
  `Subtree regions: ${k?.regionSplitOutOfBounds===0?'all '+k?.regionSplitCount+' split planes fall within their inherited region':'WARNING: '+k?.regionSplitOutOfBounds+' invalid split regions'}`,
  'Root bounds:', bounds,
  `Header/vertex bounds max difference: ${(d.kdBoundsError??NaN).toFixed(6)}`,
  'word0 low 2 bits: axis 0=X, 1=Y, 2=Z, 3=leaf; split = (signed word0 >> 3) / 1024 (= 1/8192 units in this PC sample)',
  'Internal word1 high16 / low16: child A / child B; 0xffff = missing child',
  'PS2 PSM comparison: macOS repo documents root node 0, high16=above/low16=below, and leaf pointers to DMA descriptors; PC LCS has six bounds entries, root 6, high16=below/low16=above, and packed (firstRecord<<8)|recordCount leaves. The PC leaf ranges include a zero terminator per strip. Do not copy PS2 binary details into PC.',
  'Split outlines are clipped to the inherited subtree region. Optional leaf boxes show the actual KD partition cells, not collision response volumes.',
  `Warnings: ${k?.warnings?.length?k.warnings.join('; '):'none'}`,
  '', 'DECODED TREE NODES', nodeLines, '', 'RAW HEADER NODES 0..5', rawNodes
 ].join('\n');
 return'HEADER\nCollMesh: A+0x'+d.offset.toString(16)+'\nKD nodes: A+0x'+d.nodePtr.toString(16)+' ('+d.nodeCount+')\nVertex records: A+0x'+d.vertexPtr.toString(16)+' ('+d.vertexCount+')\nSphere centre: '+d.centre.map(v=>v.toFixed(6)).join(', ')+'\nradius²: '+d.radiusSq+'\nradius: '+d.radius+'\nPointer relocation words: '+JSON.stringify(d.relocations)+'\n\n'+kdText+'\n\nVERTEX RECORDS (x y z flags)\n'+records;
}

// Automatic map appearance follows the actual visible model selected by the
// class entry routine. Event/message handlers are deliberately excluded so a
// destroyed model, gib part or later state-transition variant cannot become
// the default appearance. Per-instance init values resolve simple entry branches.
const AUTOC={};
function autoModel(q,w){const g=getWad(w);if(!g)return null;const AL=modelsOf(w);if(!AL.modelGroups||!AL.entryModelRefs)return null;
 const params=(q.params||[]).map(x=>x&&Number.isFinite(Number(x.v))?Number(x.v):null).join(',');
 const key=w+'|'+q.n+'|'+q.i+'|'+params;if(Object.prototype.hasOwnProperty.call(AUTOC,key))return AUTOC[key];
 return AUTOC[key]=resolveEntryModelSelection(AL,q,g.A,{wadName:String(w)})||null}
function autoAssignment(w,selection){const root=selection?.group;if(!root)return null;const models=selection.spawnedModels|| (selection.spawnedGroups||[]).map(group=>({group,offset:[0,0,0]}));return{w,groupId:root.id,groupOffset:selection.groupOffset||[0,0,0],groupRotation:selection.groupRotation||[0,0,0],auto:true,autoReason:selection.reason,autoCertainty:selection.certainty,randomPreview:!!selection.randomPreview,more:models.map(x=>({parts:x.group?.parts||[],groupId:x.group?.id,modelName:x.group?.displayName||x.group?.name,offset:x.offset||[0,0,0],rotation:x.rotation||[0,0,0],spawned:true,spawnClass:x.cls||null}))}}

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


const customStore=w=>{const P=getProject();P.customModels=P.customModels||{};const C=P.customModels[w]||(P.customModels[w]={assets:[],instances:[]});C.assets=Array.isArray(C.assets)?C.assets:[];C.instances=Array.isArray(C.instances)?C.instances:[];return C};
const customRec=(w,id)=>customStore(w).assets.find(a=>a.id===id)||null;
function parsedCustom(w,a){
 if(!a||!a.bundle)return null;const key=w+'|'+a.id,hit=customParsed.get(key);if(hit&&hit.bundle===a.bundle)return hit.data;
 try{const data=parseIninjaModelBundle(base64ToBytes(a.bundle));customParsed.set(key,{bundle:a.bundle,data});return data}catch(e){console.warn('custom model import failed',a.name,e);return null}
}
function customTex(w,a,path,data){
 const key=w+'|'+a.id+'|'+path,hit=customTextures.get(key);if(hit)return hit;
 const raw=data.textures.get(path);if(!raw)return null;
 const obj=new Uint8Array(0x20+raw.length);new DataView(obj.buffer).setUint32(0x10,0x20,true);obj.set(raw,0x20);
 const img=parseTga(obj,0);if(!img)return null;
 const t=new THREE.DataTexture(img.rgba,img.w,img.h,THREE.RGBAFormat);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.magFilter=THREE.LinearFilter;t.minFilter=THREE.LinearMipmapLinearFilter;t.generateMipmaps=true;t.needsUpdate=true;customTextures.set(key,t);return t
}
function customGeo(w,a,data,m){
 const key=w+'|'+a.id+'|'+m.name,hit=customGeometries.get(key);if(hit)return hit;
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(m.positions,3));g.setAttribute('normal',new THREE.BufferAttribute(m.normals,3));g.setAttribute('uv',new THREE.BufferAttribute(editorPreviewUvs(m.uvs),2));g.setIndex(new THREE.BufferAttribute(m.indices,1));g.computeBoundingSphere();customGeometries.set(key,g);return g
}
function customMat(w,a,data,mi){
 const key=w+'|'+a.id+'|'+mi,hit=customMaterials.get(key);if(hit)return hit;
 const m=data.materials[mi]||{},color=m.baseColor||[1,1,1,1],map=m.texture?customTex(w,a,m.texture,data):null;
 const params={map,color:new THREE.Color(color[0],color[1],color[2]),side:m.doubleSided?THREE.DoubleSide:THREE.FrontSide,transparent:m.alphaMode==='BLEND'||color[3]<.999,opacity:color[3],depthWrite:!(m.alphaMode==='BLEND'||color[3]<.999),alphaTest:m.alphaMode==='MASK'?m.alphaCutoff:0,blending:m.blendMode==='additive'?THREE.AdditiveBlending:m.blendMode==='subtractive'?THREE.SubtractiveBlending:THREE.NormalBlending};
 if(m.alphaMode==='BLEND')params.depthWrite=false;
 const out=new THREE.MeshBasicMaterial(params);customMaterials.set(key,out);return out
}
function selectedCustomInstance(){
 const w=Viewer.$('md_w')?.value;if(!w)return null;const C=customStore(w),i=Number(Viewer.$('md_custom_instance')?.value);
 return Number.isInteger(i)&&i>=0&&C.instances[i]?{w,C,i,instance:C.instances[i]}:null;
}
function customInstanceCollisionSettings(asset,instance,data){
 const manifest=data?.manifest?.collision||{},validType=['none','box','sphere','cylinder','mesh'];
 const rawType=instance?.collisionType??asset?.collisionType??manifest.type??'none';
 const type=validType.includes(String(rawType).toLowerCase())?String(rawType).toLowerCase():'none';
 let top=instance?.collisionTopTag;
 if(!['standable','slidey'].includes(top)){
  if(['standable','slidey'].includes(asset?.collisionUpwardTagMode))top=asset.collisionUpwardTagMode;
  else if(type==='mesh')top=(asset?.collisionTopTag||manifest.topTagMode||'slidey');
  else if(manifest.topTagModeExplicit&&['standable','slidey'].includes(manifest.topTagMode))top=manifest.topTagMode;
  else top=(type==='box'||type==='cylinder')?'standable':'slidey';
 }
 let side=instance?.collisionSideTag;
 if(!['walkable','slidey'].includes(side))side=asset?.collisionSideTag||manifest.sideTagMode||'slidey';
 if(!['standable','slidey'].includes(top))top='slidey';
 if(!['walkable','slidey'].includes(side))side='slidey';
 const raw=(instanceKey,assetKey,manifestKey,ignoreInherited=false)=>{
  const value=instance?.[instanceKey]??(ignoreInherited?undefined:(asset?.[assetKey]??manifest[manifestKey]));
  if(value==null||value==='')return null;
  const n=Number(value);if(!Number.isInteger(n)||n<0||n>0xffff)throw instanceKey+' must be a 16-bit material tag (0..65535)';return n;
 };
 const direct=(key)=>{const value=instance?.[key];if(value==null||value==='')return null;const n=Number(value);if(!Number.isInteger(n)||n<0||n>0xffff)throw key+' must be a 16-bit material tag (0..65535)';return n;};
 const upwardOverride=direct('collisionUpwardMaterialTag'),sideOverride=direct('collisionSideMaterialTag'),otherOverride=direct('collisionOtherMaterialTag');
 const upwardResolved=raw('collisionUpwardMaterialTag','collisionUpwardMaterialTag','upwardMaterialTag',['standable','slidey'].includes(instance?.collisionTopTag));
 const sideResolved=raw('collisionSideMaterialTag','collisionSideMaterialTag','sideMaterialTag',['walkable','slidey'].includes(instance?.collisionSideTag));
 const otherResolved=raw('collisionOtherMaterialTag','collisionOtherMaterialTag','otherMaterialTag');
 const label=(instanceKey,assetKey,manifestKey,ignoreInherited=false)=>String(instance?.[instanceKey]??(ignoreInherited?'':(asset?.[assetKey]??manifest[manifestKey]??''))).slice(0,48);
 return{
  type,topTagMode:top,sideTagMode:side,
  upwardMaterialTag:upwardResolved??(top==='standable'?0x000A:0x0001),
  sideMaterialTag:sideResolved??(side==='walkable'?0x000A:0x0001),
  otherMaterialTag:otherResolved??0x0001,
  upwardMaterialTagRaw:upwardResolved,sideMaterialTagRaw:sideResolved,otherMaterialTagRaw:otherResolved,
  upwardMaterialTagOverride:upwardOverride,sideMaterialTagOverride:sideOverride,otherMaterialTagOverride:otherOverride,
  upwardMaterialLabel:label('collisionUpwardMaterialLabel','collisionUpwardMaterialLabel','upwardMaterialLabel',['standable','slidey'].includes(instance?.collisionTopTag)),
  sideMaterialLabel:label('collisionSideMaterialLabel','collisionSideMaterialLabel','sideMaterialLabel',['walkable','slidey'].includes(instance?.collisionSideTag)),
  otherMaterialLabel:label('collisionOtherMaterialLabel','collisionOtherMaterialLabel','otherMaterialLabel')
 };
}
function customEntityRows(){
 const rows=[];
 for(const [w,raw] of Object.entries(getProject().customModels||{})){
  const level=Viewer.D.find(l=>wadOf(l.id)===w);if(!level)continue;
  const C=raw&&typeof raw==='object'?raw:{};if(!Array.isArray(C.instances))continue;
  C.instances.forEach((inst,i)=>{
   if(!inst||!inst.id)return;
   const asset=customRec(w,inst.assetId),rot=inst.rotation||[0,0,0],position=inst.position||[0,0,0],yaw=Number(rot[1])||0,heading=((yaw%360)+360)%360,half=(180+yaw)*Math.PI/360;
   rows.push({customModel:true,customModelId:inst.id,customModelWad:w,customAssetId:inst.assetId,n:inst.name||asset?.name||'Custom model',L:level.id,i:-(i+1),p:position.slice(0,3),r:Math.round(heading/360*4096)&4095,q:[0,Math.sin(half),0,Math.cos(half)],params:[],b:null,shape:0,customScale:(inst.scale||[1,1,1])[0]||1});
  });
 }
 return rows;
}
setExtraEntityProvider(customEntityRows);
function focusCustomInstance(w,id){
 const C=customStore(w),i=C.instances.findIndex(x=>x&&x.id===id);if(i<0)return false;
 const sel=Viewer.$('md_w');if(sel)sel.value=w;refreshCustomUi();const list=Viewer.$('md_custom_instance');if(list)list.value=String(i);loadCustomPlacementFields();
 Viewer.refresh();const q=Viewer.all.find(x=>x.customModel&&x.customModelId===id);if(q){Viewer.sel=q;Viewer.inspect(q);Viewer.need=true;}return !!q;
}
function syncCustomEntities(selectId=null){
 refreshCustomUi();Viewer.refresh();
 if(selectId){const q=Viewer.all.find(x=>x.customModel&&x.customModelId===selectId);if(q){Viewer.sel=q;Viewer.inspect(q);Viewer.need=true;return;}}
 if(Viewer.sel&&Viewer.sel.customModel){Viewer.sel=null;Viewer.inspect(null);}
}
function customInstanceChanged(w,id){
 const level=Viewer.D.find(l=>wadOf(l.id)===w);if(level){const target=Viewer.$('md_w');if(target)target.value=w;}
 const at=customStore(w).instances.findIndex(x=>x&&x.id===id);
 if(at>=0){refreshCustomUi();const list=Viewer.$('md_custom_instance');if(list)list.value=String(at);loadCustomPlacementFields();}
 drawCustomModels();summary();
}
function loadCustomPlacementFields(){
 const selected=selectedCustomInstance();if(!selected)return;
 const {instance}=selected,asset=customRec(selected.w,instance.assetId),pos=instance.position||[0,0,0],rot=instance.rotation||[0,0,0],scale=instance.scale||[1,1,1];
 if(asset&&Viewer.$('md_custom_asset'))Viewer.$('md_custom_asset').value=asset.id;
 const values={md_custom_name:instance.name||asset?.name||'Custom model',md_cx:pos[0]??0,md_cy:pos[1]??0,md_cz:pos[2]??0,md_cry:rot[1]??0,md_cs:scale[0]??1};
 for(const [id,value] of Object.entries(values)){const el=Viewer.$(id);if(el)el.value=String(value)}
}
function refreshCustomUi(){
 const w=Viewer.$('md_w')?.value;if(!w)return;const C=customStore(w),as=Viewer.$('md_custom_asset'),ins=Viewer.$('md_custom_instance');
 if(as){const old=as.value;as.innerHTML=C.assets.map(a=>'<option value="'+escM(a.id)+'">'+escM(a.name)+'</option>').join('');if(C.assets.some(a=>a.id===old))as.value=old;else if(C.assets.length)as.value=C.assets[0].id;}
 if(ins){const old=ins.value;ins.innerHTML=C.instances.map((item,i)=>{const asset=customRec(w,item.assetId);return'<option value="'+i+'">'+escM(item.name||('instance '+(i+1)))+' · '+escM(asset?.name||item.assetId)+' · ['+(item.position||[0,0,0]).map(v=>Number(v).toFixed(1)).join(', ')+']</option>'}).join('');if(C.instances[+old])ins.value=old;else if(C.instances.length)ins.value='0';}
 const selected=Number.isInteger(Number(ins?.value))&&C.instances[Number(ins.value)]?C.instances[Number(ins.value)]:null;
 const asset=selected?customRec(w,selected.assetId):customRec(w,as?.value),data=asset&&parsedCustom(w,asset),info=Viewer.$('md_custom_info'),col=Viewer.$('md_custom_collision');
 const settings=customInstanceCollisionSettings(asset,selected,data),activeCollision=settings.type;
 const assetDefaultType=customInstanceCollisionSettings(asset,null,data).type;
 const labels={none:'None',box:'Box',sphere:'Sphere',cylinder:'Cylinder · vertical Y (temporarily disabled)',mesh:'Mesh · exact triangles'};
 if(col){col.value=selected?.collisionType&&['none','box','sphere','cylinder','mesh'].includes(selected.collisionType)?selected.collisionType:'inherit';col.disabled=!selected;const inherit=col.querySelector('option[value="inherit"]');if(inherit)inherit.textContent='Use asset default ('+(labels[assetDefaultType]||'None')+')';}
 const tagWrap=Viewer.$('md_custom_mesh_tag_wrap'),tagSelect=Viewer.$('md_custom_mesh_top_tag'),sideWrap=Viewer.$('md_custom_side_tag_wrap'),sideSelect=Viewer.$('md_custom_side_tag');
 if(tagWrap)tagWrap.style.display=activeCollision==='none'?'none':'block';
 if(sideWrap)sideWrap.style.display=activeCollision==='none'?'none':'block';
 if(tagSelect){const rawOption=tagSelect.querySelector('option[value="raw"]');if(rawOption){rawOption.hidden=settings.upwardMaterialTagOverride==null;rawOption.textContent='Keep raw override (0x'+settings.upwardMaterialTag.toString(16).toUpperCase().padStart(4,'0')+')';}tagSelect.value=settings.upwardMaterialTagOverride!=null?'raw':selected?.collisionTopTag&&['standable','slidey'].includes(selected.collisionTopTag)?selected.collisionTopTag:'inherit';tagSelect.disabled=!selected||activeCollision==='none';const inherit=tagSelect.querySelector('option[value="inherit"]');if(inherit)inherit.textContent='Use asset default ('+(settings.topTagMode==='standable'?'Standable':'Slide-y')+' · 0x'+settings.upwardMaterialTag.toString(16).toUpperCase().padStart(4,'0')+')';}
 if(sideSelect){const rawOption=sideSelect.querySelector('option[value="raw"]');if(rawOption){rawOption.hidden=settings.sideMaterialTagOverride==null;rawOption.textContent='Keep raw override (0x'+settings.sideMaterialTag.toString(16).toUpperCase().padStart(4,'0')+')';}sideSelect.value=settings.sideMaterialTagOverride!=null?'raw':selected?.collisionSideTag&&['walkable','slidey'].includes(selected.collisionSideTag)?selected.collisionSideTag:'inherit';sideSelect.disabled=!selected||activeCollision==='none';const inherit=sideSelect.querySelector('option[value="inherit"]');if(inherit)inherit.textContent='Use asset default ('+(settings.sideTagMode==='walkable'?'Wall-running':'Slide-y')+' · 0x'+settings.sideMaterialTag.toString(16).toUpperCase().padStart(4,'0')+')';}
 const tagInputValues=[['md_custom_up_tag_value',settings.upwardMaterialTag],['md_custom_side_tag_value',settings.sideMaterialTag],['md_custom_other_tag_value',settings.otherMaterialTag]];
 for(const [id,value] of tagInputValues){const el=Viewer.$(id);if(el){el.value='0x'+value.toString(16).toUpperCase().padStart(4,'0');el.disabled=!selected||activeCollision==='none';}}
 const tagLabels=[['md_custom_up_tag_label',settings.upwardMaterialLabel],['md_custom_side_tag_label',settings.sideMaterialLabel],['md_custom_other_tag_label',settings.otherMaterialLabel]];
 for(const [id,value] of tagLabels){const el=Viewer.$(id);if(el){el.value=value;el.disabled=!selected||activeCollision==='none';}}
 const rawTagSummary=(tag,label)=>'0x'+tag.toString(16).toUpperCase().padStart(4,'0')+(label?' '+label:'');
 if(info)info.textContent=asset?(data?data.meshes.length+' mesh part(s), '+data.materials.length+' material(s), '+data.textures.size+' texture(s) · selected placement: '+(selected?.name||'none')+' · collision: '+(labels[activeCollision]||'None')+(activeCollision!=='none'?' · upward: '+rawTagSummary(settings.upwardMaterialTag,settings.upwardMaterialLabel)+' · sides: '+rawTagSummary(settings.sideMaterialTag,settings.sideMaterialLabel)+' · other: '+rawTagSummary(settings.otherMaterialTag,settings.otherMaterialLabel):'')+(activeCollision==='cylinder'?' · WARNING: this saved Cylinder setting is retained for compatibility but is temporarily disabled for new selections; choose Box, Sphere, Mesh or None instead':'')+' · '+C.instances.length+' placed instance(s)':'Could not parse this stored model bundle; re-import it.'):(C.assets.length?'Choose an imported model.':'No custom model assets imported.');
}



function drawCustomModels(){
 if(!cmgrp)cmgrp=new THREE.Group();if(cmgrp.parent!==Viewer.root)Viewer.root.add(cmgrp);
 for(const c of [...cmgrp.children])cmgrp.remove(c);
 const show=Viewer.$('md_custom_show');cmgrp.visible=!show||show.checked;
 if(!cmgrp.visible){Viewer.need=true;return}
 for(const w of Object.keys(getProject().customModels||{})){
  if(!getWad(w))continue;
  const C=customStore(w);
  for(const inst of C.instances){
   const a=customRec(w,inst.assetId),data=a&&parsedCustom(w,a);if(!data)continue;
   const root=new THREE.Group();root.name=inst.name||a.name||'Custom model';
   const pos=inst.position||[0,0,0],rot=inst.rotation||[0,0,0],scale=inst.scale||[1,1,1];
   root.position.set(+pos[0]||0,+pos[1]||0,+pos[2]||0);
   // Custom bundles store editor-space vertices. The native writer bakes a
   // Z reflection into the PC render mesh (and collision mesh), while the
   // viewer root mirrors game Z back for display. Apply that local reflection
   // here as well, then use the same native Ry(180deg + yaw) quaternion as a
   // reloaded VOL instance. Mirroring only the heading (the old implementation)
   // omitted the vertex-space reflection and made a fresh placement face 180deg
   // away from the built/reloaded object.
   root.rotation.set((+rot[0]||0)*Math.PI/180,(180+(+rot[1]||0))*Math.PI/180,(+rot[2]||0)*Math.PI/180);
   root.scale.set(Number.isFinite(+scale[0])&&+scale[0]!==0?+scale[0]:1,Number.isFinite(+scale[1])&&+scale[1]!==0?+scale[1]:1,-(Number.isFinite(+scale[2])&&+scale[2]!==0?+scale[2]:1));
   for(const mm of data.meshes){const mat=customMat(w,a,data,mm.material),mesh=new THREE.Mesh(customGeo(w,a,data,mm),mat);mesh.name=mm.name;root.add(mesh)}
   const collision=customInstanceCollisionSettings(a,inst,data),collisionType=collision.type;
   const collMode=Viewer.$('md_coll_view')?.value||'off';
   if(collMode!=='off'&&collisionType==='mesh'){
    const source=customMeshCollisionPreview(w,a,data,collision);if(source)addCollisionVisual(root,source,collMode);
   }else if(collMode!=='off'&&['box','sphere','cylinder'].includes(collisionType)){
    const source=customPrimitiveCollision(w,a,data,collisionType,collision);
    if(source)addCollisionVisual(root,source,collMode);
   }
   cmgrp.add(root)
  }
 }
 Viewer.need=true
}

function drawModels(){if(!mgrp)mgrp=new THREE.Group();if(mgrp.parent!==Viewer.root)Viewer.root.add(mgrp);modelOverlayDynamicMaterials.clear();for(const c of[...mgrp.children]){mgrp.remove(c);if(c.material){for(const mt of[].concat(c.material)){if(mt?.userData?.modelDynamicClone){mt.dispose()}else if(c.userData&&c.userData.tintSrc)mt.dispose()}}}mgrp.scale.z=1;/* root already mirrors Z (root.scale.z=mz); mirroring mgrp again put overlays at +z */const sh=Viewer.$('md_show'),showModels=!sh||sh.checked,collMode=Viewer.$('md_coll_view')?.value||'off',showKd=!!Viewer.$('md_coll_kd')?.checked,showLeafRegions=!!Viewer.$('md_coll_leaf_regions')?.checked;mgrp.visible=true;
 const MS=getProject().models||{},au=Viewer.$('md_auto'),useAuto=!au||au.checked,sn=Viewer.$('md_snap'),useSnap=!sn||sn.checked;let csn=null;for(const q of Viewer.all){const w0=wadOf(q.L),M=MS[w0]||{};
  // an object added from another level still points into its SOURCE level's data (until the patched .vol is built), so its model is looked up there
  const ad=q.added&&w0&&((getProject().wads[w0]||{}).adds||[])[q.added-1],ws=ad&&ad.from.w,xl=!!ws&&ws!==w0,Ms=xl?(MS[ws]||{}):M;
  const instanceAssignment=M['i:'+q.i]||(ad&&Ms['i:'+ad.from.i]);
  const classAssignment=M['c:'+q.n]||(xl&&Ms['c:'+q.n]);
  // The static preview intentionally represents open-state Robot_SneakDoor
  // instances with the stable combined RobotBigCollisi appearance. Ignore any
  // legacy class-wide assignment for that variant; explicit per-instance
  // assignments remain authoritative.
  const spawnedDoorVariant=q.n==='Robot_SneakDoor'&&Number(q.params?.[1]?.v??q.params?.[1]??0)!==0;
  // These classes are controllers/compound visuals whose legacy class overlays
  // are known to be misleading: GrindRailHelper inherits shared Rax table refs,
  // DragonWolf overlays can retain its death/gib subtree. Keep deliberate
  // per-instance assignments, but let the entry-aware resolver own these
  // class-wide default appearances.
  const ignoreClassOverlay=spawnedDoorVariant||q.n==='GrindRailHelper'||q.n==='DragonWolf';
  let a=spawnedDoorVariant?null:(instanceAssignment||(ignoreClassOverlay?null:classAssignment));
  if(!a&&useAuto&&w0){const aw=xl?ws:w0,ag=autoModel(q,aw);a=autoAssignment(aw,ag)}
  if(!a&&collMode!=='off'&&w0){const ag=autoModel(q,w0);a=autoAssignment(w0,ag);if(a)a.collisionOnly=true}if(!a)continue;
  // New projects store an explicit part list; older group/single-part assignments remain supported.
  const AL=modelsOf(a.w),AG=a.groupId&&AL.modelGroupById?.get(a.groupId),list=Array.isArray(a.parts)?a.parts.map(x=>geoOf(a.w,x.m,x.p)):AG?(AG.parts||[]).map(x=>geoOf(a.w,x.m,x.p)):a.g!==undefined?(typeof a.g==='string'?AL.filter(x=>x.modelGroup===a.g):AL.filter(x=>x.gid===a.g||x.legacyGid===a.g)).map(x=>geoOf(a.w,x.off,x.poff)):[geoOf(a.w,a.m,a.p)];
  const extra=(a.more||[]).flatMap(mm=>(mm.parts||[]).map(x=>({G:geoOf(a.w,x.m,x.p),offset:mm.offset||[0,0,0],rotation:mm.rotation||[0,0,0]})));let py=q.p[1];
  if(useSnap){const si=snapInfo(xl?ws:w0,q.n);if(snapOk(si,q)){csn=csn||(()=>{const r=[];Viewer.root.traverse(o=>{if(o.isMesh&&o.userData.kind==='coll')r.push(o)});return r})();const gy=groundY(q.p,csn);if(gy!==null)py=gy+si.off}}
  const ti=Viewer.tintInfo&&Viewer.tintInfo(q);/* colour tint preview: a recoloured clone of the shared material (approximation of Strat_SetColor) */
  const setTransform=(o,offset=[0,0,0],localRotation=[0,0,0])=>{
   const baseQ=new THREE.Quaternion();
   if(q.q)baseQ.set(q.q[0],q.q[1],q.q[2],q.q[3]);
   if(a.ry)baseQ.multiply(new THREE.Quaternion().setFromAxisAngle(new Viewer.V3(0,1,0),a.ry*Math.PI/180));
   const v=new THREE.Vector3(Number(offset[0])||0,Number(offset[1])||0,Number(offset[2])||0);v.applyQuaternion(baseQ);
   o.position.set(q.p[0]+v.x,py+v.y,q.p[2]+v.z);o.quaternion.copy(baseQ);
   if(localRotation?.some(x=>Number(x)!==0))o.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler((Number(localRotation[0])||0)*Math.PI/180,(Number(localRotation[1])||0)*Math.PI/180,(Number(localRotation[2])||0)*Math.PI/180,'YXZ')));
  };
  if(showModels&&!a.collisionOnly){const renderables=[...list.map(G=>({G,offset:a.groupOffset||[0,0,0],rotation:a.groupRotation||[0,0,0]})),...extra];for(const item of renderables){const G=item.G;if(!G)continue;const mats=G.materials?.length?G.materials:[G.mat];for(let mi=0;mi<mats.length;mi++){let mt=mats[mi];if(ti){mt=cloneModelMaterial(mt);mt.color.setRGB(ti.rgb[0]/255,ti.rgb[1]/255,ti.rgb[2]/255)}if(modelMaterialPassIsDynamic(mt.userData?.pass))modelOverlayDynamicMaterials.add(mt);const o=new THREE.Mesh(G.g,mt);if(ti)o.userData.tintSrc=ti.src;if((mt.userData?.layerCount||0)>1)o.renderOrder=100+(mt.userData.layerIndex||0);setTransform(o,item.offset,item.rotation);mgrp.add(o)}}}
  if(collMode!=='off'||showKd||showLeafRegions){
   const assignedGroup=AG?.collMesh?AG:(a.groupId&&AL.modelGroupById?.get(a.groupId)?.collMesh?AL.modelGroupById.get(a.groupId):null);
   const partGroup=(list||[]).map(x=>x?.M?.modelGroup).filter(Boolean).map(id=>AL.modelGroupById?.get(id)).find(g=>g?.collMesh);
   const classGroups=(AL.modelGroups||[]).filter(g=>g.collMesh&&(g.classes||[]).includes(q.n));
   // Do not guess among several collision variants for one class. An exact
   // descriptor/assigned model wins; class fallback is allowed only when unique.
   const collGroup=assignedGroup||partGroup||(classGroups.length===1?classGroups[0]:null);
   if(collGroup?.collMesh){const source=collisionOf(a.w,collGroup.collMesh);if(source?.data?.valid){const bucket=new THREE.Group();setTransform(bucket,a.groupOffset||[0,0,0],a.groupRotation||[0,0,0]);if(collMode!=='off')addCollisionVisual(bucket,source,collMode);if(showKd||showLeafRegions)addKdTreeVisual(bucket,source.data,showKd,showLeafRegions);mgrp.add(bucket)}}
  }
 }
 drawCustomModels();
 Viewer.need=true}
// Keep model overlays in sync whenever the viewer rebuilds entity visuals. This is
// especially important for a copied instance whose model assignment comes from a
// different source level; the copy should appear immediately without reloading a VOL.
setEntityOverlayRefresh(drawModels);
const mp=document.createElement('div');mp.id='md';mp.style.cssText='position:fixed;right:10px;bottom:10px;width:380px;max-height:92vh;overflow:auto;background:#1b1e24f2;border:1px solid #444;padding:6px;display:none;z-index:20;font-size:12px';
mp.innerHTML='<b>Models</b> <span class=h>mesh parts from a level wad</span> <button id=md_x style=float:right>x</button><br><select id=md_w style="width:100%"></select><input id=md_q type=search placeholder="Filter by part #, name, texture size…" style="box-sizing:border-box;width:100%;margin:4px 0"><select id=md_l size=8 multiple style="width:100%" title="Ctrl/Cmd-click to select multiple parts"></select><div style="display:flex;gap:4px;margin:4px 0"><select id=md_groups style="flex:1;min-width:0" title="Choose any model record, including alternate and unverified evidence groups"><option value="">Choose model record…</option></select><button id=md_usegroup title="Select the exact parts in the chosen model record">preview record</button></div><div class=h>Robot Beach Hub includes your confirmed ranges. Group labels show descriptor addresses and exact part numbers. Grouping sources are now consolidated into one registry; shared/alternate memberships are retained rather than merged or discarded. #51 is a separate &quot;roy foot door&quot; descriptor from the confirmed Kyza door #90; it uses the same texture atlas and is marked as a likely alternate door, not confirmed. Ctrl/Cmd-click to assemble parts.</div><canvas id=md_c width=340 height=240 style="width:340px;height:240px;background:#0d0f12"></canvas><div id=md_i class=h></div><label>object collision view <select id=md_coll_view><option value=off>off</option><option value=wire>wire</option><option value=solid>solid</option><option value=ghost>ghost</option></select></label><div class=h>Custom Box, Sphere and exact Mesh previews use this same collision-view setting and follow the selected model placement. Legacy Cylinder previews remain available for saved projects.</div><label title="Draw each split plane clipped to the spatial region inherited from its parent nodes."><input type=checkbox id=md_coll_kd> show clipped KD split planes</label><label title="Draw the leaf cells computed from the retail child links and split coordinates."><input type=checkbox id=md_coll_leaf_regions> show leaf regions</label><div class=h>KD overlay: X red · Y green · Z blue · outer bounds grey. Leaf regions are coloured separately. PC 10.vol evidence: child A (high16) is below; child B (low16) is above.</div><div id=md_coll_info class=h>Choose a model record with a native CollMesh reference.</div><details><summary class=h>CollMesh header, KD nodes and vertex records</summary><pre id=md_coll_detail style="white-space:pre;max-height:230px;overflow:auto;background:#101318;padding:5px"></pre></details><label id=md_rawwrap style=display:none><input type=checkbox id=md_raw> show extracted raw mesh instead of expected debug cube</label><div>extra yaw&deg; <input id=md_r type=number value=0 step=90 style="width:55px"> <button id=md_a title="Save a 3D-view overlay assignment in the editor project">overlay on selected</button> <button id=md_k title="Save a 3D-view overlay assignment for this class">overlay on class</button> <button id=md_n>clear</button></div><div><button id=md_g title="Select the named PC model, collision, attachment or unverified linked group">select model group</button> <button id=md_s>clear part selection</button> <label><input type=checkbox id=md_whole checked> expand one selected part to linked group</label></div><label><input type=checkbox id=md_show checked> draw assigned overlays in the 3D view</label><label title=\"For instances without a manual assignment, prefer Strat_SetModel / Strat_SetModelEx calls in the class entry routine. Use Strat_SetModelCollide only when no visual setter exists. Event-handler changes are ignored. Save_GetMyFlag defaults to false (intact preview); simple init-register conditions select variants; random variants use the first branch for a stable preview. All resolvable entry-spawned visual STRATs are drawn as additional model parts, including up to two spawn edges; repeated instances of the same mesh are retained at different offsets. Spawn init-register references inherit the owning instance values. Simple Strat_MoveLocalX/Y/Z offsets are previewed in the placed STRAT local axes; Robot_SneakDoor_Part prop149 is approximated as local +Z for its -4/+5 entry offsets. PopupHelp, EnterRegionToActivateStrats and StreamCheckComplete are suppressed as non-rendering triggers. Ambiguous indirect variants are skipped.\"><input type=checkbox id=md_auto checked> auto-draw from entry model calls</label><label title=\"Only classes whose spawn-time script calls Strat_ProbeGround and copies the ground height into PosY are moved; guarded by their init register when the script does so\"><input type=checkbox id=md_snap checked> snap to ground where the script does</label><label title=\"Add the selected parts to this entity/class assignment as another group instead of replacing it\"><input type=checkbox id=md_add> add as extra group (don&#39;t replace)</label><hr><b>Custom static models</b> <button id=md_custom_import>import .inimodel</button><input id=md_custom_file type=file accept=".inimodel,application/zip" style="display:none"><select id=md_custom_asset style="width:100%;margin:3px 0"></select><label class=h title="Collision type is overridden per selected placement. Use asset default to inherit the imported model&#39;s setting.">collision type · selected placement <select id=md_custom_collision style="margin-left:4px"><option value="inherit">Use asset default</option><option value="none">None</option><option value="box">Box · mesh bounds</option><option value="sphere">Sphere · enclosing radius</option><option value="cylinder" disabled title="Temporarily disabled while the Cylinder collision crash is investigated">Cylinder · vertical Y (temporarily disabled)</option><option value="mesh">Mesh · exact triangles</option></select></label><label id=md_custom_mesh_tag_wrap class=h style="display:none;margin:3px 0" title="Applies to upward-facing triangles for Box, Sphere, Cylinder and Mesh. Standable uses 0x000A; Slide-y uses 0x0001.">upward-facing surfaces <select id=md_custom_mesh_top_tag style="margin-left:4px"><option value="inherit">Use asset default</option><option value="raw" hidden>Keep raw override</option><option value="slidey">Slide-y · 0x0001</option><option value="standable">Standable · 0x000A</option></select></label><label id=md_custom_side_tag_wrap class=h style="display:none;margin:3px 0" title="Applies 0x000A to near-vertical side faces (face normal within 0.25 of horizontal). This 0x000A side-face tag has been confirmed to enable wall-running on a tested custom object.">side-facing surfaces <select id=md_custom_side_tag style="margin-left:4px"><option value="inherit">Use asset default</option><option value="raw" hidden>Keep raw override</option><option value="slidey">Slide-y · 0x0001</option><option value="walkable">Wall-running · 0x000A</option></select></label><details id=md_custom_advanced_tags style="margin:4px 0"><summary>Advanced raw material tags</summary><div class=h>Assign raw 16-bit game tags independently to upward faces, near-vertical sides and other/downward/underside faces. Suggested material names below are copied from the game&#39;s debug text material viewer. They are displayed strings, not a guarantee of physical behaviour. The 0x0101, 0x0105 and 0x010A variants display the same text as 0x0001, 0x0005 and 0x000A; the meaning of the additional 0x0100 component is not yet known. The viewer displayed no text for 0x0000 and 0x0011.</div><datalist id=md_custom_material_tag_presets><option value="0x0000" label="No text displayed by debug viewer"></option><option value="0x0001" label="Can&#39;t run on this"></option><option value="0x0002" label="Grass"></option><option value="0x0003" label="Gravel"></option><option value="0x0004" label="Gravel"></option><option value="0x0005" label="Wood (Rough)"></option><option value="0x0006" label="Wood (Polished)"></option><option value="0x0007" label="Stone"></option><option value="0x0008" label="Marble"></option><option value="0x0009" label="Carpet"></option><option value="0x000A" label="Metal (Solid)"></option><option value="0x000B" label="Metal (Hollow)"></option><option value="0x000C" label="Glass"></option><option value="0x000D" label="Water"></option><option value="0x000E" label="Speed Boost"></option><option value="0x000F" label="Slippy"></option><option value="0x0010" label="Sticky"></option><option value="0x0011" label="No text displayed by debug viewer"></option><option value="0x0101" label="Can&#39;t run on this · 0x0100 variant; extra meaning unknown"></option><option value="0x0105" label="Wood (Rough) · 0x0100 variant; extra meaning unknown"></option><option value="0x010A" label="Metal (Solid) · 0x0100 variant; extra meaning unknown"></option></datalist><div style="display:grid;grid-template-columns:1fr 1fr;gap:3px;margin-top:4px"><label>Upward tag <input id=md_custom_up_tag_value type=text list=md_custom_material_tag_presets placeholder="0x000A" style="width:100%;box-sizing:border-box"></label><label>Label / note <input id=md_custom_up_tag_label type=text maxlength=48 placeholder="e.g. Sand" style="width:100%;box-sizing:border-box"></label><label>Side tag <input id=md_custom_side_tag_value type=text list=md_custom_material_tag_presets placeholder="0x000A" style="width:100%;box-sizing:border-box"></label><label>Label / note <input id=md_custom_side_tag_label type=text maxlength=48 placeholder="e.g. Metal" style="width:100%;box-sizing:border-box"></label><label>Other / downward / underside tag <input id=md_custom_other_tag_value type=text list=md_custom_material_tag_presets placeholder="0x0001" style="width:100%;box-sizing:border-box"></label><label>Label / note <input id=md_custom_other_tag_label type=text maxlength=48 placeholder="e.g. Wood" style="width:100%;box-sizing:border-box"></label></div><div style="display:flex;justify-content:flex-end;margin-top:4px"><button id=md_custom_tag_reset type=button>clear raw overrides</button></div></details><div id=md_custom_info class=h>No custom model assets imported.</div><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:3px"><label>x <input id=md_cx type=number value=0 step=1 style="width:100%"></label><label>y <input id=md_cy type=number value=0 step=1 style="width:100%"></label><label>z <input id=md_cz type=number value=0 step=1 style="width:100%"></label><label>yaw° <input id=md_cry type=number value=0 step=15 style="width:100%"></label><label>scale <input id=md_cs type=number value=1 min=0.001 step=0.1 style="width:100%"></label></div><label style="display:block;margin:3px 0">instance name <input id=md_custom_name type=text value="Custom model" style="width:100%;box-sizing:border-box"></label><div style="display:flex;gap:4px;flex-wrap:wrap"><button id=md_custom_add>Add instance</button><button id=md_custom_update>update selected</button><button id=md_custom_duplicate>duplicate selected</button><button id=md_custom_remove>remove selected</button></div><select id=md_custom_instance style="width:100%;margin:3px 0"></select><label><input type=checkbox id=md_custom_show checked> show custom model previews</label><div id=md_custom_status class=h>Import one or more .inimodel assets and add independent placements. Box, Sphere and indexed Mesh collision are selectable. Cylinder remains visible but is temporarily disabled while its game crash is investigated. Collision type and surface tags are independently configurable per placement. Upward faces can be Standable (0x000A); near-vertical sides can be Wall-running (0x000A); wall-running has been confirmed on a tested custom object. Advanced raw 16-bit tags can be assigned by face orientation, with optional project-only labels. The build installs or reuses one self-contained INIGenericCollision class per destination LCS; every placed object gets its own initial-register block, private model/collision table and private CollMesh. Placement remains compatible with the standard Editor inspector for moving, rotating, duplicating and deleting.</div><div class=h>Native collision supports None, Box, Sphere and Mesh for a single opaque mesh/material with uniform positive scale. Cylinder remains visible in the selection list but is temporarily disabled for new choices while its game crash is investigated; legacy Cylinder settings are retained for compatibility. Box follows the mesh AABB; Sphere encloses the AABB corners; Cylinder is vertical on Y; Mesh writes the exact indexed triangles into retail PC triangle strips, split across KD leaves with the Step 103 six-bound markers. Per-placement upward tagging applies to Box, Sphere, Cylinder and Mesh: Standable uses 0x000A, Slide-y uses 0x0001. Side tagging applies to near-vertical faces: Wall-running uses 0x000A, Slide-y uses 0x0001. User testing confirmed that the 0x000A side tag enables wall-running on a custom object. Advanced raw 16-bit tags override the upward, side and other/downward orientation groups independently; optional labels are project notes only. Mesh colliders preserve open surfaces as exported; they do not cap holes or repair non-manifold topology.</div><div class=h>Existing-model overlay assignments remain view-only and do not copy mesh/texture resources into the game level.</div></div>';
document.body.appendChild(mp);
const r2c=document.getElementById('md_c'),ren=new THREE.WebGLRenderer({canvas:r2c,antialias:true}),sc2=new THREE.Scene(),cam2=new THREE.PerspectiveCamera(40,340/240,.01,5000);ren.setSize(340,240,false);
let oy=.6,op=.35,od=5,oc=new Viewer.V3();
function pv(){cam2.position.set(oc.x+od*Math.sin(oy)*Math.cos(op),oc.y+od*Math.sin(op),oc.z+od*Math.cos(oy)*Math.cos(op));cam2.lookAt(oc);ren.render(sc2,cam2)}
function preview(){modelPreviewDynamicMaterials.clear();for(const c of[...sc2.children])sc2.remove(c);const w=Viewer.$('md_w').value,L=modelsOf(w),selEl=Viewer.$('md_l');
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
 else for(const x of mem){const G=geoOf(w,x.off,x.poff);if(!G)continue;const mats=G.materials?.length?G.materials:[G.mat];for(let mi=0;mi<mats.length;mi++){if(modelMaterialPassIsDynamic(mats[mi].userData?.pass))modelPreviewDynamicMaterials.add(mats[mi]);const mesh=new THREE.Mesh(G.g,mats[mi]);if((mats[mi].userData?.layerCount||0)>1)mesh.renderOrder=100+(mats[mi].userData.layerIndex||0);sc2.add(mesh)}drawn++;tris+=x.idx.length/3;verts+=x.nv;if(x.tex)texSet.add(x.tex.w+'x'+x.tex.h);for(let q=0;q<3;q++){mn[q]=Math.min(mn[q],x.bb[0][q]);mx[q]=Math.max(mx[q],x.bb[1][q])}}
 const collMode=Viewer.$('md_coll_view')?.value||'off',showKd=!!Viewer.$('md_coll_kd')?.checked,showLeafRegions=!!Viewer.$('md_coll_leaf_regions')?.checked,collSource=activeGroup?.collMesh?collisionOf(w,activeGroup.collMesh):null;
 if(collSource?.data?.valid){if(collMode!=='off')addCollisionVisual(sc2,collSource,collMode);if(showKd||showLeafRegions)addKdTreeVisual(sc2,collSource.data,showKd,showLeafRegions);const cb=collSource.data.bounds;if(cb)for(let q=0;q<3;q++){mn[q]=Math.min(mn[q],cb[0][q]);mx[q]=Math.max(mx[q],cb[1][q])}}
 const cInfo=Viewer.$('md_coll_info'),cDetail=Viewer.$('md_coll_detail'),collRef=activeGroup?.collMeshRefs?.length===1?activeGroup.collMeshRefs[0]:null,registration=collRef?.registration==='instance-init-register'?' · per-instance r'+collRef.register+' table':collRef?' · script table':'',instanceLabel=collRef?.instanceIndex!=null?' · instance #'+collRef.instanceIndex:'';if(cInfo)cInfo.textContent=activeGroup?.collMesh?collisionSummary(collSource)+registration+instanceLabel:activeGroup?.collMeshAmbiguous?'Multiple instances use different CollMeshes for this shared descriptor; select a specific instance to inspect its collider.':'Selected record has no resolved Strat_SetModelCollide CollMesh pointer.';if(cDetail)cDetail.textContent=activeGroup?.collMesh?collisionDetail(collSource)+(collRef?'\n\nREGISTRATION\nPath: '+(collRef.registration||'script-literal-table')+'\nTable address: 0x'+collRef.table.toString(16)+(collRef.register!=null?'\nInitial register: r'+collRef.register:'')+(collRef.instanceIndex!=null?'\nSTRAT instance index: '+collRef.instanceIndex+'\nInstance record: 0x'+collRef.instanceOffset.toString(16)+'\nInitial register block: 0x'+collRef.initOffset.toString(16):''):''):collisionDetail(null);
 if(!drawn){mCur=null;Viewer.$('md_i').textContent='The selected parts do not have renderable geometry.';pv();return}
 oc.set((mn[0]+mx[0])/2,(mn[1]+mx[1])/2,(mn[2]+mx[2])/2);od=Math.max(mx[0]-mn[0],mx[1]-mn[1],mx[2]-mn[2],.1)*2.2;
 const rows=[...selEl.selectedOptions],hidden=rows.filter(o=>o.hidden).length;
 let label=focusedGroup?registryGroupCaption(focusedGroup,mem.length):(whole?modelGroupCaption(M,mem.length):'exact selection: '+mem.length+' part'+(mem.length===1?'':'s'));
 if(chosen.length===1&&groupMembers.length>1&&!whole)label+=' ('+modelGroupCaption(M,groupMembers.length)+')';
 if(chosen.length===1&&groupMembers.length>=32&&whole&&(!M.modelGroup||M.modelKind==='component'))label+=' — large unverified group; inspect before using';
 if(hidden)label+='; '+hidden+' selected part'+(hidden===1?' is':'s are')+' hidden by filter';
 const partList=mem.map(x=>'#'+L.indexOf(x)+(x.modelPartLabel?' '+x.modelPartLabel:'')).join(', ');
 const group=focusedGroup||L.modelGroupById?.get(M.modelGroup)||L.modelGroups?.find(g=>g.id===M.modelGroup),desc=(group?.descriptor??M.modelDescriptor)!=null?' · descriptor 0x'+(group?.descriptor??M.modelDescriptor).toString(16):'',roots=group?.rootDetails?.length?' · roots: '+group.rootDetails.map(r=>'+'+r.offset.toString(16)+'→#'+L.findIndex(x=>x.poff===r.part)+' '+r.role).join('; '):'';
 const classes=(group?.classes?.length||M.modelClasses?.length)?' · class: '+(group?.classes||M.modelClasses).join(', '):'',entryClasses=group?.entryClasses?.length?' · entry setter: '+group.entryClasses.join(', '):'',handlerClasses=group?.handlerClasses?.length?' · handler-only setter: '+group.handlerClasses.join(', '):'';
 const span=(mx[0]-mn[0]).toFixed(1)+' × '+(mx[1]-mn[1]).toFixed(1)+' × '+(mx[2]-mn[2]).toFixed(1);
 let detail='parts: '+partList+desc+roots+classes+entryClasses+handlerClasses;if(M.modelMembershipConflict)detail+=' · WARNING: multiple script model descriptors claim this part';if(M.modelAlsoIn?.length)detail+=' · retained alternate memberships: '+M.modelAlsoIn.map(id=>L.modelGroupById?.get(id)?.displayName||id).join(', ');
 if(M.modelReviewNote)detail+=' · '+M.modelReviewNote;if(M.modelCandidateGroups?.length)detail+=' · oversized/unverified descriptor candidates: '+M.modelCandidateGroups.map(id=>{const g=L.modelGroupById?.get(id);return(g?.name||id)+(g?.descriptor!=null?' @0x'+g.descriptor.toString(16):'')}).join(', ');
 if(debugProxy)detail+=' · expected debug-cube proxy only; raw part #0 currently parses as three narrow planes. Overlay/copy actions are disabled while this proxy is shown.';
 Viewer.$('md_i').textContent=label+' · '+verts+' verts · '+tris+' tris · '+span+' · textures: '+(texSet.size?[...texSet].join(', '):'none')+' · '+detail;pv()}
setEntityOverlayUpdater(updateModelMaterialPreviews);
const escM=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function filterM(){const w=Viewer.$('md_w').value,L=modelsOf(w),sel=Viewer.$('md_l'),q=Viewer.$('md_q').value.trim().toLowerCase().replace(/^#/,'');
 for(const o of sel.options){const M=L[+o.value],hay=[o.textContent,o.value,M?.name,M?.modelName,M?.modelInternalName,M?.modelPartLabel,M?.modelReviewNote,M?.modelKind,M?.modelSource,(M?.modelClasses||[]).join(' '),(M?.modelNatives||[]).join(' '),(M?.modelMemberships||[]).map(id=>{const g=L.modelGroupById?.get(id);return(g?.displayName||g?.name||id)+' '+(g?.classes||[]).join(' ')+' '+(g?.entryClasses||[]).join(' ')+' '+(g?.handlerClasses||[]).join(' ')}).join(' '),(M?.modelCandidateGroups||[]).map(id=>L.modelGroupById?.get(id)?.name||id).join(' '),M?.gid,M?.off?.toString(16),M?.poff?.toString(16),M?.tex?M.tex.w+'x'+M.tex.h:''].join(' ').toLowerCase();o.hidden=!!q&&!hay.includes(q)}
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
 Viewer.$('md_w').innerHTML=ws.map(n=>'<option>'+n+'</option>').join('');if(cur)Viewer.$('md_w').value=cur;Viewer.$('md_q').value='';Viewer.$('md_l').innerHTML='';if(Viewer.sel&&Viewer.sel.p){['md_cx','md_cy','md_cz'].forEach((id,i)=>Viewer.$(id).value=Number(Viewer.sel.p[i]||0).toFixed(2))}fillM();refreshCustomUi()};
Viewer.$('md_x').onclick=()=>{mp.style.display='none'};Viewer.$('md_w').onchange=()=>{Viewer.$('md_l').innerHTML='';fillM();refreshCustomUi();if(selectedCustomInstance())loadCustomPlacementFields()};Viewer.$('md_l').onchange=()=>{mGroupFocus=null;Viewer.$('md_groups').value='';preview()};Viewer.$('md_q').oninput=filterM;Viewer.$('md_show').onchange=drawModels;Viewer.$('md_auto').onchange=drawModels;Viewer.$('md_snap').onchange=drawModels;Viewer.$('md_whole').onchange=preview;Viewer.$('md_raw').onchange=preview;Viewer.$('md_coll_view').onchange=()=>{preview();drawModels()};Viewer.$('md_coll_kd').onchange=()=>{preview();drawModels()};Viewer.$('md_coll_leaf_regions').onchange=()=>{preview();drawModels()};
Viewer.$('md_usegroup').onclick=()=>{const L=modelsOf(Viewer.$('md_w').value),id=Viewer.$('md_groups').value,g=L.modelGroupById?.get(id);if(!g)return;const wanted=new Set((g.parts||[]).map(p=>p.p));mGroupFocus=id;for(const o of Viewer.$('md_l').options)o.selected=wanted.has(L[+o.value]?.poff);preview()};
Viewer.$('md_g').onclick=()=>{const L=modelsOf(Viewer.$('md_w').value),s=Viewer.$('md_l'),first=[...s.selectedOptions].map(o=>L[+o.value]).find(Boolean);if(!first)return;const id=mGroupFocus||first.modelGroup,g=id&&L.modelGroupById?.get(id);if(!g)return;Viewer.$('md_groups').value=id;mGroupFocus=id;const wanted=new Set((g.parts||[]).map(p=>p.p));for(const o of s.options)o.selected=wanted.has(L[+o.value]?.poff);preview()};
Viewer.$('md_s').onclick=()=>{for(const o of Viewer.$('md_l').options)o.selected=false;preview()};
let md=null;r2c.onmousedown=e=>{md=[e.clientX,e.clientY]};addEventListener('mouseup',()=>{md=null});addEventListener('mousemove',e=>{if(!md)return;oy-=(e.clientX-md[0])*.01;op=Math.max(-1.5,Math.min(1.5,op+(e.clientY-md[1])*.01));md=[e.clientX,e.clientY];pv()});r2c.onwheel=e=>{e.preventDefault();od*=e.deltaY>0?1.1:.9;pv()};
const asg=cls=>{if(mCur?.previewProxy){Viewer.$('md_i').textContent='Switch to the extracted raw mesh before saving an overlay; the debug cube is an editor-only visual proxy.';return}if(!Viewer.sel||!mCur||!mCur.parts?.length){Viewer.$('md_i').textContent='Select an entity in the 3D view and one or more mesh parts first.';return}const tw=wadOf(Viewer.sel.L);if(!tw)return;getProject().models=getProject().models||{};getProject().scripts=getProject().scripts||{};const M=getProject().models[tw]=getProject().models[tw]||{};const first=mCur.parts[0],entry={w:mCur.w,parts:mCur.parts.map(x=>({m:x.m,p:x.p})),m:first.m,p:first.p,ry:+Viewer.$('md_r').value||0,modelName:mCur.modelName||null,modelKind:mCur.modelKind||null,modelSource:mCur.modelSource||null,modelInternalName:mCur.modelInternalName||null,modelDescriptor:mCur.modelDescriptor??null,groupId:mCur.groupId||null,modelVerified:!!mCur.modelVerified,modelClasses:mCur.modelClasses||[],modelMemberships:mCur.modelMemberships||[],modelNatives:mCur.modelNatives||[]};if(mCur.groupOnly&&mCur.groupId)entry.groupId=mCur.groupId;const key=cls?'c:'+Viewer.sel.n:'i:'+Viewer.sel.i,prev=M[key];if(Viewer.$('md_add')&&Viewer.$('md_add').checked&&prev){prev.more=(prev.more||[]).concat([{parts:entry.parts,groupId:entry.groupId,modelName:entry.modelName}])}else M[key]=entry;drawModels();summary()};
Viewer.$('md_a').onclick=()=>asg(false);Viewer.$('md_k').onclick=()=>asg(true);
Viewer.$('md_n').onclick=()=>{if(!Viewer.sel)return;const M=getProject().models&&getProject().models[wadOf(Viewer.sel.L)];if(M){delete M['i:'+Viewer.sel.i];delete M['c:'+Viewer.sel.n]}drawModels()};


 
 Viewer.$('md_custom_import').onclick=()=>Viewer.$('md_custom_file').click();
 Viewer.$('md_custom_file').onchange=async e=>{const f=e.target.files&&e.target.files[0];if(!f)return;try{const bytes=new Uint8Array(await f.arrayBuffer()),data=parseIninjaModelBundle(bytes),w=Viewer.$('md_w').value;if(!w)throw'choose a target level first';if(!getWad(w))throw'load the target level before importing a model';const C=customStore(w),id='cm_'+Date.now().toString(36)+'_'+(++customSeq).toString(36),manifestCollision=String(data.manifest.collision?.type||'none').toLowerCase(),record={id,name:data.manifest.name||f.name.replace(/\.inimodel$/i,''),sourceName:f.name,byteLength:bytes.length,bundle:bytesToBase64(bytes),collisionType:['none','box','sphere','mesh'].includes(manifestCollision)?manifestCollision:'none',requestedCollisionType:manifestCollision,collisionTopTag:data.manifest.collision?.topTagMode||'slidey',collisionSideTag:data.manifest.collision?.sideTagMode||'slidey',collisionOutputPaused:false};C.assets.push(record);customParsed.set(w+'|'+id,{bundle:record.bundle,data});Viewer.$('md_custom_asset').value=id;
  const level=Viewer.D.find(l=>wadOf(l.id)===w),selected=Viewer.sel&&Viewer.sel.L===level?.id?Viewer.sel.p:null,aim=selected||Viewer.ggame(Viewer.camera.position.clone().addScaledVector(Viewer.fwd(),25));
  const pos=selected?[selected[0]+2,selected[1],selected[2]]:[aim[0],Math.max(0,aim[1]),aim[2]],same=C.instances.filter(x=>x.assetId===id).length;
  const inst={id:'cmi_'+Date.now().toString(36)+'_'+(++customSeq).toString(36),assetId:id,name:record.name+' '+(same+1),position:pos,rotation:[0,0,0],scale:[1,1,1]};C.instances.push(inst);
  refreshCustomUi();Viewer.$('md_custom_instance').value=String(C.instances.length-1);loadCustomPlacementFields();Viewer.$('md_custom_status').textContent='Imported '+record.name+' and placed it in '+w+'. It is now a selectable object in the 3D view; use the standard Editor inspector to move, rotate, copy/paste or delete it. '+(manifestCollision==='cylinder'?'The model requested Cylinder collision, which is temporarily disabled; collision defaulted to None. ':'')+'Build patched .vol to include it in-game.';summary();drawModels();focusCustomInstance(w,inst.id)}catch(x){Viewer.$('md_custom_status').textContent='Import failed: '+(x.message||x);console.error(x)}finally{e.target.value=''}};
 Viewer.$('md_custom_asset').onchange=refreshCustomUi;
 Viewer.$('md_custom_collision').onchange=()=>{const selected=selectedCustomInstance();if(!selected){Viewer.$('md_custom_status').textContent='Select a placed model first; collision type is stored per placement.';return;}const requested=Viewer.$('md_custom_collision').value;if(requested==='cylinder'){Viewer.$('md_custom_status').textContent='Cylinder collision is temporarily disabled while its game crash is investigated. Existing saved Cylinder settings are preserved, but new placements should use Box, Sphere or Mesh.';refreshCustomUi();return;}if(requested==='inherit')delete selected.instance.collisionType;else selected.instance.collisionType=['none','box','sphere','mesh'].includes(requested)?requested:'none';const effective=customInstanceCollisionSettings(customRec(selected.w,selected.instance.assetId),selected.instance,parsedCustom(selected.w,customRec(selected.w,selected.instance.assetId))).type;const labels={none:'No native custom collision',box:'Bounds-based Box collision',sphere:'Bounding Sphere collision',cylinder:'Vertical Y-axis Cylinder collision',mesh:'Exact indexed-triangle Mesh collision'};Viewer.$('md_custom_status').textContent=(labels[effective]||'Collision')+' is now set for '+(selected.instance.name||'this placement')+' only. Other placements using the same imported asset are unchanged.';refreshCustomUi();summary();drawCustomModels()};
 Viewer.$('md_custom_mesh_top_tag').onchange=()=>{const selected=selectedCustomInstance();if(!selected){Viewer.$('md_custom_status').textContent='Select a placed model first; surface tags are stored per placement.';return;}const mode=Viewer.$('md_custom_mesh_top_tag').value;if(mode==='raw'){refreshCustomUi();return;}delete selected.instance.collisionUpwardMaterialTag;delete selected.instance.collisionUpwardMaterialLabel;if(mode==='inherit')delete selected.instance.collisionTopTag;else selected.instance.collisionTopTag=mode==='standable'?'standable':'slidey';Viewer.$('md_custom_status').textContent='Upward-facing surfaces for '+(selected.instance.name||'this placement')+' will use '+(mode==='inherit'?'the asset default':mode==='standable'?'0x000A (standable)':'0x0001 (slide-y)')+'.';refreshCustomUi();summary();drawCustomModels()};
 Viewer.$('md_custom_side_tag').onchange=()=>{const selected=selectedCustomInstance();if(!selected){Viewer.$('md_custom_status').textContent='Select a placed model first; surface tags are stored per placement.';return;}const mode=Viewer.$('md_custom_side_tag').value;if(mode==='raw'){refreshCustomUi();return;}delete selected.instance.collisionSideMaterialTag;delete selected.instance.collisionSideMaterialLabel;if(mode==='inherit')delete selected.instance.collisionSideTag;else selected.instance.collisionSideTag=mode==='walkable'?'walkable':'slidey';Viewer.$('md_custom_status').textContent='Side-facing surfaces for '+(selected.instance.name||'this placement')+' will use '+(mode==='inherit'?'the asset default':mode==='walkable'?'0x000A (wall-walkable test tag)':'0x0001 (slide-y)')+'. This tag is experimental and does not guarantee wall-running.';refreshCustomUi();summary();drawCustomModels()};
 const parseRawMaterialTag=value=>{const text=String(value||'').trim();if(!text)return null;const n=/^0x[0-9a-f]{1,4}$/i.test(text)?parseInt(text.slice(2),16):/^[0-9]{1,5}$/.test(text)?Number(text):NaN;if(!Number.isInteger(n)||n<0||n>0xffff)throw'Enter a hexadecimal tag such as 0x000A (or a decimal value from 0 to 65535)';return n};
 const rawTagBindings=[
  {input:'md_custom_up_tag_value',label:'md_custom_up_tag_label',field:'collisionUpwardMaterialTag',labelField:'collisionUpwardMaterialLabel',name:'upward'},
  {input:'md_custom_side_tag_value',label:'md_custom_side_tag_label',field:'collisionSideMaterialTag',labelField:'collisionSideMaterialLabel',name:'side'},
  {input:'md_custom_other_tag_value',label:'md_custom_other_tag_label',field:'collisionOtherMaterialTag',labelField:'collisionOtherMaterialLabel',name:'other'}
 ];
 for(const binding of rawTagBindings){
  const input=Viewer.$(binding.input),labelInput=Viewer.$(binding.label);
  if(input)input.onchange=()=>{const selected=selectedCustomInstance();if(!selected)return;try{const tag=parseRawMaterialTag(input.value);if(tag==null){delete selected.instance[binding.field];delete selected.instance[binding.labelField];if(labelInput)labelInput.value='';}else selected.instance[binding.field]=tag;Viewer.$('md_custom_status').textContent=tag==null?'Cleared the '+binding.name+' raw material-tag override.':binding.name+' surfaces now emit raw material tag 0x'+tag.toString(16).toUpperCase().padStart(4,'0')+'.';refreshCustomUi();summary();drawCustomModels();}catch(e){Viewer.$('md_custom_status').textContent='Invalid material tag: '+(e.message||e);refreshCustomUi();}};
  if(labelInput)labelInput.onchange=()=>{const selected=selectedCustomInstance();if(!selected)return;const value=String(labelInput.value||'').trim().slice(0,48);if(value)selected.instance[binding.labelField]=value;else delete selected.instance[binding.labelField];Viewer.$('md_custom_status').textContent='Saved the '+binding.name+' material-tag note. The label is for editor reference; only the numeric tag is written to the game.';refreshCustomUi();summary();};
 }
 Viewer.$('md_custom_tag_reset').onclick=()=>{const selected=selectedCustomInstance();if(!selected)return;for(const binding of rawTagBindings){delete selected.instance[binding.field];delete selected.instance[binding.labelField];}Viewer.$('md_custom_status').textContent='Cleared all raw material-tag overrides. The existing Standable / Wall-running presets or asset defaults now apply.';refreshCustomUi();summary();drawCustomModels()};
 Viewer.$('md_custom_instance').onchange=()=>{const selected=selectedCustomInstance();if(!selected)return;const asset=customRec(selected.w,selected.instance.assetId);if(asset)Viewer.$('md_custom_asset').value=asset.id;refreshCustomUi();loadCustomPlacementFields();focusCustomInstance(selected.w,selected.instance.id)};
 const readCustomPlacementFields=()=>{const num=id=>{const v=Number(Viewer.$(id).value);if(!Number.isFinite(v))throw id+' must be a finite number';return v};const scale=num('md_cs');if(scale<=0)throw'scale must be positive';return{name:(Viewer.$('md_custom_name').value||'Custom model').trim()||'Custom model',position:[num('md_cx'),num('md_cy'),num('md_cz')],rotation:[0,num('md_cry'),0],scale:[scale,scale,scale]}};
 Viewer.$('md_custom_add').onclick=()=>{try{const w=Viewer.$('md_w').value;if(!w||!getWad(w))throw'choose a loaded target level first';const a=customRec(w,Viewer.$('md_custom_asset').value);if(!a)throw'choose an imported model first';const C=customStore(w),placement=readCustomPlacementFields(),same=C.instances.filter(x=>x.assetId===a.id).length;const inst={id:'cmi_'+Date.now().toString(36)+'_'+(++customSeq).toString(36),assetId:a.id,name:placement.name==='Custom model'?a.name+' '+(same+1):placement.name,...placement};C.instances.push(inst);Viewer.$('md_custom_instance').value=String(C.instances.length-1);Viewer.$('md_custom_status').textContent='Added '+inst.name+' to '+w+' at '+inst.position.map(v=>v.toFixed(1)).join(', ')+'. This is an independent placement and is selectable with the standard Editor controls.';summary();drawModels();focusCustomInstance(w,inst.id)}catch(x){Viewer.$('md_custom_status').textContent='Could not add instance: '+(x.message||x)}};
 Viewer.$('md_custom_update').onclick=()=>{try{const selected=selectedCustomInstance();if(!selected)throw'select a placed instance first';const asset=customRec(selected.w,Viewer.$('md_custom_asset').value);if(!asset)throw'choose an imported model first';const placement=readCustomPlacementFields(),old=selected.instance;Object.assign(old,placement,{assetId:asset.id});Viewer.$('md_custom_status').textContent='Updated '+old.name+'. Its model, position, yaw and scale will be used by the next patched VOL build.';summary();drawModels();focusCustomInstance(selected.w,old.id)}catch(x){Viewer.$('md_custom_status').textContent='Could not update instance: '+(x.message||x)}};
 Viewer.$('md_custom_duplicate').onclick=()=>{try{const selected=selectedCustomInstance();if(!selected)throw'select a placed instance first';const src=selected.instance,copy={...src,id:'cmi_'+Date.now().toString(36)+'_'+(++customSeq).toString(36),name:(src.name||'Custom model')+' copy',position:[...(src.position||[0,0,0])],rotation:[...(src.rotation||[0,0,0])],scale:[...(src.scale||[1,1,1])]};copy.position[0]+=2;selected.C.instances.push(copy);Viewer.$('md_custom_status').textContent='Duplicated '+(src.name||src.assetId)+' as '+copy.name+' with a 2-unit X offset. It is independently selectable with the standard Editor controls.';summary();drawModels();focusCustomInstance(selected.w,copy.id)}catch(x){Viewer.$('md_custom_status').textContent='Could not duplicate instance: '+(x.message||x)}};
 Viewer.$('md_custom_remove').onclick=()=>{const selected=selectedCustomInstance();if(!selected)return;const [gone]=selected.C.instances.splice(selected.i,1);Viewer.$('md_custom_status').textContent='Removed '+(gone.name||gone.assetId)+'. It will no longer be emitted on the next build.';summary();drawModels();syncCustomEntities(selected.C.instances[Math.min(selected.i,selected.C.instances.length-1)]?.id||null)};
 Viewer.$('md_custom_show').onchange=drawCustomModels;
 return { customInstanceChanged, resetCaches(){ MC={}; GC={}; modelMaterialResources.clear(); modelTextureCache.clear(); modelPreviewDynamicMaterials.clear(); modelOverlayDynamicMaterials.clear(); customParsed.clear(); for(const x of customTextures.values())x.dispose?.(); for(const x of customGeometries.values())x.dispose?.(); for(const x of customMaterials.values())x.dispose?.(); for(const x of collisionGeometries.values()){x.geo?.dispose?.();x.edges?.dispose?.()} for(const x of collisionStyleMaterials.values()){x.fill?.dispose?.();x.line?.dispose?.()} collisionGeometries.clear();collisionStyleMaterials.clear();for(const x of primitivePreviewGeometries.values()){x.geo?.dispose?.();x.edges?.dispose?.()}primitivePreviewGeometries.clear();customTextures.clear();customGeometries.clear();customMaterials.clear(); try{drawModels();drawCustomModels();preview()}catch(e){} } };
}
