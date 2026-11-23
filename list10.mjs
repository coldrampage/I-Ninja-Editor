import fs from 'node:fs';
import {parseVol,readWad,siWad} from './js/vol-core.js';
const raw=fs.readFileSync('/mnt/data/ininja_work/base10.vol'); const ab=raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength);
const files=parseVol(ab); console.log('files',files.length); for(const f of files.filter(f=>/^10-00\.LCS$/i.test(f.name))){const [A,B]=readWad(ab,f); const w=siWad(A,B); console.log(f.name,f.size,A.length,B.length,'classes',w.classes.length); console.log(w.classes.filter(c=>/genericcollision/i.test(c.name)).map(c=>({name:c.name,off:c.off,entry:c.entry,ninit:c.ninit,events:c.events,ptrname:w.U(c.off+4),pool:w.U(c.off+0x20),code:w.U(c.off+0x0c)})));}
