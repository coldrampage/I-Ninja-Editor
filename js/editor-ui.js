// ES-module entry point for the existing editor UI.
// Parser, editor, assembler, and viewer APIs are imported directly.
import {
  parseVol, wadName, readWad, r2, instances, fixups, vs, siWad
} from './vol-core.js';
import { EC } from './editor-core.js';
import { IA } from './strat-assembler.js';
import { Viewer } from './viewer.js';
import { installModelEditor } from './models-panel.js';
import { installScriptEditor } from './script-editor.js';

// Shared viewer state is accessed only through the imported Viewer API. No viewer
// properties are published on window.


// ---- editor UI: edits live in a project (json); the game files are never modified, a patched copy is built on demand
(()=>{
let PRJ={app:'ininja-editor',v:1,vol:null,wads:{}},clip=null,grab=false,mouse={x:0,y:0},volName='vol',AVLS={},WC={},SP={},pfFor=null,inR=0;
let resetModelCaches=()=>{},buildScriptWadsFp=()=>({});
const r3=x=>Math.round(x*1000)/1000,wadOf=L=>Viewer.levels[L]&&Viewer.levels[L].LCS?Viewer.levels[L].LCS.name:null,lvOf=w=>w.replace(/\.LCS$/i,'');
const isVol=()=>Viewer.files.some(f=>f.vol&&f.buf&&f.buf.byteLength>16&&new DataView(f.buf).getUint32(0,true)===0x544c4f56);
let linkPick=null,regOpen=false;
const vbase=n=>String(n||'').replace(/\.(vol|avl)$/i,'').toLowerCase(),volOf=w=>{const f=Viewer.files.find(x=>x.name===w);return f&&f.vol},loadedVols=()=>[...new Set(Viewer.files.filter(f=>f.vol).map(f=>f.vol))];
const avlOk=v=>!!v&&!!AVLS[vbase(v)];
// the .avl is only read when a patched one has to be built
async function avlLoad(v){const a=AVLS[vbase(v)];if(!a)throw'no '+vbase(v)+'.avl loaded (it holds the sounds of '+v+')';if(!a.buf){a.buf=await a.file.arrayBuffer();a.list=parseVol(a.buf)}return a}
const WS=w=>{const P=PRJ.wads[w]||(PRJ.wads[w]={vol:volOf(w)||volName,mods:{},adds:[]});P.del=P.del||[];P.classes=P.classes||[];return P};
const qm=(a,b)=>[a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1],a[3]*b[1]-a[0]*b[2]+a[1]*b[3]+a[2]*b[0],a[3]*b[2]+a[0]*b[1]-a[1]*b[0]+a[2]*b[3],a[3]*b[3]-a[0]*b[0]-a[1]*b[1]-a[2]*b[2]];
const base=e=>e.base||(e.base={p:e.p.slice(),b:e.b&&e.b.slice(),poly:e.poly&&e.poly.slice(),path:e.path&&e.path.map(n=>n.slice()),r:e.r,q:e.q&&e.q.slice(),pv:e.params.map(p=>p.v)});
function put(e,m){const B=base(e),d=m.d||[0,0,0],dy=m.dy||0,dp=m.dp||0,dr=m.dr||0;e.p=B.p.map((v,k)=>r2(v+d[k]));e.b=B.b&&B.b.map((v,k)=>r2(v+d[k%3]));e.poly=B.poly&&B.poly.map((v,k)=>r2(v+d[k%3]));
 e.path=B.path&&B.path.map(n=>n.map((v,k)=>r2(v+d[k])));e.r=B.r+dy;if(B.q){const g2=x=>x/4096*2*Math.PI,ay=g2(dy),ap=g2(dp),ar=g2(dr);e.q=qm(qm([0,Math.sin(ay/2),0,Math.cos(ay/2)],B.q),qm([Math.sin(ap/2),0,0,Math.cos(ap/2)],[0,0,Math.sin(ar/2),Math.cos(ar/2)]))}
 e.params=e.params.map((p,k)=>m.regs&&m.regs[k]!==undefined&&!p.s?{...p,v:m.regs[k]>>>0}:{...p,v:B.pv[k]})}
// any strat wad of the loaded volume can be a prefab source, loaded in the 3D view or not
function spLoad(w){if(SP[w])return SP[w];const f=Viewer.files.find(x=>x.name===w);if(!f)return null;const[A,B]=readWad(f.buf,f),ents=instances(A,B),pick={},first={};
 for(const e of ents){if(first[e.n]===undefined)first[e.n]=e.i;if(pick[e.n]===undefined&&!EC.prefabCheck(A,B,e.i))pick[e.n]=e.i}
 let rp={};try{rp=EC.classReports(A,B)}catch(e){console.error('class report failed for',w,e)}
 return SP[w]={ents,pick,first,rep:rp,cls:new Set(siWad(A,B).classes.map(c=>c.name))}}
const srcEnt=a=>{const l=Viewer.D.find(x=>x.id===lvOf(a.from.w));if(l)return (l.all0||l.ents).find(e=>e.i===a.from.i&&!e.added);const s=spLoad(a.from.w);return s&&s.ents[a.from.i]};
const unzero=m=>m.d.some(x=>x)||m.dy||m.dp||m.dr||Object.keys(m.regs).length||(m.lk&&m.lk.length);
// re-derive every loaded level from the base data + project (idempotent)
function applyEdits(){for(const lv of Viewer.D){const w=wadOf(lv.id);if(!w)continue;if(!lv.all0){lv.all0=lv.ents.slice();lv.nb=lv.all0.length}
  const orig=lv.all0,P=PRJ.wads[w],del=new Set(P&&P.del||[]);for(const e of orig){if(e.base)put(e,{})}
  if(P)for(const[k,m]of Object.entries(P.mods)){const e=orig[+k];if(e&&e.i==+k)put(e,m)}
  lv.ents=orig.filter(e=>!del.has(e.i));
  if(P)P.adds.forEach((a,k)=>{const s=srcEnt(a);if(!s)return;const B=base(s),e={...s,params:s.params.map(p=>({...p})),i:lv.nb+k,added:k+1,base:{...B}};
   put(e,{d:a.p.map((v,j)=>v-B.p[j]),dy:a.dy||0,dp:a.dp||0,dr:a.dr||0,regs:a.regs});lv.ents.push(e);
   const sl=Viewer.SCR.levels[lvOf(a.from.w)];if(sl&&sl[s.i]&&Viewer.SCR.levels[lv.id])Viewer.SCR.levels[lv.id][e.i]=linkView(lv,P,sl[s.i],a,lvOf(a.from.w)===lv.id,true)});
  // moved originals: links changed by hand
  const SL=Viewer.SCR.levels[lv.id];if(SL){lv.scr0=lv.scr0||{};for(const k in lv.scr0)SL[k]=lv.scr0[k];
   if(P)for(const[k,m]of Object.entries(P.mods)){const x=SL[k];if(!x||!((m.lk&&m.lk.length)||Object.keys(m.regs||{}).length))continue;if(!(k in lv.scr0))lv.scr0[k]=x;SL[k]=linkView(lv,P,x,m,true,false)}}}}
// script info of an object with its hand-made links applied: lk = to added objects (by id), regs = to originals (by number); a copied add from ANOTHER level has no valid links of its own
function linkView(lv,P,x,a,sameLevel,isAdd){const y={...x,r:(x.r||[]).slice(),l:sameLevel||!isAdd?x.l.map(q=>q.slice()):x.l.map(q=>[q[0],-1])},set=(rg,v)=>{const q=y.l.find(z=>z[0]==rg);if(q)q[1]=v;else y.l.push([rg,v]);y.r[rg]=v};
 for(const[rg,v]of Object.entries(a.regs||{}))if(x.l.some(q=>q[0]==rg))set(+rg,v>>>0);
 for(const[rg,cid]of(a.lk||[])){const n=P.adds.findIndex(z=>z.id===cid);if(n>=0)set(+rg,lv.nb+n)}
 return y}
const orf=Viewer.refresh;Viewer.refresh=()=>{if(!inR){inR=1;try{applyEdits()}finally{inR=0}}orf();edUpdate()};
const ent=q=>{const lv=Viewer.D.find(l=>l.id===q.L);return lv&&lv.ents.find(e=>e.i===q.i)};
// the editable record of an entity: a mod (moved original) or an add (new instance)
function rec(q){const e=ent(q),w=wadOf(q.L);if(!e||!w)return null;const P=WS(w);
 if(e.added)return{e,w,add:P.adds[e.added-1]};const m=P.mods[e.i]||(P.mods[e.i]={d:[0,0,0],dy:0,dp:0,dr:0,regs:{}});return{e,w,m}}
function redo(R){if(R.add){const s=srcEnt(R.add),B=base(s);put(R.e,{d:R.add.p.map((v,j)=>v-B.p[j]),dy:R.add.dy||0,dp:R.add.dp||0,dr:R.add.dr||0,regs:R.add.regs})}else{put(R.e,R.m);if(!unzero(R.m))delete PRJ.wads[R.w].mods[R.e.i]}
 const q=Viewer.all.find(o=>o.L===Viewer.sel.L&&o.i===R.e.i);Object.assign(q,{p:R.e.p,b:R.e.b,poly:R.e.poly,path:R.e.path,r:R.e.r,q:R.e.q,params:R.e.params});Viewer.sel=q;Viewer.buildEnts();Viewer.need=true;edUpdate()}
function setPos(R,p){if(R.add)R.add.p=p.map(r3);else R.m.d=p.map((v,k)=>r3(v-base(R.e).p[k]));redo(R)}
function setYaw(R,deg){const dy=r3((deg/360*4096)-(R.add?base(srcEnt(R.add)).r:base(R.e).r));if(R.add)R.add.dy=dy;else R.m.dy=dy;redo(R)}
function setTilt(R,key,deg){const v=r3(deg/360*4096);if(R.add)R.add[key]=v;else R.m[key]=v;redo(R)}
function setReg(R,k,v){(R.add||R.m).regs[k]=v>>>0;redo(R)}
const nudge=(dx,dy,dz,dyaw)=>{if(!Viewer.sel)return;const R=rec(Viewer.sel);if(!R)return;const p=R.e.p;setPos(R,[p[0]+dx,p[1]+dy,p[2]+dz]);if(dyaw)setYaw(R,(R.e.r/4096*360+dyaw+360)%360)};
// ---- panel
const ui=document.createElement('div');ui.id='ed';
ui.innerHTML='<hr><b>Editor</b> <span class=h>edits go in a project file; game files are never touched</span><details style="margin:3px 0"><summary class=h>current scope</summary><div class=h><b>Rotation:</b> yaw, pitch and roll are editable. Yaw turns about world up; pitch (local X) and roll (local Z) are applied on top of the original orientation and shown as changes from it.<br><b>No LCM edits:</b> only .LCS strat data can be edited. The project format is per-wad, so LCM edits can slot in later.</div></details><div style="margin:3px 0"><button id=ed_open>open project</button> <button id=ed_save>save project</button> <button id=ed_patch>build patched .vol</button> <button id=ed_md>models</button> <button id=ed_stb>copier self-test</button></div><input type=file id=ed_pf style=display:none accept=.json><div id=ed_sum class=h></div><div id=ed_rm class=h></div><div id=ed_sel class=h>click an entity to edit it</div>'
 +'<div style="margin-top:4px"><span class=h>add prefab to</span> <select id=ed_lv style="max-width:90px"></select> <select id=ed_cl style="max-width:170px"></select> <button id=ed_add>add</button><br><label class=h title="A spawner links to the objects it spawns. Tick this to copy those objects too, as separate objects that link to each other, so the copy spawns its own set."><input type=checkbox id=ed_deep> also copy the objects it links to</label></div>';
Viewer.$('ctl').insertBefore(ui,Viewer.$('ctl').firstChild);
Viewer.$('ed_open').onclick=()=>Viewer.$('ed_pf').click();
Viewer.$('ed_pf').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{const j=JSON.parse(await f.text());if(j.app!=='ininja-editor')throw'not an editor project';PRJ=j;PRJ.models=PRJ.models||{};PRJ.scripts=PRJ.scripts||{};for(const w in PRJ.wads){PRJ.wads[w].mods=PRJ.wads[w].mods||{};PRJ.wads[w].adds=PRJ.wads[w].adds||[]}Viewer.refresh();Viewer.$('ed_sum').textContent='project loaded: '+f.name+' (apply to levels you load later by loading them again)'}catch(x){Viewer.$('ed_sum').textContent='open failed: '+x}e.target.value=''};
const getWad=w=>{if(WC[w])return WC[w];const f=Viewer.files.find(x=>x.name===w);if(!f)return null;const[A,B]=readWad(f.buf,f);return WC[w]={A,B,cls:new Set(siWad(A,B).classes.map(c=>c.name))}};
function summary(){let m=0,a=0,n=0,r=0;for(const w in PRJ.wads){const x=Object.values(PRJ.wads[w].mods).filter(unzero).length,y=PRJ.wads[w].adds.length,z=(PRJ.wads[w].del||[]).length;m+=x;a+=y;r+=z;if(x||y||z)n++}Viewer.$('ed_sum').textContent=m+' moved/edited, '+a+' added, '+r+' removed in '+n+' level(s)'+(Object.keys(PRJ.vols||{}).length>1?' ['+Object.keys(PRJ.vols).join(', ')+']':'')}
function rmList(){const out=[];for(const lv of Viewer.D){const w=wadOf(lv.id),P=w&&PRJ.wads[w];if(!P||!lv.all0)continue;for(const i of P.del||[])if(lv.all0[i])out.push([w,i,lv.all0[i].n,lv.id])}
 Viewer.$('ed_rm').innerHTML=out.length?'removed: '+out.slice(0,12).map(([w,i,n,L])=>L+'#'+i+' '+Viewer.esc(n)+' <a href=# data-w="'+w+'" data-i='+i+'>restore</a>').join(' &middot; ')+(out.length>12?' &hellip;':''):'';
 Viewer.$('ed_rm').querySelectorAll('a').forEach(a=>a.onclick=e=>{e.preventDefault();const P=PRJ.wads[a.dataset.w];P.del=P.del.filter(x=>x!=+a.dataset.i);Viewer.refresh()})}
