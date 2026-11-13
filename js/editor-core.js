import {
  analyseStrats, SiAn, fixups, parseTga, parseVol,
  siCstr, siDisasm, siPrint, siWad
} from './vol-core.js';

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
 const writePathOverride=(instanceOff,positions,cloneExisting)=>{
  const pn=U(instanceOff+0x30);
  if(!pn)throw'cannot edit a waypoint path that has no node chain';
  const sn=pathNodes(d,U,pn);
  if(!sn.length||positions.length!==sn.length)throw'waypoint path node count changed; adding or removing nodes is not supported';
  let targets=sn,cur=sn.indexOf(pn);
  if(cloneExisting){
   const base=alloc(sn.length*0x40,16);targets=sn.map((_,i)=>base+i*0x40);
   sn.forEach((n,k)=>{
    const t=targets[k];
    for(let w=0;w<0x40;w+=4){W(t+w,U(n+w));if(w!==0&&w!==4&&rel.has(n+w))addRel(t+w)}
    W(t,k?targets[k-1]:0);if(k)addRel(t);
    W(t+4,k+1<targets.length?targets[k+1]:0);if(k+1<targets.length)addRel(t+4);
   });
   W(instanceOff+0x30,targets[Math.max(0,cur)]);addRel(instanceOff+0x30);
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
  if(m.path){const pos=[F(o+0x10),F(o+0x14),F(o+0x18)];writePathOverride(o,m.path.map(n=>n.map((v,k)=>v+pos[k])),true)}
  if(m.trigger)writeTriggerShape(o,m.trigger,[F(o+0x10),F(o+0x14),F(o+0x18)],U(o+0x34));
  rot(o,m.dy||0,m.dp||0,m.dr||0);
  const rg=Object.entries(m.regs||{});if(rg.length){const cp=U(o+0x28),ni=d.getUint16(cp+0x18,true),old=U(o+0x2c),np=alloc(4*Math.max(ni,1));
   for(let r=0;r<ni;r++){W(np+4*r,U(old+4*r));if(rel.has(old+4*r))addRel(np+4*r)}W(o+0x2c,np);addRel(o+0x2c);
   for(const[r,v]of rg){if(!(+r<ni))throw'register '+r+' out of range';rel.delete(np+4*r);W(np+4*r,v)}}}
 // ---- 2) new instances: move the instance table (and link table) to the end of the block and append
 const adds=ops.adds||[];
 let lkChanged=false;
 if(adds.length||del.size){const kept=[];for(let i=0;i<nin;i++)if(!del.has(i))kept.push(i);const map=new Map(kept.map((o,n)=>[o,n])),nk=kept.length,nn=nk+adds.length;
  // the per-class lists end where the instance table starts, so they move together with it
  let bs=ins;for(let i=0;i<ncl;i++)bs=Math.min(bs,U(cl+i*CLS+0x1c));const bl=ins-bs,Tb=alloc(bl+nn*INS),T=Tb+bl;A.copyWithin(Tb,bs,ins);for(let w=0;w<bl;w+=4)if(rel.has(bs+w))addRel(Tb+w);
  for(let i=0;i<ncl;i++){const o=cl+i*CLS+0x1c,v=U(o);if(v>=bs&&v<ins)W(o,v-bs+Tb);else if(v>=ins)W(o,T)}
  
  kept.forEach((o0,n)=>{const so=ins+o0*INS,to=T+n*INS;A.copyWithin(to,so,so+INS);for(let w=0;w<INS;w+=4)if(rel.has(so+w))addRel(to+w);W(to+0x38,n)});
  const lk=[];for(let i=0;i<nlk;i++){const ow=d.getUint16(lnk+4*i,true),rg=d.getUint16(lnk+4*i+2,true);if(map.has(ow))lk.push([map.get(ow),rg])}
  // registers that hold instance indices follow the renumbering (copy-on-write: init arrays can be shared)
  if(del.size){const cow=new Set();for(const[n,rg]of lk){const to=T+n*INS;let ip=U(to+0x2c);const v=U(ip+4*rg);if(del.has(v))throw'instance #'+kept[n]+' links to removed instance #'+v+' (register '+rg+') in '+wadName;
    if(map.has(v)&&map.get(v)!==v){if(!cow.has(n)){const ni=d.getUint16(U(to+0x28)+0x18,true),np=alloc(4*Math.max(ni,1));for(let r=0;r<ni;r++){W(np+4*r,U(ip+4*r));if(rel.has(ip+4*r))addRel(np+4*r)}W(to+0x2c,np);cow.add(n);ip=np}W(ip+4*rg,map.get(v))}}
   lkChanged=true}
  const idToIdx=new Map(adds.map((a,n)=>[a.id,nk+n]).filter(x=>x[0]!==undefined));
  adds.forEach((a,n)=>{const sw=a.from.w===wadName?{A:A0,B:B0}:srcWad(a.from.w);if(!sw)throw'prefab source '+a.from.w+' not found';
   const same=a.from.w===wadName,sA=sw.A,sd=new DataView(sA.buffer,sA.byteOffset,sA.length),sU=o=>sd.getUint32(o,true),sF=o=>sd.getFloat32(o,true),sRel=same?imp.rel:fixups(sw.B).rel,
    sh=(fixups(sw.B)[0x8000010e]||[])[0];if(sh==null)throw'bad prefab source';
   const sIns=sU(sh+0x28),sLnk=sU(sh+0x2c),sNl=sd.getUint16(sh+0x32,true),so=sIns+a.from.i*INS,idx=nk+n,o=T+idx*INS;
   const scp=sU(so+0x28),cname=cstrA(sA,sU(scp+4)),tcp=clsByName(cname);if(tcp<0)throw'class '+cname+' does not exist in '+wadName;
   for(let w=0;w<INS;w+=4)W(o+w,sU(so+w));
   const dd=[0,1,2].map(k=>a.p[k]-sF(so+0x10+4*k));for(let k=0;k<3;k++)WF(o+0x10+4*k,a.p[k]);
   W(o+0x28,tcp);addRel(o+0x28);W(o+0x38,idx);
   // init registers
   const ni=d.getUint16(tcp+0x18,true),sip=sU(so+0x2c),ip=alloc(4*Math.max(ni,1)),smap={};
   for(let r=0;r<ni;r++){const v=sU(sip+4*r);
    if(sRel.has(sip+4*r)){const s=siPrint(siCstr(sA,v));
     if(s!==null){const np=alloc(s.length+1,4);for(let c=0;c<s.length;c++)A[np+c]=s.charCodeAt(c);W(ip+4*r,np);addRel(ip+4*r)}
     else if(same){W(ip+4*r,v);addRel(ip+4*r)}else{let n;try{n=gcopy(sw,a.from.w,v)}catch(x){throw'prefab '+cname+' register '+r+' points into its own level data that cannot be copied: '+x}W(ip+4*r,n);addRel(ip+4*r)}}
    else W(ip+4*r,v)}
   W(o+0x2c,ip);addRel(o+0x2c);
   for(const[r,v]of Object.entries(a.regs||{})){if(!(+r<ni))throw'register '+r+' out of range';rel.delete(ip+4*r);W(ip+4*r,v)}
   const lkSet=new Set();   // registers rewired to other new instances (deep copy): a copied spawner links to its own copied children
   for(const[rg,cid]of(a.lk||[])){if(!(rg<ni))throw'link register '+rg+' out of range';const ci=idToIdx.get(cid);rel.delete(ip+4*rg);lkSet.add(rg);if(ci===undefined)W(ip+4*rg,0);else{W(ip+4*rg,ci);lk.push([idx,rg])}}
   for(let i=0;i<sNl;i++){const ow=sd.getUint16(sLnk+4*i,true),rg=sd.getUint16(sLnk+4*i+2,true);if(ow!==a.from.i||lkSet.has(rg))continue;
    if(same){lk.push([idx,rg]);const v=U(ip+4*rg);if(del.has(v))throw'prefab links to removed instance #'+v;if(map.has(v)&&map.get(v)!==v)W(ip+4*rg,map.get(v))}
    else if(a.regs&&a.regs[rg]!==undefined){lk.push([idx,rg]);const v=U(ip+4*rg);if(del.has(v))throw'prefab links to removed instance #'+v;if(map.has(v)&&map.get(v)!==v)W(ip+4*rg,map.get(v))}   // link picked by hand in the editor: an instance of THIS level
    else{rel.delete(ip+4*rg);W(ip+4*rg,0)}}   // another level's instance numbers mean nothing here: leave the link empty
   // path nodes (0x40 each; +0 prev, +4 next)
   const pn=sU(so+0x30);W(o+0x30,0);
   if(pn){const sn=pathNodes(sd,sU,pn),cur=sn.indexOf(pn),base=alloc(sn.length*0x40);
    sn.forEach((n,k)=>{const t=base+k*0x40;for(let w=0;w<0x40;w+=4)W(t+w,sU(n+w));
     W(t,k?base+(k-1)*0x40:0);W(t+4,k+1<sn.length?base+(k+1)*0x40:0);if(k)addRel(t);if(k+1<sn.length)addRel(t+4);
     for(let w=8;w<0x40;w+=4)if(sRel.has(n+w)){if(!same)throw'path node points into its own level data';addRel(t+w)}
     for(let q=0;q<3;q++)WF(t+8+4*q,sF(n+8+4*q)+dd[q])});
    W(o+0x30,base+Math.max(cur,0)*0x40);addRel(o+0x30)}
   if(a.path){const pos=a.p.slice();writePathOverride(o,a.path.map(n=>n.map((v,k)=>v+pos[k])),false)}
   // shape record (0x20) + polygon vertices
   const sp=sU(so+0x34);W(o+0x34,0);
   if(sp){const t=alloc(0x20);for(let w=0;w<0x20;w+=4)W(t+w,sU(sp+w));const ty=sU(sp)&0xffff,cnt=sU(sp)>>>16,pp=sU(sp+4);
    for(let q=0;q<3;q++){WF(t+8+4*q,sF(sp+8+4*q)+dd[q]);WF(t+20+4*q,sF(sp+20+4*q)+dd[q])}
    if((ty==5||ty==6)&&cnt>=3&&pp&&sRel.has(sp+4)){const pv=alloc(12*cnt);for(let v=0;v<cnt;v++)for(let q=0;q<3;q++)WF(pv+12*v+4*q,sF(pp+12*v+4*q)+dd[q]);W(t+4,pv);addRel(t+4)}else W(t+4,0);
    W(o+0x34,t);addRel(o+0x34)}
   if(a.trigger)writeTriggerShape(o,a.trigger,a.p,U(o+0x34));
   rot(o,a.dy||0,a.dp||0,a.dr||0)});
  // links of existing instances to NEW instances picked by hand (the new instance's number is only known now)
  for(const[k,m]of Object.entries(ops.mods||{})){if(!m.lk||!m.lk.length||del.has(+k))continue;const to=T+map.get(+k)*INS,cp=U(to+0x28),nir=d.getUint16(cp+0x18,true),old=U(to+0x2c),np=alloc(4*Math.max(nir,1));
   for(let r=0;r<nir;r++){W(np+4*r,U(old+4*r));if(rel.has(old+4*r))addRel(np+4*r)}W(to+0x2c,np);addRel(to+0x2c);
   for(const[rg,cid]of m.lk){if(!(rg<nir))throw'link register '+rg+' out of range';const ci=idToIdx.get(cid);rel.delete(np+4*rg);W(np+4*rg,ci===undefined?0:ci)}}
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
  const r=transplantClasses(A0,B0,S,names,{res:resResolver(S,T).hook,cls,addRes:true,snd:env&&env.snd},{allowDup:variants.length>0,aliases});A0=r.A;B0=r.B}
 return patchLcs0(A0,B0,ops,wadName,srcWad,env)}
