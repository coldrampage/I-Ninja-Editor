// Viewer renderer and state. Binary/parser helpers are explicit module imports.
import {
  parseVol, wadName, readWad, instances, parseLcm, parseColl,
  mergeBB, bbox, xboxVerts, xboxInstances, analyseStrats, bigbInfo
} from './vol-core.js';

const $=id=>document.getElementById(id),cv=$('gl'),lc=$('lbl'),lg=lc.getContext('2d');
const renderer=new THREE.WebGLRenderer({canvas:cv,antialias:true}),scene=new THREE.Scene();scene.background=new THREE.Color(0x14161a);
const camera=new THREE.PerspectiveCamera(70,1,.5,5000);camera.rotation.order='YXZ';
const root=new THREE.Group();scene.add(root);
const clipMax=new THREE.Plane(new THREE.Vector3(0,-1,0),1000),clipMin=new THREE.Plane(new THREE.Vector3(0,1,0),1000);
renderer.clippingPlanes=[clipMax,clipMin];
let SCR={classes:{},levels:{},keys:{}},sel=null,mdown=null,tab='3d';
const esc=t=>String(t).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const escAttr=t=>String(t).replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
function scr(e){if(!SCR)return null;const x=SCR.levels[e.L]&&SCR.levels[e.L][e.i];if(!x)return null;const c=SCR.classes[x.k];return c?{c,r:x.r,l:x.l}:null}
const byKey=()=>{const m={};for(const e of all)m[e.L+'#'+e.i]=e;return m};
function regTxt(e,s,k){const lk=s.l.find(a=>a[0]==k);if(lk){if(lk[1]<0)return 'not linked (empty)';const t=byKey()[e.L+'#'+lk[1]];return '\u2192 #'+lk[1]+(t?' '+t.n:'')}return s.r[k]!==undefined?s.r[k]:'@'+k}
function fill(e,s,t){return t.replace(/@(\d+)/g,(m,k)=>regTxt(e,s,+k))}
function wrap(t,n){const o=[];let l='';for(const w of t.split(' ')){if((l+' '+w).length>n&&l){o.push(l);l=w}else l=l?l+' '+w:w}if(l)o.push(l);return o}
const shown=e=>show[e.n]&&(!$('rf').value||(()=>{const s=scr(e);return s&&s.c.tags.includes($('rf').value)})());
let files=[],levels={},D=[],all=[],show={},mats=[],collMat=null,entGroup=null,hov=null,need=true,drag=null;
// Optional callback for model/overlay geometry owned by the editor UI. Keeping this
// as an explicit module hook avoids relying on replacing the global buildEnts binding.
let entityOverlayRefresh = null;
function notifyEntityOverlayRefresh(){
 if(typeof entityOverlayRefresh!=='function')return;
 try{entityOverlayRefresh()}catch(e){console.error('entity overlay refresh failed',e)}
}
export function setEntityOverlayRefresh(callback){
 entityOverlayRefresh=typeof callback==='function'?callback:null;
}

let yaw=0,pitch=-.6,speed=60,mz=-1;const keys={};
const col=n=>{let h=0;for(const ch of n)h=(h*31+ch.charCodeAt(0))%360;return'hsl('+h+',85%,60%)'};
const V3=THREE.Vector3,fwd=()=>{const c=Math.cos(pitch);return new V3(-Math.sin(yaw)*c,Math.sin(pitch),-Math.cos(yaw)*c)};
const gworld=p=>new V3(p[0],p[1],mz*p[2]),ggame=v=>[v.x,v.y,mz*v.z];
function setCam(){camera.rotation.set(pitch,yaw,0);need=true}
function rs(){renderer.setPixelRatio(devicePixelRatio);renderer.setSize(innerWidth,innerHeight);lc.width=innerWidth;lc.height=innerHeight;camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();need=true}
window.onresize=rs;

function clearScene(){root.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material){for(const m of[].concat(o.material)){if(m.map)m.map.dispose();m.dispose()}}});
 while(root.children.length)root.remove(root.children[0]);mats=[];collMat=null;entGroup=null}
function collColors(c){const n=c.mat.length,out=new Float32Array(n*9),p=c.pos,C=new THREE.Color(),L=new V3(.4,.8,.45).normalize();
 for(let t=0;t<n;t++){const o=t*9,ax=p[o+3]-p[o],ay=p[o+4]-p[o+1],az=p[o+5]-p[o+2],bx=p[o+6]-p[o],by=p[o+7]-p[o+1],bz=p[o+8]-p[o+2];
  let nx=ay*bz-az*by,ny=az*bx-ax*bz,nz=ax*by-ay*bx;const l=Math.hypot(nx,ny,nz)||1;
  const s=Math.abs((nx*L.x+ny*L.y+nz*L.z)/l),m=c.mat[t];C.setHSL(((m&0xff)*.137)%1,m&0x100?.35:.7,.22+.4*s);
  for(let k=0;k<3;k++){out[o+3*k]=C.r;out[o+3*k+1]=C.g;out[o+3*k+2]=C.b}}return out}
function buildLevel(L,lv){const g=new THREE.Group(),G=lv.geo;
 if(G){const T={};
  for(const B of G.bufs){const P=new THREE.BufferAttribute(B.pos,3),C=new THREE.BufferAttribute(B.col,3,true),U=new THREE.BufferAttribute(B.uv,2);
  for(const gr of B.groups){const geo=new THREE.BufferGeometry();geo.setAttribute('position',P);geo.setAttribute('color',C);geo.setAttribute('uv',U);geo.setIndex(new THREE.BufferAttribute(gr.idx,1));
   let map=null,alpha=false;const t=G.texs[gr.tex];
   if(t){if(!T[gr.tex]){const x=new THREE.DataTexture(t.rgba,t.w,t.h,THREE.RGBAFormat);x.wrapS=x.wrapT=THREE.RepeatWrapping;
     x.magFilter=THREE.LinearFilter;x.minFilter=THREE.LinearMipmapLinearFilter;x.generateMipmaps=true;x.needsUpdate=true;T[gr.tex]=x}map=T[gr.tex];alpha=t.alpha}
   const m=new THREE.MeshBasicMaterial({map,vertexColors:true,side:THREE.DoubleSide,alphaTest:alpha?.5:0,polygonOffset:true,polygonOffsetFactor:1,polygonOffsetUnits:1});
   m.userData={map};mats.push(m);const mesh=new THREE.Mesh(geo,m);mesh.userData.kind='geo';g.add(mesh)}}}
 if(lv.coll&&lv.coll.mat.length){const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.BufferAttribute(lv.coll.pos,3));
  geo.setAttribute('color',new THREE.BufferAttribute(collColors(lv.coll),3));
  if(!collMat)collMat=new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.DoubleSide});
  const mesh=new THREE.Mesh(geo,collMat);mesh.userData.kind='coll';g.add(mesh)}
 if(lv.pts&&lv.pts.length){const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.BufferAttribute(lv.pts,3));
  const pt=new THREE.Points(geo,new THREE.PointsMaterial({color:0x8890aa,size:2,sizeAttenuation:false}));pt.userData.kind='pts';g.add(pt)}
 root.add(g)}
