// ES-module entry point for the existing editor UI.
// Parser, editor and assembler APIs are imported directly. Only the viewer's
// mutable state still uses a temporary live compatibility interface.
import {
  parseVol, wadName, readWad, r2, instances, fixups, vs, siWad, SiAn
} from './vol-core.js';
import { EC } from './editor-core.js';
import { IA } from './strat-assembler.js';
import { exposeViewerGlobals, setEntityOverlayRefresh } from './viewer.js';

// Viewer state remains module-owned; these live accessors temporarily support the
// existing UI's reads and controlled overrides without taking snapshots.
exposeViewerGlobals(window);


// ---- editor UI: edits live in a project (json); the game files are never modified, a patched copy is built on demand
(()=>{
let PRJ={app:'ininja-editor',v:1,vol:null,wads:{}},clip=null,grab=false,mouse={x:0,y:0},volName='vol',AVLS={},WC={},SP={},pfFor=null,inR=0;
const r3=x=>Math.round(x*1000)/1000,wadOf=L=>levels[L]&&levels[L].LCS?levels[L].LCS.name:null,lvOf=w=>w.replace(/\.LCS$/i,'');
const isVol=()=>files.some(f=>f.vol&&f.buf&&f.buf.byteLength>16&&new DataView(f.buf).getUint32(0,true)===0x544c4f56);
let linkPick=null,regOpen=false;
const vbase=n=>String(n||'').replace(/\.(vol|avl)$/i,'').toLowerCase(),volOf=w=>{const f=files.find(x=>x.name===w);return f&&f.vol},loadedVols=()=>[...new Set(files.filter(f=>f.vol).map(f=>f.vol))];
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
function spLoad(w){if(SP[w])return SP[w];const f=files.find(x=>x.name===w);if(!f)return null;const[A,B]=readWad(f.buf,f),ents=instances(A,B),pick={},first={};
 for(const e of ents){if(first[e.n]===undefined)first[e.n]=e.i;if(pick[e.n]===undefined&&!EC.prefabCheck(A,B,e.i))pick[e.n]=e.i}
 let rp={};try{rp=EC.classReports(A,B)}catch(e){console.error('class report failed for',w,e)}
 return SP[w]={ents,pick,first,rep:rp,cls:new Set(siWad(A,B).classes.map(c=>c.name))}}
const srcEnt=a=>{const l=D.find(x=>x.id===lvOf(a.from.w));if(l)return (l.all0||l.ents).find(e=>e.i===a.from.i&&!e.added);const s=spLoad(a.from.w);return s&&s.ents[a.from.i]};
const unzero=m=>m.d.some(x=>x)||m.dy||m.dp||m.dr||Object.keys(m.regs).length||(m.lk&&m.lk.length);
// re-derive every loaded level from the base data + project (idempotent)
function applyEdits(){for(const lv of D){const w=wadOf(lv.id);if(!w)continue;if(!lv.all0){lv.all0=lv.ents.slice();lv.nb=lv.all0.length}
  const orig=lv.all0,P=PRJ.wads[w],del=new Set(P&&P.del||[]);for(const e of orig){if(e.base)put(e,{})}
  if(P)for(const[k,m]of Object.entries(P.mods)){const e=orig[+k];if(e&&e.i==+k)put(e,m)}
  lv.ents=orig.filter(e=>!del.has(e.i));
  if(P)P.adds.forEach((a,k)=>{const s=srcEnt(a);if(!s)return;const B=base(s),e={...s,params:s.params.map(p=>({...p})),i:lv.nb+k,added:k+1,base:{...B}};
   put(e,{d:a.p.map((v,j)=>v-B.p[j]),dy:a.dy||0,dp:a.dp||0,dr:a.dr||0,regs:a.regs});lv.ents.push(e);
   const sl=SCR.levels[lvOf(a.from.w)];if(sl&&sl[s.i]&&SCR.levels[lv.id])SCR.levels[lv.id][e.i]=linkView(lv,P,sl[s.i],a,lvOf(a.from.w)===lv.id,true)});
  // moved originals: links changed by hand
  const SL=SCR.levels[lv.id];if(SL){lv.scr0=lv.scr0||{};for(const k in lv.scr0)SL[k]=lv.scr0[k];
   if(P)for(const[k,m]of Object.entries(P.mods)){const x=SL[k];if(!x||!((m.lk&&m.lk.length)||Object.keys(m.regs||{}).length))continue;if(!(k in lv.scr0))lv.scr0[k]=x;SL[k]=linkView(lv,P,x,m,true,false)}}}}
// script info of an object with its hand-made links applied: lk = to added objects (by id), regs = to originals (by number); a copied add from ANOTHER level has no valid links of its own
function linkView(lv,P,x,a,sameLevel,isAdd){const y={...x,r:(x.r||[]).slice(),l:sameLevel||!isAdd?x.l.map(q=>q.slice()):x.l.map(q=>[q[0],-1])},set=(rg,v)=>{const q=y.l.find(z=>z[0]==rg);if(q)q[1]=v;else y.l.push([rg,v]);y.r[rg]=v};
 for(const[rg,v]of Object.entries(a.regs||{}))if(x.l.some(q=>q[0]==rg))set(+rg,v>>>0);
 for(const[rg,cid]of(a.lk||[])){const n=P.adds.findIndex(z=>z.id===cid);if(n>=0)set(+rg,lv.nb+n)}
 return y}
const orf=refresh;refresh=()=>{if(!inR){inR=1;try{applyEdits()}finally{inR=0}}orf();edUpdate()};
const ent=q=>{const lv=D.find(l=>l.id===q.L);return lv&&lv.ents.find(e=>e.i===q.i)};
// the editable record of an entity: a mod (moved original) or an add (new instance)
function rec(q){const e=ent(q),w=wadOf(q.L);if(!e||!w)return null;const P=WS(w);
 if(e.added)return{e,w,add:P.adds[e.added-1]};const m=P.mods[e.i]||(P.mods[e.i]={d:[0,0,0],dy:0,dp:0,dr:0,regs:{}});return{e,w,m}}
function redo(R){if(R.add){const s=srcEnt(R.add),B=base(s);put(R.e,{d:R.add.p.map((v,j)=>v-B.p[j]),dy:R.add.dy||0,dp:R.add.dp||0,dr:R.add.dr||0,regs:R.add.regs})}else{put(R.e,R.m);if(!unzero(R.m))delete PRJ.wads[R.w].mods[R.e.i]}
 const q=all.find(o=>o.L===sel.L&&o.i===R.e.i);Object.assign(q,{p:R.e.p,b:R.e.b,poly:R.e.poly,path:R.e.path,r:R.e.r,q:R.e.q,params:R.e.params});sel=q;buildEnts();need=true;edUpdate()}
function setPos(R,p){if(R.add)R.add.p=p.map(r3);else R.m.d=p.map((v,k)=>r3(v-base(R.e).p[k]));redo(R)}
function setYaw(R,deg){const dy=r3((deg/360*4096)-(R.add?base(srcEnt(R.add)).r:base(R.e).r));if(R.add)R.add.dy=dy;else R.m.dy=dy;redo(R)}
function setTilt(R,key,deg){const v=r3(deg/360*4096);if(R.add)R.add[key]=v;else R.m[key]=v;redo(R)}
function setReg(R,k,v){(R.add||R.m).regs[k]=v>>>0;redo(R)}
const nudge=(dx,dy,dz,dyaw)=>{if(!sel)return;const R=rec(sel);if(!R)return;const p=R.e.p;setPos(R,[p[0]+dx,p[1]+dy,p[2]+dz]);if(dyaw)setYaw(R,(R.e.r/4096*360+dyaw+360)%360)};
// ---- panel
const ui=document.createElement('div');ui.id='ed';
ui.innerHTML='<hr><b>Editor</b> <span class=h>edits go in a project file; game files are never touched</span><details style="margin:3px 0"><summary class=h>current scope</summary><div class=h><b>Rotation:</b> yaw, pitch and roll are editable. Yaw turns about world up; pitch (local X) and roll (local Z) are applied on top of the original orientation and shown as changes from it.<br><b>No LCM edits:</b> only .LCS strat data can be edited. The project format is per-wad, so LCM edits can slot in later.</div></details><div style="margin:3px 0"><button id=ed_open>open project</button> <button id=ed_save>save project</button> <button id=ed_patch>build patched .vol</button> <button id=ed_md>models</button> <button id=ed_stb>copier self-test</button></div><input type=file id=ed_pf style=display:none accept=.json><div id=ed_sum class=h></div><div id=ed_rm class=h></div><div id=ed_sel class=h>click an entity to edit it</div>'
 +'<div style="margin-top:4px"><span class=h>add prefab to</span> <select id=ed_lv style="max-width:90px"></select> <select id=ed_cl style="max-width:170px"></select> <button id=ed_add>add</button><br><label class=h title="A spawner links to the objects it spawns. Tick this to copy those objects too, as separate objects that link to each other, so the copy spawns its own set."><input type=checkbox id=ed_deep> also copy the objects it links to</label></div>';
$('ctl').insertBefore(ui,$('ctl').firstChild);
$('ed_open').onclick=()=>$('ed_pf').click();
$('ed_pf').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{const j=JSON.parse(await f.text());if(j.app!=='ininja-editor')throw'not an editor project';PRJ=j;PRJ.models=PRJ.models||{};PRJ.scripts=PRJ.scripts||{};for(const w in PRJ.wads){PRJ.wads[w].mods=PRJ.wads[w].mods||{};PRJ.wads[w].adds=PRJ.wads[w].adds||[]}refresh();$('ed_sum').textContent='project loaded: '+f.name+' (apply to levels you load later by loading them again)'}catch(x){$('ed_sum').textContent='open failed: '+x}e.target.value=''};
const getWad=w=>{if(WC[w])return WC[w];const f=files.find(x=>x.name===w);if(!f)return null;const[A,B]=readWad(f.buf,f);return WC[w]={A,B,cls:new Set(siWad(A,B).classes.map(c=>c.name))}};
function summary(){let m=0,a=0,n=0,r=0;for(const w in PRJ.wads){const x=Object.values(PRJ.wads[w].mods).filter(unzero).length,y=PRJ.wads[w].adds.length,z=(PRJ.wads[w].del||[]).length;m+=x;a+=y;r+=z;if(x||y||z)n++}$('ed_sum').textContent=m+' moved/edited, '+a+' added, '+r+' removed in '+n+' level(s)'+(Object.keys(PRJ.vols||{}).length>1?' ['+Object.keys(PRJ.vols).join(', ')+']':'')}
function rmList(){const out=[];for(const lv of D){const w=wadOf(lv.id),P=w&&PRJ.wads[w];if(!P||!lv.all0)continue;for(const i of P.del||[])if(lv.all0[i])out.push([w,i,lv.all0[i].n,lv.id])}
 $('ed_rm').innerHTML=out.length?'removed: '+out.slice(0,12).map(([w,i,n,L])=>L+'#'+i+' '+esc(n)+' <a href=# data-w="'+w+'" data-i='+i+'>restore</a>').join(' &middot; ')+(out.length>12?' &hellip;':''):'';
 $('ed_rm').querySelectorAll('a').forEach(a=>a.onclick=e=>{e.preventDefault();const P=PRJ.wads[a.dataset.w];P.del=P.del.filter(x=>x!=+a.dataset.i);refresh()})}
function edUpdate(){summary();rmList();const S=$('ed_sel'),R=sel&&rec(sel),SI=sel&&scr(sel);
 const lv=$('ed_lv'),cur=lv.value;lv.innerHTML=D.filter(l=>wadOf(l.id)).map(l=>'<option>'+l.id+'</option>').join('');if(cur)lv.value=cur;else if(sel&&wadOf(sel.L))lv.value=sel.L;
 if(!R){S.innerHTML='<span class=h>click an entity to edit it</span>';return}
 const e=R.e,f=(id,v,st)=>'<input type=number id='+id+' value="'+v+'" step='+st+' style="width:62px">';
 S.innerHTML='<b style="color:'+col(e.n)+'">'+esc(e.n)+'</b> <span class=h>'+sel.L+' #'+e.i+(e.added?' (new, copy of #'+R.add.from.i+')':'')+'</span><br>X '+f('ed_x',e.p[0],.5)+' Y '+f('ed_y',e.p[1],.5)+' Z '+f('ed_z',e.p[2],.5)+'<br>yaw '+f('ed_w',+(e.r/4096*360).toFixed(1),5)+'&deg;<br>pitch '+f('ed_pt',+(((R.add||R.m).dp||0)/4096*360).toFixed(1),5)+'&deg; roll '+f('ed_rl',+(((R.add||R.m).dr||0)/4096*360).toFixed(1),5)+'&deg; <span class=h>(change from original)</span><br>step <input type=number id=ed_st value='+(S.dataset.st||1)+' style="width:48px"><br>'
  +['-X','+X','-Y','+Y','-Z','+Z'].map(t=>'<button data-n="'+t+'">'+t+'</button>').join('')+' <button data-n="L">&#8634;15</button><button data-n="R">&#8635;15</button><br><button id=ed_cp>copy</button> <button id=ed_ps>paste</button> '+'<button id=ed_del>'+(e.added?'delete':'remove')+'</button>'
  +'<div class=h>hold G + move mouse to drag on the ground plane; Ctrl+C / Ctrl+V copy and paste at the cursor</div>'
  +(e.params.some(p=>!p.s)?'<details'+(regOpen||linkPick?' open':'')+'><summary>registers</summary>'+e.params.map((p,k)=>{const lq=!p.s&&SI&&SI.l.find(a=>a[0]==k);if(lq){const H=R.add||R.m,ov=(H.lk||[]).some(l=>l[0]==k)||H.regs[k]!==undefined,on=linkPick&&linkPick.L===sel.L&&linkPick.i===e.i&&linkPick.k==k;return '<div>r'+k+' <span class=h>'+esc(regTxt(sel,SI,k))+'</span> <button data-lk='+k+(on?' style="background:#fa0"':'')+'>'+(on?'click target...':'link...')+'</button>'+(ov?' <button data-lkr='+k+' title="back to what the copied/original object had">reset</button>':'')+'</div>'}
   return '<div>r'+k+' '+(p.s?'<span class=h>"'+esc(p.s)+'"</span>':'<input type=number id=ed_r'+k+' data-k='+k+' value='+(p.v>>>0)+' style="width:100px">')+'</div>'}).join('')+'<div class=h>raw 32-bit values (floats are stored as their bit pattern). A register that links to another object has a link... button: press it, then click the object to link to (same level; Esc cancels).</div></details>':'');
 const g=id=>+$(id).value;for(const id of['ed_x','ed_y','ed_z'])$(id).onchange=()=>setPos(R,[g('ed_x'),g('ed_y'),g('ed_z')]);
 $('ed_w').onchange=()=>setYaw(R,g('ed_w'));$('ed_pt').onchange=()=>setTilt(R,'dp',g('ed_pt'));$('ed_rl').onchange=()=>setTilt(R,'dr',g('ed_rl'));$('ed_st').onchange=()=>{S.dataset.st=g('ed_st')};
 S.querySelectorAll('button[data-n]').forEach(b=>b.onclick=()=>{const s=+$('ed_st').value||1,t=b.dataset.n,ax={X:0,Y:1,Z:2}[t[1]],v=[0,0,0];if(t=='L')return nudge(0,0,0,-15);if(t=='R')return nudge(0,0,0,15);v[ax]=t[0]=='-'?-s:s;nudge(...v,0)});
 S.querySelectorAll('input[data-k]').forEach(i=>i.onchange=()=>setReg(R,+i.dataset.k,+i.value));
 S.querySelectorAll('button[data-lk]').forEach(b=>b.onclick=()=>startLink(+b.dataset.lk));
 S.querySelectorAll('button[data-lkr]').forEach(b=>b.onclick=()=>resetLink(R,+b.dataset.lkr));
 const dt=S.querySelector('details');if(dt)dt.ontoggle=()=>{regOpen=dt.open};
 $('ed_cp').onclick=copy;$('ed_ps').onclick=()=>paste();const dl=$('ed_del');if(dl)dl.onclick=()=>{const P=WS(R.w);if(R.e.added){const rid=R.add&&R.add.id;P.adds.splice(R.e.added-1,1);if(rid!==undefined)for(const x of[...P.adds,...Object.values(P.mods)])if(x.lk)x.lk=x.lk.filter(l=>l[1]!==rid)}else{const g=getWad(R.w),rf=g?EC.referrers(g.A,g.B,R.e.i).filter(o=>!P.del.includes(o)):[];
   if(rf.length){$('ed_sum').textContent='cannot remove #'+R.e.i+': '+rf.map(o=>'#'+o).join(', ')+' link to it. Remove or change those first.';return}P.del.push(R.e.i);delete P.mods[R.e.i]}sel=null;inspect(null);refresh()}}
// ---- manual link reassignment: press "link..." next to a link register, then click the object it should point at
function startLink(k){const R=sel&&rec(sel);if(!R)return;linkPick={L:sel.L,i:R.e.i,k};cv.style.cursor='crosshair';edUpdate();$('ed_sum').textContent='r'+k+' of '+R.e.n+' #'+R.e.i+': click the object to link to (same level, Esc cancels)'}
function endPick(msg){linkPick=null;cv.style.cursor='';edUpdate();if(msg)$('ed_sum').textContent=msg}
function finishLink(q){const lp=linkPick;if(!lp)return;if(q.L!==lp.L){$('ed_sum').textContent='the target has to be in the same level ('+lp.L+'): click again, or Esc to cancel';return}
 const src=all.find(o=>o.L===lp.L&&o.i===lp.i),R=src&&rec(src);if(!R){endPick();return}
 const H=R.add||R.m,te=ent(q);H.lk=(H.lk||[]).filter(l=>l[0]!==lp.k);
 if(te&&te.added){const T=WS(wadOf(q.L)).adds[te.added-1];if(T.id===undefined)T.id=addMaxId()+1;H.lk.push([lp.k,T.id]);delete H.regs[lp.k]}else H.regs[lp.k]=q.i>>>0;
 const nm=q.n;linkPick=null;cv.style.cursor='';afterLink(lp.L,R.e.i);$('ed_sum').textContent='r'+lp.k+' of '+R.e.n+' #'+R.e.i+' now links to #'+q.i+' '+nm}
function resetLink(R,k){const H=R.add||R.m;H.lk=(H.lk||[]).filter(l=>l[0]!==k);delete H.regs[k];afterLink(sel.L,R.e.i)}
// link registers of an added object that were set by hand mean instance numbers of ONE level: drop them when the object goes to another level
function stripLinkRegs(a){const L=srcLinks(a.from.w);if(L)for(const[ow,rg]of L.rows)if(ow===a.from.i)delete a.regs[rg];a.lk=[]}
function afterLink(L,i){refresh();sel=all.find(o=>o.L===L&&o.i===i)||null;inspect(sel);edUpdate();need=true}
const omu=onmouseup;onmouseup=e=>{if(linkPick&&mdown&&mdown.b==0&&Math.hypot(e.clientX-mdown.x,e.clientY-mdown.y)<4&&e.target===cv){const q=nearest(e.clientX,e.clientY);mdown=null;drag=null;if(q)finishLink(q);return}omu(e)};
addEventListener('keydown',e=>{if(e.code==='Escape'&&linkPick)endPick('link pick cancelled')});
function copy(){if(!sel)return;const R=rec(sel);if(!R)return;const H=R.add||R.m;clip=R.add?{from:{...R.add.from},dy:R.add.dy||0,dp:R.add.dp||0,dr:R.add.dr||0,regs:{...R.add.regs}}:{from:{w:R.w,i:R.e.i},dy:R.m.dy||0,dp:R.m.dp||0,dr:R.m.dr||0,regs:{...R.m.regs}};clip.lk=(H.lk||[]).map(l=>l.slice());clip.at=R.w;$('ed_sum').textContent='copied '+R.e.n}
function ground(mx,my,y){const v=new V3(mx/innerWidth*2-1,-(my/innerHeight)*2+1,.5).unproject(camera).sub(camera.position).normalize();if(Math.abs(v.y)<1e-3)return null;const t=(y-camera.position.y)/v.y;if(t<0||t>5000)return null;return ggame(camera.position.clone().addScaledVector(v,t))}
function paste(at){if(!clip||!sel)return;const w=wadOf(sel.L);let p=at||(()=>{const sp=sel.p,g=ground(mouse.x,mouse.y,sel.p[1]);return g||[sp[0]+3,sp[1],sp[2]+3]})();
const a={from:{...clip.from},p:p.map(r3),dy:clip.dy,dp:clip.dp||0,dr:clip.dr||0,regs:{...clip.regs}};if(clip.at===w&&clip.lk&&clip.lk.length)a.lk=clip.lk.map(l=>l.slice());else stripLinkRegs(a);
 // paste into the selected entity's level (clones from another level need a compatible class there)
 try{const t=getWad(w),s=getWad(clip.from.w);if(lvOf(clip.from.w)!==lvOf(w)){const n=srcEnt(a).n;const why=ensureClass(w,clip.from.w,n);if(why)throw n+' cannot be copied into '+w+': '+why;const bad=EC.prefabCheck(s.A,s.B,a.from.i);if(bad)throw bad}}catch(x){$('ed_sum').textContent='cannot paste: '+x;return}
 const pi=pushAdds(w,a);refresh();const L=lvOf(w),lv=D.find(l=>l.id===L);sel=all.find(o=>o.L===L&&o.i===lv.nb+pi);inspect(sel);edUpdate();need=true}
addEventListener('keydown',e=>{const t=e.target.tagName;if(t==='INPUT'||t==='SELECT')return;if(e.code==='KeyG')grab=true;if((e.ctrlKey||e.metaKey)&&e.code==='KeyC'){copy();e.preventDefault()}if((e.ctrlKey||e.metaKey)&&e.code==='KeyV'){paste();e.preventDefault()}});
addEventListener('keyup',e=>{if(e.code==='KeyG')grab=false});
cv.addEventListener('mousemove',e=>{mouse={x:e.clientX,y:e.clientY};if(grab&&sel&&!drag){const R=rec(sel),g=R&&ground(e.clientX,e.clientY,sel.p[1]);if(g)setPos(R,[g[0],sel.p[1],g[2]])}});
// ---- prefabs: one source instance per class, taken from the loaded levels (the class must exist in the target level)
const PFI={},SCx={},PFR={};
const srcCtx=w=>SCx[w]||(SCx[w]=(()=>{const g=getWad(w);return EC.SrcCtx(g.A,g.B)})());
const srcCls=a=>{const e=srcEnt(a);return e&&e.n};
// can the class be copied into the target level? (dry run of the real transplant; nothing is kept)
// sounds: the audio of a level lives in the .PCA inside NN.avl, so copying sounds needs that .avl loaded next to the .vol
// sounds of the target level go into ITS volume's .avl; every sound source level needs its own volume's .avl as well
const sndPlan=w=>{if(!avlOk(volOf(w)))return undefined;const f=files.find(x=>x.name===w);if(!f)return undefined;const dv=new DataView(f.buf,f.off),p=EC.SoundPlan(dv.getUint32(0x78,true),dv.getUint32(0x7c,true)),add=p.add;p.add=r=>{const sv=volOf(r.w);if(!avlOk(sv))throw'its sounds come from '+r.w+' and need '+vbase(sv)+'.avl loaded';return add(r)};return p};
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
async function fillPrefabs(force){const T=$('ed_lv').value,tw=wadOf(T),cl=$('ed_cl');if(!tw){cl.innerHTML='';pfFor=null;return}if(pfFor===T&&!force&&cl.options.length)return;pfFor=T;
 const ws=[tw,...files.map(f=>f.name).filter(n=>/^\d+-\d+\.LCS$/i.test(n)&&n!==tw).sort((a,b)=>a.localeCompare(b,0,{numeric:true}))];let h='',k=0;const na={};
 for(const w of ws){if(!SP[w]){$('ed_sum').textContent='reading prefabs from '+w+' ('+ ++k+'/'+ws.length+')...';await new Promise(r=>setTimeout(r))}
  const s=spLoad(w),t=SP[tw];if(!s)continue;const own=w===tw,src=own?s.first:s.pick,names=Object.keys(src).filter(n=>t.cls.has(n)).sort();
  if(!own)for(const n of Object.keys(s.first))if(!t.cls.has(n)&&!na[n])na[n]={w,i:s.first[n],s};
  if(names.length)h+='<optgroup label="'+lvOf(w)+(own?' (this level)':'')+'">'+names.map(n=>{const v=w+'|'+src[n];PFI[v]=repText(s,n,t.cls,w);return'<option value="'+v+'">'+n+' (#'+src[n]+')</option>'}).join('')+'</optgroup>'}
 const nn=Object.keys(na).sort(),t=SP[tw];
 if(nn.length)h+='<optgroup label="class missing in this level (cannot place)">'+nn.map(n=>{const v='!'+na[n].w+'|'+na[n].i,ok=!why(na[n].s,n,t.cls).length;PFI[v]=repText(na[n].s,n,t.cls,na[n].w);return'<option value="'+v+'">'+n+' ('+lvOf(na[n].w)+')'+(ok?(((na[n].s.rep[n]||{kinds:{}}).kinds.sound||0)&&!(avlOk(volOf(tw))&&avlOk(volOf(na[n].w)))?' - copyable (load the .avl for its sounds)':' - copyable'):' - not copyable')+'</option>'}).join('')+'</optgroup>'
 if(pfFor===T){cl.innerHTML=h;showRep()}summary()}
function showRep(){let r=$('ed_rep');if(!r){r=document.createElement('div');r.id='ed_rep';r.className='h';r.style.cssText='margin-top:3px;max-height:110px;overflow:auto';$('ed_cl').parentNode.after(r)}const v=$('ed_cl').value;let t=PFI[v]||'';
 if(v&&v[0]==='!'){const[w,i]=v.slice(1).split('|'),name=$('ed_cl').selectedOptions[0].textContent.split(' (')[0],tw=wadOf($('ed_lv').value);if(tw){const x=tryClass(tw,w,name);t+=x.ok?'\nCheck: can be copied into '+lvOf(tw)+' ('+x.classes.join(', ')+' ; +'+x.bytes+' bytes). Press add to place one.':'\nCheck: cannot be copied: '+x.why+'.'}}
 r.style.whiteSpace='pre-wrap';r.textContent=t}
$('ed_lv').onfocus=$('ed_cl').onfocus=()=>fillPrefabs();$('ed_lv').onchange=()=>fillPrefabs();$('ed_cl').onchange=showRep;
$('ed_add').onclick=()=>{const T=$('ed_lv').value,v=$('ed_cl').value;if(!T||!v)return;const miss=v[0]==='!',[w,i]=(miss?v.slice(1):v).split('|'),tw=wadOf(T);if(miss){const name=$('ed_cl').selectedOptions[0].textContent.split(' (')[0],why=ensureClass(tw,w,name);if(why){showRep();$('ed_sum').textContent='cannot add '+name+': '+why;return}}const p=ground(innerWidth/2,innerHeight/2,sel?sel.p[1]:0)||ggame(camera.position.clone().addScaledVector(fwd(),25));
 const pi=pushAdds(tw,{from:{w,i:+i},p:p.map(r3),dy:0,regs:{}});refresh();const lv=D.find(l=>l.id===T);sel=all.find(o=>o.L===T&&o.i===lv.nb+pi);inspect(sel);edUpdate();need=true};
// ---- project save / patch
const dl=(parts,name,type)=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(parts,{type}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),60000)};
function clean(){const o={};for(const w in PRJ.wads){const P=PRJ.wads[w],mods={};for(const k in P.mods)if(unzero(P.mods[k]))mods[k]=P.mods[k];const del=[...new Set(P.del||[])].sort((a,b)=>a-b),classes=(P.classes||[]).filter(k=>P.adds.some(a=>a.from.w===k.from.w&&(srcCls(a)===k.from.name)));if(Object.keys(mods).length||P.adds.length||del.length)o[w]={vol:volOf(w)||P.vol,mods,adds:P.adds,del,classes,fp:P.fp}}return o}
// wads that belong to other volumes keep their stored fingerprint; only wads in the loaded volume are checked
function withFp(){const c=clean();for(const w in c){const g=getWad(w);if(!g)continue;const old=PRJ.wads[w].fp,fp={A:EC.fnv(g.A),B:EC.fnv(g.B)};if(old&&(old.A!==fp.A||old.B!==fp.B))throw w+' does not match the base this project was made for';c[w].fp=fp;c[w].vol=volOf(w)||volName;PRJ.wads[w].fp=fp;PRJ.wads[w].vol=volOf(w)||volName}return c}
const pending=c=>[...new Set(Object.keys(c).filter(w=>!getWad(w)).map(w=>c[w].vol||w.split('-')[0]+'.vol'))];
$('ed_save').onclick=()=>{try{if(!isVol())throw'load a .vol first';const wads=withFp();{const vv={...PRJ.vols};for(const f of files)if(f.vol)vv[f.vol]=f.buf.byteLength;PRJ.vols=vv}const scr=scriptWadsFp();dl([JSON.stringify({app:'ininja-editor',v:1,vols:PRJ.vols,models:PRJ.models||{},wads,scripts:scr},null,1)],'ininja-project.json','application/json');$('ed_sum').textContent='project saved: '+Object.keys(wads).length+' level(s) with instance edits, '+Object.keys(scr).length+' with code edits (holds only your edits, no game data)'}catch(x){$('ed_sum').textContent='save failed: '+x}};
$('ed_patch').onclick=async()=>{try{if(!isVol())throw'load the original .vol first';const wads=withFp(),sc=scriptWadsFp(),names=[...new Set([...Object.keys(wads),...Object.keys(sc)])].filter(w=>getWad(w)),pend=[...new Set([...pending(wads),...Object.keys(sc).filter(w=>!getWad(w)).map(w=>sc[w].vol||w.split('-')[0]+'.vol')])];if(!names.length)throw'the project has no edits for '+loadedVols().join(', ')+(pend.length?' (it has edits for '+pend.join(', ')+': load that volume and build again)':'');
  const byVol={};for(const w of names)(byVol[volOf(w)]=byVol[volOf(w)]||[]).push(w);
  const srcWad=n=>getWad(n),healed=[],outs=[];let i=0;
  for(const V of Object.keys(byVol)){const rep={},plans={};
   for(const w of byVol[V]){$('ed_sum').textContent='patching '+w+' ('+ ++i+'/'+names.length+')...';await new Promise(r=>setTimeout(r));
   const f=files.find(x=>x.name===w),hdr=new Uint8Array(f.buf,f.off,new DataView(f.buf,f.off).getUint32(4,true)+16).slice(),g=getWad(w);let A=g.A,B=g.B;if(sc[w]){const bl=new Map(Object.entries(sc[w].blocks).map(([k,v])=>[+k,v])),x=IA.relink(A,B,bl),v=IA.verify(IA.wadCtx(A,B),x.A,x.B,x.info.relocs,new Set(bl.keys()));if(v.bad.length)throw w+': code edit verification failed: '+v.bad.slice(0,3).join('; ');A=x.A;B=x.B}const sp=sndPlan(w),r0=wads[w]?EC.patchLcs(A,B,wads[w],w,srcWad,{snd:sp}):{A,B},r=EC.healResDir(r0.A,r0.B);if(r.added.tex||r.added.mesh)healed.push(w+' (+'+r.added.tex+' tex, +'+r.added.mesh+' mesh)');if(sp&&sp.adds.length){const dh=new DataView(hdr.buffer,hdr.byteOffset);dh.setUint32(0x78,sp.h78,true);dh.setUint32(0x7c,sp.h7c,true);plans[w]=sp}rep[w]=EC.packWad(hdr,r.A,r.B)}
   // copied sounds: rebuild the affected levels' .PCA (resident block + streamed block) and lay this volume's .avl out again
   let ap=null,avlOut='';if(Object.keys(plans).length){const need=new Set([V]);for(const w in plans)for(const a of plans[w].adds)need.add(volOf(a.w));for(const v of need)await avlLoad(v);
    const pn=n=>n.replace(/\.LCS$/i,'.PCA'),pcaOf=n=>{const a=AVLS[vbase(volOf(n))],e=a&&a.list&&a.list.find(x=>x.name===pn(n));if(!e)throw'no '+pn(n)+' in '+(a?a.name:vbase(volOf(n))+'.avl');return new Uint8Array(a.buf,e.off,e.size)},rep2={};
    for(const w in plans)rep2[pn(w)]=EC.buildPca(pcaOf(w),plans[w],sw=>{const sf=files.find(x=>x.name===sw);return sf?{pca:pcaOf(sw),h78:new DataView(sf.buf,sf.off).getUint32(0x78,true)}:null});
    const A=AVLS[vbase(V)];ap=EC.rebuildVol(A.buf,rep2);avlOut=A.name.replace(/\.avl$/i,'')+'.patched.avl'}
   const vf=files.find(x=>x.vol===V);outs.push({V,parts:EC.rebuildVol(vf.buf,rep),out:V.replace(/\.vol$/i,'')+'.patched.vol',ap,avlOut,A:ap&&AVLS[vbase(V)].name,n:byVol[V]})}
  // one download per file, spaced out so the browser does not drop them
  let k=0;for(const o of outs){setTimeout(()=>dl(o.parts,o.out,'application/octet-stream'),600*k++);if(o.ap)setTimeout(()=>dl(o.ap,o.avlOut,'application/octet-stream'),600*k++)}
  $('ed_sum').textContent='built '+outs.map(o=>o.out+(o.ap?' + '+o.avlOut:'')).join(', ')+' ('+names.join(', ')+'). Back up your originals, then replace each with its patched file (rename it to the original name).'+(outs.some(o=>o.ap)?' Sounds were copied, so a patched .avl was built for '+outs.filter(o=>o.ap).map(o=>o.V).join(', ')+': install it together with its .vol.':'')+(healed.length?' Added missing entries to the level resource directory: '+healed.join(', ')+'.':'')+(pend.length?' Still to build: '+pend.join(', ')+' (load it, open the same project, build).':'')}catch(x){$('ed_sum').textContent='patch failed: '+x;console.error(x)}};
