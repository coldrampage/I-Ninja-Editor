
import {readFileSync}from'node:fs';import{parseVol,readWad,fixups,siWad,analyseStrats}from'./js/vol-core.js';import{EC}from'./js/editor-core.js';
const b=readFileSync('../10.vol'),ab=b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),fs=parseVol(ab);
for(const name of ['10-00.LCS','10-01.LCS','10-22.LCS']){
 const f=fs.find(x=>x.name===name),[A,B]=readWad(ab,f),im=fixups(B),d=new DataView(A.buffer),U=o=>d.getUint32(o,true);
 const refs=analyseStrats(A,B,{}).modelRefs||[],pick=refs.find(x=>x.native==='Strat_SetModel'||x.native==='Strat_SetModelEx');
 console.log('\n',name,'pick',pick);
 if(!pick)continue;
 const tab=U(pick.table),desc=U(tab),mods=EC.parseModels(A,B),g=mods.modelGroups.find(x=>x.descriptor===desc&&x.kind==='model'),modelParts=im[0x80000021].concat(im[0x80000022]);
 console.log('table',tab.toString(16),Array.from({length:4},(_,i)=>U(tab+4*i).toString(16)), 'desc',desc.toString(16),'group',g?.displayName,g?.parts.length);
 if(g)for(const ep of g.parts.slice(0,3)){const p=ep.p;console.log('part',p.toString(16),modelParts.includes(p)?'21':'22','mesh',U(p+12).toString(16),'mat',U(p+16).toString(16),'rCount',U(p+0x34),'range',U(p+0x38).toString(16),'owner',U(p+0x130).toString(16),'prev',im.rel.has(p+0x44)?U(p+0x44).toString(16):'none')}
}