function applyView(){const gm=$('gm').checked,cm=$('cm').value,tx=$('tx').checked,vc=$('vc').checked,wf=$('wf').checked,br=+$('br').value;
 for(const m of mats){m.map=tx?m.userData.map:null;m.vertexColors=vc;m.wireframe=wf;m.color.setScalar(vc?br:1);m.needsUpdate=true}
 if(collMat){collMat.wireframe=cm=='wire';collMat.transparent=cm=='ghost';collMat.opacity=cm=='ghost'?.35:1;collMat.depthWrite=cm!='ghost';collMat.needsUpdate=true}
 root.traverse(o=>{const k=o.userData.kind;if(k=='geo')o.visible=gm;else if(k=='coll')o.visible=cm!='off';else if(k=='pts'||k=='entpts')o.visible=$('p').checked});
 if(entGroup)entGroup.visible=true;
 root.scale.z=mz;clipMax.constant=+$('b').value;clipMin.constant=-+$('a').value;
 camera.fov=+$('fov').value;camera.near=+$('nr').value||.5;camera.far=+$('fr').value||5000;camera.updateProjectionMatrix();
 speed=Math.pow(10,+$('sp').value);need=true}
function buildEnts(){if(entGroup){root.remove(entGroup);entGroup.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material)o.material.dispose()});entGroup=null}
 const vis=all.filter(shown);if(!vis.length){need=true;notifyEntityOverlayRefresh();return}entGroup=new THREE.Group();const C=new THREE.Color();
 const P=[],Q=[],seg=(a,z)=>{P.push(a[0],a[1],a[2],z[0],z[1],z[2]);Q.push(C.r,C.g,C.b,C.r,C.g,C.b)};
 const BK=byKey();if($('bx').checked||$('or').checked||$('pt').checked||$('lk').checked){const ed=[[0,1],[1,3],[3,2],[2,0],[4,5],[5,7],[7,6],[6,4],[0,4],[1,5],[2,6],[3,7]],bb=boundsAll();
  for(const e of vis){C.set(col(e.n));
   if($('bx').checked&&e.b){const b=e.b;let y0=b[1],y1=b[4];if(($('ex').checked&&y1-y0<=2.1||e.xzOnly)&&bb){y0=bb[1];y1=bb[4]}
    const circ=(cx,cy,cz,r,pl)=>{const N=32;for(let k=0;k<N;k++){const a=k/N*6.2832,c=k==N-1?0:(k+1)/N*6.2832,f=t=>pl==0?[cx+r*Math.cos(t),cy,cz+r*Math.sin(t)]:pl==1?[cx+r*Math.cos(t),cy+r*Math.sin(t),cz]:[cx,cy+r*Math.cos(t),cz+r*Math.sin(t)];seg(f(a),f(c))}};
    if(e.poly){const n=e.poly.length/3,v=i=>[e.poly[3*i],e.poly[3*i+2]];
     for(let i=0;i<n;i++){const a=v(i),z=v((i+1)%n);seg([a[0],y0,a[1]],[z[0],y0,z[1]]);seg([a[0],y1,a[1]],[z[0],y1,z[1]]);seg([a[0],y0,a[1]],[a[0],y1,a[1]])}}
    else if(e.shape==2||e.shape==3){const cx=(b[0]+b[3])/2,cz=(b[2]+b[5])/2,r=(b[3]-b[0])/2;circ(cx,y0,cz,r,0);circ(cx,y1,cz,r,0);
     for(let k=0;k<4;k++){const t=k*1.5708;seg([cx+r*Math.cos(t),y0,cz+r*Math.sin(t)],[cx+r*Math.cos(t),y1,cz+r*Math.sin(t)])}}
    else if(e.shape==4){const cx=(b[0]+b[3])/2,cy=(b[1]+b[4])/2,cz=(b[2]+b[5])/2,r=(b[3]-b[0])/2;circ(cx,cy,cz,r,0);circ(cx,cy,cz,r,1);circ(cx,cy,cz,r,2)}
    else{const cr=k=>[b[k&1?3:0],k&2?y1:y0,b[k&4?5:2]];for(const q of ed)seg(cr(q[0]),cr(q[1]))}}
   if($('bx').checked&&!e.b&&/NextArea/.test(e.n)){const y0=bb?bb[1]:e.p[1]-50,y1=bb?bb[4]:e.p[1]+50;seg([e.p[0],y0,e.p[2]],[e.p[0],y1,e.p[2]])}
   if($('pt').checked&&e.path&&e.path.length>1&&!e.pathbox)for(let k=0;k+1<e.path.length;k++)seg(e.path[k],e.path[k+1]);
   if($('lk').checked){const s=scr(e);if(s)for(const[,t]of s.l){const o=BK[e.L+'#'+t];if(o)seg(e.p,o.p)}}
   if($('or').checked&&e.q){const[x,y,z,w]=e.q;
    // rotate (0,0,1) by quaternion (x,y,z,w): v + 2*q.xyz x (q.xyz x v + w*v)
    const vx=0,vy=0,vz=1,cx=y*vz-z*vy+w*vx,cy=z*vx-x*vz+w*vy,cz=x*vy-y*vx+w*vz,fx=vx+2*(y*cz-z*cy),fy=vy+2*(z*cx-x*cz),fz=vz+2*(x*cy-y*cx);
    if(Math.hypot(fx,fy,fz)>.5)seg(e.p,[e.p[0]+fx*10,e.p[1]+fy*10,e.p[2]+fz*10])}}
  if(P.length){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(P,3));g.setAttribute('color',new THREE.Float32BufferAttribute(Q,3));
   entGroup.add(new THREE.LineSegments(g,new THREE.LineBasicMaterial({vertexColors:true})))}}
 {const pp=new Float32Array(vis.length*3),cc=new Float32Array(vis.length*3);
  vis.forEach((e,i)=>{C.set(col(e.n));pp.set(e.p,i*3);cc.set([C.r,C.g,C.b],i*3)});
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(pp,3));g.setAttribute('color',new THREE.BufferAttribute(cc,3));
  const pt=new THREE.Points(g,new THREE.PointsMaterial({vertexColors:true,size:6,sizeAttenuation:false}));pt.userData.kind='entpts';entGroup.add(pt)}
 root.add(entGroup);applyView();notifyEntityOverlayRefresh()}