// remember the volume's file name; accept project .json through the normal file picker / drop
const oof=openFiles;openFiles=async fs=>{fs=[...fs];
 // .avl files are paired with the .vol of the same name (10.avl <-> 10.vol); they are only read when a build needs them
 const avls=fs.filter(f=>/\.avl$/i.test(f.name));for(const a of avls)AVLS[vbase(a.name)]={file:a,name:a.name,buf:null,list:null};if(avls.length)for(const k in PFR)delete PFR[k];
 fs=fs.filter(f=>!avls.includes(f));
 const vs=fs.filter(f=>/\.vol$/i.test(f.name));
 if(vs.length){WC={};SP={};pfFor=null;MC={};GC={};for(const k in PFR)delete PFR[k];const vols=[];
  for(const v of vs){$('st').textContent='reading '+v.name+' ('+(vols.length+1)+'/'+vs.length+')...';await new Promise(r=>setTimeout(r));vols.push({name:v.name,ab:await v.arrayBuffer()})}
  const dup=addVolumes(vols);volName=vs[vs.length-1].name;fs=fs.filter(f=>!vs.includes(f)&&!/\.(lcs|lcm|xbm|xbs)$/i.test(f.name));
  if(dup.length)$('st').textContent+='\nskipped duplicate file names (already in another volume): '+dup.slice(0,6).join(', ')+(dup.length>6?', ...':'')}
 if(vs.length||avls.length){const t=$('ed_sum');if(t){const L=loadedVols();t.textContent='volumes: '+(L.map(v=>v+' ('+(avlOk(v)?vbase(v)+'.avl found':'no '+vbase(v)+'.avl: sounds of its levels cannot be copied')+')').join(', ')||'none')+(avls.some(a=>!L.some(v=>vbase(v)===vbase(a.name)))?'. Waiting for the .vol that goes with '+avls.filter(a=>!L.some(v=>vbase(v)===vbase(a.name))).map(a=>a.name).join(', '):'')}}
 return fs.length?oof(fs):undefined};
