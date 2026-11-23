import fs from 'node:fs';import {parseVol,readWad,instances,siWad,SiAn} from './js/vol-core.js';import {EC} from './js/editor-core.js';
const b=fs.readFileSync('/mnt/data/work/current-spawn-fixes/10.vol'),vol=b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),files=parseVol(vol);
for(const lcs of ['10-01.LCS','10-05.LCS','10-30.LCS','10-31.LCS','10-32.LCS']){const f=files.find(x=>x.name===lcs);const[A,B]=readWad(vol,f),AL=EC.parseModels(A,B),sw=siWad(A,B);console.log('\n####',lcs);
for(const cn of ['GrindRailHelper','SneakSentinel','DragonWolf','DWExplode','DWBodyBit','DragonWolf_Head','Robot_SneakDoor','Robot_SneakDoor_Part']){
 const details=AL.entrySpawnDetailsByClass?.[cn];const refs=AL.entryModelRefs?.[cn];
 if(details?.length||refs?.length)console.log('entry',cn,JSON.stringify({refs,spawns:details,initial:AL.entryInitialSpawnsByClass?.[cn]},null,2));
 const gs=AL.modelGroups.filter(g=>(g.probableClasses||[]).includes(cn)||(g.classes||[]).includes(cn)||(g.classTableRefs||[]).some(r=>r.cls===cn));
 if(gs.length)console.log('groups',cn,gs.map(g=>({id:g.id,name:g.name,displayName:g.displayName,source:g.source,kind:g.kind,parts:g.parts?.length,classes:g.classes,probable:g.probableClasses,refs:g.refs,classRefs:g.classTableRefs?.filter(r=>r.cls===cn),handlerRefs:g.handlerRefs?.filter(r=>r.cls===cn)})));
 }
}
