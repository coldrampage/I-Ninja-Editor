import fs from 'node:fs';
import {EC} from './js/editor-core.js';
import {parseVol,readWad,siWad} from './js/vol-core.js';
import {bytesToBase64} from './js/custom-models.js';
const raw=fs.readFileSync('/mnt/data/ininja_work/base10.vol');const ab=raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength);const ent=parseVol(ab).find(f=>f.name.toLowerCase()==='10-00.lcs');const [A0,B0]=readWad(ab,ent);const bundle=bytesToBase64(new Uint8Array(fs.readFileSync('./test-assets/Suzanne-Untitled.inimodel')));
const rec=(id,x)=>({assets:[{id,name:'Suzanne '+id,bundle,collisionType:'mesh'}],instances:[{id:id+'-inst',assetId:id,name:id,position:[x,5,325],rotation:[0,0,0],scale:[1,1,1]}]});
console.log('before',siWad(A0,B0).classes.some(c=>c.name==='INIGenericCollision'));
const b1=EC.patchCustomModels(A0,B0,ent.name,rec('one',100),()=>null,[]);console.log('build1',b1.added,siWad(b1.A,b1.B).classes.filter(c=>c.name.includes('GenericCollision')).map(c=>({name:c.name,off:c.off,ninit:c.ninit,events:c.events.length,entry:c.entry})));
try {const b2=EC.patchCustomModels(b1.A,b1.B,ent.name,rec('two',110),()=>null,[]);console.log('build2 ok',b2.added)}catch(e){console.error('BUILD2 ERROR',e?.stack||e);process.exitCode=1}
