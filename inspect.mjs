
import { readFileSync } from 'node:fs';
import { parseVol, readWad, fixups } from './js/vol-core.js';
import { EC } from './js/editor-core.js';
const buf=readFileSync('../10.vol');
const ab=buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength);
const fs=parseVol(ab);
for(const name of ['10-00.LCS','10-01.LCS','10-22.LCS']){
 const f=fs.find(x=>x.name.toUpperCase()===name);
 if(!f){console.log(name,'missing');continue}
 const [A,B]=readWad(ab,f);
 const imp=fixups(B), U=o=>new DataView(A.buffer,A.byteOffset,A.length).getUint32(o,true);
 const parts=[...(imp[0x80000021]||[]),...(imp[0x80000022]||[])];
 const meshes=imp[0x80000024]||[];
 const mats=(imp[0x80000006]||[]).length+(imp[0x80000007]||[]).length;
 const models=EC.parseModels(A,B);
 console.log('\n',name,'A',A.length,'B',B.length,'parts',parts.length,'mesh',meshes.length,'material',mats,'models',models.length);
 for(const g of models.modelGroups.filter(x=>x.source==='script'&&x.kind==='model').slice(0,3)) console.log('group',g.displayName,g.descriptor,g.roots,g.parts.length);
 for(const p of parts.slice(0,3)){
  console.log('part',p.toString(16),'import',imp[0x80000021]?.includes(p)?'21':'22','first 0x60',Buffer.from(A.slice(p,p+0x60)).toString('hex'));
 }
 for(const m of meshes.slice(0,2)){
  console.log('mesh',m.toString(16),'sizefields',Array.from({length:12},(_,i)=>U(m+4*i).toString(16)).join(' '));
 }
 const g=models.modelGroups.find(x=>x.source==='script'&&x.kind==='model');
 if(g){
  console.log('descriptor',g.descriptor.toString(16),'desc bytes',Buffer.from(A.slice(g.descriptor,g.descriptor+0x40)).toString('hex'));
 }
}
