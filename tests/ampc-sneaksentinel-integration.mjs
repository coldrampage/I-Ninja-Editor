import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseVol, readWad, siWad, fixups } from '../js/vol-core.js';
import { EC } from '../js/editor-core.js';

// Optional real-game integration. Set ININJA_TEST_VOL and (optionally)
// ININJA_TEST_AVL to the matching PC game archives.
const volPath=process.env.ININJA_TEST_VOL;
if(!volPath||!fs.existsSync(volPath)){
  console.log('SKIP real SneakSentinel AMPC copy (set ININJA_TEST_VOL to 10.vol)');
  process.exit(0);
}
const avlPath=process.env.ININJA_TEST_AVL||volPath.replace(/\.vol$/i,'.avl');
if(!fs.existsSync(avlPath)){
  console.log('SKIP real SneakSentinel AMPC copy (matching .avl not found)');
  process.exit(0);
}
const readBuf=p=>{const b=fs.readFileSync(p);return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);};
const vol=readBuf(volPath),avl=readBuf(avlPath),volFiles=parseVol(vol),avlFiles=parseVol(avl);
const getWad=name=>{const f=volFiles.find(x=>x.name===name);assert.ok(f,`missing ${name}`);const[A,B]=readWad(vol,f);return{f,A,B};};
const getPca=name=>{const p=name.replace(/\.LCS$/i,'.PCA'),f=avlFiles.find(x=>x.name===p);assert.ok(f,`missing ${p}`);return new Uint8Array(avl,f.off,f.size);};
const header=name=>{const f=volFiles.find(x=>x.name===name);assert.ok(f);const d=new DataView(vol,f.off);return{h78:d.getUint32(0x78,true),h7c:d.getUint32(0x7c,true)};};
const source=getWad('10-30.LCS'),target=getWad('10-00.LCS');
const targetHeader=header('10-00.LCS'),plan=EC.SoundPlan(targetHeader.h78,targetHeader.h7c);
const copied=EC.patchLcs(target.A,target.B,{
  classes:[{from:{w:'10-30.LCS',name:'SneakSentinel'},variants:[]}],
  mods:{},adds:[],del:[]
},'10-00.LCS',name=>name==='10-30.LCS'?source:null,{snd:plan});
assert.ok(siWad(copied.A,copied.B).classes.some(c=>c.name==='SneakSentinel'));
assert.ok(plan.adds.length>0,'AMPC GUID dependencies add audio streams to the destination PCA');
const newImp=fixups(copied.B),newBankOffsets=(newImp[0x80000113]||[]).filter(o=>o>=target.A.length);
const d=new DataView(copied.A.buffer,copied.A.byteOffset,copied.A.byteLength);
const tag=o=>String.fromCharCode(...copied.A.subarray(o+8,o+12));
const chunks=(o)=>{
  const r=EC.riffChunks(copied.A,o);return r&&r.chunks;
};
const newAmpcs=newBankOffsets.filter(o=>tag(o)==='AMPC');
const newWaveBanks=newBankOffsets.filter(o=>tag(o)==='WAVE'||tag(o)==='WAVS');
assert.ok(newAmpcs.length>0,'at least one AMPC descriptor was imported');
assert.ok(newWaveBanks.length>0,'the GUID-linked audio bank descriptors were imported');
const guidToBank=new Map();
for(const o of newWaveBanks){const g=chunks(o)?.guid?.[0];if(g&&g.n===16)guidToBank.set(Buffer.from(copied.A.subarray(g.at,g.at+16)).toString('hex'),o);}
for(const o of newAmpcs){
  const refs=chunks(o)?.amrf?.[0];assert.ok(refs,'copied AMPC retains its amrf GUID table');
  const count=d.getUint32(refs.at,true);
  for(let i=0;i<count;i++){
    const key=Buffer.from(copied.A.subarray(refs.at+4+i*20,refs.at+20+i*20)).toString('hex');
    assert.ok(guidToBank.has(key),`AMPC reference ${key} resolves to an imported WAVE/WAVS bank`);
  }
}
const newPca=EC.buildPca(getPca('10-00.LCS'),plan,w=>({pca:getPca(w),h78:header(w).h78}));
for(const a of plan.adds){
  const sourcePca=getPca(a.w),sourceH78=header(a.w).h78;
  const from=a.kind==='WAVE'?a.off:Math.ceil(sourceH78/0x800)*0x800+a.off;
  const to=a.kind==='WAVE'?a.newOff:Math.ceil(plan.h78/0x800)*0x800+a.newOff;
  assert.deepEqual(newPca.subarray(to,to+a.len),sourcePca.subarray(from,from+a.len),`${a.kind} bytes copied to new PCA offset`);
}
for(const o of newWaveBanks){const b=EC.bankInfo(copied.A,o);assert.ok(b.strmAt!=null);}
assert.ok((newImp[0x80000118]||[]).some(o=>o>=target.A.length), 'SneakSentinel audio event label (0x118) is copied');
const parsed=siWad(copied.A,copied.B);
assert.ok(parsed.classes.some(c=>c.name==='SneakSentinel'));
for(const r of fixups(copied.B).rel){assert.ok(r+4<=copied.A.length);assert.ok(d.getUint32(r,true)<=copied.A.length);}
console.log(`PASS real 10-30 SneakSentinel imports into 10-00 with ${newAmpcs.length} AMPC descriptor(s), ${newWaveBanks.length} WAVE/WAVS bank(s), and ${plan.adds.length} PCA stream(s)`);
