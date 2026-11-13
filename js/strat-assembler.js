
// ---- strat assembler + relinker (port of ininja_asm.py / ininja_relink.py). Pure, no DOM.
// Needs from the viewer core: SI_OPS, SI_CAT, fixups, siCstr (cstr).
const IA=(()=>{
const M32=0xFFFFFFFF;
class AsmErr extends Error{}
const OPS=new Map();for(const k in SI_OPS){const t=SI_OPS[k];OPS.set(+k,{mn:t[0],form:t[1],size:t[2]})}
const BYMN=(()=>{const by={};for(const[op,t]of[...OPS].sort((a,b)=>a[0]-b[0])){let mn=t.mn;if(t.form==='nat_a')mn={native:'native_a',native_y:'native_ya'}[mn];(by[mn]=by[mn]||[]).push({op,form:t.form,size:t.size})}return by})();
const SCOPES={1:'self.prop',2:'parent.prop',3:'glob1.prop',5:'handle.prop',6:'static',7:'global',8:'parent.r',9:'const',10:'glob2.prop',12:'r',13:'rel.prop',14:'other.prop',15:'handle2.prop'};
const SCOPE_BY_NAME={};for(const k in SCOPES)SCOPE_BY_NAME[SCOPES[k]]=+k;
// native names from the viewer's catalog: only names that are unique and not the nat<t>_<i> placeholders
const NAT=(()=>{const by={},cnt={};for(const k in SI_CAT){const nm=SI_CAT[k][0];if(/^[A-Za-z_]\w*$/.test(nm)&&!/^nat\d+_/.test(nm)){by[k]=nm;cnt[nm]=(cnt[nm]||0)+1}}
 const key={},name={};for(const k in by)if(cnt[by[k]]===1){key[k]=by[k];name[by[k]]=k.split(':').map(Number)}return{key,name}})();
const s8=v=>v&0x80?v-256:v,s32=v=>v|0,hex=(v,n)=>(v>>>0).toString(16).padStart(n||1,'0');
const _dv=new DataView(new ArrayBuffer(4));
const f2b=f=>{_dv.setFloat32(0,f,true);return _dv.getUint32(0,true)},b2f=b=>{_dv.setUint32(0,b>>>0,true);return _dv.getFloat32(0,true)};
const isFloatMn=mn=>(mn[0]==='f'&&mn!=='fbnor'&&mn!=='fbnand')||mn==='fcall2'||mn==='rfcall2';
const fnum=f=>{let t=String(f);if(!/[.eE]/.test(t))t+='.0';return t};
const fmtF8=c=>fnum(c*0.125);
const fmtInt=v=>{const s=v|0;return(-4096<s&&s<65536)?String(s):'0x'+hex(v,8)};
const fmtF32=v=>{const f=b2f(v);if(Number.isFinite(f)){const t=fnum(f);if(f2b(parseFloat(t))===(v>>>0))return t}return'0x'+hex(v,8)};
const pint=t=>{t=String(t).trim();let m=/^(-?)0x([0-9a-fA-F]+)$/.exec(t);if(m)return(m[1]?-1:1)*parseInt(m[2],16);if(/^-?\d+$/.test(t))return parseInt(t,10);throw new AsmErr('bad integer '+t)};
const strictFloat=t=>{t=t.trim();if(/^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t))return parseFloat(t);if(/^-?inf$/i.test(t))return t[0]==='-'?-Infinity:Infinity;if(/^-?nan$/i.test(t))return NaN;throw new AsmErr('bad float '+t)};
const parseNum=tok=>{const t=tok.trim();if(t.startsWith('&A['))return pint(t.slice(3,t.indexOf(']')))>>>0;
 if(/^-?0x[0-9a-fA-F]+$/.test(t)||/^-?\d+$/.test(t))return pint(t)>>>0;return f2b(strictFloat(t))};
const parseF8=t=>{const v=strictFloat(t)*8,c=Math.round(v);if(c!==v||c<0||c>255)throw new AsmErr('imm8 float out of range: '+t);return c};
const parseS8=t=>{const v=pint(t);if(v<-128||v>255)throw new AsmErr('imm8 out of range: '+t);return v&0xFF};
const rn=t=>{t=t.trim();if(!/^r\d+$/.test(t))throw new AsmErr('register expected, got '+t);const n=+t.slice(1);if(n>255)throw new AsmErr('register out of range '+t);return n};
const label=t=>'L_'+t.toString(16);
const rel_target=(wo,v)=>wo+4+Math.trunc((v|0)/4)*4;

// ------------------------------------------------------------ decode
function decodeBlock(A,p,n,rel){const dv=new DataView(A.buffer,A.byteOffset,A.length),U=o=>dv.getUint32(o,true),ins=[],errs=[];let q=p+8;const end=p+4*n-8;
 while(q<end){const w=U(q),op=w>>>24,t=OPS.get(op);if(!t){errs.push('unknown opcode 0x'+hex(op,2)+' at 0x'+hex(q));break}
  const i={off:q,op,a:(w>>>16)&255,b:(w>>>8)&255,c:w&255,mn:t.mn,form:t.form,size:t.size,ext:null,rel:new Set(),tg:null};
  if(i.form==='sws')i.size=4+2*i.b;else if(i.form==='swd'){const lo=s32(U(q+4)),hi=s32(U(q+8));i.size=(hi-lo>=0&&hi-lo<4096)?4+Math.max(0,hi-lo+1):4}
  if(q+4*i.size>end||q+4*i.size>A.length){errs.push('instruction at 0x'+hex(q)+' overruns block');break}
  i.ext=[];for(let k=1;k<i.size;k++){i.ext.push(U(q+4*k));if(rel.has(q+4*k))i.rel.add(k)}
  i.tg=targets(i);ins.push(i);q+=4*i.size}
 return{ins,errs}}
function targets(i){const f=i.form,off=i.off,x=i.ext;
 if(f==='j16')return[off+4+4*((((i.b<<8)|i.c)<<16)>>16)];
 if(f.startsWith('br_'))return[rel_target(off+4*(i.size-1),x[i.size-2])];
 if(f==='call')return[rel_target(off+4,x[0])];
 if(f==='sws'){const t=[rel_target(off+12,x[2])];for(let k=0;k<i.b;k++){const p=off+16+8*k;t.push(rel_target(p+4,x[(p+4-off)/4-1]))}return t}
 if(f==='swd'){const t=[rel_target(off+12,x[2])];for(let k=0;k<i.size-4;k++){const p=off+16+4*k;t.push(rel_target(p,x[(p-off)/4-1]))}return t}
 return null}

// ------------------------------------------------------------ text -> words
const RELIDX=new Set();
function addext(ext,tok){ext.push(parseNum(tok));if(tok.trim().startsWith('&A['))RELIDX.add(ext.length)}
const isreg=t=>/^r\d+$/.test(t),isnum=t=>/^(-?(0x[0-9a-fA-F]+|\d+)|&A\[0x[0-9a-fA-F]+\])$/.test(t),isflt=t=>/^-?(\d+\.\d*(e[+-]?\d+)?|\d+e[+-]?\d+|inf|nan)$/.test(t);
function ok8(f,t){try{f(t);return true}catch(e){return false}}
function shape(form,mn,ops){const fl=isFloatMn(mn),n=ops.length;
 if(form==='rrr')return n===3&&ops.every(isreg);
 if(form==='rri8'||form==='rrf8'){if(mn==='rshl'||mn==='rshr')return n===3&&isreg(ops[0])&&isnum(ops[1])&&isreg(ops[2]);
  if(!(n===3&&isreg(ops[0])&&isreg(ops[1])&&(isflt(ops[2])||isnum(ops[2]))))return false;return ok8((fl||form==='rrf8')?parseF8:parseS8,ops[2])}
 if(form==='rri32'||form==='rri32f')return n===3&&isreg(ops[0])&&isreg(ops[1])&&(isnum(ops[2])||isflt(ops[2]));
 if(form==='rr')return n===2&&isreg(ops[0])&&isreg(ops[1]);
 if(form==='ri8')return n===2&&isreg(ops[0])&&isnum(ops[1])&&!ops[1].startsWith('&')&&ok8(parseS8,ops[1]);
 if(form==='rf8')return n===2&&isreg(ops[0])&&isflt(ops[1])&&ok8(parseF8,ops[1]);
 if(form==='ri32')return n===2&&isreg(ops[0])&&(isnum(ops[1])||isflt(ops[1]));
 return true}
function splitOps(s){const out=[];let depth=0,cur='';for(const ch of s){if(ch==='[')depth++;else if(ch===']')depth--;if(ch===','&&depth===0){out.push(cur.trim());cur=''}else cur+=ch}if(cur.trim())out.push(cur.trim());return out}
function parseLine(s){s=s.split(';')[0].trim();const m=/^(\S+)\s*([\s\S]*)$/.exec(s);if(!m)throw new AsmErr('empty line');const ln={mn:m[1],ops:[],notes:{},src:s,rel:new Set()};let rest=m[2];
 for(const mm of rest.matchAll(/\{(\w+)=(\w+)\}/g))ln.notes[mm[1]]=mm[1]==='f'?mm[2]:pint(mm[2]);
 rest=rest.replace(/\{(\w+)=(\w+)\}/g,'');ln.ops=splitOps(rest);return ln}
const lbl=(labels,tok)=>{tok=tok.trim();const v=labels(tok);if(v===undefined)throw new AsmErr('undefined label '+tok);return v};
function assembleInsn(ln,labels,off){const cands=BYMN[ln.mn];if(!cands)throw new AsmErr('unknown mnemonic '+ln.mn);let last=null;
 for(const{op,form,size}of cands){if('f'in ln.notes&&form!==ln.notes.f)continue;let ws;try{ws=encode(op,form,size,ln.mn,ln.ops,labels,off,ln.notes)}catch(e){last=e;continue}
  if(ws!==null){ln.rel=new Set(RELIDX);return ws}}
 throw new AsmErr('cannot encode "'+ln.src+'": '+(last?last.message:'operands do not fit'))}
function encode(op,form,size,mn,ops,labels,off,notes){if(!shape(form,mn,ops))return null;const fl=isFloatMn(mn);let A=0,B=0,C=0,ext=[];RELIDX.clear();const n=ops.length;
 const need=k=>{if(n!==k)throw new AsmErr('operand count')};let tgt;
 if(form==='rrr'){A=rn(ops[0]);B=rn(ops[1]);C=rn(ops[2])}
 else if(form==='rri8'||form==='rrf8'){if(mn==='rshl'||mn==='rshr'){A=rn(ops[0]);C=parseS8(ops[1]);B=rn(ops[2])}else{A=rn(ops[0]);B=rn(ops[1]);C=(fl||form==='rrf8')?parseF8(ops[2]):parseS8(ops[2])}}
 else if(form==='rri32'||form==='rri32f'){A=rn(ops[0]);B=rn(ops[1]);addext(ext,ops[2])}
 else if(form==='rr'){A=rn(ops[0]);C=rn(ops[1])}
 else if(form==='ri8'){A=rn(ops[0]);C=parseS8(ops[1])}
 else if(form==='rf8'){A=rn(ops[0]);C=parseF8(ops[1])}
 else if(form==='ri32'){A=rn(ops[0]);addext(ext,ops[1])}
 else if(form==='idx'){need(2);A=pint(ops[0]);C=pint(ops[1])}
 else if(form.startsWith('as_')){need(3);const k=form.slice(3);let ki,kv;if(k[0]==='r'){ki='r';kv=k.slice(1)}else if(k.startsWith('i8')){ki='i8';kv=k.slice(2)}else{ki='i32';kv=k.slice(3)}
  B=rn(ops[0]);if(ki==='r')C=rn(ops[1]);else if(ki==='i8')C=parseS8(ops[1]);else addext(ext,ops[1]);
  if(kv==='r')A=rn(ops[2]);else if(kv==='i8')A=parseS8(ops[2]);else if(kv==='f8')A=parseF8(ops[2]);else addext(ext,ops[2])}
 else if(['gv_r','sv_r_r','sv_r_i8','sv_r_f8','sv_r_i32'].includes(form)){A=pint(ops[0]);B=pint(ops[1]);C=pint(ops[2]);ext=ops.slice(3).map(t=>pint(t)>>>0);if(ext.length!==size-1)throw new AsmErr('ext count')}
 else if(form.startsWith('gv_')||form.startsWith('sv_')){const k=form.slice(3).split('_');let ref,val;
  if(form.startsWith('gv_')){need(2);A=rn(ops[0]);ref=mn==='lea'?ops[1].replace(/^&+/,''):ops[1];if((mn==='lea')!==ops[1].startsWith('&'))return null}else{need(2);ref=ops[0];val=ops[1]}
  const m=/^([\w.]+)\[(.+?)\]$/.exec(ref);if(!m)return null;const scn=m[1],ix=m[2];let sc=SCOPE_BY_NAME[scn];
  if(sc===undefined){if(!scn.startsWith('scope'))return null;sc=parseInt(scn.slice(5),16)}
  if(k[0]==='i12'){const v=pint(ix);if(v<0||v>=4096)return null;B=(sc<<4)|(v>>8);C=v&0xFF}else{addext(ext,ix);B=sc<<4}
  if(form.startsWith('sv_')){const vk=k[1];if(vk==='r')A=rn(val);else if(vk==='i8')A=parseS8(val);else if(vk==='f8')A=parseF8(val);else addext(ext,val)}}
 else if(form.startsWith('al_')){need(2);A=rn(ops[0]);if(form==='al_r')C=rn(ops[1]);else if(form==='al_i8'){C=pint(ops[1]);if(C<0||C>255)return null}else addext(ext,ops[1])}
 else if(form.startsWith('w_')){need(1);if(form==='w_r')C=rn(ops[0]);else if(form==='w_i8'){C=pint(ops[0]);if(C<0||C>255)return null}else addext(ext,ops[0])}
 else if(form==='j16'){if(mn==='jmp'){need(1);tgt=lbl(labels,ops[0])}else{need(2);A=rn(ops[0]);tgt=lbl(labels,ops[1])}
  const dd=tgt-(off+4),d=Math.floor(dd/4);if(((dd%4)+4)%4||d<-32768||d>32767)throw new AsmErr('j16 target out of range');B=(d>>8)&0xFF;C=d&0xFF}
 else if(form.startsWith('br_')){need(3);const k=form.slice(3);B=rn(ops[0]);if(k==='rr')C=rn(ops[1]);else if(k==='ri8')C=parseS8(ops[1]);else if(k==='rf8')C=parseF8(ops[1]);else addext(ext,ops[1]);
  tgt=lbl(labels,ops[2]);const wo=off+4*(size-1);ext.push((tgt-(wo+4))>>>0)}
 else if(form==='copy'){need(3);A=rn(ops[0]);B=rn(ops[1]);C=pint(ops[2])&0xFF}
 else if(form==='li2'||form==='li3'){const regs=[];for(const t of ops){const j=t.indexOf('=');if(j<0)throw new AsmErr('li operand');regs.push(rn(t.slice(0,j)));addext(ext,t.slice(j+1))}
  if(regs.length!==(form==='li2'?2:3))throw new AsmErr('li arity');A=regs[0];B=regs[1];C=form==='li3'?regs[2]:0}
 else if(form==='call'){need(1);tgt=lbl(labels,ops[0]);ext=[(tgt-(off+8))>>>0]}
 else if(form==='nat_a'||form==='nat_b'){need(1);let t,ix,rg,m=/^nat(\d+)_([0-9a-f]{3})\(&(r\d+)\)$/.exec(ops[0]);
  if(m){t=+m[1];ix=parseInt(m[2],16);rg=rn(m[3])}else{m=/^([A-Za-z_]\w*)\(&(r\d+)\)$/.exec(ops[0]);if(!m||!NAT.name[m[1]])return null;[t,ix]=NAT.name[m[1]];rg=rn(m[2])}
  ext=[(((t&0xF)<<28)|(ix<<16))>>>0];if(form==='nat_a')A=rg;else B=rg}
 else if(form==='sws'){const lo=pint(ops[1]),hi=pint(ops[2]),dflt=lbl(labels,ops[3]);A=rn(ops[0]);const cases=ops.slice(4).map(c=>{const j=c.indexOf(':');return[c.slice(0,j),c.slice(j+1)]});B=cases.length;
  ext=[lo>>>0,hi>>>0,(dflt-(off+16))>>>0];cases.forEach(([v,lb],k)=>{const p=off+16+8*k;ext.push(pint(v)>>>0,(lbl(labels,lb)-(p+8))>>>0)})}
 else if(form==='swd'){const lo=pint(ops[1]),hi=pint(ops[2]);A=rn(ops[0]);const dflt=lbl(labels,ops[3]);ext=[lo>>>0,hi>>>0,(dflt-(off+16))>>>0];ops.slice(4).forEach((lb,k)=>{const p=off+16+4*k;ext.push((lbl(labels,lb)-(p+4))>>>0)})}
 else if(form.startsWith('clr')){const regs=ops.map(rn);if(regs.length!==+form[3])throw new AsmErr('clr arity');while(regs.length<3)regs.push(0);[A,B,C]=regs}
 else if(form==='r'){need(1);A=rn(ops[0])}
 else if(form==='rc'){need(2);A=rn(ops[0]);C=rn(ops[1])}
 else if(form==='none'){need(0)}
 else throw new AsmErr('form not handled: '+form);
 for(const nm in notes){if(nm==='f')continue;if(nm==='A')A=notes[nm];else if(nm==='B')B=notes[nm];else if(nm==='C')C=notes[nm]}
 const wsize=form==='sws'?4+2*B:form==='swd'?4+ops.slice(4).length:size;
 if(1+ext.length!==wsize)throw new AsmErr('size mismatch for '+mn+': '+(1+ext.length)+' != '+wsize);
 return[(((op<<24)|(A<<16)|(B<<8)|C)>>>0),...ext]}

// ------------------------------------------------------------ words -> text
const unusedNote=(i,used)=>{let s='';for(const[nm,v]of[['A',i.a],['B',i.b],['C',i.c]])if(!used.has(nm)&&v)s+='{'+nm+'=0x'+hex(v)+'}';return s};
function fmtInsn(i){const f=i.form,mn=i.mn,A=i.a,B=i.b,C=i.c,x=[...i.ext,0,0,0,0],fl=isFloatMn(mn),R=n=>'r'+n;let used=new Set(),preNote='',ops='';
 const PX=(e,ff)=>i.rel.has(e+1)?'&A[0x'+hex(x[e])+']':(ff||fmtInt)(x[e]);const S=(...a)=>new Set(a);
 if(f==='rrr'){ops=R(A)+', '+R(B)+', '+R(C);used=S('A','B','C')}
 else if(f==='rri8'||f==='rrf8'){ops=(mn==='rshl'||mn==='rshr')?R(A)+', '+s8(C)+', '+R(B):R(A)+', '+R(B)+', '+((fl||f==='rrf8')?fmtF8(C):String(s8(C)));used=S('A','B','C')}
 else if(f==='rri32'||f==='rri32f'){ops=R(A)+', '+R(B)+', '+((fl||f==='rri32f')?fmtF32(x[0]):PX(0));used=S('A','B')}
 else if(f==='rr'){ops=R(A)+', '+R(C);used=S('A','C')}
 else if(f==='ri8'){ops=R(A)+', '+s8(C);used=S('A','C')}
 else if(f==='rf8'){ops=R(A)+', '+fmtF8(C);used=S('A','C')}
 else if(f==='ri32'){ops=R(A)+', '+PX(0);used=S('A')}
 else if(f==='idx'){ops=A+', '+C;used=S('A','C')}
 else if(f.startsWith('as_')){const k=f.slice(3);let ki,kv;if(k[0]==='r'){ki='r';kv=k.slice(1)}else if(k.startsWith('i8')){ki='i8';kv=k.slice(2)}else{ki='i32';kv=k.slice(3)}
  const idx={r:()=>R(C),i8:()=>String(s8(C)),i32:()=>PX(0)}[ki](),val={r:()=>R(A),i8:()=>String(s8(A)),f8:()=>fmtF8(A),i32:()=>PX(i.size-2)}[kv]();
  ops=R(B)+', '+idx+', '+val;used=S('A','B');if(ki!=='i32')used.add('C');if(kv==='i32')used.delete('A')}
 else if(['gv_r','sv_r_r','sv_r_i8','sv_r_f8','sv_r_i32'].includes(f)){ops=A+', '+B+', '+C+i.ext.map(w=>', 0x'+hex(w,8)).join('');used=S('A','B','C')}
 else if(f.startsWith('gv_')||f.startsWith('sv_')){const sc=B>>4,scn=SCOPES[sc]||'scope'+hex(sc),imm=((B&0xF)<<8)|C,k=f.slice(3).split('_');let ix;
  if(k[0]==='i12'){ix=String(imm);used=S('B','C')}else{ix=PX(0);used=new Set();if(B&0xF)preNote='{B=0x'+hex(B)+'}'}
  if(f.startsWith('gv_')){ops=R(A)+', '+(mn==='lea'?'&':'')+scn+'['+ix+']';used.add('A')}
  else{const vk=k[1],v={r:()=>R(A),i8:()=>String(s8(A)),f8:()=>fmtF8(A),i32:()=>PX(i.size-2)}[vk]();ops=scn+'['+ix+'], '+v;if(vk!=='i32')used.add('A')}
  if(k[0]==='i32')used.add('B')}
 else if(f.startsWith('al_')){const v={al_r:()=>R(C),al_i8:()=>String(C),al_i32:()=>PX(0)}[f]();ops=R(A)+', '+v;used=S('A');if(f!=='al_i32')used.add('C')}
 else if(f.startsWith('w_')){ops={w_r:()=>R(C),w_i8:()=>String(C),w_i32:()=>PX(0)}[f]();used=f!=='w_i32'?S('C'):new Set()}
 else if(f==='j16'){ops=(mn!=='jmp'?R(A)+', ':'')+label(i.tg[0])}
 else if(f.startsWith('br_')){const k=f.slice(3),o2={rr:()=>R(C),ri8:()=>String(s8(C)),rf8:()=>fmtF8(C),ri32:()=>PX(0),ri32f:()=>fmtF32(x[0])}[k]();ops=R(B)+', '+o2+', '+label(i.tg[0])}
 else if(f==='copy'){ops=R(A)+', '+R(B)+', '+C;used=S('A','B','C')}
 else if(f==='li2'||f==='li3'){const regs=[A,B].concat(f==='li3'?[C]:[]);ops=regs.map((g,e)=>R(g)+'='+PX(e)).join(', ');used=S('A','B');if(f==='li3')used.add('C')}
 else if(f==='call'){ops=label(i.tg[0])}
 else if(f==='nat_a'||f==='nat_b'){const base=f==='nat_a'?A:B,t=x[0]>>>28,ix=(x[0]>>>16)&0xFFF,nm=NAT.key[t+':'+ix];ops=(nm||'nat'+t+'_'+hex(ix,3))+'(&'+R(base)+')';used=f==='nat_a'?S('A'):S('B')}
 else if(f==='sws'){ops=R(A)+', '+s32(x[0])+', '+s32(x[1])+', '+label(i.tg[0]);for(let k=0;k<i.b;k++)ops+=', '+s32(x[3+2*k])+':'+label(i.tg[1+k])}
 else if(f==='swd'){ops=R(A)+', '+s32(x[0])+', '+s32(x[1])+', '+label(i.tg[0]);for(let k=0;k<i.size-4;k++)ops+=', '+label(i.tg[1+k])}
 else if(f.startsWith('clr')){const n=+f[3];ops=[A,B,C].slice(0,n).map(R).join(', ');used=new Set('ABC'.slice(0,n).split(''))}
 else if(f==='r'){ops=R(A);used=S('A')}
 else if(f==='rc'){ops=R(A)+', '+R(C);used=S('A','C')}
 else if(f==='none'){ops=''}
 else throw new AsmErr('form not handled: '+f);
 let note;
 if(f==='j16'){note=(mn==='jmp'&&i.a)?'{A=0x'+hex(i.a)+'}':''}
 else if(f.startsWith('br_')){note=i.a?'{A=0x'+hex(i.a)+'}':'';if((f==='br_ri32'||f==='br_ri32f')&&i.c)note+='{C=0x'+hex(i.c)+'}'}
 else if(f==='sws'){note=C?'{C=0x'+hex(C)+'}':''}
 else if(f==='call'){note=[['A',A],['B',B],['C',C]].filter(z=>z[1]).map(z=>'{'+z[0]+'=0x'+hex(z[1])+'}').join('')}
 else note=unusedNote(i,used);
 note=preNote+note;let mnn=mn;if(f==='nat_a')mnn={native:'native_a',native_y:'native_ya'}[mn];
 let line=(mnn.padEnd(13)+' '+ops+note).trimEnd();
 try{const ws=assembleInsn(parseLine(line),()=>i.off+4,i.off);if((ws[0]>>>24)!==i.op)line+='{f='+f+'}'}catch(e){line+='{f='+f+'}'}
 return line}
function fmtBlock(A,p,n,rel,insns,extra){const ins=insns||decodeBlock(A,p,n,rel).ins,end=p+4*n-8,lab=new Set([...(extra||[])].filter(e=>e>=p+8&&e<=end));
 for(const i of ins)for(const t of(i.tg||[]))lab.add(t);
 const dv=new DataView(A.buffer,A.byteOffset,A.length),hi=dv.getUint32(p+4*n-8,true),lo=dv.getUint32(p+4*n-4,true),out=['.block 0x'+hex(p)+' trailer=0x'+hex(hi,8)+',0x'+hex(lo,8)];
 for(const i of ins){if(lab.has(i.off))out.push('L_'+hex(i.off)+':');out.push('    '+fmtInsn(i))}
 if(lab.has(end))out.push('L_'+hex(end)+':');out.push('.end');return out.join('\n')+'\n'}

// ------------------------------------------------------------ block assembly
function parseBlockText(text){const items=[];let p=null,trailer=[0,0];
 text.split(/\r?\n/).forEach((raw,li)=>{const s=raw.split(';')[0].trim();if(!s)return;
  if(s.startsWith('.block')){const m=/^\.block\s+(0x[0-9a-fA-F]+|\d+)(?:\s+trailer=(0x[0-9a-fA-F]+),(0x[0-9a-fA-F]+))?/.exec(s);if(!m)throw new AsmErr('line '+(li+1)+': bad .block line');p=pint(m[1]);if(m[2])trailer=[pint(m[2])>>>0,pint(m[3])>>>0]}
  else if(s==='.end'){}
  else if(/^[\w.]+:$/.test(s))items.push({label:s.slice(0,-1),li});
  else{try{items.push({ln:parseLine(s),li})}catch(e){throw new AsmErr('line '+(li+1)+': '+e.message)}}});
 return{p,trailer,items}}
function assembleBlock(text,base){const pb=parseBlockText(text);const p=base!==undefined?base:pb.p;if(p===null||p===undefined)throw new AsmErr('no .block line');
 let off=p+8;const labels=new Map(),sizes=[];
 for(const it of pb.items){if(it.label!==undefined){if(labels.has(it.label))throw new AsmErr('line '+(it.li+1)+': duplicate label '+it.label);labels.set(it.label,off)}
  else{const v=it.ln;let w;try{if(v.mn==='switch'||v.mn==='switch_sparse'){const cnt=v.ops.length-4;w=4+(v.mn==='switch_sparse'?2*cnt:cnt)}else{const o=off;w=assembleInsn(v,()=>o+4,o).length}}catch(e){throw new AsmErr('line '+(it.li+1)+': '+e.message)}
   sizes.push(w);off+=4*w}}
 const end=off+8,words=[],natpos=[],relocs=[],insnOffs=[];off=p+8;let k=0;const lab=t=>labels.get(t);
 for(const it of pb.items){if(it.label!==undefined)continue;const v=it.ln;let ws;try{ws=assembleInsn(v,lab,off)}catch(e){throw new AsmErr('line '+(it.li+1)+': '+e.message)}
  for(const q of [...v.rel].sort((a,b)=>a-b))relocs.push(off+4*q);insnOffs.push(off);
  if(ws.length!==sizes[k])throw new AsmErr('line '+(it.li+1)+': size changed between passes');
  const fm=OPS.get(ws[0]>>>24).form;if(fm==='nat_a'||fm==='nat_b')natpos.push(words.length+1);
  words.push(...ws);off+=4*ws.length;k++}
 const n=(end-p)/4,allw=[0xFFFFFFFF,n,...words,pb.trailer[0],pb.trailer[1]],idxs=natpos.map(q=>2+q);
 allw[0]=idxs.length?idxs[0]:0xFFFFFFFF;
 idxs.forEach((ix,j)=>{const link=j+1<idxs.length?idxs[j+1]-ix:0xFFFF;if(link>0xFFFF)throw new AsmErr('native chain link too long');allw[ix]=((allw[ix]&0xFFFF0000)|link)>>>0});
 const bytes=new Uint8Array(allw.length*4),dv=new DataView(bytes.buffer);allw.forEach((w,j)=>dv.setUint32(4*j,w>>>0,true));
 return{bytes,labels,relocs,insnOffs,p}}

// ------------------------------------------------------------ wad context / relink
function wadCtx(A,B){const imp=fixups(B),h=(imp[0x8000010e]||[])[0];if(h==null)throw new AsmErr('no strat header');const dv=new DataView(A.buffer,A.byteOffset,A.length),U=o=>dv.getUint32(o,true);
 const code=U(h+0x10),ncode=U(h+0x1c),blocks=[];let p=code;const end=code+4*ncode;while(p<end){const n=U(p+4);blocks.push([p,n]);p+=4*n}
 const rel=imp.rel instanceof Set?imp.rel:new Set(imp.rel);
 return{A,B,hdr:h,code,ncode,hi:end,blocks,rel,U,imp}}
const inCode=(c,v)=>v>=c.code&&v<c.hi;
function extTargets(c){const s=new Set();for(const l of c.rel){const v=c.U(l);if(inCode(c,v))s.add(v)}return s}
function blockOf(c,off){for(const[p,n]of c.blocks)if(p<=off&&off<p+4*n)return[p,n];return null}
function blockText(c,p,ext){const b=c.blocks.find(x=>x[0]===p);if(!b)throw new AsmErr('no block at 0x'+hex(p));return fmtBlock(c.A,p,b[1],c.rel,null,ext||extTargets(c))}

// edits: Map/obj {blockOffset: text}. Returns {A,B,info}. Nothing in A shifts: the code region is re-emitted at the end.
function relink(A0,B0,edits){const c=wadCtx(A0,B0),lo=c.code,hi=c.hi;const E=edits instanceof Map?edits:new Map(Object.entries(edits||{}).map(([k,v])=>[+k,v]));
 let base=A0.length;base+=((-base)%16+16)%16||16;let pos=base;const info=[],chunks=[],relocs=[],need=extTargets(c),starts=c.blocks.map(b=>b[0]);
 for(const[p,n]of c.blocks){if(E.has(p)){let r;try{r=assembleBlock(E.get(p),pos)}catch(e){throw new AsmErr('block 0x'+hex(p)+': '+e.message)}
   const mp=new Map([[p,pos],[p+4*n,pos+r.bytes.length]]);
   for(const o of need)if(o>=p+8&&o<=p+4*n-8){const nm='L_'+hex(o);if(!r.labels.has(nm))throw new AsmErr('block 0x'+hex(p)+': instruction 0x'+hex(o)+' is pointed at from outside but has no label '+nm);mp.set(o,r.labels.get(nm))}
   relocs.push(...r.relocs);info.push({p,n,np:pos,nn:r.bytes.length/4,mp,d:null});chunks.push(r.bytes);pos+=r.bytes.length}
  else{const b=A0.subarray(p,p+4*n),d=pos-p;for(const o of c.rel)if(o>=p&&o<p+4*n)relocs.push(o+d);info.push({p,n,np:pos,nn:n,mp:null,d});chunks.push(b);pos+=4*n}}
 const A=new Uint8Array(pos);A.set(A0);let q=base;for(const b of chunks){A.set(b,q);q+=b.length}
 const dv=new DataView(A.buffer),U=o=>dv.getUint32(o,true),W=(o,v)=>dv.setUint32(o,v>>>0,true);
 const m=v=>{if(!(v>=lo&&v<hi))return v;let a=0,b=starts.length-1;while(a<b){const mid=(a+b+1)>>1;if(starts[mid]<=v)a=mid;else b=mid-1}const x=info[a];if(x.mp===null)return v+x.d;if(x.mp.has(v))return x.mp.get(v);throw new AsmErr('pointer to 0x'+hex(v)+' lands inside edited block 0x'+hex(x.p)+' at an unlabelled offset')};
 for(const l of c.rel){if(l>=lo&&l<hi)continue;const v=U(l);if(v>=lo&&v<hi)W(l,m(v))}
 for(const l of relocs){const v=U(l);if(v>=lo&&v<hi)W(l,m(v))}
 W(c.hdr+0x1c,(pos-base)/4);
 const B=new Uint8Array(B0.length+4*relocs.length);B.set(B0);const bd=new DataView(B.buffer);relocs.forEach((o,j)=>bd.setUint32(B0.length+4*j,o>>>0,true));
 return{A,B,info:{base,end:pos,relocs,m}}}

const sig=i=>i.form==='nat_a'||i.form==='nat_b'?[i.mn,i.form,i.a,i.b,i.c,i.ext[0]&0xFFFF0000].join():i.tg!==null?[i.mn,i.form,i.a,i.form==='j16'?0:i.b,i.form==='j16'?0:i.c].join():[i.mn,i.form,i.a,i.b,i.c,i.ext.filter((e,k)=>!i.rel.has(k+1)).join('/')].join();
// strong consistency check of a relinked wad against the original (returns [] when fine)
function verify(c0,A1,B1,relocs,skip){const bad=[];let c1;try{c1=wadCtx(A1,B1)}catch(e){return['new wad does not parse: '+e.message]}
 const A0=c0.A,lo=c0.code,hi=c0.hi,nlo=c1.code,nhi=c1.hi,U1=c1.U;
 if(c1.hdr!==c0.hdr)bad.push('header moved');
 if(c1.blocks.reduce((s,b)=>s+b[1],0)!==c1.ncode)bad.push('new blocks do not tile the new region');
 const ins1=new Map(),ins0=new Map();
 for(const[p,n]of c1.blocks){const r=decodeBlock(A1,p,n,c1.rel);if(r.errs.length){bad.push('new block 0x'+hex(p)+': '+r.errs[0]);continue}for(const i of r.ins)ins1.set(i.off,i);
  let k=U1(p),chain=[];if(k!==0xFFFFFFFF){for(;;){const v=U1(p+4*k);chain.push(p+4*k);if((v&0xFFFF)===0xFFFF)break;k+=v&0xFFFF}}
  const want=r.ins.filter(i=>i.form==='nat_a'||i.form==='nat_b').map(i=>i.off+4);if(chain.join()!==want.join())bad.push('new block 0x'+hex(p)+' native chain wrong')}
 for(const[p,n]of c0.blocks)for(const i of decodeBlock(A0,p,n,c0.rel).ins)ins0.set(i.off,i);
 let checked=0;const changed=new Set([c0.hdr+0x1c]);
 for(const l of c0.rel){if(l>=lo&&l<hi){changed.add(l);continue}const v0=c0.U(l);
  if(v0>=lo&&v0<hi){changed.add(l);const v1=U1(l);if(!(v1>=nlo&&v1<nhi)){bad.push('pointer at 0x'+hex(l)+' not retargeted');continue}
   const kb=blockOf(c0,v0);if(kb&&skip&&skip.has(kb[0])){checked++;continue}
   const i0=ins0.get(v0),i1=ins1.get(v1);if((i0===undefined)!==(i1===undefined)||(i0&&sig(i0)!==sig(i1)))bad.push('pointer at 0x'+hex(l)+' reaches a different instruction');checked++}
  else if(U1(l)!==v0)bad.push('non-code pointer at 0x'+hex(l)+' changed')}
 let nd=0,first=-1;for(let o=0;o<A0.length;o+=4)if(!changed.has(o)&&c0.U(o)!==U1(o)){nd++;if(first<0)first=o}
 if(nd)bad.push(nd+' unexpected changed words, first at 0x'+hex(first));
 const newRel=new Set();for(const o of c1.rel)if(o>=nlo&&o<nhi)newRel.add(o);const want=new Set(relocs);
 if(newRel.size!==want.size||[...want].some(o=>!newRel.has(o)))bad.push('new-region relocations differ ('+newRel.size+' vs '+want.size+')');
 return{bad,checked}}
function withNops(c,every){every=every||3;const need=extTargets(c),out=new Map();
 for(const[p,n]of c.blocks){const lines=[];let k=0;for(const ln of fmtBlock(c.A,p,n,c.rel,null,need).split('\n')){lines.push(ln);if(ln.startsWith('    ')){k++;if(k%every===0)lines.push('    nop')}}out.set(p,lines.join('\n'))}
 return out}
// self-test of one wad: every block text round trip + identity relink + nops relink + second generation
function selfTest(A,B){const c=wadCtx(A,B),r={blocks:c.blocks.length,insns:0,rtBad:[],relinkBad:[],ptr:0};
 for(const[p,n]of c.blocks){const{ins,errs}=decodeBlock(A,p,n,c.rel);if(errs.length){r.rtBad.push('0x'+hex(p)+' decode: '+errs[0]);continue}r.insns+=ins.length;
  try{const t=fmtBlock(A,p,n,c.rel,ins),a=assembleBlock(t),orig=A.subarray(p,p+4*n);if(a.bytes.length!==orig.length||a.bytes.some((v,j)=>v!==orig[j]))r.rtBad.push('0x'+hex(p)+' bytes differ');
   const want=[...c.rel].filter(o=>o>=p&&o<p+4*n).sort((x,y)=>x-y);if(a.relocs.join()!==want.join())r.rtBad.push('0x'+hex(p)+' relocations differ')}catch(e){r.rtBad.push('0x'+hex(p)+' '+e.message)}}
 for(const label of['identity','nops']){try{const ed=label==='nops'?withNops(c):new Map(),x=relink(A,B,ed),v=verify(c,x.A,x.B,x.info.relocs);r.ptr+=v.checked;if(v.bad.length)r.relinkBad.push(label+': '+v.bad.slice(0,2).join('; '));
   else if(label==='nops'){const c1=wadCtx(x.A,x.B),y=relink(x.A,x.B,new Map()),v2=verify(c1,y.A,y.B,y.info.relocs);if(v2.bad.length)r.relinkBad.push('generation 2: '+v2.bad.slice(0,2).join('; '))}}catch(e){r.relinkBad.push(label+': '+e.message)}}
 return r}
return{assembleInsn,parseLine,AsmErr,OPS,wadCtx,extTargets,blockOf,blockText,fmtBlock,fmtInsn,decodeBlock,assembleBlock,parseBlockText,relink,verify,withNops,selfTest,hex,NAT}})();
