import {
  analyseStrats, SiAn, fixups, parseTga, parseVol, parseMaterialResources,
  siCstr, siDisasm, siPrint, siWad, siClass
} from './vol-core.js?v=step146-strat-appearance-preview';
import {parseIninjaModelBundle, parseIninjaModelTextures, base64ToBytes} from './custom-models.js?v=step146-strat-appearance-preview';
import {staticModelTemplateA, staticModelTemplateB, collisionModelTemplateA, collisionModelTemplateB, renderTemplateA, renderTemplateB, customModelTemplateLayout} from './custom-model-templates.js?v=step146-strat-appearance-preview';

// ---- editor core (pure, no DOM). Its dependencies are explicit module imports.
const EC=(()=>{
const fnv=u8=>{let h=2166136261;for(let i=0;i<u8.length;i++){h^=u8[i];h=Math.imul(h,16777619)}return(h>>>0).toString(16).padStart(8,'0')};
// compressor for the game's LZ format (inverse of inflate()): literal runs <=64, RLE 2..65, matches len 2..17 / dist 2..2049 (never overlapping)
function deflate(src){const n=src.length;let o=new Uint8Array(n+(n>>5)+1024),op=0;
 const head=new Int32Array(65536).fill(-1),prev=new Int32Array(n+1);
 const hs=i=>Math.imul(src[i]|src[i+1]<<8|src[i+2]<<16,0x9E3779B1)>>>16;
 const need=k=>{if(op+k>o.length){const t=new Uint8Array(o.length*2);t.set(o);o=t}};
 const ins=i=>{if(i+2<n){const h=hs(i);prev[i]=head[h];head[h]=i}};
 let i=0,ls=0;
 const flush=e=>{while(ls<e){const k=Math.min(64,e-ls);need(k+1);o[op++]=k-1;o.set(src.subarray(ls,ls+k),op);op+=k;ls+=k}};
 while(i<n){let bl=0,bd=0;
  if(i+2<n){let c=head[hs(i)],t=0;while(c>=0&&t++<48&&i-c<=2049){const dist=i-c;if(dist>=2){const mx=Math.min(17,n-i,dist);let l=0;while(l<mx&&src[c+l]===src[i+l])l++;if(l>bl){bl=l;bd=dist;if(l===17)break}}c=prev[c]}}
  let r=1;while(r<65&&i+r<n&&src[i+r]===src[i])r++;
  if(r>=3&&r>=bl){flush(i);need(2);o[op++]=0x40|(r-2);o[op++]=src[i];for(let k=0;k<r;k++)ins(i+k);i+=r;ls=i}
  else if(bl>=3){flush(i);const V=(bd-2)^0xfff;need(2);o[op++]=V>>4;o[op++]=((V&15)<<4)|(bl-2);for(let k=0;k<bl;k++)ins(i+k);i+=bl;ls=i}
  else{ins(i);i++}}
 flush(n);return o.slice(0,op)}
// BIGB wad: header (u32@4 + 16 bytes) holds block sizes at 0x80 (dec) / 0x88 (comp); data = comp(A) + comp(B)
function packWad(hdr,A,B){let ca=deflate(A),cb=deflate(B);if(ca.length===A.length)ca=Uint8Array.from([...ca,0]);if(cb.length===B.length)cb=Uint8Array.from([...cb,0]);
 const tot=hdr.length+ca.length+cb.length,out=new Uint8Array(Math.ceil(tot/2048)*2048),d=new DataView(out.buffer);
 out.set(hdr);d.setUint32(0x80,A.length,true);d.setUint32(0x84,B.length,true);d.setUint32(0x88,ca.length,true);d.setUint32(0x8c,cb.length,true);
 out.set(ca,hdr.length);out.set(cb,hdr.length+ca.length);return out}
// quaternion model (verified on all instances of 10-00): q = Ry(180deg+yaw) * Rx(pitch) * Rz(roll); euler in 4096/turn at +1c,+20,+24
const qmul=(a,b)=>[a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1],a[3]*b[1]-a[0]*b[2]+a[1]*b[3]+a[2]*b[0],a[3]*b[2]+a[0]*b[1]-a[1]*b[0]+a[2]*b[3],a[3]*b[3]-a[0]*b[0]-a[1]*b[1]-a[2]*b[2]];
const qy=a=>[0,Math.sin(a/2),0,Math.cos(a/2)],qx=a=>[Math.sin(a/2),0,0,Math.cos(a/2)],qz=a=>[0,0,Math.sin(a/2),Math.cos(a/2)];
const TURN=4096,CLS=0x2c,INS=0x3c;
// ---- patch one strat wad. ops={mods:{idx:{d:[x,y,z],dy:4096-units,regs:{k:u32}}},adds:[{from:{w,i},p:[x,y,z],dy,regs}]}
// srcWad(name)->{A,B} gives other wads of the same volume (prefabs may come from another level)
function patchLcs0(A0,B0,ops,wadName,srcWad,env){
 const imp=fixups(B0),h=(imp[0x8000010e]||[])[0];if(h==null)throw'no strat header';
 let A=new Uint8Array(A0.length+(1<<16));A.set(A0);let len=A0.length,d=new DataView(A.buffer);
 const rel=new Set(imp.rel),newRel=[],addRel=o=>{if(!rel.has(o)){rel.add(o);newRel.push(o)}};
 const U=o=>d.getUint32(o,true),F=o=>d.getFloat32(o,true),W=(o,v)=>d.setUint32(o,v>>>0,true),WF=(o,v)=>d.setFloat32(o,v,true);
 const alloc=(n,al=16)=>{const p=Math.ceil(len/al)*al;if(p+n>A.length){const t=new Uint8Array(Math.max(A.length*2,p+n+65536));t.set(A);A=t;d=new DataView(A.buffer)}len=p+n;return p};
 const cl=U(h+0x14),ncl=U(h+0x20),ins=U(h+0x28),nin=d.getUint16(h+0x30,true),lnk=U(h+0x2c),nlk=d.getUint16(h+0x32,true);
 const cstrA=(a,o)=>siCstr(a,o);
 const clsByName=n=>{for(let i=0;i<ncl;i++){const o=cl+i*CLS;if(cstrA(A,U(o+4))===n)return o}return -1};
 // graph copier over this patch's growing buffer: init registers that point into another level's data copy what they point at (and the resources it needs)
 const gshim={get A(){return A},rel,alloc,addRel,W:(o,v)=>W(o,v),U,newSpec:[],addRelTo:(arr,o)=>{if(!rel.has(o)){rel.add(o);arr.push(o)}},addSpec:(k,loc,rels)=>gshim.newSpec.push({kind:(0x80000000|k)>>>0,loc,rels})},gctx={};
 const gcopy=(sw,wn,v)=>{let g=gctx[wn];if(!g){const S=SrcCtx(sw.A,sw.B),T=SrcCtx(A0,B0);S.wadName=wn;g=gctx[wn]={S,res:resResolver(S,T).hook,memo:new Map()}}
  return copyGraph(g.S,gshim,[v],{res:g.res,cls:n=>{const o=clsByName(n);return o<0?null:o},snd:env&&env.snd},{addRes:true,memo:g.memo}).get(v)};
 const writeTextSlot=(slot,value)=>{
  if(!rel.has(slot)||slot<0||slot+4>A.length)throw'text link at @'+slot.toString(16)+' is not a relocated pointer';
  const old=U(slot);if(old<1||old>=A.length)throw'text pointer at @'+slot.toString(16)+' has an invalid target';let end=old;while(end<A.length&&end-old<=4096&&A[end]!==0)end++;if(end>=A.length||end-old>4096)throw'text pointer at @'+slot.toString(16)+' does not target a bounded string';
  const text=String(value);if(text.includes('\0'))throw'text cannot contain a NUL character';
  const bytes=new TextEncoder().encode(text);if(bytes.length>4096)throw'text is too long ('+bytes.length+' UTF-8 bytes)';
  const p=alloc(bytes.length+2,4);A[p]=0;A.set(bytes,p+1);A[p+1+bytes.length]=0;W(slot,p+1);addRel(slot);
 };
 const writeSoundSlot=(slot,off)=>{
  if(!rel.has(slot)||slot<0||slot+4>A.length)throw'sound link at @'+slot.toString(16)+' is not a relocated pointer';
  const registered=(imp[0x80000115]||[]).includes(off)||gshim.newSpec.some(x=>x.kind===0x80000115&&x.loc===off);
  if(!registered||!rel.has(off)||off<0||off+4>A.length)throw'selected sound @'+Number(off).toString(16)+' is not a registered sound handle in '+wadName;
  const bankOff=U(off),info=bankInfo(A,bankOff),oldHandle=U(slot),oldInfo=oldHandle>0&&oldHandle+4<=A.length&&rel.has(oldHandle)?bankInfo(A,U(oldHandle)):null;
  if(!info||!['WAVE','WAVS'].includes(info.kind))throw'selected sound handle @'+Number(off).toString(16)+' does not point to a supported WAVE/WAVS bank';
  if(oldInfo&&oldInfo.kind!==info.kind)throw'sound format mismatch: '+oldInfo.kind+' cannot be replaced with '+info.kind;
  W(slot,off);addRel(slot);
 };
 const customSoundHandles=new Map();
 const writeCustomSoundSlot=(slot,id)=>{
  if(!env||!env.snd||typeof env.snd.addCustom!=='function')throw"custom sound import needs the target volume's paired .avl loaded";
  const asset=env.audioAssets&&env.audioAssets[id];if(!asset)throw'custom sound asset '+id+' is missing from the project; re-import it';
  if(customSoundHandles.has(id)){writeSoundSlot(slot,customSoundHandles.get(id));return}
  const place=env.snd.addCustom(asset);
  const bankBytes=makeCustomSoundBank(asset,place.off,place.len);
  const bankOff=alloc(bankBytes.length,16);A.set(bankBytes,bankOff);
  gshim.addSpec(0x113,bankOff,[]);
  const handleOff=alloc(4,4);W(handleOff,bankOff);rel.add(handleOff);gshim.addSpec(0x115,handleOff,[handleOff]);
  customSoundHandles.set(id,handleOff);
  writeSoundSlot(slot,handleOff);
 };
 const writeCustomMusicBank=(bankOff,id)=>{
  if(!env||!env.snd||typeof env.snd.addCustom!=='function')throw"music replacement needs the matching volume's paired .avl loaded";
  const asset=env.audioAssets&&env.audioAssets[id];if(!asset)throw'custom music asset '+id+' is missing from the project; re-import it';
  if(!(imp[0x80000113]||[]).includes(bankOff))throw'music bank @'+bankOff.toString(16)+' is not a registered level resource';
  const info=bankInfo(A,bankOff),riff=riffChunks(A,bankOff);
  if(!info||!riff||!['WAVE','WAVS'].includes(info.kind))throw'music target @'+bankOff.toString(16)+' is not a supported WAVE/WAVS bank';
  if(asset.kind!==info.kind)throw'music format mismatch: '+info.kind+' cannot be replaced with '+asset.kind;
  const fmt=riff.chunks['fmt ']&&riff.chunks['fmt '][0],fact=riff.chunks.fact&&riff.chunks.fact[0],strm=riff.chunks.strm&&riff.chunks.strm[0];
  if(!fmt||fmt.n<20||!fact||fact.n<4||!strm||strm.n<8)throw'music bank @'+bankOff.toString(16)+' has an unsupported descriptor layout';
  const channels=+asset.channels,rate=+asset.sampleRate,samples=+asset.samples,blockAlign=36*channels;
  if((channels!==1&&channels!==2)||!Number.isInteger(rate)||rate<8000||rate>48000||!Number.isInteger(samples)||samples<1)throw'custom music metadata is invalid';
  const place=env.snd.addCustom(asset);if(place.kind!==info.kind)throw'music storage type changed unexpectedly';
  const fd=new DataView(A.buffer,A.byteOffset,A.byteLength);
  fd.setUint16(fmt.at,0x0069,true);fd.setUint16(fmt.at+2,channels,true);fd.setUint32(fmt.at+4,rate,true);
  fd.setUint32(fmt.at+8,Math.round(rate*blockAlign/64),true);fd.setUint16(fmt.at+12,blockAlign,true);fd.setUint16(fmt.at+14,4,true);fd.setUint16(fmt.at+16,2,true);fd.setUint16(fmt.at+18,64,true);
  fd.setUint32(fact.at,samples,true);fd.setUint32(strm.at,place.off,true);fd.setUint32(strm.at+4,place.len,true);
 };
 for(const [bankKey,assetId] of Object.entries(env&&env.musicAssets||{}))if(assetId)writeCustomMusicBank(+bankKey,String(assetId));
 const editValue=(x,key)=>x&&typeof x==='object'?x[key]:x;
 const applyAddedDataEdits=(a,sw,same,sourceInit,targetInit)=>{
  const g=gctx[a.from.w];
  const targetSlot=edit=>{const owner=+edit.owner,sourceSlot=+edit.slot;if(edit.ownerKind==='init')return targetInit+(sourceSlot-sourceInit);const destOwner=g&&g.memo.has(owner)?g.memo.get(owner):(same?owner:null);if(destOwner===undefined||destOwner===null)throw'linked data block @'+owner.toString(16)+' was not copied with '+a.from.w+'; its text/audio link cannot be edited safely';return destOwner+(sourceSlot-owner)};
  for(const[slot,edit]of Object.entries(a.texts||{})){const rec=edit&&typeof edit==='object'?{...edit,slot:+slot}:{owner:+slot,slot:+slot,value:edit};writeTextSlot(targetSlot(rec),rec.value);}
  for(const[slot,edit]of Object.entries(a.sounds||{})){const rec=edit&&typeof edit==='object'?{...edit,slot:+slot}:{owner:+slot,slot:+slot,off:edit};const dst=targetSlot(rec);if(rec.customId)writeCustomSoundSlot(dst,rec.customId);else{const sourceOff=+rec.off;const targetOff=gcopy(sw,a.from.w,sourceOff);writeSoundSlot(dst,targetOff)}}
 };
 const moveShape=(sp,dd,seen)=>{if(!sp||seen.has(sp))return;seen.add(sp);const ty=U(sp)&0xffff,cnt=U(sp)>>>16,pp=U(sp+4);
  for(let k=0;k<3;k++){WF(sp+8+4*k,F(sp+8+4*k)+dd[k]);WF(sp+20+4*k,F(sp+20+4*k)+dd[k])}
  if((ty==5||ty==6)&&cnt>=3&&pp&&rel.has(sp+4)&&!seen.has(pp)){seen.add(pp);for(let v=0;v<cnt;v++)for(let k=0;k<3;k++)WF(pp+12*v+4*k,F(pp+12*v+4*k)+dd[k])}};
 const writeTriggerShape=(instanceOff,trigger,pos,sourcePtr)=>{
  const ty=+trigger.ty,box=trigger.box,poly=trigger.poly&&trigger.poly.slice();
  if(!Number.isInteger(ty)||ty<0||ty>6)throw'invalid trigger type '+trigger.ty;
  if(!Array.isArray(box)||box.length!==6||!box.every(Number.isFinite)||![0,1,2].every(k=>box[k]<box[k+3]))throw'invalid trigger bounds';
  let verts=poly;
  if(ty===5||ty===6){if(!verts||verts.length<9||verts.length%3||verts.length/3>64||!verts.every(Number.isFinite))throw'polygon trigger needs 3 to 64 finite vertices';}
  const t=alloc(0x20,16);
  if(sourcePtr>0&&sourcePtr+0x20<=A.length){for(let w=0;w<0x20;w+=4)W(t+w,U(sourcePtr+w));}else for(let w=0;w<0x20;w+=4)W(t+w,0);
  for(let k=0;k<3;k++){WF(t+8+4*k,pos[k]+box[k]);WF(t+20+4*k,pos[k]+box[k+3])}
  if(ty===5||ty===6){const count=verts.length/3,p=alloc(count*12,4);for(let i=0;i<count;i++)for(let k=0;k<3;k++)WF(p+i*12+4*k,pos[k]+verts[i*3+k]);W(t,((count<<16)|ty)>>>0);W(t+4,p);addRel(t+4);}
  else{W(t,ty);W(t+4,0);rel.delete(t+4)}
  W(instanceOff+0x34,t);addRel(instanceOff+0x34);
 };
 const pathNodes=(dv,Uf,pn)=>{const seen=new Set();for(let g=0;g<64&&Uf(pn)>0&&!seen.has(pn);g++){seen.add(pn);pn=Uf(pn)}
  const nodes=[],s2=new Set();while(pn>0&&!s2.has(pn)&&nodes.length<64){s2.add(pn);nodes.push(pn);pn=Uf(pn+4)}return nodes};
 const writePathOverride=(instanceOff,positions,pathMap,cloneExisting)=>{
  const pn=U(instanceOff+0x30);
  if(!pn)throw'cannot edit a waypoint path that has no node chain';
  const sn=pathNodes(d,U,pn);
  if(!sn.length)throw'waypoint path has no readable nodes';
  if(!Array.isArray(positions)||positions.length<1||positions.length>64)throw'waypoint paths must contain 1 to 64 nodes';
  let templates;
  if(pathMap===undefined||pathMap===null){
   if(positions.length!==sn.length)throw'waypoint path node count changed without a source-node map';
   templates=sn.map((_,i)=>i);
  }else{
   if(!Array.isArray(pathMap)||pathMap.length!==positions.length||pathMap.some(i=>!Number.isInteger(i)||i<0||i>=sn.length))throw'invalid waypoint source-node map';
   templates=pathMap.slice();
  }
  const identity=positions.length===sn.length&&templates.every((v,i)=>v===i);
  let targets=sn,cur=sn.indexOf(pn);
  // A changed count or a mapped duplicate needs a rebuilt chain. Each output
  // node copies the selected source node's full 0x40-byte record, then receives
  // fresh prev/next links and its edited position. This keeps node-specific
  // metadata when a waypoint is duplicated in the editor.
  if(cloneExisting||!identity){
   const base=alloc(positions.length*0x40,16);targets=positions.map((_,k)=>base+k*0x40);
   targets.forEach((t,k)=>{
    const source=sn[templates[k]];
    for(let w=0;w<0x40;w+=4){W(t+w,U(source+w));if(w>=8&&rel.has(source+w))addRel(t+w)}
    W(t,k?targets[k-1]:0);if(k)addRel(t);
    W(t+4,k+1<targets.length?targets[k+1]:0);if(k+1<targets.length)addRel(t+4);
   });
   const originalCurrentIndex=Math.max(0,cur);
   let targetIndex=templates.indexOf(originalCurrentIndex);
   // If the current waypoint was deleted, keep the entity on the nearest
   // surviving source node. Prefer the preceding node on an equal-distance
   // tie; this mirrors deleting a selected point from the ordered path.
   if(targetIndex<0){
    let bestDistance=Infinity,bestSource=Infinity;
    for(let k=0;k<templates.length;k++){
     const sourceIndex=templates[k],distance=Math.abs(sourceIndex-originalCurrentIndex);
     if(distance<bestDistance||(distance===bestDistance&&(sourceIndex<bestSource||(sourceIndex===bestSource&&k<targetIndex)))){
      bestDistance=distance;bestSource=sourceIndex;targetIndex=k;
     }
    }
   }
   if(targetIndex<0)targetIndex=0;
   W(instanceOff+0x30,targets[Math.min(targetIndex,targets.length-1)]);addRel(instanceOff+0x30);
  }
  positions.forEach((p,k)=>{
   if(!Array.isArray(p)||p.length<3||!p.slice(0,3).every(Number.isFinite))throw'invalid waypoint position at node '+k;
   for(let axis=0;axis<3;axis++)WF(targets[k]+8+axis*4,p[axis]);
  });
 };
 // yaw dy is a world-up turn applied on the left (and added to the +0x20 heading); pitch dp (local X) and roll dr (local Z) are applied on the right, after the original orientation. All in 4096-unit turns.
 const rot=(eo,dy,dp,dr)=>{dy=dy||0;dp=dp||0;dr=dr||0;if(!dy&&!dp&&!dr)return;const o=eo,q=[F(o),F(o+4),F(o+8),F(o+12)],ang=x=>x/TURN*2*Math.PI,r=qmul(qmul(qy(ang(dy)),q),qmul(qx(ang(dp)),qz(ang(dr))));for(let k=0;k<4;k++)WF(o+4*k,r[k]);if(dy)WF(o+0x20,F(o+0x20)+dy)};
 const del=new Set(ops.del||[]);for(const i of del)if(!(i<nin))throw'removed instance '+i+' out of range in '+wadName;
 // ---- 1) in-place edits of existing instances
 const doneNodes=new Set(),doneShapes=new Set();
 for(const[k,m]of Object.entries(ops.mods||{})){const i=+k;if(!(i<nin))throw'instance '+i+' out of range in '+wadName;if(del.has(i))continue;const o=ins+i*INS,dd=m.d||[0,0,0];
  if(dd.some(x=>x)){for(let a=0;a<3;a++)WF(o+0x10+4*a,F(o+0x10+4*a)+dd[a]);if(!m.trigger)moveShape(U(o+0x34),dd,doneShapes);
   const pn=U(o+0x30);if(pn&&!m.path)for(const n of pathNodes(d,U,pn))if(!doneNodes.has(n)){doneNodes.add(n);for(let a=0;a<3;a++)WF(n+8+4*a,F(n+8+4*a)+dd[a])}}
  if(m.path){const pos=[F(o+0x10),F(o+0x14),F(o+0x18)];writePathOverride(o,m.path.map(n=>n.map((v,k)=>v+pos[k])),m.pathMap,true)}
  if(m.trigger)writeTriggerShape(o,m.trigger,[F(o+0x10),F(o+0x14),F(o+0x18)],U(o+0x34));
  rot(o,m.dy||0,m.dp||0,m.dr||0);
  const rg=Object.entries(m.regs||{}),textEntries=Object.entries(m.texts||{}),initTextEntries=textEntries.filter(([,x])=>x&&typeof x==='object'&&x.ownerKind==='init');
  if(rg.length||initTextEntries.length){const cp=U(o+0x28),ni=d.getUint16(cp+0x18,true),old=U(o+0x2c),np=alloc(4*Math.max(ni,1));
   for(let r=0;r<ni;r++){W(np+4*r,U(old+4*r));if(rel.has(old+4*r))addRel(np+4*r)}W(o+0x2c,np);addRel(o+0x2c);
   for(const[r,v]of rg){if(!(+r<ni))throw'register '+r+' out of range';rel.delete(np+4*r);W(np+4*r,v)}
   for(const[slot,edit]of initTextEntries){const rec=edit&&typeof edit==='object'?edit:{owner:old,slot:+slot,value:edit};const dst=np+(+slot-(+rec.owner));writeTextSlot(dst,rec.value)}
  }
  for(const[slot,edit]of textEntries)if(!(edit&&typeof edit==='object'&&edit.ownerKind==='init'))writeTextSlot(+slot,editValue(edit,'value'));
  for(const[slot,edit]of Object.entries(m.sounds||{})){const rec=edit&&typeof edit==='object'?edit:{off:edit};if(rec.customId)writeCustomSoundSlot(+slot,rec.customId);else writeSoundSlot(+slot,+editValue(edit,'off'))}
 }
 // ---- 2) new instances: move the instance table (and link table) to the end of the block and append
 const adds=ops.adds||[], mods=ops.mods||{};
 let lkChanged=false;
 const linkOnlyChange=Object.values(mods).some(m=>(m.linkRegs||[]).length||(m.lk||[]).length);
 if(adds.length||del.size||linkOnlyChange){const kept=[];for(let i=0;i<nin;i++)if(!del.has(i))kept.push(i);const map=new Map(kept.map((o,n)=>[o,n])),nk=kept.length,nn=nk+adds.length;
  // the per-class lists end where the instance table starts, so they move together with it
  let bs=ins;for(let i=0;i<ncl;i++)bs=Math.min(bs,U(cl+i*CLS+0x1c));const bl=ins-bs,Tb=alloc(bl+nn*INS),T=Tb+bl;A.copyWithin(Tb,bs,ins);for(let w=0;w<bl;w+=4)if(rel.has(bs+w))addRel(Tb+w);
  for(let i=0;i<ncl;i++){const o=cl+i*CLS+0x1c,v=U(o);if(v>=bs&&v<ins)W(o,v-bs+Tb);else if(v>=ins)W(o,T)}
  
  kept.forEach((o0,n)=>{const so=ins+o0*INS,to=T+n*INS;A.copyWithin(to,so,so+INS);for(let w=0;w<INS;w+=4)if(rel.has(so+w))addRel(to+w);W(to+0x38,n)});
  const lk=[];for(let i=0;i<nlk;i++){const ow=d.getUint16(lnk+4*i,true),rg=d.getUint16(lnk+4*i+2,true);if(map.has(ow))lk.push([map.get(ow),rg])}
  // Add new optional link-table entries for existing entities. These are used
  // by EnemyGenerator's empty enemy slots, whose script reads R1–R20 even
  // when the source LCS has no link tuple for a particular slot.
  for(const[k,m]of Object.entries(mods)){const owner=map.get(+k);if(owner===undefined||del.has(+k))continue;
   const cp=U(T+owner*INS+0x28),ni=d.getUint16(cp+0x18,true);
   for(const rg0 of m.linkRegs||[]){const rg=+rg0;if(!Number.isInteger(rg)||rg<0||rg>=ni)throw'link register '+rg+' out of range';if(!lk.some(x=>x[0]===owner&&x[1]===rg)){lk.push([owner,rg]);lkChanged=true}}
  }
  // registers that hold instance indices follow the renumbering (copy-on-write: init arrays can be shared)
  if(del.size){const cow=new Set();for(const[n,rg]of lk){const to=T+n*INS;let ip=U(to+0x2c);const v=U(ip+4*rg);if(del.has(v))throw'instance #'+kept[n]+' links to removed instance #'+v+' (register '+rg+') in '+wadName;
    if(map.has(v)&&map.get(v)!==v){if(!cow.has(n)){const ni=d.getUint16(U(to+0x28)+0x18,true),np=alloc(4*Math.max(ni,1));for(let r=0;r<ni;r++){W(np+4*r,U(ip+4*r));if(rel.has(ip+4*r))addRel(np+4*r)}W(to+0x2c,np);cow.add(n);ip=np}W(ip+4*rg,map.get(v))}}
   lkChanged=true}
  const idToIdx=new Map(adds.map((a,n)=>[a.id,nk+n]).filter(x=>x[0]!==undefined));
  adds.forEach((a,n)=>{const sw=a.from.w===wadName?{A:A0,B:B0}:srcWad(a.from.w);if(!sw)throw'prefab source '+a.from.w+' not found';
   const same=a.from.w===wadName,sA=sw.A,sd=new DataView(sA.buffer,sA.byteOffset,sA.length),sU=o=>sd.getUint32(o,true),sF=o=>sd.getFloat32(o,true),sourceS=SrcCtx(sA,sw.B),sRel=same?imp.rel:fixups(sw.B).rel,
    sh=(fixups(sw.B)[0x8000010e]||[])[0];if(sh==null)throw'bad prefab source';
   const editedOwners=new Set([...Object.values(a.texts||{}),...Object.values(a.sounds||{})].filter(x=>x&&typeof x==='object'&&x.ownerKind!=='init').map(x=>+x.owner));
   const ownsEdit=v=>{if(!editedOwners.size)return false;const graph=dataClosure(sourceS,[v]);for(const owner of editedOwners)if(graph.objs.has(owner)&&graph.objs.get(owner).k==='data')return true;return false};
   const sIns=sU(sh+0x28),sLnk=sU(sh+0x2c),sNl=sd.getUint16(sh+0x32,true),so=sIns+a.from.i*INS,idx=nk+n,o=T+idx*INS;
   const scp=sU(so+0x28),cname=cstrA(sA,sU(scp+4));
   // A source class can share its visible name with a different destination
   // implementation (notably Rax/Kappa captain variants). Use the private root
   // alias recorded by the class-import plan for newly copied instances.
   const classAlias=(ops.classes||[]).filter(k=>k.from&&k.from.w===a.from.w)
    .flatMap(k=>k.variants||[]).find(v=>v.name===cname);
   const targetClassName=classAlias?classAlias.alias:cname,tcp=clsByName(targetClassName);
   if(tcp<0)throw'class '+targetClassName+' does not exist in '+wadName;
   for(let w=0;w<INS;w+=4)W(o+w,sU(so+w));
   const dd=[0,1,2].map(k=>a.p[k]-sF(so+0x10+4*k));for(let k=0;k<3;k++)WF(o+0x10+4*k,a.p[k]);
   W(o+0x28,tcp);addRel(o+0x28);W(o+0x38,idx);
   // init registers
   const ni=d.getUint16(tcp+0x18,true),sip=sU(so+0x2c),ip=alloc(4*Math.max(ni,1)),smap={};
   for(let r=0;r<ni;r++){const v=sU(sip+4*r);
    if(sRel.has(sip+4*r)){const s=siPrint(siCstr(sA,v));
     if(s!==null){const np=alloc(s.length+1,4);for(let c=0;c<s.length;c++)A[np+c]=s.charCodeAt(c);W(ip+4*r,np);addRel(ip+4*r)}
     else if(same&&!ownsEdit(v)){W(ip+4*r,v);addRel(ip+4*r)}else{let n;try{n=gcopy(sw,a.from.w,v)}catch(x){throw'prefab '+cname+' register '+r+' points into its own level data that cannot be copied: '+x}W(ip+4*r,n);addRel(ip+4*r)}}
    else W(ip+4*r,v)}
   W(o+0x2c,ip);addRel(o+0x2c);
   for(const[r,v]of Object.entries(a.regs||{})){if(!(+r<ni))throw'register '+r+' out of range';rel.delete(ip+4*r);W(ip+4*r,v)}
   applyAddedDataEdits(a,sw,same,sip,ip);
   const lkSet=new Set();   // registers rewired to other new instances (deep copy): a copied spawner links to its own copied children
   for(const[rg,cid]of(a.lk||[])){if(!(rg<ni))throw'link register '+rg+' out of range';const ci=idToIdx.get(cid);rel.delete(ip+4*rg);lkSet.add(rg);if(ci===undefined)W(ip+4*rg,0);else{W(ip+4*rg,ci);lk.push([idx,rg])}}
   for(let i=0;i<sNl;i++){const ow=sd.getUint16(sLnk+4*i,true),rg=sd.getUint16(sLnk+4*i+2,true);if(ow!==a.from.i||lkSet.has(rg))continue;
    if(same){lk.push([idx,rg]);const v=U(ip+4*rg);if(del.has(v))throw'prefab links to removed instance #'+v;if(map.has(v)&&map.get(v)!==v)W(ip+4*rg,map.get(v))}
    else if(a.regs&&a.regs[rg]!==undefined){lk.push([idx,rg]);const v=U(ip+4*rg);if(del.has(v))throw'prefab links to removed instance #'+v;if(map.has(v)&&map.get(v)!==v)W(ip+4*rg,map.get(v))}   // link picked by hand in the editor: an instance of THIS level
    else{rel.delete(ip+4*rg);W(ip+4*rg,0)}}   // another level's instance numbers mean nothing here: leave the link empty
   for(const rg0 of a.linkRegs||[]){const rg=+rg0;if(!Number.isInteger(rg)||rg<0||rg>=ni)throw'link register '+rg+' out of range';const v=U(ip+4*rg);if(del.has(v))throw'prefab links to removed instance #'+v;if(map.has(v)&&map.get(v)!==v)W(ip+4*rg,map.get(v));if(!lk.some(x=>x[0]===idx&&x[1]===rg)){lk.push([idx,rg]);lkChanged=true}}
   // path nodes (0x40 each; +0 prev, +4 next)
   const pn=sU(so+0x30);W(o+0x30,0);
   if(pn){const sn=pathNodes(sd,sU,pn),cur=sn.indexOf(pn),base=alloc(sn.length*0x40);
    sn.forEach((n,k)=>{const t=base+k*0x40;for(let w=0;w<0x40;w+=4)W(t+w,sU(n+w));
     W(t,k?base+(k-1)*0x40:0);W(t+4,k+1<sn.length?base+(k+1)*0x40:0);if(k)addRel(t);if(k+1<sn.length)addRel(t+4);
     for(let w=8;w<0x40;w+=4)if(sRel.has(n+w)){if(!same)throw'path node points into its own level data';addRel(t+w)}
     for(let q=0;q<3;q++)WF(t+8+4*q,sF(n+8+4*q)+dd[q])});
    W(o+0x30,base+Math.max(cur,0)*0x40);addRel(o+0x30)}
   if(a.path){const pos=a.p.slice();writePathOverride(o,a.path.map(n=>n.map((v,k)=>v+pos[k])),a.pathMap,false)}
   // shape record (0x20) + polygon vertices
   const sp=sU(so+0x34);W(o+0x34,0);
   if(sp){const t=alloc(0x20);for(let w=0;w<0x20;w+=4)W(t+w,sU(sp+w));const ty=sU(sp)&0xffff,cnt=sU(sp)>>>16,pp=sU(sp+4);
    for(let q=0;q<3;q++){WF(t+8+4*q,sF(sp+8+4*q)+dd[q]);WF(t+20+4*q,sF(sp+20+4*q)+dd[q])}
    if((ty==5||ty==6)&&cnt>=3&&pp&&sRel.has(sp+4)){const pv=alloc(12*cnt);for(let v=0;v<cnt;v++)for(let q=0;q<3;q++)WF(pv+12*v+4*q,sF(pp+12*v+4*q)+dd[q]);W(t+4,pv);addRel(t+4)}else W(t+4,0);
    W(o+0x34,t);addRel(o+0x34)}
   if(a.trigger)writeTriggerShape(o,a.trigger,a.p,U(o+0x34));
   rot(o,a.dy||0,a.dp||0,a.dr||0)});
  // links of existing instances to NEW instances picked by hand (the new instance's number is only known now)
  for(const[k,m]of Object.entries(mods)){if(!m.lk||!m.lk.length||del.has(+k))continue;const owner=map.get(+k),to=T+owner*INS,cp=U(to+0x28),nir=d.getUint16(cp+0x18,true),old=U(to+0x2c),np=alloc(4*Math.max(nir,1));
   for(let r=0;r<nir;r++){W(np+4*r,U(old+4*r));if(rel.has(old+4*r))addRel(np+4*r)}W(to+0x2c,np);addRel(to+0x2c);
   for(const[rg,cid]of m.lk){if(!(rg<nir))throw'link register '+rg+' out of range';const ci=idToIdx.get(cid);rel.delete(np+4*rg);W(np+4*rg,ci===undefined?0:ci);if(ci!==undefined&&!lk.some(x=>x[0]===owner&&x[1]===rg)){lk.push([owner,rg]);lkChanged=true}}}
  lk.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  W(h+0x28,T);d.setUint16(h+0x30,nn,true);
  if(lk.length!==nlk||(lkChanged&&lk.length)){const L=alloc(4*lk.length,4);lk.forEach(([ow,rg],i)=>{d.setUint16(L+4*i,ow,true);d.setUint16(L+4*i+2,rg,true)});W(h+0x2c,L);d.setUint16(h+0x32,lk.length,true)}}
 return{A:A.slice(0,len),B:mergeB(B0,newRel,gshim.newSpec)}}
// ---- rebuild a whole volume: replaced = {fileName: Uint8Array}; all other files are copied byte for byte. Returns Blob parts.
function rebuildVol(ab,replaced){const files=parseVol(ab),d=new DataView(ab),u8=new Uint8Array(ab),base=16+12*d.getUint32(d.byteOffset+8,true);
 const dir=u8.slice(0,files[0].off),dd=new DataView(dir.buffer),n=files.length,parts=[dir];let pos=files[0].off;
 for(let i=0;i<n;i++){const f=files[i],p=base+dd.getUint32(16+12*i+8,true),r=replaced[f.name];let size=f.size;
  if(r){size=r.length}
  dd.setUint32(p,pos%4294967296,true);dd.setUint32(p+4,Math.floor(pos/4294967296),true);dd.setUint32(p+8,size%4294967296,true);dd.setUint32(p+12,Math.floor(size/4294967296),true);
  const chunk=r||u8.subarray(f.off,f.off+f.size);parts.push(chunk);const pad=(Math.ceil((pos+size)/2048)*2048)-(pos+size);
  if(i<n-1&&pad)parts.push(new Uint8Array(pad));else if(i==n-1&&pad)parts.push(new Uint8Array(pad));pos=Math.ceil((pos+size)/2048)*2048}
 return parts}
// Rebuild a VOL/AVL while adding new named entries. Existing payloads are copied
// byte-for-byte unless explicitly replaced; the directory is re-sorted by the
// case-sensitive CRC32 filename hash used by the retail VOLT table.
function rebuildVolWithAdditions(ab,replaced={},additions={}){
 const files=parseVol(ab),d=new DataView(ab),u8=new Uint8Array(ab),count=d.getUint32(8,true),base=16+12*count;
 const crc32Name=name=>{let c=0xffffffff;for(let i=0;i<name.length;i++){let v=name.charCodeAt(i)&255;c^=v;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0)}return(c^0xffffffff)>>>0};
 const normalizeMap=(source,label)=>{const out=new Map();for(const [key,value] of Object.entries(source||{})){const name=String(key);if(!name||name.includes('\0'))throw label+' contains an invalid filename';const lower=name.toLowerCase();if(out.has(lower))throw label+' contains duplicate filename '+name;out.set(lower,{name,value})}return out};
 const replaceMap=normalizeMap(replaced,'replacement set'),addMap=normalizeMap(additions,'addition set');
 const entries=[];
 for(let i=0;i<files.length;i++){
  const f=files[i],entryPos=16+12*i;
  const replace=replaceMap.get(f.name.toLowerCase());
  entries.push({name:f.name,hash:d.getUint32(entryPos,true),flags:d.getUint32(entryPos+4,true),data:replace?toBytes(replace.value):u8.subarray(f.off,f.off+f.size),source:f});
  if(replace)replaceMap.delete(f.name.toLowerCase());
 }
 if(replaceMap.size)throw'replacement target(s) not found in volume: '+[...replaceMap.values()].map(x=>x.name).join(', ');
 for(const item of addMap.values()){
  if(files.some(f=>f.name.toLowerCase()===item.name.toLowerCase()))throw'cannot add '+item.name+': that filename already exists in the volume';
  const data=toBytes(item.value);if(!data.length)throw'cannot add '+item.name+': empty payloads are not supported';
  entries.push({name:item.name,hash:crc32Name(item.name),flags:1,data,source:null});
 }
 entries.sort((a,b)=>a.hash-b.hash||a.name.localeCompare(b.name));
 for(let i=1;i<entries.length;i++)if(entries[i-1].hash===entries[i].hash)throw'VOL filename CRC32 collision between '+entries[i-1].name+' and '+entries[i].name;
 const newBase=16+12*entries.length,descriptorBytes=entries.reduce((n,e)=>n+16+e.name.length+1,0),descriptorEnd=newBase+descriptorBytes;
 const oldDataStart=files.length?Math.min(...files.map(f=>f.off)):2048,dataStart=Math.max(oldDataStart,Math.ceil(descriptorEnd/2048)*2048);
 if(!Number.isSafeInteger(dataStart)||dataStart<descriptorEnd)throw'VOL directory size is outside the supported range';
 const directory=new Uint8Array(dataStart),dv=new DataView(directory.buffer);directory.set(u8.subarray(0,16));dv.setUint32(8,entries.length,true);
 // VOLT header +0x0C stores the byte length of the filename-descriptor area
 // (the sum of each descriptor's 16-byte range tuple plus NUL-terminated name).
 // Keeping the source value here makes every archive with additions internally
 // inconsistent even though the directory can still be parsed by this editor.
 // Both retail 30.vol and 30.avl confirm this field equals descriptorBytes.
 dv.setUint32(12,descriptorBytes,true);
 const parts=[directory];let descPos=newBase,payloadPos=dataStart;
 for(let i=0;i<entries.length;i++){
  const e=entries[i],table=16+i*12,size=e.data.length;
  if(!Number.isSafeInteger(payloadPos+size))throw'VOL payload offsets exceed the safe integer range';
  dv.setUint32(table,e.hash,true);dv.setUint32(table+4,e.flags>>>0,true);dv.setUint32(table+8,descPos-newBase,true);
  dv.setUint32(descPos,payloadPos>>>0,true);dv.setUint32(descPos+4,Math.floor(payloadPos/4294967296),true);
  dv.setUint32(descPos+8,size>>>0,true);dv.setUint32(descPos+12,Math.floor(size/4294967296),true);
  for(let j=0;j<e.name.length;j++)directory[descPos+16+j]=e.name.charCodeAt(j)&255;
  directory[descPos+16+e.name.length]=0;descPos+=16+e.name.length+1;
  parts.push(e.data);const next=Math.ceil((payloadPos+size)/2048)*2048,pad=next-(payloadPos+size);if(pad)parts.push(new Uint8Array(pad));payloadPos=next;
 }
 return parts;
}
function toBytes(value){if(value instanceof Uint8Array)return value;if(value instanceof ArrayBuffer)return new Uint8Array(value);if(ArrayBuffer.isView(value))return new Uint8Array(value.buffer,value.byteOffset,value.byteLength);throw new TypeError('VOL payload must be bytes')}
// instances whose link registers point at instance idx
function referrers(A,B,idx){const imp=fixups(B),h=(imp[0x8000010e]||[])[0];if(h==null)return[];const d=new DataView(A.buffer,A.byteOffset,A.length),U=o=>d.getUint32(o,true),ins=U(h+0x28),lnk=U(h+0x2c),nl=d.getUint16(h+0x32,true),out=new Set();
 for(let i=0;i<nl;i++){const ow=d.getUint16(lnk+4*i,true),rg=d.getUint16(lnk+4*i+2,true),ip=U(ins+ow*INS+0x2c);if(ow!==idx&&U(ip+4*rg)===idx)out.add(ow)}return[...out]}