const olj=loadJson;loadJson=async f=>{let j;try{j=JSON.parse(await f.text())}catch(e){}if(j&&j.app==='ininja-editor'){PRJ=j;PRJ.models=PRJ.models||{};PRJ.scripts=PRJ.scripts||{};for(const w in PRJ.wads){PRJ.wads[w].mods=PRJ.wads[w].mods||{};PRJ.wads[w].adds=PRJ.wads[w].adds||[]}if(D.length)refresh();$('st').textContent='editor project loaded ('+f.name+'); load its levels to see the edits';return}return olj(f)};
const oi=inspect;inspect=q=>{oi(q);edUpdate()};

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
function groundY(p,cs){if(!cs.length)return null;const k=cs.length+'|'+p.join(',');if(k in SNAPY)return SNAPY[k];root.updateMatrixWorld(true);const RC=new THREE.Raycaster();RC.set(root.localToWorld(new V3(p[0],p[1]+1,p[2])),new V3(0,-1,0));RC.far=1001;const h=RC.intersectObjects(cs,false);return SNAPY[k]=h.length?root.worldToLocal(h[0].point.clone()).y:null}

function drawModels(){if(!mgrp)mgrp=new THREE.Group();if(mgrp.parent!==root)root.add(mgrp);for(const c of[...mgrp.children])mgrp.remove(c);mgrp.scale.z=1;/* root already mirrors Z (root.scale.z=mz); mirroring mgrp again put overlays at +z */const sh=$('md_show');mgrp.visible=!sh||sh.checked;
 const MS=PRJ.models||{},au=$('md_auto'),useAuto=!au||au.checked,sn=$('md_snap'),useSnap=!sn||sn.checked;let csn=null;for(const q of all){const w0=wadOf(q.L),M=MS[w0]||{};
  // an object added from another level still points into its SOURCE level's data (until the patched .vol is built), so its model is looked up there
  const ad=q.added&&w0&&((PRJ.wads[w0]||{}).adds||[])[q.added-1],ws=ad&&ad.from.w,xl=!!ws&&ws!==w0,Ms=xl?(MS[ws]||{}):M;
  let a=M['i:'+q.i]||(ad&&Ms['i:'+ad.from.i])||M['c:'+q.n]||(xl&&Ms['c:'+q.n]);if(!a&&useAuto&&w0){const aw=xl?ws:w0,ag=autoModel(q,aw);if(ag)a={w:aw,groupId:ag.id,auto:true}}if(!a)continue;
  // New projects store an explicit part list; older group/single-part assignments remain supported.
  const AL=modelsOf(a.w),AG=a.groupId&&AL.modelGroupById?.get(a.groupId),list=Array.isArray(a.parts)?a.parts.map(x=>geoOf(a.w,x.m,x.p)):AG?(AG.parts||[]).map(x=>geoOf(a.w,x.m,x.p)):a.g!==undefined?(typeof a.g==='string'?AL.filter(x=>x.modelGroup===a.g):AL.filter(x=>x.gid===a.g||x.legacyGid===a.g)).map(x=>geoOf(a.w,x.off,x.poff)):[geoOf(a.w,a.m,a.p)];
  const extra=(a.more||[]).flatMap(mm=>(mm.parts||[]).map(x=>geoOf(a.w,x.m,x.p)));let py=q.p[1];
  if(useSnap){const si=snapInfo(xl?ws:w0,q.n);if(snapOk(si,q)){csn=csn||(()=>{const r=[];root.traverse(o=>{if(o.isMesh&&o.userData.kind==='coll')r.push(o)});return r})();const gy=groundY(q.p,csn);if(gy!==null)py=gy+si.off}}
  for(const G of [...list,...extra]){if(!G)continue;const o=new THREE.Mesh(G.g,G.mat);o.position.set(q.p[0],py,q.p[2]);if(q.q){o.quaternion.set(q.q[0],q.q[1],q.q[2],q.q[3]);if(a.ry)o.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new V3(0,1,0),a.ry*Math.PI/180))}mgrp.add(o)}}need=true}
