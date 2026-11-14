// Per-instance colour tint for any class, driven by data instead of hand-written script edits.
//
// For every class that has at least one tinted instance in a level, the build:
//   1. raises the class's initial-register count by 4 (class record +0x18) and gives EVERY instance of that class a longer
//      init array (old values copied, then flag, R, G, B). Instances that are not tinted get flag 0.
//   2. inserts a small prologue at the class entry (before any original code can overwrite those registers):
//          bne      r<n>, MAGIC, L_tint_<entry>      ; n = the class's old register count
//          native   Strat_SetColor(&r<n+1>)           ; R, G, B in r<n+1..n+3>
//        L_tint_<entry>:
//      The prologue goes into the same code block text the Scripts tab edits, so it is relinked with any code edits the project has.
// The project stores only  tints: { <wad>: { inst: { "<instance index>": [r,g,b] } } }.
import { EC } from './editor-core.js';
import { IA } from './strat-assembler.js';
import { siWad, fixups } from './vol-core.js';

const MAGIC = 4411212; // 0x434F4C: a flag value garbage registers will not normally hold
const EXTRA = 4;

// Adds the prologue to the code-block texts in `bl` (Map blockOffset -> text; read from the wad when absent). Returns what applyTintData needs.
function planTints(A, B, inst, bl) {
  const sw = siWad(A, B); if (!sw) throw 'tint: this wad has no strat classes';
  const c = IA.wadCtx(A, B), ext = IA.extTargets(c), byClass = new Map(), items = [];
  for (const [k, rgb] of Object.entries(inst || {})) {
    const i = +k, ins = sw.instances[i];
    if (!ins || ins.cls < 0) throw 'tint: instance #' + i + ' does not exist in this wad';
    if (!Array.isArray(rgb) || rgb.length !== 3 || !rgb.every(v => Number.isInteger(v) && v >= 0 && v <= 255)) throw 'tint: instance #' + i + ' needs three whole numbers from 0 to 255';
    const cl = sw.classes[ins.cls]; byClass.set(cl.off, cl); items.push({ i, rgb });
  }
  const classes = [];
  for (const cl of byClass.values()) {
    if (cl.ninit + EXTRA > 250) throw 'tint: class ' + cl.name + ' already has too many initial values';
    const b = IA.blockOf(c, cl.entry); if (!b) throw 'tint: class ' + cl.name + ' has no code block';
    let text = bl.get(b[0]); if (text === undefined) text = IA.blockText(c, b[0], ext);
    const lines = text.split(/\r?\n/), tag = 'L_tint_' + cl.entry.toString(16);
    if (!text.includes(tag + ':')) {
      const at = lines.findIndex(l => { const m = /^L_([0-9a-fA-F]+):\s*$/.exec(l.trim()); return m && parseInt(m[1], 16) === cl.entry; });
      if (at < 0) throw 'tint: cannot find the entry point of ' + cl.name + ' in its code';
      const n = cl.ninit;
      lines.splice(at + 1, 0, '    bne           r' + n + ', ' + MAGIC + ', ' + tag, '    native        Strat_SetColor(&r' + (n + 1) + ')', tag + ':');
    }
    bl.set(b[0], lines.join('\n'));
    classes.push({ off: cl.off, name: cl.name, ninit: cl.ninit });
  }
  return { classes, items };
}

// Data half: class register counts and per-instance init arrays. Run on the wad AFTER the code edits are relinked.
function applyTintData(A0, B0, plan) {
  const sw = siWad(A0, B0), bld = EC.Builder(A0, B0), cset = new Map(plan.classes.map(c => [c.off, c])), tint = new Map(plan.items.map(x => [x.i, x.rgb]));
  for (const c of plan.classes) { const v = c.ninit + EXTRA; bld.A[c.off + 0x18] = v & 255; bld.A[c.off + 0x19] = v >> 8; }
  let touched = 0;
  sw.instances.forEach((ins, i) => {
    const c = cset.get(bld.U(ins.off + 0x28)); if (!c) return;
    const n = c.ninit, p = bld.U(ins.off + 0x2c), np = bld.alloc(4 * (n + EXTRA), 4);
    for (let k = 0; k < n && p; k++) { bld.W(np + 4 * k, bld.U(p + 4 * k)); if (bld.rel.has(p + 4 * k)) bld.addRel(np + 4 * k); }
    const rgb = tint.get(i);
    if (rgb) { bld.W(np + 4 * n, MAGIC); for (let k = 0; k < 3; k++) bld.W(np + 4 * (n + 1 + k), rgb[k]); }
    bld.W(ins.off + 0x2c, np); bld.addRel(ins.off + 0x2c); touched++;
  });
  const r = bld.finish(); r.report = plan.classes.map(c => c.name).join(', ') + ': ' + plan.items.length + ' tinted instance(s), ' + touched + ' init array(s) extended';
  return r;
}

// ---- inspector section for the selected entity
function installTintUi({ Viewer, getProject, wadOf, rec, onChange = () => {} }) {
  const hex = v => '#' + v.map(x => x.toString(16).padStart(2, '0')).join('');
  const store = w => { const P = getProject(); P.tints = P.tints || {}; return P.tints[w] = P.tints[w] || { inst: {} }; };
  const cur = (w, i) => { const t = (getProject().tints || {})[w]; return t && t.inst && t.inst[i]; };
  const set = (w, i, rgb) => {
    const T = store(w);
    if (rgb) T.inst[i] = rgb; else { delete T.inst[i]; if (!Object.keys(T.inst).length) delete getProject().tints[w]; }
    onChange();
  };
  function inject() {
    const S = Viewer.$('ed_sel'); if (!S || !Viewer.sel) return;
    const old = Viewer.$('ed_tint_box'); if (old) old.remove();
    const R = rec(Viewer.sel); if (!R) return;
    const L = Viewer.sel.L, w = wadOf(L); if (!w) return;
    const e = R.e, box = document.createElement('div'); box.id = 'ed_tint_box'; box.style.cssText = 'margin-top:5px;border-top:1px solid #333;padding-top:4px';
    if (R.add) { box.innerHTML = '<span class=h>colour tint: a new copy keeps the tint of the instance it was copied from</span>'; S.appendChild(box); return; }
    const t = cur(w, e.i);
    box.innerHTML = '<label title="Adds a small tint check to this class in this level when you build. Instances that are not tinted behave exactly as before."><input type=checkbox id=tn_on' + (t ? ' checked' : '') + '> colour tint</label> '
      + '<input type=color id=tn_c value="' + hex(t || [255, 255, 255]) + '"' + (t ? '' : ' disabled') + '> <span id=tn_v class=h>' + (t ? t.join(', ') : '') + '</span>'
      + '<div class=h>applies to this ' + Viewer.esc(e.n) + ' only; takes effect in the patched .vol</div>';
    S.appendChild(box);
    const on = box.querySelector('#tn_on'), c = box.querySelector('#tn_c'), v = box.querySelector('#tn_v');
    const rgb = () => [1, 3, 5].map(k => parseInt(c.value.slice(k, k + 2), 16));
    on.onchange = () => { c.disabled = !on.checked; if (on.checked) { const x = rgb(); v.textContent = x.join(', '); set(w, e.i, x); } else { v.textContent = ''; set(w, e.i, null); } };
    c.onchange = () => { const x = rgb(); v.textContent = x.join(', '); if (on.checked) set(w, e.i, x); };
  }
  return { inject };
}

export { planTints, applyTintData, installTintUi, MAGIC };