// ops.classes=[{from:{w,name},variants:[{name,alias}]}]: copy source-specific same-name dependencies
// under private aliases so importing one level's class cannot silently bind to a different
// implementation/resource set already present in the destination.
function patchLcs(A0,B0,ops,wadName,srcWad,env){
 for(const k of ops.classes||[]){const sw=k.from.w===wadName?{A:A0,B:B0}:srcWad(k.from.w);if(!sw)throw'class source '+k.from.w+' not found';const S=SrcCtx(sw.A,sw.B);S.wadName=k.from.w;
  const tc=new Map(siWad(A0,B0).classes.map(c=>[c.name,c.off])),variants=k.variants||[],aliases=Object.fromEntries(variants.map(v=>[v.name,v.alias]));
  const names=[];if(!tc.has(k.from.name))names.push(k.from.name);
  for(const v of variants)if(!tc.has(v.alias))names.push(v.name);
  if(!names.length)continue;   // root and all recorded source variants are already present
  const T=SrcCtx(A0,B0),cls=n=>(aliases[n]&&tc.has(aliases[n])?tc.get(aliases[n]):tc.get(n));
  const preserveExternalEvents=k.preserveExternalEvents==null?k.from.w.toLowerCase()===wadName.toLowerCase():!!k.preserveExternalEvents;
  const r=transplantClasses(A0,B0,S,names,{res:resResolver(S,T).hook,cls,addRes:true,snd:env&&env.snd},{allowDup:variants.length>0,aliases,preserveExternalEvents});A0=r.A;B0=r.B}
 return patchLcs0(A0,B0,ops,wadName,srcWad,env)}

// Stage 1 native custom-model writer. It imports only the embedded 32-bit TGA
// resources from project assets. No mesh, render part, model descriptor, STRAT
// class, STRAT instance, collision data or audio data is created or changed.
function patchCustomTextures(A0,B0,wadName,record){
 const assets=Array.isArray(record&&record.assets)?record.assets:[];
 if(!assets.length)return{A:A0,B:B0,added:{assets:0,textures:0,bytes:0},textures:[]};
 const imp=fixups(B0),texOffsets=imp[0x80000001]||[],d0=new DataView(A0.buffer,A0.byteOffset,A0.byteLength),U0=o=>d0.getUint32(o,true);
 const candidates=texOffsets.filter(t=>t>=0&&t+0x20<=A0.length&&imp.rel.has(t+0x10));
 const template=candidates.find(t=>{
  const rels=[...imp.rel].filter(p=>p>=t&&p<t+0x20).map(p=>p-t);
  if(rels.length!==1||rels[0]!==0x10)return false;
  const img=parseTga(A0,t);
  return !!img&&U0(t+4)===img.w&&U0(t+8)===img.h&&U0(t+24)===1;
 });
 if(template==null)throw wadName+': no valid native kind-1 texture resource template was found';
 const bld=Builder(A0,B0),W=bld.W,cache=new Map(),added=[],sameBytes=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
 let importedBytes=0;
 for(let ai=0;ai<assets.length;ai++){
  const asset=assets[ai];
  if(!asset||typeof asset.bundle!=='string')throw wadName+': custom model asset '+(asset&&asset.name||ai)+' has no stored .inimodel bundle';
  let data;
  try{data=parseIninjaModelTextures(base64ToBytes(asset.bundle))}
  catch(e){throw wadName+': texture import for '+(asset.name||'asset '+ai)+' failed: '+(e&&e.message||e)}
  for(const material of data.materials){
   if(!material.texture)continue;
   const tga=data.textures.get(material.texture);
   if(!tga)throw wadName+': missing texture '+material.texture+' in '+(asset.name||'asset '+ai);
   const hash=fnv(tga),key=hash+':'+tga.length;
   let resource=(cache.get(key)||[]).find(x=>sameBytes(x.bytes,tga));
   if(resource){resource.users++;continue}
   const w=tga[12]|tga[13]<<8,h=tga[14]|tga[15]<<8;
   const textureOff=bld.alloc(0x20,16),dataOff=bld.alloc(tga.length,16);
   bld.A.set(A0.subarray(template,template+0x20),textureOff);
   bld.A.set(tga,dataOff);
   W(textureOff+4,w);W(textureOff+8,h);W(textureOff+0x10,dataOff);W(textureOff+0x14,tga.length);W(textureOff+0x18,1);
   const rels=[];bld.addRelTo(rels,textureOff+0x10);bld.addSpec(1,textureOff,rels);
   resource={bytes:tga,offset:textureOff,width:w,height:h,byteLength:tga.length,users:1,assetId:asset.id||null,assetName:asset.name||data.manifest.name||'Imported model',materialName:material.name,textureName:material.texture};
   const bucket=cache.get(key)||[];bucket.push(resource);cache.set(key,bucket);added.push(resource);importedBytes+=tga.length;
  }
 }
 if(!added.length)return{A:A0,B:B0,added:{assets:assets.length,textures:0,bytes:0},textures:[]};
 const out=bld.finish();
 return{A:out.A,B:out.B,added:{assets:assets.length,textures:added.length,bytes:importedBytes},textures:added.map(({bytes,...x})=>x)};
}

// Stage 2 diagnostic: add one native custom render graph and redirect an
// existing visual Strat_SetModel table. No STRAT class or instance is added.
function patchCustomModelVisual(A0,B0,wadName,record){
 const assets=Array.isArray(record&&record.assets)?record.assets:[];
 if(!assets.length)throw wadName+': import a .inimodel asset before building Stage 2';
 if(assets.length!==1)throw wadName+': Stage 2 currently accepts exactly one imported custom-model asset';
 const asset=assets[0];
 if(!asset||typeof asset.bundle!=='string')throw wadName+': the Stage 2 asset has no stored .inimodel bundle';
 const w=siWad(A0,B0);if(!w)throw wadName+': Stage 2 needs a PC STRAT level';
 const targetClass=w.classes.find(c=>c.name==='SavePointTop');
 if(!targetClass)throw wadName+': SavePointTop class was not found';
 const az=new SiAn(w);
 // The SavePointTop entry establishes the ordinary visual model. Its event
 // handlers include unrelated animated model swaps, which Stage 2 must leave alone.
 siClass(az,targetClass,[]);
 const modelRefs=az.modelRefs.filter(r=>r.cls==='SavePointTop'&&r.native==='Strat_SetModel');
 if(modelRefs.length!==1)throw wadName+': expected exactly one ordinary Strat_SetModel table in SavePointTop; found '+modelRefs.length;
 const targetTable=modelRefs[0].table,baseImp=fixups(B0);
 if(!baseImp.rel.has(targetTable))throw wadName+': SavePointTop model table is not in the relocation stream';
 const targetDescriptor=new DataView(A0.buffer,A0.byteOffset,A0.byteLength).getUint32(targetTable,true);
 if(!targetDescriptor||targetDescriptor>=A0.length)throw wadName+': SavePointTop currently references an invalid visual descriptor';
 // Use the same complete one-part debug graph as the confirmed test-37 path.
 const parts=new Set(baseImp[0x80000021]||[]),meshes=new Set(baseImp[0x80000024]||[]),textures=new Set(baseImp[0x80000001]||[]);
 const d0=new DataView(A0.buffer,A0.byteOffset,A0.byteLength),U0=o=>d0.getUint32(o,true);
 const relOffsets=(o,n)=>[...baseImp.rel].filter(x=>x>=o&&x<o+n).map(x=>x-o).sort((a,b)=>a-b);
 const sameOffsets=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
 const exactRelLayout=(o,n,want)=>o>=0&&o+n<=A0.length&&sameOffsets(relOffsets(o,n),want);
 const candidates=(parseModels(A0,B0).modelGroups||[]).filter(g=>g.kind==='model'&&Number.isInteger(g.descriptor)&&Array.isArray(g.parts)&&g.parts.length===1)
  .sort((a,b)=>(Number(b.name==='debug')-Number(a.name==='debug'))||a.descriptor-b.descriptor);
 let template=null;
 for(const g of candidates){
  const desc=g.descriptor,part=g.parts[0].p,mesh=g.parts[0].m;
  if(!parts.has(part)||!meshes.has(mesh)||!baseImp.rel.has(desc)||U0(desc)!==part)continue;
  const texture=U0(part+0x10);
  if(!textures.has(texture)||!baseImp.rel.has(part+0x10)||U0(part+0x34)!==1)continue;
  const offsets=[0x20,0x28,0x30,0x38],blocks=offsets.map(k=>U0(part+k));
  if(blocks.some((v,i)=>!v||!baseImp.rel.has(part+offsets[i])))continue;
  const [data20,data90,data24,meta]=blocks;
  if(U0(meta+0x0c)!==desc||U0(meta+0x48)!==mesh||!baseImp.rel.has(meta+0x4c))continue;
  const layouts=[[desc,0x70,[0,0x54]],[part,0x50,[0x0c,0x10,0x20,0x28,0x30,0x38]],[data20,0x20,[]],[data90,0x90,[]],[data24,0x24,[]],[meta,0x60,[0x0c,0x48,0x4c,0x5c]],[mesh,0x30,[0x10,0x18]],[texture,0x20,[0x10]]];
  if(layouts.some(([o,n,r])=>!exactRelLayout(o,n,r)))continue;
  const auxPart=U0(desc+0x54),auxMeta=U0(meta+0x5c);
  if(!auxPart||auxPart>=A0.length||!auxMeta||auxMeta>=A0.length)continue;
  template={name:g.name,desc,part,blocks,mesh,texture};break;
 }
 if(!template||template.name!=='debug')throw wadName+': the complete validated debug render template is unavailable';
 let data;
 try{data=parseIninjaModelBundle(base64ToBytes(asset.bundle))}catch(e){throw wadName+': could not read '+(asset.name||'custom model')+': '+(e&&e.message||e)}
 const manifest=data.manifest;
 if(data.meshes.length!==1||data.materials.length!==1)throw wadName+': Stage 2 currently supports exactly one mesh and one material';
 const mesh=data.meshes[0],material=data.materials[0];
 if(mesh.material!==0)throw wadName+': the custom mesh must use material slot 1';
 if(material.alphaMode!=='OPAQUE')throw wadName+': Stage 2 only supports OPAQUE materials';
 if(manifest.collision.type!=='none')throw wadName+': set Collision Type to None for this visual-only stage';
 const makeStrip=indices=>{
  if(indices.length<3||indices.length%3)throw wadName+': mesh index buffer must contain complete triangles';
  const out=[indices[0],indices[1],indices[2]];
  for(let t=3;t<indices.length;t+=3){const a=indices[t],b=indices[t+1],c=indices[t+2],last=out[out.length-1],odd=((out.length+2)&1)!==0;out.push(last,odd?b:a,odd?b:a,odd?a:b,c)}
  return Uint16Array.from(out);
 };
 const srgbToLinear=x=>{x=Math.max(0,Math.min(1,x));return x<=0.04045?x/12.92:Math.pow((x+0.055)/1.055,2.4)};
 const linearToSrgb=x=>{x=Math.max(0,Math.min(1,x));return x<=0.0031308?12.92*x:1.055*Math.pow(x,1/2.4)-0.055};
 const bakeTexture=(d,mat)=>{
  let bytes;
  if(mat.texture){bytes=d.textures.get(mat.texture);if(!bytes)throw wadName+': model texture '+mat.texture+' is missing from the bundle';bytes=bytes.slice();if(bytes[2]!==2||bytes[16]!==32)throw wadName+': Stage 2 needs a 32-bit truecolour TGA'}
  else{bytes=new Uint8Array(18+4*4*4);bytes[2]=2;bytes[12]=4;bytes[14]=4;bytes[16]=32;for(let p=18;p<bytes.length;p+=4)bytes.set([255,255,255,255],p)}
  const idEnd=18+bytes[0],tw=bytes[12]|(bytes[13]<<8),th=bytes[14]|(bytes[15]<<8),factor=mat.baseColor||[1,1,1,1];
  if(bytes.length<idEnd+tw*th*4)throw wadName+': model TGA data is truncated';
  for(let p=idEnd;p<idEnd+tw*th*4;p+=4){bytes[p]=Math.round(linearToSrgb(srgbToLinear(bytes[p]/255)*factor[2])*255);bytes[p+1]=Math.round(linearToSrgb(srgbToLinear(bytes[p+1]/255)*factor[1])*255);bytes[p+2]=Math.round(linearToSrgb(srgbToLinear(bytes[p+2]/255)*factor[0])*255);bytes[p+3]=Math.round(bytes[p+3]*factor[3])}
  return bytes.subarray(0,idEnd+tw*th*4);
 };
 const bld=Builder(A0,B0),W=bld.W,copy=(src,n)=>{const p=bld.alloc(n,16);bld.A.set(A0.subarray(src,src+n),p);return p};
 const desc=copy(template.desc,0x70),part=copy(template.part,0x50),data20=copy(template.blocks[0],0x20),data90=copy(template.blocks[1],0x90),data24=copy(template.blocks[2],0x24),meta=copy(template.blocks[3],0x60),meshOff=copy(template.mesh,0x30),texOff=copy(template.texture,0x20);
 const strip=makeStrip(mesh.indices),vertexCount=mesh.vertexCount,indexCount=strip.length;
 if(!vertexCount||vertexCount>65535||indexCount<3)throw wadName+': custom mesh has invalid vertex/index counts';
 const vertexOff=bld.alloc(vertexCount*0x20,16),indexOff=bld.alloc(indexCount*2,2),textureData=bakeTexture(data,material),tgaOff=bld.alloc(textureData.length,16);
 bld.A.set(textureData,tgaOff);
 const vd=new DataView(bld.A.buffer);
 for(let v=0;v<vertexCount;v++){
  const p=vertexOff+v*0x20;
  // Test 37: native Z reflection for positions/normals, V flip, original triangle order.
  vd.setFloat32(p,mesh.positions[v*3],true);vd.setFloat32(p+4,mesh.positions[v*3+1],true);vd.setFloat32(p+8,-mesh.positions[v*3+2],true);
  vd.setFloat32(p+12,mesh.normals[v*3],true);vd.setFloat32(p+16,mesh.normals[v*3+1],true);vd.setFloat32(p+20,-mesh.normals[v*3+2],true);
  vd.setFloat32(p+24,mesh.uvs[v*2],true);vd.setFloat32(p+28,1-mesh.uvs[v*2+1],true);
 }
 for(let i=0;i<indexCount;i++)vd.setUint16(indexOff+2*i,strip[i],true);
 W(desc,part);bld.addRel(desc);bld.addRel(desc+0x54);bld.A.fill(0,desc+0x20,desc+0x30);bld.A.set(new TextEncoder().encode('INI_SUZANNE'),desc+0x20);
 W(part+0x0c,meshOff);W(part+0x10,texOff);W(part+0x20,data20);W(part+0x28,data90);W(part+0x30,data24);W(part+0x38,meta);
 const partRels=[];for(const o of [part+0x0c,part+0x10,part+0x20,part+0x28,part+0x30,part+0x38])bld.addRelTo(partRels,o);
 W(meta,5);W(meta+4,vertexCount);W(meta+8,indexCount-2);W(meta+12,desc);W(meta+0x20,0);W(meta+0x24,0);W(meta+0x48,meshOff);W(meta+0x4c,texOff);
 bld.addRel(meta+12);bld.addRel(meta+0x48);bld.addRel(meta+0x4c);bld.addRel(meta+0x5c);
 W(meshOff+4,0x23);W(meshOff+8,0x20);W(meshOff+12,vertexCount);W(meshOff+16,vertexOff);W(meshOff+20,indexCount);W(meshOff+24,indexOff);
 const meshRels=[];bld.addRelTo(meshRels,meshOff+16);bld.addRelTo(meshRels,meshOff+24);
 const tw=textureData[12]|textureData[13]<<8,th=textureData[14]|textureData[15]<<8;
 W(texOff+4,tw);W(texOff+8,th);W(texOff+16,tgaOff);W(texOff+20,textureData.length);W(texOff+24,1);const textureRels=[];bld.addRelTo(textureRels,texOff+16);
 bld.addSpec(1,texOff,textureRels);bld.addSpec(0x24,meshOff,meshRels);bld.addSpec(0x21,part,partRels);
 // Replace only SavePointTop's normal visual-model pointer. Collision references stay untouched.
 W(targetTable,desc);bld.addRel(targetTable);
 const built=bld.finish();
 return{A:built.A,B:built.B,added:{models:1,textures:1,meshes:1,parts:1},templateName:template.name,modelName:'INI_SUZANNE',targetClass:'SavePointTop',targetTable,oldDescriptor:targetDescriptor,newDescriptor:desc,vertexCount,indexCount,textureWidth:tw,textureHeight:th};
}


// Convert a copied, compatible STRAT class into a minimal static custom-model
// class. The supplied descriptor must already exist in this LCS. The verified
// template entry begins with `mov rN, &modelTable; Strat_SetModel(rN)`. Keep
// those instructions and the relocated table slot, redirect the slot to the
// new descriptor, then replace the next two one-word slots with the in-game-
// confirmed persistent WAIT(0) -> JMP WAIT(0) idle loop. A class entry must
// remain alive; returning directly from it caused the earlier Stage 4 crash.
// This avoids inventing a new native-call encoding or pointer-table format.
function patchCustomModelStaticScript(A0,B0,wadName,className,modelDescriptor,expectedModelName=null){
 if(!Number.isInteger(modelDescriptor)||modelDescriptor<=0||modelDescriptor>=A0.length)
  throw wadName+': the custom static-model descriptor is outside the level data';
 const w0=siWad(A0,B0);if(!w0)throw wadName+': static custom-model scripting needs a PC STRAT level';
 const c0=w0.classes.find(c=>c.name===className);if(!c0)throw wadName+': private STRAT class '+className+' was not found';
 if(c0.ninit!==0)throw wadName+': '+className+' has static variables; refusing the minimal static script';
 if(c0.events.some(([,handler])=>handler!==0))throw wadName+': '+className+' has event handlers; explicitly support them before making a static prop';
 const imp=fixups(B0),dv0=new DataView(A0.buffer,A0.byteOffset,A0.byteLength),U0=o=>dv0.getUint32(o,true);
 if(expectedModelName){
  const groups=parseModels(A0,B0).modelGroups||[];
  const modelGroup=groups.find(g=>g.descriptor===modelDescriptor&&g.kind==='model'&&g.name===expectedModelName);
  if(!modelGroup)throw wadName+': descriptor 0x'+modelDescriptor.toString(16)+' is not the expected custom model graph ('+expectedModelName+')';
 }else{
  // In the normal project build the new descriptor is intentionally not
  // referenced by a script until this function redirects the cloned class'
  // model table. Validate its native descriptor/part/mesh/texture graph
  // directly rather than requiring parseModels to discover class ownership yet.
  const part=U0(modelDescriptor),tex=part&&U0(part+0x10),mesh=part&&U0(part+0x0c),meta=part&&U0(part+0x38);
  if(!imp.rel.has(modelDescriptor)||!(imp[0x80000021]||[]).includes(part)||!tex||!(imp[0x80000001]||[]).includes(tex)||!mesh||!(imp[0x80000024]||[]).includes(mesh)||!meta||!imp.rel.has(part+0x0c)||!imp.rel.has(part+0x10)||!imp.rel.has(part+0x38)||U0(meta+0x0c)!==modelDescriptor||U0(meta+0x48)!==mesh||U0(meta+0x4c)!==tex)
   throw wadName+': descriptor 0x'+modelDescriptor.toString(16)+' is not a complete registered custom render graph';
 }
 const az=new SiAn(w0);siClass(az,c0,[]);
 const refs=az.modelRefs.filter(r=>r.cls===className&&r.native==='Strat_SetModel');
 if(refs.length!==1)throw wadName+': '+className+' must have exactly one Strat_SetModel table; found '+refs.length;
 const ref=refs[0],modelCall=az.ins.get(ref.call),modelLoad=modelCall&&az.ins.get(modelCall.off-8);
 if(!modelCall||modelCall.mn!=='native'||modelCall.form!=='nat_b'||modelCall.size!==2||az.native(modelCall)[0]!=='Strat_SetModel')
  throw wadName+': '+className+' does not use the supported two-word Strat_SetModel native call';
 if(!modelLoad||modelLoad.off!==c0.entry||modelLoad.mn!=='mov'||modelLoad.form!=='ri32'||modelLoad.a!==modelCall.b||!imp.rel.has(modelLoad.off+4))
  throw wadName+': '+className+' does not begin with the supported relocated model-table load';
 if(ref.table!==new DataView(A0.buffer,A0.byteOffset,A0.byteLength).getUint32(modelLoad.off+4,true))
  throw wadName+': the script load and model-reference analysis disagree about the model table';
 // The bundled static template intentionally stores an empty model table.
 // Add the descriptor-slot relocation when we first populate it.
 const outputB=imp.rel.has(ref.table)?B0:mergeB(B0,[ref.table],[]);
 const block=w0.blocks.find(([p,n])=>p<=c0.entry&&c0.entry<p+4*n);
 if(!block||block[0]+8!==c0.entry)throw wadName+': '+className+' entry is not at the start of a complete code block';
 const idleWaitOff=modelCall.off+4*modelCall.size;
 const idleJumpOff=idleWaitOff+4;
 const waitSlot=az.ins.get(idleWaitOff),jumpSlot=az.ins.get(idleJumpOff);
 // A STRAT entry is a persistent VM script. The previously tested RET
 // terminates a call frame, but a class entry is not a called subroutine.
 // Reuse two one-word instructions in the private code block for the native
 // game's ordinary WAIT(0) + JMP loop, yielding once per frame indefinitely.
 if(!waitSlot||waitSlot.off!==idleWaitOff||waitSlot.size!==1||!jumpSlot||jumpSlot.off!==idleJumpOff||jumpSlot.size!==1)
  throw wadName+': '+className+' has no two safe one-word instruction slots after Strat_SetModel for the idle loop';
 if(idleJumpOff+4>block[0]+4*block[1]-8)
  throw wadName+': '+className+' does not have enough private code-block space for the idle loop';
 if(imp.rel.has(idleWaitOff)||imp.rel.has(idleJumpOff))
  throw wadName+': idle-loop instruction slots unexpectedly contain relocations';
 // No other class entry may enter the middle of the cloned private block.
 if(w0.classes.some(c=>c.name!==className&&c.entry>=block[0]+8&&c.entry<block[0]+4*block[1]-8))
  throw wadName+': '+className+' shares its entry-code block with another class';
 const waitWord=0x47000000; // Existing native WAIT(0) encoding used by the source game scripts.
 const jumpDeltaWords=(idleWaitOff-(idleJumpOff+4))/4;
 if(!Number.isInteger(jumpDeltaWords)||jumpDeltaWords< -32768||jumpDeltaWords>32767)
  throw wadName+': idle-loop jump is outside the SI j16 range';
 const jumpWord=(120<<24)|(jumpDeltaWords&0xffff); // JMP back to WAIT(0).
 const A=A0.slice(),dv=new DataView(A.buffer,A.byteOffset,A.byteLength);
 const oldDescriptor=dv.getUint32(ref.table,true);
 dv.setUint32(ref.table,modelDescriptor,true);
 dv.setUint32(idleWaitOff,waitWord,true);
 dv.setUint32(idleJumpOff,jumpWord,true);
 const checkWad=siWad(A,outputB),checkClass=checkWad.classes.find(c=>c.name===className);
 const checkAz=new SiAn(checkWad);siClass(checkAz,checkClass,[]);
 const waitIns=checkAz.ins.get(idleWaitOff),jumpIns=checkAz.ins.get(idleJumpOff);
 if(!waitIns||waitIns.mn!=='wait'||waitIns.form!=='w_i8'||!jumpIns||jumpIns.mn!=='jmp'||jumpIns.targets[0]!==idleWaitOff)
  throw wadName+': idle script does not form a valid WAIT(0) -> JMP -> WAIT(0) loop';
 const reached=checkAz.reach([checkClass.entry])[0];
 if(reached.length!==4||reached[0]!==checkClass.entry||reached[1]!==modelCall.off||reached[2]!==idleWaitOff||reached[3]!==idleJumpOff)
  throw wadName+': static entry did not reduce to model-load, Strat_SetModel and a WAIT/JMP idle loop';
 if(checkAz.modelRefs.filter(r=>r.cls===className&&r.native==='Strat_SetModel').length!==1)
  throw wadName+': the new static script no longer resolves its Strat_SetModel table';
 if(!fixups(outputB).rel.has(ref.table)||dv.getUint32(ref.table,true)!==modelDescriptor)
  throw wadName+': custom model table relocation was not preserved';
 return{A,B:outputB,className,modelTable:ref.table,oldDescriptor,newDescriptor:modelDescriptor,entry:checkClass.entry,modelCall:modelCall.off,idleWaitOff,idleJumpOff,reachable:reached};
}

