
import {readFileSync}from'node:fs';import{parseVol,readWad,fixups,analyseStrats}from'./js/vol-core.js';
const b=readFileSync('../10.vol'),ab=b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),f=parseVol(ab).find(x=>x.name==='10-00.LCS'),[A,B]=readWad(ab,f),im=fixups(B),d=new DataView(A.buffer),U=o=>d.getUint32(o,true),all=Object.entries(im).filter(([k])=>k!=='rel').flatMap(([k,v])=>v.map(x=>[x,+k]));
for(const r of analyseStrats(A,B,{}).modelRefs.filter(x=>x.native==='Strat_SetModelCollide').slice(0,10)){
 const tab=r.table, desc=U(tab), col=U(tab+4), kind=(all.find(([o])=>o===col)||[])[1], roots=[U(desc),U(desc+4)];
 console.log(r.cls,'table',tab.toString(16),'model',desc.toString(16),'col',col.toString(16),'imp',kind&&kind.toString(16),'colRel',im.rel.has(tab+4),'desc',Buffer.from(A.slice(desc,desc+0x30)).toString('hex'));
 if(col)console.log(' col words',Array.from({length:16},(_,i)=>U(col+4*i).toString(16)).join(' '),'rel',Array.from({length:16},(_,i)=>im.rel.has(col+4*i)?i*4:null).filter(x=>x!==null).map(x=>x.toString(16)).join(','));
}
