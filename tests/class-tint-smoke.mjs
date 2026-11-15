// Class tint build steps on a real level wad. Needs ININJA_TEST_VOL=path/to/10.vol (skips otherwise).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as V from '../js/vol-core.js';
import { IA } from '../js/strat-assembler.js';
import { planTints, applyTintData, colourCalls, embeddedTints, MAGIC } from '../js/class-tint.js';

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
  // the patched wad recognises its own tint: shown again, not reported as the object's own SetColor, edited in place (no second prologue)
  const emb = embeddedTints(r.A, r.B);
  assert.equal(emb.size, 2); assert.deepEqual(emb.get(pk[0].i), [255, 0, 0]); assert.deepEqual(emb.get(pk[1].i), [0, 128, 255]);
  assert.deepEqual(colourCalls(r.A, r.B, 'Pickup'), { set: false, clear: false }, 'the editor prologue is not the object colour code');
  const bl2 = new Map(), plan2 = planTints(r.A, r.B, { [pk[0].i]: [0, 255, 0], [pk[1].i]: false, [pk[2].i]: [9, 9, 9] }, bl2);
  assert.equal(bl2.size, 0, 'no second prologue'); assert.ok(plan2.classes[0].already);
  const r2 = applyTintData(r.A, r.B, plan2), emb2 = embeddedTints(r2.A, r2.B);
  assert.equal(V.siWad(r2.A, r2.B).classes.find(c => c.name === 'Pickup').ninit, n0 + 4, 'class not extended twice');
  assert.deepEqual([...emb2].map(([i, v]) => i + ':' + v).sort(), [pk[0].i + ':0,255,0', pk[2].i + ':9,9,9'].sort());
  assert.ok(r2.A.length - r.A.length < 64, 'in-place edit does not grow the wad');
  const c3 = IA.wadCtx(r2.A, r2.B), cl3 = V.siWad(r2.A, r2.B).classes.find(c => c.name === 'Pickup');
  assert.equal((IA.blockText(c3, IA.blockOf(c3, cl3.entry)[0], IA.extTargets(c3)).match(/Strat_SetColor/g) || []).length, 1, 'exactly one tint prologue');
  assert.equal(planTints(A, B, { [pk[3].i]: false }, new Map()).classes.length, 0, 'clearing a tint that does not exist changes nothing');
  const [A20, B20] = V.readWad(buf, V.parseVol(buf).find(f => f.name === '10-20.LCS'));
  assert.deepEqual(colourCalls(A20, B20, 'Pickup'), { set: false, clear: false });
  assert.deepEqual(colourCalls(A20, B20, 'Ranx'), { set: true, clear: true }, 'Ranx flashes with Strat_SetColor and clears it');
  console.log('PASS class tint: code prologue relinks and verifies, init arrays extended, untinted instances unchanged');
}