function boundsAll(){const b=[1e30,1e30,1e30,-1e30,-1e30,-1e30];const add=q=>{if(!q)return;for(let k=0;k<3;k++){b[k]=Math.min(b[k],q[k]);b[k+3]=Math.max(b[k+3],q[k+3])}};
 for(const l of D){add(l.bb);for(const e of l.ents)add([...e.p,...e.p])}return b[0]>b[3]?null:b}
function fit(){const b=boundsAll();if(!b)return;const c=[(b[0]+b[3])/2,(b[1]+b[4])/2,(b[2]+b[5])/2],sz=Math.max(b[3]-b[0],b[4]-b[1],b[5]-b[2],10);
 const t=gworld(c),pos=t.clone().add(new V3(0,sz*.6,sz*.9));camera.position.copy(pos);
 const dx=t.x-pos.x,dy=t.y-pos.y,dz=t.z-pos.z;yaw=Math.atan2(-dx,-dz);pitch=Math.atan2(dy,Math.hypot(dx,dz));
 $('sp').value=Math.log10(sz/6);camera.far=Math.max(5000,sz*4);$('fr').value=Math.round(camera.far);applyView();setCam()}
function topView(){const b=boundsAll();if(!b)return;const c=gworld([(b[0]+b[3])/2,(b[1]+b[4])/2,(b[2]+b[5])/2]),sz=Math.max(b[3]-b[0],b[5]-b[2],10);
 camera.position.set(c.x,b[4]+sz*.9,c.z);pitch=-Math.PI/2+.001;yaw=0;setCam()}