function edUpdate(){summary();rmList();const S=Viewer.$('ed_sel'),R=Viewer.sel&&rec(Viewer.sel),SI=Viewer.sel&&Viewer.scr(Viewer.sel);
 const lv=Viewer.$('ed_lv'),cur=lv.value;lv.innerHTML=Viewer.D.filter(l=>wadOf(l.id)).map(l=>'<option>'+l.id+'</option>').join('');if(cur)lv.value=cur;else if(Viewer.sel&&wadOf(Viewer.sel.L))lv.value=Viewer.sel.L;
 if(!R){S.innerHTML='<span class=h>click an entity to edit it</span>';return}
 const e=R.e,f=(id,v,st)=>'<input type=number id='+id+' value="'+v+'" step='+st+' style="width:62px">';
 S.innerHTML='<b style="color:'+Viewer.col(e.n)+'">'+Viewer.esc(e.n)+'</b> <span class=h>'+Viewer.sel.L+' #'+e.i+(e.added?' (new, copy of #'+R.add.from.i+')':'')+'</span><br>X '+f('ed_x',e.p[0],.5)+' Y '+f('ed_y',e.p[1],.5)+' Z '+f('ed_z',e.p[2],.5)+'<br>yaw '+f('ed_w',+(e.r/4096*360).toFixed(1),5)+'&deg;<br>pitch '+f('ed_pt',+(((R.add||R.m).dp||0)/4096*360).toFixed(1),5)+'&deg; roll '+f('ed_rl',+(((R.add||R.m).dr||0)/4096*360).toFixed(1),5)+'&deg; <span class=h>(change from original)</span><br>step <input type=number id=ed_st value='+(S.dataset.st||1)+' style="width:48px"><br>'
  +['-X','+X','-Y','+Y','-Z','+Z'].map(t=>'<button data-n="'+t+'">'+t+'</button>').join('')+' <button data-n="L">&#8634;15</button><button data-n="R">&#8635;15</button><br><button id=ed_cp>copy</button> <button id=ed_ps>paste</button> '+'<button id=ed_del>'+(e.added?'delete':'remove')+'</button>'
  +'<div class=h>hold G + move mouse to drag on the ground plane; Ctrl+C / Ctrl+V copy and paste at the cursor</div>'
  +(e.params.some(p=>!p.s)?'<details'+(regOpen||linkPick?' open':'')+'><summary>registers</summary>'+e.params.map((p,k)=>{const lq=!p.s&&SI&&SI.l.find(a=>a[0]==k);if(lq){const H=R.add||R.m,ov=(H.lk||[]).some(l=>l[0]==k)||H.regs[k]!==undefined,on=linkPick&&linkPick.L===Viewer.sel.L&&linkPick.i===e.i&&linkPick.k==k;return '<div>r'+k+' <span class=h>'+Viewer.esc(Viewer.regTxt(Viewer.sel,SI,k))+'</span> <button data-lk='+k+(on?' style="background:#fa0"':'')+'>'+(on?'click target...':'link...')+'</button>'+(ov?' <button data-lkr='+k+' title="back to what the copied/original object had">reset</button>':'')+'</div>'}
   return '<div>r'+k+' '+(p.s?'<span class=h>"'+Viewer.esc(p.s)+'"</span>':'<input type=number id=ed_r'+k+' data-k='+k+' value='+(p.v>>>0)+' style="width:100px">')+'</div>'}).join('')+'<div class=h>raw 32-bit values (floats are stored as their bit pattern). A register that links to another object has a link... button: press it, then click the object to link to (same level; Esc cancels).</div></details>':'');
 const g=id=>+Viewer.$(id).value;for(const id of['ed_x','ed_y','ed_z'])Viewer.$(id).onchange=()=>setPos(R,[g('ed_x'),g('ed_y'),g('ed_z')]);
 Viewer.$('ed_w').onchange=()=>setYaw(R,g('ed_w'));Viewer.$('ed_pt').onchange=()=>setTilt(R,'dp',g('ed_pt'));Viewer.$('ed_rl').onchange=()=>setTilt(R,'dr',g('ed_rl'));Viewer.$('ed_st').onchange=()=>{S.dataset.st=g('ed_st')};
 S.querySelectorAll('button[data-n]').forEach(b=>b.onclick=()=>{const s=+Viewer.$('ed_st').value||1,t=b.dataset.n,ax={X:0,Y:1,Z:2}[t[1]],v=[0,0,0];if(t=='L')return nudge(0,0,0,-15);if(t=='R')return nudge(0,0,0,15);v[ax]=t[0]=='-'?-s:s;nudge(...v,0)});
 S.querySelectorAll('input[data-k]').forEach(i=>i.onchange=()=>setReg(R,+i.dataset.k,+i.value));
 S.querySelectorAll('button[data-lk]').forEach(b=>b.onclick=()=>startLink(+b.dataset.lk));
 S.querySelectorAll('button[data-lkr]').forEach(b=>b.onclick=()=>resetLink(R,+b.dataset.lkr));
 const dt=S.querySelector('details');if(dt)dt.ontoggle=()=>{regOpen=dt.open};
 Viewer.$('ed_cp').onclick=copy;Viewer.$('ed_ps').onclick=()=>paste();const dl=Viewer.$('ed_del');if(dl)dl.onclick=()=>{const P=WS(R.w);if(R.e.added){const rid=R.add&&R.add.id;P.adds.splice(R.e.added-1,1);if(rid!==undefined)for(const x of[...P.adds,...Object.values(P.mods)])if(x.lk)x.lk=x.lk.filter(l=>l[1]!==rid)}else{const g=getWad(R.w),rf=g?EC.referrers(g.A,g.B,R.e.i).filter(o=>!P.del.includes(o)):[];
   if(rf.length){Viewer.$('ed_sum').textContent='cannot remove #'+R.e.i+': '+rf.map(o=>'#'+o).join(', ')+' link to it. Remove or change those first.';return}P.del.push(R.e.i);delete P.mods[R.e.i]}Viewer.sel=null;Viewer.inspect(null);Viewer.refresh()}}
