import fs from 'node:fs';
import assert from 'node:assert/strict';
import { EC } from '../js/editor-core.js';
import { parseVol, readWad, instances } from '../js/vol-core.js';

const volumePath = process.env.ININJA_TEST_30_VOL;
if (!volumePath || !fs.existsSync(volumePath)) {
  console.log('SKIP register data copy integration (set ININJA_TEST_30_VOL)');
  process.exit(0);
}
const raw = fs.readFileSync(volumePath);
const ab = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
const file = parseVol(ab).find(f => f.name === '30-00.LCS');
assert(file, '30-00.LCS exists');
const [A, B] = readWad(ab, file), S = EC.SrcCtx(A, B), all = instances(A, B), U = S.U;
const senseiIndex = all.findIndex(e => e.n === 'Sensei_Intro');
assert(senseiIndex >= 0, 'Sensei_Intro exists in 30-00');
const sensei = S.w.instances[senseiIndex];
const readUtf8 = (bytes, off) => new TextDecoder('utf-8').decode(bytes.subarray(off, bytes.indexOf(0, off)));
const soundNamed = name => [...S.res].find(([off, type]) => type === 0x113 && EC.parseBank(A, off)?.name === name)?.[0];

// R1: five-language text + audio table. Change English text and its voice bank.
const table1 = U(sensei.init + 4), textSlot1 = table1, audioSlot1 = table1 + 4, originalHandle1 = U(audioSlot1);
const originalText1 = U(textSlot1), originalSound1 = U(originalHandle1);
assert(S.w.rel.has(textSlot1) && S.w.rel.has(audioSlot1) && S.w.rel.has(originalHandle1), 'R1 text and sound-handle entries are relocated pointers');
assert.equal(S.res.get(originalHandle1), 0x115, 'R1 audio target is a sound-handle resource');
assert.equal(S.res.get(originalSound1), 0x113, 'R1 sound handle points to a sound-bank resource');
assert.equal(EC.parseBank(A, originalSound1)?.name, 'sen_ForestHUB1_eng_01.wav');
const replacementBank = soundNamed('sen_ForestMission2_eng_01.wav');
const replacementSound = [...S.res].find(([off, type]) => type === 0x115 && U(off) === replacementBank)?.[0];
assert(replacementSound != null, 'same-format replacement sound handle exists');
const editedLine = 'Inspector test line — editable text.';
const ops = { mods: { [senseiIndex]: {
  d: [0, 0, 0], regs: {},
  texts: { [textSlot1]: { owner: table1, slot: textSlot1, ownerKind: 'data', value: editedLine } },
  sounds: { [audioSlot1]: { owner: table1, slot: audioSlot1, off: replacementSound } }
} } };
const patched = EC.patchLcs(A, B, ops, '30-00.LCS', () => null, {});
const P = EC.SrcCtx(patched.A, patched.B), pInst = P.w.instances[senseiIndex];
const pTable = P.U(pInst.init + 4), pText = P.U(pTable), pAudioSlot = pTable + 4, pAudioHandle = P.U(pAudioSlot), pSound = P.U(pAudioHandle);
assert.equal(readUtf8(patched.A, pText), editedLine, 'the edited UTF-8 text is reachable via the rebuilt relocation');
assert.equal(P.w.rel.has(pTable) && P.w.rel.has(pAudioSlot) && P.w.rel.has(pAudioHandle), true, 'the rebuilt table keeps text and sound-handle relocations');
assert.equal(P.res.get(pAudioHandle), 0x115, 'replacement sound handle stays registered');
assert.equal(P.res.get(pSound), 0x113, 'replacement sound bank stays registered');
assert.equal(EC.parseBank(patched.A, pSound)?.name, 'sen_ForestMission2_eng_01.wav');

