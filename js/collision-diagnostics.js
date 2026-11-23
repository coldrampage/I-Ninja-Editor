// Local, no-upload collision diagnostics for custom-model builds.
// All inputs are the LCS byte arrays already held by the editor; this module
// never writes back to the game archives.
import {siWad, SiAn, fixups, siClass} from './vol-core.js?v=step110-rotation-boundary-fix';

const hx = n => Number.isInteger(n) ? '0x' + (n >>> 0).toString(16).padStart(8, '0') : null;
const short = n => Number.isInteger(n) ? '0x' + (n >>> 0).toString(16) : null;
const jsonSafe = v => JSON.parse(JSON.stringify(v, (k, x) => {
  if (x instanceof Set) return [...x];
  if (x instanceof Map) return [...x.entries()];
  if (ArrayBuffer.isView(x)) return Array.from(x);
  return x;
}));

function typeCounts(imp) {
  return Object.keys(imp || {}).filter(k => k !== 'rel' && /^\d+$/.test(k)).map(k => ({
    kind: '0x' + ((Number(k) & 0xffff) >>> 0).toString(16).padStart(3, '0'),
    count: Array.isArray(imp[k]) ? imp[k].length : 0,
    offsets: Array.isArray(imp[k]) ? imp[k].slice(-16).map(short) : []
  })).sort((a,b) => parseInt(a.kind,16)-parseInt(b.kind,16));
}
function deltaTypes(before, after) {
  const out=[];
  const keys=new Set([...Object.keys(before||{}),...Object.keys(after||{})].filter(k=>k!=='rel'&&/^\d+$/.test(k)));
  for(const k of [...keys].sort((a,b)=>Number(a)-Number(b))){
    const a=Array.isArray(before?.[k])?before[k]:[], b=Array.isArray(after?.[k])?after[k]:[];
    const aset=new Set(a), added=b.filter(x=>!aset.has(x));
    if(added.length)out.push({kind:'0x'+((Number(k)&0xffff)>>>0).toString(16).padStart(3,'0'),count:added.length,offsets:added.map(short)});
  }
  return out;
}
function decodeRoot(az, A, root, label) {
  const [offsets, calls] = az.reach([root]);
  const dv = new DataView(A.buffer, A.byteOffset, A.byteLength);
  return {
    label, root: short(root), calls: [...calls].map(short),
    instructions: offsets.slice(0,160).map(off => {
      const i=az.ins.get(off); if(!i)return {off:short(off),missing:true};
      const raw=[];for(let q=0;q<(i.size||1);q++)if(off+q*4+4<=A.length)raw.push(hx(dv.getUint32(off+q*4,true)));
      const native=(i.mn==='native'||i.mn==='native_y')?az.native(i):null;
      return {off:short(off),mn:i.mn,form:i.form,size:i.size,raw,native:native?native[0]:null,
        nativeInputs:native?native[1]:undefined,nativeOutputs:native?native[2]:undefined,
        a:i.a,b:i.b,c:i.c,targets:(i.targets||[]).map(short)};
    }), truncated: offsets.length>160
  };
}
function instanceRaw(A, inst) {
  const d=new DataView(A.buffer,A.byteOffset,A.byteLength), words=[];
  for(let o=0;o<0x38;o+=4) if(inst.off+o+4<=A.length) words.push(hx(d.getUint32(inst.off+o,true)));
  return {off:short(inst.off),init:short(inst.init),classIndex:inst.cls,words};
}
function collSummary(EC,A,B,off) {
  if(!Number.isInteger(off))return {valid:false,error:'no CollMesh offset'};
  const c=EC.parseCollisionMesh(A,B,off);
  if(!c?.valid)return {valid:false,error:c?.error||'CollMesh parse failed',offset:short(off)};
  return {
    valid:true,offset:short(off),headerWords:c.headerWords.map(hx),
    nodePtr:short(c.nodePtr),nodeCount:c.nodeCount,headerWord28:c.headerWord28,
    vertexPtr:short(c.vertexPtr),vertexCount:c.vertexCount,validRecords:c.validRecords,
    centre:c.centre,radius:c.radius,radiusSq:c.radiusSq,bounds:c.bounds,
    kdBounds:c.kdBounds,kdValid:c.kdTree?.valid,kdWarnings:c.kdTree?.warnings||[],
    leafRanges:c.kdTree?.leafRanges,leafStreams:c.kdTree?.leafStreams,
    materialCounts:c.materialCounts,triangleCount:c.triangleCount,
    relocations:c.relocations,nodes:c.nodes.map(n=>({index:n.index,word0:n.hex0,word1:n.hex1,
      type:n.type||null,axis:n.axisName||null,split:n.split??null,childA:n.childA??null,childB:n.childB??null,
      firstRecord:n.firstRecord??null,recordCount:n.recordCount??null}))
  };
}