// ---- manual link reassignment: press "link..." next to a link register, then click the object it should point at
function startLink(k){const R=Viewer.sel&&rec(Viewer.sel);if(!R)return;linkPick={L:Viewer.sel.L,i:R.e.i,k};Viewer.cv.style.cursor='crosshair';edUpdate();Viewer.$('ed_sum').textContent='r'+k+' of '+R.e.n+' #'+R.e.i+': click the object to link to (same level, Esc cancels)'}
function endPick(msg){linkPick=null;Viewer.cv.style.cursor='';edUpdate();if(msg)Viewer.$('ed_sum').textContent=msg}
function finishLink(q){const lp=linkPick;if(!lp)return;if(q.L!==lp.L){Viewer.$('ed_sum').textContent='the target has to be in the same level ('+lp.L+'): click again, or Esc to cancel';return}
 const src=Viewer.all.find(o=>o.L===lp.L&&o.i===lp.i),R=src&&rec(src);if(!R){endPick();return}
 const H=R.add||R.m,te=ent(q);H.lk=(H.lk||[]).filter(l=>l[0]!==lp.k);
 if(te&&te.added){const T=WS(wadOf(q.L)).adds[te.added-1];if(T.id===undefined)T.id=addMaxId()+1;H.lk.push([lp.k,T.id]);delete H.regs[lp.k]}else H.regs[lp.k]=q.i>>>0;
 const nm=q.n;linkPick=null;Viewer.cv.style.cursor='';afterLink(lp.L,R.e.i);Viewer.$('ed_sum').textContent='r'+lp.k+' of '+R.e.n+' #'+R.e.i+' now links to #'+q.i+' '+nm}
