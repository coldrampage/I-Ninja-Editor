import fs from 'node:fs';import{parseVol,readWad}from'./js/vol-core.js';import{EC}from'./js/editor-core.js';
const b=fs.readFileSync('/mnt/data/work/current-spawn-fixes/10.vol'),v=b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),f=parseVol(v).find(x=>x.name==='10-32.LCS'),[A,B]=readWad(v,f),AL=EC.parseModels(A,B);console.log(JSON.stringify(AL.entrySpawnDetailsByClass?.DragonWolf,null,2));