// Self-contained native custom-model templates. These tiny STRAT WADs are
// sanitised copies of the previously validated retail script layouts; the
// complete one-part PC render-resource graph is bundled separately.
const CUSTOM_MODEL_BUILTINS=Object.freeze({
 static:'@builtin/ininja-static-model-template',
 collision:'@builtin/ininja-collision-model-template',
 render:'@builtin/ininja-render-graph-template'
});
const GENERIC_COLLISION_BUILTIN='@builtin/ininja-generic-collision-template';
const GENERIC_COLLISION_CLASS='INIGenericCollision';
const GENERIC_COLLISION_ALIAS_BASE='INIEditorGenericCollision';
const GENERIC_COLLISION_SOURCE_CLASS='INICollision_Template';
const customModelBuiltinCache=new Map();
function getCustomModelBuiltin(kind){
 const key=CUSTOM_MODEL_BUILTINS[kind];if(!key)throw'unknown bundled custom-model template '+kind;
 if(customModelBuiltinCache.has(kind))return customModelBuiltinCache.get(kind);
 const pair=kind==='static'?[staticModelTemplateA,staticModelTemplateB]:kind==='collision'?[collisionModelTemplateA,collisionModelTemplateB]:[renderTemplateA,renderTemplateB];
 const A=base64ToBytes(pair[0]),B=base64ToBytes(pair[1]),w=siWad(A,B);
 if(!w)throw'embedded '+kind+' custom-model template is not a valid PC STRAT WAD';
 const value={A,B,w,name:key};customModelBuiltinCache.set(kind,value);return value;
}
function removeRelocationRecord(B0,offset){
 const dv=new DataView(B0.buffer,B0.byteOffset,B0.byteLength),words=[];let i=0,expectImportLocation=false;
 while(i+4<=B0.length){const value=dv.getUint32(i,true);i+=4;if(expectImportLocation){words.push(value);expectImportLocation=false;continue;}if(value>=0x80000000){words.push(value);expectImportLocation=true;continue;}if(value!==offset)words.push(value)}
 const out=new Uint8Array(words.length*4),od=new DataView(out.buffer);words.forEach((value,index)=>od.setUint32(index*4,value,true));return out;
}
function rebuildNativeCallChain(A,B,blockOff){
 const wad=siWad(A,B);if(!wad)throw'cannot rebuild a native-call chain in an invalid STRAT WAD';
 const block=wad.blocks.find(([off])=>off===blockOff);if(!block)throw'native-call chain code block @0x'+blockOff.toString(16)+' was not found';
 const az=new SiAn(wad),blockEnd=blockOff+block[1]*4;
 const operands=[...az.ins.values()].filter(ins=>ins.off>=blockOff&&ins.off<blockEnd&&(ins.mn==='native'||ins.mn==='native_y')).map(ins=>ins.off+4).sort((a,b)=>a-b);
 if(!operands.length)throw'generic collision code block has no native calls';
 const dv=new DataView(A.buffer,A.byteOffset,A.byteLength),U=o=>dv.getUint32(o,true),W=(o,v)=>dv.setUint32(o,v>>>0,true);
 W(blockOff,(operands[0]-blockOff)/4);
 operands.forEach((off,index)=>{const next=index+1<operands.length?(operands[index+1]-off)/4:0xffff;W(off,(U(off)&0xffff0000)|next)});
 // Validate the linked walk, not merely the linear disassembly.
 const seen=[],expected=new Set(operands);let cursor=blockOff+U(blockOff)*4;
 for(let guard=0;guard<=operands.length;guard++){
  if(!expected.has(cursor)||seen.includes(cursor))throw'native-call chain leaves the decoded native operands or loops at @0x'+cursor.toString(16);
  seen.push(cursor);const delta=U(cursor)&0xffff;if(delta===0xffff)break;cursor+=delta*4;
 }
 if(seen.length!==operands.length||seen.some((off,index)=>off!==operands[index]))throw'native-call chain does not cover every native call in code order';
 return{A,B,nativeOperands:operands};
}
function getGenericCollisionBuiltin(){
 const cacheKey='genericCollision';if(customModelBuiltinCache.has(cacheKey))return customModelBuiltinCache.get(cacheKey);
 const base=getCustomModelBuiltin('collision');let A=base.A.slice(),B=base.B.slice();let wad=siWad(A,B);
 const c=wad&&wad.classes.find(x=>x.name===GENERIC_COLLISION_SOURCE_CLASS),ci=c&&wad.classes.indexOf(c),ii=wad&&wad.instances.findIndex(x=>x.cls===ci);
 if(!c||ii<0)throw'embedded collision template is missing its class or instance shell';
 const sourceInstance=wad.instances[ii],dv=new DataView(A.buffer,A.byteOffset,A.byteLength),U=o=>dv.getUint32(o,true),W=(o,v)=>dv.setUint32(o,v>>>0,true),H=(o,v)=>dv.setUint16(o,v,true);
 if(c.events.length!==2||c.events[0][0]!==0x00b50008||c.events[1][0]!==0x00b60008||c.events.some(([,handler])=>!handler))throw'embedded collision template does not have the verified two event slots';
 const originalEntry=c.entry,entryCallOffset=originalEntry+8,entryCall=new SiAn(wad).ins.get(entryCallOffset);
 if(!entryCall||entryCall.mn!=='native'||entryCall.form!=='nat_b'||new SiAn(wad).native(entryCall)?.[0]!=='Strat_SetModelCollide')throw'embedded collision template entry does not contain the expected Strat_SetModelCollide call';
 const pool=U(c.off+0x20),namePtr=U(c.off+4),oldName=siCstr(A,namePtr),genericBytes=new TextEncoder().encode(GENERIC_COLLISION_CLASS);
 if(namePtr!==pool+0x19||!oldName||genericBytes.length>oldName.length)throw'embedded collision template cannot preserve its required pool/name layout';
 // Retain the template's Heartbeat prefix and exact +0x19 name placement.
 A.fill(0,namePtr,namePtr+oldName.length+1);A.set(genericBytes,namePtr);
 // r0 carries each instance's {model descriptor, CollMesh} table. The old
 // literal MOV+r2 table load becomes unreachable, and its relocation is removed.
 W(originalEntry+4,0);const nativeWord=U(entryCallOffset);W(entryCallOffset,nativeWord&0xffff00ff);W(c.off+8,entryCallOffset);H(c.off+0x18,3);
 B=removeRelocationRecord(B,originalEntry+4);if(fixups(B).rel.has(originalEntry+4))throw'generic collision template retained its obsolete literal-table relocation';
 // Supply a real three-register instance init block in the bundled source WAD:
 // r0 is filled per placement, r1 is 100%, and r2 disables ground probing.
 const initOff=(A.length+3)&~3,nextA=new Uint8Array(initOff+12);nextA.set(A);const idv=new DataView(nextA.buffer);
 idv.setUint32(initOff,0,true);idv.setUint32(initOff+4,0x42c80000,true);idv.setUint32(initOff+8,0,true);
 idv.setUint32(sourceInstance.off+0x2c,initOff,true);A=nextA;
 if(!fixups(B).rel.has(sourceInstance.off+0x2c))throw'generic collision instance template has no init-array relocation';
 wad=siWad(A,B);const rebuiltClass=wad.classes.find(x=>x.name===GENERIC_COLLISION_CLASS),blockOff=rebuiltClass&&wad.U(rebuiltClass.off+0x0c);
 if(!rebuiltClass||rebuiltClass.ninit!==3||rebuiltClass.entry!==entryCallOffset)throw'generic collision source template failed register/entry rewrite';
 const chain=rebuildNativeCallChain(A,B,blockOff);A=chain.A;B=chain.B;wad=siWad(A,B);
 const finalClass=wad.classes.find(x=>x.name===GENERIC_COLLISION_CLASS),az=new SiAn(wad);siClass(az,finalClass,finalClass.events.map(([key,handler],i)=>[i,key,handler]));
 const call=az.ins.get(finalClass.entry),init=wad.instances[ii].init,fd=new DataView(A.buffer,A.byteOffset,A.byteLength);
 if(!call||call.mn!=='native'||call.form!=='nat_b'||call.b!==0||az.native(call)?.[0]!=='Strat_SetModelCollide'||finalClass.events.some(([,handler])=>!az.ins.has(handler))||
  fd.getUint32(init,true)!==0||fd.getUint32(init+4,true)!==0x42c80000||fd.getUint32(init+8,true)!==0)
  throw'generic collision source template failed its entry, handler or init-register verification';
 const value={A,B,w:wad,name:GENERIC_COLLISION_BUILTIN,sourceInstanceIndex:ii,sourceClassName:GENERIC_COLLISION_CLASS,nativeOperands:chain.nativeOperands};
 customModelBuiltinCache.set(cacheKey,value);return value;
}
function customModelSourceResolver(srcWad){
 return name=>{if(name===GENERIC_COLLISION_BUILTIN)return getGenericCollisionBuiltin();for(const kind of Object.keys(CUSTOM_MODEL_BUILTINS))if(name===CUSTOM_MODEL_BUILTINS[kind])return getCustomModelBuiltin(kind);return typeof srcWad==='function'?srcWad(name):null};
}
function validateGenericCollisionClass(A,B,wadName,c,className=GENERIC_COLLISION_CLASS){
 const wad=siWad(A,B);if(!wad||!c)throw wadName+': generic collision class is missing from the target WAD';
 const d=new DataView(A.buffer,A.byteOffset,A.byteLength),U=o=>d.getUint32(o,true),imp=fixups(B),name=siCstr(A,U(c.off+4)),pool=U(c.off+0x20),blockOff=U(c.off+0x0c),block=wad.blocks.find(([p])=>p===blockOff);
 if(name!==className||c.ninit!==3||c.events.length!==2||U(c.off+4)-pool!==0x19||
  !imp.rel.has(c.off+4)||!imp.rel.has(c.off+0x20)||!imp.rel.has(c.off+0x1c)||!imp.rel.has(c.off+8)||!imp.rel.has(c.off+0x0c)||!block)
  throw wadName+': existing '+className+' class has incompatible name/pool/register/event/relocation metadata';
 const az=new SiAn(wad);siClass(az,c,c.events.map(([key,handler],i)=>[i,key,handler]));
 const call=az.ins.get(c.entry);if(!call||call.mn!=='native'||call.form!=='nat_b'||call.b!==0||az.native(call)?.[0]!=='Strat_SetModelCollide')
  throw wadName+': existing '+className+' class does not begin with Strat_SetModelCollide(r0)';
 const expected=[0x00b50008,0x00b60008];if(c.events.some(([key,handler],i)=>key!==expected[i]||!handler||handler<blockOff||handler>=blockOff+block[1]*4||az.ins.get(handler)?.mn!=='mov'||az.ins.get(handler+4)?.mn!=='endevent'))
  throw wadName+': existing '+className+' event handlers are not the verified in-block no-op handlers';
 const native=[...az.ins.values()].filter(ins=>ins.off>=blockOff&&ins.off<blockOff+block[1]*4&&(ins.mn==='native'||ins.mn==='native_y')).sort((a,b)=>a.off-b.off);
 if(native.length!==3||az.native(native[0])?.[0]!=='Strat_SetModelCollide'||native.filter(ins=>az.native(ins)?.[0]==='Strat_EnableEvent').length!==2)
  throw wadName+': existing '+className+' native entry/event sequence is not the verified three-call template';
 // Walk the native linked list independently for every installed class.
 const operands=native.map(ins=>ins.off+4),expectedSet=new Set(operands);let cursor=blockOff+U(blockOff)*4,visited=[];
 for(let n=0;n<=operands.length;n++){if(!expectedSet.has(cursor)||visited.includes(cursor))throw wadName+': '+className+' native-call chain is invalid';visited.push(cursor);const delta=U(cursor)&0xffff;if(delta===0xffff)break;cursor+=delta*4}
 if(visited.length!==operands.length||visited.some((off,i)=>off!==operands[i]))throw wadName+': '+className+' native-call chain does not cover every call';
 return{classOff:c.off,entry:c.entry,codeBlock:blockOff,nativeCalls:native.length,className};
}
function compatibleGenericCollisionClass(A,B,wadName,wad,className){
 const existing=wad.classes.find(c=>c.name===className);if(!existing)return null;
 try{return validateGenericCollisionClass(A,B,wadName,existing,className)}catch{return null}
}
function installGenericCollisionClass(A0,B0,wadName,resolveSource){
 let wad=siWad(A0,B0);if(!wad)throw wadName+': generic collision installation needs a PC STRAT WAD';
 // Reuse the established class only when it exactly matches the editor's
 // verified template. Older editor builds and some user levels may already
 // contain a different class with this same display name. Never overwrite or
 // silently bind to that unrelated implementation: install/reuse a private
 // editor class alongside it instead.
 let className=GENERIC_COLLISION_CLASS,existing=wad.classes.find(c=>c.name===className);
 if(existing){
  const valid=compatibleGenericCollisionClass(A0,B0,wadName,wad,className);
  if(valid)return{A:A0,B:B0,classOff:valid.classOff,className,installed:false};
  let candidate=GENERIC_COLLISION_ALIAS_BASE;
  for(let suffix=0;suffix<256;suffix++){
   const name=suffix?GENERIC_COLLISION_ALIAS_BASE+suffix:GENERIC_COLLISION_ALIAS_BASE;
   const found=wad.classes.find(c=>c.name===name);
   if(!found){candidate=name;break}
   const reusable=compatibleGenericCollisionClass(A0,B0,wadName,wad,name);
   if(reusable)return{A:A0,B:B0,classOff:reusable.classOff,className:name,installed:false};
  }
  if(wad.classes.some(c=>c.name===candidate))throw wadName+': could not find an unused editor generic-collision class name';
  className=candidate;
 }
 const source=getGenericCollisionBuiltin(),sourceClass=source.w.classes.find(c=>c.name===GENERIC_COLLISION_CLASS);
 const variants=className===GENERIC_COLLISION_CLASS?[]:[{name:GENERIC_COLLISION_CLASS,alias:className}];
 const copied=patchLcs(A0,B0,{classes:[{from:{w:GENERIC_COLLISION_BUILTIN,name:GENERIC_COLLISION_CLASS},variants,preserveExternalEvents:false}]},wadName,resolveSource,{});
 let A=copied.A,B=copied.B;wad=siWad(A,B);const c=wad&&wad.classes.find(x=>x.name===className);
 if(!c)throw wadName+': failed to transplant the bundled '+GENERIC_COLLISION_CLASS+' class as '+className;
 // The game requires the copied class-name pointer to remain adjacent to the
 // class-owned Heartbeat pool. Keep the verified +0x19 string placement even
 // when a private alias is used to avoid an incompatible pre-existing class.
 const sourcePool=source.w.U(sourceClass.off+0x20),bld=Builder(A,B),pool=bld.alloc(0x19+className.length+1,4);
 bld.A.set(source.A.subarray(sourcePool,sourcePool+0x18),pool);bld.A[pool+0x18]=0;
 const nameBytes=new TextEncoder().encode(className);bld.A.set(nameBytes,pool+0x19);bld.A[pool+0x19+nameBytes.length]=0;
 bld.W(c.off+0x20,pool);bld.addRel(c.off+0x20);bld.W(c.off+4,pool+0x19);bld.addRel(c.off+4);
 const fixed=bld.finish();A=fixed.A;B=fixed.B;wad=siWad(A,B);const installed=wad.classes.find(x=>x.name===className);
 validateGenericCollisionClass(A,B,wadName,installed,className);
 return{A,B,classOff:installed.off,className,installed:true};
}
function addGenericCollisionInstance(A0,B0,wadName,resolveSource,pos,targetHeadingBits,id,className=GENERIC_COLLISION_CLASS){
 const source=getGenericCollisionBuiltin(),sourceInstance=source.w.instances[source.sourceInstanceIndex];
 const heading=new DataView(source.A.buffer,source.A.byteOffset,source.A.byteLength).getFloat32(sourceInstance.off+0x20,true);
 if(!Number.isFinite(heading))throw'generic collision instance template has an invalid heading';
 const variants=className===GENERIC_COLLISION_CLASS?[]:[{name:GENERIC_COLLISION_CLASS,alias:className}];
 const classes=className===GENERIC_COLLISION_CLASS?[]:[{from:{w:GENERIC_COLLISION_BUILTIN,name:GENERIC_COLLISION_CLASS},variants,preserveExternalEvents:false}];
 const patched=patchLcs(A0,B0,{classes,adds:[{id,from:{w:GENERIC_COLLISION_BUILTIN,i:source.sourceInstanceIndex},p:pos,dy:targetHeadingBits-heading}]},wadName,resolveSource,{});
 const wad=siWad(patched.A,patched.B),ci=wad.classes.findIndex(c=>c.name===className),instance=wad.instances[wad.instances.length-1];
 if(ci<0||!instance||instance.cls!==ci||!instance.init)throw wadName+': failed to append a STRAT instance of '+className;
 const imp=fixups(patched.B),d=new DataView(patched.A.buffer,patched.A.byteOffset,patched.A.byteLength),U=o=>d.getUint32(o,true);
 if(!imp.rel.has(instance.off+0x28)||!imp.rel.has(instance.off+0x2c)||U(instance.init)!==0||U(instance.init+4)!==0x42c80000||U(instance.init+8)!==0)
  throw wadName+': new generic collision instance has invalid class/init pointers or initial registers';
 return{A:patched.A,B:patched.B,classOff:wad.classes[ci].off,instanceOff:instance.off,initOff:instance.init,className};
}
// Native custom-model writer. It no longer requires a named object or render
// model to exist in the destination level: STRAT templates and the complete
// one-part opaque PC renderer graph are bundled with the editor. Bounds-based
// Box collision continues to use the exact in-game-confirmed CollMesh topology.
function patchCustomModels(A0,B0,wadName,record,srcWad,sourceNames=[]){
 const instances=Array.isArray(record&&record.instances)?record.instances:[];
 if(!instances.length)return{A:A0,B:B0,added:{instances:0,models:0,textures:0,meshes:0,parts:0}};
 if(!siWad(A0,B0))throw wadName+': custom model output needs a PC STRAT level';
 const staticClassName=customModelTemplateLayout.staticClass,collisionClassName=customModelTemplateLayout.collisionClass;
 const staticTemplateName=CUSTOM_MODEL_BUILTINS.static,collisionTemplateName=CUSTOM_MODEL_BUILTINS.collision;
 const resolveSource=customModelSourceResolver(srcWad);
 const assetMap=new Map((record.assets||[]).map(a=>[a.id,a]));
 const collisionTypes=new Set(['none','box','sphere','cylinder','mesh']);
 const manifestCache=new Map();
 const manifestOf=a=>{
  if(!a||typeof a.bundle!=='string')return{};
  if(manifestCache.has(a.id))return manifestCache.get(a.id);
  let result={};try{result=parseIninjaModelBundle(base64ToBytes(a.bundle)).manifest.collision||{}}catch{}
  manifestCache.set(a.id,result);return result;
 };
 const effectiveCollisionType=(a,inst)=>{
  const requested=inst?.collisionType??a?.collisionType??manifestOf(a).type??'none';
  const value=String(requested).toLowerCase();return collisionTypes.has(value)?value:'none';
 };
 const effectiveCollisionTags=(a,inst,type)=>{
  const manifest=manifestOf(a);
  // Preserve the proven legacy presets. Explicit raw 16-bit tags take
  // precedence over these presets for each orientation class.
  let top=inst?.collisionTopTag;
  if(!['standable','slidey'].includes(top)){
   if(['standable','slidey'].includes(a?.collisionUpwardTagMode))top=a.collisionUpwardTagMode;
   else if(type==='mesh')top=(['standable','slidey'].includes(a?.collisionTopTag)?a.collisionTopTag:manifest.topTagMode)||'slidey';
   else if(['standable','slidey'].includes(manifest.topTagModeExplicit?manifest.topTagMode:null))top=manifest.topTagMode;
   else top=(type==='box'||type==='cylinder')?'standable':'slidey';
  }
  let side=inst?.collisionSideTag;
  if(!['walkable','slidey'].includes(side))side=(['walkable','slidey'].includes(a?.collisionSideTag)?a.collisionSideTag:manifest.sideTagMode)||'slidey';
  if(!['standable','slidey'].includes(top))top='slidey';
  if(!['walkable','slidey'].includes(side))side='slidey';
  const rawTag=(instanceKey,assetKey,manifestKey,ignoreInherited=false)=>{
   const raw=inst?.[instanceKey]??(ignoreInherited?undefined:(a?.[assetKey]??manifest[manifestKey]));
   if(raw==null||raw==='')return null;
   const value=Number(raw);
   if(!Number.isInteger(value)||value<0||value>0xffff)throw'custom collision '+instanceKey+' must be a 16-bit material tag (0..65535)';
   return value;
  };
  const rawLabel=(instanceKey,assetKey,manifestKey)=>{
   const value=inst?.[instanceKey]??a?.[assetKey]??manifest[manifestKey]??'';
   return String(value).slice(0,48);
  };
  return{
   topTagMode:top,sideTagMode:side,
   upwardMaterialTag:rawTag('collisionUpwardMaterialTag','collisionUpwardMaterialTag','upwardMaterialTag',['standable','slidey'].includes(inst?.collisionTopTag)),
   sideMaterialTag:rawTag('collisionSideMaterialTag','collisionSideMaterialTag','sideMaterialTag',['walkable','slidey'].includes(inst?.collisionSideTag)),
   otherMaterialTag:rawTag('collisionOtherMaterialTag','collisionOtherMaterialTag','otherMaterialTag'),
   upwardMaterialLabel:rawLabel('collisionUpwardMaterialLabel','collisionUpwardMaterialLabel','upwardMaterialLabel'),
   sideMaterialLabel:rawLabel('collisionSideMaterialLabel','collisionSideMaterialLabel','sideMaterialLabel'),
   otherMaterialLabel:rawLabel('collisionOtherMaterialLabel','collisionOtherMaterialLabel','otherMaterialLabel')
  };
 };
 const needsStaticTemplate=instances.some(inst=>effectiveCollisionType(assetMap.get(inst.assetId),inst)!=='box');
 const collisionEventsAreVerifiedNoops=(wad,c)=>{
  if(!c||c.events.length!==2||c.events[0][0]!==0x00b50008||c.events[1][0]!==0x00b60008||c.events.some(([,h])=>!h))return false;
  const az=new SiAn(wad);siClass(az,c,c.events.map(([key,handler],i)=>[i,key,handler]));
  return c.events.every(([,handler])=>az.ins.get(handler)?.mn==='mov'&&az.ins.get(handler+4)?.mn==='endevent');
 };
 const assertBundledStratIsSelfContained=(bundle,c,label)=>{
  const report=classReports(bundle.A,bundle.B)[c&&c.name];
  if(!report||report.kinds.sound||report.kinds['level data']||report.classes.length||report.strs.length||report.assets)
   throw'embedded '+label+' STRAT template contains a level-specific dependency: '+JSON.stringify(report);
 };
 let templateSource=null,sourceInstanceIndex=-1,sourceHeadingBits=null;
 if(needsStaticTemplate){
  templateSource=getCustomModelBuiltin('static');
  const ci=templateSource.w.classes.findIndex(c=>c.name===staticClassName);
  if(ci<0)throw'embedded static custom-model template is missing '+staticClassName;
  const sourceClass=templateSource.w.classes[ci];sourceInstanceIndex=templateSource.w.instances.findIndex(x=>x.cls===ci);
  if(sourceInstanceIndex<0||sourceClass.ninit!==0||sourceClass.events.some(([,handler])=>handler!==0))throw'embedded static custom-model STRAT template has an unexpected layout';
  assertBundledStratIsSelfContained(templateSource,sourceClass,'static');
  const sourceInstance=templateSource.w.instances[sourceInstanceIndex],sd=new DataView(templateSource.A.buffer,templateSource.A.byteOffset,templateSource.A.byteLength),U=o=>sd.getUint32(o,true);
  const initHeader=U(sourceInstance.off+0x28),initRegs=initHeader&&templateSource.w.U(initHeader+0x18);
  if(U(sourceInstance.off+0x2c)===0||U(sourceInstance.off+0x30)!==0||U(sourceInstance.off+0x34)!==0||initRegs!==0)throw'embedded static custom-model template instance has unsupported registers/path/shape';
  const az=new SiAn(templateSource.w);siClass(az,sourceClass,[]);
  const refs=az.modelRefs.filter(r=>r.cls===staticClassName&&r.native==='Strat_SetModel');
  if(refs.length!==1)throw'embedded static custom-model template does not contain exactly one Strat_SetModel call';
  sourceHeadingBits=new DataView(templateSource.A.buffer,templateSource.A.byteOffset,templateSource.A.byteLength).getFloat32(sourceInstance.off+0x20,true);
  if(!Number.isFinite(sourceHeadingBits))throw'embedded static custom-model template has an invalid starting heading';
 }
 // Install the complete renderer scaffold from the bundled debug-model graph.
 // The source graph contains descriptor/metadata tails which ordinary resource
 // boundary inference truncates, so override those two exact object extents.
 const renderSource=getCustomModelBuiltin('render'),renderLayout=customModelTemplateLayout.render;
 const renderCtx=SrcCtx(renderSource.A,renderSource.B),renderNext=renderCtx.next.bind(renderCtx);
 renderCtx.sizes=new Map([[renderLayout.descriptor,renderLayout.descriptorSize],[renderLayout.metadata,renderLayout.metadataSize]]);
 // The bundled graph is deliberately a one-part template. Do not split its
 // mesh on copy: its render part and metadata must retain the same mesh pointer.
 renderCtx.meshUse=new Map();
 renderCtx.next=o=>renderCtx.sizes.has(o)?o+renderCtx.sizes.get(o):renderNext(o);
 let A=A0,B=B0;
 const graphBuilder=Builder(A,B),graphMap=copyGraph(renderCtx,graphBuilder,[renderLayout.descriptor],{}, {addRes:true}),graphOut=graphBuilder.finish();
 A=graphOut.A;B=graphOut.B;
 const graphU=o=>new DataView(A.buffer,A.byteOffset,A.byteLength).getUint32(o,true);
 const mapped=(sourceOff,label)=>{const targetOff=graphMap.get(sourceOff);if(!Number.isInteger(targetOff)||targetOff<=0||targetOff>=A.length)throw'could not install bundled PC render scaffold '+label;return targetOff};
 const desc=mapped(renderLayout.descriptor,'descriptor'),part=mapped(renderLayout.part,'part'),auxPart=mapped(renderLayout.auxPart,'auxiliary part');
 const data20=mapped(renderLayout.data20,'data20 block'),data90=mapped(renderLayout.data90,'data90 block'),data24=mapped(renderLayout.data24,'data24 block');
 const meta=mapped(renderLayout.metadata,'metadata'),auxMeta=mapped(renderLayout.auxMetadata,'auxiliary metadata'),texture=mapped(renderLayout.texture,'texture');
 const mesh=graphU(part+0x0c);
 const graphCheck={desc:[graphU(desc),part],auxPart:[graphU(desc+0x54),auxPart],texture:[graphU(part+0x10),texture],data20:[graphU(part+0x20),data20],data90:[graphU(part+0x28),data90],data24:[graphU(part+0x30),data24],meta:[graphU(part+0x38),meta],metaDesc:[graphU(meta+0x0c),desc],metaMesh:[graphU(meta+0x48),mesh],auxMeta:[graphU(meta+0x5c),auxMeta]};
 if(Object.values(graphCheck).some(([actual,expected])=>actual!==expected))throw'bundled PC render scaffold failed its relocated pointer-graph checks: '+JSON.stringify(graphCheck);
 const targetImp=fixups(B),targetRelOffsets=(o,n)=>[...targetImp.rel].filter(x=>x>=o&&x<o+n).map(x=>x-o).sort((a,b)=>a-b);
 const exact=(o,n,want)=>{const got=targetRelOffsets(o,n);return got.length===want.length&&got.every((v,i)=>v===want[i])};
 const targetResources={parts:new Set(targetImp[0x80000021]||[]),meshes:new Set(targetImp[0x80000024]||[]),textures:new Set(targetImp[0x80000001]||[])};
 if(!targetResources.parts.has(part)||!targetResources.parts.has(auxPart)||!targetResources.meshes.has(mesh)||!targetResources.textures.has(texture)||
  !exact(desc,0x70,[0,0x54])||!exact(part,0x50,[0x0c,0x10,0x20,0x28,0x30,0x38])||
  !exact(data20,0x20,[])||!exact(data90,0x90,[])||!exact(data24,0x24,[])||!exact(meta,0x60,[0x0c,0x48,0x4c,0x5c])||
  !exact(mesh,0x30,[0x10,0x18])||!exact(texture,0x20,[0x10]))throw'bundled PC render scaffold has an incomplete resource/relocation layout';
 const template={name:'bundled PC render scaffold',desc,part,auxPart,blocks:[data20,data90,data24,meta],mesh,texture,auxMeta};
 const templateSourceWad='bundled editor STRAT templates';
 let counts={instances:0,models:0,textures:0,meshes:0,parts:0,collisions:0};
 const usedCollisionClassNames=new Set();
 const ascii=(s,n)=>{const b=new Uint8Array(n);for(let i=0;i<Math.min(n,s.length);i++){const c=s.charCodeAt(i);if(c<32||c>126)throw'model name must be plain ASCII';b[i]=c}return b};
 const srgbToLinear=x=>{x=Math.max(0,Math.min(1,x));return x<=0.04045?x/12.92:Math.pow((x+0.055)/1.055,2.4)};
 const linearToSrgb=x=>{x=Math.max(0,Math.min(1,x));return x<=0.0031308?12.92*x:1.055*Math.pow(x,1/2.4)-0.055};
 const bakeTexture=(data,material)=>{
  let bytes;
  if(material.texture){bytes=data.textures.get(material.texture);if(!bytes)throw'model texture '+material.texture+' is missing from its bundle';bytes=bytes.slice();
   if(bytes[2]!==2||bytes[16]!==32)throw'first in-game custom-model support requires a 32-bit truecolour TGA texture; re-export this model with the current Blender add-on';
  }else{bytes=new Uint8Array(18+4*4*4);bytes[2]=2;bytes[12]=4;bytes[14]=4;bytes[16]=32;bytes[17]=0;for(let p=18;p<bytes.length;p+=4)bytes.set([255,255,255,255],p)}
  const idEnd=18+bytes[0],w=bytes[12]|(bytes[13]<<8),h=bytes[14]|(bytes[15]<<8),factor=material.baseColor||[1,1,1,1];
  if(bytes.length<idEnd+w*h*4)throw'model TGA data is truncated';
  for(let p=idEnd;p<idEnd+w*h*4;p+=4){
   // TGA stores BGRA; Blender's material base colour is linear RGB.
   bytes[p]=Math.round(linearToSrgb(srgbToLinear(bytes[p]/255)*factor[2])*255);
   bytes[p+1]=Math.round(linearToSrgb(srgbToLinear(bytes[p+1]/255)*factor[1])*255);
   bytes[p+2]=Math.round(linearToSrgb(srgbToLinear(bytes[p+2]/255)*factor[0])*255);
   bytes[p+3]=Math.round(bytes[p+3]*factor[3]);
  }
  return bytes.subarray(0,idEnd+w*h*4);
 };
 const makeStrip=indices=>{
  if(indices.length<3||indices.length%3)throw'mesh index buffer must contain complete triangles';
  const out=[indices[0],indices[1],indices[2]];
  for(let t=3;t<indices.length;t+=3){const a=indices[t],b=indices[t+1],c=indices[t+2],last=out[out.length-1],odd=((out.length+2)&1)!==0;
   out.push(last,odd?b:a,odd?b:a,odd?a:b,c);
  }
  return Uint16Array.from(out);
 };
 // Embedded 0x178-byte CollMesh topology extracted from the previously
 // in-game-validated INI_ExtendingPlatform_Suzanne object. Keep this exact
 // header/KD tree/vertex-record layout: the plain Robot_ExtendingPlatform
 // variant has different header/tree fields and lost collision in the base-
 // game 10-00 runtime test. Embedding this tested copy removes all build-time
 // dependencies on 10-20.LCS and the special Suzanne reference VOL.
 const retailBoxCollMeshBase64='MAAAAAcAAAAAAAAAAAAAAAAAAAAAAAAAAA5kQKmf8T9oAAAAEQAAAAAAAAAAAAAAONT//wEA///IKwAA//8CAHng//8DAP//iR8AAP//BAC65P//BQD//0obAAD//wYAAwAAABEAAAAAAK+/AAB8vwAAWj+AAAAAAACvvwAAfD8AAFq/gAAAAAAAr78AAHy/AABav9QAAQAAAK8/AAB8PwAAWr/QAQEAAACvPwAAfL8AAFq/0AABAAAArz8AAHw/AABaP9EBAQAAAK8/AAB8vwAAWj/QAAEAAACvvwAAfD8AAFo/0QEBAAAArz8AAHw/AABav4AAAAAAAK8/AAB8PwAAWj+AAAAAAACvvwAAfD8AAFq/wAEKAAAAr78AAHw/AABaP8AACgAAAK+/AAB8vwAAWj/FAQEAAACvPwAAfL8AAFo/xAABAAAAr78AAHy/AABav8ABAQAAAK8/AAB8vwAAWr/AAAEAAAAAAAAAAAAAAAAAAAAAAA==';
 const findBoxCollisionTemplate=()=>{
  if(boxCollisionTemplate)return boxCollisionTemplate;
  const A=base64ToBytes(retailBoxCollMeshBase64),d=new DataView(A.buffer,A.byteOffset,A.byteLength),U=o=>d.getUint32(o,true),F=o=>d.getFloat32(o,true);
  const coll=0,nodeCount=U(4),nodes=0x30,vertexCount=U(0x24),verts=nodes+nodeCount*8;
  if(A.length!==0x178||nodeCount!==7||vertexCount!==17||U(nodes+6*8)!==3||U(nodes+6*8+4)!==17)
   throw'embedded tested Box CollMesh template failed its structural self-check';
  const bounds=[[Infinity,-Infinity],[Infinity,-Infinity],[Infinity,-Infinity]];
  for(let i=0;i<vertexCount-1;i++)for(let axis=0;axis<3;axis++){const v=F(verts+i*16+axis*4);bounds[axis][0]=Math.min(bounds[axis][0],v);bounds[axis][1]=Math.max(bounds[axis][1],v)}
  if(bounds.some(([lo,hi])=>!Number.isFinite(lo)||!Number.isFinite(hi)||hi-lo<1e-5))
   throw'embedded tested Box CollMesh has invalid source bounds';
  const flags=Array.from({length:vertexCount},(_,i)=>U(verts+i*16+12));
  boxCollisionTemplate={sourceWad:'embedded tested INI_ExtendingPlatform_Suzanne box topology',A,className:'INI_ExtendingPlatform_Suzanne',coll,nodes,nodeCount,verts,vertexCount,bounds,flags};
  return boxCollisionTemplate;
 };
 let boxCollisionTemplate=null;
 const appendNativeModel=(bundle,inst,idx,alias,assetRecord,collisionConfig)=>{
  const data=parseIninjaModelBundle(bundle),m=data.manifest;
  if(data.meshes.length!==1||data.materials.length!==1)throw'"'+(m.name||'Custom model')+'": the first in-game build supports exactly one mesh and one material; split or simplify the model in Blender';
  const mesh=data.meshes[0],material=data.materials[0];
  if(mesh.material!==0)throw'"'+(m.name||'Custom model')+'": the mesh must use material slot 1';
  if(material.alphaMode!=='OPAQUE')throw'"'+(m.name||'Custom model')+'": only OPAQUE materials are supported by the first in-game writer';
  const collisionType=collisionConfig.type;
  if(!['none','box','sphere','cylinder','mesh'].includes(collisionType))throw'"'+(m.name||'Custom model')+'": supported native collision types are None, Box, Sphere, Cylinder or Mesh';
  const hasCollision=collisionType!=='none';
  const pos=inst.position||[0,0,0],rot=inst.rotation||[0,0,0],scale=inst.scale||[1,1,1];
  if(!Array.isArray(pos)||pos.length!==3||!pos.every(Number.isFinite))throw'custom model instance '+(inst.name||idx)+' has an invalid position';
  if(!Array.isArray(rot)||rot.length!==3||!rot.every(Number.isFinite))throw'custom model instance '+(inst.name||idx)+' has an invalid rotation';
  if(!Array.isArray(scale)||scale.length!==3||!scale.every(Number.isFinite)||scale.some(v=>v<=0))throw'custom model instance '+(inst.name||idx)+' has an invalid scale';
  if(Math.max(...scale)-Math.min(...scale)>1e-5)throw'custom model instance '+(inst.name||idx)+': non-uniform scale is not supported yet; use the same X/Y/Z scale';
  const uniformScale=(scale[0]+scale[1]+scale[2])/3;
  const modelName=('INI'+idx.toString(36)+'_'+fnv(new TextEncoder().encode(String(inst.assetId||m.name))).slice(0,7)).slice(0,15);
  const targetHeadingBits=((((Number(rot[1])||0)%360)+360)%360)*TURN/360;
  let collisionRef=null;
  if(hasCollision){
   // Install/reuse one self-contained generic class per target LCS. Every primitive
   // placement gets a separate instance, initial-register block, model table
   // and CollMesh; no target-level donor class or vegetation instance is used.
   const installed=installGenericCollisionClass(A,B,wadName,resolveSource);A=installed.A;B=installed.B;usedCollisionClassNames.add(installed.className);
   const added=addGenericCollisionInstance(A,B,wadName,resolveSource,pos,targetHeadingBits,'generic-collision:'+idx,installed.className);A=added.A;B=added.B;
   collisionRef={classOff:added.classOff,instanceOff:added.instanceOff,initOff:added.initOff};
   findBoxCollisionTemplate();
  }else{
   // Collision-free objects use the bundled, event-free Strat_SetModel class.
   const source={w:staticTemplateName,i:sourceInstanceIndex},ops={
    classes:[{from:{w:staticTemplateName,name:staticClassName},variants:[{name:staticClassName,alias}]}],
    adds:[{id:'custom-model:'+idx,from:source,p:pos,dy:targetHeadingBits-sourceHeadingBits}]
   };
   const patched=patchLcs(A,B,ops,wadName,resolveSource,{});A=patched.A;B=patched.B;
   const clonedWad=siWad(A,B),clonedClass=clonedWad&&clonedWad.classes.find(x=>x.name===alias);
   if(!clonedClass)throw'could not create the private static STRAT class '+alias;
   if(clonedClass.ninit!==0||clonedClass.events.some(([,handler])=>handler!==0))
    throw'private custom-model class '+alias+' inherited unsupported static variables or event handlers';
  }
  const bld=Builder(A,B),W=bld.W,copy=(src,n)=>{const p=bld.alloc(n,16);bld.A.set(A.subarray(src,src+n),p);return p};
  const desc=copy(template.desc,0x70),part=copy(template.part,0x50),data20=copy(template.blocks[0],0x20),data28=copy(template.blocks[1],0x90),data30=copy(template.blocks[2],0x24),meta=copy(template.blocks[3],0x60),meshOff=copy(template.mesh,0x30),texOff=copy(template.texture,0x20);
  const strip=makeStrip(mesh.indices),vertexCount=mesh.vertexCount,indexCount=strip.length;
  if(!vertexCount||vertexCount>65535||indexCount<3)throw'custom mesh has invalid vertex/index counts';
  const vertexOff=bld.alloc(vertexCount*0x20,16),indexOff=bld.alloc(indexCount*2,2),textureData=bakeTexture(data,material),tgaOff=bld.alloc(textureData.length,16);
  bld.A.set(textureData,tgaOff);
  const vd=new DataView(bld.A.buffer);for(let v=0;v<vertexCount;v++){
   const p=vertexOff+v*0x20;
   // .inimodel coordinates are editor Y-up coordinates. The level viewer's
   // Mirror Z root applies z=-z for preview, but the game runtime does not.
   // Test 37 confirmed the native resource must bake that reflection into
   // vertex positions and normals. The reflection reverses handedness, so keep
   // the Blender triangle order (makeStrip below receives the original list).
   vd.setFloat32(p,mesh.positions[v*3]*uniformScale,true);
   vd.setFloat32(p+4,mesh.positions[v*3+1]*uniformScale,true);
   vd.setFloat32(p+8,-mesh.positions[v*3+2]*uniformScale,true);
   vd.setFloat32(p+12,mesh.normals[v*3],true);
   vd.setFloat32(p+16,mesh.normals[v*3+1],true);
   vd.setFloat32(p+20,-mesh.normals[v*3+2],true);
   // The PC renderer's texture V origin is opposite to Blender's UV origin.
   // Keep U unchanged (the in-game U flip diagnostic did not improve mapping).
   vd.setFloat32(p+24,mesh.uvs[v*2],true);
   vd.setFloat32(p+28,1-mesh.uvs[v*2+1],true);
  }
  for(let i=0;i<indexCount;i++)vd.setUint16(indexOff+2*i,strip[i],true);
  // Descriptor: opaque root at +0; no translucent root. Preserve the PC
  // descriptor's remaining renderer fields from the known one-part template.
  W(desc,part);bld.addRel(desc);
  // Preserve the template's auxiliary render-part link at descriptor +0x54.
  // The complete native descriptor is 0x70 bytes, not the old 0x50-byte prefix.
  bld.addRel(desc+0x54);bld.A.fill(0,desc+0x20,desc+0x30);bld.A.set(ascii(modelName,16),desc+0x20);
  // Render part and its four complete support/data blocks.
  W(part+0x0c,meshOff);W(part+0x10,texOff);W(part+0x20,data20);W(part+0x28,data28);W(part+0x30,data30);W(part+0x38,meta);
  const partRels=[];for(const o of [part+0x0c,part+0x10,part+0x20,part+0x28,part+0x30,part+0x38])bld.addRelTo(partRels,o);
  // Full 0x60-byte metadata mirrors the known-good debug model structure.
  // Both the leading part range and embedded mesh/texture links must agree.
  W(meta,5);W(meta+4,vertexCount);W(meta+8,indexCount-2);W(meta+12,desc);
  W(meta+0x20,0);W(meta+0x24,0);W(meta+0x48,meshOff);W(meta+0x4c,texOff);
  bld.addRel(meta+12);bld.addRel(meta+0x48);bld.addRel(meta+0x4c);
  // Keep the known-good metadata sidecar at +0x5c; it is shared with the
  // template graph rather than re-created as an unknown data structure.
  bld.addRel(meta+0x5c);
  // PC mesh: one interleaved 32-byte vertex buffer and a 16-bit stitched strip.
  W(meshOff+4,0x23);W(meshOff+8,0x20);W(meshOff+12,vertexCount);W(meshOff+16,vertexOff);W(meshOff+20,indexCount);W(meshOff+24,indexOff);
  const meshRels=[];bld.addRelTo(meshRels,meshOff+16);bld.addRelTo(meshRels,meshOff+24);
  // Native texture resource embeds a pointer to its complete 32-bit TGA.
  const tw=textureData[12]|(textureData[13]<<8),th=textureData[14]|(textureData[15]<<8);
  W(texOff+4,tw);W(texOff+8,th);W(texOff+16,tgaOff);W(texOff+20,textureData.length);W(texOff+24,1);const textureRels=[];bld.addRelTo(textureRels,texOff+16);
  // Register resource starts in the loader's ordered fixup stream.
  bld.addSpec(1,texOff,textureRels);
  // The raw vertex byte array is owned by the kind-0x24 mesh through +0x10.
  // It is NOT a kind-0x23 resource object; registering it would make the loader
  // overwrite the first vertex with the 0x23 class pointer.
  bld.addSpec(0x24,meshOff,meshRels);
  bld.addSpec(0x21,part,partRels);
  if(collisionRef){
   const ct=findBoxCollisionTemplate(),sd=new DataView(ct.A.buffer,ct.A.byteOffset,ct.A.byteLength),sf=o=>sd.getFloat32(o,true);
   const targetMin=[Infinity,Infinity,Infinity],targetMax=[-Infinity,-Infinity,-Infinity];
   for(let v=0;v<mesh.vertexCount;v++){
    const point=[mesh.positions[v*3]*uniformScale,mesh.positions[v*3+1]*uniformScale,-mesh.positions[v*3+2]*uniformScale];
    for(let k=0;k<3;k++){targetMin[k]=Math.min(targetMin[k],point[k]);targetMax[k]=Math.max(targetMax[k],point[k])}
   }
   if(targetMin.some((v,k)=>!Number.isFinite(v)||!Number.isFinite(targetMax[k])||targetMax[k]-v<1e-5))throw'custom model '+(m.name||idx)+' has a zero-width X, Y or Z bounds; primitive collision needs non-zero dimensions on all axes';
   let collOff,nodesOff,vertsOff;
   if(collisionType==='box'){
    const live=ct.vertexCount-1,srcMin=ct.bounds.map(x=>x[0]),srcMax=ct.bounds.map(x=>x[1]),srcCenter=srcMin.map((v,k)=>(v+srcMax[k])*0.5),srcHalf=srcMin.map((v,k)=>(srcMax[k]-v)*0.5);
    const targetCenter=targetMin.map((v,k)=>(v+targetMax[k])*0.5),targetHalf=targetMin.map((v,k)=>(targetMax[k]-v)*0.5);
    collOff=bld.alloc(0x30,16);nodesOff=bld.alloc(ct.nodeCount*8,4);vertsOff=bld.alloc(ct.vertexCount*16,4);
    bld.A.set(ct.A.subarray(ct.coll,ct.coll+0x30),collOff);bld.A.set(ct.A.subarray(ct.nodes,ct.nodes+ct.nodeCount*8),nodesOff);bld.A.set(ct.A.subarray(ct.verts,ct.verts+ct.vertexCount*16),vertsOff);
    const cd=bld.d;bld.W(collOff,nodesOff);bld.W(collOff+0x20,vertsOff);
    for(let k=0;k<3;k++)cd.setFloat32(collOff+0x0c+k*4,targetCenter[k],true);
    const radius=Math.hypot(...targetHalf);cd.setFloat32(collOff+0x18,radius*radius,true);cd.setFloat32(collOff+0x1c,radius,true);
    // Preserve the tested Box topology and terminal sentinel, but derive face
    // tags from the selected instance's upward/side policy. Transform the
    // donor records first so classification uses the emitted local geometry.
    const boxRecords=Array.from({length:ct.vertexCount},(_,v)=>({
     position:[0,1,2].map(k=>{
      const sourceValue=sf(ct.verts+v*16+k*4);
      return v<live?targetCenter[k]+(sourceValue-srcCenter[k])*(targetHalf[k]/srcHalf[k]):sourceValue;
     }),flags:sd.getUint32(ct.verts+v*16+12,true)
    }));
    applyCollisionTagModesToRecords(boxRecords,collisionConfig.topTagMode,collisionConfig.sideTagMode,collisionConfig);
    for(let v=0;v<boxRecords.length;v++){
     const q=vertsOff+v*16,rec=boxRecords[v];for(let k=0;k<3;k++)cd.setFloat32(q+k*4,rec.position[k],true);cd.setUint32(q+12,rec.flags>>>0,true);
    }
    // KD planes use signed 1/8192 coordinates. Carry over the donor's
    // per-plane safety margin, but reject values that cannot fit in int16.
    for(let k=0;k<3;k++){
     const minPlane=sd.getInt16(ct.nodes+(k*2)*8,true),maxPlane=sd.getInt16(ct.nodes+(k*2+1)*8,true);
     const srcMinQ=Math.round(srcMin[k]*8192),srcMaxQ=Math.round(srcMax[k]*8192),dstMinQ=Math.round(targetMin[k]*8192),dstMaxQ=Math.round(targetMax[k]*8192);
     const nextMin=dstMinQ+(minPlane-srcMinQ),nextMax=dstMaxQ+(maxPlane-srcMaxQ);
     if(nextMin< -32768||nextMin>32767||nextMax< -32768||nextMax>32767)throw'custom model '+(m.name||idx)+' box bounds exceed the tested CollMesh KD-plane range on axis '+k+'; reduce model size/scale before building';
     cd.setInt16(nodesOff+(k*2)*8,nextMin,true);cd.setInt16(nodesOff+(k*2+1)*8,nextMax,true);
    }
   }else if(collisionType==='mesh'){
    // .inilevel assets may carry a distinct, triangle-soup collision stream.
    // Prefer that stream when the adapter provides it; ordinary .inimodel
    // imports continue to derive collision from their render mesh.
    const collisionMesh=assetRecord&&assetRecord.nativeCollisionMesh||mesh;
    const shape=buildMeshCollisionShape(collisionMesh,{scale:uniformScale,...collisionConfig,
     faceMaterialTags:collisionMesh.faceMaterialTags??collisionConfig.faceMaterialTags,
     faceFlags:collisionMesh.faceFlags??collisionConfig.faceFlags});
    collOff=bld.alloc(0x30,16);nodesOff=bld.alloc(shape.nodeCount*8,8);vertsOff=bld.alloc(shape.records.length*16,16);
    bld.A.set(ct.A.subarray(ct.coll,ct.coll+0x30),collOff);
    const cd=bld.d;bld.W(collOff,nodesOff);bld.W(collOff+4,shape.nodeCount);bld.W(collOff+0x20,vertsOff);
    cd.setUint32(collOff+0x24,shape.records.length,true);cd.setUint32(collOff+0x28,shape.nodeCount,true);
    for(let k=0;k<3;k++)cd.setFloat32(collOff+0x0c+k*4,shape.centre[k],true);
    cd.setFloat32(collOff+0x18,shape.radiusSq,true);cd.setFloat32(collOff+0x1c,shape.radius,true);
    // PC KD bounds: signed int32 / 8192, with the six stock marker words fixed
    // by Step 103. These markers are essential for generated multi-node trees.
    const markerWords=[0xffff0001,0x0002ffff,0xffff0003,0x0004ffff,0xffff0005,0x0006ffff];
    for(let k=0;k<3;k++){
     const lo=Math.floor(shape.bounds[0][k]*8192)-2,hi=Math.ceil(shape.bounds[1][k]*8192)+2;
     if(lo< -0x80000000||lo>0x7fffffff||hi< -0x80000000||hi>0x7fffffff)throw'custom model '+(m.name||idx)+' mesh collision root bounds exceed int32 range; reduce model scale';
     cd.setInt32(nodesOff+k*16,lo,true);cd.setUint32(nodesOff+k*16+4,markerWords[k*2],true);
     cd.setInt32(nodesOff+(k*2+1)*8,hi,true);cd.setUint32(nodesOff+(k*2+1)*8+4,markerWords[k*2+1],true);
    }
    const nodeMap=new Map(shape.nodes.slice(6).map((node,i)=>[node,i+6]));
    for(let i=6;i<shape.nodeCount;i++){
     const node=shape.nodes[i],off=nodesOff+i*8;
     if(node.type==='leaf'){
      if(node.firstRecord>0xffffff||node.recordCount>255)throw'mesh collision leaf record range cannot be encoded';
      cd.setUint32(off,3,true);cd.setUint32(off+4,((node.firstRecord<<8)|node.recordCount)>>>0,true);
     }else{
      const q=Math.round(node.split*1024);
      if(q< -0x10000000||q>0x0fffffff)throw'mesh collision KD split exceeds the signed encoded range; reduce model scale';
      const left=nodeMap.get(node.left),right=nodeMap.get(node.right);
      if(!Number.isInteger(left)||!Number.isInteger(right))throw'mesh collision KD node references a missing child';
      cd.setUint32(off,((q<<3)|node.axis)>>>0,true);cd.setUint32(off+4,((left<<16)|right)>>>0,true);
     }
    }
    for(let r=0;r<shape.records.length;r++){const q=vertsOff+r*16,rec=shape.records[r];for(let k=0;k<3;k++)cd.setFloat32(q+k*4,rec.position[k],true);cd.setUint32(q+12,rec.flags>>>0,true)}
   }else{
    const shape=buildPrimitiveCollisionShape(collisionType,[targetMin,targetMax],collisionConfig);
    collOff=bld.alloc(0x30,16);nodesOff=bld.alloc(ct.nodeCount*8,4);vertsOff=bld.alloc(shape.records.length*16,4);
    bld.A.set(ct.A.subarray(ct.coll,ct.coll+0x30),collOff);bld.A.set(ct.A.subarray(ct.nodes,ct.nodes+ct.nodeCount*8),nodesOff);
    const cd=bld.d;bld.W(collOff,nodesOff);bld.W(collOff+0x20,vertsOff);cd.setUint32(collOff+4,ct.nodeCount,true);cd.setUint32(collOff+0x24,shape.records.length,true);
    for(let k=0;k<3;k++)cd.setFloat32(collOff+0x0c+k*4,shape.centre[k],true);
    cd.setFloat32(collOff+0x18,shape.radiusSq,true);cd.setFloat32(collOff+0x1c,shape.radius,true);
    // A single root leaf is sufficient for these deliberately low-record-count
    // primitives. Keep the six-bound header slots and retail node count/layout.
    for(let k=0;k<3;k++){
     const minQ=Math.floor(shape.bounds[0][k]*8192)-2,maxQ=Math.ceil(shape.bounds[1][k]*8192)+2;
     if(minQ< -32768||minQ>32767||maxQ< -32768||maxQ>32767)throw'custom model '+(m.name||idx)+' '+collisionType+' collision exceeds the tested PC KD-plane range on axis '+k+'; reduce model scale';
     cd.setInt16(nodesOff+(k*2)*8,minQ,true);cd.setInt16(nodesOff+(k*2+1)*8,maxQ,true);
    }
    cd.setUint32(nodesOff+6*8,3,true);cd.setUint32(nodesOff+6*8+4,shape.records.length,true);
    for(let r=0;r<shape.records.length;r++){const q=vertsOff+r*16,rec=shape.records[r];for(let k=0;k<3;k++)cd.setFloat32(q+k*4,rec.position[k],true);cd.setUint32(q+12,rec.flags>>>0,true)}
   }
   bld.addRel(collOff);bld.addRel(collOff+0x20);
   const impNow=fixups(B);
   if(!impNow.rel.has(collisionRef.instanceOff+0x28)||!impNow.rel.has(collisionRef.instanceOff+0x2c))throw'generic collision instance lost its class/init-array relocations before write';
   const tableOff=bld.alloc(8,4);W(tableOff,desc);W(tableOff+4,collOff);bld.addRel(tableOff);bld.addRel(tableOff+4);
   // r0 is the instance-specific pointer consumed by Strat_SetModelCollide.
   W(collisionRef.initOff,tableOff);bld.addRel(collisionRef.initOff);
   counts.collisions++;
  }
  const out=bld.finish();A=out.A;B=out.B;
  if(!collisionRef){
   // Use the exact script shape that passed the Stage 4B in-game test:
   // MOV model-table; Strat_SetModel; WAIT(0); JMP back to WAIT(0).
   const scripted=patchCustomModelStaticScript(A,B,wadName,alias,desc);A=scripted.A;B=scripted.B;
  }
  counts.instances++;counts.models++;counts.textures++;counts.meshes++;counts.parts++;
 };
 for(let i=0;i<instances.length;i++){
  const inst=instances[i],asset=assetMap.get(inst.assetId);if(!asset||typeof asset.bundle!=='string')throw'custom model instance '+(inst.name||i)+' refers to missing imported asset '+inst.assetId;
  const bytes=base64ToBytes(asset.bundle),hash=fnv(bytes),collisionType=effectiveCollisionType(asset,inst);
  if(!collisionTypes.has(collisionType))throw'custom model '+(asset.name||inst.name||i)+' uses unsupported native collision type '+collisionType+'; choose None, Box, Sphere or Mesh';
  const collisionConfig={type:collisionType,...effectiveCollisionTags(asset,inst,collisionType)};
  const alias='INIStatic_'+i.toString(36)+'_'+hash.slice(0,6);
  appendNativeModel(bytes,inst,i,alias.slice(0,31),asset,collisionConfig);
 }
 return{A,B,added:counts,templateSource:templateSourceWad,templateName:template.name,collisionTemplateSource:usedCollisionClassNames.size?'shared bundled generic collision class(es): '+[...usedCollisionClassNames].join(', ')+' + private per-placement CollMeshes':null};
}
// ---- read-only dependency report for every class of a strat wad: follows the code the class can actually run (entry + its handlers + called subroutines) and classifies every pointer in it
const KN={1:'texture',4:'level data',6:'material',7:'material',8:'skeleton/animation',0x20:'draw part',0x21:'mesh part',0x22:'mesh part',0x23:'vertex buffer',0x24:'mesh',0x113:'sound bank',0x115:'sound'};
const classReportCache=new WeakMap();
function classReports(A,B){
 if(A&&typeof A==='object'){const cached=classReportCache.get(A);if(cached&&cached.has(B))return cached.get(B)}
 const w=siWad(A,B);if(!w)return{};
 const az=new SiAn(w),imp=fixups(B),h=imp[0x8000010e][0],U=w.U,code=U(h+0x10),ncode=U(h+0x1c),cl0=U(h+0x14),clEnd=cl0+0x2c*w.classes.length,ins=U(h+0x28);
 const res=[];for(const k in imp){if(k==='rel'||+k===0x8000010e)continue;for(const o of imp[k])res.push([o,+k&0xffff])}res.sort((a,b)=>a[0]-b[0]);
 const resOf=v=>{let lo=0,hi=res.length-1,r=-1;while(lo<=hi){const m=(lo+hi)>>1;if(res[m][0]<=v){r=m;lo=m+1}else hi=m-1}return r>=0&&v-res[r][0]<0x400?r:-1};
 const byOff=new Map(w.classes.map(c=>[c.off,c.name])),order=w.classes.map((c,i)=>i).sort((a,b)=>w.classes[a].entry-w.classes[b].entry),lo={};let prev=0;for(const k of order){lo[k]=[prev,w.classes[k].entry];prev=w.classes[k].entry}
 const S=SrcCtx(A,B),ri=ResIndex(S),blobCache=new Map(),hashText=text=>{let hh=2166136261;for(let i=0;i<text.length;i++){const ch=text.charCodeAt(i);hh^=ch&255;hh=Math.imul(hh,16777619);hh^=ch>>>8;hh=Math.imul(hh,16777619)}return(hh>>>0).toString(16).padStart(8,'0')};
 const spanEnd=o=>{const e=S.next(o);return Math.max(o+1,Math.min(e==null?A.length:e,A.length))};
 const blobDigest=(o,depth=0,stack=new Set())=>{
  if(blobCache.has(o))return blobCache.get(o);
  if(depth>10)return'deep';if(stack.has(o))return'cycle';
  const end=spanEnd(o),size=end-o,nextStack=new Set(stack);nextStack.add(o);let hh=2166136261;
  // Hash the complete payload while masking relocated words; their resolved
  // targets are included as canonical edges below, rather than as file offsets.
  for(let p=o;p<end;p++){
   if((p&3)===0&&p+4<=end&&w.rel.has(p)){for(let k=0;k<4;k++){hh^=0;hh=Math.imul(hh,16777619)}p+=3;continue}
   hh^=A[p];hh=Math.imul(hh,16777619);
  }
  const edges=[];for(let p=o;p+4<=end;p+=4)if(w.rel.has(p))edges.push((p-o)+':'+targetToken(U(p),depth+1,nextStack));
  const digest=size+':'+(hh>>>0).toString(16)+':'+edges.join('|');blobCache.set(o,digest);return digest;
 };
 const targetToken=(v,depth=0,stack=new Set(),codeOrder=null)=>{
  if(byOff.has(v))return'C:'+byOff.get(v);
  if(v>=code&&v<code+4*ncode)return'CODE:'+(codeOrder&&codeOrder.has(v)?codeOrder.get(v):'external');
  if(v>=cl0&&v<clEnd){const idx=Math.floor((v-cl0)/0x2c),c=w.classes[idx];return c?'CREC:'+c.name:'CREC'}
  const str=S.str(v);if(str!==null)return'S:'+str;
  const rr=resOf(v);if(rr>=0&&v<code){const [rOff,type]=res[rr];
   if(type===0x113||type===0x115)return'R:'+type.toString(16)+':'+ri.key(rOff)+':'+(v-rOff);
   return'R:'+type.toString(16)+':'+ri.key(rOff)+':'+(v-rOff)+':'+blobDigest(rOff,depth+1,stack);
  }
  if(depth>10)return'DEEP';
  if(v>=0&&v<A.length)return'D:'+blobDigest(v,depth+1,stack);
  return'OUT';
 };
 // parseModels already resolves script/model descriptor ownership. Include
 // those model groups in the class identity so a same-named captain with a
 // different boss mesh/material set cannot be mistaken for the target's model.
 const modelByPart=new Map(),modelSigs=new Map();let modelAnalysisError=null;
 try{
  const modelData=parseModels(A,B);
  for(const M of modelData)if(M.poff){if(!modelByPart.has(M.poff))modelByPart.set(M.poff,[]);modelByPart.get(M.poff).push(M)}
  for(const g of modelData.modelGroups||[]){
   const members=[];
   for(const part of g.parts||[]){
    const rows=modelByPart.get(part.p)||[],M=rows.find(x=>x.off===part.m)||rows[0];
    let key='part';try{if(S.res.has(part.p))key=ri.key(part.p)}catch{}
    if(M)key+='|'+M.nv+'|'+(M.idx?M.idx.length:0);
    members.push(key);
   }
   if(!members.length)continue;
   const sig=[g.kind||'',g.name||'',members.length,members.join(';')].join('|');
   for(const name of g.classes||[]){if(!modelSigs.has(name))modelSigs.set(name,[]);modelSigs.get(name).push(sig)}
  }
 }catch(e){
  // A model parser regression must not disable dependency reports, but it
  // also must not make two unverified model signatures look identical.
  modelAnalysisError=String(e);
 }
 const out={},plural=(n,s)=>n+' '+s+(n>1?'s':'');
 w.classes.forEach((c,k)=>{try{const[a0,b0]=lo[k],roots=[c.entry];for(const[key,p]of c.events)if(p&&a0<p&&p<b0&&az.ins.has(p))roots.push(p);
  const every=new Set(),done=new Set(),pend=[...roots];let bytes=0;
  while(pend.length){const p=pend.pop();if(done.has(p)||!az.ins.has(p))continue;done.add(p);const[offs,calls]=az.reach([p]);offs.forEach(o=>every.add(o));for(const cc of calls)pend.push(cc)}
  const kinds={},cls=new Set(),strs=[],ptrs=[];
  for(const o of every){const i=az.ins.get(o);if(!i)continue;bytes+=4*i.size;for(let q=0;q<i.size;q++){const r=o+4*q;if(!w.rel.has(r))continue;const v=U(r);let t;
    if(byOff.has(v)){t='class';cls.add(byOff.get(v))}else if(v>=code&&v<code+4*ncode)t='code';else if(v>=cl0&&v<clEnd)t='class record';
    else{const s=v>=0x8c000&&v<code&&siCstr(A,v),rr=resOf(v);if(s&&/^[\x20-\x7e]{1,80}$/.test(s)&&A[v-1]===0){t='string';if(strs.length<8&&!strs.includes(s))strs.push(s)}else if(rr>=0&&v<code)t=KN[res[rr][1]]||('resource 0x'+res[rr][1].toString(16));else if(v>=clEnd&&v<ins)t='event/pool data';else if(v>=0x8c000&&v<code)t='level data';else t='other'}
    kinds[t]=(kinds[t]||0)+1;if(ptrs.length<400)ptrs.push([t,v,r])}}
  cls.delete(c.name);const reasons=[];
  for(const t in kinds){if(['class','code','string','event/pool data','texture','material','skeleton/animation','mesh part','mesh','vertex buffer','level data','other','sound','sound bank'].includes(t))continue;reasons.push(t==='level data'||t==='other'?'points at '+plural(kinds[t],'object')+' in the level data region (size unknown)':t==='class record'?'points inside a class record':'uses '+plural(kinds[t],t)+' of the source level')}
  const instructionOrder=new Map([...every].sort((a,b)=>a-b).map((off,i)=>[off,i]));
  const scriptRows=[...every].sort((a,b)=>a-b).map(o=>{const i=az.ins.get(o);if(!i)return'';const words=[];for(let q=0;q<i.size;q++){const p=o+4*q;words.push(w.rel.has(p)?'@'+targetToken(U(p),0,new Set(),instructionOrder):U(p).toString(16))}return i.size+':'+words.join(',')});
  const modelRows=(modelSigs.get(c.name)||[]).slice().sort();
  const fingerprint=modelAnalysisError?'analysis-error:model parser: '+modelAnalysisError:hashText('SCRIPT\\n'+scriptRows.join('\\n')+'\\nMODEL\\n'+modelRows.join('\\n'));
  out[c.name]={name:c.name,kinds,classes:[...cls],strs,bytes,reasons,ptrs,assets:reasons.length>0,fingerprint,modelFingerprint:modelAnalysisError?'analysis-error:'+modelAnalysisError:hashText(modelRows.join('\\n')),modelGroups:modelRows.length};
 }catch(e){out[c.name]={name:c.name,kinds:{},classes:[],strs:[],bytes:0,reasons:['analysis failed: '+e],assets:true,fingerprint:'analysis-error:'+String(e)}}});
 if(A&&typeof A==='object'){let cached=classReportCache.get(A);if(!cached){cached=new WeakMap();classReportCache.set(A,cached)}cached.set(B,out)}
 return out
}
// ---- data-object copier: copies the small linked records (level data region) a class points at into another wad
// Source view of a wad: pointer targets, resource starts, class records
function SrcCtx(A,B){const w=siWad(A,B),imp=fixups(B),U=w.U,h=imp[0x8000010e][0],code=U(h+0x10),res=new Map();
 for(const k in imp){if(k==='rel'||+k===0x8000010e||+k===0x80000117)continue;for(const o of imp[k])if(!res.has(o))res.set(o,+k&0xffff)}   // 0x117 carries a loader value (not an object): it must not cut the extent of the data it happens to sit in
 const st=new Set(res.keys());for(const r of w.rel)st.add(U(r));const starts=[...st].sort((a,b)=>a-b);
 const codeEnd=code+4*U(h+0x1c),ins0=U(h+0x28),cl0=U(h+0x14),clEnd=cl0+0x2c*w.classes.length,bindStart=Math.min(ins0,...w.classes.map(c=>U(c.off+0x1c)));
 return{A,B,w,imp,U,code,codeEnd,ins0,cl0,clEnd,bindStart,h,res,starts,classes:new Map(w.classes.map(c=>[c.off,c.name])),
  next(t){let lo=0,hi=starts.length;while(lo<hi){const m=(lo+hi)>>1;if(starts[m]<=t)lo=m+1;else hi=m}return starts[lo]},
  str(v){const s=v>0&&A[v-1]===0&&siCstr(A,v);return s&&/^[\x20-\x7e]{1,80}$/.test(s)&&A[v-1]===0?s:null}}}