function refresh(){all=D.flatMap(l=>l.ents.map(e=>({...e,L:l.id})));const names={};all.forEach(e=>names[e.n]=(names[e.n]||0)+1);
 const old=show;show={};for(const n in names)show[n]=n in old?old[n]:(all.some(e=>e.n==n&&e.b)||/Start|Check|Stream|Door|NextArea/.test(n));
 $('ctl').style.display='';const tip=n=>{const e=all.find(q=>q.n==n&&scr(q));if(!e)return'';const c=scr(e).c;return ' title="'+esc(c.tags.join(', ')+'\n'+fill(e,scr(e),c.brief)).replace(/"/g,'&quot;')+'"'};
 $('names').innerHTML=Object.keys(names).sort().map(n=>'<label style="color:'+col(n)+'"'+tip(n)+'><input type=checkbox data-n="'+n+'"'+(show[n]?' checked':'')+'> '+n+' ('+names[n]+')</label>').join('');
 const tags=new Set();for(const e of all){const s=scr(e);if(s)s.c.tags.forEach(t=>tags.add(t))}const cur=$('rf').value;
 $('rf').innerHTML='<option value="">any role</option>'+[...tags].sort().map(t=>'<option'+(t==cur?' selected':'')+'>'+t+'</option>').join('');
 if(tab==='scr')scrBuild();$('scrst').textContent=all.some(scr)?'scripts analysed: '+all.filter(scr).length+' of '+all.length+' entities, '+Object.keys(SCR.classes).length+' class variants. Click an entity to inspect its script.':'no script info (needs an .LCS strat wad)';
 buildEnts();applyView()}

// ---- file handling
function setFiles(list){files=list;levels={};
 for(const f of files){const m=/^(\d+-\d+)\.(LCS|LCM)$/i.exec(f.name);if(m)(levels[m[1]]=levels[m[1]]||{})[m[2].toUpperCase()]=f}
 const ids=Object.keys(levels).sort((a,b)=>a.localeCompare(b,0,{numeric:true}));
 $('lv').innerHTML=ids.map(id=>{const f=levels[id].LCM||levels[id].LCS;let nm='';try{nm=wadName(f.buf,f)}catch(e){}
  return'<label><input type=checkbox data-l="'+id+'"> '+id+' <span style="color:#888">'+nm+(levels[id].LCS?'':' (no LCS)')+(levels[id].LCM?'':' (no LCM)')+((levels[id].LCS||levels[id].LCM).vol?' ['+(levels[id].LCS||levels[id].LCM).vol+']':'')+'</span></label>'}).join('')||'no levels (.LCS/.LCM) found';
 for(const i of['load','all','none'])$(i).disabled=!ids.length;$('st').textContent=files.length+' files, '+ids.length+' levels'}
function open_(ab,name){try{const fs=parseVol(ab);fs.forEach(f=>{f.buf=ab;f.vol=name||'vol'});setFiles(fs)}catch(e){$('st').textContent='error: '+e}}
// several .vol files can be loaded together (every file keeps its own volume buffer + name); a volume opened again replaces its old copy
function addVolumes(vols){const keep=files.filter(f=>f.vol&&!vols.some(v=>v.name.toLowerCase()===f.vol.toLowerCase())),list=[...keep],seen=new Set(list.map(f=>f.name.toLowerCase())),dup=[];
 for(const v of vols){let fs;try{fs=parseVol(v.ab)}catch(e){$('st').textContent=v.name+': '+e;continue}
  for(const f of fs){f.buf=v.ab;f.vol=v.name;const k=f.name.toLowerCase();if(seen.has(k)){dup.push(f.name+' ('+v.name+')');continue}seen.add(k);list.push(f)}}
 setFiles(list);return dup}
const WANT=/\.(vol|avl|json)$/i;
async function walkEntry(en,out){if(en.isFile){if(WANT.test(en.name))out.push(await new Promise((ok,no)=>en.file(ok,no)));return}
 if(!en.isDirectory)return;const rd=en.createReader();for(;;){const b=await new Promise((ok,no)=>rd.readEntries(ok,no));if(!b.length)break;for(const c of b)await walkEntry(c,out)}}
// dropped folders are walked (entries must be taken before the first await)
async function dropFiles(dt){const ents=[...(dt.items||[])].map(i=>i.webkitGetAsEntry&&i.webkitGetAsEntry()).filter(Boolean),direct=[...dt.files];if(!ents.some(x=>x.isDirectory))return direct;const out=[];for(const en of ents)await walkEntry(en,out);return out}
const pick=v=>document.querySelectorAll('#lv input').forEach(i=>i.checked=v);
$('all').onclick=()=>pick(true);$('none').onclick=()=>pick(false);
$('na').onclick=()=>{for(const n in show)show[n]=true;document.querySelectorAll('#names input').forEach(i=>i.checked=true);buildEnts()};
$('nn').onclick=()=>{for(const n in show)show[n]=false;document.querySelectorAll('#names input').forEach(i=>i.checked=false);buildEnts()};
async function loadJson(f){const j=JSON.parse(await f.text());if(!j.classes||!j.levels)throw'not a script-info json';
 if(!SCR)SCR={classes:{},levels:{}};Object.assign(SCR.classes,j.classes);Object.assign(SCR.levels,j.levels);if(j.keys)Object.assign(SCR.keys,j.keys);$('st').textContent='precomputed script info loaded ('+f.name+')';if(D.length)refresh()}
async function openFiles(fs){const js=fs.filter(f=>/\.json$/i.test(f.name));for(const f of js){try{await loadJson(f)}catch(e){$('st').textContent=f.name+': '+e}}fs=fs.filter(f=>!/\.json$/i.test(f.name));if(!fs.length)return;const vol=fs.find(f=>/\.vol$/i.test(f.name));if(vol)return open_(await vol.arrayBuffer());
 const loose=fs.filter(f=>/^\d+-\d+\.(LCS|LCM)$/i.test(f.name));
 if(loose.length&&!fs.some(f=>/\.xb[ms]$/i.test(f.name))){const l=[];for(const f of loose){const buf=await f.arrayBuffer();l.push({name:f.name,off:0,size:buf.byteLength,buf})}return setFiles(l)}
 clearScene();D=[];const msg=[];
 for(const f of fs){try{const u8=new Uint8Array(await f.arrayBuffer()),i=bigbInfo(u8);
  if(/\.xbm$/i.test(f.name)){const pts=xboxVerts(u8);D.push({id:f.name,ents:[],pts,bb:bbox(pts)});msg.push(f.name+' ('+i.name+', wad v'+i.ver+'): '+pts.length/3+' map vertices')}
  else{const ents=xboxInstances(u8);D.push({id:f.name,ents,bb:null});msg.push(f.name+' ('+i.name+', wad v'+i.ver+'): '+ents.length+' instances, '+ents.filter(e=>e.b).length+' boxes')}}catch(e){msg.push(f.name+': '+e)}}
 $('st').textContent=msg.join('\n');D.forEach(l=>buildLevel(l.id,l));refresh();fit()}
$('file').onchange=e=>openFiles([...e.target.files]);
window.ondragover=e=>e.preventDefault();window.ondrop=e=>{e.preventDefault();dropFiles(e.dataTransfer).then(f=>openFiles(f))};
$('dirbtn').onclick=()=>$('dirpick').click();$('dirpick').onchange=e=>{const f=[...e.target.files].filter(x=>WANT.test(x.name));e.target.value='';if(!f.length){$('st').textContent='no .vol / .avl files in that folder';return}openFiles(f)};
$('load').onclick=async()=>{const ids=[...document.querySelectorAll('#lv input:checked')].map(i=>i.dataset.l);if(!ids.length)return;
 clearScene();D=[];const info=[];
 for(const id of ids){$('st').textContent='loading '+id+'...';await new Promise(r=>setTimeout(r));
  try{const L=levels[id];let ents=[];if(L.LCS){const w=readWad(L.LCS.buf,L.LCS);ents=instances(w[0],w[1]);
   if(!SCR.levels[id]){$('st').textContent='analysing scripts in '+id+'...';await new Promise(r=>setTimeout(r));try{const r=analyseStrats(w[0],w[1],SCR.classes);if(r){SCR.levels[id]=r;SCR.keys[id]=r.keys}}catch(e){console.error('script analysis',e)}}};let geo=null,coll=null;
   if(L.LCM){const[A,B]=readWad(L.LCM.buf,L.LCM);geo=parseLcm(A,B);coll=parseColl(A)}
   const lv={id,ents,geo,coll,bb:mergeBB(geo?geo.bufs.map(b=>bbox(b.pos)):[],coll&&bbox(coll.pos))};D.push(lv);buildLevel(id,lv);
   info.push(id+': '+(geo?geo.tris+' tris, '+geo.parts+' parts'+(geo.missed?' ('+geo.missed+' unparsed)':'')+(geo.cov!=geo.tot?' [index coverage '+geo.cov+'/'+geo.tot+']':'')+', '+Object.values(geo.texs).filter(Boolean).length+' textures':'no geometry')+(coll?', '+coll.mat.length+' collision tris':'')+', '+ents.length+' entities')}
  catch(e){$('st').textContent=id+': '+e;console.error(e);return}}
 refresh();fit();$('st').textContent=info.join('\n')};

// ---- Scripts tab: every class in the analysed levels, including ones that are only spawned by other scripts
let scrIx=null,scrSel=null,scrVar=null,scrInst='',scrMsg=null,scrIxKey='';const scrHay=new Map(),sendsCache=new Map();
function ixGet(){const k=Object.keys(SCR.levels).join()+'|'+Object.keys(SCR.classes).length;if(!scrIx||k!==scrIxKey){scrIx=scrIndex();scrIxKey=k}return scrIx}
// messages a class variant sends, parsed from its key-action text: [{fn,tgt,msg}]
function sendsOf(k){let r=sendsCache.get(k);if(r)return r;r=[];const seen=new Set(),c=SCR.classes[k];
 for(const h of c.handlers.concat(c.subs))for(const m of h.t[0].matchAll(/(Strat_SendEvent(?:Arg2?)?|Strat_Broadcast\w*)\(([^\n]*)\)/g)){
  const mm=/msg=(-?\d+|[^,)]+)/.exec(m[2]),tm=/^(?:target|class|mask)=("[^"]*"|[^,]+)/.exec(m[2]),x={fn:m[1],tgt:tm?tm[1].trim():'?',msg:mm?mm[1].trim():null},key=x.fn+x.tgt+x.msg;
  if(!seen.has(key)){seen.add(key);r.push(x)}}
 sendsCache.set(k,r);return r}
function analyseLevel(id){if(SCR.levels[id])return;const L=levels[id];if(!L||!L.LCS)return;const w=readWad(L.LCS.buf,L.LCS),r=analyseStrats(w[0],w[1],SCR.classes);if(r){SCR.levels[id]=r;SCR.keys[id]=r.keys}}
function showTab(t){tab=t;$('scr').style.display=t==='scr'?'flex':'none';$('tb3').classList.toggle('on',t==='3d');$('tbs').classList.toggle('on',t==='scr');
 if(t==='scr'){$('insp').style.display='none';$('sdl').value=$('dl').value;scrBuild()}else inspect(sel)}
function scrIndex(){const by={},rev={};
 for(const id of Object.keys(SCR.levels).sort()){const lv=SCR.levels[id],keys=(SCR.keys[id])||[...new Set(lv.filter(Boolean).map(x=>x.k))],placed={};
  lv.forEach((x,i)=>{if(x)(placed[x.k]=placed[x.k]||[]).push(i)});
  for(const k of new Set(keys)){const c=SCR.classes[k];if(!c)continue;const g=by[c.name]=by[c.name]||{name:c.name,vars:{},placed:0},v=g.vars[k]=g.vars[k]||{k,levels:[],inst:[]};
   v.levels.push(id);for(const i of placed[k]||[]){v.inst.push([id,i]);g.placed++}}}
 const sendBy={};
 for(const g of Object.values(by))for(const v of Object.values(g.vars)){for(const s of SCR.classes[v.k].spawns)(rev[s]=rev[s]||new Set()).add(g.name);
  for(const x of sendsOf(v.k))if(/^-?\d+$/.test(x.msg||'')){const m=sendBy[x.msg]=sendBy[x.msg]||new Map();(m.get(g.name)||m.set(g.name,new Set()).get(g.name)).add(x.tgt)}}
 return{by,rev,sendBy}}
const handlesMsg=(g,n)=>Object.keys(g.vars).some(k=>SCR.classes[k].handlers.some(h=>h.on==='message #'+n));
// clickable text: quoted class names, Strat_Spawn targets, msg=N, call sub_N()
function linkText(t){const ix=ixGet();return esc(t).replace(/"([A-Za-z0-9_]+)"|(Strat_Spawn -&gt; )([A-Za-z0-9_]+)|\bmsg=(\d+)|\bcall (sub_\d+)\(\)/g,(m,q,sp,sc,msg,sub)=>{
  if(q)return ix.by[q]?'"<a data-c=\''+q+'\'>'+q+'</a>"':m;
  if(sp)return ix.by[sc]?sp+'<a data-c=\''+sc+'\'>'+sc+'</a>':m;
  if(msg)return'msg=<a data-m=\''+msg+'\' title="show the classes that handle this message">'+msg+'</a>';
  return'call <a data-s=\''+sub+'\' title="jump to this subroutine">'+sub+'</a>()'})}
function scrHayOf(g){let h=scrHay.get(g.name+g.placed+Object.keys(g.vars).join());if(!h){h=(g.name+' '+Object.keys(g.vars).map(k=>{const c=SCR.classes[k];return c.tags.join(' ')+' '+c.brief+' '+c.handlers.concat(c.subs).map(x=>x.on+' '+x.t[2]).join(' ')}).join(' ')).toLowerCase();scrHay.set(g.name+g.placed+Object.keys(g.vars).join(),h)}return h}
function scrBuild(){const ix=ixGet(),q=$('sq').value.toLowerCase().trim(),tg=$('stg').value,so=$('sso').value;
 const tags=new Set();for(const g of Object.values(ix.by))for(const k of Object.keys(g.vars))SCR.classes[k].tags.forEach(t=>tags.add(t));
 const cur=$('stg').value;$('stg').innerHTML='<option value="">any role</option>'+[...tags].sort().map(t=>'<option'+(t===cur?' selected':'')+'>'+esc(t)+'</option>').join('');
 const names=Object.keys(ix.by).sort((a,b)=>a.localeCompare(b)).filter(n=>{const g=ix.by[n],spawned=ix.rev[n]&&ix.rev[n].size;
  if(so==='placed'&&!g.placed)return false;if(so==='spawned'&&(g.placed||!spawned))return false;if(so==='orphan'&&(g.placed||spawned))return false;
  if(scrMsg!==null&&!handlesMsg(g,scrMsg))return false;
  if(tg&&!Object.keys(g.vars).some(k=>SCR.classes[k].tags.includes(tg)))return false;return!q||scrHayOf(g).includes(q)});
 $('smsg').innerHTML=scrMsg===null?'':'<b>message #'+scrMsg+'</b>: handled by the classes below; sent by '+([...(ix.sendBy[scrMsg]||new Map()).keys()].sort().map(scrLink).join(', ')||'<span class=dim>nothing found</span>')+' <a data-x=1>[clear]</a>';
 const n=Object.keys(ix.by).length;$('scount').textContent=n?names.length+' of '+n+' classes in '+Object.keys(SCR.levels).length+' levels':'nothing analysed yet \u2013 load levels (3D tab) or press "analyse all levels"';
 $('slist').innerHTML=names.map(nm=>{const g=ix.by[nm],sp=ix.rev[nm]?ix.rev[nm].size:0,c0=SCR.classes[Object.keys(g.vars)[0]];
  return'<div class="it'+(nm===scrSel?' sel':'')+'" data-n="'+esc(nm)+'"><b style="color:'+col(nm)+'">'+esc(nm)+'</b> <span class=dim>'+(g.placed?'\u00d7'+g.placed:(sp?'<span style="color:#fa4">spawned only</span>':'unused'))+'</span><div class=dim>'+esc(c0.tags.join(' \u00b7 '))+'</div></div>'}).join('');
 if(!ix.by[scrSel]||!names.includes(scrSel))scrSel=names[0]||null;scrDetail()}
function scrLink(n){return ixGet().by[n]?'<a data-c="'+esc(n)+'">'+esc(n)+'</a>':esc(n)}
function scrDetail(){const P=$('sdet'),g=scrIx&&scrIx.by[scrSel];if(!g){P.innerHTML='<p class=dim>Select a class on the left.</p>';return}
 const vars=Object.values(g.vars);if(!scrVar||!g.vars[scrVar])scrVar=vars.slice().sort((a,b)=>b.inst.length-a.inst.length)[0].k;
 const v=g.vars[scrVar],c=SCR.classes[v.k],lv=+$('sdl').value;
 if(scrInst&&!v.inst.some(x=>x[0]+'#'+x[1]===scrInst))scrInst='';
 const s=scrInst?(()=>{const[L,i]=scrInst.split('#'),x=SCR.levels[L][+i];return{e:{L,i:+i},c,r:x.r,l:x.l}})():null;
 const fl=t=>s?fill(s.e,s,t):t;
 let h='<h2 style="color:'+col(g.name)+'">'+esc(g.name)+'</h2><div>'+c.tags.map(t=>'<span class=tag>'+esc(t)+'</span>').join('')+'</div><p>'+linkText(fl(c.brief))+'</p>';
 const by=scrIx.rev[g.name];h+='<p><b>Spawned by</b> '+(by&&by.size?[...by].sort().map(scrLink).join(', '):'<span class=dim>nothing in the analysed levels'+(g.placed?' (placed in the level data)':'')+'</span>')+'</p>';
 if(c.spawns.length)h+='<p><b>Spawns</b> '+c.spawns.map(scrLink).join(', ')+'</p>';
 const sd=[],seenS=new Set();for(const x of sendsOf(v.k)){const k=x.fn+x.tgt+x.msg;if(!seenS.has(k)){seenS.add(k);sd.push(x)}}
 if(sd.length)h+='<b>Sends messages</b><table>'+sd.map(x=>{const q=/^"([^"]+)"$/.exec(x.tgt),tg=q?scrLink(q[1]):esc(fl(x.tgt)),ms=/^-?\d+$/.test(x.msg||'')?'<a data-m=\''+x.msg+'\'>'+x.msg+'</a>':esc(fl(x.msg||'?'));
  return'<tr><td>'+(x.fn.includes('Mask')?'broadcast, mask':x.fn.startsWith('Strat_Broadcast')?'broadcast to class':'to')+'</td><td>'+tg+'</td><td>msg '+ms+'</td></tr>'}).join('')+'</table>';
 const rm=c.handlers.map(hd=>/^message #(\d+)$/.exec(hd.on)).filter(Boolean).map(m=>m[1]);
 if(rm.length)h+='<b>Handles messages</b><table>'+rm.map(n=>{const mp=scrIx.sendBy[n]||new Map(),all_=[...mp.keys()].sort(),me=all_.filter(s=>mp.get(s).has('"'+g.name+'"')),oth=all_.filter(s=>!me.includes(s));
  return'<tr><td><a data-m=\''+n+'\'>#'+n+'</a></td><td>'+(all_.length?'sent by '+me.map(s=>'<b>'+scrLink(s)+'</b>').concat(oth.slice(0,12).map(scrLink)).join(', ')+(oth.length>12?' \u2026':'')+(me.length?' <span class=dim>(bold = addresses this class by name)</span>':''):'<span class=dim>no sender found in the analysed scripts (may come from the engine or a computed target)</span>')+'</td></tr>'}).join('')+'</table>';
 if(vars.length>1)h+='<p><b>Variant</b> <select id=svar>'+vars.map(x=>'<option value="'+esc(x.k)+'"'+(x.k===scrVar?' selected':'')+'>'+esc(x.levels.join(', '))+' ('+x.inst.length+' placed)</option>').join('')+'</select> <span class=dim>class code differs between these levels</span></p>';
 else h+='<p class=dim>Levels: '+esc(v.levels.join(', '))+'</p>';
 if(v.inst.length){h+='<p><b>Placed instances</b> '+v.inst.slice(0,80).map(([L,i])=>'<a data-e="'+L+'#'+i+'">'+L+' #'+i+'</a>').join(', ')+(v.inst.length>80?' \u2026':'')+'</p>';
  h+='<p>Fill registers from <select id=sinst><option value="">(generic: @k)</option>'+v.inst.map(([L,i])=>'<option value="'+L+'#'+i+'"'+(scrInst===L+'#'+i?' selected':'')+'>'+L+' #'+i+'</option>').join('')+'</select></p>'}
 const nr=Object.keys(c.roles).length;
 if(nr){h+='<b>Initial registers</b><table>';for(let k=0;k<nr;k++){const ro=c.roles[k]||{};h+='<tr><td>r'+k+'</td><td>'+(s?esc(regTxt(s.e,s,k)):'')+'</td><td class=dim>'+esc(ro.note||'')+'</td></tr>'}h+='</table>'}
 for(const hd of c.handlers.concat(c.subs)){const t=fl(hd.t[lv]);h+='<details data-id="'+hd.id+'"'+(hd.id==='entry'||c.handlers.length<3?' open':'')+'><summary>'+esc(hd.id)+' &mdash; '+esc(hd.on)+'</summary><pre>'+(t.trim()?linkText(t):'<span class=dim>(nothing at this detail level)</span>')+'</pre></details>'}
 h+='<div class=dim>Native names are the PS2 catalog names carried over by index; treat non-Strat/Wad/Math/Anim names as hints. @k = initial register k of the instance.</div>';P.innerHTML=h}