// R3: five-language text-only table. It should be editable without inventing audio links.
const table3 = U(sensei.init + 4 * 3), textSlot3 = table3;
const r3Line = 'Debug Text Is Now Editable';
const patchedR3 = EC.patchLcs(A, B, { mods: { [senseiIndex]: {
  d: [0, 0, 0], regs: {},
  texts: { [textSlot3]: { owner: table3, slot: textSlot3, value: r3Line } }
} } }, '30-00.LCS', () => null, {});
const Q = EC.SrcCtx(patchedR3.A, patchedR3.B), qTable = Q.U(Q.w.instances[senseiIndex].init + 4 * 3);
assert.equal(readUtf8(patchedR3.A, Q.U(qTable)), r3Line, 'R3 text-only table rebuilds correctly');

// R2 and R5 are further dialogue/audio tables; ensure the known first English strings parse.
for (const register of [2, 5]) {
  const ptr = U(sensei.init + register * 4), slot = ptr, text = U(slot), audioHandle = U(slot + 4), audio = U(audioHandle);
  assert(S.w.rel.has(slot) && S.w.rel.has(slot + 4) && S.w.rel.has(audioHandle), `R${register} dialogue table uses relocated pointers`);
  assert(readUtf8(A, text).length > 10, `R${register} text entry parses`);
  assert.equal(S.res.get(audioHandle), 0x115, `R${register} audio pointer resolves to a sound handle`);
  assert.equal(S.res.get(audio), 0x113, `R${register} sound handle resolves to a sound bank`);
}

// R1 on both plant classes is an IEEE-754 float (100.0), not an address.
for (const name of ['PlantLilly', 'PlantFlowers']) {
  const index = all.findIndex(e => e.n === name);
  assert(index >= 0, `${name} exists in 30-00`);
  const rawScale = U(S.w.instances[index].init + 4);
  const dv = new DataView(new ArrayBuffer(4)); dv.setUint32(0, rawScale, true);
  assert.equal(dv.getFloat32(0, true), 100, `${name} R1 is 100.0f`);
}

// A copied same-level Sensei gets an independent copy of its edited data root.
const addIndex = S.w.instances.length;
const copyLine = 'Only the copied Sensei should say this.';
const addedOps = { adds: [{
  id: 999, from: { w: '30-00.LCS', i: senseiIndex }, p: all[senseiIndex].p.slice(),
  texts: { [textSlot1]: { owner: table1, slot: textSlot1, value: copyLine } },
  sounds: { [audioSlot1]: { owner: table1, slot: audioSlot1, off: replacementSound } }
}] };
const addedOut = EC.patchLcs(A, B, addedOps, '30-00.LCS', () => null, {});
const N = EC.SrcCtx(addedOut.A, addedOut.B);
assert.equal(N.w.instances.length, addIndex + 1, 'one copied Sensei instance was appended');
const added = N.w.instances[addIndex], addedTable = N.U(added.init + 4), addedAudioHandle = N.U(addedTable + 4);
assert.equal(readUtf8(addedOut.A, N.U(addedTable)), copyLine, 'copied instance has its own edited dialogue');
assert.equal(N.res.get(addedAudioHandle), 0x115, 'copied instance audio field points to a registered sound handle');
assert.equal(EC.parseBank(addedOut.A, N.U(addedAudioHandle))?.name, 'sen_ForestMission2_eng_01.wav', 'copied instance has selected audio');
const originalAfter = N.w.instances[senseiIndex], originalTableAfter = N.U(originalAfter.init + 4);
assert.equal(N.U(originalTableAfter), originalText1, 'original Sensei retains the original text pointer');
assert.equal(EC.parseBank(addedOut.A, N.U(N.U(originalTableAfter + 4)))?.name, EC.parseBank(A, originalSound1)?.name,
  'original Sensei retains its original sound link');

console.log('PASS Sensei_Intro R1/R2/R5 dialogue and audio tables resolve from real 30-00 data');
console.log('PASS Sensei_Intro R3 text-only table rebuilds with editable UTF-8 text');
console.log('PASS PlantLilly and PlantFlowers R1 registers resolve to float 100.0');
console.log('PASS copied Sensei receives isolated text/audio edits without changing the original');
