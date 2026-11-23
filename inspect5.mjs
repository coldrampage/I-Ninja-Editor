
import {readFileSync}from'node:fs';import{parseVol,readWad,fixups,analyseStrats}from'./js/vol-core.js';import{EC}from'./js/editor-core.js';
const b=readFileSync('../10.vol'),ab=b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),f=parseVol(ab).find(x=>x.name==='10-00.LCS'),[A,B]=readWad(ab,f),im=fixups(B),d=new DataView(A.buffer),U=o=>d.getUint32(o,true),M=EC.parseModels(A,B);
const descs=new Set(M.modelGroups.map(x=>x.descriptor));
for(const r of analyseStrats(A,B,{}).modelRefs||[]){if(!['Strat_SetModel','Strat_SetModelEx','Strat_SetModelCollide'].includes(r.native))continue;const de=U(r.table);if(descs.has(de)){const g=M.modelGroups.find(x=>x.descriptor===de);console.log(r.cls,r.native,'table',r.table.toString(16),'desc',de.toString(16),g.displayName,g.parts.length,'coll',r.native==='Strat_SetModelCollide'?U(r.table+4).toString(16):'');}}