function goEnt(k){showTab('3d');if(byKey()[k])goto_(k);else $('st').textContent='level '+k.split('#')[0]+' is not loaded in the 3D view - load it to see this entity'}
$('tb3').onclick=()=>showTab('3d');$('tbs').onclick=()=>showTab('scr');
$('sq').oninput=scrBuild;$('stg').onchange=scrBuild;$('sso').onchange=scrBuild;
$('sdl').onchange=()=>{$('dl').value=$('sdl').value;scrDetail()};
$('sall').onclick=async()=>{const ids=Object.keys(levels).sort();if(!ids.length){$('scount').textContent='open a .vol first';return}
 for(const id of ids){$('scount').textContent='analysing '+id+'...';await new Promise(r=>setTimeout(r));try{analyseLevel(id)}catch(e){console.error(id,e)}}scrBuild()};
function openClass(n){scrSel=n;scrVar=null;scrInst='';scrMsg=null;$('sq').value='';$('sso').value='all';$('stg').value='';if(tab!=='scr')showTab('scr');else scrBuild();const it=$('slist').querySelector('.sel');if(it)it.scrollIntoView({block:'nearest'})}
document.addEventListener('click',e=>{const t=e.target.closest('[data-c],[data-m],[data-s],[data-e],[data-x],#slist [data-n]');if(!t)return;const d=t.dataset;
 if(d.e)return goEnt(d.e);
 if(d.s){const root=t.closest('#sdet,#insp'),det=root&&root.querySelector('details[data-id="'+d.s+'"]');if(det){det.open=true;det.scrollIntoView({block:'start',behavior:'smooth'});det.style.outline='1px solid #fc6';setTimeout(()=>det.style.outline='',1500)}return}
 if(d.m){scrMsg=+d.m;scrSel=null;scrVar=null;scrInst='';$('sq').value='';$('sso').value='all';$('stg').value='';if(tab!=='scr')showTab('scr');else scrBuild();return}
 if(d.x){scrMsg=null;scrBuild();return}
 const n=d.c||d.n;if(n)openClass(n)});