// Keep model overlays in sync whenever the viewer rebuilds entity visuals. This is
// especially important for a copied instance whose model assignment comes from a
// different source level; the copy should appear immediately without reloading a VOL.
setEntityOverlayRefresh(drawModels);
const mp=document.createElement('div');mp.id='md';mp.style.cssText='position:fixed;right:10px;bottom:10px;width:380px;max-height:92vh;overflow:auto;background:#1b1e24f2;border:1px solid #444;padding:6px;display:none;z-index:20;font-size:12px';
mp.innerHTML='<b>Models</b> <span class=h>mesh parts from a level wad</span> <button id=md_x style=float:right>x</button><br><select id=md_w style="width:100%"></select><input id=md_q type=search placeholder="Filter by part #, name, texture size…" style="box-sizing:border-box;width:100%;margin:4px 0"><select id=md_l size=8 multiple style="width:100%" title="Ctrl/Cmd-click to select multiple parts"></select><div style="display:flex;gap:4px;margin:4px 0"><select id=md_groups style="flex:1;min-width:0" title="Choose any model record, including alternate and unverified evidence groups"><option value="">Choose model record…</option></select><button id=md_usegroup title="Select the exact parts in the chosen model record">preview record</button></div><div class=h>Robot Beach Hub includes your confirmed ranges. Group labels show descriptor addresses and exact part numbers. Grouping sources are now consolidated into one registry; shared/alternate memberships are retained rather than merged or discarded. #51 is a separate &quot;roy foot door&quot; descriptor from the confirmed Kyza door #90; it uses the same texture atlas and is marked as a likely alternate door, not confirmed. Ctrl/Cmd-click to assemble parts.</div><canvas id=md_c width=340 height=240 style="width:340px;height:240px;background:#0d0f12"></canvas><div id=md_i class=h></div><label id=md_rawwrap style=display:none><input type=checkbox id=md_raw> show extracted raw mesh instead of expected debug cube</label><div>extra yaw&deg; <input id=md_r type=number value=0 step=90 style="width:55px"> <button id=md_a title="Save a 3D-view overlay assignment in the editor project">overlay on selected</button> <button id=md_k title="Save a 3D-view overlay assignment for this class">overlay on class</button> <button id=md_n>clear</button></div><div><button id=md_g title="Select the named PC model, collision, attachment or unverified linked group">select model group</button> <button id=md_s>clear part selection</button> <label><input type=checkbox id=md_whole checked> expand one selected part to linked group</label></div><label><input type=checkbox id=md_show checked> draw assigned overlays in the 3D view</label><label title=\"Instances with no manual assignment: follow init-register model pointers (e.g. SwingingObject r0) to a model descriptor\"><input type=checkbox id=md_auto checked> auto-draw models from instance registers (fallback)</label><label title=\"Only classes whose spawn-time script calls Strat_ProbeGround and copies the ground height into PosY are moved; guarded by their init register when the script does so\"><input type=checkbox id=md_snap checked> snap to ground where the script does</label><label title=\"Add the selected parts to this entity/class assignment as another group instead of replacing it\"><input type=checkbox id=md_add> add as extra group (don&#39;t replace)</label><div class=h>Overlay assignments are saved in the project; they do not yet copy mesh/texture resources into the game level.</div>';
document.body.appendChild(mp);
const r2c=document.getElementById('md_c'),ren=new THREE.WebGLRenderer({canvas:r2c,antialias:true}),sc2=new THREE.Scene(),cam2=new THREE.PerspectiveCamera(40,340/240,.01,5000);ren.setSize(340,240,false);
let oy=.6,op=.35,od=5,oc=new V3();
function pv(){cam2.position.set(oc.x+od*Math.sin(oy)*Math.cos(op),oc.y+od*Math.sin(op),oc.z+od*Math.cos(oy)*Math.cos(op));cam2.lookAt(oc);ren.render(sc2,cam2)}
function preview(){for(const c of[...sc2.children])sc2.remove(c);const w=$('md_w').value,L=modelsOf(w),selEl=$('md_l');
 const chosen=[...selEl.selectedOptions].map(o=>L[+o.value]).filter(Boolean);if(!chosen.length){mCur=null;$('md_i').textContent='Select one part, or Ctrl/Cmd-click several parts to make an exact set.';$('md_rawwrap').style.display='none';$('md_a').disabled=$('md_k').disabled=false;pv();return}
 const M=chosen[0],focusedGroup=mGroupFocus?L.modelGroupById?.get(mGroupFocus):null,groupMembers=focusedGroup?(focusedGroup.parts||[]).map(p=>L.find(x=>x.poff===p.p)).filter(Boolean):modelGroupOf(L,M),whole=!focusedGroup&&chosen.length===1&&$('md_whole').checked&&groupMembers.length>1,mem=focusedGroup?chosen:(whole?groupMembers:chosen);
 const groupOnly=mem.length===groupMembers.length&&groupMembers.every(x=>mem.includes(x));
 const debugModel=chosen.length===1&&M.modelName==='debug'&&(M.modelClasses||[]).some(x=>x==='FlagSetter'||x==='CheatPickups');
 const debugProxy=debugModel&&!$('md_raw').checked;
 $('md_rawwrap').style.display=debugModel?'block':'none';
 $('md_a').disabled=$('md_k').disabled=!!debugProxy;
 const activeGroup=focusedGroup||L.modelGroupById?.get(M.modelGroup)||null;mCur={w,parts:mem.map(x=>({m:x.off,p:x.poff})),g:activeGroup?.id||M.modelGroup||M.gid,groupId:activeGroup?.id||M.modelGroup||null,gn:groupMembers.length,groupOnly,modelName:activeGroup?.displayName||M.modelName||null,modelKind:activeGroup?.kind||M.modelKind||null,modelSource:activeGroup?.source||M.modelSource||null,modelInternalName:activeGroup?.internalName||M.modelInternalName||activeGroup?.name||null,modelDescriptor:activeGroup?.descriptor??M.modelDescriptor??null,modelVerified:activeGroup?.source==='groundtruth'||!!M.modelVerified,modelMemberships:M.modelMemberships||[],modelClasses:activeGroup?.classes||M.modelClasses||[],modelNatives:activeGroup?.natives||M.modelNatives||[],previewProxy:!!debugProxy};
 const mn=[1e9,1e9,1e9],mx=[-1e9,-1e9,-1e9];let tris=0,verts=0,drawn=0;const texSet=new Set();
 if(debugProxy){const G=geoOf(w,M.off,M.poff);if(G){const box=new THREE.BoxGeometry(.9,.9,.9),mat=new THREE.MeshBasicMaterial({map:G.mat.map||null,color:G.mat.color||0xffffff,side:THREE.DoubleSide,alphaTest:G.mat.alphaTest||0});sc2.add(new THREE.Mesh(box,mat));drawn=1;tris=12;verts=8;if(M.tex)texSet.add(M.tex.w+'x'+M.tex.h);mn[0]=mn[1]=mn[2]=-.45;mx[0]=mx[1]=mx[2]=.45}}
 else for(const x of mem){const G=geoOf(w,x.off,x.poff);if(!G)continue;sc2.add(new THREE.Mesh(G.g,G.mat));drawn++;tris+=x.idx.length/3;verts+=x.nv;if(x.tex)texSet.add(x.tex.w+'x'+x.tex.h);for(let q=0;q<3;q++){mn[q]=Math.min(mn[q],x.bb[0][q]);mx[q]=Math.max(mx[q],x.bb[1][q])}}
 if(!drawn){mCur=null;$('md_i').textContent='The selected parts do not have renderable geometry.';pv();return}
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
 $('md_i').textContent=label+' · '+verts+' verts · '+tris+' tris · '+span+' · textures: '+(texSet.size?[...texSet].join(', '):'none')+' · '+detail;pv()}
