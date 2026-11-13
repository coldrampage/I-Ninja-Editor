import assert from 'node:assert/strict';
import { EC } from '../js/editor-core.js';

// Synthetic AMPC -> GUID -> WAVE graph, plus an opaque 0x118 label resource.
const A = new Uint8Array(0x400), dv = new DataView(A.buffer);
const put4 = (o, s) => { for (let i=0;i<4;i++) A[o+i]=s.charCodeAt(i); };
const riff = (o, kind, chunks) => {
  put4(o, 'RIFF'); put4(o+8, kind); let p=o+12;
  for (const [id, body] of chunks) { put4(p,id); dv.setUint32(p+4,body.length,true); A.set(body,p+8); p+=8+body.length+(body.length&1); }
  dv.setUint32(o+4,p-o-8,true); return p-o;
};
const guid=Uint8Array.from({length:16},(_,i)=>0x30+i), amrf=new Uint8Array(24);
new DataView(amrf.buffer).setUint32(0,1,true); amrf.set(guid,4);
const ampcOff=0x20,waveOff=0x100,nameOff=0x180;
riff(ampcOff,'AMPC',[['amrf',amrf]]);
const strm=new Uint8Array(8),sd=new DataView(strm.buffer);sd.setUint32(0,24,true);sd.setUint32(4,16,true);
riff(waveOff,'WAVE',[['guid',guid],['strm',strm]]);
A.set(new TextEncoder().encode('sentinelscan\0'),nameOff);
const resources=new Map([[ampcOff,0x113],[waveOff,0x113],[nameOff,0x118]]),starts=[...resources.keys()].sort((a,b)=>a-b);
const S={A,B:new Uint8Array(),wadName:'10-30.LCS',res:resources,classes:new Map(),w:{rel:new Set()},imp:{},U:o=>dv.getUint32(o,true),next:o=>starts.find(x=>x>o)??A.length,str:o=>{let e=o;while(e<A.length&&A[e])e++;return e>o?new TextDecoder().decode(A.subarray(o,e)):null;}};
const bld={A:new Uint8Array(0x2000),rel:new Set(),newSpec:[],len:0,alloc(n,a=16){const p=Math.ceil(this.len/a)*a;this.len=p+n;return p;},W(o,v){new DataView(this.A.buffer).setUint32(o,v>>>0,true);},addRel(o){this.rel.add(o);},addRelTo(a,o){if(!this.rel.has(o)){this.rel.add(o);a.push(o);}},addSpec(kind,loc,rels){this.newSpec.push({kind:(0x80000000|kind)>>>0,loc,rels});}};
const audioAdds=[];
const map=EC.copyGraph(S,bld,[ampcOff,nameOff],{res:()=>null,cls:()=>null,snd:{add:r=>{audioAdds.push(r);return 0x500;}}},{addRes:true});
assert.ok(map.has(ampcOff));
assert.ok(map.has(waveOff),'AMPC amrf GUID resolves to matching WAVE bank');
assert.ok(map.has(nameOff),'opaque 0x118 label resource is copied');
assert.equal(audioAdds.length,1);
assert.equal(audioAdds[0].kind,'WAVE');
assert.equal(audioAdds[0].off,24);
assert.equal(audioAdds[0].len,16);
const copiedWave=map.get(waveOff),info=EC.bankInfo(bld.A,copiedWave);
assert.equal(new DataView(bld.A.buffer).getUint32(copiedWave+info.strmAt-copiedWave,true),0x500);
assert.ok(bld.newSpec.some(x=>(x.kind&0xffff)===0x118));
assert.ok(bld.newSpec.filter(x=>(x.kind&0xffff)===0x113).length>=2);

console.log('PASS AMPC references resolve to source WAVE/WAVS banks and are added to the PCA sound plan');
console.log('PASS AMPC metadata copies without requiring a strm chunk');
console.log('PASS opaque 0x118 audio-label resources are copied and registered');