$('scr').onchange=e=>{if(e.target.id==='svar'){scrVar=e.target.value;scrInst='';scrDetail()}else if(e.target.id==='sinst'){scrInst=e.target.value;scrDetail()}};

// ---- UI
$('ui').onchange=e=>{const t=e.target;if(t.dataset.n){show[t.dataset.n]=t.checked;buildEnts()}
 else if(t.id=='bx'||t.id=='ex'||t.id=='or'||t.id=='pt'||t.id=='lk'||t.id=='rf')buildEnts();else if(t.id=='dl'||t.id=='ls'){inspect(sel);need=true}else if(t.id=='mz'){mz=t.checked?-1:1;applyView();fit()}else applyView();
 if(t.type=='checkbox'||t.tagName=='SELECT')t.blur()};
$('ui').oninput=e=>{if(e.target.type=='range')applyView()};
$('fit').onclick=fit;$('top').onclick=topView;

// ---- fly camera: right-drag look, WASD/arrows, Q/E down/up, Shift = x4, wheel = speed, left-drag pan
const isField=t=>t&&(t.tagName=='SELECT'||(t.tagName=='INPUT'&&t.type=='number'));
addEventListener('keydown',e=>{if(isField(e.target))return;keys[e.code]=true;
 if(e.code=='KeyF')fit();if(e.code=='KeyT')topView();if(/^Arrow/.test(e.code))e.preventDefault()});