// what a pointer target is: class / resource / string / data object (with its extent) / other
function classify(S,v){if(S.classes.has(v))return{k:'class',name:S.classes.get(v)};if(S.res.has(v))return{k:'res',type:S.res.get(v)};
 if(v>=S.code&&v<S.codeEnd)return{k:'code'};if(v>=S.clEnd&&v<S.bindStart){}else if(v>=S.codeEnd&&v<S.ins0)return{k:'other'};if(v<0x400)return{k:'other'};
 if(S.sizes&&S.sizes.has(v))return{k:'data',size:S.sizes.get(v)};const s=S.str(v);if(s!==null&&s.length>=2){let isPtr=false;for(let p=v&~3;p<=v+s.length;p+=4)if(S.w.rel.has(p))isPtr=true;if(!isPtr)return{k:'str',s}}const e=Math.min(S.next(v)??S.A.length,v+0x400,S.A.length);return{k:'data',size:e-v}}
// data-object closure from root pointers, in discovery order. Returns {objs:[{off,size,words:[{rel,v|target info}]}], leaves}
function dataClosure(S,roots){const objs=new Map(),order=[],q=[...roots];
 while(q.length){const t=q.shift();if(objs.has(t))continue;const c=classify(S,t);if(c.k!=='data'){objs.set(t,c);continue}
  const o={k:'data',off:t,size:c.size,ptrs:[]};objs.set(t,o);order.push(o);
  for(let p=t;p<t+c.size;p+=4)if(S.w.rel.has(p)){const v=S.U(p);o.ptrs.push([p-t,v]);q.push(v)}}
 return{objs,order}}