function resetLink(R,k){const H=R.add||R.m;H.lk=(H.lk||[]).filter(l=>l[0]!==k);delete H.regs[k];afterLink(Viewer.sel.L,R.e.i)}
// link registers of an added object that were set by hand mean instance numbers of ONE level: drop them when the object goes to another level
function stripLinkRegs(a){const L=srcLinks(a.from.w);if(L)for(const[ow,rg]of L.rows)if(ow===a.from.i)delete a.regs[rg];a.lk=[]}
function afterLink(L,i){Viewer.refresh();Viewer.sel=Viewer.all.find(o=>o.L===L&&o.i===i)||null;Viewer.inspect(Viewer.sel);edUpdate();Viewer.need=true}
const omu=onmouseup;onmouseup=e=>{if(linkPick&&Viewer.mdown&&Viewer.mdown.b==0&&Math.hypot(e.clientX-Viewer.mdown.x,e.clientY-Viewer.mdown.y)<4&&e.target===Viewer.cv){const q=Viewer.nearest(e.clientX,e.clientY);Viewer.mdown=null;Viewer.drag=null;if(q)finishLink(q);return}omu(e)};
addEventListener('keydown',e=>{if(e.code==='Escape'&&linkPick)endPick('link pick cancelled')});
function copy(){if(!Viewer.sel)return;const R=rec(Viewer.sel);if(!R)return;const H=R.add||R.m;clip=R.add?{from:{...R.add.from},dy:R.add.dy||0,dp:R.add.dp||0,dr:R.add.dr||0,regs:{...R.add.regs}}:{from:{w:R.w,i:R.e.i},dy:R.m.dy||0,dp:R.m.dp||0,dr:R.m.dr||0,regs:{...R.m.regs}};clip.lk=(H.lk||[]).map(l=>l.slice());clip.at=R.w;Viewer.$('ed_sum').textContent='copied '+R.e.n}
function ground(mx,my,y){const v=new Viewer.V3(mx/innerWidth*2-1,-(my/innerHeight)*2+1,.5).unproject(Viewer.camera).sub(Viewer.camera.position).normalize();if(Math.abs(v.y)<1e-3)return null;const t=(y-Viewer.camera.position.y)/v.y;if(t<0||t>5000)return null;return Viewer.ggame(Viewer.camera.position.clone().addScaledVector(v,t))}
function paste(at){if(!clip||!Viewer.sel)return;const w=wadOf(Viewer.sel.L);let p=at||(()=>{const sp=Viewer.sel.p,g=ground(mouse.x,mouse.y,Viewer.sel.p[1]);return g||[sp[0]+3,sp[1],sp[2]+3]})();
const a={from:{...clip.from},p:p.map(r3),dy:clip.dy,dp:clip.dp||0,dr:clip.dr||0,regs:{...clip.regs}};if(clip.at===w&&clip.lk&&clip.lk.length)a.lk=clip.lk.map(l=>l.slice());else stripLinkRegs(a);
 // paste into the selected entity's level (clones from another level need a compatible class there)
 try{const t=getWad(w),s=getWad(clip.from.w);if(lvOf(clip.from.w)!==lvOf(w)){const n=srcEnt(a).n;const why=ensureClass(w,clip.from.w,n);if(why)throw n+' cannot be copied into '+w+': '+why;const bad=EC.prefabCheck(s.A,s.B,a.from.i);if(bad)throw bad}}catch(x){Viewer.$('ed_sum').textContent='cannot paste: '+x;return}
 const pi=pushAdds(w,a);Viewer.refresh();const L=lvOf(w),lv=Viewer.D.find(l=>l.id===L);Viewer.sel=Viewer.all.find(o=>o.L===L&&o.i===lv.nb+pi);Viewer.inspect(Viewer.sel);edUpdate();Viewer.need=true}
