
import { readFileSync } from 'node:fs';import {parseVol,readWad,fixups} from './js/vol-core.js';
const b=readFileSync('../10.vol'),ab=b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),f=parseVol(ab).find(x=>x.name==='10-00.LCS'),[A,B]=readWad(ab,f),im=fixups(B),d=new DataView(A.buffer),U=o=>d.getUint32(o,true),p=im[0x80000021][0],a=U(p+0x38);
console.log({p:p.toString(16),a:a.toString(16),count:U(p+0x34),owner:U(p+0x130).toString(16)});
for(let o=0;o<0x50;o+=4) console.log(o.toString(16),U(a+o).toString(16),im.rel.has(a+o)?'*':'');
const m=U(p+12);console.log('mesh',m.toString(16));for(let o=0;o<0x30;o+=4)console.log('m+'+o.toString(16),U(m+o).toString(16),im.rel.has(m+o)?'*':'');
const mat=U(p+16);console.log('mat',mat.toString(16));for(let o=0;o<0x40;o+=4)console.log('mat+'+o.toString(16),U(mat+o).toString(16),im.rel.has(mat+o)?'*':'');