// canonical text of a closure (offsets replaced by discovery index) so closures from different wads can be compared. structure=ignore plain words
function canon(S,roots,structure){const cl=dataClosure(S,roots),idx=new Map(cl.order.map((o,i)=>[o.off,i])),out=[];
 for(const r of roots){const c=cl.objs.get(r);out.push('root:'+(c.k==='data'?'D'+idx.get(r):c.k))}
 for(const o of cl.order){const row=['D'+idx.get(o.off)+':'+o.size];const pm=new Map(o.ptrs);
  for(let p=0;p<o.size;p+=4){if(pm.has(p)){const v=pm.get(p),c=cl.objs.get(v);row.push(c.k==='data'?'->D'+idx.get(v):c.k==='res'?'->R'+c.type.toString(16):c.k==='class'?'->C'+c.name:c.k==='str'?'->S"'+c.s+'"':'->'+c.k)}
   else row.push(structure?'.':(o.size-p<4?(()=>{let v=0;for(let k=o.size-p-1;k>=0;k--)v=v*256+(S.A[o.off+p+k]||0);return v})():S.U(o.off+p)).toString(16))}out.push(row.join(' '))}
 return out.join('\n')}
// Builder: a growable copy of a wad to append data to
function Builder(A0,B0){const imp=fixups(B0),b={A:new Uint8Array(A0.length+65536),len:A0.length,rel:new Set(imp.rel),newRel:[],newSpec:[]};b.A.set(A0);b.d=new DataView(b.A.buffer);
 b.U=o=>b.d.getUint32(o,true);b.W=(o,v)=>b.d.setUint32(o,v>>>0,true);
 b.alloc=(n,al=16)=>{const p=Math.ceil(b.len/al)*al;if(p+n>b.A.length){const t=new Uint8Array(Math.max(b.A.length*2,p+n+65536));t.set(b.A);b.A=t;b.d=new DataView(t.buffer)}b.len=p+n;return p};
 b.addRel=o=>{if(!b.rel.has(o)){b.rel.add(o);b.newRel.push(o)}};
 b.addRelTo=(arr,o)=>{if(!b.rel.has(o)){b.rel.add(o);arr.push(o)}};
 b.addSpec=(kind,loc,rels)=>{b.newSpec.push({kind:(0x80000000|kind)>>>0,loc,rels})};
 b.finish=()=>({A:b.A.slice(0,b.len),B:mergeB(B0,b.newRel,b.newSpec)});return b}
// copy the closure of `roots` (source offsets) into builder bld. hooks.res(type,srcOff)->target offset, hooks.cls(name)->target class record offset.
// anything that cannot be resolved throws, so a copy is never half-made. Returns Map(srcOff -> newOff) for every pointer target.
function copyData(S,bld,roots,hooks){const cl=dataClosure(S,roots),map=new Map();
 for(const o of cl.order)map.set(o.off,bld.alloc(o.size,16));
 const strs=new Map(),mapT=v=>{if(map.has(v))return map.get(v);const c=cl.objs.get(v);let n;
  if(c.k==='class'){n=hooks.cls(c.name);if(n==null||n<0)throw'class '+c.name+' is not available in the target'}
  else if(c.k==='res'){n=hooks.res(c.type,v);if(n==null)throw'no equivalent of resource type 0x'+c.type.toString(16)+' @'+v.toString(16)+' in the target'}
  else if(c.k==='str'){if(strs.has(c.s))n=strs.get(c.s);else{n=bld.alloc(c.s.length+2,4)+1;for(let i=0;i<c.s.length;i++)bld.A[n+i]=c.s.charCodeAt(i);strs.set(c.s,n)}}
  else throw'unresolvable pointer ('+c.k+') @'+v.toString(16);map.set(v,n);return n};
 for(const o of cl.order){const n=map.get(o.off);bld.A.set(S.A.subarray(o.off,o.off+o.size),n);for(const[p,v]of o.ptrs){bld.W(n+p,mapT(v));bld.addRel(n+p)}}
 for(const r of roots)mapT(r);map.sizes=new Map(cl.order.map(o=>[map.get(o.off),o.size]));return map}
// ---- resource-adding copier. copyData() can only point a copied class at resources the target level already has.
// copyGraph() copies the missing ones too (textures, materials, meshes, parts, skeletons, level data), registers each one in the loader's
// fixup stream (mergeB keeps the stream's kind order: textures, materials, level data, skeletons, meshes, parts) and splits a prop's
// vertices/indices out of a shared mesh into a small mesh of its own, the way the game stores animated props.
const RES_COPY=new Set([1,4,5,6,7,8,0x21,0x22,0x23,0x24,0x113,0x115,0x118]);
const GROUP={0x113:0,0x115:1,0x118:1,0x10a:2,0x1:3,0x6:4,0x7:5,0x4:6,0x8:7,0x117:8,0x10e:9,0x24:10,0x23:10,0x21:11,0x5:11,0x22:11,0x402:12};
function mergeB(B0,newRel,specs){
 const w0=new Uint32Array(B0.buffer.slice(B0.byteOffset,B0.byteOffset+B0.byteLength)),ents=[];
 for(let i=0;i<w0.length;){const sp=w0[i]>=0x80000000;ents.push([i,sp?2:1,sp?w0[i]&0xffff:-1]);i+=sp?2:1}
 const ins=specs.map((s,n)=>{const g=GROUP[s.kind&0xffff];let at=ents.length;if(g!==undefined)for(let j=0;j<ents.length;j++){const t=ents[j][2];if(t>=0){const g2=GROUP[t];if(g2!==undefined&&g2>g){at=j;break}}}return{at,n,s,g:g===undefined?99:g}}).sort((a,b)=>a.at-b.at||a.g-b.g||a.n-b.n);
 const out=[];let k=0;const flush=at=>{while(k<ins.length&&ins[k].at===at){const s=ins[k++].s;out.push(s.kind>>>0,s.loc>>>0);for(const r of s.rels)out.push(r>>>0)}};
 for(let j=0;j<ents.length;j++){flush(j);const[i,n]=ents[j];for(let q=0;q<n;q++)out.push(w0[i+q])}
 flush(ents.length);for(const r of newRel)out.push(r>>>0);
 const nb=new Uint8Array(out.length*4),dv=new DataView(nb.buffer);out.forEach((w,i)=>dv.setUint32(4*i,w,true));return nb}
const resName=t=>KN[t]||('type 0x'+t.toString(16));
// hooks.res(type,srcOff) -> equivalent target offset (null/throw when the target has none); hooks.cls(name) -> target class record.
// opts.addRes: copy what the target lacks; opts.memo: Map(srcOff->newOff) shared between calls of one patch. Returns Map(srcOff->newOff).
function copyGraph(S,bld,roots,hooks,opts){opts=opts||{};const A=S.A,U=S.U,relS=S.w.rel,memo=opts.memo||new Map(),addRes=!!opts.addRes;
 const nodes=new Map(),order=[],units=[],groups=new Map(),splitOk={};
 const meshUse=S.meshUse||(S.meshUse=(()=>{const m=new Map();for(const k of[0x80000021,0x80000022])for(const p of S.imp[k]||[]){const t=U(p+12);if(!m.has(t))m.set(t,[]);m.get(t).push(p)}return m})());
 const tryHook=(ty,off)=>{if(!addRes)return hooks.res(ty,off);try{const n=hooks.res(ty,off);return n==null?null:n}catch(e){return null}};
 const ext=t=>Math.min(S.next(t)??A.length,A.length)-t,BIG=1<<23;
 const D=o=>S.U(o);
 // can the parts of mesh m be split out of it? every part must be a single draw range that stays inside its vertex range
 const splittable=m=>{if(m in splitOk)return splitOk[m];let ok=false;try{const ps=meshUse.get(m)||[];
   if(ps.length>1&&S.res.get(m)===0x24){const str=D(m+8),nv=D(m+12),vp=D(m+16),ni=D(m+20),ip=D(m+24);ok=str>=32&&nv>0&&ni>0&&vp+nv*str<=A.length&&ip+ni*2<=A.length;
    for(const p of ps){if(!ok)break;if(D(p+0x34)!==1||!relS.has(p+0x38)){ok=false;break}const a=D(p+0x38),vc=D(a+4),ic=D(a+8),rv=D(a+32),ri=D(a+36);
     if(!(ri+ic+2<=ni&&rv+vc<=nv&&vc>0)){ok=false;break}for(let j=ri;j<ri+ic+2;j++){const x=A[ip+2*j]|(A[ip+2*j+1]<<8);if(x<rv||x>=rv+vc){ok=false;break}}}}}catch(e){ok=false}
  return splitOk[m]=ok};
 // ---- phase A: discover what has to be copied
 const q=roots.map(r=>[r,null,0]);
 while(q.length){const[t,own,fs]=q.shift();if(nodes.has(t))continue;
  if(memo.has(t)){nodes.set(t,{k:'leaf',n:memo.get(t)});continue}
  const c=classify(S,t);
  if(c.k==='class'||c.k==='str'){nodes.set(t,c);continue}
  if(c.k==='res'){
   if(c.type===5&&addRes&&(S.res.get(t-16)===0x21||S.res.get(t-16)===0x22)&&ext(t-16)===16&&!nodes.has(t-16)){q.unshift([t-16,own,0]);q.push([t,own,0]);continue}   // the 64-byte record is the tail of a part: expand the part (head) first
   const n=tryHook(c.type,t);if(n!=null){nodes.set(t,{k:'leaf',n});if((c.type===0x21||c.type===0x22)&&ext(t)===16&&S.res.get(t+16)===5)nodes.set(t+16,{k:'leaf',n:n+16});continue}
   if(!addRes)throw'no equivalent of resource type 0x'+c.type.toString(16)+' @'+t.toString(16)+' in the target';
   if((c.type===0x113||c.type===0x115)&&!hooks.snd)throw'it uses sounds this level does not have; to copy sounds load the level\'s .avl (same name as the .vol) together with the .vol';
   if(!RES_COPY.has(c.type))throw'it needs '+resName(c.type)+' @'+t.toString(16)+', which this level does not have and which cannot be copied yet';
   let size=ext(t),extra=null,bank=null,ampcDeps=[];
   if(c.type===0x113){
    bank=bankInfo(A,t);
    if(!bank)throw'sound bank @'+t.toString(16)+' is not a valid RIFF resource';
    size=Math.ceil(bank.tot/4)*4;
    if(bank.kind==='AMPC'){
     // AMPC is an interactive music/effects bank, not a PCM stream descriptor.
     // Its amrf chunk lists GUIDs for WAVE/WAVS banks in this same LCS. Copy
     // those banks as dependencies so their stream bytes are transferred into
     // the destination PCA, while the AMPC's GUID references remain intact.
     ampcDeps=ampcSoundOffsets(S,t,bank);
     if(ampcDeps.length&&!hooks.snd)throw'AMPC sound bank @'+t.toString(16)+' needs its source .avl/.PCA to copy '+ampcDeps.length+' referenced sound(s)';
    }else if((bank.kind==='WAVE'||bank.kind==='WAVS')&&bank.strmAt!=null){
     if(!hooks.snd)throw'sound bank @'+t.toString(16)+' needs its source .avl/.PCA';
    }else throw'sound bank @'+t.toString(16)+' has unsupported format '+bank.kind;
    if(t+size>A.length)throw'sound bank @'+t.toString(16)+' runs past the end of the level';
   }
   if(c.type===0x115)size=Math.min(size,16);if((c.type===0x21||c.type===0x22)&&size===16&&S.res.get(t+16)===5){extra={type:5,at:16};size=16+ext(t+16)}
   if(size<=0||size>0x1000)throw resName(c.type)+' @'+t.toString(16)+' has an unexpected size ('+size+')';
   const nd={k:'res',type:c.type,off:t,size,ptrs:[],own:null,owned:[],deps:new Set(),extra,rels:[],kinds:[],bankKind:bank&&bank.kind};nodes.set(t,nd);order.push(nd);units.push(nd);
   if(extra)nodes.set(t+16,{k:'alias',parent:nd,delta:16});
   if(own){own.deps.add(nd)}
   // AMPC's amrf references are GUID-based rather than relocation pointers.
   // Make the matching source-level WAVE/WAVS bank explicit in the graph.
   for(const dep of ampcDeps)q.push([dep,nd,0]);
   for(let p=t;p<t+size;p+=4)if(relS.has(p)){const v=D(p),off=p-t;nd.ptrs.push([off,v]);
    if((nd.type===0x21||nd.type===0x22)&&off===0xc&&splittable(v)){let g=groups.get(v);if(!g){g={k:'group',m:v,parts:[],recs:[],deps:new Set(),rels:[],kinds:[]};groups.set(v,g);units.push(g)}g.parts.push(nd);nd.split=g;nd.deps.add(g);
     const a=D(t+0x38);nd.recOff=a;if(!g.recs.includes(a))g.recs.push(a);continue}
    let force=0;if(nd.type===1&&off===16){const tsz=D(t+20);if(tsz>0&&tsz<BIG&&ext(v)<tsz)force=tsz}
    if((nd.type===0x23||nd.type===0x24)&&(off===16||off===24)){const str=D(t+8),nv=D(t+12),ni=D(t+20);force=off===16?nv*str:ni*2;if(force<=0||force>BIG)throw resName(nd.type)+' @'+t.toString(16)+' has a bad buffer size'}
    q.push([v,nd,force])}
   continue}
  if(c.k==='data'){const ex=ext(t),lim=own?BIG:0x10000;
   // Large unowned level-data blocks are normally ambiguous: without a known
   // owner/layout, blindly copying them can absorb unrelated level state. A
   // pointer-free block is different. It is an opaque byte payload, so its
   // full extent can be copied safely without interpreting internal fields.
   // Keep the 8 MiB hard ceiling and retain the old rejection for any large
   // block containing relocations we cannot prove how to rewrite.
   let hasRelocs=false;if(!fs&&ex>lim&&ex<=BIG){for(let p=t;p<t+ex;p+=4)if(relS.has(p)){hasRelocs=true;break}}
   if(!fs&&ex>lim&&(ex>BIG||hasRelocs))throw'data @'+t.toString(16)+' is too large to copy safely ('+ex+' bytes)';const size=fs||ex;if(size<=0)throw'empty data object @'+t.toString(16);
   const nd={k:'data',off:t,size,ptrs:[],own,raw:!!fs};nodes.set(t,nd);order.push(nd);if(own)own.owned.push(nd);
   for(let p=t;p<t+size;p+=4)if(relS.has(p)){const v=D(p);nd.ptrs.push([p-t,v]);q.push([v,own,0])}
   continue}
  nodes.set(t,c)}
 // ---- phase B: allocate, copy, relocate
 const map=new Map(),strs=new Map(),W=(o,v)=>bld.W(o,v);
 for(const nd of order)map.set(nd.off,bld.alloc(nd.size,16));
 for(const nd of order)if(nd.k==='res'&&nd.extra)map.set(nd.off+16,map.get(nd.off)+16);
 // split meshes: one new mesh per shared mesh, holding exactly the vertex/index ranges of the parts being copied
 for(const g of groups.values()){const m=g.m,str=D(m+8),vp=D(m+16),ip=D(m+24),ranges=new Map(),slices=[];let nv2=0,ni2=0;
  g.info=g.recs.map(a=>{const vc=D(a+4),ic=D(a+8),rv=D(a+32),ri=D(a+36),key=rv+':'+vc;if(!ranges.has(key)){ranges.set(key,nv2);nv2+=vc}const r={a,vc,ic,rv,ri,vOff:ranges.get(key),iOff:ni2};ni2+=ic+2;return r});
  const total=0x30+nv2*str+ni2*2,base=bld.alloc(total,16);g.base=base;bld.A.set(A.subarray(m,m+0x30),base);const vb=base+0x30,ib=vb+nv2*str;
  W(base+12,nv2);W(base+16,vb);W(base+20,ni2);W(base+24,ib);
  for(const[key,vOff]of ranges){const[rv,vc]=key.split(':').map(Number);bld.A.set(A.subarray(vp+rv*str,vp+(rv+vc)*str),vb+vOff*str)}
  for(const r of g.info)for(let j=0;j<r.ic+2;j++){const x=(A[ip+2*(r.ri+j)]|(A[ip+2*(r.ri+j)+1]<<8))-r.rv+r.vOff;bld.A[ib+2*(r.iOff+j)]=x&255;bld.A[ib+2*(r.iOff+j)+1]=x>>8}
  g.recPatch=new Map(g.info.map(r=>[r.a,r]));g.spec={kind:0x24,loc:base};g.rels.push(base+16,base+24);for(const r of g.rels)bld.rel.add(r)}
 const mapT=v=>{if(map.has(v))return map.get(v);const c=nodes.get(v);let n;
  if(!c)throw'unresolved pointer @'+v.toString(16);
  if(c.k==='leaf')n=c.n;else if(c.k==='class'){n=hooks.cls(c.name);if(n==null||n<0)throw'class '+c.name+' is not available in the target'}
  else if(c.k==='str'){if(strs.has(c.s))n=strs.get(c.s);else{n=bld.alloc(c.s.length+2,4)+1;for(let i=0;i<c.s.length;i++)bld.A[n+i]=c.s.charCodeAt(i);strs.set(c.s,n)}}
  else if(c.k==='alias')n=map.get(c.parent.off)+c.delta;
  else throw'unresolvable pointer ('+c.k+') @'+v.toString(16);map.set(v,n);return n};
 const recOwner=new Map();for(const g of groups.values())for(const a of g.recs)recOwner.set(a,g);
 for(const nd of order){const to=map.get(nd.off);bld.A.set(A.subarray(nd.off,nd.off+nd.size),to);
  if(nd.k==='res'&&nd.type===0x113){const bi=bankInfo(A,nd.off);if(bi.strmAt!=null)W(to+(bi.strmAt-nd.off),hooks.snd.add({w:S.wadName,kind:bi.kind,off:bi.off,len:bi.len}));else if(bi.kind!=='AMPC')throw'sound bank @'+nd.off.toString(16)+' has no supported stream chunk'}
  const arr=nd.k==='res'?nd.rels:(nd.own?nd.own.rels:null);
  for(const[off,v]of nd.ptrs){const n=(nd.k==='res'&&nd.split&&off===0xc)?nd.split.base:mapT(v);W(to+off,n);if(arr)bld.addRelTo(arr,to+off);else bld.addRel(to+off)}
  if(nd.k==='data'&&recOwner.has(nd.off)){const r=recOwner.get(nd.off).recPatch.get(nd.off);W(to+32,r.vOff);W(to+36,r.iOff)}}
 // register resources in the loader's fixup stream, dependencies first
 const done=new Set(),emit=u=>{if(done.has(u))return;done.add(u);for(const d of u.deps)emit(d);
  if(u.k==='group'){bld.addSpec(0x24,u.base,u.rels);return}
  const base=map.get(u.off);if(u.extra){const a=u.rels.filter(r=>r<base+16),b=u.rels.filter(r=>r>=base+16);bld.addSpec(u.type,base,a);bld.addSpec(u.extra.type,base+16,b)}else bld.addSpec(u.type,base,u.rels)};
 for(const u of units)emit(u);
 for(const r of roots)mapT(r);
 for(const[k,v]of map)memo.set(k,v);
 map.sizes=new Map(order.filter(o=>o.k==='data').map(o=>[map.get(o.off),o.size]));
 map.stats={res:units.filter(u=>u.k==='res').length,meshes:groups.size,bytes:order.reduce((s,o)=>s+o.size,0)};return map}

// ---- name/content based identity of resources, so a copied class can point at the target level's own equivalent
// sounds: name + sample count + length (GUIDs differ per level); everything else: structural hash (bytes, with pointers replaced by the hash of what they point at)
// ---- sounds. A level's .PCA (in NN.avl) = [resident block, hdr78 bytes, "WAVE" banks packed back to back, offsets from the PCA start] [pad to 0x800]
// [streamed block, hdr7c bytes, "WAVS" banks (speech), 0x800-aligned, offsets from the (aligned) start of that block] [pad to 0x8000]. hdr78/hdr7c live at +0x78/+0x7c of the wad header in the .vol
// (verified on every level: sum of WAVE lengths == hdr78, end of the WAVS banks rounded to 0x800 == hdr7c; the exe computes the stream base as hdr78 rounded to 0x800).
function bankInfo(A,o){const d=new DataView(A.buffer,A.byteOffset,A.length);if(o<0||o+12>A.length||d.getUint32(o,true)!==0x46464952)return null;const tot=d.getUint32(o+4,true)+8,kind=String.fromCharCode(A[o+8],A[o+9],A[o+10],A[o+11]);
 let p=o+12,strmAt=null,off=0,len=0;while(p+8<=o+tot&&p+8<=A.length){const id=String.fromCharCode(A[p],A[p+1],A[p+2],A[p+3]),n=d.getUint32(p+4,true);if(id==='strm'){strmAt=p+8;off=d.getUint32(p+8,true);len=d.getUint32(p+12,true)}p+=8+n+(n&1)}
 return{kind,off,len,strmAt,tot}}
// Resolve the GUIDs carried by an AMPC music/effects descriptor to the WAVE/WAVS
// sound-bank resources in the same LCS. Those banks carry the actual PCA stream
// offsets and are copied through the regular SoundPlan path.
function riffChunks(A,o){
 const d=new DataView(A.buffer,A.byteOffset,A.length);
 if(o<0||o+12>A.length||d.getUint32(o,true)!==0x46464952)return null;
 const tot=d.getUint32(o+4,true)+8,end=o+tot;if(tot<12||end>A.length)return null;
 const kind=String.fromCharCode(A[o+8],A[o+9],A[o+10],A[o+11]),chunks={};let p=o+12;
 while(p+8<=end){const id=String.fromCharCode(A[p],A[p+1],A[p+2],A[p+3]),n=d.getUint32(p+4,true);if(p+8+n>end)return null;(chunks[id]||(chunks[id]=[])).push({at:p+8,n});p+=8+n+(n&1)}
 return{kind,tot,chunks};
}
const hexBytes=b=>Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');
function ampcSoundOffsets(S,o,info){
 const riff=riffChunks(S.A,o);if(!riff||riff.kind!=='AMPC')throw'AMPC bank @'+o.toString(16)+' is malformed';
 const refs=[];
 for(const ch of riff.chunks.amrf||[]){
  if(ch.n<4)throw'AMPC bank @'+o.toString(16)+' has a short amrf chunk';
  const d=new DataView(S.A.buffer,S.A.byteOffset,S.A.length),count=d.getUint32(ch.at,true),need=4+count*20;
  if(count>4096||need>ch.n)throw'AMPC bank @'+o.toString(16)+' has an invalid amrf reference count';
  for(let i=0;i<count;i++)refs.push(hexBytes(S.A.subarray(ch.at+4+i*20,ch.at+20+i*20)));
 }
 const byGuid=new Map();
 for(const[off,type]of S.res){if(type!==0x113||off===o)continue;const b=bankInfo(S.A,off);if(!b||(b.kind!=='WAVE'&&b.kind!=='WAVS'))continue;const r=riffChunks(S.A,off),g=r&&r.chunks.guid&&r.chunks.guid[0];if(g&&g.n===16){const key=hexBytes(S.A.subarray(g.at,g.at+16));if(!byGuid.has(key))byGuid.set(key,off)}}
 const out=[];
 for(const guid of refs){const off=byGuid.get(guid);if(off==null)throw'AMPC bank @'+o.toString(16)+' references sound GUID '+guid+' which is not present in '+(S.wadName||'the source LCS');if(!out.includes(off))out.push(off)}
 return out;
}
// An AMPC cue list (ampz, after its 'Music' marker) names the music cues;
// amrf contains GUID references to their WAVE/WAVS resources. Do not assume
// cue order equals GUID order: some volumes reorder the cue strings, and the
// Moon Base bank contains extra Odor variants beyond its five named cues.
function ampcTracks(S,o){
 const riff=riffChunks(S.A,o);if(!riff||riff.kind!=='AMPC')throw'AMPC bank @'+o.toString(16)+' is malformed';
 const strings=[];
 for(const ch of riff.chunks.ampz||[]){let start=ch.at;for(let p=ch.at;p<=ch.at+ch.n;p++)if(p===ch.at+ch.n||S.A[p]===0){if(p>start){const bytes=S.A.subarray(start,p);if(bytes.length<=160&&bytes.every(x=>x>=32&&x<127))strings.push(String.fromCharCode(...bytes))}start=p+1}}
 const marker=strings.findIndex(x=>x.toLowerCase()==='music'),cueNames=marker<0?[]:strings.slice(marker+1).filter(Boolean);
 const refs=ampcSoundOffsets(S,o),assets=refs.map(off=>{const b=parseBank(S.A,off),info=bankInfo(S.A,off);if(!b||!info)return null;const full=String(b.name||''),file=full.split(/[\\/]/).pop(),stem=file.replace(/\.[^.]*$/,'');return{off,kind:info.kind,name:full,file,stem,samples:b.samples||0,len:info.len}}).filter(Boolean);
 const norm=x=>String(x||'').toLowerCase().replace(/[^a-z0-9]/g,'');
 const used=new Set(),tracks=cueNames.map(cueName=>{
  const key=norm(cueName),exact=assets.filter(a=>norm(a.stem)===key),asset=exact.length===1?exact[0]:null;
  if(asset)used.add(asset.off);
  const related=asset?assets.filter(a=>a.off!==asset.off&&norm(a.stem).startsWith(key)&&/^\d/.test(norm(a.stem).slice(key.length))):[];
  return{cueName,bankOff:asset?asset.off:null,bankName:asset?asset.name:null,kind:asset?asset.kind:null,samples:asset?asset.samples:0,len:asset?asset.len:0,related:related.map(a=>({off:a.off,name:a.name,kind:a.kind})),ambiguous:exact.length>1,replaceable:!!asset&&!related.length};
 });
 return{cueNames,tracks,unmapped:assets.filter(a=>!used.has(a.off)).map(a=>({off:a.off,name:a.name,kind:a.kind,samples:a.samples,len:a.len}))};
}
// Convert and append user-imported audio as a game-native RIFF descriptor plus PCA stream.
function soundBase64Bytes(text){if(typeof text!=='string'||!text)throw'custom sound has no encoded ADPCM data';const bin=atob(text),out=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);return out}
function makeCustomSoundBank(asset,streamOff,streamLen){
 if(!asset||!['WAVE','WAVS'].includes(asset.kind))throw'custom sound must target a WAVE or WAVS bank';
 const channels=+asset.channels,rate=+asset.sampleRate,samples=+asset.samples;
 if((channels!==1&&channels!==2)||!Number.isInteger(rate)||rate<8000||rate>48000||!Number.isInteger(samples)||samples<1)throw'custom sound metadata is invalid';
 const guidHex=String(asset.guid||'');if(!/^[0-9a-f]{32}$/i.test(guidHex))throw'custom sound GUID is invalid';
 const guid=Uint8Array.from(guidHex.match(/../g),x=>parseInt(x,16));
 const bankName=String(asset.bankName||'custom_sound.wav');if(!/^[ -~]{1,48}$/.test(bankName))throw'custom sound bank name must be printable ASCII';
 const blockAlign=36*channels,fmt=new Uint8Array(20),fd=new DataView(fmt.buffer);
 fd.setUint16(0,0x0069,true);fd.setUint16(2,channels,true);fd.setUint32(4,rate,true);fd.setUint32(8,Math.round(rate*blockAlign/64),true);fd.setUint16(12,blockAlign,true);fd.setUint16(14,4,true);fd.setUint16(16,2,true);fd.setUint16(18,64,true);
 const u32=x=>{const b=new Uint8Array(4);new DataView(b.buffer).setUint32(0,x>>>0,true);return b};
 const chunk=(tag,body)=>{const out=new Uint8Array(8+body.length+(body.length&1));for(let i=0;i<4;i++)out[i]=tag.charCodeAt(i);new DataView(out.buffer).setUint32(4,body.length,true);out.set(body,8);return out};
 const nameBytes=new TextEncoder().encode(bankName+'\0');
 const chunks=[chunk('guid',guid),chunk('name',nameBytes),chunk('fmt ',fmt),chunk('fact',u32(samples)),chunk('strm',new Uint8Array([...u32(streamOff),...u32(streamLen)]))];
 const total=12+chunks.reduce((n,b)=>n+b.length,0),out=new Uint8Array(total),d=new DataView(out.buffer);
 out.set([82,73,70,70],0);d.setUint32(4,total-8,true);for(let i=0;i<4;i++)out[8+i]=asset.kind.charCodeAt(i);let at=12;for(const b of chunks){out.set(b,at);at+=b.length}return out;
}
// where the audio of banks goes in the target's PCA; add() copies an existing stream, addCustom() inserts encoded project audio.
function SoundPlan(h78,h7c){const p={h78,h7c,h78_0:h78,h7c_0:h7c,adds:[],seen:new Map(),add(r){const key=r.w+'|'+r.kind+'|'+r.off+'|'+r.len;if(p.seen.has(key))return p.seen.get(key);let n;
  if(r.kind==='WAVE'){n=p.h78;p.h78+=r.len}else if(r.kind==='WAVS'){n=p.h7c;p.h7c+=Math.ceil(r.len/0x800)*0x800}else throw'sound bank type '+r.kind+' is not supported';
  p.adds.push({...r,newOff:n});p.seen.set(key,n);return n},addCustom(asset){const key='custom|'+asset.id;if(p.seen.has(key))return p.seen.get(key);const data=soundBase64Bytes(asset.adpcm),kind=asset.kind;if(data.length===0||data.length%(36*(+asset.channels)))throw'custom sound ADPCM stream is not block-aligned';let n;
  if(kind==='WAVE'){n=p.h78;p.h78+=data.length}else if(kind==='WAVS'){n=p.h7c;p.h7c+=Math.ceil(data.length/0x800)*0x800}else throw'custom sound storage type '+kind+' is not supported';
  const place={off:n,len:data.length,kind};p.adds.push({kind,off:n,len:data.length,newOff:n,data,customId:asset.id});p.seen.set(key,place);return place}};return p}
// new PCA bytes: old resident block + copied WAVE data, then the streamed block (moved to the new aligned base) + copied WAVS data. src(w)->{pca,h78} of the level the sound comes from
function buildPca(old,plan,src){const al=x=>Math.ceil(x/0x800)*0x800,oldBase=al(plan.h78_0),newBase=al(plan.h78),size=Math.max(old.length,Math.ceil((newBase+plan.h7c)/0x8000)*0x8000),out=new Uint8Array(size);
 out.set(old.subarray(0,plan.h78_0),0);out.set(old.subarray(oldBase,oldBase+plan.h7c_0),newBase);
 for(const a of plan.adds){const to=a.kind==='WAVE'?a.newOff:newBase+a.newOff;if(a.data instanceof Uint8Array){out.set(a.data,to);continue}const s=src(a.w);if(!s)throw'sound source '+a.w+' not found';const from=a.kind==='WAVE'?a.off:al(s.h78)+a.off;if(from+a.len>s.pca.length)throw'sound data of '+a.w+' is outside its .PCA';out.set(s.pca.subarray(from,from+a.len),to)}
 return out}
function parseBank(A,o){const d=new DataView(A.buffer,A.byteOffset,A.length);if(o+12>A.length||d.getUint32(o,true)!==0x46464952)return null;const tot=d.getUint32(o+4,true)+8,ch={};let p=o+12;
 while(p+8<=o+tot&&p+8<=A.length){const id=String.fromCharCode(A[p],A[p+1],A[p+2],A[p+3]),n=d.getUint32(p+4,true);ch[id]={at:p+8,n};p+=8+n+(n&1)}
 const r={};r.name=ch.name?String.fromCharCode(...A.subarray(ch.name.at,ch.name.at+ch.name.n)).replace(/\0.*/,''):'';if(ch.strm){r.off=d.getUint32(ch.strm.at,true);r.len=d.getUint32(ch.strm.at+4,true)}if(ch.fact)r.samples=d.getUint32(ch.fact.at,true);return r}
function ResIndex(S){const A=S.A,U=S.U,memo=new Map(),SOUND=[0x113,0x115];let nodes=0;
 const soundKey=o=>{const b=parseBank(A,o);return b?'snd:'+b.name+'|'+b.samples+'|'+b.len:'snd:?'+o};
 const hashAt=(o,depth)=>{if(memo.has(o))return memo.get(o);const t=S.res.get(o);if(t===0x115)return soundKey(U(o));if(t===0x113)return soundKey(o);
  if(depth>400)return'deep';memo.set(o,'cyc');const e=Math.min(S.next(o)??A.length,A.length);let hh=2166136261;const len=e-o;
  for(let p=o;p+4<=e;p+=4){let v=U(p);if(S.w.rel.has(p)){const th=hashAt(v,depth+1);let x=0;for(let i=0;i<th.length;i++)x=Math.imul(x^th.charCodeAt(i),16777619);v=x}hh^=v;hh=Math.imul(hh,16777619)}
  nodes++;const r=(hh>>>0).toString(16)+':'+len;memo.set(o,r);return r};
 // object meshes are identified by their geometry (vertex + index bytes), parts by mesh + material, skeletons by their bone names
 const fnvB=(lo,n)=>{let h=2166136261;for(let i=0;i<n;i++){h^=A[lo+i];h=Math.imul(h,16777619)}return(h>>>0).toString(16)};
 const meshKey=m=>{const str=U(m+8),nv=U(m+12),vp=U(m+16),ni=U(m+20),ip=U(m+24);if(!nv||!ni||vp+nv*str>A.length||ip+2*ni>A.length)return null;return'mesh:'+nv+':'+ni+':'+fnvB(vp,nv*str)+fnvB(ip,2*ni)};
 const inlineNames=o=>{const e=Math.min(S.next(o)??A.length,o+0x200,A.length),out=[];for(let p=o;p<e;p++){let q=p;while(q<e&&((A[q]>=65&&A[q]<=90)||(A[q]>=97&&A[q]<=122)||(A[q]>=48&&A[q]<=57)||A[q]===32||A[q]===95||A[q]===46))q++;if(q-p>=4&&(q>=e||A[q]===0)){out.push(String.fromCharCode(...A.subarray(p,q)));p=q}}return out.join('/')};
 // a sound handle (0x115) and the bank it points at (0x113) must NOT share a key: matching a handle to an existing bank made the copy point at raw audio data (crash when the sound plays)
 const key=o=>{const t=S.res.get(o);if(t===0x115)return 'h115:'+hashAt(o,0);if(t===0x113)return hashAt(o,0);
  if(t===0x24){const k=meshKey(o);if(k)return k}
  if(t===0x21||t===0x22){const m=U(o+12);if(S.res.get(m)===0x24){const k=meshKey(m);if(k)return 'part:'+k+'|'+hashAt(U(o+16),0)}}
  if(t===0x8){const nm=inlineNames(o);if(nm)return 'anim:'+nm+'|'+(S.next(o)-o)}
  return 't'+(t||0).toString(16)+':'+hashAt(o,0)};
 const map=new Map();for(const[o,t]of S.res)if([1,6,7,8,0x21,0x22,0x23,0x24,0x113,0x115].includes(t)){const k=key(o);if(!map.has(k))map.set(k,o)}
 const describe=o=>{const t=S.res.get(o);if(t===0x115||t===0x113){const b=parseBank(A,t===0x115?U(o):o);return 'sound '+(b?b.name:'?')}
  let nm='';for(let p=o;p<Math.min(o+0x80,A.length);p++){let q=p;while(q<A.length&&A[q]>=32&&A[q]<127)q++;if(q-p>=4&&A[q]===0){nm=String.fromCharCode(...A.subarray(p,q));break}}
  return (EC_KN[t]||'resource 0x'+(t||0).toString(16))+(nm?' "'+nm+'"':'')};
 return{key,map,describe}}