// ---- read-only dependency report for every class of a strat wad: follows the code the class can actually run (entry + its handlers + called subroutines) and classifies every pointer in it
const KN={1:'texture',4:'level data',6:'material',7:'material',8:'skeleton/animation',0x20:'draw part',0x21:'mesh part',0x22:'mesh part',0x23:'vertex buffer',0x24:'mesh',0x113:'sound bank',0x115:'sound'};
function classReports(A,B){const w=siWad(A,B);if(!w)return{};const az=new SiAn(w),imp=fixups(B),h=imp[0x8000010e][0],U=w.U,code=U(h+0x10),ncode=U(h+0x1c),cl0=U(h+0x14),clEnd=cl0+0x2c*w.classes.length,ins=U(h+0x28);
 const res=[];for(const k in imp){if(k==='rel'||+k===0x8000010e)continue;for(const o of imp[k])res.push([o,+k&0xffff])}res.sort((a,b)=>a[0]-b[0]);
 const resOf=v=>{let lo=0,hi=res.length-1,r=-1;while(lo<=hi){const m=(lo+hi)>>1;if(res[m][0]<=v){r=m;lo=m+1}else hi=m-1}return r>=0&&v-res[r][0]<0x400?res[r][1]:-1};
 const byOff=new Map(w.classes.map(c=>[c.off,c.name])),order=w.classes.map((c,i)=>i).sort((a,b)=>w.classes[a].entry-w.classes[b].entry),lo={};let prev=0;for(const k of order){lo[k]=[prev,w.classes[k].entry];prev=w.classes[k].entry}
 const out={},plural=(n,s)=>n+' '+s+(n>1?'s':'');
 w.classes.forEach((c,k)=>{try{const[a0,b0]=lo[k],roots=[c.entry];for(const[key,p]of c.events)if(p&&a0<p&&p<b0&&az.ins.has(p))roots.push(p);
  const every=new Set(),done=new Set(),pend=[...roots];let bytes=0;
  while(pend.length){const p=pend.pop();if(done.has(p)||!az.ins.has(p))continue;done.add(p);const[offs,calls]=az.reach([p]);offs.forEach(o=>every.add(o));for(const cc of calls)pend.push(cc)}
  const kinds={},cls=new Set(),strs=[],ptrs=[];
  for(const o of every){const i=az.ins.get(o);if(!i)continue;bytes+=4*i.size;for(let q=0;q<i.size;q++){const r=o+4*q;if(!w.rel.has(r))continue;const v=U(r);let t;
    if(byOff.has(v)){t='class';cls.add(byOff.get(v))}else if(v>=code&&v<code+4*ncode)t='code';else if(v>=cl0&&v<clEnd)t='class record';
    else{const s=v>=0x8c000&&v<code&&siCstr(A,v),rr=resOf(v);if(s&&/^[\x20-\x7e]{1,80}$/.test(s)&&A[v-1]===0){t='string';if(strs.length<8&&!strs.includes(s))strs.push(s)}else if(rr>=0&&v<code)t=KN[rr]||('resource 0x'+rr.toString(16));else if(v>=clEnd&&v<ins)t='event/pool data';else if(v>=0x8c000&&v<code)t='level data';else t='other'}
    kinds[t]=(kinds[t]||0)+1;if(ptrs.length<400)ptrs.push([t,v,r])}}
  cls.delete(c.name);const reasons=[];
  for(const t in kinds){if(['class','code','string','event/pool data','texture','material','skeleton/animation','mesh part','mesh','vertex buffer','level data','other','sound','sound bank'].includes(t))continue;reasons.push(t==='level data'||t==='other'?'points at '+plural(kinds[t],'object')+' in the level data region (size unknown)':t==='class record'?'points inside a class record':'uses '+plural(kinds[t],t)+' of the source level')}
  out[c.name]={name:c.name,kinds,classes:[...cls],strs,bytes,reasons,ptrs,assets:reasons.length>0}}
 catch(e){out[c.name]={name:c.name,kinds:{},classes:[],strs:[],bytes:0,reasons:['analysis failed: '+e],assets:true}}});
 return out}
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
const RES_COPY=new Set([1,4,5,6,7,8,0x21,0x22,0x23,0x24,0x113,0x115]);
const GROUP={0x113:0,0x115:1,0x10a:2,0x1:3,0x6:4,0x7:5,0x4:6,0x8:7,0x117:8,0x10e:9,0x24:10,0x23:10,0x21:11,0x5:11,0x22:11,0x402:12};
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
   let size=ext(t),extra=null;
   if(c.type===0x113){const bi=bankInfo(A,t);if(!bi||bi.strmAt==null)throw'sound bank @'+t.toString(16)+' has no stream chunk';size=Math.ceil(bi.tot/4)*4;if(t+size>A.length)throw'sound bank @'+t.toString(16)+' runs past the end of the level'}
   if(c.type===0x115)size=Math.min(size,16);if((c.type===0x21||c.type===0x22)&&size===16&&S.res.get(t+16)===5){extra={type:5,at:16};size=16+ext(t+16)}
   if(size<=0||size>0x1000)throw resName(c.type)+' @'+t.toString(16)+' has an unexpected size ('+size+')';
   const nd={k:'res',type:c.type,off:t,size,ptrs:[],own:null,owned:[],deps:new Set(),extra,rels:[],kinds:[]};nodes.set(t,nd);order.push(nd);units.push(nd);
   if(extra)nodes.set(t+16,{k:'alias',parent:nd,delta:16});
   if(own){own.deps.add(nd)}
   for(let p=t;p<t+size;p+=4)if(relS.has(p)){const v=D(p),off=p-t;nd.ptrs.push([off,v]);
    if((nd.type===0x21||nd.type===0x22)&&off===0xc&&splittable(v)){let g=groups.get(v);if(!g){g={k:'group',m:v,parts:[],recs:[],deps:new Set(),rels:[],kinds:[]};groups.set(v,g);units.push(g)}g.parts.push(nd);nd.split=g;nd.deps.add(g);
     const a=D(t+0x38);nd.recOff=a;if(!g.recs.includes(a))g.recs.push(a);continue}
    let force=0;if(nd.type===1&&off===16){const tsz=D(t+20);if(tsz>0&&tsz<BIG&&ext(v)<tsz)force=tsz}
    if((nd.type===0x23||nd.type===0x24)&&(off===16||off===24)){const str=D(t+8),nv=D(t+12),ni=D(t+20);force=off===16?nv*str:ni*2;if(force<=0||force>BIG)throw resName(nd.type)+' @'+t.toString(16)+' has a bad buffer size'}
    q.push([v,nd,force])}
   continue}
  if(c.k==='data'){const ex=ext(t),lim=own?BIG:0x10000;if(!fs&&ex>lim)throw'data @'+t.toString(16)+' is too large to copy safely ('+ex+' bytes)';const size=fs||ex;if(size<=0)throw'empty data object @'+t.toString(16);
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
  if(nd.k==='res'&&nd.type===0x113){const bi=bankInfo(A,nd.off);W(to+(bi.strmAt-nd.off),hooks.snd.add({w:S.wadName,kind:bi.kind,off:bi.off,len:bi.len}))}
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
// where the audio of the banks being copied goes in the target's PCA; add() returns the new stream offset for the copied bank
function SoundPlan(h78,h7c){const p={h78,h7c,h78_0:h78,h7c_0:h7c,adds:[],seen:new Map(),add(r){const key=r.w+'|'+r.kind+'|'+r.off+'|'+r.len;if(p.seen.has(key))return p.seen.get(key);let n;
  if(r.kind==='WAVE'){n=p.h78;p.h78+=r.len}else if(r.kind==='WAVS'){n=p.h7c;p.h7c+=Math.ceil(r.len/0x800)*0x800}else throw'sound bank type '+r.kind+' is not supported';
  p.adds.push({...r,newOff:n});p.seen.set(key,n);return n}};return p}
// new PCA bytes: old resident block + copied WAVE data, then the streamed block (moved to the new aligned base) + copied WAVS data. src(w)->{pca,h78} of the level the sound comes from
function buildPca(old,plan,src){const al=x=>Math.ceil(x/0x800)*0x800,oldBase=al(plan.h78_0),newBase=al(plan.h78),size=Math.max(old.length,Math.ceil((newBase+plan.h7c)/0x8000)*0x8000),out=new Uint8Array(size);
 out.set(old.subarray(0,plan.h78_0),0);out.set(old.subarray(oldBase,oldBase+plan.h7c_0),newBase);
 for(const a of plan.adds){const s=src(a.w);if(!s)throw'sound source '+a.w+' not found';const from=a.kind==='WAVE'?a.off:al(s.h78)+a.off;if(from+a.len>s.pca.length)throw'sound data of '+a.w+' is outside its .PCA';out.set(s.pca.subarray(from,from+a.len),a.kind==='WAVE'?a.newOff:newBase+a.newOff)}
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
// each class's events / per-class list (+0x1c) are segments of flat tables that grow by appending at the end of class order.
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
 const inGrp=v=>blocks.some(b=>v>=b.p&&v<b.p+4*b.n);   // only events whose handler lives in the copied blocks belong to the group
 const segStart=new Map();for(const g of [...new Set(grp.map(c=>S.U(c.off+0x24)))].sort((a,b)=>a-b)){const e=sEv0.find(v=>v>g)??sEvEnd;segStart.set(g,segs.length);for(let p=g;p<e;p+=8)if(inGrp(S.U(p+4)))segs.push([S.U(p),S.U(p+4),g])}
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
 const evStart=ecNew+evOldBytes;segs.forEach(([key,hd],i)=>{const o=evStart+i*8;W(o,key);const n=hd?mapCode(hd):0;if(hd&&n==null)throw'event handler outside the copied blocks';W(o+4,n||0);if(n)bld.addRel(o+4)});
 // 5) new class records
 const poolVal=tcls.length?tcls[0].pool:evLo;
 const sPoolLo=Math.min(...S.w.classes.map(c=>S.U(c.off+0x20))),sEvLo=Math.min(S.cl0,...sEv0),poolOk=p=>p>=sPoolLo&&p<sEvLo&&sEvLo-sPoolLo<=0x10000,poolNew=grp.some(c=>poolOk(S.U(c.off+0x20)))?bld.alloc(sEvLo-sPoolLo,4):0;
 if(poolNew)bld.A.set(S.A.subarray(sPoolLo,sEvLo),poolNew);   // event-name strings (key>>16 indexes them): the new classes keep their own
 grp.forEach((c,i)=>{const o=clsNew+(ncl+i)*0x2c;for(let k=0;k<0x2c;k+=4)W(o+k,S.U(c.off+k));
  W(o,h);bld.addRel(o);const nm=(opt.aliases&&opt.aliases[c.name])||c.name,ns=bld.alloc(nm.length+2,4)+1;for(let q=0;q<nm.length;q++)bld.A[ns+q]=nm.charCodeAt(q);W(o+4,ns);bld.addRel(o+4);
  W(o+8,mapCode(c.entry));bld.addRel(o+8);W(o+0xc,bmap.get(S.U(c.off+0xc)));bld.addRel(o+0xc);
  const sb=S.U(c.off+0x1c);W(o+0x1c,sb>=sIns?insNew:bindNew+bindOldBytes+(sb-gMin));bld.addRel(o+0x1c);
  const sp=S.U(c.off+0x20),sg=S.U(c.off+0x24);W(o+0x20,poolNew&&poolOk(sp)?poolNew+(sp-sPoolLo):poolVal);bld.addRel(o+0x20);W(o+0x24,evStart+8*(segStart.has(sg)?segStart.get(sg):segs.length));bld.addRel(o+0x24);W(o+0x28,statNew);bld.addRel(o+0x28)});
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
// Appends whatever is missing (keeps the table address-sorted when it was), bumps the counts. No-op when the directory is already complete.
function healResDir(A0,B0){
 const imp=fixups(B0),n0=A0.length,d=new DataView(A0.buffer,A0.byteOffset,n0),U=o=>(o>=0&&o+4<=n0)?d.getUint32(o,true):0;
 const tex=imp[0x80000001]||[],mesh=(imp[0x80000024]||[]).concat(imp[0x80000023]||[]);
 const none={A:A0,B:B0,added:{tex:0,mesh:0},dir:null};if(!tex.length||!mesh.length)return none;
 const ts=new Set(tex),ms=new Set(mesh),cands=[];
 for(const p of imp.rel){if(p<8||p+12>n0||!imp.rel.has(p+8))continue;const t=U(p),n=U(p-4),mt=U(p+8),m=U(p+4);
  if(!(n>=1&&n<=tex.length&&tex.length-n<=512&&m>=1&&m<=mesh.length&&mesh.length-m<=512&&t>0&&t+4*n<=n0&&mt>0&&mt+4*m<=n0))continue;
  let ok=true;const seen=new Set();for(let i=0;i<n&&ok;i++){const v=U(t+4*i);if(!ts.has(v)||seen.has(v))ok=false;seen.add(v)}
  seen.clear();for(let i=0;i<m&&ok;i++){const v=U(mt+4*i);if(!ms.has(v)||seen.has(v))ok=false;seen.add(v)}
  if(ok)cands.push(p)}
 if(cands.length!==1){if(cands.length>1)throw'resource directory is ambiguous';return none}
 const dir=cands[0],bld=Builder(A0,B0);
 const fix=(cl,pl,all)=>{const n=bld.U(cl),old=bld.U(pl),cur=[];for(let i=0;i<n;i++)cur.push(bld.U(old+4*i));
  const have=new Set(cur),add=[...new Set(all)].filter(v=>!have.has(v));if(!add.length)return 0;
  const asc=cur.every((v,i)=>!i||v>=cur[i-1]),lst=asc?cur.concat(add).sort((a,b)=>a-b):cur.concat(add),np=bld.alloc(4*lst.length,16);
  lst.forEach((v,i)=>{bld.W(np+4*i,v);bld.addRel(np+4*i)});bld.W(pl,np);bld.W(cl,lst.length);return add.length};
 const at=fix(dir-4,dir,tex),am=fix(dir+4,dir+8,mesh);
 if(!at&&!am)return{...none,dir};
 const r=bld.finish();return{A:r.A,B:r.B,added:{tex:at,mesh:am},dir}}
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
// object meshes (type 0x24: 32-byte vertices pos/normal/uv + one stitched triangle strip). A mesh is split into its parts (0x21/0x22): every part owns a slice of the
// strip (index range) and its own material. Part table (verified on every mesh of 10.vol and 20.vol): the 4th (count,pointer) pair of the part points at
// [5, vertexCount, indexCount, ptr, 0,0,0,0, verticesRemainingAfter, indicesRemainingAfter]; parts tile the vertex and index buffers exactly (index slice = indexCount+2 incl. stitch).
function parseModels(A,B){const imp=fixups(B),meshes=imp[0x80000024];if(!meshes||!meshes.length)return[];
 const d=new DataView(A.buffer,A.byteOffset,A.length),U=o=>d.getUint32(o,true),F=o=>d.getFloat32(o,true),rd=o=>(o>=0&&o+4<=A.length)?U(o):0;
 const tex=new Set(imp[0x80000001]||[]),s6=new Set(imp[0x80000006]||[]),s7=new Set(imp[0x80000007]||[]);
 const res=(t,k=0)=>{if(tex.has(t))return t;if(k>4)return 0;if(s7.has(t))return res(rd(rd(t+16)),k+1);if(s6.has(t))return res(rd(rd(rd(t+16)+4)),k+1);return 0};
 const parts=[...(imp[0x80000021]||[]),...(imp[0x80000022]||[])],tc={},out=[];
 // parts of one model: linked through the part->previous-part pointer (+0x44), through node records that list several parts side by side (parts of one big mesh are NOT merged: such a mesh holds many separate props)
 const pset=new Set(parts); // only part->previous-part links form a safe fallback component
 const inlineName=p=>{for(let o=p;o<Math.min(p+0x100,A.length);o++){let q=o;while(q<A.length&&((A[q]>=65&&A[q]<=90)||(A[q]>=97&&A[q]<=122)||(A[q]>=48&&A[q]<=57)||A[q]===32||A[q]===95||A[q]===46))q++;if(q-o>=4&&A[q]===0&&(o===p||A[o-1]===0||A[o-1]<32||A[o-1]>126))return String.fromCharCode(...A.subarray(o,q))}return''};
 const texOf=p=>{const tk=res(U(p+16));if(tk&&!(tk in tc))tc[tk]=parseTga(A,tk);return tk?tc[tk]:null};
 for(const m of meshes){const str=U(m+8),nv=U(m+12),vp=U(m+16),ni=U(m+20),ip=U(m+24);if(!nv||!ni||str<32||vp+nv*str>A.length||ip+ni*2>A.length)continue;
  const pos=new Float32Array(nv*3),nrm=new Float32Array(nv*3),uv=new Float32Array(nv*2);
  for(let i=0;i<nv;i++){const o=vp+str*i;for(let k=0;k<3;k++){pos[3*i+k]=F(o+4*k);nrm[3*i+k]=F(o+12+4*k)}uv[2*i]=F(o+24);uv[2*i+1]=F(o+28)}
  const I=new Uint16Array(ni);for(let j=0;j<ni;j++)I[j]=d.getUint16(ip+2*j,true);
  const slice=(s,e)=>{const t=[];let used=new Set();for(let j=s;j+2<e;j++){const a=I[j],b=I[j+1],c2=I[j+2];if(a===b||b===c2||a===c2||a>=nv||b>=nv||c2>=nv)continue;if((j-s)&1)t.push(b,a,c2);else t.push(a,b,c2);used.add(a);used.add(b);used.add(c2)}return{idx:Uint32Array.from(t),used}};
  const bbox=used=>{const mn=[1e9,1e9,1e9],mx=[-1e9,-1e9,-1e9];for(const v of used)for(let k=0;k<3;k++){const x=pos[3*v+k];if(x<mn[k])mn[k]=x;if(x>mx[k])mx[k]=x}return used.size?[mn,mx]:[[0,0,0],[0,0,0]]};
  const ps=parts.filter(p=>U(p+12)===m).sort((a,b)=>a-b);
  const info=ps.map(p=>{const a=U(p+0x20+24),cnt=U(p+0x1c+24);if(cnt<1||a<=0||a+40>A.length)return null;const vc=U(a+4),ic=U(a+8),rv=U(a+32),ri=U(a+36),is=ri;/* rv/ri are counted from the START (verified against a D3D draw capture: MinVertexIndex==rv, StartIndex==ri) */if(ri+ic+2>ni||rv+vc>nv)return null;return{p,vc,vs:rv,is,ic}});
  if(!ps.length||info.some(x=>!x)){const s=slice(0,ni),p0=ps[0]||0;out.push({off:m,poff:p0,pk:0,np:Math.max(ps.length,1),name:p0?inlineName(p0):'',nv:s.used.size,pos,nrm,uv,idx:s.idx,tex:p0?texOf(p0):null,bb:bbox(s.used)});continue}
  info.forEach((x,k)=>{const s=slice(x.is,x.is+x.ic+2);out.push({off:m,poff:x.p,pk:k,np:info.length,name:inlineName(x.p),nv:s.used.size,pos,nrm,uv,idx:s.idx,tex:texOf(x.p),bb:bbox(s.used)})})}
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
 const makeGroup=(id,desc,name,kind,source)=>{let g=groupById.get(id);if(!g){g={id,descriptor:desc,name,displayName:name,kind,source,classes:[],natives:[],roots:[],rootDetails:[],refs:0,parts:[],evidence:[],_partSet:new Set(),_classes:new Set(),_natives:new Set()};groupById.set(id,g);modelGroups.push(g)}return g};
 const addPartEvidence=(g,poff,ev)=>{if(!pset.has(poff))return;g._partSet.add(poff);g.evidence.push({p:poff,...ev})};
 const addRoots=(g,desc,offsets,role)=>{for(const off of offsets){const rp=desc+off;if(!imp.rel.has(rp))continue;const root=rd(rp);if(!pset.has(root))continue;g.roots.push(root);g.rootDetails.push({offset:off,part:root,role});for(const p of followPartChain(root))addPartEvidence(g,p,{via:'part-prev-chain',root,rootOffset:off,role})}};
 // Native references are authoritative about class ownership.  Descriptor
 // identity (address + role), not display name, is the group key.
 const modelRefs=(()=>{try{return analyseStrats(A,B,{} )?.modelRefs||[]}catch(e){console.warn('model-name analysis failed',e);return[]}})();
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
 const addCls=(g,ref)=>{if(ref.native==='ClassTableRef')(g._prob=g._prob||new Set()).add(ref.cls);else g._classes.add(ref.cls)};
 for(const ref of modelRefs){const table=ref.table;if(!Number.isInteger(table)||table<0||table+4>A.length||!imp.rel.has(table))continue;const desc=rd(table);if(!desc||desc<0||desc+0x30>A.length)continue;const name=readModelName(desc);if(!name)continue;const native=ref.native;
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
   if(imp.rel.has(table+4)){const cm=rd(table+4);if(cm)g.collMesh=cm}
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
 for(const g of modelGroups){g.classes=[...g._classes].filter(Boolean).sort();g.probableClasses=[...(g._prob||[])].filter(c=>!g._classes.has(c)).sort();if(!g.classes.length&&g.probableClasses.length)g.classes=g.probableClasses;delete g._prob;g.natives=[...g._natives].sort();const rows=[];for(const poff of g._partSet)for(const M of(partRows.get(poff)||[]))if(!rows.includes(M))rows.push(M);rows.sort((a,b)=>out.indexOf(a)-out.indexOf(b));g.parts=rows.map(M=>({m:M.off,p:M.poff}));
  if(g.suppressed)for(const M of rows){M.modelCandidateGroups=M.modelCandidateGroups||[];M.modelCandidateGroups.push(g.id)}else for(const M of rows){const a=memberships.get(M.poff)||[];a.push(g);memberships.set(M.poff,a)}delete g._partSet;delete g._classes;delete g._natives;}
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
 out.modelGroups=modelGroups;out.modelGroupById=groupById;out.modelMembershipConflicts=membershipConflicts;out.modelRefCount=modelRefs.length;out.modelIndirectRefs=modelRefs.indirectAdded||0;out.modelGraph={chainEdges,possibleNodeEdges,scriptDescriptors:[...scriptDescriptorRoles],descriptorCandidateCount:descriptorCandidates.length,ownerLinked:ownerOf.size,ownerMismatches,policy:'all evidence retained; primary membership is prioritised, never first-claim ownership'};
 return out}
return{fnv,deflate,packWad,patchLcs,healResDir,SoundPlan,buildPca,bankInfo,rebuildVol,prefabCheck,referrers,parseModels,classReports,KN,parseBank,ResIndex,resResolver,SrcCtx,classify,dataClosure,canon,Builder,copyData,copyGraph,mergeB,copierSelfTest,groupOf,transplantClasses}})();

export { EC };
