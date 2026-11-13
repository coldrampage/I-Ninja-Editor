// Assembly editor for the Scripts tab. Keeps code edits in the project and applies
// them during patched VOL construction through the controller's fingerprint callback.
import { siWad } from './vol-core.js';

export function installScriptEditor({Viewer, IA, EC, getWad, wadOf, isVol, volOf, getVolName, getProject}) {
// ---- assembly editor (Scripts tab). Edits the code block that holds the selected class; saved in the project (scripts) and applied by "Build patched .vol"
const ASMC={},ASMBUF={};let asmOpen=false,asmW='',asmBusy=false;
const ahex=p=>'0x'+p.toString(16);
function asmCtx(w){if(!ASMC[w]){const g=getWad(w);if(!g)return null;const c=IA.wadCtx(g.A,g.B);ASMC[w]={c,ext:IA.extTargets(c),sw:siWad(g.A,g.B),orig:{}}}return ASMC[w]}
function asmOrig(w,p){const x=asmCtx(w);if(!(p in x.orig))x.orig[p]=IA.fmtBlock(x.c.A,p,x.c.blocks.find(b=>b[0]===p)[1],x.c.rel,null,x.ext);return x.orig[p]}
const asmSaved=(w,p)=>(((getProject().scripts||{})[w]||{}).blocks||{})[ahex(p)];
function asmBlockOfClass(w,name){const x=asmCtx(w),c=x.sw.classes.find(k=>k.name===name);if(!c)return null;const b=IA.blockOf(x.c,c.entry);return b?b[0]:null}
function asmClassesIn(w,p){const x=asmCtx(w);return x.sw.classes.filter(k=>{const b=IA.blockOf(x.c,k.entry);return b&&b[0]===p}).map(k=>k.name)}
// assemble + dry-run relink + verification for one block edit
function asmCheck(w,p,text){const x=asmCtx(w),c=x.c;let pb;try{pb=IA.parseBlockText(text)}catch(e){return{ok:false,msg:e.message}}
 if(pb.p!==p)return{ok:false,msg:'the ".block" line must stay at '+ahex(p)+' (it identifies the block in the original wad)'};
 let r;try{r=IA.assembleBlock(text)}catch(e){return{ok:false,msg:e.message}}
 let y;try{y=IA.relink(c.A,c.B,new Map([[p,text]]))}catch(e){return{ok:false,msg:e.message}}
 const v=IA.verify(c,y.A,y.B,y.info.relocs,new Set([p])),old=c.blocks.find(b=>b[0]===p)[1],nw=r.bytes.length/4;
 return{ok:!v.bad.length,msg:v.bad.length?'verification failed: '+v.bad.slice(0,3).join('; '):'ok',insns:r.insnOffs.length,old,nw,relocs:r.relocs.length,checked:v.checked}}
function asmEditsHtml(){const sc=getProject().scripts||{},rows=[];for(const w in sc)for(const k in (sc[w].blocks||{})){const p=+k;let cl='';try{if(asmCtx(w))cl=asmClassesIn(w,p).join(', ')}catch(e){}rows.push('<tr><td>'+Viewer.esc(w)+'</td><td>'+Viewer.esc(k)+'</td><td>'+Viewer.esc(cl||'(load this volume to see classes)')+'</td><td><a data-ae="'+Viewer.esc(w+'|'+p)+'">open</a> <a data-ad="'+Viewer.esc(w+'|'+p)+'">remove</a></td></tr>')}
 return rows.length?'<b>Code edits in the project</b> <span class=dim>(applied by &quot;Build patched .vol&quot;)</span><table>'+rows.join('')+'</table>':'<span class=dim>No code edits in the project yet.</span>'}
function asmBox(){const P=Viewer.$('sdet');if(!P||!Viewer.scrIx)return;const g=Viewer.scrIx.by[Viewer.scrSel];if(!g)return;const v=g.vars[Viewer.scrVar];
 const ws=[...new Set((v?v.levels:[]).map(L=>wadOf(L)))].filter(w=>w&&getWad(w));let h='<details id=asmd'+(asmOpen?' open':'')+'><summary>Edit assembly of this class\'s code block</summary>';
 if(!isVol())h+='<p class=dim>Open the original .vol first: code edits are made against its wads.</p>';
 else if(!ws.length)h+='<p class=dim>None of this variant\'s levels is in the opened volume.</p>';
 else{if(!ws.includes(asmW))asmW=ws[0];const p=asmBlockOfClass(asmW,g.name);
  if(p===null)h+='<p class=dim>Could not find this class\'s code in '+Viewer.esc(asmW)+'.</p>';
  else{const key=asmW+'|'+p,saved=asmSaved(asmW,p),text=ASMBUF[key]!==undefined?ASMBUF[key]:(saved!==undefined?saved:asmOrig(asmW,p)),blk=asmCtx(asmW).c.blocks.find(b=>b[0]===p);
   h+='<p class=dim>Level <select id=asw>'+ws.map(w=>'<option'+(w===asmW?' selected':'')+'>'+Viewer.esc(w)+'</option>').join('')+'</select> &middot; block <b>'+ahex(p)+'</b> ('+blk[1]+' words) also holds: '+Viewer.esc(asmClassesIn(asmW,p).filter(n=>n!==g.name).join(', ')||'nothing else')+(saved!==undefined?' &middot; <b style="color:#fc6">edited in project</b>':'')+'</p>'+
   '<p class=dim>Text is the whole block. Keep the <code>.block</code> line and every <code>L_xxxx:</code> label that is not used by a branch only if you need it: instructions that class entries/events point at must keep their label. Natives, registers and constants can be changed; add or remove lines freely. Edits do not change the 3D view; they are written into the .vol by <i>Build patched .vol</i>.</p>'+
   '<textarea id=atx spellcheck=false style="width:100%;height:340px;box-sizing:border-box;background:#0a0c10;color:#cde;border:1px solid #334;font:12px/1.4 monospace;white-space:pre;tab-size:4">'+Viewer.esc(text)+'</textarea>'+
   '<div style="margin:4px 0"><button data-a=check>Check</button> <button data-a=save>Save to project</button> <button data-a=orig>Reload original</button> <button data-a=del>Remove edit</button> <button data-a=self>Self-test this level</button> <button data-a=selfall>Self-test all levels in the volume</button></div>'}}
 h+='<div id=amsg style="white-space:pre-wrap;color:#fc6"></div><div id=aeds>'+asmEditsHtml()+'</div></details>';P.insertAdjacentHTML('beforeend',h);const d=Viewer.$('asmd');d.ontoggle=()=>{asmOpen=d.open}}
function asmMsg(t){const e=Viewer.$('amsg');if(e)e.textContent=t}
function asmCur(){const g=Viewer.scrIx&&Viewer.scrIx.by[Viewer.scrSel];if(!g||!asmW)return null;const p=asmBlockOfClass(asmW,g.name);return p===null?null:{w:asmW,p,key:asmW+'|'+p}}
document.addEventListener('input',e=>{if(e.target.id==='atx'){const c=asmCur();if(c)ASMBUF[c.key]=e.target.value}});
document.addEventListener('change',e=>{if(e.target.id==='asw'){asmW=e.target.value;Viewer.scrDetail()}});
async function asmSelf(all){if(asmBusy)return;asmBusy=true;try{const ws=all?Viewer.files.filter(f=>/^\d+-\d+\.LCS$/i.test(f.name)).map(f=>f.name):[asmW];let tot={levels:0,blocks:0,insns:0,ptr:0,bad:0};const msgs=[];
  for(const w of ws){asmMsg('self-test '+w+' ('+(tot.levels+1)+'/'+ws.length+')...');await new Promise(r=>setTimeout(r));const g=getWad(w);if(!g)continue;const r=IA.selfTest(g.A,g.B);tot.levels++;tot.blocks+=r.blocks;tot.insns+=r.insns;tot.ptr+=r.ptr;const b=[...r.rtBad,...r.relinkBad];tot.bad+=b.length;if(b.length)msgs.push(w+': '+b.slice(0,2).join(' | '))}
  asmMsg('self-test: '+tot.levels+' level(s), '+tot.blocks+' blocks, '+tot.insns+' instructions: every block text re-assembles to identical bytes; identity relink and an edit of every block (a nop after every 3rd instruction) relinked and verified over '+tot.ptr+' code pointers; problems: '+tot.bad+(msgs.length?'\n'+msgs.slice(0,6).join('\n'):''))}catch(x){asmMsg('self-test failed: '+x)}finally{asmBusy=false}}
document.addEventListener('click',e=>{const t=e.target.closest('[data-a],[data-ae],[data-ad]');if(!t||!Viewer.$('sdet').contains(t))return;const d=t.dataset;
 if(d.ae||d.ad){const[w,ps]=(d.ae||d.ad).split('|'),p=+ps;if(d.ad){const s=getProject().scripts&&getProject().scripts[w];if(s&&s.blocks){delete s.blocks[ahex(p)];if(!Object.keys(s.blocks).length)delete getProject().scripts[w]}delete ASMBUF[w+'|'+p];Viewer.scrDetail();return}
  const nm=asmCtx(w)&&asmClassesIn(w,p)[0];if(nm){asmW=w;asmOpen=true;Viewer.openClass(nm)}return}
 const c=asmCur();if(d.a==='self')return asmSelf(false);if(d.a==='selfall')return asmSelf(true);if(!c)return;const ta=Viewer.$('atx');
 if(d.a==='orig'){delete ASMBUF[c.key];const s=getProject().scripts&&getProject().scripts[c.w];if(s&&s.blocks&&s.blocks[ahex(c.p)]!==undefined)ASMBUF[c.key]=asmOrig(c.w,c.p);asmOpen=true;Viewer.scrDetail();asmMsg('original block text loaded (not saved: press Save to keep it, or Remove edit)');return}
 if(d.a==='del'){const s=getProject().scripts&&getProject().scripts[c.w];if(s&&s.blocks){delete s.blocks[ahex(c.p)];if(!Object.keys(s.blocks).length)delete getProject().scripts[c.w]}delete ASMBUF[c.key];asmOpen=true;Viewer.scrDetail();asmMsg('edit removed from the project');return}
 const text=ta.value,r=asmCheck(c.w,c.p,text);
 if(!r.ok){asmMsg('NOT OK: '+r.msg);return}
 const info='assembles: '+r.insns+' instructions, '+r.old+' -> '+r.nw+' words ('+(r.nw>=r.old?'+':'')+(r.nw-r.old)+'), '+r.relocs+' pointer immediates; relinked wad verified ('+r.checked+' code pointers checked)';
 if(d.a==='check'){asmMsg('OK: '+info);return}
 if(d.a==='save'){if(text===asmOrig(c.w,c.p)){const s=getProject().scripts&&getProject().scripts[c.w];if(s&&s.blocks)delete s.blocks[ahex(c.p)];if(s&&!Object.keys(s.blocks||{}).length)delete getProject().scripts[c.w];delete ASMBUF[c.key];asmOpen=true;Viewer.scrDetail();asmMsg('text is identical to the original: no edit stored');return}
  getProject().scripts=getProject().scripts||{};const s=getProject().scripts[c.w]=getProject().scripts[c.w]||{blocks:{}};s.blocks[ahex(c.p)]=text;ASMBUF[c.key]=text;asmOpen=true;Viewer.scrDetail();asmMsg('saved to the project: '+info+'\nUse "Save project" (to keep it) and "Build patched .vol" in the Editor panel on the left.')}});
// the Scripts tab detail pane gets the assembly editor
const oofA=Viewer.openFiles;Viewer.openFiles=async fs=>{for(const k in ASMC)delete ASMC[k];for(const k in ASMBUF)delete ASMBUF[k];asmW='';return oofA(fs)};
const osdet=Viewer.scrDetail;Viewer.scrDetail=function(){osdet();try{asmBox()}catch(e){console.error(e)}};
// project file: code edits travel with the project (text only, no game data) and are fingerprinted like the other edits
function scriptWadsFp(){const out={};for(const w in(getProject().scripts||{})){const s=getProject().scripts[w];if(!s.blocks||!Object.keys(s.blocks).length)continue;const g=getWad(w);
  if(g){const fp={A:EC.fnv(g.A),B:EC.fnv(g.B)};if(s.fp&&(s.fp.A!==fp.A||s.fp.B!==fp.B))throw w+' does not match the base these code edits were made for';s.fp=fp;s.vol=volOf(w)||getVolName()}
  out[w]={vol:volOf(w)||s.vol,fp:s.fp,blocks:s.blocks}}return out}


  return { scriptWadsFp };
}