const EC_KN={1:'texture',4:'level data',6:'material',7:'material',8:'skeleton/animation',0x20:'draw part',0x21:'mesh part',0x22:'mesh part',0x23:'vertex buffer',0x24:'mesh',0x113:'sound bank',0x115:'sound'};
// hook for transplantClasses/copyData: resources are looked up in the target by name/content
function resResolver(S,T){const si=ResIndex(S),ti=ResIndex(T);return{hook:(type,off)=>{const to=ti.map.get(si.key(off));if(to==null)throw'it needs '+si.describe(off)+', which this level does not have';if((type===0x113||type===0x115)&&T.res.get(to)!==type)throw'internal: the sound equivalent found for '+si.describe(off)+' has a different resource type';return to},si,ti}}
// ---- class transplant: copy whole code blocks (with every class that lives in them), their class records and event segments into another wad
// Layout facts verified on all level wads: a class's code lies entirely inside the block its record names (+0x0c); classes are stored in ascending code order;
// event ranges can overlap as inherited suffixes, while per-class lists (+0x1c) are flat-table segments. Same-LCS clones retain each class's exact event range.
// The code region, the event table + class table, and the per-class list + instance table are each copied to the end of the wad (extended there) and every pointer into the old copies is retargeted.
function groupOf(S,names){const cls=S.w.classes,by=new Map();cls.forEach((c,i)=>{const b=S.U(c.off+0xc);if(!by.has(b))by.set(b,[]);by.get(b).push(i)});const sel=new Set();
 for(const n of names){const i=cls.findIndex(c=>c.name===n);if(i<0)throw'class '+n+' not found in the source level';for(const j of by.get(S.U(cls[i].off+0xc)))sel.add(j)}
 return[...sel].sort((a,b)=>cls[a].entry-cls[b].entry)}
// copies the requested classes plus every class they (transitively) use that the target does not have: the copier reports the first missing one, it is added and the copy retried
function transplantClasses(A0,B0,S,names,hooks,opt){names=[...names];
 for(let n=0;n<64;n++){try{return transplantOnce(A0,B0,S,names,hooks,opt)}catch(e){const m=/^class (\S+) is not available in the target$/.exec(String(e));
  if(!m||names.includes(m[1])||!S.w.classes.some(c=>c.name===m[1]))throw e;names.push(m[1])}}
 throw'too many dependent classes'}
function transplantOnce(A0,B0,S,names,hooks,opt){opt=opt||{};const bld=Builder(A0,B0),U=bld.U,W=bld.W,H=o=>bld.d.getUint16(o,true),imp=fixups(B0),h=imp[0x8000010e][0];
 const code=U(h+0x10),ncode=U(h+0x1c),cl0=U(h+0x14),ncl=U(h+0x20),ins=U(h+0x28),nin=H(h+0x30),lnk=U(h+0x2c),nlk=H(h+0x32),clEnd=cl0+ncl*0x2c,codeEnd=code+4*ncode,insEnd=ins+nin*0x3c,lnkEnd=lnk+4*nlk;
 const tcls=[];for(let i=0;i<ncl;i++){const o=cl0+i*0x2c;tcls.push({off:o,name:siCstr(A0,U(o+4)),ev0:U(o+0x24),st0:U(o+0x28),bind:U(o+0x1c),pool:U(o+0x20)})}
 const evLo=Math.min(cl0,...tcls.map(c=>c.ev0)),bindStart=Math.min(ins,...tcls.map(c=>c.bind));
 const grp=groupOf(S,names).map(i=>S.w.classes[i]);
 for(const c of grp){const collision=tcls.some(t=>t.name===c.name),alias=opt.aliases&&opt.aliases[c.name];
  if(collision&&(!opt.allowDup||!alias))throw'class '+c.name+' already exists in the target (a private alias is required to preserve this source variant)';
  if(alias&&tcls.some(t=>t.name===alias))throw'class alias '+alias+' already exists in the target'}
 const blocks=[...new Set(grp.map(c=>S.U(c.off+0xc)))].sort((a,b)=>a-b).map(bs=>S.w.blocks.find(([p])=>p===bs)).map(([p,n])=>({p,n}));
 for(const bk of blocks)if(!bk)throw'class block not found';
 // 1) new region addresses
 const newWords=blocks.reduce((s,b)=>s+b.n,0),codeNew=bld.alloc((ncode+newWords)*4,16);
 // source event segments of the group (all group classes share one segment [ev0, next larger ev0))
 const sEv0=[...new Set(S.w.classes.map(c=>S.U(c.off+0x24)))].sort((a,b)=>a-b),sEvEnd=S.cl0,segs=[];
 const inGrp=v=>blocks.some(b=>v>=b.p&&v<b.p+4*b.n);
 // When the class is cloned within the same LCS, event handlers outside its
 // own code block are still valid dependencies: the original code is moved
 // with the rest of that LCS and the relocation pass below retargets pointers
 // into it. Keep the complete event segment instead of silently dropping
 // those external handler slots. Cross-LCS transplants retain the conservative
 // in-group-only behaviour because an external source code pointer is unsafe.
 const segStart=new Map(),classSegStart=new Map(),classSegLength=new Map();
 if(opt.preserveExternalEvents){
  // Same-LCS classes can inherit a suffix of another class's event list. The
  // exact range for each class is [events_start, class+0x28), not merely up to
  // the next class's events_start. Copy each distinct range in full so a
  // private clone retains every event slot, including handlers implemented
  // by other original classes in this same code region.
  const byRange=new Map();
  for(const c of grp){const start=S.U(c.off+0x24),end=S.U(c.off+0x28),key=start+':'+end;
   let at=byRange.get(key);if(at==null){at=segs.length;byRange.set(key,at);for(let p=start;p<end;p+=8)segs.push([S.U(p),S.U(p+4),start])}
   classSegStart.set(c.off,at);classSegLength.set(c.off,(end-start)/8);
  }
 }else{
  for(const g of [...new Set(grp.map(c=>S.U(c.off+0x24)))].sort((a,b)=>a-b)){const e=sEv0.find(v=>v>g)??sEvEnd;segStart.set(g,segs.length);for(let p=g;p<e;p+=8)if(inGrp(S.U(p+4)))segs.push([S.U(p),S.U(p+4),g])}
 }
 const evOldBytes=cl0-evLo,evNewBytes=segs.length*8,statBytes=(Math.max(0,...grp.map(c=>S.U(c.off+0x10)>>>16))*4+15)&~15,ecNew=bld.alloc(evOldBytes+evNewBytes+statBytes+(ncl+grp.length)*0x2c,16),clsNew=ecNew+evOldBytes+evNewBytes+statBytes,statNew=ecNew+evOldBytes+evNewBytes;
 // source per-class list segments
 const sBind=S.bindStart,sIns=S.ins0,bvals=[...new Set(S.w.classes.map(c=>S.U(c.off+0x1c)))].sort((a,b)=>a-b);
 const gb=grp.map(c=>S.U(c.off+0x1c)),gMin=Math.min(...gb.filter(v=>v<sIns),sIns),gMax=Math.max(...gb.filter(v=>v<sIns),-1),gEnd=gMax<0?gMin:(bvals.find(v=>v>gMax)??sIns);
 const bindOldBytes=ins-bindStart,bindNewBytes=gEnd-gMin,bindNew=bld.alloc(bindOldBytes+bindNewBytes+nin*0x3c+nlk*4,16),insNew=bindNew+bindOldBytes+bindNewBytes,lnkNew=insNew+nin*0x3c;
 // 2) copy the old regions
 const cp=(lo,hi,to)=>{bld.A.copyWithin(to,lo,hi);for(const r of [...bld.rel])if(r>=lo&&r<hi)bld.addRel(to+r-lo)};
 cp(code,codeEnd,codeNew);cp(evLo,cl0,ecNew);cp(cl0,clEnd,clsNew);cp(bindStart,ins,bindNew);cp(ins,insEnd,insNew);cp(lnk,lnkEnd,lnkNew);
 // 3) new blocks (copied after the old code), source block address -> new address
 const bmap=new Map();let cursor=codeNew+ncode*4;for(const b of blocks){bmap.set(b.p,cursor);cursor+=4*b.n}
 const mapCode=v=>{for(const b of blocks)if(v>=b.p&&v<b.p+4*b.n)return bmap.get(b.p)+(v-b.p);return null};
 // new class record addresses
 const newRec=new Map();grp.forEach((c,i)=>newRec.set(c.off,clsNew+(ncl+i)*0x2c));
 // every non-code pointer in the new blocks is resolved by the data copier (strings, level data, pool data, resources, classes)
 const roots=[];for(const b of blocks)for(let p=b.p;p<b.p+4*b.n;p+=4)if(S.w.rel.has(p)){const v=S.U(p),k=classify(S,v).k;if(k!=='code'&&!newRec.has(v))roots.push(v)}
 const pmap=hooks.addRes?copyGraph(S,bld,[...new Set(roots)],hooks,{addRes:true}):copyData(S,bld,[...new Set(roots)],hooks);
 for(const b of blocks){const to=bmap.get(b.p);bld.A.set(S.A.subarray(b.p,b.p+4*b.n),to);
  for(let p=b.p;p<b.p+4*b.n;p+=4){if(!S.w.rel.has(p))continue;const v=S.U(p),q=to+(p-b.p);let n;
   if(newRec.has(v))n=newRec.get(v);else{const k=classify(S,v).k;if(k==='code'){n=mapCode(v);if(n==null)throw'code in block @'+b.p.toString(16)+' points outside the copied blocks'}else n=pmap.get(v);if(n==null)throw'unresolved pointer in block @'+b.p.toString(16)}
   bld.W(q,n);bld.addRel(q)}}
 // 4) new events (key unchanged, handler -> new code)
 const evStart=ecNew+evOldBytes;segs.forEach(([key,hd],i)=>{const o=evStart+i*8;W(o,key);const mapped=hd?mapCode(hd):0,n=mapped==null&&hd&&opt.preserveExternalEvents?hd:mapped;if(hd&&n==null)throw'event handler outside the copied blocks';W(o+4,n||0);if(n)bld.addRel(o+4)});
 // 5) new class records
 const poolVal=tcls.length?tcls[0].pool:evLo;
 const sPoolLo=Math.min(...S.w.classes.map(c=>S.U(c.off+0x20))),sEvLo=Math.min(S.cl0,...sEv0),poolOk=p=>p>=sPoolLo&&p<sEvLo&&sEvLo-sPoolLo<=0x10000,poolNew=grp.some(c=>poolOk(S.U(c.off+0x20)))?bld.alloc(sEvLo-sPoolLo,4):0;
 if(poolNew)bld.A.set(S.A.subarray(sPoolLo,sEvLo),poolNew);   // event-name strings (key>>16 indexes them): the new classes keep their own
 grp.forEach((c,i)=>{const o=clsNew+(ncl+i)*0x2c;for(let k=0;k<0x2c;k+=4)W(o+k,S.U(c.off+k));
  W(o,h);bld.addRel(o);const nm=(opt.aliases&&opt.aliases[c.name])||c.name,ns=bld.alloc(nm.length+2,4)+1;for(let q=0;q<nm.length;q++)bld.A[ns+q]=nm.charCodeAt(q);W(o+4,ns);bld.addRel(o+4);
  W(o+8,mapCode(c.entry));bld.addRel(o+8);W(o+0xc,bmap.get(S.U(c.off+0xc)));bld.addRel(o+0xc);
  const sb=S.U(c.off+0x1c);W(o+0x1c,sb>=sIns?insNew:bindNew+bindOldBytes+(sb-gMin));bld.addRel(o+0x1c);
  const sp=S.U(c.off+0x20),sg=S.U(c.off+0x24);W(o+0x20,poolNew&&poolOk(sp)?poolNew+(sp-sPoolLo):poolVal);bld.addRel(o+0x20);
  const evAt=opt.preserveExternalEvents?classSegStart.get(c.off):segStart.get(sg),evLen=opt.preserveExternalEvents?classSegLength.get(c.off):null;
  W(o+0x24,evStart+8*(evAt==null?segs.length:evAt));bld.addRel(o+0x24);
  W(o+0x28,opt.preserveExternalEvents?evStart+8*((evAt==null?segs.length:evAt)+(evLen||0)):statNew);bld.addRel(o+0x28)});
 for(let i=0;i<bindNewBytes;i+=4){if(S.w.rel.has(gMin+i))throw'per-class list contains pointers';W(bindNew+bindOldBytes+i,S.U(gMin+i))}
 // 6) retarget every pointer into the old copies of the moved regions
 const R=[[code,codeEnd,codeNew-code],[evLo,cl0,ecNew-evLo],[cl0,clEnd,clsNew-cl0],[bindStart,ins,bindNew-bindStart],[ins,insEnd,insNew-ins],[lnk,lnkEnd,lnkNew-lnk]];
 const keep=new Set();for(let i=0;i<ncl;i++){keep.add(clsNew+i*0x2c+0x20)}   // event-name pool base stays where it was
 for(const r of [...bld.rel]){if(keep.has(r))continue;const v=U(r);for(const[lo,hi,dl]of R)if(v>=lo&&v<hi){W(r,v+dl);break}}
 // old classes: segment ends move with the tables (events end == class table start; lists end == instance table start)
 // (old classes keep their +0x28: it points at their zero-initialised static variables, which were copied with the region)
 for(let i=0;i<ncl;i++){const o=clsNew+i*0x2c;if(tcls[i].bind>=ins)W(o+0x1c,bindNew+bindOldBytes);if(tcls[i].ev0>=cl0)W(o+0x24,evStart);if(tcls[i].st0===cl0)W(o+0x28,evStart)}   // ranges that ended at the class table now end where the old events end (the new classes' events must not become theirs)   // empty segments at the old end now start where the new ones begin
 // header
 W(h+0x10,codeNew);W(h+0x1c,ncode+newWords);W(h+0x14,clsNew);W(h+0x20,ncl+grp.length);W(h+0x28,insNew);W(h+0x2c,lnkNew);
 const r=bld.finish();r.classes=grp.map(c=>(opt.aliases&&opt.aliases[c.name])||c.name);r.sourceClasses=grp.map(c=>c.name);return r}
// ---- per-level resource directory. The game does not find textures/meshes through the parts that use them: every level has a directory
// {ntex @p-4, *texTable @p, nmesh @p+4, *meshTable @p+8} and creates the D3D textures / vertex+index buffers only for what these tables list
// (all kind-1 textures; all kind-0x24 meshes plus the kind-0x23 vertex-buffer object). Verified equal to the real counts in every untouched level.
// A copied texture/mesh that is not listed is never created: the part draws with the previously bound stream (another model's parts), no texture, or crashes.
// Appends only newly imported resources (keeps the table address-sorted when it was), removes stale entries, and bumps the counts. Existing unlisted imports remain untouched.
function healResDir(A0,B0,baselineB=B0){
 const n0=A0.length,d0=new DataView(A0.buffer,A0.byteOffset,A0.byteLength),U0=o=>(o>=0&&o+4<=n0)?d0.getUint32(o,true):0;
 let B=B0,imp=fixups(B),invalidVertexResources=[];
 const rawVertexTargets=new Set();
 for(const m of imp[0x80000024]||[])if(imp.rel.has(m+16))rawVertexTargets.add(U0(m+16));
 // Kind 0x23 is a structured PC vertex-buffer resource, not a raw vertex
 // array. A previous custom-model build incorrectly registered the mesh's
 // +0x10 byte-array pointer as kind 0x23. The loader then treats the first
 // float as the object's vtable and also puts that bogus address in the level
 // resource directory. Remove only malformed 0x23 import records; keep native
 // kind-0x23 objects (class pointer +0x10/+0x18 data links) untouched.
 const vb23=imp[0x80000023]||[];
 for(const o of vb23){
  const inRange=o>=0&&o+0x20<=n0;
  const nativeHeader=inRange&&U0(o)===0x0054bbd8&&imp.rel.has(o+0x10)&&imp.rel.has(o+0x18);
  if(!nativeHeader||rawVertexTargets.has(o))invalidVertexResources.push(o);
 }
 if(invalidVertexResources.length){
  const bad=new Set(invalidVertexResources),src=new DataView(B.buffer,B.byteOffset,B.byteLength),words=[];
  for(let i=0;i+4<=B.length;){
   const x=src.getUint32(i,true);
   if(x>=0x80000000){
    if(i+8>B.length)throw'malformed resource-import record in LCS fixup stream';
    const loc=src.getUint32(i+4,true);
    if(x!==0x80000023||!bad.has(loc))words.push(x,loc);
    i+=8;
   }else{words.push(x);i+=4}
  }
  const out=new Uint8Array(words.length*4),od=new DataView(out.buffer);words.forEach((v,i)=>od.setUint32(i*4,v,true));B=out;imp=fixups(B);
 }
 const tex=imp[0x80000001]||[],mesh=(imp[0x80000024]||[]).concat(imp[0x80000023]||[]),texSet=new Set(tex),meshSet=new Set(mesh);
 // A level may intentionally import alternate-model resources which are not
 // members of its runtime D3D resource directory (10-00.LCS has such a pair
 // for RanxInLiquidCapsule's Hang_Rax variants). Preserve that native policy:
 // append only resources introduced since the unmodified level's fixup stream,
 // while still pruning stale directory entries and malformed legacy imports.
 const baseImp=fixups(baselineB||B0),baseTex=new Set(baseImp[0x80000001]||[]),baseMesh=new Set([...(baseImp[0x80000024]||[]),...(baseImp[0x80000023]||[])]);
 const addedTex=tex.filter(v=>!baseTex.has(v)),addedMesh=mesh.filter(v=>!baseMesh.has(v));
 const cands=[];
 for(const p of imp.rel){
  if(p<8||p+12>n0||!imp.rel.has(p+8))continue;
  const t=U0(p),nt=U0(p-4),mt=U0(p+8),nm=U0(p+4);
  if(!(nt>=1&&nt<=tex.length+512&&nm>=1&&nm<=mesh.length+512&&t>0&&t%4===0&&t+4*nt<=n0&&mt>0&&mt%4===0&&mt+4*nm<=n0))continue;
  const measure=(ptr,count,valid)=>{
   let good=0,dupes=0;const seen=new Set();
   for(let i=0;i<count;i++){const v=U0(ptr+4*i);if(valid.has(v)){if(seen.has(v))dupes++;else good++;seen.add(v)}}
   return{good,dupes,ratio:good/Math.max(1,count)};
  };
  const a=measure(t,nt,texSet),b=measure(mt,nm,meshSet);
  // Permit a small number of stale entries from older builds, but require a
  // strong match on both arrays so unrelated pointer tables are not selected.
  if(a.ratio<0.90||b.ratio<0.90||a.dupes>2||b.dupes>2)continue;
  cands.push({p,t,nt,mt,nm,score:a.ratio+b.ratio+(a.good/Math.max(1,tex.length))+(b.good/Math.max(1,mesh.length))});
 }
 if(!cands.length)return{A:A0,B,added:{tex:0,mesh:0},removed:{tex:0,mesh:0,invalidVertexResources:invalidVertexResources.length},dir:null};
 cands.sort((a,b)=>b.score-a.score);
 if(cands.length>1&&Math.abs(cands[0].score-cands[1].score)<0.01)throw'resource directory is ambiguous';
 const dir=cands[0].p,bld=Builder(A0,B);let totalAdded={tex:0,mesh:0},totalRemoved={tex:0,mesh:0};
 const fix=(countOff,ptrOff,all,additions)=>{
  const n=bld.U(countOff),old=bld.U(ptrOff),valid=new Set(all),cur=[];
  for(let i=0;i<n;i++)cur.push(bld.U(old+4*i));
  const seen=new Set(),kept=[];let removed=0;
  for(const v of cur){if(!valid.has(v)||seen.has(v)){removed++;continue}seen.add(v);kept.push(v)}
  const missing=additions.filter(v=>valid.has(v)&&!seen.has(v));
  const sorted=cur.every((v,i)=>!i||v>=cur[i-1]);
  const final=sorted?kept.concat(missing).sort((a,b)=>a-b):kept.concat(missing);
  const changed=final.length!==cur.length||final.some((v,i)=>v!==cur[i]);
  if(!changed)return{added:0,removed:0};
  if(final.length<=n){
   final.forEach((v,i)=>{const slot=old+4*i;bld.W(slot,v);bld.addRel(slot)});
   bld.W(countOff,final.length);
  }else{
   const np=bld.alloc(final.length*4,16);
   final.forEach((v,i)=>{bld.W(np+4*i,v);bld.addRel(np+4*i)});
   bld.W(ptrOff,np);bld.addRel(ptrOff);bld.W(countOff,final.length);
  }
  return{added:missing.length,removed};
 };
 const t=fix(dir-4,dir,tex,addedTex),m=fix(dir+4,dir+8,mesh,addedMesh);totalAdded={tex:t.added,mesh:m.added};totalRemoved={tex:t.removed,mesh:m.removed,invalidVertexResources:invalidVertexResources.length};
 if(!totalAdded.tex&&!totalAdded.mesh&&!totalRemoved.tex&&!totalRemoved.mesh&&!invalidVertexResources.length)return{A:A0,B:B0,added:totalAdded,removed:totalRemoved,dir};
 const r=bld.finish();return{A:r.A,B:r.B,added:totalAdded,removed:totalRemoved,dir};
}
// self-test of the data copier on any set of strat wads [{name,A,B}]: for every class present (with data objects) in 2+ wads, copy its closure from one wad into another and compare
function copierSelfTest(wads,progress){const W={};for(const x of wads){try{const S=SrcCtx(x.A,x.B);W[x.name]={A:x.A,B:x.B,S,rep:classReports(x.A,x.B)}}catch(e){}}
 const rootsOf=(x,cn)=>{const r=x.rep[cn];if(!r)return[];const seen=new Set(),out=[];for(const[k,v]of r.ptrs){if(seen.has(v))continue;seen.add(v);if(classify(x.S,v).k==='data')out.push(v)}return out};
 const byClass={};for(const[n,x]of Object.entries(W))for(const cn in x.rep)if(rootsOf(x,cn).length)(byClass[cn]=byClass[cn]||[]).push(n);
 const multi=Object.entries(byClass).filter(([c,l])=>l.length>=2),st={classes:Object.keys(byClass).length,shared:multi.length,pairs:0,nativeStructSame:0,copied:0,copyEqualsSource:0,copyStructEqualsTarget:0,valid:0,errors:{},bad:[]};
 const leaves=(S,roots)=>{const cl=dataClosure(S,roots),out=[],seen=new Set();const visit=t=>{const c=cl.objs.get(t);if(!c||seen.has(t))return;seen.add(t);if(c.k==='res')out.push([c.type,t]);if(c.k==='data')c.ptrs.forEach(([p,v])=>visit(v))};roots.forEach(visit);return out};
 for(const[cn,wl]of multi)for(const T0 of wl.slice(1,4)){const s=W[wl[0]],t=W[T0],rs=rootsOf(s,cn),rt=rootsOf(t,cn);st.pairs++;
  if(canon(s.S,rs,true)===canon(t.S,rt,true))st.nativeStructSame++;else if(st.bad.length<12)st.bad.push(cn+': '+wl[0]+' and '+T0+' have different data structures');
  try{const ls=leaves(s.S,rs),lt=leaves(t.S,rt);if(ls.length!==lt.length||ls.some((l,i)=>l[0]!==lt[i][0]))throw'resource leaves differ between the two levels';
   const rm=new Map(ls.map((l,i)=>[l[1],lt[i][1]])),tcls=new Map(t.S.w.classes.map(c=>[c.name,c.off])),bld=Builder(t.A,t.B),map=copyData(s.S,bld,rs,{res:(ty,o)=>rm.get(o),cls:n=>tcls.get(n)});st.copied++;
   const fin=bld.finish(),S2=SrcCtx(fin.A,fin.B),nr=rs.map(r=>map.get(r));S2.sizes=map.sizes;
   if(canon(S2,nr,false).replace(/->R[0-9a-f]+/g,'')===canon(s.S,rs,false).replace(/->R[0-9a-f]+/g,''))st.copyEqualsSource++;else if(st.bad.length<12)st.bad.push(cn+': copy from '+wl[0]+' into '+T0+' differs from its source');
   if(canon(S2,nr,true)===canon(t.S,rt,true))st.copyStructEqualsTarget++;
   const d2=new DataView(fin.A.buffer);let ok=true;for(const r of fixups(fin.B).rel)if(r+4>fin.A.length||d2.getUint32(r,true)>fin.A.length)ok=false;siWad(fin.A,fin.B);if(ok)st.valid++}
  catch(e){const k=String(e).replace(/@[0-9a-f]+/g,'@').slice(0,80);st.errors[k]=(st.errors[k]||0)+1}
  if(progress)progress(st)}
 return st}
// can instance i of (A,B) be copied into another level? -> null or reason
function prefabCheck(A,B,i){const imp=fixups(B),h=(imp[0x8000010e]||[])[0];if(h==null)return'no strat data';const d=new DataView(A.buffer,A.byteOffset,A.length),U=o=>d.getUint32(o,true),so=U(h+0x28)+i*INS,cp=U(so+0x28),ni=d.getUint16(cp+0x18,true),ip=U(so+0x2c);
 for(let r=0;r<ni;r++)if(imp.rel.has(ip+4*r)&&siPrint(siCstr(A,U(ip+4*r)))===null)return'register '+r+' points into level data';
 const pn=U(so+0x30);if(pn){let n=pn;for(let g=0;g<64&&U(n)>0;g++)n=U(n);for(let g=0;g<64&&n>0;g++){for(let w=8;w<0x40;w+=4)if(imp.rel.has(n+w))return'path node points into level data';n=U(n+4)}}return null}
// Generate a primitive PC CollMesh stream from model-local runtime bounds.
// Classify a corrected triangle normal for the empirically tested material
// tags. Upward surfaces retain the historical positive-Y rule. Side surfaces
// are faces whose normal is within 0.25 of horizontal (roughly 14.5 degrees from
// a vertical wall); this gives a narrow, predictable band for wall-running tests.
function validateCollisionMaterialTag(value,label){
 if(value==null||value==='')return null;
 const tag=Number(value);
 if(!Number.isInteger(tag)||tag<0||tag>0xffff)throw(label||'collision material tag')+' must be a 16-bit value between 0x0000 and 0xFFFF';
 return tag;
}
// Assign one raw 16-bit game material tag to each orientation class. The
// semantic names of most stock values are not yet decoded, so the editor keeps
// the numeric value authoritative and treats user labels as notes only.
function collisionTagForNormal(normal,topTagMode='slidey',sideTagMode='slidey',materialTags={}){
 const length=Math.hypot(normal[0],normal[1],normal[2]);if(length<1e-12)return 0x0001;
 const ny=normal[1]/length;
 const side=materialTags.sideMaterialTag==null?(sideTagMode==='walkable'?0x000A:0x0001):validateCollisionMaterialTag(materialTags.sideMaterialTag,'side material tag');
 const upward=materialTags.upwardMaterialTag==null?(topTagMode==='standable'?0x000A:0x0001):validateCollisionMaterialTag(materialTags.upwardMaterialTag,'upward material tag');
 const other=materialTags.otherMaterialTag==null?0x0001:validateCollisionMaterialTag(materialTags.otherMaterialTag,'other material tag');
 if(Math.abs(ny)<=0.25&&(sideTagMode==='walkable'||materialTags.sideMaterialTag!=null))return side;
 if(ny>1e-10)return upward;
 return other;
}
// Rewrite only the high-16 material tag on triangle-ending records. This lets
// the known-good retail Box topology receive the same per-instance surface
// policy as generated primitive and indexed-mesh CollMeshes.
function applyCollisionTagModesToRecords(records,topTagMode='slidey',sideTagMode='slidey',materialTags={}){
 if(!Array.isArray(records))throw'collision tag application requires a record array';
 if(!['standable','slidey'].includes(topTagMode))throw'upward tag mode must be standable or slidey';
 if(!['walkable','slidey'].includes(sideTagMode))throw'side tag mode must be walkable or slidey';
 for(const [key,label] of [['upwardMaterialTag','upward'],['sideMaterialTag','side'],['otherMaterialTag','other']])validateCollisionMaterialTag(materialTags?.[key],label+' material tag');
 const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]],cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
 for(let i=2;i<records.length;i++){
  const rec=records[i],flags=rec.flags>>>0;if(!(flags&0x40))continue;
  let a=records[i-2].position,b=records[i-1].position,c=rec.position;
  if(flags&0x100)[a,b]=[b,a];
  const normal=cross(sub(b,a),sub(c,a)),tag=collisionTagForNormal(normal,topTagMode,sideTagMode,materialTags);
  rec.flags=((flags&0xffff)|(tag<<16))>>>0;
 }
 return records;
}
// The returned record stream uses the retail PC 16-byte vertex records and a
// single KD leaf. Cylinder preserves and warps the complete, runtime-proven
// Sphere six-strip stream into a closed cylinder with flat polar-fan caps.
// Triangle winding is corrected per emitted record using the PC reverse bit.
function buildPrimitiveCollisionShape(type,bounds,{sphereSegments=12,sphereBands=6,cylinderSides=12,topTagMode=null,sideTagMode='slidey',upwardMaterialTag=null,sideMaterialTag=null,otherMaterialTag=null}={}){
 const kind=String(type||'').toLowerCase();
 if(!['box','sphere','cylinder'].includes(kind))throw'unsupported primitive collision shape '+kind;
 const upwardMode=topTagMode==null?((kind==='box'||kind==='cylinder')?'standable':'slidey'):topTagMode;
 if(!['standable','slidey'].includes(upwardMode))throw'primitive upward tag mode must be standable or slidey';
 if(!['walkable','slidey'].includes(sideTagMode))throw'primitive side tag mode must be walkable or slidey';
 if(!Array.isArray(bounds)||bounds.length!==2||bounds.some(v=>!Array.isArray(v)||v.length!==3||!v.every(Number.isFinite)))throw'primitive collision bounds must be [[minX,minY,minZ],[maxX,maxY,maxZ]]';
 const sourceMin=bounds[0].slice(),sourceMax=bounds[1].slice();
 if(sourceMin.some((v,k)=>sourceMax[k]-v<1e-5))throw'primitive collision requires non-zero X, Y and Z model bounds';
 const centre=sourceMin.map((v,k)=>(v+sourceMax[k])*0.5),half=sourceMin.map((v,k)=>(sourceMax[k]-v)*0.5);
 let shapeMin=sourceMin.slice(),shapeMax=sourceMax.slice(),radius=0;
 if(kind==='sphere'){
  radius=Math.hypot(...half);if(!Number.isFinite(radius)||radius<=1e-5)throw'sphere collision radius is invalid';
  shapeMin=centre.map(v=>v-radius);shapeMax=centre.map(v=>v+radius);
 }else if(kind==='cylinder'){
  radius=Math.hypot(half[0],half[2]);if(!Number.isFinite(radius)||radius<=1e-5)throw'cylinder collision radius is invalid';
  shapeMin=[centre[0]-radius,sourceMin[1],centre[2]-radius];shapeMax=[centre[0]+radius,sourceMax[1],centre[2]+radius];
 }
 const strips=[];
 if(kind==='box'){
  for(let axis=0;axis<3;axis++)for(const sign of [-1,1]){
   const u=(axis+1)%3,v=(axis+2)%3,face=[];
   for(const [su,sv] of [[-1,-1],[1,-1],[-1,1],[1,1]]){const q=centre.slice();q[axis]=centre[axis]+sign*half[axis];q[u]=centre[u]+su*half[u];q[v]=centre[v]+sv*half[v];face.push(q)}
   strips.push(face);
  }
 }else if(kind==='sphere'){
  if(!Number.isInteger(sphereSegments)||sphereSegments<8||sphereSegments>24||!Number.isInteger(sphereBands)||sphereBands<4||sphereBands>12)throw'sphere tessellation is outside the supported range';
  for(let band=0;band<sphereBands;band++){
   const a0=Math.PI*band/sphereBands,a1=Math.PI*(band+1)/sphereBands,points=[];
   for(let j=0;j<=sphereSegments;j++){
    const t=2*Math.PI*j/sphereSegments;
    for(const a of [a0,a1])points.push([centre[0]+radius*Math.sin(a)*Math.cos(t),centre[1]+radius*Math.cos(a),centre[2]+radius*Math.sin(a)*Math.sin(t)]);
   }
   strips.push(points);
  }
 }else{
  if(!Number.isInteger(cylinderSides)||cylinderSides<8||cylinderSides>24)throw'cylinder tessellation is outside the supported range';
  if(!Number.isInteger(sphereBands)||sphereBands<4||sphereBands>12)throw'cylinder sphere-band count is outside the supported range';
  // Closed Cylinder built by warping the COMPLETE, runtime-proven Sphere
  // stream. We preserve the Sphere's six-band strip order, record count,
  // degenerate separators, triangle-closing flags and one-leaf layout.
  // Band 0 is flattened into a top disk, the middle bands become a vertical
  // constant-radius wall, and the final band becomes a bottom disk. Keeping
  // both polar fans means the result is a closed surface rather than Step 91's
  // open-bottom mixed Sphere/Box strip stream.
  const polarAngle=Math.PI/sphereBands;
  const sideStart=polarAngle,sideEnd=Math.PI-polarAngle;
  const sideSpan=sideEnd-sideStart;
  for(let band=0;band<sphereBands;band++){
   const a0=Math.PI*band/sphereBands,a1=Math.PI*(band+1)/sphereBands,points=[];
   for(let j=0;j<=cylinderSides;j++){
    const t=2*Math.PI*j/cylinderSides;
    for(const a of [a0,a1]){
     let radial,y;
     if(band===0){
      // The original north-pole fan becomes a flat top disk, from centre to R.
      radial=radius*Math.sin(a)/Math.sin(polarAngle);y=sourceMax[1];
     }else if(band===sphereBands-1){
      // The original south-pole fan becomes a flat bottom disk.
      radial=radius*Math.sin(a)/Math.sin(polarAngle);y=sourceMin[1];
     }else{
      // Every middle latitude is mapped linearly over the cylinder height.
      radial=radius;y=sourceMax[1]-(a-sideStart)/sideSpan*(sourceMax[1]-sourceMin[1]);
     }
     points.push([centre[0]+radial*Math.cos(t),y,centre[2]+radial*Math.sin(t)]);
    }
   }
   strips.push(points);
  }
 }
 const stream=[];
 for(let si=0;si<strips.length;si++){
  const strip=strips[si];if(!Array.isArray(strip)||strip.length<3)continue;
  if(!stream.length)stream.push(...strip.map(v=>v.slice()));
  else{
   const appendAt=stream.length;
   stream.push(stream[stream.length-1].slice(),strip[0].slice(),strip[0].slice(),...strip.slice(1).map(v=>v.slice()));
  }
 }
 if(stream.length<3)throw'primitive collision generated an empty triangle stream';
 const records=[],trianglePositions=[],triangleMaterials=[],eps=1e-10;
 const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]],cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
 for(let i=0;i<stream.length;i++){
  const point=stream[i];let flags=0x80;
  if(i>=2){
   const a=stream[i-2],b=stream[i-1],c=point,n=cross(sub(b,a),sub(c,a)),area=Math.hypot(...n);
   if(area>eps){
    let outward;
    if(kind==='cylinder'&&Math.max(a[1],b[1],c[1])-Math.min(a[1],b[1],c[1])<1e-8){const y=(a[1]+b[1]+c[1])/3;outward=[0,y>=centre[1]?1:-1,0]}
    else outward=[(a[0]+b[0]+c[0])/3-centre[0],(a[1]+b[1]+c[1])/3-centre[1],(a[2]+b[2]+c[2])/3-centre[2]];
    const reverse=dot(n,outward)<0,tri=reverse?[b,a,c]:[a,b,c];
    // The same per-instance surface-tag rules are shared by Box, Sphere and
    // Cylinder. Correct the normal before classifying the face so the material
    // policy follows the emitted triangle winding rather than source strip order.
    const correctedNormal=reverse?n.map(v=>-v):n;
    const materialTag=collisionTagForNormal(correctedNormal,upwardMode,sideTagMode,{upwardMaterialTag,sideMaterialTag,otherMaterialTag});
    flags=0x80|0x40|0x10|(materialTag<<16)|(reverse?0x100:0);
    for(const v of tri)trianglePositions.push(v[0],v[1],v[2]);triangleMaterials.push(materialTag);
   }
  }
  records.push({position:point.slice(),flags});
 }
 records.push({position:[0,0,0],flags:0});
 if(records.length>255)throw kind+' collision generated '+records.length+' records; the single-leaf PC CollMesh limit is 255';
 const triangleCount=triangleMaterials.length;if(!triangleCount)throw kind+' collision generated no non-degenerate triangles';
 const materialCounts={};for(const tag of triangleMaterials)materialCounts[tag]=(materialCounts[tag]||0)+1;
 const radiusHeader=kind==='cylinder'?Math.hypot(radius,half[1]):kind==='sphere'?radius:Math.hypot(...half);
 return{type:kind,centre,radius:radiusHeader,radiusSq:radiusHeader*radiusHeader,bounds:[shapeMin,shapeMax],sourceBounds:[sourceMin,sourceMax],records,trianglePositions:Float32Array.from(trianglePositions),triangleMaterials:Uint16Array.from(triangleMaterials),triangleCount,recordCount:records.length,leafRecordCount:records.length,stripCount:strips.length,topTagMode:upwardMode,sideTagMode,upwardMaterialTag,sideMaterialTag,otherMaterialTag,materialCounts};
}

