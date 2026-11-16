
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseVol, readWad, instances, analyseStrats } from '../js/vol-core.js';
import { EC } from '../js/editor-core.js';
const bytes=fs.readFileSync(process.env.ININJA_TEST_VOL);
const ab=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
const file=parseVol(ab).find(f=>f.name==='40-01.LCS');assert(file);
const [A,B]=readWad(ab,file), ents=instances(A,B);
const gen=ents.find(e=>e?.n==='EnemyGenerator');assert(gen);
assert.equal(gen.params.length,27,'EnemyGenerator exposes its complete 27-register layout');
assert.equal(gen.params[0].v,0);
const targetA=ents.find(e=>e?.n==='Ranx');assert(targetA);
const targetB=ents.find(e=>e?.n==='Ranx'&&e.i!==targetA.i);assert(targetB);
const ops={mods:{[gen.i]:{regs:{7:targetA.i,8:targetB.i},linkRegs:[7,8]}},adds:[],del:[]};
const built=EC.patchLcs(A,B,ops,'40-01.LCS',()=>null,null);
const cls={};const analysed=analyseStrats(built.A,built.B,cls);
const info=analysed.find(x=>x && x.k && cls[x.k]?.name==='EnemyGenerator');
assert(info,'EnemyGenerator survives LCS rebuild');
const links=info.l;
assert(links.some(x=>x[0]===7&&x[1]===targetA.i),'new R7 link table entry survives rebuild');
assert(links.some(x=>x[0]===8&&x[1]===targetB.i),'new R8 link table entry survives rebuild');
const after=instances(built.A,built.B).find(e=>e?.n==='EnemyGenerator');
assert.equal(after.params[0].v,0,'wave size register remains unchanged');
assert.equal(after.params[7].v,targetA.i);
assert.equal(after.params[8].v,targetB.i);

const addOps={adds:[{id:9001,from:{w:'40-01.LCS',i:gen.i},p:gen.p.slice(),dy:0,dp:0,dr:0,regs:{7:targetA.i},linkRegs:[7]}],mods:{},del:[]};
const addBuilt=EC.patchLcs(A,B,addOps,'40-01.LCS',()=>null,null);
const addEntities=instances(addBuilt.A,addBuilt.B), addedGens=addEntities.map((e,i)=>({e,i})).filter(x=>x.e?.n==='EnemyGenerator');
assert.equal(addedGens.length, (ents.filter(e=>e?.n==='EnemyGenerator').length)+1, 'copied generator is present');
const newGen=addedGens[addedGens.length-1], addAnalysis=analyseStrats(addBuilt.A,addBuilt.B,{});
const newLinks=addAnalysis[newGen.i].l;
assert(newLinks.some(x=>x[0]===7&&x[1]===targetA.i),'copy/paste preserves a manually added direct enemy link');

const remapOps={mods:{[gen.i]:{regs:{7:targetA.i},linkRegs:[7]}},adds:[],del:[0]};
const remapBuilt=EC.patchLcs(A,B,remapOps,'40-01.LCS',()=>null,null);
const remapAnalysis=analyseStrats(remapBuilt.A,remapBuilt.B,{});
const remapGenIndex=gen.i-1,remapTargetIndex=targetA.i-1,remapInfo=remapAnalysis[remapGenIndex];
assert(remapInfo.l.some(x=>x[0]===7&&x[1]===remapTargetIndex),'new enemy link target is remapped when earlier instances are deleted');
const remapEntity=instances(remapBuilt.A,remapBuilt.B)[remapGenIndex];
assert.equal(remapEntity.params[7].v,remapTargetIndex);
console.log('PASS EnemyGenerator R1–R20 optional enemy slots serialize as LCS links; R0 remains the wave-size field');
console.log('PASS copied EnemyGenerator keeps manually added links when pasted in the same level');