const escM=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function filterM(){const w=$('md_w').value,L=modelsOf(w),sel=$('md_l'),q=$('md_q').value.trim().toLowerCase().replace(/^#/,'');
 for(const o of sel.options){const M=L[+o.value],hay=[o.textContent,o.value,M?.name,M?.modelName,M?.modelInternalName,M?.modelPartLabel,M?.modelReviewNote,M?.modelKind,M?.modelSource,(M?.modelClasses||[]).join(' '),(M?.modelNatives||[]).join(' '),(M?.modelMemberships||[]).map(id=>{const g=L.modelGroupById?.get(id);return(g?.displayName||g?.name||id)+' '+(g?.classes||[]).join(' ')}).join(' '),(M?.modelCandidateGroups||[]).map(id=>L.modelGroupById?.get(id)?.name||id).join(' '),M?.gid,M?.off?.toString(16),M?.poff?.toString(16),M?.tex?M.tex.w+'x'+M.tex.h:''].join(' ').toLowerCase();o.hidden=!!q&&!hay.includes(q)}
 for(const g of sel.children)if(g.tagName==='OPTGROUP')g.hidden=[...g.children].every(o=>o.hidden);
 preview()}
function fillM(){const w=$('md_w').value,L=modelsOf(w),old=new Set([...$('md_l').selectedOptions].map(o=>o.value)),order=[],by=new Map(),groupSel=$('md_groups');mGroupFocus=null;
 const groups=(L.modelGroups||[]).slice().sort((a,b)=>{const ai=Math.min(...(a.parts||[]).map(p=>L.findIndex(M=>M.poff===p.p)).filter(i=>i>=0),999999),bi=Math.min(...(b.parts||[]).map(p=>L.findIndex(M=>M.poff===p.p)).filter(i=>i>=0),999999);return ai-bi||(a.descriptor??0)-(b.descriptor??0)||String(a.id).localeCompare(String(b.id))});
 groupSel.innerHTML='<option value="">Choose model record…</option>'+groups.map(g=>{const n=(g.parts||[]).length,label=registryGroupCaption(g,n);return'<option value="'+escM(g.id)+'">'+escM(label)+'</option>'}).join('');
 const keyOf=M=>M.modelGroup||'unassigned:'+(M.poff??M.off);
 L.forEach((M,k)=>{const id=keyOf(M);if(!by.has(id)){by.set(id,[]);order.push(id)}by.get(id).push(k)});
 const opt=k=>{const M=L[k],height=(M.bb[1][1]-M.bb[0][1]).toFixed(1),model=M.modelGroup?'  '+M.modelName+(M.modelClasses?.length?' · '+M.modelClasses.join(', '):''):'',partLabel=M.modelPartLabel?'  ['+M.modelPartLabel+']':'',label='#'+k+partLabel+'  '+M.nv+' verts  '+height+' tall'+(M.modelGroup?'  '+M.modelPartIndex+'/'+M.modelPartCount:'')+(M.name?'  '+M.name:'')+model;return'<option value="'+k+'"'+(old.has(String(k))?' selected':'')+'>'+escM(label)+'</option>'};
 let h='',singles='';for(const id of order){const ks=by.get(id),M=L[ks[0]],named=!!M.modelGroup;if(ks.length>1||named){const lo=Math.min(...ks),hi=Math.max(...ks),caption=named?modelGroupCaption(M,ks.length):'unverified linked group · '+ks.length+' parts · #'+lo+'–#'+hi;h+='<optgroup label="'+escM(caption)+'">'+ks.map(opt).join('')+'</optgroup>'}else singles+=opt(ks[0])}
 if(singles)h+='<optgroup label="unassigned / unverified single parts">'+singles+'</optgroup>';$('md_l').innerHTML=h;
 if(![...$('md_l').selectedOptions].length&&L.length){const first=$('md_l').options[0];if(first)first.selected=true}
 filterM();if(!L.length)$('md_i').textContent='No object meshes in this wad.';else if(!L.modelGroups?.length)$('md_i').textContent='No named PC model references found in this wad; showing unverified linked groups.';else{const sc=L.modelGroups.filter(g=>g.source==='script').length,dc=L.modelGroups.filter(g=>g.source==='descriptor').length,gt=L.modelGroups.filter(g=>g.source==='groundtruth').length;$('md_i').textContent=(gt?gt+' user-confirmed groups · ':'')+sc+' script-role groups + '+dc+' descriptor candidates · '+L.modelRefCount+' class-script references · '+(L.modelMembershipConflicts||0)+' conflicting visible-model memberships · '+(L.modelGraph?.possibleNodeEdges?.length||0)+' unmerged node-pointer clues · '+(L.modelGroups.filter(g=>g.suppressed).length)+' oversized candidate chains held for review.'}}
$('ed_md').onclick=()=>{mp.style.display=mp.style.display=='none'?'block':'none';if(mp.style.display=='none')return;const ws=files.map(f=>f.name).filter(n=>/^\d+-\d+\.LCS$/i.test(n)).sort((a,b)=>a.localeCompare(b,0,{numeric:true})),cur=sel&&wadOf(sel.L);
 $('md_w').innerHTML=ws.map(n=>'<option>'+n+'</option>').join('');if(cur)$('md_w').value=cur;$('md_q').value='';$('md_l').innerHTML='';fillM()};
$('md_x').onclick=()=>{mp.style.display='none'};$('md_w').onchange=()=>{$('md_l').innerHTML='';fillM()};$('md_l').onchange=()=>{mGroupFocus=null;$('md_groups').value='';preview()};$('md_q').oninput=filterM;$('md_show').onchange=drawModels;$('md_auto').onchange=drawModels;$('md_snap').onchange=drawModels;$('md_whole').onchange=preview;$('md_raw').onchange=preview;
$('md_usegroup').onclick=()=>{const L=modelsOf($('md_w').value),id=$('md_groups').value,g=L.modelGroupById?.get(id);if(!g)return;const wanted=new Set((g.parts||[]).map(p=>p.p));mGroupFocus=id;for(const o of $('md_l').options)o.selected=wanted.has(L[+o.value]?.poff);preview()};
$('md_g').onclick=()=>{const L=modelsOf($('md_w').value),s=$('md_l'),first=[...s.selectedOptions].map(o=>L[+o.value]).find(Boolean);if(!first)return;const id=mGroupFocus||first.modelGroup,g=id&&L.modelGroupById?.get(id);if(!g)return;$('md_groups').value=id;mGroupFocus=id;const wanted=new Set((g.parts||[]).map(p=>p.p));for(const o of s.options)o.selected=wanted.has(L[+o.value]?.poff);preview()};
$('md_s').onclick=()=>{for(const o of $('md_l').options)o.selected=false;preview()};
let md=null;r2c.onmousedown=e=>{md=[e.clientX,e.clientY]};addEventListener('mouseup',()=>{md=null});addEventListener('mousemove',e=>{if(!md)return;oy-=(e.clientX-md[0])*.01;op=Math.max(-1.5,Math.min(1.5,op+(e.clientY-md[1])*.01));md=[e.clientX,e.clientY];pv()});r2c.onwheel=e=>{e.preventDefault();od*=e.deltaY>0?1.1:.9;pv()};
const asg=cls=>{if(mCur?.previewProxy){$('md_i').textContent='Switch to the extracted raw mesh before saving an overlay; the debug cube is an editor-only visual proxy.';return}if(!sel||!mCur||!mCur.parts?.length){$('md_i').textContent='Select an entity in the 3D view and one or more mesh parts first.';return}const tw=wadOf(sel.L);if(!tw)return;PRJ.models=PRJ.models||{};PRJ.scripts=PRJ.scripts||{};const M=PRJ.models[tw]=PRJ.models[tw]||{};const first=mCur.parts[0],entry={w:mCur.w,parts:mCur.parts.map(x=>({m:x.m,p:x.p})),m:first.m,p:first.p,ry:+$('md_r').value||0,modelName:mCur.modelName||null,modelKind:mCur.modelKind||null,modelSource:mCur.modelSource||null,modelInternalName:mCur.modelInternalName||null,modelDescriptor:mCur.modelDescriptor??null,groupId:mCur.groupId||null,modelVerified:!!mCur.modelVerified,modelClasses:mCur.modelClasses||[],modelMemberships:mCur.modelMemberships||[],modelNatives:mCur.modelNatives||[]};if(mCur.groupOnly&&mCur.groupId)entry.groupId=mCur.groupId;const key=cls?'c:'+sel.n:'i:'+sel.i,prev=M[key];if($('md_add')&&$('md_add').checked&&prev){prev.more=(prev.more||[]).concat([{parts:entry.parts,groupId:entry.groupId,modelName:entry.modelName}])}else M[key]=entry;drawModels();summary()};
$('md_a').onclick=()=>asg(false);$('md_k').onclick=()=>asg(true);
$('md_n').onclick=()=>{if(!sel)return;const M=PRJ.models&&PRJ.models[wadOf(sel.L)];if(M){delete M['i:'+sel.i];delete M['c:'+sel.n]}drawModels()};

// ---- self-test of the data-object copier on the loaded volume (read-only)
$('ed_stb').onclick=async()=>{try{if(!isVol())throw'load a .vol first';const ws=files.filter(f=>/^\d+-\d+\.LCS$/i.test(f.name)),wads=[];
  for(const f of ws){$('ed_sum').textContent='self-test: reading '+f.name+' ('+(wads.length+1)+'/'+ws.length+')...';await new Promise(r=>setTimeout(r));const[A,B]=readWad(f.buf,f);wads.push({name:f.name,A,B})}
  $('ed_sum').textContent='self-test: copying class data between levels...';await new Promise(r=>setTimeout(r));const r=EC.copierSelfTest(wads);console.log('copier self-test',r);
  $('ed_sum').textContent='copier self-test ('+loadedVols().join(', ')+'): '+r.copied+' of '+r.pairs+' class pairs copied between levels; copy identical to its source '+r.copyEqualsSource+'/'+r.copied+'; same structure as the target level\'s own copy '+r.copyStructEqualsTarget+'/'+r.copied+'; patched wad well-formed '+r.valid+'/'+r.copied+'. Levels whose data differ cannot be paired: '+(r.pairs-r.copied)+'.';
  let rp=$('ed_rep');if(!rp){showRep();rp=$('ed_rep')}rp.textContent=Object.entries(r.errors).map(([k,n])=>n+' x '+k).concat(r.bad).join('\n');rp.style.whiteSpace='pre-wrap'}catch(x){$('ed_sum').textContent='self-test failed: '+x;console.error(x)}};
// ---- assembly editor (Scripts tab). Edits the code block that holds the selected class; saved in the project (scripts) and applied by "Build patched .vol"
const ASMC={},ASMBUF={};let asmOpen=false,asmW='',asmBusy=false;
const ahex=p=>'0x'+p.toString(16);
function asmCtx(w){if(!ASMC[w]){const g=getWad(w);if(!g)return null;const c=IA.wadCtx(g.A,g.B);ASMC[w]={c,ext:IA.extTargets(c),sw:siWad(g.A,g.B),orig:{}}}return ASMC[w]}
function asmOrig(w,p){const x=asmCtx(w);if(!(p in x.orig))x.orig[p]=IA.fmtBlock(x.c.A,p,x.c.blocks.find(b=>b[0]===p)[1],x.c.rel,null,x.ext);return x.orig[p]}
const asmSaved=(w,p)=>(((PRJ.scripts||{})[w]||{}).blocks||{})[ahex(p)];
function asmBlockOfClass(w,name){const x=asmCtx(w),c=x.sw.classes.find(k=>k.name===name);if(!c)return null;const b=IA.blockOf(x.c,c.entry);return b?b[0]:null}
function asmClassesIn(w,p){const x=asmCtx(w);return x.sw.classes.filter(k=>{const b=IA.blockOf(x.c,k.entry);return b&&b[0]===p}).map(k=>k.name)}
// assemble + dry-run relink + verification for one block edit
function asmCheck(w,p,text){const x=asmCtx(w),c=x.c;let pb;try{pb=IA.parseBlockText(text)}catch(e){return{ok:false,msg:e.message}}
 if(pb.p!==p)return{ok:false,msg:'the ".block" line must stay at '+ahex(p)+' (it identifies the block in the original wad)'};
 let r;try{r=IA.assembleBlock(text)}catch(e){return{ok:false,msg:e.message}}
 let y;try{y=IA.relink(c.A,c.B,new Map([[p,text]]))}catch(e){return{ok:false,msg:e.message}}
 const v=IA.verify(c,y.A,y.B,y.info.relocs,new Set([p])),old=c.blocks.find(b=>b[0]===p)[1],nw=r.bytes.length/4;
 return{ok:!v.bad.length,msg:v.bad.length?'verification failed: '+v.bad.slice(0,3).join('; '):'ok',insns:r.insnOffs.length,old,nw,relocs:r.relocs.length,checked:v.checked}}
function asmEditsHtml(){const sc=PRJ.scripts||{},rows=[];for(const w in sc)for(const k in (sc[w].blocks||{})){const p=+k;let cl='';try{if(asmCtx(w))cl=asmClassesIn(w,p).join(', ')}catch(e){}rows.push('<tr><td>'+esc(w)+'</td><td>'+esc(k)+'</td><td>'+esc(cl||'(load this volume to see classes)')+'</td><td><a data-ae="'+esc(w+'|'+p)+'">open</a> <a data-ad="'+esc(w+'|'+p)+'">remove</a></td></tr>')}
 return rows.length?'<b>Code edits in the project</b> <span class=dim>(applied by &quot;Build patched .vol&quot;)</span><table>'+rows.join('')+'</table>':'<span class=dim>No code edits in the project yet.</span>'}
function asmBox(){const P=$('sdet');if(!P||!scrIx)return;const g=scrIx.by[scrSel];if(!g)return;const v=g.vars[scrVar];
 const ws=[...new Set((v?v.levels:[]).map(L=>wadOf(L)))].filter(w=>w&&getWad(w));let h='<details id=asmd'+(asmOpen?' open':'')+'><summary>Edit assembly of this class\'s code block</summary>';
 if(!isVol())h+='<p class=dim>Open the original .vol first: code edits are made against its wads.</p>';
 else if(!ws.length)h+='<p class=dim>None of this variant\'s levels is in the opened volume.</p>';
 else{if(!ws.includes(asmW))asmW=ws[0];const p=asmBlockOfClass(asmW,g.name);
  if(p===null)h+='<p class=dim>Could not find this class\'s code in '+esc(asmW)+'.</p>';
  else{const key=asmW+'|'+p,saved=asmSaved(asmW,p),text=ASMBUF[key]!==undefined?ASMBUF[key]:(saved!==undefined?saved:asmOrig(asmW,p)),blk=asmCtx(asmW).c.blocks.find(b=>b[0]===p);
   h+='<p class=dim>Level <select id=asw>'+ws.map(w=>'<option'+(w===asmW?' selected':'')+'>'+esc(w)+'</option>').join('')+'</select> &middot; block <b>'+ahex(p)+'</b> ('+blk[1]+' words) also holds: '+esc(asmClassesIn(asmW,p).filter(n=>n!==g.name).join(', ')||'nothing else')+(saved!==undefined?' &middot; <b style="color:#fc6">edited in project</b>':'')+'</p>'+
   '<p class=dim>Text is the whole block. Keep the <code>.block</code> line and every <code>L_xxxx:</code> label that is not used by a branch only if you need it: instructions that class entries/events point at must keep their label. Natives, registers and constants can be changed; add or remove lines freely. Edits do not change the 3D view; they are written into the .vol by <i>Build patched .vol</i>.</p>'+
   '<textarea id=atx spellcheck=false style="width:100%;height:340px;box-sizing:border-box;background:#0a0c10;color:#cde;border:1px solid #334;font:12px/1.4 monospace;white-space:pre;tab-size:4">'+esc(text)+'</textarea>'+
   '<div style="margin:4px 0"><button data-a=check>Check</button> <button data-a=save>Save to project</button> <button data-a=orig>Reload original</button> <button data-a=del>Remove edit</button> <button data-a=self>Self-test this level</button> <button data-a=selfall>Self-test all levels in the volume</button></div>'}}
 h+='<div id=amsg style="white-space:pre-wrap;color:#fc6"></div><div id=aeds>'+asmEditsHtml()+'</div></details>';P.insertAdjacentHTML('beforeend',h);const d=$('asmd');d.ontoggle=()=>{asmOpen=d.open}}
function asmMsg(t){const e=$('amsg');if(e)e.textContent=t}
function asmCur(){const g=scrIx&&scrIx.by[scrSel];if(!g||!asmW)return null;const p=asmBlockOfClass(asmW,g.name);return p===null?null:{w:asmW,p,key:asmW+'|'+p}}
document.addEventListener('input',e=>{if(e.target.id==='atx'){const c=asmCur();if(c)ASMBUF[c.key]=e.target.value}});
document.addEventListener('change',e=>{if(e.target.id==='asw'){asmW=e.target.value;scrDetail()}});
async function asmSelf(all){if(asmBusy)return;asmBusy=true;try{const ws=all?files.filter(f=>/^\d+-\d+\.LCS$/i.test(f.name)).map(f=>f.name):[asmW];let tot={levels:0,blocks:0,insns:0,ptr:0,bad:0};const msgs=[];
  for(const w of ws){asmMsg('self-test '+w+' ('+(tot.levels+1)+'/'+ws.length+')...');await new Promise(r=>setTimeout(r));const g=getWad(w);if(!g)continue;const r=IA.selfTest(g.A,g.B);tot.levels++;tot.blocks+=r.blocks;tot.insns+=r.insns;tot.ptr+=r.ptr;const b=[...r.rtBad,...r.relinkBad];tot.bad+=b.length;if(b.length)msgs.push(w+': '+b.slice(0,2).join(' | '))}
  asmMsg('self-test: '+tot.levels+' level(s), '+tot.blocks+' blocks, '+tot.insns+' instructions: every block text re-assembles to identical bytes; identity relink and an edit of every block (a nop after every 3rd instruction) relinked and verified over '+tot.ptr+' code pointers; problems: '+tot.bad+(msgs.length?'\n'+msgs.slice(0,6).join('\n'):''))}catch(x){asmMsg('self-test failed: '+x)}finally{asmBusy=false}}
document.addEventListener('click',e=>{const t=e.target.closest('[data-a],[data-ae],[data-ad]');if(!t||!$('sdet').contains(t))return;const d=t.dataset;
 if(d.ae||d.ad){const[w,ps]=(d.ae||d.ad).split('|'),p=+ps;if(d.ad){const s=PRJ.scripts&&PRJ.scripts[w];if(s&&s.blocks){delete s.blocks[ahex(p)];if(!Object.keys(s.blocks).length)delete PRJ.scripts[w]}delete ASMBUF[w+'|'+p];scrDetail();return}
  const nm=asmCtx(w)&&asmClassesIn(w,p)[0];if(nm){asmW=w;asmOpen=true;openClass(nm)}return}
 const c=asmCur();if(d.a==='self')return asmSelf(false);if(d.a==='selfall')return asmSelf(true);if(!c)return;const ta=$('atx');
 if(d.a==='orig'){delete ASMBUF[c.key];const s=PRJ.scripts&&PRJ.scripts[c.w];if(s&&s.blocks&&s.blocks[ahex(c.p)]!==undefined)ASMBUF[c.key]=asmOrig(c.w,c.p);asmOpen=true;scrDetail();asmMsg('original block text loaded (not saved: press Save to keep it, or Remove edit)');return}
 if(d.a==='del'){const s=PRJ.scripts&&PRJ.scripts[c.w];if(s&&s.blocks){delete s.blocks[ahex(c.p)];if(!Object.keys(s.blocks).length)delete PRJ.scripts[c.w]}delete ASMBUF[c.key];asmOpen=true;scrDetail();asmMsg('edit removed from the project');return}
 const text=ta.value,r=asmCheck(c.w,c.p,text);
 if(!r.ok){asmMsg('NOT OK: '+r.msg);return}
 const info='assembles: '+r.insns+' instructions, '+r.old+' -> '+r.nw+' words ('+(r.nw>=r.old?'+':'')+(r.nw-r.old)+'), '+r.relocs+' pointer immediates; relinked wad verified ('+r.checked+' code pointers checked)';
 if(d.a==='check'){asmMsg('OK: '+info);return}
 if(d.a==='save'){if(text===asmOrig(c.w,c.p)){const s=PRJ.scripts&&PRJ.scripts[c.w];if(s&&s.blocks)delete s.blocks[ahex(c.p)];if(s&&!Object.keys(s.blocks||{}).length)delete PRJ.scripts[c.w];delete ASMBUF[c.key];asmOpen=true;scrDetail();asmMsg('text is identical to the original: no edit stored');return}
  PRJ.scripts=PRJ.scripts||{};const s=PRJ.scripts[c.w]=PRJ.scripts[c.w]||{blocks:{}};s.blocks[ahex(c.p)]=text;ASMBUF[c.key]=text;asmOpen=true;scrDetail();asmMsg('saved to the project: '+info+'\nUse "Save project" (to keep it) and "Build patched .vol" in the Editor panel on the left.')}});
// the Scripts tab detail pane gets the assembly editor
const oofA=openFiles;openFiles=async fs=>{for(const k in ASMC)delete ASMC[k];for(const k in ASMBUF)delete ASMBUF[k];asmW='';return oofA(fs)};
const osdet=scrDetail;scrDetail=function(){osdet();try{asmBox()}catch(e){console.error(e)}};
// project file: code edits travel with the project (text only, no game data) and are fingerprinted like the other edits
function scriptWadsFp(){const out={};for(const w in(PRJ.scripts||{})){const s=PRJ.scripts[w];if(!s.blocks||!Object.keys(s.blocks).length)continue;const g=getWad(w);
  if(g){const fp={A:EC.fnv(g.A),B:EC.fnv(g.B)};if(s.fp&&(s.fp.A!==fp.A||s.fp.B!==fp.B))throw w+' does not match the base these code edits were made for';s.fp=fp;s.vol=volOf(w)||volName}
  out[w]={vol:volOf(w)||s.vol,fp:s.fp,blocks:s.blocks}}return out}

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
function pushAdds(tw,a){const P=WS(tw),base=P.adds.length,deep=$('ed_deep')&&$('ed_deep').checked;if(!deep){P.adds.push(a);return base}
  const tree=linkTree(a.from.w,a.from.i);if(tree.length<2){P.adds.push(a);return base}
  const L=srcLinks(a.from.w),pos=n=>{const o=L.ins+tree[n].i*0x3c;return[L.F(o+0x10),L.F(o+0x14),L.F(o+0x18)]},root=pos(0);let id=addMaxId();const recs=tree.map((t,n)=>{const p=pos(n);return{from:{w:a.from.w,i:t.i},p:n?a.p.map((v,k)=>r3(v+p[k]-root[k])):a.p,dy:n?0:a.dy,dp:n?0:(a.dp||0),dr:n?0:(a.dr||0),regs:n?{}:{...a.regs},id:++id,lk:[]}});
  // rewire EVERY link register between the copied objects (parent->child, child->parent, sibling->sibling), not just the tree edges found while walking down;
  // otherwise a copy made inside the same level keeps pointing at the original objects through those registers
  const tIdx=new Map(tree.map((t,n)=>[t.i,n]));
  tree.forEach((t,n)=>{const ip=L.U(L.ins+t.i*0x3c+0x2c),seenR=new Set();
   for(const[ow,rg]of L.rows){if(ow!==t.i||seenR.has(rg))continue;const c=L.U(ip+4*rg),m=c<L.nin?tIdx.get(c):undefined;if(m===undefined)continue;seenR.add(rg);recs[n].lk.push([rg,recs[m].id])}});
  const skipped=[];const keep=recs.map((r,n)=>{if(!n||lvOf(r.from.w)===lvOf(tw))return true;try{const nm=srcEnt(r).n,why=ensureClass(tw,r.from.w,nm);if(why)throw nm+': '+why;const s=getWad(r.from.w),bad=EC.prefabCheck(s.A,s.B,r.from.i);if(bad)throw bad;return true}catch(x){skipped.push(String(x));return false}});
  const ids=new Set(recs.filter((r,n)=>keep[n]).map(r=>r.id));recs.forEach(r=>{r.lk=r.lk.filter(l=>ids.has(l[1]))});recs.forEach((r,n)=>{if(keep[n])P.adds.push(r)});
  $('ed_sum').textContent='copied '+recs.filter((r,n)=>keep[n]).length+' linked object(s)'+(skipped.length?'; skipped: '+skipped.join(' | '):'');return base}
// an added object (and the copies linked to it) can be moved to another level
function relvInject(){const R=sel&&rec(sel);const S=$('ed_sel');if(!R||!R.add||!S)return;
  S.insertAdjacentHTML('beforeend','<div style="margin-top:3px"><span class=h>belongs to level</span> <select id=ed_relv>'+D.filter(l=>wadOf(l.id)).map(l=>'<option'+(l.id===sel.L?' selected':'')+'>'+l.id+'</option>').join('')+'</select></div>');
  $('ed_relv').onchange=ev=>{const nw=wadOf(ev.target.value),old=R.w;if(!nw||nw===old)return;const P=WS(old),a0=R.add;
   const grp=new Set([a0]);if(a0.id!==undefined){let ch=true;while(ch){ch=false;for(const x of P.adds){if(grp.has(x))continue;if([...grp].some(y=>(y.lk||[]).some(l=>l[1]===x.id))||(x.lk||[]).some(l=>[...grp].some(y=>y.id===l[1]))){grp.add(x);ch=true}}}}
   try{for(const a of grp){if(lvOf(a.from.w)!==lvOf(nw)){const nm=srcEnt(a).n,why=ensureClass(nw,a.from.w,nm);if(why)throw nm+' cannot be copied into '+nw+': '+why;const s=getWad(a.from.w),bad=EC.prefabCheck(s.A,s.B,a.from.i);if(bad)throw bad}}}catch(x){$('ed_sum').textContent='cannot move: '+x;edUpdate();return}
   P.adds=P.adds.filter(x=>!grp.has(x));const N=WS(nw),first=N.adds.length;for(const a of grp){const keep=a.lk||[];stripLinkRegs(a);a.lk=keep.filter(l=>[...grp].some(y=>y.id===l[1]));N.adds.push(a)}
   refresh();const L=lvOf(nw),lv=D.find(l=>l.id===L);sel=all.find(o=>o.L===L&&o.i===lv.nb+first+[...grp].indexOf(a0));inspect(sel);edUpdate();need=true;$('ed_sum').textContent='moved '+grp.size+' object(s) to '+nw}}
const oeu=edUpdate;edUpdate=function(){oeu();try{relvInject()}catch(e){console.error(e)}};
// objects added from another level take their script info from the object they were copied from
const oscr=scr;scr=function(e){const x=oscr(e);if(x||!e.added||!SCR)return x;const w=wadOf(e.L),a=w&&((PRJ.wads[w]||{}).adds||[])[e.added-1];if(!a)return null;const L2=lvOf(a.from.w),y=SCR.levels[L2]&&SCR.levels[L2][a.from.i];if(!y)return null;const c=SCR.classes[y.k];return c?{c,r:y.r,l:y.l}:null};

})();