// Build a native PC CollMesh from the exact indexed triangles of an imported
// .inimodel mesh. Large meshes are partitioned into retail PC KD leaves; every
// leaf owns an independent, terminated triangle strip (<=255 records). The
// six root-bound marker words match the verified retail/Step 103 pattern.
function buildMeshCollisionShape(mesh,{scale=1,topTagMode='slidey',sideTagMode='slidey',upwardMaterialTag=null,sideMaterialTag=null,otherMaterialTag=null,faceMaterialTags=null,faceFlags=null,facePlacementModes=null,maxTrianglesPerLeaf=48,trianglePlacementMode='centroid',partitionBounds=null}={}){
 if(!mesh||!mesh.positions||!mesh.normals||!mesh.indices)throw'mesh collision requires positions, normals and triangle indices';
 if(!Number.isFinite(scale)||scale<=0)throw'mesh collision scale must be finite and positive';
 if(!['standable','slidey'].includes(topTagMode))throw'mesh top-tag mode must be standable or slidey';
 if(!['walkable','slidey'].includes(sideTagMode))throw'mesh side-tag mode must be walkable or slidey';
 if(!Number.isInteger(maxTrianglesPerLeaf)||maxTrianglesPerLeaf<1||maxTrianglesPerLeaf>50)throw'mesh KD leaf triangle limit must be between 1 and 50';
 if(!['centroid','overlap'].includes(trianglePlacementMode))throw'mesh KD trianglePlacementMode must be centroid or overlap';
 const vertexCount=mesh.positions.length/3,indexCount=mesh.indices.length;
 if(!Number.isInteger(vertexCount)||vertexCount<3||mesh.normals.length!==mesh.positions.length)throw'mesh collision has inconsistent position/normal buffers';
 if(indexCount<3||indexCount%3)throw'mesh collision index buffer must contain complete triangles';
 if(faceMaterialTags!=null&&(faceMaterialTags.length!==indexCount/3||Array.from(faceMaterialTags).some(v=>!Number.isInteger(Number(v))||Number(v)<0||Number(v)>0xffff)))throw'mesh collision faceMaterialTags must contain one unsigned 16-bit value per triangle';
 if(faceFlags!=null&&(faceFlags.length!==indexCount/3||Array.from(faceFlags).some(v=>!Number.isInteger(Number(v))||Number(v)<0||Number(v)>0xffff)))throw'mesh collision faceFlags must contain one unsigned 16-bit value per triangle';
 if(facePlacementModes!=null&&(facePlacementModes.length!==indexCount/3||Array.from(facePlacementModes).some(v=>!['centroid','overlap'].includes(String(v)))))throw'mesh collision facePlacementModes must contain centroid or overlap for each triangle';
 const geometryMin=[Infinity,Infinity,Infinity],geometryMax=[-Infinity,-Infinity,-Infinity],points=new Array(vertexCount);
 for(let v=0;v<vertexCount;v++){
  const p=[mesh.positions[v*3]*scale,mesh.positions[v*3+1]*scale,-mesh.positions[v*3+2]*scale];
  if(!p.every(Number.isFinite))throw'mesh collision contains a non-finite vertex at '+v;
  points[v]=p;for(let k=0;k<3;k++){geometryMin[k]=Math.min(geometryMin[k],p[k]);geometryMax[k]=Math.max(geometryMax[k],p[k]);}
 }
 const min=partitionBounds?.min?Array.from(partitionBounds.min,Number):geometryMin.slice(),max=partitionBounds?.max?Array.from(partitionBounds.max,Number):geometryMax.slice();
 if(min.length!==3||max.length!==3||min.some(v=>!Number.isFinite(v))||max.some(v=>!Number.isFinite(v))||min.some((v,k)=>v>=max[k]))throw'mesh collision partition bounds must be finite increasing XYZ bounds';
 const extents=max.map((v,k)=>v-min[k]);
 if(Math.max(...extents)<1e-5)throw'mesh collision requires a finite non-zero two-dimensional or three-dimensional partition extent';
 const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]],cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2],norm=a=>Math.hypot(...a);
 const triangles=[],materialCounts={};let upwardFacingTriangles=0,sideFacingTriangles=0;
 for(let t=0;t<indexCount/3;t++){
  const ids=[mesh.indices[t*3],mesh.indices[t*3+1],mesh.indices[t*3+2]];
  if(ids.some(i=>!Number.isInteger(i)||i<0||i>=vertexCount))throw'mesh collision triangle '+t+' contains an out-of-range index';
  const triPoints=ids.map(i=>points[i]),triNormals=ids.map(i=>[mesh.normals[i*3],mesh.normals[i*3+1],-mesh.normals[i*3+2]]);
  const n=cross(sub(triPoints[1],triPoints[0]),sub(triPoints[2],triPoints[0]));
  if(norm(n)<1e-10)throw'mesh collision contains a degenerate triangle at index '+t;
  const avgNormal=[0,1,2].map(k=>(triNormals[0][k]+triNormals[1][k]+triNormals[2][k])/3);
  const reverse=norm(avgNormal)>1e-10&&dot(n,avgNormal)<0;
  const orientedNormal=reverse?n.map(v=>-v):n;
  const normalLength=norm(orientedNormal),normalY=normalLength?orientedNormal[1]/normalLength:0;
  const upward=orientedNormal[1]>1e-10,sideFacing=Math.abs(normalY)<=0.25;
  if(upward)upwardFacingTriangles++;if(sideFacing)sideFacingTriangles++;
  const materialTag=faceMaterialTags==null?collisionTagForNormal(orientedNormal,topTagMode,sideTagMode,{upwardMaterialTag,sideMaterialTag,otherMaterialTag}):Number(faceMaterialTags[t]);
  // The retail level CollMesh uses additional low-order triangle-end flags
  // (not just valid/end/reverse). Preserve caller-supplied unknown bits when
  // rebuilding an existing level tree; generated custom triangles retain the
  // known working 0x10 extra bit by default. 0x80/0x40/0x100 are rebuilt.
  const extraFlags=faceFlags==null?0x10:(Number(faceFlags[t])&0xffff&~(0x80|0x40|0x100));
  materialCounts[materialTag]=(materialCounts[materialTag]||0)+1;
  triangles.push({id:t,sourceId:t,points:triPoints,normals:triNormals,reverse,materialTag,extraFlags,placementMode:facePlacementModes==null?trianglePlacementMode:String(facePlacementModes[t]),centroid:[0,1,2].map(k=>(triPoints[0][k]+triPoints[1][k]+triPoints[2][k])/3)});
 }
 // Large custom faces may cross several KD query regions. Centroid placement
 // reproduces the original retail ownership convention, but a single stored
 // copy can be invisible to a query that only descends into another intersected
 // region. The native inilevel merger therefore opts into overlap placement for
 // newly generated local subtrees: intact whole faces are repeated in each child
 // AABB they intersect. Ordinary .inimodel Mesh collision retains centroid mode.
 const triangleIntersectsAabb=(points,boxMin,boxMax)=>{
  const centre=boxMin.map((v,k)=>(v+boxMax[k])*0.5),half=boxMin.map((v,k)=>(boxMax[k]-v)*0.5+1e-5);
  const vertices=points.map(point=>point.map((value,k)=>value-centre[k]));
  const edges=[vertices[1].map((v,k)=>v-vertices[0][k]),vertices[2].map((v,k)=>v-vertices[1][k]),vertices[0].map((v,k)=>v-vertices[2][k])];
  const axes=[[1,0,0],[0,1,0],[0,0,1],
   [edges[0][1]*edges[1][2]-edges[0][2]*edges[1][1],edges[0][2]*edges[1][0]-edges[0][0]*edges[1][2],edges[0][0]*edges[1][1]-edges[0][1]*edges[1][0]]];
  for(const edge of edges)axes.push([0,edge[2],-edge[1]],[-edge[2],0,edge[0]],[edge[1],-edge[0],0]);
  for(const axis of axes){const lengthSq=axis[0]*axis[0]+axis[1]*axis[1]+axis[2]*axis[2];if(lengthSq<1e-18)continue;const projections=vertices.map(point=>point[0]*axis[0]+point[1]*axis[1]+point[2]*axis[2]),radius=half[0]*Math.abs(axis[0])+half[1]*Math.abs(axis[1])+half[2]*Math.abs(axis[2]);if(Math.min(...projections)>radius+1e-6||Math.max(...projections)<-radius-1e-6)return false;}
  return true;
 };
 const splitRegions=(region,axis,split)=>{
  const left={min:region.min.slice(),max:region.max.slice()},right={min:region.min.slice(),max:region.max.slice()};
  left.max[axis]=Math.min(left.max[axis],split);right.min[axis]=Math.max(right.min[axis],split);return{left,right};
 };
 const splitItems=(items,axis,split,leftRegion,rightRegion)=>{
  const left=[],right=[];
  for(const item of items){
   if(item.placementMode==='centroid'){(item.centroid[axis]<=split?left:right).push(item);}
   else{if(triangleIntersectsAabb(item.points,leftRegion.min,leftRegion.max))left.push(item);if(triangleIntersectsAabb(item.points,rightRegion.min,rightRegion.max))right.push(item);}
  }
  return{left,right};
 };
 const partition=(items,region,depth=0)=>{
  if(items.length<=maxTrianglesPerLeaf){const leaf={type:'leaf',triangles:items,firstRecord:0,recordCount:0};return leaf;}
  if(depth>64)throw'mesh KD '+trianglePlacementMode+' partition exceeded 64 levels';
  let best=null;
  const consider=(axis,split)=>{
   if(!Number.isFinite(split)||split<=region.min[axis]+1e-6||split>=region.max[axis]-1e-6)return;
   const regions=splitRegions(region,axis,split),{left,right}=splitItems(items,axis,split,regions.left,regions.right);
   if(!left.length||!right.length||Math.max(left.length,right.length)>=items.length)return;
   const duplicates=left.length+right.length-items.length;
   const score=Math.max(left.length,right.length)+0.001*Math.abs(left.length-right.length)+(trianglePlacementMode==='overlap'?0.05*duplicates:0);
   if(!best||score<best.score)best={axis,split,left,right,regions,score};
  };
  const fractions=[0.2,0.33,0.5,0.67,0.8];
  for(let axis=0;axis<3;axis++){
   const centroids=items.map(t=>t.centroid[axis]).sort((a,b)=>a-b);
   for(const f of fractions){
    const cut=Math.min(centroids.length-1,Math.max(1,Math.floor(items.length*f)));
    const a=centroids[cut-1],b=centroids[cut];if(!(b-a>1e-9))continue;
    // PC split coordinates are quantized to 1/1024. Choose a representable
    // plane between centroid groups; overlap mode then duplicates any full face
    // that also extends into the opposite child region.
    let q=Math.floor(((a+b)*0.5)*1024);
    if(q/1024<=a)q=Math.floor(a*1024)+1;
    const split=q/1024;if(split>a+1e-9&&split<b-1e-9)consider(axis,split);
   }
   const midpoint=Math.round(((region.min[axis]+region.max[axis])*0.5)*1024)/1024;
   consider(axis,midpoint);
  }
  if(!best)throw'mesh KD cannot separate more than '+maxTrianglesPerLeaf+' triangles using 1/1024 PC split planes in '+trianglePlacementMode+' mode; collision faces may span the entire remaining region';
  return{type:'internal',axis:best.axis,split:best.split,left:partition(best.left,best.regions.left,depth+1),right:partition(best.right,best.regions.right,depth+1)};
 };
 const root=partition(triangles,{min:min.slice(),max:max.slice()});
 const nodes=Array.from({length:6},()=>({type:'bound'})),nodeIndex=new Map();
 function flatten(node){const index=nodes.length;nodes.push(node);nodeIndex.set(node,index);if(node.type==='internal'){flatten(node.left);flatten(node.right);}return index;}
 if(flatten(root)!==6)throw'mesh KD root index is not 6';
 const orderedLeaves=[];const visit=node=>{if(node.type==='leaf')orderedLeaves.push(node);else{visit(node.left);visit(node.right);}};visit(root);
 const leafCount=orderedLeaves.length;
 const kdTriangles=orderedLeaves.flatMap(leaf=>leaf.triangles),kdMaterialCounts={};
 for(const tri of kdTriangles)kdMaterialCounts[tri.materialTag]=(kdMaterialCounts[tri.materialTag]||0)+1;
 const placedSourceIds=new Set(kdTriangles.map(t=>t.sourceId));
 if(placedSourceIds.size!==triangles.length||triangles.some(tri=>!placedSourceIds.has(tri.sourceId)))throw'mesh KD '+trianglePlacementMode+' partition lost or failed to place source triangles';
 if(trianglePlacementMode==='centroid'&&kdTriangles.length!==triangles.length)throw'mesh KD centroid partition unexpectedly duplicated source triangles';
 const records=[];
 for(const leaf of orderedLeaves){
  let previousLast=null;
  for(let i=0;i<leaf.triangles.length;i++){
   const tri=leaf.triangles[i],ps=tri.points,flags=(0x80|0x40|tri.extraFlags|(tri.materialTag<<16)|(tri.reverse?0x100:0))>>>0;
   const face=[{position:ps[0].slice(),flags:0x80},{position:ps[1].slice(),flags:0x80},{position:ps[2].slice(),flags}];
   if(i===0)records.push(...face);
   else records.push({position:previousLast.position.slice(),flags:0x80},face[0],{position:face[0].position.slice(),flags:0x80},face[1],face[2]);
   previousLast=face[2];
  }
  if(!previousLast)throw'mesh KD leaf unexpectedly has no triangles';
  records.push({position:previousLast.position.slice(),flags:0});
  leaf.recordCount=5*leaf.triangles.length-1;
 }
 // Recompute exact leaf starts by replaying the known per-leaf stream lengths.
 let recordCursor=0;for(const leaf of orderedLeaves){leaf.firstRecord=recordCursor;leaf.recordCount=5*leaf.triangles.length-1;recordCursor+=leaf.recordCount;}
 if(recordCursor!==records.length)throw'mesh KD record stream accounting failed';
 if(records.some((r,i)=>i>=0&&!r.position.every(Number.isFinite)))throw'mesh KD record stream contains a non-finite position';
 if(nodes.length>4096)throw'mesh KD tree exceeds the tested 4096-node limit';
 for(const leaf of orderedLeaves)if(leaf.recordCount>255||leaf.firstRecord>0xffffff)throw'mesh KD leaf record range cannot be encoded';
 const centre=min.map((v,k)=>(v+max[k])*0.5);let radius=0;
 for(const p of points)radius=Math.max(radius,norm(sub(p,centre)));
 // Verify that every emitted whole triangle intersects its assigned leaf. In
 // overlap mode also require a copy in every final terminal leaf intersected by
 // each original face, including leaves created by this local subdivision.
 const finalRegions=new Map(),placementsBySource=new Map();
 function verify(node,region){
  node.region={min:region.min.slice(),max:region.max.slice()};
  if(node.type==='leaf'){
   finalRegions.set(node,region);
   for(const tri of node.triangles){
    if(tri.placementMode==='centroid'){for(let k=0;k<3;k++)if(tri.centroid[k]<region.min[k]-0.001||tri.centroid[k]>region.max[k]+0.001)throw'mesh KD centroid-owned triangle '+tri.id+' is outside its spatial region';}
    else if(!triangleIntersectsAabb(tri.points,region.min,region.max))throw'mesh KD overlap-owned triangle '+tri.id+' does not intersect its spatial region';
    if(!placementsBySource.has(tri.sourceId))placementsBySource.set(tri.sourceId,new Set());
    placementsBySource.get(tri.sourceId).add(node);
   }
   return node.triangles;
  }
  const axis=node.axis;if(node.split<region.min[axis]-0.001||node.split>region.max[axis]+0.001)throw'mesh KD split is outside its inherited region';
  const childRegions=splitRegions(region,axis,node.split);
  return verify(node.left,childRegions.left).concat(verify(node.right,childRegions.right));
 }
 if(verify(root,{min:min.slice(),max:max.slice()}).length!==kdTriangles.length)throw'mesh KD partition lost whole triangles';
 if(triangles.some(tri=>tri.placementMode==='overlap'))for(const tri of triangles.filter(item=>item.placementMode==='overlap')){
  const assigned=placementsBySource.get(tri.sourceId)||new Set();
  for(const [leaf,region] of finalRegions)if(triangleIntersectsAabb(tri.points,region.min,region.max)&&!assigned.has(leaf))throw'mesh KD overlap partition omitted source triangle '+tri.sourceId+' from intersected final leaf';
 }
 const maxSourceAreaError=0;
 return{type:'mesh',bounds:[min,max],centre,radius,radiusSq:radius*radius,records,nodes,nodeCount:nodes.length,leafCount,triangleCount:triangles.length,kdTriangleCount:kdTriangles.length,duplicateTrianglePlacements:kdTriangles.length-triangles.length,trianglePlacementMode,facePlacementModes:triangles.map(tri=>tri.placementMode),recordCount:records.length,triangles,kdTriangles,materialCounts,kdMaterialCounts,maxSourceAreaError,topTagMode,sideTagMode,upwardMaterialTag,sideMaterialTag,otherMaterialTag,upwardFacingTriangles,sideFacingTriangles};
}

// Read a native object CollMesh referenced by a Strat_SetModelCollide model table.
// This is inspection-only: it decodes the existing LCS data and never changes it.
// Header: +00 relocated KD-node pointer, +04 node count; +0c..+1c sphere;
// +20 relocated 16-byte vertex-record pointer, +24 record count.
// Vertex flags: 0x80 valid, 0x40 emits a triangle from the preceding two valid
// records, 0x100 reverses the first two indices, high 16 bits are material ID.
function parseCollisionMesh(A,B,collOffset){
 const fail=error=>({valid:false,error,offset:collOffset});
 if(!(A instanceof Uint8Array)||!Number.isInteger(collOffset)||collOffset<0||collOffset+0x30>A.length)return fail('CollMesh header is outside the LCS data');
 const imp=fixups(B),d=new DataView(A.buffer,A.byteOffset,A.byteLength),U=o=>d.getUint32(o,true),F=o=>d.getFloat32(o,true);
 const nodePtr=U(collOffset),nodeCount=U(collOffset+4),vertexPtr=U(collOffset+0x20),vertexCount=U(collOffset+0x24);
 if(!nodePtr||nodeCount<1||nodeCount>4096||nodePtr+nodeCount*8>A.length)return fail('KD-node pointer/count is invalid');
 if(!vertexPtr||vertexCount<3||vertexCount>1000000||vertexPtr+vertexCount*16>A.length)return fail('vertex-record pointer/count is invalid');
 const relocations={nodePointer:imp.rel.has(collOffset),vertexPointer:imp.rel.has(collOffset+0x20)};
 const nodes=[];for(let i=0;i<nodeCount;i++){const o=nodePtr+i*8;nodes.push({index:i,word0:U(o),word1:U(o+4),hex0:'0x'+U(o).toString(16).padStart(8,'0'),hex1:'0x'+U(o+4).toString(16).padStart(8,'0')})}
 // PC retail KD layout reconstructed from the unmodified base-game 10.vol.
 // Entries 0..5 are signed 1/8192 AABB bounds (Xmin, Xmax, Ymin, Ymax, Zmin, Zmax);
 // node 6 is the root. Internal word0 stores axis in bits 0..1 and the split
 // coordinate in the signed upper bits. Retail samples have bit 2 clear, so
 // (s32(word0) >> 3) / 1024 is the same 1/8192 coordinate quantisation.
 // Internal word1 stores child A in high16 and child B in low16. In PC 10.vol
 // geometry, A is the below/negative side and B is the above/positive side.
 // A leaf word1 is PC-specific: (firstVertexRecord << 8) | recordCount.
 // This differs from the PS2 PSM format documented by i-ninja-macos-master,
 // where leaves point to DMA descriptors and the root is node 0.
 const s32=v=>v>=0x80000000?v-0x100000000:v;
 const kdBounds=nodeCount>=6?[[0,1,2].map(k=>s32(nodes[k*2].word0)/8192),[0,1,2].map(k=>s32(nodes[k*2+1].word0)/8192)]:null;
 const kdNodes=[],kdWarnings=[];let kdInternalCount=0,kdLeafCount=0,kdSingleChildCount=0,kdTwoChildCount=0;
 const kdAxisCounts={x:0,y:0,z:0};const parents=new Uint16Array(nodeCount),childMap=new Map(),kdByIndex=new Map();
 const leafCoverage=new Uint8Array(vertexCount);let leafRangeInvalid=0;
 const headerWord28=U(collOffset+0x28);
 // Retail PC 10.vol sets this to nodeCount for all 95 scanned CollMeshes, but the
 // supplied custom Suzanne test mesh sets it to zero. Keep it raw until its PC
 // runtime meaning is established; the PS2 'leaf base' interpretation is not assumed.
 const leafBase=headerWord28;
 if(nodeCount<7)kdWarnings.push('KD array is shorter than the six-bound header plus root node');
 for(let i=6;i<nodeCount;i++){
  const raw=nodes[i].word0,axis=raw&3,entry={index:i,rawWord0:raw,rawWord1:nodes[i].word1};
  if(axis===3){
   const payload=nodes[i].word1,firstRecord=payload>>>8,recordCount=payload&0xff;
   entry.type='leaf';entry.leafPayload=payload;entry.firstRecord=firstRecord;entry.recordCount=recordCount;entry.lastRecord=recordCount?firstRecord+recordCount-1:firstRecord-1;
   if(recordCount===0||firstRecord+recordCount>vertexCount){kdWarnings.push('leaf node '+i+' record range '+firstRecord+'+'+recordCount+' exceeds '+vertexCount+' records');leafRangeInvalid++;}
   else for(let r=firstRecord;r<firstRecord+recordCount;r++)leafCoverage[r]++;
   kdLeafCount++;
  }else{
   const axisName=axis===0?'x':axis===1?'y':'z',splitWord=(s32(raw)>>3),split=splitWord/1024;
   const childA=(nodes[i].word1>>>16)&0xffff,childB=nodes[i].word1&0xffff,children=[];
   entry.type='internal';entry.axis=axis;entry.axisName=axisName;entry.split=split;entry.splitWord=splitWord;
   entry.childA=childA===0xffff?null:childA;entry.childB=childB===0xffff?null:childB;
   entry.childASide='below';entry.childBSide='above';
   if(entry.childA!==null)children.push(entry.childA);if(entry.childB!==null)children.push(entry.childB);
   entry.children=children;kdInternalCount++;kdAxisCounts[axisName]++;
   if(children.length===1)kdSingleChildCount++;else if(children.length===2)kdTwoChildCount++;else kdWarnings.push('internal node '+i+' has no children');
   for(const child of children){if(child<6||child>=nodeCount)kdWarnings.push('node '+i+' points outside the KD tree to '+child);else parents[child]++;}
   if(kdBounds&& (split<kdBounds[0][axis]-0.002||split>kdBounds[1][axis]+0.002))kdWarnings.push('split plane at node '+i+' is outside the root '+axisName+' bounds');
  }
  kdNodes.push(entry);kdByIndex.set(i,entry);childMap.set(i,entry.children||[]);
 }
 let uncoveredRecords=0,overlappedRecords=0,coveredRecords=0;
 for(const c of leafCoverage){if(c===0)uncoveredRecords++;else if(c>1)overlappedRecords++;else coveredRecords++;}
 const leafRangesValid=leafRangeInvalid===0&&uncoveredRecords===0&&overlappedRecords===0;
 if(!leafRangesValid)kdWarnings.push('leaf record ranges do not partition the vertex array exactly once (covered '+coveredRecords+'/'+vertexCount+', gaps '+uncoveredRecords+', overlaps '+overlappedRecords+')');
 const kdDepths={},kdVisitState=new Uint8Array(nodeCount);let kdMaxDepth=0,kdReachableCount=0,regionSplitCount=0,regionSplitOutOfBounds=0;
 const visitKd=(index,depth,region,path)=>{
  if(index<6||index>=nodeCount){kdWarnings.push('tree traversal reached invalid node '+index);return;}
  if(kdVisitState[index]===1){kdWarnings.push('cycle detected at KD node '+index);return;}
  if(kdVisitState[index]===2){kdWarnings.push('KD node '+index+' is referenced by more than one parent');return;}
  kdVisitState[index]=1;kdDepths[index]=depth;kdReachableCount++;if(depth>kdMaxDepth)kdMaxDepth=depth;
  const entry=kdByIndex.get(index);if(!entry){kdWarnings.push('missing decoded node '+index);kdVisitState[index]=2;return;}
  entry.region={min:region.min.slice(),max:region.max.slice()};entry.path=path;
  if(entry.type==='internal'){
   const axis=entry.axis,split=entry.split,lo=region.min[axis],hi=region.max[axis];regionSplitCount++;
   if(split<lo-0.002||split>hi+0.002){regionSplitOutOfBounds++;kdWarnings.push('split plane at node '+index+' lies outside its inherited subtree region');}
   const cut=Math.max(lo,Math.min(hi,split));
   if(entry.childA!==null){const below={min:region.min.slice(),max:region.max.slice()};below.max[axis]=Math.min(below.max[axis],cut);visitKd(entry.childA,depth+1,below,path.concat([{axis,split,side:'below',parent:index}]));}
   if(entry.childB!==null){const above={min:region.min.slice(),max:region.max.slice()};above.min[axis]=Math.max(above.min[axis],cut);visitKd(entry.childB,depth+1,above,path.concat([{axis,split,side:'above',parent:index}]));}
  }
  kdVisitState[index]=2;
 };
 if(nodeCount>=7&&kdBounds)visitKd(6,0,{min:kdBounds[0].slice(),max:kdBounds[1].slice()},[]);
 if(nodeCount>=7&&parents[6]!==0)kdWarnings.push('root node 6 is referenced as a child');
 for(let i=7;i<nodeCount;i++)if(kdVisitState[i]!==2)kdWarnings.push('KD node '+i+' is unreachable from root 6');
 for(let i=7;i<nodeCount;i++)if(parents[i]!==1)kdWarnings.push('KD node '+i+' has '+parents[i]+' parents (expected 1)');
 const leafRangeSummary={valid:leafRangesValid,coveredRecords,uncoveredRecords,overlappedRecords,invalidLeaves:leafRangeInvalid,encoding:'firstRecord = word1 >>> 8; recordCount = word1 & 0xff'};
 const kdTree={valid:kdWarnings.length===0,root:nodeCount>=7?6:null,bounds:kdBounds,nodes:kdNodes,internalCount:kdInternalCount,leafCount:kdLeafCount,axisCounts:kdAxisCounts,singleChildCount:kdSingleChildCount,twoChildCount:kdTwoChildCount,maxDepth:kdMaxDepth,reachableCount:kdReachableCount,warnings:kdWarnings,depths:kdDepths,leafRanges:leafRangeSummary,leafBase,headerWord28,leafBaseMatchesNodeCount:headerWord28===nodeCount,headerWord28Meaning:'unknown on PC; retained raw',childSideConvention:'high16=below; low16=above',regionSplitCount,regionSplitOutOfBounds,leafPayloadMeaning:'firstVertexRecord<<8 | recordCount'};
 const recordLeafIndex=new Int32Array(vertexCount);recordLeafIndex.fill(-1);
 for(const n of kdNodes)if(n.type==='leaf'&&n.recordCount>0&&n.firstRecord+n.recordCount<=vertexCount)for(let r=n.firstRecord;r<n.firstRecord+n.recordCount;r++)if(recordLeafIndex[r]===-1)recordLeafIndex[r]=n.index;
 const records=new Array(vertexCount),triPos=[],triMaterials=[],triFlags=[],triLeafIndices=[];let prev1=null,prev2=null,validRecords=0;
 const bounds=[Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity];
 for(let i=0;i<vertexCount;i++){
  const o=vertexPtr+i*16,pos=[F(o),F(o+4),F(o+8)],flags=U(o+12),valid=!!(flags&0x80);
  if(!pos.every(Number.isFinite)||pos.some(v=>Math.abs(v)>1e6))return fail('vertex record '+i+' contains invalid coordinates');
  const r={index:i,position:pos,flags,flagsHex:'0x'+flags.toString(16).padStart(8,'0'),valid,triangleEnd:!!(flags&0x40),reverse:!!(flags&0x100),material:flags>>>16,leafIndex:recordLeafIndex[i]>=0?recordLeafIndex[i]:null};records[i]=r;
  if(!valid){prev1=prev2=null;continue}
  validRecords++;for(let k=0;k<3;k++){bounds[k]=Math.min(bounds[k],pos[k]);bounds[k+3]=Math.max(bounds[k+3],pos[k])}
  if((flags&0x40)&&prev1&&prev2){
   const tri=flags&0x100?[prev1,prev2,r]:[prev2,prev1,r];
   for(const v of tri)triPos.push(...v.position);
   triMaterials.push(flags>>>16);triFlags.push(flags);triLeafIndices.push(r.leafIndex);
  }
  prev2=prev1;prev1=r;
 }
 const centre=[F(collOffset+0x0c),F(collOffset+0x10),F(collOffset+0x14)],radiusSq=F(collOffset+0x18),radius=F(collOffset+0x1c);
 if(!centre.every(Number.isFinite)||!Number.isFinite(radiusSq)||!Number.isFinite(radius))return fail('bounding-sphere header contains invalid values');
 const materialCounts={};for(const m of triMaterials)materialCounts[m]=(materialCounts[m]||0)+1;
 const vertexBounds=validRecords?[bounds.slice(0,3),bounds.slice(3)]:null;
 let kdBoundsError=null;if(kdBounds&&vertexBounds){kdBoundsError=0;for(let k=0;k<3;k++){kdBoundsError=Math.max(kdBoundsError,Math.abs(kdBounds[0][k]-vertexBounds[0][k]),Math.abs(kdBounds[1][k]-vertexBounds[1][k]))}}
 const sideEvidence={high16Below:0,low16Above:0,contradictions:0,mixed:0},leafTriangleCounts={};
 for(const n of kdNodes)if(n.type==='leaf')leafTriangleCounts[n.index]=0;
 for(let ti=0;ti<triLeafIndices.length;ti++){const li=triLeafIndices[ti];if(li!=null&&li in leafTriangleCounts)leafTriangleCounts[li]++;}
 for(const leaf of kdNodes){if(leaf.type!=='leaf'||!leaf.recordCount||leaf.firstRecord+leaf.recordCount>vertexCount)continue;
  const mn=[Infinity,Infinity,Infinity],mx=[-Infinity,-Infinity,-Infinity];
  for(let r=leaf.firstRecord;r<leaf.lastRecord;r++)for(let a=0;a<3;a++){const v=records[r].position[a];mn[a]=Math.min(mn[a],v);mx[a]=Math.max(mx[a],v)}
  leaf.positionBounds={min:mn,max:mx};leaf.triangleCount=leafTriangleCounts[leaf.index]||0;
  for(const step of leaf.path||[]){const lo=mn[step.axis],hi=mx[step.axis];let evidence=false,contradiction=false;
   if(step.side==='below'){evidence=hi<step.split-0.05;contradiction=lo>step.split+0.05;if(evidence)sideEvidence.high16Below++;}
   else{evidence=lo>step.split+0.05;contradiction=hi<step.split-0.05;if(evidence)sideEvidence.low16Above++;}
   if(contradiction)sideEvidence.contradictions++;if(!evidence&&!contradiction)sideEvidence.mixed++;
  }
 }
 kdTree.sideEvidence=sideEvidence;
 const triangleCentroidEvidence={high16Below:0,high16Above:0,high16Near:0,low16Above:0,low16Below:0,low16Near:0,observations:0};
 for(let ti=0;ti<triLeafIndices.length;ti++){
  const li=triLeafIndices[ti],leaf=li==null?null:kdByIndex.get(li);if(!leaf||leaf.type!=='leaf')continue;
  for(const step of leaf.path||[]){const axis=step.axis,c=(triPos[ti*9+axis]+triPos[ti*9+3+axis]+triPos[ti*9+6+axis])/3,eps=0.0001;triangleCentroidEvidence.observations++;
   if(step.side==='below'){if(c<step.split-eps)triangleCentroidEvidence.high16Below++;else if(c>step.split+eps)triangleCentroidEvidence.high16Above++;else triangleCentroidEvidence.high16Near++;}
   else{if(c>step.split+eps)triangleCentroidEvidence.low16Above++;else if(c<step.split-eps)triangleCentroidEvidence.low16Below++;else triangleCentroidEvidence.low16Near++;}
  }
 }
 kdTree.triangleCentroidEvidence=triangleCentroidEvidence;
 const leafStreams={valid:true,leafCount:0,startsValid:0,endsWithZeroTerminator:0,extraInvalidRecords:0};
 for(const leaf of kdNodes){if(leaf.type!=='leaf'||!leaf.recordCount||leaf.firstRecord+leaf.recordCount>vertexCount)continue;leafStreams.leafCount++;
  if(records[leaf.firstRecord]?.valid)leafStreams.startsValid++;
  const last=records[leaf.lastRecord];if(last&&last.flags===0)leafStreams.endsWithZeroTerminator++;
  for(let ri=leaf.firstRecord;ri<leaf.lastRecord;ri++)if(!records[ri].valid)leafStreams.extraInvalidRecords++;
 }
 leafStreams.valid=leafStreams.leafCount===kdLeafCount&&leafStreams.startsValid===kdLeafCount&&leafStreams.endsWithZeroTerminator===kdLeafCount&&leafStreams.extraInvalidRecords===0;
 if(!leafStreams.valid)kdWarnings.push('leaf streams do not each start with valid records and end with one zero-flag terminator');
 kdTree.leafStreams=leafStreams;kdTree.valid=kdWarnings.length===0;kdTree.warnings=kdWarnings;
 return{valid:true,offset:collOffset,nodePtr,nodeCount,leafBase,headerWord28,vertexPtr,vertexCount,validRecords,nodes,kdTree,kdBounds,kdBoundsError,records,
  positions:Float32Array.from(triPos),materials:Uint16Array.from(triMaterials),triangleFlags:Uint32Array.from(triFlags),triangleLeaves:Uint16Array.from(triLeafIndices, v=>v==null?0xffff:v),triangleCount:triMaterials.length,
  materialCounts,centre,radiusSq,radius,bounds:vertexBounds,
  relocations,headerWords:Array.from({length:12},(_,i)=>U(collOffset+i*4))};
}

