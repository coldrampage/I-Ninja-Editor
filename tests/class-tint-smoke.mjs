// Class tint build steps on a real level wad. Needs ININJA_TEST_VOL=path/to/10.vol (skips otherwise).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as V from '../js/vol-core.js';
import { IA } from '../js/strat-assembler.js';
import { planTints, applyTintData, MAGIC } from '../js/class-tint.js';

const vp = process.env.ININJA_TEST_VOL;
if (!vp) console.log('SKIP class tint (set ININJA_TEST_VOL to 10.vol)');
else {
  const nb = fs.readFileSync(vp), buf = nb.buffer.slice(nb.byteOffset, nb.byteOffset + nb.length);
  const [A, B] = V.readWad(buf, V.parseVol(buf).find(f => f.name === '10-05.LCS'));
  const ents = V.instances(A, B), pk = ents.filter(e => e.n === 'Pickup'), sw = V.siWad(A, B);
  assert.throws(() => planTints(A, B, { 74: [256, 0, 0] }, new Map()), /0 to 255/);
  const bl = new Map(), plan = planTints(A, B, { [pk[0].i]: [255, 0, 0], [pk[1].i]: [0, 128, 255] }, bl);
  const x = IA.relink(A, B, bl), v = IA.verify(IA.wadCtx(A, B), x.A, x.B, x.info.relocs, new Set(bl.keys()));
  assert.equal(v.bad.length, 0);
  const r = applyTintData(x.A, x.B, plan), after = V.instances(r.A, r.B);
  const n0 = sw.classes.find(c => c.name === 'Pickup').ninit;
  assert.equal(V.siWad(r.A, r.B).classes.find(c => c.name === 'Pickup').ninit, n0 + 4);
  for (const e of after.filter(e => e.n === 'Pickup')) assert.equal(e.params.length, n0 + 4);
  const t = after.find(e => e.i === pk[0].i).params.map(p => p.v);
  assert.deepEqual(t.slice(n0), [MAGIC, 255, 0, 0]);
  assert.deepEqual(after.find(e => e.i === pk[2].i).params.slice(n0).map(p => p.v), [0, 0, 0, 0], 'untinted instances keep flag 0');
  for (const e of after.filter(e => e.n !== 'Pickup')) assert.equal(JSON.stringify(e.params.map(p => p.v)), JSON.stringify(ents.find(q => q.i === e.i).params.map(p => p.v)));
  const c2 = IA.wadCtx(r.A, r.B), cl = V.siWad(r.A, r.B).classes.find(c => c.name === 'Pickup');
  const txt = IA.blockText(c2, IA.blockOf(c2, cl.entry)[0], IA.extTargets(c2));
  assert.match(txt, /bne\s+r1, 0x00434f4c, L_/); assert.match(txt, /Strat_SetColor\(&r2\)/);
  console.log('PASS class tint: code prologue relinks and verifies, init arrays extended, untinted instances unchanged');
}