export function collisionWadSnapshot(EC, A, B, wadName, projectRecord, phase='output', beforeB=null) {
  const report={phase,wadName,createdUtc:new Date().toISOString(),dataLength:A?.length||0,fixupLength:B?.length||0,
    dataFnv:EC.fnv(A||new Uint8Array()),fixupFnv:EC.fnv(B||new Uint8Array())};
  try {
    const w=siWad(A,B); if(!w)throw'not a valid PC STRAT WAD';
    const imp=fixups(B),dv=new DataView(A.buffer,A.byteOffset,A.byteLength),U=o=>o>=0&&o+4<=A.length?dv.getUint32(o,true):null;
    report.wad={classCount:w.classes.length,instanceCount:w.instances.length,relocationWordCount:imp.rel?.size||0,
      resourceTypes:typeCounts(imp),newResourceTypes:beforeB?deltaTypes(fixups(beforeB),imp):[]};
    const insts=Array.isArray(projectRecord?.instances)?projectRecord.instances:[];
    const assets=new Map((projectRecord?.assets||[]).map(a=>[a.id,a]));
    const classes=[];
    const customInstances=insts.map((inst,index)=>{
      const a=assets.get(inst.assetId)||{}, bundle=typeof a.bundle==='string'?a.bundle:'';
      let bytes=new Uint8Array();try{const bin=atob(bundle);bytes=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i)}catch{}
      const alias=('INIStatic_'+index.toString(36)+'_'+EC.fnv(bytes).slice(0,6)).slice(0,31);
      const collisionType=String(inst.collisionType??a.collisionType??a.requestedCollisionType??'none').toLowerCase();
      const topTagMode=String(inst.collisionTopTag??a.collisionUpwardTagMode??a.collisionTopTag??'inherit');
      const sideTagMode=String(inst.collisionSideTag??a.collisionSideTag??'slidey');
      return {index,instanceName:inst.name||a.name||'Custom model',assetName:a.name||null,assetId:inst.assetId||null,
        alias,collisionType,topTagMode,sideTagMode,position:inst.position||[0,0,0],rotation:inst.rotation||[0,0,0],scale:inst.scale||[1,1,1]};
    });
    report.customInstances=customInstances;
    const aliases=new Set(customInstances.map(x=>x.alias));
    const modelData=customInstances.length?EC.parseModels(A,B):null, groups=(modelData?.modelGroups||[]).filter(g=>(g.classes||[]).some(n=>aliases.has(n)));
    report.modelGroups=groups.map(g=>({id:g.id,name:g.name,kind:g.kind,source:g.source,descriptor:short(g.descriptor),
      classes:g.classes,entryClasses:g.entryClasses,handlerClasses:g.handlerClasses,parts:(g.parts||[]).map(p=>({part:short(p.p),mesh:short(p.m)})),natives:g.natives}));
    const az=new SiAn(w);
    for(const item of customInstances){
      const ci=w.classes.findIndex(c=>c.name===item.alias), c=ci>=0?w.classes[ci]:null;
      if(!c){classes.push({...item,found:false});continue;}
      const owned=c.events.map(([key,p],i)=>[i,key,p]).filter(x=>x[2]);
      const detail=siClass(az,c,owned);
      const refs=az.modelRefs.filter(r=>r.cls===c.name).map(r=>{
        const row={native:r.native,scope:r.scope,call:short(r.call),arg:r.arg,argRegister:r.argRegister,
          table:r.table==null?null:short(r.table),register:r.register,conditions:r.conditions||[]};
        if(Number.isInteger(r.table)){
          row.tableWords=[U(r.table),U(r.table+4)].map(v=>v==null?null:hx(v));
          row.tableRelocations=[imp.rel.has(r.table),imp.rel.has(r.table+4)];
          const coll=U(r.table+4);row.collMesh=Number.isInteger(coll)?collSummary(EC,A,B,coll):{valid:false,error:'table +4 was not readable'};
        }
        return row;
      });
      const classInstances=w.instances.map((inst,i)=>inst.cls===ci?{index:i,...instanceRaw(A,inst)}:null).filter(Boolean);
      classes.push({...item,found:true,classIndex:ci,classOffset:short(c.off),entry:short(c.entry),ninit:c.ninit,
        events:c.events.map(([key,p],i)=>({index:i,key:hx(key),handler:short(p),active:!!p})),
        instances:classInstances,modelRefs:refs,
        handlers:(detail.handlers||[]).map(h=>({id:h.id,on:h.on,levels:h.t})),
        entryDisassembly:decodeRoot(az,A,c.entry,'entry'),
        eventDisassembly:owned.map(([i,key,p])=>decodeRoot(az,A,p,'event '+i+' key '+hx(key)))
      });
    }
    report.customClasses=classes;
    report.summary={customInstances:customInstances.length,boxInstances:customInstances.filter(x=>x.collisionType==='box').length,
      foundClasses:classes.filter(x=>x.found).length,collisionCalls:classes.reduce((n,c)=>n+(c.modelRefs||[]).filter(r=>r.native==='Strat_SetModelCollide').length,0),
      missingClasses:classes.filter(x=>!x.found).map(x=>x.alias)};
  } catch(e) { report.error=String(e?.stack||e); }
  return jsonSafe(report);
}