addEventListener('keydown',e=>{const t=e.target.tagName;if(t==='INPUT'||t==='SELECT')return;if(e.code==='KeyG')grab=true;if((e.ctrlKey||e.metaKey)&&e.code==='KeyC'){copy();e.preventDefault()}if((e.ctrlKey||e.metaKey)&&e.code==='KeyV'){paste();e.preventDefault()}});
addEventListener('keyup',e=>{if(e.code==='KeyG')grab=false});
Viewer.cv.addEventListener('mousemove',e=>{mouse={x:e.clientX,y:e.clientY};if(grab&&Viewer.sel&&!Viewer.drag){const R=rec(Viewer.sel),g=R&&ground(e.clientX,e.clientY,Viewer.sel.p[1]);if(g)setPos(R,[g[0],Viewer.sel.p[1],g[2]])}});
// ---- prefabs: one source instance per class, taken from the loaded levels (the class must exist in the target level)
const PFI={},SCx={},PFR={};
const srcCtx=w=>SCx[w]||(SCx[w]=(()=>{const g=getWad(w);return EC.SrcCtx(g.A,g.B)})());
const srcCls=a=>{const e=srcEnt(a);return e&&e.n};
// can the class be copied into the target level? (dry run of the real transplant; nothing is kept)
// sounds: the audio of a level lives in the .PCA inside NN.avl, so copying sounds needs that .avl loaded next to the .vol
// sounds of the target level go into ITS volume's .avl; every sound source level needs its own volume's .avl as well
const sndPlan=w=>{if(!avlOk(volOf(w)))return undefined;const f=Viewer.files.find(x=>x.name===w);if(!f)return undefined;const dv=new DataView(f.buf,f.off),p=EC.SoundPlan(dv.getUint32(0x78,true),dv.getUint32(0x7c,true)),add=p.add;p.add=r=>{const sv=volOf(r.w);if(!avlOk(sv))throw'its sounds come from '+r.w+' and need '+vbase(sv)+'.avl loaded';return add(r)};return p};
function tryClass(tw,w,name){const k=tw+'|'+w+'|'+name;if(PFR[k])return PFR[k];const tg=getWad(tw),tc=new Map(siWad(tg.A,tg.B).classes.map(c=>[c.name,c.off]));
 try{const SS=srcCtx(w);SS.wadName=w;const r=EC.transplantClasses(tg.A,tg.B,SS,[name],{res:EC.resResolver(SS,srcCtx(tw)).hook,cls:n=>tc.get(n),addRes:true,snd:sndPlan(tw)});return PFR[k]={ok:true,classes:r.classes,bytes:r.A.length-tg.A.length}}
 catch(e){return PFR[k]={ok:false,why:String(e)}}}
// make sure the target level will have the class (adds a project entry); returns null or the reason it cannot be copied
function ensureClass(tw,w,name){const t=getWad(tw);if(t.cls.has(name))return null;const P=WS(tw);if(P.classes.some(k=>k.from.name===name&&k.from.w===w))return null;const r=tryClass(tw,w,name);if(!r.ok)return r.why;P.classes.push({from:{w,name}});return null}
// why a class from wad s cannot be placed in a level that lacks it (null = its dependencies are self-contained)
function why(s,name,tcls,seen=new Set()){if(tcls.has(name)||seen.has(name))return[];seen.add(name);const r=s.rep[name];if(!r)return['no dependency data'];const out=[...r.reasons];
 for(const c of r.classes){if(tcls.has(c))continue;const sub=why(s,c,tcls,seen);if(sub.length)out.push('needs class '+c+': '+sub[0])}return out}
function repText(s,name,tcls,w){const r=s.rep[name];if(!r)return name+': no dependency data';const k=Object.entries(r.kinds).filter(([t])=>t!=='code').map(([t,n])=>n+' '+t).join(', ');
 const miss=r.classes.filter(c=>!tcls.has(c)),ws=why(s,name,tcls);
 return name+' ('+lvOf(w)+'): '+r.bytes+' bytes of code. Pointers: '+(k||'none')+'.'+(r.classes.length?' Uses classes: '+r.classes.map(c=>c+(tcls.has(c)?'':' (missing here)')).join(', ')+'.':'')+(r.strs.length?' Strings: '+r.strs.map(x=>'"'+x+'"').join(', ')+'.':'')
  +(tcls.has(name)?' This level already has the class.':ws.length?' Cannot be placed: '+ws.join('; ')+'.':' Select it to check whether it can be copied into this level.')}
async function fillPrefabs(force){const T=Viewer.$('ed_lv').value,tw=wadOf(T),cl=Viewer.$('ed_cl');if(!tw){cl.innerHTML='';pfFor=null;return}if(pfFor===T&&!force&&cl.options.length)return;pfFor=T;
 const ws=[tw,...Viewer.files.map(f=>f.name).filter(n=>/^\d+-\d+\.LCS$/i.test(n)&&n!==tw).sort((a,b)=>a.localeCompare(b,0,{numeric:true}))];let h='',k=0;const na={};
 for(const w of ws){if(!SP[w]){Viewer.$('ed_sum').textContent='reading prefabs from '+w+' ('+ ++k+'/'+ws.length+')...';await new Promise(r=>setTimeout(r))}
  const s=spLoad(w),t=SP[tw];if(!s)continue;const own=w===tw,src=own?s.first:s.pick,names=Object.keys(src).filter(n=>t.cls.has(n)).sort();
  if(!own)for(const n of Object.keys(s.first))if(!t.cls.has(n)&&!na[n])na[n]={w,i:s.first[n],s};
  if(names.length)h+='<optgroup label="'+lvOf(w)+(own?' (this level)':'')+'">'+names.map(n=>{const v=w+'|'+src[n];PFI[v]=repText(s,n,t.cls,w);return'<option value="'+v+'">'+n+' (#'+src[n]+')</option>'}).join('')+'</optgroup>'}
 const nn=Object.keys(na).sort(),t=SP[tw];
 if(nn.length)h+='<optgroup label="class missing in this level (cannot place)">'+nn.map(n=>{const v='!'+na[n].w+'|'+na[n].i,ok=!why(na[n].s,n,t.cls).length;PFI[v]=repText(na[n].s,n,t.cls,na[n].w);return'<option value="'+v+'">'+n+' ('+lvOf(na[n].w)+')'+(ok?(((na[n].s.rep[n]||{kinds:{}}).kinds.sound||0)&&!(avlOk(volOf(tw))&&avlOk(volOf(na[n].w)))?' - copyable (load the .avl for its sounds)':' - copyable'):' - not copyable')+'</option>'}).join('')+'</optgroup>'
 if(pfFor===T){cl.innerHTML=h;showRep()}summary()}
function showRep(){let r=Viewer.$('ed_rep');if(!r){r=document.createElement('div');r.id='ed_rep';r.className='h';r.style.cssText='margin-top:3px;max-height:110px;overflow:auto';Viewer.$('ed_cl').parentNode.after(r)}const v=Viewer.$('ed_cl').value;let t=PFI[v]||'';
 if(v&&v[0]==='!'){const[w,i]=v.slice(1).split('|'),name=Viewer.$('ed_cl').selectedOptions[0].textContent.split(' (')[0],tw=wadOf(Viewer.$('ed_lv').value);if(tw){const x=tryClass(tw,w,name);t+=x.ok?'\nCheck: can be copied into '+lvOf(tw)+' ('+x.classes.join(', ')+' ; +'+x.bytes+' bytes). Press add to place one.':'\nCheck: cannot be copied: '+x.why+'.'}}
 r.style.whiteSpace='pre-wrap';r.textContent=t}
