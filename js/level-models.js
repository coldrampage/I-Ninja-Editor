// Stage 1: import and preview Blender .inilevel interchange bundles.
// This is deliberately a viewer/project feature; it does not write native LCM/VOL data.
import {parseIninjaLevelBundle, bytesToBase64, base64ToBytes, editorPreviewUvs} from './custom-models.js?v=step146-strat-appearance-preview';
import {parseTga, alphaProps, readWad, instances as parseLcsInstances} from './vol-core.js?v=step146-strat-appearance-preview';

const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const MATERIAL_TAG_NAMES={'0x0000':'(no debug text)','0x0001':"Can't run on this",'0x0002':'Grass','0x0003':'Gravel','0x0004':'Gravel','0x0005':'Wood (Rough)','0x0006':'Wood (Polished)','0x0007':'Stone','0x0008':'Marble','0x0009':'Carpet','0x000A':'Metal (Solid)','0x000B':'Metal (Hollow)','0x000C':'Glass','0x000D':'Water','0x000E':'Speed Boost','0x000F':'Slippy','0x0010':'Sticky','0x0011':'(no debug text)','0x0101':"Can't run on this",'0x0105':'Wood (Rough)','0x010A':'Metal (Solid)'};
function tagColour(tag){
  // Stable, deliberately high-contrast colours so adjacent collision tags remain distinguishable.
  const h=((Number(tag)*0.137508)+0.09)%1,s=0.72,l=0.52;
  const hue=(p,q,t)=>{if(t<0)t+=1;if(t>1)t-=1;if(t<1/6)return p+(q-p)*6*t;if(t<1/2)return q;if(t<2/3)return p+(q-p)*(2/3-t)*6;return p};
  const q=l<.5?l*(1+s):l+s-l*s,p=2*l-q;
  return [hue(p,q,h+1/3),hue(p,q,h),hue(p,q,h-1/3)];
}
function tgaImage(bytes){
  if(!bytes)return null;
  const wrapped=new Uint8Array(0x20+bytes.length);wrapped.set(bytes,0x20);
  // parseTga expects a retail texture wrapper, whose data pointer is normally +0x20.
  // Zeroing the synthetic pointer selects its documented +0x20 fallback.
  new DataView(wrapped.buffer).setUint32(0x10,0,true);
  return parseTga(wrapped,0);
}
function materialFor(meta,textureBytes,THREE,options){
  let image=null,map=null;
  if(meta.texture&&textureBytes){
    image=tgaImage(textureBytes);
    if(image){map=new THREE.DataTexture(image.rgba,image.w,image.h,THREE.RGBAFormat);map.wrapS=map.wrapT=THREE.RepeatWrapping;map.magFilter=THREE.LinearFilter;map.minFilter=THREE.LinearMipmapLinearFilter;map.generateMipmaps=true;map.needsUpdate=true}
  }
  const alpha=meta.baseColor[3],ap=alphaProps(image);
  const blend=meta.blendMode==='additive'?THREE.AdditiveBlending:meta.blendMode==='subtractive'?THREE.SubtractiveBlending:THREE.NormalBlending;
  const material=new THREE.MeshBasicMaterial({map:options.textures?map:null,color:new THREE.Color(meta.baseColor[0],meta.baseColor[1],meta.baseColor[2]),vertexColors:!!options.vertexColors,
    side:meta.doubleSided?THREE.DoubleSide:THREE.FrontSide,transparent:meta.alphaMode==='BLEND'||ap.transparent||alpha<.999,
    alphaTest:meta.alphaMode==='MASK'?meta.alphaCutoff:ap.alphaTest||0,opacity:alpha,
    depthWrite:meta.alphaMode!=='BLEND'&&!ap.transparent,blending:blend});material.userData=material.userData||{};material.userData.levelTexture=map;return material;
}
function computeBounds(data){
  const b=[Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity];
  const add=(p)=>{for(let i=0;i<p.length;i+=3){const x=p[i],y=p[i+1],z=p[i+2];if(!Number.isFinite(x+y+z))continue;b[0]=Math.min(b[0],x);b[1]=Math.min(b[1],y);b[2]=Math.min(b[2],z);b[3]=Math.max(b[3],x);b[4]=Math.max(b[4],y);b[5]=Math.max(b[5],z)}};
  for(const m of data.meshes)add(m.positions);
  if(data.collision)add(data.collision.positions);
  return Number.isFinite(b[0])?b:null;
}
function collisionGeometry(collision,THREE){
  const positions=collision.positions,faceCount=collision.triangleCount;
  const colors=new Float32Array(faceCount*9),wirePositions=new Float32Array(faceCount*18),wireColors=new Float32Array(faceCount*18);
  for(let t=0;t<faceCount;t++){
    const rgb=tagColour(collision.tags[t]),po=t*9,wo=t*18;
    for(let k=0;k<3;k++){colors.set(rgb,po+k*3);wirePositions.set(positions.subarray(po+k*3,po+k*3+3),wo+k*6)}
    const edgePairs=[[0,1],[1,2],[2,0]];let q=wo;
    for(const[a,b]of edgePairs){wirePositions.set(positions.subarray(po+a*3,po+a*3+3),q);wirePositions.set(positions.subarray(po+b*3,po+b*3+3),q+3);wireColors.set([...rgb,...rgb],q);q+=6}
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));geometry.computeVertexNormals();
  const fill=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.DoubleSide,transparent:true,opacity:.25,depthWrite:false}));
  const lineGeometry=new THREE.BufferGeometry();lineGeometry.setAttribute('position',new THREE.BufferAttribute(wirePositions,3));lineGeometry.setAttribute('color',new THREE.BufferAttribute(wireColors,3));
  const lines=new THREE.LineSegments(lineGeometry,new THREE.LineBasicMaterial({vertexColors:true,transparent:true,opacity:.95}));
  const group=new THREE.Group();group.add(fill,lines);group.visible=false;
  return {group,fill,lines,geometry,lineGeometry};
}
function buildLevelModelPreview(data,THREE,initial={}){
  const settings={renderVisible:initial.renderVisible!==false,textures:initial.textures!==false,vertexColors:initial.vertexColors!==false,collisionMode:initial.collisionMode||'off'};
  const root=new THREE.Group(),renderGroup=new THREE.Group(),collisionGroup=new THREE.Group(),materials=[],textures=[];
  root.name=data.manifest.name||'Imported level model';root.userData.editorPersistentOverlay=true;root.add(renderGroup,collisionGroup);
  const materialCache=data.materials.map(m=>{const raw=m.texture&&data.textures.get(m.texture),mat=materialFor(m,raw,THREE,settings);materials.push(mat);if(mat.userData.levelTexture)textures.push(mat.userData.levelTexture);return mat});
  for(const part of data.meshes){
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.BufferAttribute(part.positions,3));
    const rgb=new Float32Array(part.vertexCount*3);
    for(let v=0;v<part.vertexCount;v++){rgb[v*3]=part.colors[v*4]/255;rgb[v*3+1]=part.colors[v*4+1]/255;rgb[v*3+2]=part.colors[v*4+2]/255}
    geometry.setAttribute('color',new THREE.BufferAttribute(rgb,3));
    geometry.setAttribute('uv',new THREE.BufferAttribute(editorPreviewUvs(part.uvs),2));
    geometry.setIndex(new THREE.BufferAttribute(part.indices,1));geometry.computeVertexNormals();
    const mesh=new THREE.Mesh(geometry,materialCache[part.material]);mesh.name=part.name;mesh.userData={kind:'inilevel-render',material:part.material};renderGroup.add(mesh);
  }
  let coll=null;if(data.collision){coll=collisionGeometry(data.collision,THREE);collisionGroup.add(coll.group)}
  renderGroup.visible=settings.renderVisible;
  collisionGroup.visible=settings.collisionMode!=='off'&&!!coll;
  if(coll){coll.group.visible=settings.collisionMode!=='off';coll.fill.visible=settings.collisionMode==='solid'||settings.collisionMode==='ghost';coll.lines.visible=settings.collisionMode==='wire'||settings.collisionMode==='ghost';if(settings.collisionMode==='solid'){coll.fill.material.opacity=.78;coll.fill.material.depthWrite=true}else if(settings.collisionMode==='ghost'){coll.fill.material.opacity=.22;coll.fill.material.depthWrite=false}}
  const bounds=computeBounds(data);
  let disposed=false;
  return {root,renderGroup,collisionGroup,materials,textures,collision:coll,bounds,settings,
    stats:{renderParts:data.meshes.length,renderTriangles:data.meshes.reduce((n,m)=>n+m.indexCount/3,0),renderVertices:data.meshes.reduce((n,m)=>n+m.vertexCount,0),collisionTriangles:data.collision?.triangleCount||0,tagCounts:data.collision?.tagCounts||{}},
    setSettings(next={}){
      Object.assign(settings,next);renderGroup.visible=settings.renderVisible!==false;
      for(const m of materials){m.map=settings.textures?m.userData.levelTexture:null;m.vertexColors=settings.vertexColors!==false;m.needsUpdate=true}
      if(coll){const mode=settings.collisionMode||'off';collisionGroup.visible=mode!=='off';coll.group.visible=mode!=='off';coll.fill.visible=mode==='solid'||mode==='ghost';coll.lines.visible=mode==='wire'||mode==='ghost';coll.fill.material.opacity=mode==='solid'?.78:mode==='ghost'?.22:.25;coll.fill.material.depthWrite=mode==='solid';coll.fill.material.needsUpdate=true;coll.lines.material.opacity=mode==='ghost'?.75:.95}
    },
    dispose(){if(disposed)return;disposed=true;root.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material){for(const m of[].concat(o.material)){if(m.map&&!textures.includes(m.map))m.map.dispose();m.dispose()}}});for(const t of new Set(textures))t.dispose()}
  };
}
function installLevelModelPanel({Viewer,THREE=globalThis.THREE,getProject,setProject}){
  const $=id=>document.getElementById(id),button=$('ilm_launch');
  if(!button)throw new Error('level-model import launcher is missing from index.html');
  const panel=document.createElement('section');panel.id='ilm_panel';panel.style.cssText='display:none;position:fixed;z-index:20;left:260px;top:34px;width:min(430px,calc(100vw - 274px));max-height:calc(100vh - 44px);overflow:auto;box-sizing:border-box;background:#080b10f2;color:#ddd;border:1px solid #48505b;border-radius:5px;padding:9px;font:12px/1.4 sans-serif;box-shadow:0 6px 22px #000b';
  panel.innerHTML='<div style="display:flex;align-items:center;gap:8px"><b style="font-size:14px">Level models</b><span style="color:#8995a5">Stage 1 · .inilevel preview</span><span style="flex:1"></span><button id="ilm_close">×</button></div>'+
    '<div style="margin:7px 0;display:flex;gap:5px;flex-wrap:wrap"><button id="ilm_import">Import .inilevel</button> <button id="ilm_save">Save editor project</button> <input id="ilm_file" type="file" accept=".inilevel,application/zip" hidden></div>'+
    '<div style="display:flex;gap:5px;align-items:center"><label for="ilm_asset">Imported bundle</label><select id="ilm_asset" style="min-width:0;flex:1"></select></div>'+
    '<fieldset style="border:1px solid #343c47;margin:6px 0;padding:6px"><legend>Stage 2 · Build mode</legend><label for="ilm_target">Template level LCM (optional for a new chunk)</label> <select id="ilm_target" style="max-width:100%;min-width:220px"></select><div style="margin:5px 0"><label for="ilm_buildmode">Rendering path</label> <select id="ilm_buildmode"><option value="object">STRAT object (in-game tested workaround)</option><option value="native-static">Static LCM geometry (in-game confirmed)</option></select></div><div id="ilm_placementrow" style="margin:5px 0"><label for="ilm_placement">Placement</label> <select id="ilm_placement"><option value="start">Near this chunk’s NinjaStartPoint</option><option value="world">Preserve bundle world coordinates</option></select></div><div style="margin:5px 0"><label for="ilm_standalone_id">Separate streamed chunk ID (optional)</label> <input id="ilm_standalone_id" type="text" placeholder="e.g. 30-98" maxlength="5" style="width:90px"><div style="margin:5px 0"><label for="ilm_standalone_volume">Destination VOL</label> <select id="ilm_standalone_volume" style="max-width:100%;min-width:150px"></select></div><div style="margin:5px 0"><label for="ilm_clean_donor">Clean donor LCM (optional override)</label> <select id="ilm_clean_donor" style="max-width:100%;min-width:190px"></select><div style="font-size:11px;color:#aeb9c8;margin-top:2px">The editor prefers compatible donors and known runtime-tested choices where available. Select an LCM here to override automatic selection; its static scenery and collision are cleared in clean mode.</div></div><div style="margin:5px 0"><label><input id="ilm_copy_hub_sky" type="checkbox"> Copy sky environment from a source LCS</label><div style="margin:4px 0"><label for="ilm_sky_source">Sky source level</label> <select id="ilm_sky_source" style="max-width:100%;min-width:190px"></select></div><div style="font-size:11px;color:#aeb9c8;margin-top:2px">Auto-detect searches this destination VOL for CustomSkydome or SkydomeBlank (prefers -00, then -99). You can select a specific map LCS. Copies the instance, class code and linked mesh/texture/resource dependencies, plus Fog when present; does not copy gameplay objects or music.</div></div><div style="font-size:11px;color:#d9bd83;margin-top:3px">Choose the volume for this new chunk. Its two-digit prefix is used in the chunk ID automatically (30.vol → 30-xx, 50.vol → 50-xx), so you do not need to load 10.vol when building for another area. Leave Template LCM blank for a clean custom-only LCM. The donor class/script resources and matching PCA remain as loader scaffolding. No entry portal is added automatically.</div></div><div style="margin:5px 0"><button id="ilm_build">Build selected mode into patched .vol</button></div><div id="ilm_buildnote" style="color:#d9bd83">STRAT object mode uses the renderer path already confirmed in-game. It creates a placed object with its own CollMesh, but large objects can be distance-culled and this does not create a new LCM chunk.</div></fieldset>'+
    '<div id="ilm_info" style="white-space:pre-wrap;color:#aeb9c8;margin:6px 0">Import a Blender .inilevel bundle to preview its render and separate collision meshes.</div>'+
    '<fieldset style="border:1px solid #343c47;margin:6px 0;padding:6px"><legend>Render preview</legend><label><input id="ilm_render" type="checkbox" checked> visible</label> <label><input id="ilm_textures" type="checkbox" checked> textures</label> <label><input id="ilm_vcolors" type="checkbox" checked> baked vertex colours</label></fieldset>'+
    '<fieldset style="border:1px solid #343c47;margin:6px 0;padding:6px"><legend>Separate collision preview</legend><select id="ilm_collision"><option value="off">Off</option><option value="wire">Wireframe</option><option value="solid">Solid (tag colours)</option><option value="ghost">Ghost (faces + edges)</option></select><div id="ilm_tags" style="color:#aeb9c8;margin-top:4px"></div></fieldset>'+
    '<div style="display:flex;gap:5px;flex-wrap:wrap"><button id="ilm_focus">Focus view</button> <button id="ilm_remove">Remove bundle</button></div>'+
    '<div style="margin-top:8px;padding-top:6px;border-top:1px solid #343c47;color:#c9a96a">Static LCM geometry is now confirmed to render in-game. It is culled with the target LCM spatial cells and unloads with that streamed chunk. Placement centres the combined render/collision bounds near the paired LCS start by default. Textured native parts use a single direct base texture and explicitly disable inherited texture stage 1. Multi-layer/animated native materials are not yet represented by the .inilevel format. Imported collision still rebuilds the global LCM KD tree.</div>';
  document.body.append(panel);
  const ids=['ilm_close','ilm_import','ilm_save','ilm_file','ilm_asset','ilm_target','ilm_buildmode','ilm_placementrow','ilm_standalone_id','ilm_standalone_volume','ilm_clean_donor','ilm_copy_hub_sky','ilm_sky_source','ilm_placement','ilm_build','ilm_buildnote','ilm_info','ilm_render','ilm_textures','ilm_vcolors','ilm_collision','ilm_tags','ilm_focus','ilm_remove'];
  const el=Object.fromEntries(ids.map(id=>[id,$(id)]));
  let records=new Map(),selected=null,serial=0;
  const project=()=>getProject()||{},list=()=>Array.isArray(project().levelModels)?project().levelModels:(project().levelModels=[]);
  function saveRecord(record){const arr=list(),i=arr.findIndex(x=>x.id===record.id);if(i>=0)arr[i]=record;else arr.push(record)}
  function selectedEntry(){return records.get(selected)||null}
  function setStatus(text){el.ilm_info.textContent=text}
  function renderList(){const arr=list();el.ilm_asset.innerHTML=arr.map(r=>'<option value="'+esc(r.id)+'">'+esc(r.name||r.sourceName||'Level model')+'</option>').join('')||'<option value="">(no imported level models)</option>';if(selected&&arr.some(r=>r.id===selected))el.ilm_asset.value=selected;else selected=arr[0]?.id||null;el.ilm_asset.disabled=!arr.length;updateSelection()}
  function tagSummary(data){if(!data.collision)return 'No collision stream in this bundle.';return Object.entries(data.collision.tagCounts).sort((a,b)=>a[0].localeCompare(b[0])).map(([tag,n])=>tag+' '+(MATERIAL_TAG_NAMES[tag]||'(unmapped)')+' × '+n).join('  ')||'Collision stream contains no triangles.'}
  function loadedVolumeNames(){return [...new Set((Viewer.files||[]).map(f=>f&&String(f.vol||'').trim()).filter(v=>/^\d{2}\.vol$/i.test(v)))].sort((a,b)=>a.localeCompare(b))}
  function updateTargetSelect(record){const loaded=(Viewer.files||[]).filter(f=>f&&/\.LCM$/i.test(f.name||'')).sort((a,b)=>a.name.localeCompare(b.name));const saved=record&&record.targetLcm||'',clean=!!(record&&String(record.standaloneId||'').trim());const placeholder=clean?'(none — create clean standalone LCM)':(loaded.length?'(select a loaded level LCM)':'(load a .vol or loose .LCM first)');const options=['<option value="">'+placeholder+'</option>',...loaded.map(f=>'<option value="'+esc(f.name)+'">'+esc(f.name)+(f.vol?' · '+esc(f.vol):' · loose LCM')+'</option>')];if(saved&&!loaded.some(f=>f.name.toLowerCase()===saved.toLowerCase()))options.push('<option value="'+esc(saved)+'">'+esc(saved)+' (not currently loaded)</option>');el.ilm_target.innerHTML=options.join('');el.ilm_target.value=saved}
  function updateStandaloneVolumeSelect(record){
    const volumes=loadedVolumeNames(),id=String(record&&record.standaloneId||'').trim(),idMatch=id.match(/^(\d{2})-(\d{2})$/),template=(Viewer.files||[]).find(f=>record&&record.targetLcm&&f&&f.name.toLowerCase()===String(record.targetLcm).toLowerCase()),templateVol=template&&template.vol||'';
    const existing=volumes.find(v=>v.toLowerCase()===String(record&&record.targetVol||'').toLowerCase());
    const byId=idMatch&&volumes.find(v=>v.slice(0,2)===idMatch[1]);
    let selected=templateVol||byId||existing||'';
    if(selected){const prefix=selected.slice(0,2),match=String(record.standaloneId||'').trim().match(/^(\d{2})-(\d{2})$/);if(match&&match[1]!==prefix){record.standaloneId=prefix+'-'+match[2];el.ilm_standalone_id.value=record.standaloneId;}if(!record.targetLcm)record.targetVol=selected;saveRecord(record);}
    else if(record&&!record.targetLcm&&record.targetVol&&!volumes.some(v=>v.toLowerCase()===String(record.targetVol).toLowerCase())){record.targetVol='';saveRecord(record);}
    const options=['<option value="">'+(volumes.length?'(choose destination VOL)':'(load a .vol first)')+'</option>',...volumes.map(v=>'<option value="'+esc(v)+'">'+esc(v)+'</option>')];
    el.ilm_standalone_volume.innerHTML=options.join('');el.ilm_standalone_volume.value=selected||'';el.ilm_standalone_volume.disabled=!id||!!record?.targetLcm||!volumes.length;
    updateCleanDonorSelect(record);
    updateSkySourceSelect(record);
  }
  function updateCleanDonorSelect(record){
    const id=String(record&&record.standaloneId||'').trim(),volume=String(record&&record.targetVol||((id.match(/^(\d{2})-/)||[])[1] ? id.slice(0,2)+'.vol' : '')).toLowerCase(),saved=String(record&&record.cleanDonorLcm||'').trim();
    const candidates=(Viewer.files||[]).filter(f=>f&&/\.LCM$/i.test(f.name||'')&&String(f.vol||'').toLowerCase()===volume).sort((a,b)=>a.name.localeCompare(b.name));
    const options=['<option value="">(auto — safest compatible donor)</option>',...candidates.map(f=>'<option value="'+esc(f.name)+'">'+esc(f.name)+'</option>')];
    if(saved&&!candidates.some(f=>f.name.toLowerCase()===saved.toLowerCase()))options.push('<option value="'+esc(saved)+'">'+esc(saved)+' (not loaded in destination VOL)</option>');
    el.ilm_clean_donor.innerHTML=options.join('');el.ilm_clean_donor.value=saved;
    el.ilm_clean_donor.disabled=!id||!!(record&&record.targetLcm)||!volume;
  }
  function updateSkySourceSelect(record){
    const id=String(record&&record.standaloneId||'').trim(),volume=String(record&&record.targetVol||((id.match(/^(\d{2})-/)||[])[1] ? id.slice(0,2)+'.vol' : '')).toLowerCase(),saved=String(record&&record.skyEnvironmentSourceLcs||'').trim();
    const candidates=[];
    for(const f of (Viewer.files||[]).filter(f=>f&&/\.LCS$/i.test(f.name||'')&&String(f.vol||'').toLowerCase()===volume)){
      try{const [A,B]=readWad(f.buf,f),entities=parseLcsInstances(A,B);const dome=entities.find(x=>x&&/^CustomSkydome$/i.test(x.n||''))||entities.find(x=>x&&/^SkydomeBlank$/i.test(x.n||''));if(dome)candidates.push({name:f.name,custom:!!entities.find(x=>x&&/^CustomSkydome$/i.test(x.n||'')),fog:entities.some(x=>x&&/^Fog$/i.test(x.n||''))})}catch{}
    }
    candidates.sort((a,b)=>{const rank=x=>x.name.toLowerCase()===volume.slice(0,2)+'-00.lcs'?0:x.name.toLowerCase()===volume.slice(0,2)+'-99.lcs'?1:2;return rank(a)-rank(b)||Number(b.custom)-Number(a.custom)||Number(b.fog)-Number(a.fog)||a.name.localeCompare(b.name)});
    const options=['<option value="">(auto — find sky in this VOL)</option>',...candidates.map(x=>'<option value="'+esc(x.name)+'">'+esc(x.name)+' · '+(x.custom?'CustomSkydome':'SkydomeBlank')+(x.fog?' + Fog':'')+'</option>')];
    if(saved&&!candidates.some(x=>x.name.toLowerCase()===saved.toLowerCase()))options.push('<option value="'+esc(saved)+'">'+esc(saved)+' (no readable sky instance)</option>');
    el.ilm_sky_source.innerHTML=options.join('');el.ilm_sky_source.value=saved;
    el.ilm_sky_source.disabled=!record||!record.copyHubSkyEnvironment||!id||!!record.targetLcm||!volume;
  }
  if(typeof Viewer.subscribeFilesChanged==='function') Viewer.subscribeFilesChanged(()=>{const record=selectedEntry()?.record||null;updateTargetSelect(record);if(record)updateStandaloneVolumeSelect(record)});
  function updateSelection(){const entry=selectedEntry();if(!entry){el.ilm_info.textContent='No .inilevel bundles imported.';el.ilm_tags.textContent='';updateTargetSelect(null);el.ilm_standalone_volume.innerHTML='<option value="">(load a .vol first)</option>';el.ilm_standalone_volume.value='';el.ilm_standalone_volume.disabled=true;el.ilm_clean_donor.innerHTML='<option value="">(auto — safest compatible donor)</option>';el.ilm_clean_donor.value='';el.ilm_clean_donor.disabled=true;el.ilm_sky_source.innerHTML='<option value="">(load a destination VOL first)</option>';el.ilm_sky_source.value='';el.ilm_sky_source.disabled=true;return}
    updateTargetSelect(entry.record);
    if(!entry.data||!entry.preview){el.ilm_info.textContent=(entry.record.sourceName||entry.record.name||'Level model')+'\nCould not restore this bundle: '+(entry.error?.message||'unknown import error');el.ilm_tags.textContent='';return}
    const {record,data,preview}=entry, s=record.preview||{};
    el.ilm_render.checked=s.renderVisible!==false;el.ilm_textures.checked=s.textures!==false;el.ilm_vcolors.checked=s.vertexColors!==false;el.ilm_collision.value=s.collisionMode||'off';el.ilm_placement.value=record.placementMode==='world'?'world':'start';el.ilm_copy_hub_sky.checked=!!record.copyHubSkyEnvironment;el.ilm_copy_hub_sky.disabled=!String(record.standaloneId||'').trim()||!!record.targetLcm;updateSkySourceSelect(record);el.ilm_buildmode.value=record.buildMode==='native-static'?'native-static':'object';el.ilm_standalone_id.value=record.standaloneId||'';el.ilm_standalone_id.disabled=el.ilm_buildmode.value!=='native-static';updateStandaloneVolumeSelect(record);el.ilm_placementrow.style.display='block';el.ilm_buildnote.textContent=el.ilm_buildmode.value==='native-static'?(record.standaloneId?'Separate chunk: leave Template LCM blank for a clean custom-only LCM, or select one to clone its static scenery/collision. A compatible donor pair supplies loader scaffolding; the new LCM donor render/collision is cleared in clean mode. No StreamNextArea link is added automatically.':'Native static geometry is appended to the selected target LCM and registered in its spatial cells.'):'STRAT object mode uses the renderer path already confirmed in-game. It creates a placed object with its own CollMesh, but large objects can be distance-culled and this does not create a new LCM chunk.';
    el.ilm_tags.textContent='Collision material tags: '+tagSummary(data);
    const st=preview.stats;el.ilm_info.textContent=record.sourceName+'\n'+st.renderParts+' render part(s), '+st.renderVertices.toLocaleString()+' vertices, '+st.renderTriangles.toLocaleString()+' triangles\n'+st.collisionTriangles.toLocaleString()+' collision triangles\n'+(preview.bounds?'Bounds: ['+preview.bounds.map(v=>Number(v.toFixed(3))).join(', ')+']':'Bounds unavailable');
  }
  function applySettings(){const entry=selectedEntry();if(!entry)return;const preview=entry.preview,record=entry.record;record.preview={renderVisible:el.ilm_render.checked,textures:el.ilm_textures.checked,vertexColors:el.ilm_vcolors.checked,collisionMode:el.ilm_collision.value};preview.setSettings(record.preview);saveRecord(record);Viewer.need=true}
  function syncFromProject(){for(const e of records.values()){if(e.preview){e.preview.dispose();if(e.preview.root.parent)e.preview.root.parent.remove(e.preview.root)}}records.clear();
    for(const record of list()){
      try{if(!record.bundle)throw new Error('project entry has no stored bundle data');const data=parseIninjaLevelBundle(base64ToBytes(record.bundle));const preview=buildLevelModelPreview(data,THREE,record.preview||{});record.name=record.name||data.manifest.name;const entry={record,data,preview};records.set(record.id,entry);Viewer.root.add(preview.root)}
      catch(error){records.set(record.id,{record,data:null,preview:null,error});console.error('could not restore .inilevel '+(record.name||record.id),error)}
    }
    renderList();Viewer.need=true;
  }
  button.addEventListener('click',()=>{panel.style.display=panel.style.display==='none'?'block':'none';if(panel.style.display==='block')renderList()});
  el.ilm_close.onclick=()=>panel.style.display='none';el.ilm_import.onclick=()=>el.ilm_file.click();el.ilm_save.onclick=()=>{const save=Viewer.$('ed_save');if(save&&typeof save.onclick==='function'){save.onclick();const summary=Viewer.$('ed_sum');if(summary&&summary.textContent)setStatus(summary.textContent)}else setStatus('The project save service is not ready yet.');};
  el.ilm_file.onchange=async ev=>{const file=ev.target.files&&ev.target.files[0];if(!file)return;try{setStatus('Reading '+file.name+'…');const bytes=new Uint8Array(await file.arrayBuffer()),data=parseIninjaLevelBundle(bytes);const id='level_'+Date.now().toString(36)+'_'+(++serial).toString(36);const record={id,name:data.manifest.name||file.name.replace(/\.inilevel$/i,''),sourceName:file.name,byteLength:bytes.length,bundle:bytesToBase64(bytes),buildMode:'object',placementMode:'start',preview:{renderVisible:true,textures:true,vertexColors:true,collisionMode:'off'}};list().push(record);syncFromProject();selected=id;renderList();el.ilm_asset.value=id;panel.style.display='block';setStatus('Imported '+file.name+' successfully.');}
    catch(error){setStatus('Import failed: '+(error&&error.message||error));console.error(error)}finally{ev.target.value=''}};
  el.ilm_asset.onchange=()=>{selected=el.ilm_asset.value;updateSelection()};
  el.ilm_target.onchange=()=>{const entry=selectedEntry();if(!entry)return;const target=el.ilm_target.value;entry.record.targetLcm=target||'';const f=(Viewer.files||[]).find(x=>x.name===target);entry.record.targetVol=f&&f.vol||'';saveRecord(entry.record);updateStandaloneVolumeSelect(entry.record);el.ilm_copy_hub_sky.disabled=!String(entry.record.standaloneId||'').trim()||!!entry.record.targetLcm;updateSkySourceSelect(entry.record);if(!target&&entry.record.standaloneId&&entry.record.buildMode==='native-static')setStatus('Clean standalone LCM selected. Choose its Destination VOL; a compatible donor in that volume will be used only for loader scaffolding.');else setStatus(!target?'Choose a destination LCM before building.':!f?.vol?target+' is loaded as a loose LCM. Load its source .vol to build a patched VOL.':(entry.record.buildMode==='native-static'?'Template set to '+target+'; standalone builds will clone its static scenery and collision.':'Target set to '+target+'; object mode will patch its paired LCS.'));};
  el.ilm_standalone_volume.onchange=()=>{const entry=selectedEntry();if(!entry)return;const volume=el.ilm_standalone_volume.value;if(!volume)return;entry.record.targetVol=volume;const match=String(entry.record.standaloneId||'').trim().match(/^(\d{2})-(\d{2})$/),prefix=volume.slice(0,2);if(match&&match[1]!==prefix){entry.record.standaloneId=prefix+'-'+match[2];el.ilm_standalone_id.value=entry.record.standaloneId;}saveRecord(entry.record);updateStandaloneVolumeSelect(entry.record);updateSkySourceSelect(entry.record);setStatus('Destination '+volume+' selected. The streamed chunk ID is '+(entry.record.standaloneId||'(enter an ID)')+' so the game routes it to the matching archive.');};
  el.ilm_clean_donor.onchange=()=>{const entry=selectedEntry();if(!entry)return;entry.record.cleanDonorLcm=el.ilm_clean_donor.value||'';saveRecord(entry.record);setStatus(entry.record.cleanDonorLcm?'Clean donor '+entry.record.cleanDonorLcm+' selected for loader scaffolding only. Its static geometry, collision and placed instances will be removed.':'Automatic safe donor selection restored.');};
  el.ilm_copy_hub_sky.onchange=()=>{const entry=selectedEntry();if(!entry)return;entry.record.copyHubSkyEnvironment=!!el.ilm_copy_hub_sky.checked;updateSkySourceSelect(entry.record);saveRecord(entry.record);setStatus(entry.record.copyHubSkyEnvironment?'Clean standalone build will import the sky environment from '+(entry.record.skyEnvironmentSourceLcs||'the best matching LCS in the destination VOL')+', including its class and linked resource dependencies.':'Sky environment import disabled; clean LCS will contain only retained NinjaStartPoint instance(s).');};
  el.ilm_sky_source.onchange=()=>{const entry=selectedEntry();if(!entry)return;entry.record.skyEnvironmentSourceLcs=el.ilm_sky_source.value||'';saveRecord(entry.record);setStatus(entry.record.skyEnvironmentSourceLcs?'Sky environment will be copied from '+entry.record.skyEnvironmentSourceLcs+'.':'Sky source set to auto-detect: prefer -00, then -99, then other LCS files in this volume.');};
  el.ilm_buildmode.onchange=()=>{const entry=selectedEntry();if(!entry)return;entry.record.buildMode=el.ilm_buildmode.value==='native-static'?'native-static':'object';el.ilm_standalone_id.disabled=entry.record.buildMode!=='native-static';el.ilm_placementrow.style.display='block';el.ilm_buildnote.textContent=entry.record.buildMode==='native-static'?(entry.record.standaloneId?'Separate chunk: blank Template LCM creates a clean custom-only LCM; selecting one clones its scenery/collision.':'Native static geometry is appended to the selected target LCM.'):'STRAT object mode uses the in-game-tested object renderer, but large objects can be distance-culled.';saveRecord(entry.record);setStatus(entry.record.buildMode==='native-static'?'Native static LCM rendering selected. Bundle centre will be placed near NinjaStartPoint unless coordinates are preserved.':'STRAT object workaround selected.');updateTargetSelect(entry.record);};
  el.ilm_standalone_id.onchange=()=>{const entry=selectedEntry();if(!entry)return;const id=el.ilm_standalone_id.value.trim();entry.record.standaloneId=id;updateStandaloneVolumeSelect(entry.record);saveRecord(entry.record);updateTargetSelect(entry.record);updateSkySourceSelect(entry.record);el.ilm_copy_hub_sky.disabled=!id||!!entry.record.targetLcm;const finalId=entry.record.standaloneId||id;setStatus(!id?'Separate streamed chunk ID cleared; a destination LCM is required for an in-place build.':/^\d{2}-\d{2}$/.test(finalId)?(entry.record.targetLcm?'Separate chunk '+finalId+' will clone '+entry.record.targetLcm+' and append the custom geometry. Clear Template LCM to create a clean custom-only LCM.':'Separate chunk '+finalId+' will be built in '+(entry.record.targetVol||finalId.slice(0,2)+'.vol')+' using a compatible hidden donor pair; a transition reference is still a separate step.'):'Enter a two-digit area ID such as 30-98 or select a Destination VOL to set the prefix.');};
  el.ilm_placement.onchange=()=>{const entry=selectedEntry();if(!entry)return;entry.record.placementMode=el.ilm_placement.value==='world'?'world':'start';saveRecord(entry.record);setStatus(entry.record.placementMode==='world'?'Static geometry preserves the .inilevel world coordinates.':(entry.record.buildMode==='native-static'?'The combined render/collision bounds will be translated so their centre is near the paired LCS NinjaStartPoint.':'The object anchor will be placed near the paired LCS NinjaStartPoint.'));};
  el.ilm_build.onclick=()=>{const entry=selectedEntry();if(!entry){setStatus('Import a .inilevel bundle first.');return}const standalone=String(entry.record.standaloneId||'').trim();if(standalone&&!/^\d{2}-\d{2}$/.test(standalone)){setStatus('Separate chunk ID must look like 10-98.');return}if(standalone&&entry.record.buildMode!=='native-static'){setStatus('Separate chunk mode requires Static LCM geometry.');return}if(!standalone&&!entry.record.targetLcm){setStatus('Select a destination LCM before building in place.');return}let target=null;if(entry.record.targetLcm){target=(Viewer.files||[]).find(f=>f.name.toLowerCase()===entry.record.targetLcm.toLowerCase()&&/\.LCM$/i.test(f.name));if(!target){setStatus('Template '+entry.record.targetLcm+' is not loaded. Load its source .vol, then build again.');return}if(!target.vol){setStatus(target.name+' is loaded as a loose LCM. Load the source .vol containing it before building a patched VOL.');return}}else if(standalone){const prefix=standalone.slice(0,2).toLowerCase(),destination=String(entry.record.targetVol||prefix+'.vol').toLowerCase(),hasVol=(Viewer.files||[]).some(f=>f&&String(f.vol||'').toLowerCase()===destination);if(destination.replace(/\.vol$/i,'')!==prefix){setStatus('Chunk ID '+standalone+' belongs in '+prefix+'.vol. Choose that Destination VOL or select '+destination.slice(0,2)+'-xx as the chunk ID.');return}if(!hasVol){setStatus('Load '+destination+' (or choose another loaded Destination VOL); the editor will select a compatible hidden donor from that volume automatically.');return}}const build=Viewer.$('ed_patch');if(!build){setStatus('The patched VOL builder is unavailable.');return}setStatus(standalone?(!target?'Starting clean standalone chunk build '+standalone+' (automatic hidden donor)…':'Starting standalone chunk build '+standalone+' cloned from '+target.name+'…'):entry.record.buildMode==='native-static'?'Starting native static-LCM build for '+target.name+'…':'Starting native LCS level-object build for '+target.name+'…');build.click();};
  for(const id of ['ilm_render','ilm_textures','ilm_vcolors','ilm_collision'])el[id].addEventListener('change',applySettings);
  el.ilm_focus.onclick=()=>{const e=selectedEntry();if(e&&e.preview&&e.preview.bounds)Viewer.frameBounds(e.preview.bounds)};
  el.ilm_remove.onclick=()=>{if(!selected)return;const record=list().find(x=>x.id===selected);if(!record)return;const arr=list();arr.splice(arr.indexOf(record),1);syncFromProject();setStatus('Removed '+(record.name||record.sourceName)+'.');};
  return {syncFromProject,buildLevelModelPreview(data,settings){return buildLevelModelPreview(data,THREE,settings)},get entries(){return records}};
}
export {buildLevelModelPreview,installLevelModelPanel};