// object meshes (type 0x24: 32-byte vertices pos/normal/uv + one stitched triangle strip). A mesh is split into its parts (0x21/0x22): every part owns a slice of the
// strip (index range) and its own material. Part table (verified on every mesh of 10.vol and 20.vol): the 4th (count,pointer) pair of the part points at
// [5, vertexCount, indexCount, ptr, 0,0,0,0, verticesRemainingAfter, indicesRemainingAfter]; parts tile the vertex and index buffers exactly (index slice = indexCount+2 incl. stitch).
function parseModels(A,B){const imp=fixups(B),meshes=imp[0x80000024];if(!meshes||!meshes.length)return[];
 const d=new DataView(A.buffer,A.byteOffset,A.length),U=o=>d.getUint32(o,true),F=o=>d.getFloat32(o,true),rd=o=>(o>=0&&o+4<=A.length)?U(o):0;
 const tex=new Set(imp[0x80000001]||[]),materialResources=parseMaterialResources(A,B),materialByOffset=new Map(materialResources.map(x=>[x.offset,x]));
 const res=(t,k=0)=>{if(tex.has(t))return t;if(k>4)return 0;const r=materialByOffset.get(t);if(!r||!r.valid)return 0;
  if(r.type==='layered')return r.layers.length?res(r.layers[0].textureOffset,k+1):0;
  if(r.type==='animated')return r.frameOffsets.length?res(r.frameOffsets[0],k+1):0;return 0};
 const parts=[...(imp[0x80000021]||[]),...(imp[0x80000022]||[])],tc={},out=[];
 // parts of one model: linked through the part->previous-part pointer (+0x44), through node records that list several parts side by side (parts of one big mesh are NOT merged: such a mesh holds many separate props)
 const pset=new Set(parts); // only part->previous-part links form a safe fallback component
 const inlineName=p=>{for(let o=p;o<Math.min(p+0x100,A.length);o++){let q=o;while(q<A.length&&((A[q]>=65&&A[q]<=90)||(A[q]>=97&&A[q]<=122)||(A[q]>=48&&A[q]<=57)||A[q]===32||A[q]===95||A[q]===46))q++;if(q-o>=4&&A[q]===0&&(o===p||A[o-1]===0||A[o-1]<32||A[o-1]>126))return String.fromCharCode(...A.subarray(o,q))}return''};
 const texOf=p=>{const materialOffset=U(p+16),texOffset=res(materialOffset);if(texOffset&&!(texOffset in tc))tc[texOffset]=parseTga(A,texOffset);return{tex:texOffset?tc[texOffset]:null,texOffset,materialOffset,material:materialByOffset.get(materialOffset)||null}};
 for(const m of meshes){const str=U(m+8),nv=U(m+12),vp=U(m+16),ni=U(m+20),ip=U(m+24);if(!nv||!ni||str<32||vp+nv*str>A.length||ip+ni*2>A.length)continue;
  const pos=new Float32Array(nv*3),nrm=new Float32Array(nv*3),uv=new Float32Array(nv*2);
  for(let i=0;i<nv;i++){const o=vp+str*i;for(let k=0;k<3;k++){pos[3*i+k]=F(o+4*k);nrm[3*i+k]=F(o+12+4*k)}uv[2*i]=F(o+24);uv[2*i+1]=F(o+28)}
  const I=new Uint16Array(ni);for(let j=0;j<ni;j++)I[j]=d.getUint16(ip+2*j,true);
  const slice=(s,e)=>{const t=[];let used=new Set();for(let j=s;j+2<e;j++){const a=I[j],b=I[j+1],c2=I[j+2];if(a===b||b===c2||a===c2||a>=nv||b>=nv||c2>=nv)continue;if((j-s)&1)t.push(b,a,c2);else t.push(a,b,c2);used.add(a);used.add(b);used.add(c2)}return{idx:Uint32Array.from(t),used}};
  const bbox=used=>{const mn=[1e9,1e9,1e9],mx=[-1e9,-1e9,-1e9];for(const v of used)for(let k=0;k<3;k++){const x=pos[3*v+k];if(x<mn[k])mn[k]=x;if(x>mx[k])mx[k]=x}return used.size?[mn,mx]:[[0,0,0],[0,0,0]]};
  const ps=parts.filter(p=>U(p+12)===m).sort((a,b)=>a-b);
  const info=ps.map(p=>{const a=U(p+0x20+24),cnt=U(p+0x1c+24);if(cnt<1||a<=0||a+40>A.length)return null;const vc=U(a+4),ic=U(a+8),rv=U(a+32),ri=U(a+36),is=ri;/* rv/ri are counted from the START (verified against a D3D draw capture: MinVertexIndex==rv, StartIndex==ri) */if(ri+ic+2>ni||rv+vc>nv)return null;return{p,vc,vs:rv,is,ic}});
  if(!ps.length||info.some(x=>!x)){const s=slice(0,ni),p0=ps[0]||0,mt=p0?texOf(p0):null;out.push({off:m,poff:p0,pk:0,np:Math.max(ps.length,1),name:p0?inlineName(p0):'',nv:s.used.size,pos,nrm,uv,idx:s.idx,tex:mt&&mt.tex||null,texOffset:mt&&mt.texOffset||0,materialOffset:mt&&mt.materialOffset||0,material:mt&&mt.material||null,bb:bbox(s.used)});continue}
  info.forEach((x,k)=>{const s=slice(x.is,x.is+x.ic+2),mt=texOf(x.p);out.push({off:m,poff:x.p,pk:k,np:info.length,name:inlineName(x.p),nv:s.used.size,pos,nrm,uv,idx:s.idx,tex:mt.tex,texOffset:mt.texOffset,materialOffset:mt.materialOffset,material:mt.material,bb:bbox(s.used)})})}
 // Build one canonical model registry.  Pointer chains, script references and
 // descriptor-only records are evidence sources that contribute memberships;
 // none of them is allowed to silently consume/overwrite a part from another.
 const chainParent=new Map(parts.map(p=>[p,p])),findChain=x=>{while(chainParent.get(x)!==x){chainParent.set(x,chainParent.get(chainParent.get(x)));x=chainParent.get(x)}return x},unionChain=(a,b)=>{const x=findChain(a),y=findChain(b);if(x!==y)chainParent.set(Math.max(x,y),Math.min(x,y))};
 const chainEdges=[],possibleNodeEdges=[];
 for(const p of parts){const link=p+0x44;if(!imp.rel.has(link))continue;const prev=rd(link);if(pset.has(prev)&&prev!==p){unionChain(p,prev);chainEdges.push({from:p,to:prev,type:'part-prev'})}}
 // Some LCS node records hold consecutive part pointers. Keep those edges as
 // review evidence, but don't merge them until the node-record layout is proven.
 {const sp=[...parts].sort((a,b)=>a-b),inPart=o=>{let lo=0,hi=sp.length-1,q=-1;while(lo<=hi){const m=(lo+hi)>>1;if(sp[m]<=o){q=m;lo=m+1}else hi=m-1}return q>=0&&o<sp[q]+0x100};const rels=[...imp.rel].sort((a,b)=>a-b);for(let i=0;i+1<rels.length;i++){const r=rels[i],s=rels[i+1];if(s-r!==4||inPart(r))continue;const a=U(r),b2=U(s);if(a!==b2&&pset.has(a)&&pset.has(b2))possibleNodeEdges.push({from:a,to:b2,record:r,type:'adjacent-node-pointers'})}}
 for(const M of out)M.gid=findChain(M.poff||M.off);
 // Preserve the old broad relocation-based component id only for loading legacy
 // group-only project assignments. It is never used by the new grouping UI.
 const legacyParent=new Map(parts.map(p=>[p,p])),findLegacy=x=>{while(legacyParent.get(x)!==x){legacyParent.set(x,legacyParent.get(legacyParent.get(x)));x=legacyParent.get(x)}return x},unionLegacy=(a,b)=>{const x=findLegacy(a),y=findLegacy(b);if(x!==y)legacyParent.set(Math.max(x,y),Math.min(x,y))};
 for(const e of chainEdges)unionLegacy(e.from,e.to);
 {const sp=[...parts].sort((a,b)=>a-b),inPart=o=>{let lo=0,hi=sp.length-1,q=-1;while(lo<=hi){const m=(lo+hi)>>1;if(sp[m]<=o){q=m;lo=m+1}else hi=m-1}return q>=0&&o<sp[q]+0x100};const rels=[...imp.rel].sort((a,b)=>a-b);for(let i=0;i+1<rels.length;i++){const r=rels[i],ss=rels[i+1];if(ss-r!==4||inPart(r))continue;const a=U(r),b2=U(ss);if(a!==b2&&pset.has(a)&&pset.has(b2))unionLegacy(a,b2)}}
 for(const M of out)M.legacyGid=findLegacy(M.poff||M.off);
 const partRows=new Map();for(const M of out)if(M.poff){if(!partRows.has(M.poff))partRows.set(M.poff,[]);partRows.get(M.poff).push(M)}
 const modelGroups=[],groupById=new Map(),memberships=new Map();
 const readModelName=desc=>{if(!Number.isInteger(desc)||desc<0||desc+0x30>A.length)return'';const raw=A.subarray(desc+0x20,desc+0x30);let end=raw.indexOf(0);if(end<0)end=raw.length;const bytes=raw.subarray(0,end);if(bytes.length<2||[...bytes].some(v=>v<32||v>126))return'';return String.fromCharCode(...bytes).trim()};
 const followPartChain=start=>{const chain=[],seen=new Set();let cur=start;while(pset.has(cur)&&!seen.has(cur)){seen.add(cur);chain.push(cur);const link=cur+0x44;if(!imp.rel.has(link))break;const prev=rd(link);if(!pset.has(prev)||prev===cur)break;cur=prev}return chain};
 const makeGroup=(id,desc,name,kind,source)=>{let g=groupById.get(id);if(!g){g={id,descriptor:desc,name,displayName:name,kind,source,classes:[],entryClasses:[],handlerClasses:[],entryRefs:[],classTableRefs:[],natives:[],roots:[],rootDetails:[],refs:0,parts:[],evidence:[],_partSet:new Set(),_classes:new Set(),_entryClasses:new Set(),_handlerClasses:new Set(),_natives:new Set()};groupById.set(id,g);modelGroups.push(g)}return g};
 const addPartEvidence=(g,poff,ev)=>{if(!pset.has(poff))return;g._partSet.add(poff);g.evidence.push({p:poff,...ev})};
 const addRoots=(g,desc,offsets,role)=>{for(const off of offsets){const rp=desc+off;if(!imp.rel.has(rp))continue;const root=rd(rp);if(!pset.has(root))continue;g.roots.push(root);g.rootDetails.push({offset:off,part:root,role});for(const p of followPartChain(root))addPartEvidence(g,p,{via:'part-prev-chain',root,rootOffset:off,role})}};
 // Native references are authoritative about class ownership.  Descriptor
 // identity (address + role), not display name, is the group key.
 const scriptInfo=Object.create(null);let scriptAnalysis=null;try{scriptAnalysis=analyseStrats(A,B,scriptInfo)}catch(e){console.warn('model-name analysis failed',e)}const modelRefs=scriptAnalysis?.modelRefs||[];const resolvedModelRefs=[];
 // Literal retail classes carry their model table address in the script. The
 // portable generic collision class instead calls Strat_SetModelCollide(r0):
 // each STRAT instance supplies its own table through initial register 0.
 // Resolve that indirection per instance so the inspector sees the real
 // descriptor and CollMesh without pretending the class owns one global table.
 const collisionWad=siWad(A,B);
 for(const ref of modelRefs){
  if(Number.isInteger(ref.table)){resolvedModelRefs.push(ref);continue}
  if(ref.native!=='Strat_SetModelCollide'||!Number.isInteger(ref.register)||!collisionWad)continue;
  const classIndex=collisionWad.classes.findIndex(c=>c.name===ref.cls);if(classIndex<0)continue;
  for(let instanceIndex=0;instanceIndex<collisionWad.instances.length;instanceIndex++){
   const instance=collisionWad.instances[instanceIndex];if(instance.cls!==classIndex||!instance.init)continue;
   const initSlot=instance.init+ref.register*4;
   if(initSlot<0||initSlot+4>A.length||!imp.rel.has(initSlot))continue;
   const table=rd(initSlot);if(!table||table+8>A.length||!imp.rel.has(table)||!imp.rel.has(table+4))continue;
   const desc=rd(table),collMesh=rd(table+4);if(!desc||desc+0x30>A.length||!collMesh||collMesh+0x30>A.length)continue;
   resolvedModelRefs.push({...ref,table,register:ref.register,tableRegister:ref.register,instanceIndex,instanceOffset:instance.off,initOffset:instance.init,collMesh,registration:'instance-init-register'});
  }
 }
 const entryInitialSpawnsByClass=Object.create(null),entrySpawnDetailsByClass=Object.create(null);for(const key of scriptAnalysis?.keys||[]){const ci=scriptInfo[key];if(!ci?.name)continue;if(Array.isArray(ci.entryInitialSpawns)&&ci.entryInitialSpawns.length){const rows=entryInitialSpawnsByClass[ci.name]||(entryInitialSpawnsByClass[ci.name]=[]);for(const child of ci.entryInitialSpawns)if(child&&!rows.includes(child))rows.push(child)}if(Array.isArray(ci.entrySpawnDetails)&&ci.entrySpawnDetails.length){const rows=entrySpawnDetailsByClass[ci.name]||(entrySpawnDetailsByClass[ci.name]=[]);for(const child of ci.entrySpawnDetails)if(child?.name&&!rows.some(x=>x.name===child.name&&x.call===child.call))rows.push(child)}}
 // Indirect class->model links: a class can load a model-table entry address (mov rN,&A[table]) without passing it straight
 // to a Strat_SetModel* native (e.g. variants swapped in later, Guardian_Yang's arrelo, SavePoint's 2nd Base, BeachFern's leaves, BossDoor_Kyza's 2nd door).
 // Scan each class's own code range [entry, next class entry) for such immediates (init code follows the entry). Entries loaded by more than 3 classes come from shared helper code and are ignored.
 try{const w=siWad(A,B);if(w){const ins=siDisasm(w),order=w.classes.map((c,i)=>i).sort((a,b)=>w.classes[a].entry-w.classes[b].entry),rng=[];for(let q=0;q<order.length;q++){const k=order[q],nx=q+1<order.length?w.classes[order[q+1]].entry:Infinity;rng.push([w.classes[k].entry,nx,w.classes[k].name])}
  const isTable=a=>a>0&&a%4===0&&a+4<=A.length&&imp.rel.has(a)&&(()=>{const dd=rd(a);return dd%16===0&&readModelName(dd)&&((imp.rel.has(dd)&&pset.has(rd(dd)))||(imp.rel.has(dd+4)&&pset.has(rd(dd+4))))})();
  const seen=new Map();for(const [pc,i] of ins){if(i.mn!=='mov'||i.form!=='ri32')continue;const imm=i.ext[0];if(!isTable(imm))continue;const r=rng.find(x=>x[0]<=pc&&pc<x[1]);if(!r)continue;if(!seen.has(imm))seen.set(imm,new Set());seen.get(imm).add(r[2])}
  const direct=new Set(modelRefs.map(x=>x.cls+'|'+x.table));let added=0;
  for(const [tb,cl] of seen){if(cl.size>3)continue;for(const c of cl){if(direct.has(c+'|'+tb))continue;modelRefs.push({cls:c,native:'ClassTableRef',table:tb,call:0,arg:0});added++}}
  modelRefs.indirectAdded=added}}catch(e){console.warn('class table-ref scan failed',e)}
 const scriptDescriptorRoles=new Set();
 const addCls=(g,ref)=>{if(ref.native==='ClassTableRef'){(g._prob=g._prob||new Set()).add(ref.cls);if(ref.cls&&Number.isInteger(ref.table))g.classTableRefs.push({cls:ref.cls,table:ref.table})}else{g._classes.add(ref.cls);if(ref.scope==='entry'){g._entryClasses.add(ref.cls);g.entryRefs.push({cls:ref.cls,native:ref.native,call:ref.call,arg:ref.arg,table:ref.table,register:ref.register,conditions:ref.conditions||[]})}else if(ref.scope==='handler')g._handlerClasses.add(ref.cls)}};
 for(const ref of resolvedModelRefs){const table=ref.table;if(!Number.isInteger(table)||table<0||table+4>A.length||!imp.rel.has(table))continue;const desc=rd(table);if(!desc||desc<0||desc+0x30>A.length)continue;const name=readModelName(desc);if(!name)continue;const native=ref.native;
  if(native==='Strat_SetModel'||native==='Strat_SetModelEx'||native==='ClassTableRef'){
   const g=makeGroup('script:model:'+desc.toString(16),desc,name,'model','script');addCls(g,ref);g._natives.add(native);g.refs++;scriptDescriptorRoles.add(desc);
   // The descriptor has two independently stored root slots. Retain each
   // as evidence in one model record, with its offset exposed for inspection.
   addRoots(g,desc,[0],'opaque-list');addRoots(g,desc,[4],'translucent-list');
  }else if(native==='Strat_SetModelCollide'){
   // i-ninja-macos docs (psm.md, collision.md, rendering.md): a model has TWO part lists, [opaque) at desc+0 and [translucent/fade) at desc+4.
   // The model-table entry is {+0 model, +4 CollMesh}; the collision mesh is table+4 (non-renderable data), never desc+4. So both lists are one visible model.
   const g=makeGroup('script:model:'+desc.toString(16),desc,name,'model','script');addCls(g,ref);g._natives.add(native);g.refs++;scriptDescriptorRoles.add(desc);
   addRoots(g,desc,[0],'opaque-list');addRoots(g,desc,[4],'translucent-list');
   if(imp.rel.has(table+4)){const cm=rd(table+4);if(cm){const meta={collMesh:cm,table,register:Number.isInteger(ref.tableRegister)?ref.tableRegister:null,instanceIndex:Number.isInteger(ref.instanceIndex)?ref.instanceIndex:null,instanceOffset:Number.isInteger(ref.instanceOffset)?ref.instanceOffset:null,initOffset:Number.isInteger(ref.initOffset)?ref.initOffset:null,registration:ref.registration||'script-literal-table'};g.collMeshRefs=g.collMeshRefs||[];if(!g.collMeshRefs.some(x=>x.collMesh===cm&&x.instanceIndex===meta.instanceIndex))g.collMeshRefs.push(meta);if(g.collMesh==null)g.collMesh=cm;else if(g.collMesh!==cm){g.collMeshAmbiguous=true;delete g.collMesh}}}
  }else if(native==='Strat_SetAttachModel'){
   const g=makeGroup('script:attachment:'+desc.toString(16),desc,name,'attachment','script');addCls(g,ref);g._natives.add(native);g.refs++;scriptDescriptorRoles.add(desc);
   addRoots(g,desc,[0],'opaque-list');addRoots(g,desc,[4],'translucent-list');
  }else if(native==='Strat_SetShadowModel'){
   const g=makeGroup('script:shadow:'+desc.toString(16),desc,name,'shadow','script');addCls(g,ref);g._natives.add(native);g.refs++;scriptDescriptorRoles.add(desc);addRoots(g,desc,[0,4],'shadow-root');
  }
 }
 // A descriptor can exist without a direct class-script reference (model
 // sub-parts, alternate variants, etc.). Keep these as candidate memberships;
 // overlaps with script groups are preserved as evidence instead of being
 // discarded by a first-claim-wins pass.
 const descriptorCandidates=[];
 for(let desc=0;desc+0x30<=A.length;desc+=0x10){if(scriptDescriptorRoles.has(desc))continue;const name=readModelName(desc);if(!name)continue;const found=[];
  for(const off of [0,4]){const rp=desc+off;if(!imp.rel.has(rp))continue;const root=rd(rp);if(!pset.has(root))continue;const chain=followPartChain(root);if(chain.length)found.push({off,root,chain})}
  if(!found.length)continue;const id='descriptor:'+desc.toString(16),g=makeGroup(id,desc,name,'component','descriptor'),candidatePartCount=new Set(found.flatMap(x=>x.chain)).size;g.confidence='candidate';if(candidatePartCount>32){g.suppressed=true;g.candidatePartCount=candidatePartCount;g.reviewNote='Oversized unreferenced chain ('+candidatePartCount+' parts); retained for diagnostics but not treated as one model.'}
  for(const x of found){g.roots.push(x.root);g.rootDetails.push({offset:x.off,part:x.root,role:'candidate-root'});for(const p of x.chain)addPartEvidence(g,p,{via:'descriptor-part-chain',root:x.root,rootOffset:x.off,role:'candidate'})}
  descriptorCandidates.push(g);
 }
 // Part -> owning model descriptor. Every part record stores a relocated pointer to its model descriptor
 // in the last words of the record (part+0x130 for the common record size, up to ~+0x1c0 for longer records).
 // This is direct, script-independent ownership: it reproduces all ten confirmed 10-00 models and links 99%+ of parts in every level checked.
 const ownerOf=new Map();
 for(const p of parts){for(let off=0x120;off<0x1c8;off+=4){const l=p+off;if(l+4>A.length||!imp.rel.has(l))continue;const dd=rd(l);if(dd%16||!readModelName(dd)||!(imp.rel.has(dd)||imp.rel.has(dd+4)))continue;ownerOf.set(p,dd);break}}
 let ownerMismatches=0;
 {const byDesc=new Map();for(const g of modelGroups){if(g.descriptor==null)continue;if(!byDesc.has(g.descriptor))byDesc.set(g.descriptor,[]);byDesc.get(g.descriptor).push(g);for(const p of g._partSet){const o=ownerOf.get(p);if(o!==undefined&&o!==g.descriptor){ownerMismatches++;(g.ownerMismatch=g.ownerMismatch||[]).push({p,owner:o,ownerName:readModelName(o)})}}}
  const owned=new Map();for(const [p,dd] of ownerOf){if(!owned.has(dd))owned.set(dd,[]);owned.get(dd).push(p)}
  for(const [dd,ps2] of owned){let gs=byDesc.get(dd);if(!gs){const g=makeGroup('descriptor:'+dd.toString(16),dd,readModelName(dd),'component','descriptor');g.confidence='candidate';gs=[g];byDesc.set(dd,gs)}
   for(const g of gs){for(const p of ps2)if(!g._partSet.has(p))addPartEvidence(g,p,{via:'part-backlink',role:'owner'});g.backlinkParts=ps2.length;
    if(g.suppressed&&g.source==='descriptor'&&ps2.length>=g._partSet.size*0.95){g.suppressed=false;g.confidence='backlink-verified';g.reviewNote='Every part record points back to this descriptor, so this is one model (e.g. a whole boss arena).'}}}}
 // Materialise each group's complete unique part list and all memberships.
 for(const g of modelGroups){g.classes=[...g._classes].filter(Boolean).sort();g.entryClasses=[...g._entryClasses].filter(Boolean).sort();g.handlerClasses=[...g._handlerClasses].filter(Boolean).sort();g.probableClasses=[...(g._prob||[])].filter(c=>!g._classes.has(c)).sort();if(!g.classes.length&&g.probableClasses.length)g.classes=g.probableClasses;delete g._prob;g.natives=[...g._natives].sort();g.classTableRefs=[...new Map((g.classTableRefs||[]).map(x=>[x.cls+'|'+x.table,x])).values()];const rows=[];for(const poff of g._partSet)for(const M of(partRows.get(poff)||[]))if(!rows.includes(M))rows.push(M);rows.sort((a,b)=>out.indexOf(a)-out.indexOf(b));g.parts=rows.map(M=>({m:M.off,p:M.poff}));
  if(g.suppressed)for(const M of rows){M.modelCandidateGroups=M.modelCandidateGroups||[];M.modelCandidateGroups.push(g.id)}else for(const M of rows){const a=memberships.get(M.poff)||[];a.push(g);memberships.set(M.poff,a)}delete g._partSet;delete g._classes;delete g._entryClasses;delete g._handlerClasses;delete g._natives;}
 // Conservative fallback: only confirmed previous-part chains create a fallback
 // group. Adjacent relocation words are recorded as possible structure, never
 // used to merge unrelated meshes automatically.
 const components=new Map();for(const M of out){if(!M.poff)continue;const r=findChain(M.poff);if(!components.has(r))components.set(r,[]);components.get(r).push(M)}
 for(const [root,allRows] of components){const rows=allRows.filter(M=>!memberships.has(M.poff));if(rows.length<2||rows.length>32)continue;const id='fallback:part-chain:'+root.toString(16),g={id,descriptor:null,name:'Unverified linked parts',displayName:'Unverified linked parts',kind:'unverified',source:'part-chain',confidence:'low',classes:[],natives:[],roots:[root],rootDetails:[],refs:0,parts:rows.map(M=>({m:M.off,p:M.poff})),evidence:chainEdges.filter(e=>rows.some(M=>M.poff===e.from||M.poff===e.to))};modelGroups.push(g);groupById.set(id,g);for(const M of rows){const a=memberships.get(M.poff)||[];a.push(g);memberships.set(M.poff,a)}}
 // Assign one deterministic primary group for legacy UI fields, but retain all
 // memberships and explicitly flag ambiguity. Verified data can override this
 // primary choice later without deleting the underlying evidence.
 const priority=g=>g.source==='groundtruth'?1000:g.source==='script'?(g.kind==='model'?700:g.kind==='collision'?450:g.kind==='attachment'?430:g.kind==='shadow'?420:400):g.source==='descriptor'?200:g.source==='part-chain'?50:0;
 for(const M of out){const gs=memberships.get(M.poff)||[];gs.sort((a,b)=>priority(b)-priority(a)||((b.refs||0)-(a.refs||0))||((a.descriptor??0)-(b.descriptor??0))||a.id.localeCompare(b.id));M.modelMemberships=gs.map(g=>g.id);M.modelOwner=ownerOf.get(M.poff)||0;const primary=gs[0];
  if(primary){M.modelGroup=primary.id;M.modelKind=primary.kind;M.modelSource=primary.source;M.modelName=primary.displayName||primary.name;M.modelClasses=primary.classes||[];M.modelNatives=primary.natives||[];M.modelDescriptor=primary.descriptor;const ix=primary.parts.findIndex(p=>p.p===M.poff);M.modelPartIndex=ix+1;M.modelPartCount=primary.parts.length;M.modelMembershipConflict=gs.filter(g=>g.kind==='model'&&g.source==='script').length>1;M.modelAlsoIn=gs.slice(1).map(g=>g.id)}
 }
 const membershipConflicts=out.filter(M=>M.modelMembershipConflict).length;
 const entryModelRefs=Object.create(null);for(const ref of modelRefs){if(ref.scope!=='entry'||!ref.cls||!['Strat_SetModel','Strat_SetModelEx','Strat_SetModelCollide'].includes(ref.native))continue;(entryModelRefs[ref.cls]||(entryModelRefs[ref.cls]=[])).push({cls:ref.cls,native:ref.native,call:ref.call,arg:ref.arg,argRegister:ref.argRegister,table:Number.isInteger(ref.table)?ref.table:null,register:Number.isInteger(ref.register)?ref.register:null,conditions:Array.isArray(ref.conditions)?ref.conditions:[]})}for(const rows of Object.values(entryModelRefs))rows.sort((a,b)=>a.call-b.call);
 out.entryModelRefs=entryModelRefs;out.entryInitialSpawnsByClass=entryInitialSpawnsByClass;out.entrySpawnDetailsByClass=entrySpawnDetailsByClass;out.modelGroups=modelGroups;out.modelGroupById=groupById;out.modelMembershipConflicts=membershipConflicts;out.modelRefCount=modelRefs.length;out.modelIndirectRefs=modelRefs.indirectAdded||0;out.modelGraph={chainEdges,possibleNodeEdges,scriptDescriptors:[...scriptDescriptorRoles],descriptorCandidateCount:descriptorCandidates.length,ownerLinked:ownerOf.size,ownerMismatches,policy:'all evidence retained; primary membership is prioritised, never first-claim ownership'};
 return out}
return{fnv,deflate,packWad,patchLcs,patchCustomTextures,patchCustomModelVisual,patchCustomModelStaticScript,patchCustomModels,healResDir,SoundPlan,buildPca,bankInfo,riffChunks,ampcSoundOffsets,ampcTracks,rebuildVol,rebuildVolWithAdditions,prefabCheck,referrers,parseModels,parseCollisionMesh,buildPrimitiveCollisionShape,buildMeshCollisionShape,applyCollisionTagModesToRecords,classReports,KN,parseBank,ResIndex,resResolver,SrcCtx,classify,dataClosure,canon,Builder,copyData,copyGraph,mergeB,copierSelfTest,groupOf,transplantClasses}})();

export { EC };