Viewer.$('ed_lv').onfocus=Viewer.$('ed_cl').onfocus=()=>fillPrefabs();Viewer.$('ed_lv').onchange=()=>fillPrefabs();Viewer.$('ed_cl').onchange=showRep;
Viewer.$('ed_add').onclick=()=>{const T=Viewer.$('ed_lv').value,v=Viewer.$('ed_cl').value;if(!T||!v)return;const miss=v[0]==='!',[w,i]=(miss?v.slice(1):v).split('|'),tw=wadOf(T);if(miss){const name=Viewer.$('ed_cl').selectedOptions[0].textContent.split(' (')[0],why=ensureClass(tw,w,name);if(why){showRep();Viewer.$('ed_sum').textContent='cannot add '+name+': '+why;return}}const p=ground(innerWidth/2,innerHeight/2,Viewer.sel?Viewer.sel.p[1]:0)||Viewer.ggame(Viewer.camera.position.clone().addScaledVector(Viewer.fwd(),25));
 const pi=pushAdds(tw,{from:{w,i:+i},p:p.map(r3),dy:0,regs:{}});Viewer.refresh();const lv=Viewer.D.find(l=>l.id===T);Viewer.sel=Viewer.all.find(o=>o.L===T&&o.i===lv.nb+pi);Viewer.inspect(Viewer.sel);edUpdate();Viewer.need=true};
// ---- project save / patch
const dl=(parts,name,type)=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(parts,{type}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),60000)};
function clean(){const o={};for(const w in PRJ.wads){const P=PRJ.wads[w],mods={};for(const k in P.mods)if(unzero(P.mods[k]))mods[k]=P.mods[k];const del=[...new Set(P.del||[])].sort((a,b)=>a-b),classes=(P.classes||[]).filter(k=>P.adds.some(a=>a.from.w===k.from.w&&(srcCls(a)===k.from.name)));if(Object.keys(mods).length||P.adds.length||del.length)o[w]={vol:volOf(w)||P.vol,mods,adds:P.adds,del,classes,fp:P.fp}}return o}
// wads that belong to other volumes keep their stored fingerprint; only wads in the loaded volume are checked
function withFp(){const c=clean();for(const w in c){const g=getWad(w);if(!g)continue;const old=PRJ.wads[w].fp,fp={A:EC.fnv(g.A),B:EC.fnv(g.B)};if(old&&(old.A!==fp.A||old.B!==fp.B))throw w+' does not match the base this project was made for';c[w].fp=fp;c[w].vol=volOf(w)||volName;PRJ.wads[w].fp=fp;PRJ.wads[w].vol=volOf(w)||volName}return c}
const pending=c=>[...new Set(Object.keys(c).filter(w=>!getWad(w)).map(w=>c[w].vol||w.split('-')[0]+'.vol'))];
Viewer.$('ed_save').onclick=()=>{try{if(!isVol())throw'load a .vol first';const wads=withFp();{const vv={...PRJ.vols};for(const f of Viewer.files)if(f.vol)vv[f.vol]=f.buf.byteLength;PRJ.vols=vv}const scr=buildScriptWadsFp();dl([JSON.stringify({app:'ininja-editor',v:1,vols:PRJ.vols,models:PRJ.models||{},wads,scripts:scr},null,1)],'ininja-project.json','application/json');Viewer.$('ed_sum').textContent='project saved: '+Object.keys(wads).length+' level(s) with instance edits, '+Object.keys(scr).length+' with code edits (holds only your edits, no game data)'}catch(x){Viewer.$('ed_sum').textContent='save failed: '+x}};
Viewer.$('ed_patch').onclick=async()=>{try{if(!isVol())throw'load the original .vol first';const wads=withFp(),sc=buildScriptWadsFp(),names=[...new Set([...Object.keys(wads),...Object.keys(sc)])].filter(w=>getWad(w)),pend=[...new Set([...pending(wads),...Object.keys(sc).filter(w=>!getWad(w)).map(w=>sc[w].vol||w.split('-')[0]+'.vol')])];if(!names.length)throw'the project has no edits for '+loadedVols().join(', ')+(pend.length?' (it has edits for '+pend.join(', ')+': load that volume and build again)':'');
  const byVol={};for(const w of names)(byVol[volOf(w)]=byVol[volOf(w)]||[]).push(w);
  const srcWad=n=>getWad(n),healed=[],outs=[];let i=0;
  for(const V of Object.keys(byVol)){const rep={},plans={};
   for(const w of byVol[V]){Viewer.$('ed_sum').textContent='patching '+w+' ('+ ++i+'/'+names.length+')...';await new Promise(r=>setTimeout(r));
   const f=Viewer.files.find(x=>x.name===w),hdr=new Uint8Array(f.buf,f.off,new DataView(f.buf,f.off).getUint32(4,true)+16).slice(),g=getWad(w);let A=g.A,B=g.B;if(sc[w]){const bl=new Map(Object.entries(sc[w].blocks).map(([k,v])=>[+k,v])),x=IA.relink(A,B,bl),v=IA.verify(IA.wadCtx(A,B),x.A,x.B,x.info.relocs,new Set(bl.keys()));if(v.bad.length)throw w+': code edit verification failed: '+v.bad.slice(0,3).join('; ');A=x.A;B=x.B}const sp=sndPlan(w),r0=wads[w]?EC.patchLcs(A,B,wads[w],w,srcWad,{snd:sp}):{A,B},r=EC.healResDir(r0.A,r0.B);if(r.added.tex||r.added.mesh)healed.push(w+' (+'+r.added.tex+' tex, +'+r.added.mesh+' mesh)');if(sp&&sp.adds.length){const dh=new DataView(hdr.buffer,hdr.byteOffset);dh.setUint32(0x78,sp.h78,true);dh.setUint32(0x7c,sp.h7c,true);plans[w]=sp}rep[w]=EC.packWad(hdr,r.A,r.B)}
   // copied sounds: rebuild the affected levels' .PCA (resident block + streamed block) and lay this volume's .avl out again
   let ap=null,avlOut='';if(Object.keys(plans).length){const need=new Set([V]);for(const w in plans)for(const a of plans[w].adds)need.add(volOf(a.w));for(const v of need)await avlLoad(v);
    const pn=n=>n.replace(/\.LCS$/i,'.PCA'),pcaOf=n=>{const a=AVLS[vbase(volOf(n))],e=a&&a.list&&a.list.find(x=>x.name===pn(n));if(!e)throw'no '+pn(n)+' in '+(a?a.name:vbase(volOf(n))+'.avl');return new Uint8Array(a.buf,e.off,e.size)},rep2={};
    for(const w in plans)rep2[pn(w)]=EC.buildPca(pcaOf(w),plans[w],sw=>{const sf=Viewer.files.find(x=>x.name===sw);return sf?{pca:pcaOf(sw),h78:new DataView(sf.buf,sf.off).getUint32(0x78,true)}:null});
    const A=AVLS[vbase(V)];ap=EC.rebuildVol(A.buf,rep2);avlOut=A.name.replace(/\.avl$/i,'')+'.patched.avl'}
   const vf=Viewer.files.find(x=>x.vol===V);outs.push({V,parts:EC.rebuildVol(vf.buf,rep),out:V.replace(/\.vol$/i,'')+'.patched.vol',ap,avlOut,A:ap&&AVLS[vbase(V)].name,n:byVol[V]})}
  // one download per file, spaced out so the browser does not drop them
  let k=0;for(const o of outs){setTimeout(()=>dl(o.parts,o.out,'application/octet-stream'),600*k++);if(o.ap)setTimeout(()=>dl(o.ap,o.avlOut,'application/octet-stream'),600*k++)}
  Viewer.$('ed_sum').textContent='built '+outs.map(o=>o.out+(o.ap?' + '+o.avlOut:'')).join(', ')+' ('+names.join(', ')+'). Back up your originals, then replace each with its patched file (rename it to the original name).'+(outs.some(o=>o.ap)?' Sounds were copied, so a patched .avl was built for '+outs.filter(o=>o.ap).map(o=>o.V).join(', ')+': install it together with its .vol.':'')+(healed.length?' Added missing entries to the level resource directory: '+healed.join(', ')+'.':'')+(pend.length?' Still to build: '+pend.join(', ')+' (load it, open the same project, build).':'')}catch(x){Viewer.$('ed_sum').textContent='patch failed: '+x;console.error(x)}};
