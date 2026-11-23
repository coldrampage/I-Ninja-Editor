import fs from 'node:fs';import {parseVol,readWad,instances} from './js/vol-core.js';import {EC} from './js/editor-core.js';import {resolveEntryModelSelection} from './js/entry-models.js';
const b=fs.readFileSync('/mnt/data/work/current-spawn-fixes/10.vol'),vol=b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),files=parseVol(vol);
for(const name of ['10-30.LCS','10-31.LCS','10-32.LCS','10-05.LCS','10-01.LCS']){const f=files.find(x=>x.name===name);if(!f)continue;const[A,B]=readWad(vol,f),rows=instances(A,B),AL=EC.parseModels(A,B);console.log('\n###',name);
for(const q of rows.filter(q=>q&&(/Robot_SneakDoor|GrindRailHelper|DragonWolf|SneakSentinel/i.test(q.n)))){const r=resolveEntryModelSelection(AL,q,A);console.log({i:q.i,n:q.n,p:q.p,q:q.q,params:q.params?.map(x=>x?.v),group:r.group?.name,desc:r.group?.descriptor,reason:r.reason,off:r.groupOffset,more:r.spawnedModels?.map(x=>({cls:x.cls,group:x.group?.name,offset:x.offset,owner:x.owner}))});}
}