addEventListener('keyup',e=>{keys[e.code]=false});addEventListener('blur',()=>{for(const k in keys)keys[k]=false});
cv.addEventListener('contextmenu',e=>e.preventDefault());
cv.onmousedown=e=>{drag={x:e.clientX,y:e.clientY,b:e.button};mdown={x:e.clientX,y:e.clientY,b:e.button}};
window.onmouseup=e=>{if(mdown&&mdown.b==0&&Math.hypot(e.clientX-mdown.x,e.clientY-mdown.y)<4&&e.target===cv){const q=nearest(e.clientX,e.clientY);sel=q||null;inspect(sel);need=true}mdown=null;drag=null};
cv.onwheel=e=>{e.preventDefault();const v=+$('sp').value+(e.deltaY<0?.08:-.08);$('sp').value=Math.max(-1,Math.min(3,v));applyView()};
function project(p){const v=gworld(p).project(camera);return{x:(v.x+1)/2*innerWidth,y:(1-v.y)/2*innerHeight,z:v.z}}
function nearest(mx,my){let best=null,bd=14;for(const q of all){if(!shown(q))continue;const s=project(q.p);if(s.z>1||s.z<-1)continue;const d=Math.hypot(s.x-mx,s.y-my);if(d<bd){bd=d;best=q}}return best}
cv.onmousemove=e=>{if(drag){const dx=e.clientX-drag.x,dy=e.clientY-drag.y;drag.x=e.clientX;drag.y=e.clientY;
  if(drag.b==2){yaw-=dx*.003;pitch=Math.max(-1.55,Math.min(1.55,pitch-dy*.003));setCam()}
  else{const k=speed*.004,r=new V3(Math.cos(yaw),0,-Math.sin(yaw)),up=new V3().crossVectors(r,fwd());
   camera.position.addScaledVector(r,-dx*k).addScaledVector(up,dy*k);need=true}}
 else hov=nearest(e.clientX,e.clientY);tipUpdate()};
cv.ondblclick=e=>{const q=nearest(e.clientX,e.clientY);if(q){camera.position.copy(gworld(q.p)).addScaledVector(fwd(),-Math.max(15,Math.sqrt(q.r)||15));need=true}};
const fmtP=p=>p.s?'"'+p.s+'"':p.v<65536?String(p.v):(()=>{const f=new Float32Array(new Uint32Array([p.v]).buffer)[0];return isFinite(f)&&Math.abs(f)>1e-4&&Math.abs(f)<1e7?f.toFixed(2)+'f':'0x'+p.v.toString(16)})();
function inspect(q){const P=$('insp');if(!q){P.style.display='none';return}const s=scr(q),lv=+$('dl').value;P.style.display='block';
 let h='<span class=x data-inspector-close>\u2715</span><h3 style="color:'+col(q.n)+'">'+esc(q.n)+(q.to?' \u2192 '+esc(q.to):'')+'</h3><div class=dim>'+q.L+' #'+q.i+' &nbsp; pos '+q.p.join(', ')+' &nbsp; yaw '+(q.r/4096*360).toFixed(0)+'\u00b0</div>';
 if(!s){h+='<p class=dim>No script info for this entity'+'.</p>'}
 else{const c=s.c,B=byKey();h+='<div>'+c.tags.map(t=>'<span class=tag>'+esc(t)+'</span>').join('')+'</div><p>'+linkText(fill(q,s,c.brief))+'</p>';
  if(s.r.length){h+='<b>Registers</b><table>';s.r.forEach((v,k)=>{const ro=c.roles[k]||{};const lk=s.l.find(a=>a[0]==k);
   h+='<tr><td>r'+k+'</td><td>'+(lk?'<a data-goto-key="'+escAttr(q.L+'#'+lk[1])+'">'+esc(regTxt(q,s,k))+'</a>':esc(v))+'</td><td class=dim>'+esc(ro.note||'')+'</td></tr>'});h+='</table>'}
  const inc=all.filter(o=>{const t=scr(o);return t&&o.L==q.L&&t.l.some(a=>a[1]==q.i)});
  if(inc.length)h+='<p><b>Referenced by</b> '+inc.map(o=>'<a data-goto-key="'+escAttr(o.L+'#'+o.i)+'">#'+o.i+' '+esc(o.n)+'</a>').join(', ')+'</p>';
  if(c.spawns.length)h+='<p><b>Spawns</b> '+c.spawns.map(scrLink).join(', ')+'</p>';
  h+='<p><a data-c="'+esc(c.name)+'">open in Scripts tab</a></p>';
  for(const hd of c.handlers.concat(c.subs)){const t=fill(q,s,hd.t[lv]);h+='<details data-id="'+hd.id+'"'+(hd.id=='entry'||c.handlers.length<3?' open':'')+'><summary>'+esc(hd.id)+' &mdash; '+esc(hd.on)+'</summary><pre>'+(t.trim()?linkText(t):'<span class=dim>(nothing at this detail level)</span>')+'</pre></details>'}
  h+='<div class=dim>Native names are the PS2 catalog names carried over by index; treat non-Strat/Wad/Math/Anim names as hints. @k = this instance\'s init register k.</div>'}
 P.innerHTML=h}
function goto_(k){const q=byKey()[k];if(!q)return;sel=q;inspect(q);camera.position.copy(gworld(q.p)).addScaledVector(fwd(),-Math.max(15,Math.sqrt(q.r)||15));need=true}
$('insp').addEventListener('click',e=>{const t=e.target?.closest?.('[data-inspector-close],[data-goto-key]');if(!t)return;if(t.hasAttribute('data-inspector-close')){sel=null;inspect(null);need=true;return}goto_(t.dataset.gotoKey)});
function tipUpdate(){const c=ggame(camera.position),q=hov;
 $('tip').textContent='cam '+c.map(v=>v.toFixed(1)).join(', ')+'  speed '+speed.toFixed(1)+
  (q?'\n'+q.n+(q.to?' \u2192 '+q.to:'')+'  ['+q.L+' #'+q.i+']\npos '+q.p.join(', ')+'\nyaw '+(q.r/4096*360).toFixed(0)+'\u00b0'+(q.params&&q.params.length?'\nregs '+q.params.slice(0,8).map(fmtP).join('  '):'')+(q.path?'\npath '+q.path.length+' nodes':'')+(()=>{const s=scr(q);if(!s)return'';let o='\n\u2500 '+s.c.tags.join(' \u00b7 ');for(const l of wrap(fill(q,s,s.c.brief),64).slice(0,4))o+='\n  '+l;
 s.r.slice(0,8).forEach((v,k)=>{o+='\n  r'+k+' = '+regTxt(q,s,k)+((s.c.roles[k]||{}).note?'   ('+s.c.roles[k].note.split(',')[0]+')':'')});return o+'\n  (click for full script)'})()+(q.b?'\nshape '+(q.pathbox?'path box, '+(q.xzOnly?'XZ only':'3D'):(['box, XZ only','box','cylinder, infinite','cylinder','sphere','polygon, XZ only','polygon'][q.shape]||'?')+(q.poly?', '+q.poly.length/3+' verts':'')+' (type '+q.shape+')')+'\nbox '+q.b.join(', ')+'\nsize '+[0,1,2].map(i=>(q.b[i+3]-q.b[i]).toFixed(1)).join(' x '):''):'')}