// remember the volume's file name; accept project .json through the normal file picker / drop
const oof=Viewer.openFiles;Viewer.openFiles=async fs=>{fs=[...fs];
 // .avl files are paired with the .vol of the same name (10.avl <-> 10.vol); they are only read when a build needs them
 const avls=fs.filter(f=>/\.avl$/i.test(f.name));for(const a of avls)AVLS[vbase(a.name)]={file:a,name:a.name,buf:null,list:null};if(avls.length)for(const k in PFR)delete PFR[k];
 fs=fs.filter(f=>!avls.includes(f));
 const vs=fs.filter(f=>/\.vol$/i.test(f.name));
 if(vs.length){WC={};SP={};pfFor=null;resetModelCaches();for(const k in PFR)delete PFR[k];const vols=[];
  for(const v of vs){Viewer.$('st').textContent='reading '+v.name+' ('+(vols.length+1)+'/'+vs.length+')...';await new Promise(r=>setTimeout(r));vols.push({name:v.name,ab:await v.arrayBuffer()})}
  const dup=Viewer.addVolumes(vols);volName=vs[vs.length-1].name;fs=fs.filter(f=>!vs.includes(f)&&!/\.(lcs|lcm|xbm|xbs)$/i.test(f.name));
  if(dup.length)Viewer.$('st').textContent+='\nskipped duplicate file names (already in another volume): '+dup.slice(0,6).join(', ')+(dup.length>6?', ...':'')}
 if(vs.length||avls.length){const t=Viewer.$('ed_sum');if(t){const L=loadedVols();t.textContent='volumes: '+(L.map(v=>v+' ('+(avlOk(v)?vbase(v)+'.avl found':'no '+vbase(v)+'.avl: sounds of its levels cannot be copied')+')').join(', ')||'none')+(avls.some(a=>!L.some(v=>vbase(v)===vbase(a.name)))?'. Waiting for the .vol that goes with '+avls.filter(a=>!L.some(v=>vbase(v)===vbase(a.name))).map(a=>a.name).join(', '):'')}}
 return fs.length?oof(fs):undefined};
const olj=Viewer.loadJson;Viewer.loadJson=async f=>{let j;try{j=JSON.parse(await f.text())}catch(e){}if(j&&j.app==='ininja-editor'){PRJ=j;PRJ.models=PRJ.models||{};PRJ.scripts=PRJ.scripts||{};for(const w in PRJ.wads){PRJ.wads[w].mods=PRJ.wads[w].mods||{};PRJ.wads[w].adds=PRJ.wads[w].adds||[]}if(Viewer.D.length)Viewer.refresh();Viewer.$('st').textContent='editor project loaded ('+f.name+'); load its levels to see the edits';return}return olj(f)};
const oi=Viewer.inspect;Viewer.inspect=q=>{oi(q);edUpdate()};

// Install the separate Models feature after shared project services are ready.
const modelEditor=installModelEditor({Viewer,THREE:globalThis.THREE,EC,getProject:()=>PRJ,getWad,wadOf,summary});
resetModelCaches=modelEditor.resetCaches;

// ---- self-test of the data-object copier on the loaded volume (read-only)
Viewer.$('ed_stb').onclick=async()=>{try{if(!isVol())throw'load a .vol first';const ws=Viewer.files.filter(f=>/^\d+-\d+\.LCS$/i.test(f.name)),wads=[];
  for(const f of ws){Viewer.$('ed_sum').textContent='self-test: reading '+f.name+' ('+(wads.length+1)+'/'+ws.length+')...';await new Promise(r=>setTimeout(r));const[A,B]=readWad(f.buf,f);wads.push({name:f.name,A,B})}
  Viewer.$('ed_sum').textContent='self-test: copying class data between levels...';await new Promise(r=>setTimeout(r));const r=EC.copierSelfTest(wads);console.log('copier self-test',r);
  Viewer.$('ed_sum').textContent='copier self-test ('+loadedVols().join(', ')+'): '+r.copied+' of '+r.pairs+' class pairs copied between levels; copy identical to its source '+r.copyEqualsSource+'/'+r.copied+'; same structure as the target level\'s own copy '+r.copyStructEqualsTarget+'/'+r.copied+'; patched wad well-formed '+r.valid+'/'+r.copied+'. Levels whose data differ cannot be paired: '+(r.pairs-r.copied)+'.';
  let rp=Viewer.$('ed_rep');if(!rp){showRep();rp=Viewer.$('ed_rep')}rp.textContent=Object.entries(r.errors).map(([k,n])=>n+' x '+k).concat(r.bad).join('\n');rp.style.whiteSpace='pre-wrap'}catch(x){Viewer.$('ed_sum').textContent='self-test failed: '+x;console.error(x)}};
// The Scripts-tab assembly editor owns code-edit UI and project fingerprint generation.
buildScriptWadsFp=installScriptEditor({Viewer,IA,EC,getWad,wadOf,isVol,volOf,getVolName:()=>volName,getProject:()=>PRJ}).scriptWadsFp;

// ---- copying objects: linked children (deep copy), moving an added object to another level, script info for added objects
const LKC={};
// instance table + link rows of a source wad (cached): who links to whom through which register
function srcLinks(w){if(LKC[w])return LKC[w];const g=getWad(w);if(!g)return null;const imp=fixups(g.B),h=(imp[0x8000010e]||[])[0];if(h==null)return null;const d=new DataView(g.A.buffer,g.A.byteOffset,g.A.length),U=o=>d.getUint32(o,true),
  ins=U(h+0x28),nin=d.getUint16(h+0x30,true),lnk=U(h+0x2c),nlk=d.getUint16(h+0x32,true),rows=[];for(let i=0;i<nlk;i++)rows.push([d.getUint16(lnk+4*i,true),d.getUint16(lnk+4*i+2,true)]);
  return LKC[w]={U,F:o=>d.getFloat32(o,true),ins,nin,rows,imp}}
