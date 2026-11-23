import fs from 'node:fs';import {parseVol,readWad,siWad,SiAn,siDisasm,siRender,vs} from './js/vol-core.js';
const b=fs.readFileSync('/mnt/data/work/current-spawn-fixes/10.vol'),vol=b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),files=parseVol(vol);
for(const name of ['10-30.LCS','10-31.LCS','10-32.LCS','10-01.LCS','10-05.LCS']){const f=files.find(x=>x.name===name);const[A,B]=readWad(vol,f),sw=siWad(A,B),az=new SiAn(sw);console.log('\n########',name);
for(const cn of ['Robot_SneakDoor','Robot_SneakDoor_Part','GrindRailHelper','DragonWolf','DragonWolf_Head','DWBodyBit','SneakSentinel','forestLaser','SneakTeleport','TeleportFXController']){const c=sw.classes.find(c=>c.name===cn);if(!c)continue;
 let [seen,calls]=az.reach([c.entry]);const all=new Set(seen),pend=[...calls],done=new Set();while(pend.length){const s=pend.pop();if(done.has(s))continue;done.add(s);let[o,cl]=az.reach([s]);o.forEach(x=>all.add(x));cl.forEach(x=>pend.push(x))}
 const arr=[...all].sort((x,y)=>x-y);console.log('\n---',cn,'entry',c.entry.toString(16),'ninit',c.ninit,'ops',arr.length,'---');
 for(const off of arr){const i=az.ins.get(off);if(!i)continue;let mn=i.mn, native=(mn==='native'||mn==='native_y')?az.native(i)[0]:'';
 let line=`${off.toString(16)} ${mn} ${i.form} a=${i.a} b=${i.b} c=${i.c} ext=${(i.ext||[]).map(x=>'0x'+x.toString(16)).join(',')} tgt=${(i.targets||[]).map(x=>x.toString(16)).join(',')} ${native}`;
 if(native||['getvar','setvar','mov','fmov','call','jz','jnz','beq','bne','fbne','fbeq','ret','die','halt','switch','switch_sparse'].includes(mn)) console.log(line);
 }
 }
}