function selOverlay(){if(!sel)return;const a=project(sel.p);lg.strokeStyle='#ff0';lg.lineWidth=2;lg.beginPath();lg.arc(a.x,a.y,10,0,6.3);lg.stroke();
 const s=scr(sel),B=byKey();if(s)for(const[,t]of s.l){const o=B[sel.L+'#'+t];if(!o)continue;const b=project(o.p);lg.strokeStyle='#0ff';lg.beginPath();lg.moveTo(a.x,a.y);lg.lineTo(b.x,b.y);lg.stroke();lg.beginPath();lg.arc(b.x,b.y,7,0,6.3);lg.stroke()}
 for(const o of all){const t=scr(o);if(t&&o.L==sel.L&&t.l.some(x=>x[1]==sel.i)){const b=project(o.p);lg.strokeStyle='#f80';lg.beginPath();lg.moveTo(b.x,b.y);lg.lineTo(a.x,a.y);lg.stroke();lg.beginPath();lg.arc(b.x,b.y,7,0,6.3);lg.stroke()}}}
function labels(){lg.clearRect(0,0,lc.width,lc.height);selOverlay();if(!$('l').checked||!all.length)return;const md=+$('ld').value||250,cp=camera.position,L=[];
 for(const q of all){if(!shown(q))continue;const w=gworld(q.p),d=w.distanceTo(cp);if(d>md)continue;const s=w.project(camera);if(s.z>1||s.z<-1)continue;
  const x=(s.x+1)/2*innerWidth,y=(1-s.y)/2*innerHeight;if(x<0||y<0||x>innerWidth||y>innerHeight)continue;L.push([d,x,y,q.n+(q.to?' \u2192 '+q.to:'')+(()=>{if(!$('ls').checked)return'';const s=scr(q);if(!s)return'';const t=fill(q,s,s.c.brief);return' \u2014 '+(t.length>70?t.slice(0,68)+'\u2026':t)})()])}
 L.sort((a,b)=>a[0]-b[0]);lg.font='11px sans-serif';
 for(const[d,x,y,n]of L.slice(0,200)){lg.fillStyle='#000a';const w=lg.measureText(n).width;lg.fillRect(x+4,y-14,w+4,13);lg.fillStyle=col(n);lg.fillText(n,x+6,y-4)}}
let last=performance.now();
function tick(t){const dt=Math.min(.1,(t-last)/1000);last=t;
 const f=(keys.KeyW||keys.ArrowUp?1:0)-(keys.KeyS||keys.ArrowDown?1:0),s=(keys.KeyD||keys.ArrowRight?1:0)-(keys.KeyA||keys.ArrowLeft?1:0),u=(keys.KeyE?1:0)-(keys.KeyQ?1:0);
 if(f||s||u){const k=speed*((keys.ShiftLeft||keys.ShiftRight)?4:1)*dt,r=new V3(Math.cos(yaw),0,-Math.sin(yaw));
  camera.position.addScaledVector(fwd(),f*k).addScaledVector(r,s*k);camera.position.y+=u*k;need=true}
 if(need){need=false;camera.updateMatrixWorld();renderer.render(scene,camera);labels();tipUpdate()}
 requestAnimationFrame(tick)}
rs();camera.position.set(0,50,100);setCam();requestAnimationFrame(tick);

// Explicit viewer API for sibling ES modules. Accessors preserve live state and
// controlled function overrides without publishing properties on the browser global.
const viewerApiBindings = {
  get $() { return $; },
  get D() { return D; }, set D(value) { D = value; },
  get SCR() { return SCR; }, set SCR(value) { SCR = value; },
  get V3() { return V3; },
  get addVolumes() { return addVolumes; },
  get all() { return all; }, set all(value) { all = value; },
  get buildEnts() { return buildEnts; }, set buildEnts(value) { buildEnts = value; },
  get camera() { return camera; },
  get col() { return col; },
  get cv() { return cv; },
  get drag() { return drag; }, set drag(value) { drag = value; },
  get esc() { return esc; },
  get files() { return files; }, set files(value) { files = value; },
  get fwd() { return fwd; },
  get ggame() { return ggame; },
  get goto_() { return goto_; },
  get inspect() { return inspect; }, set inspect(value) { inspect = value; },
  get labels() { return labels; },
  get levels() { return levels; }, set levels(value) { levels = value; },
  get loadJson() { return loadJson; }, set loadJson(value) { loadJson = value; },
  get mdown() { return mdown; }, set mdown(value) { mdown = value; },
  get mz() { return mz; }, set mz(value) { mz = value; },
  get nearest() { return nearest; },
  get need() { return need; }, set need(value) { need = value; },
  get openClass() { return openClass; },
  get openFiles() { return openFiles; }, set openFiles(value) { openFiles = value; },
  get pick() { return pick; },
  get pitch() { return pitch; }, set pitch(value) { pitch = value; },
  get refresh() { return refresh; }, set refresh(value) { refresh = value; },
  get regTxt() { return regTxt; },
  get root() { return root; },
  get scr() { return scr; }, set scr(value) { scr = value; },
  get scrDetail() { return scrDetail; }, set scrDetail(value) { scrDetail = value; },
  get scrIx() { return scrIx; }, set scrIx(value) { scrIx = value; },
  get scrSel() { return scrSel; }, set scrSel(value) { scrSel = value; },
  get scrVar() { return scrVar; }, set scrVar(value) { scrVar = value; },
  get sel() { return sel; }, set sel(value) { sel = value; },
  get show() { return show; }, set show(value) { show = value; },
  get shown() { return shown; },
  get tab() { return tab; }, set tab(value) { tab = value; },
  get wrap() { return wrap; },
  get yaw() { return yaw; }, set yaw(value) { yaw = value; },
};
export const Viewer = Object.create(null);
Object.defineProperties(Viewer, Object.getOwnPropertyDescriptors(viewerApiBindings));