// the instances an object links to (recursively, nearest first): [{i, par:index in the list, reg}]
function linkTree(w,i){const L=srcLinks(w);if(!L)return[{i,par:-1,reg:-1}];const out=[{i,par:-1,reg:-1}],seen=new Set([i]);
  for(let n=0;n<out.length&&out.length<24;n++){const o=L.ins+out[n].i*0x3c,ip=L.U(o+0x2c);for(const[ow,rg]of L.rows){if(ow!==out[n].i)continue;const c=L.U(ip+4*rg);if(c<L.nin&&!seen.has(c)){seen.add(c);out.push({i:c,par:n,reg:rg})}}}
  return out}
const addMaxId=()=>Math.max(0,...Object.values(PRJ.wads||{}).flatMap(P=>(P.adds||[]).map(x=>x.id||0)));
// add a prefab (and with "also copy linked objects": every object it links to, as separate objects linked to each other) to a level; returns the ordinal of the first one
function pushAdds(tw,a){const P=WS(tw),base=P.adds.length,deep=Viewer.$('ed_deep')&&Viewer.$('ed_deep').checked;if(!deep){P.adds.push(a);return base}
  const tree=linkTree(a.from.w,a.from.i);if(tree.length<2){P.adds.push(a);return base}
  const L=srcLinks(a.from.w),pos=n=>{const o=L.ins+tree[n].i*0x3c;return[L.F(o+0x10),L.F(o+0x14),L.F(o+0x18)]},root=pos(0);let id=addMaxId();const recs=tree.map((t,n)=>{const p=pos(n);return{from:{w:a.from.w,i:t.i},p:n?a.p.map((v,k)=>r3(v+p[k]-root[k])):a.p,dy:n?0:a.dy,dp:n?0:(a.dp||0),dr:n?0:(a.dr||0),regs:n?{}:{...a.regs},id:++id,lk:[]}});
  // rewire EVERY link register between the copied objects (parent->child, child->parent, sibling->sibling), not just the tree edges found while walking down;
  // otherwise a copy made inside the same level keeps pointing at the original objects through those registers
  const tIdx=new Map(tree.map((t,n)=>[t.i,n]));
  tree.forEach((t,n)=>{const ip=L.U(L.ins+t.i*0x3c+0x2c),seenR=new Set();
   for(const[ow,rg]of L.rows){if(ow!==t.i||seenR.has(rg))continue;const c=L.U(ip+4*rg),m=c<L.nin?tIdx.get(c):undefined;if(m===undefined)continue;seenR.add(rg);recs[n].lk.push([rg,recs[m].id])}});
  const skipped=[];const keep=recs.map((r,n)=>{if(!n||lvOf(r.from.w)===lvOf(tw))return true;try{const nm=srcEnt(r).n,why=ensureClass(tw,r.from.w,nm);if(why)throw nm+': '+why;const s=getWad(r.from.w),bad=EC.prefabCheck(s.A,s.B,r.from.i);if(bad)throw bad;return true}catch(x){skipped.push(String(x));return false}});
  const ids=new Set(recs.filter((r,n)=>keep[n]).map(r=>r.id));recs.forEach(r=>{r.lk=r.lk.filter(l=>ids.has(l[1]))});recs.forEach((r,n)=>{if(keep[n])P.adds.push(r)});
  Viewer.$('ed_sum').textContent='copied '+recs.filter((r,n)=>keep[n]).length+' linked object(s)'+(skipped.length?'; skipped: '+skipped.join(' | '):'');return base}
// an added object (and the copies linked to it) can be moved to another level
function relvInject(){const R=Viewer.sel&&rec(Viewer.sel);const S=Viewer.$('ed_sel');if(!R||!R.add||!S)return;
  S.insertAdjacentHTML('beforeend','<div style="margin-top:3px"><span class=h>belongs to level</span> <select id=ed_relv>'+Viewer.D.filter(l=>wadOf(l.id)).map(l=>'<option'+(l.id===Viewer.sel.L?' selected':'')+'>'+l.id+'</option>').join('')+'</select></div>');
  Viewer.$('ed_relv').onchange=ev=>{const nw=wadOf(ev.target.value),old=R.w;if(!nw||nw===old)return;const P=WS(old),a0=R.add;
   const grp=new Set([a0]);if(a0.id!==undefined){let ch=true;while(ch){ch=false;for(const x of P.adds){if(grp.has(x))continue;if([...grp].some(y=>(y.lk||[]).some(l=>l[1]===x.id))||(x.lk||[]).some(l=>[...grp].some(y=>y.id===l[1]))){grp.add(x);ch=true}}}}
   try{for(const a of grp){if(lvOf(a.from.w)!==lvOf(nw)){const nm=srcEnt(a).n,why=ensureClass(nw,a.from.w,nm);if(why)throw nm+' cannot be copied into '+nw+': '+why;const s=getWad(a.from.w),bad=EC.prefabCheck(s.A,s.B,a.from.i);if(bad)throw bad}}}catch(x){Viewer.$('ed_sum').textContent='cannot move: '+x;edUpdate();return}
   P.adds=P.adds.filter(x=>!grp.has(x));const N=WS(nw),first=N.adds.length;for(const a of grp){const keep=a.lk||[];stripLinkRegs(a);a.lk=keep.filter(l=>[...grp].some(y=>y.id===l[1]));N.adds.push(a)}
   Viewer.refresh();const L=lvOf(nw),lv=Viewer.D.find(l=>l.id===L);Viewer.sel=Viewer.all.find(o=>o.L===L&&o.i===lv.nb+first+[...grp].indexOf(a0));Viewer.inspect(Viewer.sel);edUpdate();Viewer.need=true;Viewer.$('ed_sum').textContent='moved '+grp.size+' object(s) to '+nw}}
const oeu=edUpdate;edUpdate=function(){oeu();try{relvInject()}catch(e){console.error(e)}};
// objects added from another level take their script info from the object they were copied from
const oscr=Viewer.scr;Viewer.scr=function(e){const x=oscr(e);if(x||!e.added||!Viewer.SCR)return x;const w=wadOf(e.L),a=w&&((PRJ.wads[w]||{}).adds||[])[e.added-1];if(!a)return null;const L2=lvOf(a.from.w),y=Viewer.SCR.levels[L2]&&Viewer.SCR.levels[L2][a.from.i];if(!y)return null;const c=Viewer.SCR.classes[y.k];return c?{c,r:y.r,l:y.l}:null};

})();

