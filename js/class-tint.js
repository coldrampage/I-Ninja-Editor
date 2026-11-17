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
import { EC } from './editor-core.js?v=step43-native-layer-uv';
import { IA } from './strat-assembler.js';
import { siWad, fixups } from './vol-core.js?v=step43-native-layer-uv';

const MAGIC = 4411212; // 0x434F4C: a flag value garbage registers will not normally hold
const EXTRA = 4;
const PROLOGUE_RE = /^\s*bne\s+r(\d+),\s*(?:0x0*434f4c|4411212),\s*L_\w+\s*$/i;
const SETCOL_RE = /^\s*native\s+Strat_SetColor\(&r(\d+)\)/;

// Recognise the editor's own tint in a wad: the class entry starts with the prologue below and the class has exactly 4 more
// initial values than the prologue's register. Returns that first register (K) or -1. Anything else in the game's own code is left alone.
const layoutCache = new WeakMap();
function tintLayout(A, B, cl, c, ext) {
  let m = layoutCache.get(A); if (!m) layoutCache.set(A, m = new Map());
  if (m.has(cl.off)) return m.get(cl.off);
  let K = -1;
  try {
    const b = IA.blockOf(c, cl.entry);
    if (b) {
      const lines = IA.blockText(c, b[0], ext).split(/\r?\n/);
      const at = lines.findIndex(l => { const x = /^L_([0-9a-fA-F]+):\s*$/.exec(l.trim()); return x && parseInt(x[1], 16) === cl.entry; });
      const m1 = at >= 0 && PROLOGUE_RE.exec(lines[at + 1] || ''), m2 = at >= 0 && SETCOL_RE.exec(lines[at + 2] || '');
      if (m1 && m2 && +m2[1] === +m1[1] + 1 && +m1[1] + EXTRA === cl.ninit) K = +m1[1];
    }
  } catch (e) { K = -1; }
  m.set(cl.off, K); return K;
}

// Tints already present in a loaded wad (made by an earlier build): Map(instance index -> [r,g,b])
const embCache = new WeakMap();
function embeddedTints(A, B) {
  if (embCache.has(A)) return embCache.get(A);
  const out = new Map(); embCache.set(A, out);
  let sw; try { sw = siWad(A, B); } catch (e) { sw = null; }
  if (!sw) return out;
  const d = new DataView(A.buffer, A.byteOffset, A.length), U = o => d.getUint32(o, true);
  let c = null, ext = null; const ok = new Map();
  sw.instances.forEach((ins, i) => {
    if (ins.cls < 0) return; const cl = sw.classes[ins.cls], K = cl.ninit - EXTRA, p = U(ins.off + 0x2c);
    if (K < 0 || !p || U(p + 4 * K) !== MAGIC) return;
    if (!ok.has(cl.off)) { c = c || IA.wadCtx(A, B); ext = ext || IA.extTargets(c); ok.set(cl.off, tintLayout(A, B, cl, c, ext) === K); }
    if (ok.get(cl.off)) out.set(i, [U(p + 4 * (K + 1)), U(p + 4 * (K + 2)), U(p + 4 * (K + 3))]);
  });
  return out;
}

// Adds the prologue to the code-block texts in `bl` (Map blockOffset -> text; read from the wad when absent) for classes that do not
// have the editor's tint yet. `inst` maps instance index -> [r,g,b] to set, or false to clear a tint that is already in the wad.
function planTints(A, B, inst, bl) {
  const sw = siWad(A, B); if (!sw) throw 'tint: this wad has no strat classes';
  const c = IA.wadCtx(A, B), ext = IA.extTargets(c), byClass = new Map(), items = [];
  for (const [k, rgb] of Object.entries(inst || {})) {
    const i = +k, ins = sw.instances[i];
    if (!ins || ins.cls < 0) throw 'tint: instance #' + i + ' does not exist in this wad';
    if (rgb !== false && !(Array.isArray(rgb) && rgb.length === 3 && rgb.every(v => Number.isInteger(v) && v >= 0 && v <= 255))) throw 'tint: instance #' + i + ' needs three whole numbers from 0 to 255';
    const cl = sw.classes[ins.cls]; if (!byClass.has(cl.off)) byClass.set(cl.off, { cl, K: tintLayout(A, B, cl, c, ext), items: [] });
    byClass.get(cl.off).items.push({ i, rgb });
  }
  const classes = [];
  for (const { cl, K, items: its } of byClass.values()) {
    if (K >= 0) { classes.push({ off: cl.off, name: cl.name, ninit: cl.ninit, already: true, K }); items.push(...its); continue; } // edit values in place
    const sets = its.filter(x => x.rgb !== false); if (!sets.length) continue; // nothing to clear in a class without the tint
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
    classes.push({ off: cl.off, name: cl.name, ninit: cl.ninit, already: false });
    items.push(...sets);
  }
  return { classes, items };
}

// Data half: class register counts and per-instance init arrays. Run on the wad AFTER the code edits are relinked.
function applyTintData(A0, B0, plan) {
  const sw = siWad(A0, B0), bld = EC.Builder(A0, B0), cset = new Map(plan.classes.map(c => [c.off, c])), tint = new Map(plan.items.map(x => [x.i, x.rgb]));
  for (const c of plan.classes) if (!c.already) { const v = c.ninit + EXTRA; bld.A[c.off + 0x18] = v & 255; bld.A[c.off + 0x19] = v >> 8; }
  let touched = 0, edited = 0;
  sw.instances.forEach((ins, i) => {
    const c = cset.get(bld.U(ins.off + 0x28)); if (!c) return;
    const rgb = tint.get(i);
    if (c.already) { // the class already carries the tint: just change this instance's four values in its existing init array
      if (rgb === undefined) return;
      const p = bld.U(ins.off + 0x2c), K = c.K;
      bld.W(p + 4 * K, rgb ? MAGIC : 0); for (let k = 0; k < 3; k++) bld.W(p + 4 * (K + 1 + k), rgb ? rgb[k] : 0);
      edited++; return;
    }
    const n = c.ninit, p = bld.U(ins.off + 0x2c), np = bld.alloc(4 * (n + EXTRA), 4);
    for (let k = 0; k < n && p; k++) { bld.W(np + 4 * k, bld.U(p + 4 * k)); if (bld.rel.has(p + 4 * k)) bld.addRel(np + 4 * k); }
    if (rgb) { bld.W(np + 4 * n, MAGIC); for (let k = 0; k < 3; k++) bld.W(np + 4 * (n + 1 + k), rgb[k]); }
    bld.W(ins.off + 0x2c, np); bld.addRel(ins.off + 0x2c); touched++;
  });
  const r = bld.finish(); r.report = plan.classes.map(c => c.name).join(', ') + ': ' + plan.items.length + ' tint change(s)' + (touched ? ', ' + touched + ' init array(s) extended' : '') + (edited ? ', ' + edited + ' edited in place' : '');
  return r;
}

// ---- does this class (or code it calls) touch the object colour itself? Follows `call`s into other code blocks.
const callCache = new WeakMap();
function colourCalls(A, B, className) {
  let m = callCache.get(A); if (!m) callCache.set(A, m = new Map());
  if (m.has(className)) return m.get(className);
  const res = { set: false, clear: false }, sw = siWad(A, B), cl = sw && sw.classes.find(c => c.name === className);
  if (cl) {
    const c = IA.wadCtx(A, B), ext = IA.extTargets(c), seen = new Set(), todo = [cl.entry];
    while (todo.length && seen.size < 24) {
      const b = IA.blockOf(c, todo.pop()); if (!b || seen.has(b[0])) continue; seen.add(b[0]);
      let t; try { t = IA.blockText(c, b[0], ext); } catch (e) { continue; }
      t = t.replace(/^\s*bne\s+r\d+,\s*(?:0x0*434f4c|4411212),\s*L_\w+\s*\n\s*native\s+Strat_SetColor\(&r\d+\)[^\n]*\n?/gim, ''); // the editor's own tint is not the object's colour code
      if (/Strat_SetColor\b/.test(t)) res.set = true;
      if (/Strat_ClearColor\b/.test(t)) res.clear = true;
      for (const x of t.matchAll(/\bcall\s+L_([0-9a-fA-F]+)/g)) todo.push(parseInt(x[1], 16));
    }
  }
  m.set(className, res); return res;
}
const warnText = r => r.set && r.clear ? 'This object calls Strat_SetColor and Strat_ClearColor itself (hit flashes or its own colour), so your tint will likely be overridden or removed.'
  : r.set ? 'This object calls Strat_SetColor itself (hit flash or its own colour), so your tint may be overridden or flicker.'
  : r.clear ? 'This object calls Strat_ClearColor, which will remove your tint whenever that code runs.' : '';

// ---- inspector section, 3D preview and warning for the selected entity
function installTintUi({ Viewer, getProject, getWad, wadOf, rec, onChange = () => {} }) {
  const hex = v => '#' + v.map(x => x.toString(16).padStart(2, '0')).join('');
  const store = w => { const P = getProject(); P.tints = P.tints || {}; return P.tints[w] = P.tints[w] || { inst: {} }; };
  const projEntry = (w, i) => { const t = (getProject().tints || {})[w]; return t && t.inst ? t.inst[i] : undefined; }; // [r,g,b] | false | undefined
  const embedded = (w, i) => { const g = getWad(w); if (!g) return null; try { return embeddedTints(g.A, g.B).get(i) || null; } catch (e) { return null; } };
  // effective tint of an original instance: this project's edit wins, otherwise what an earlier build put in the wad
  const effective = (w, i) => { const p = projEntry(w, i); return p === undefined ? embedded(w, i) : (p || null); };
  const set = (w, i, rgb) => {
    const T = store(w);
    if (rgb) T.inst[i] = rgb;
    else if (embedded(w, i)) T.inst[i] = false; // already in the loaded wad: record "clear it"
    else delete T.inst[i];
    if (!Object.keys(T.inst).length) delete getProject().tints[w];
    onChange();
  };
  // the tint an entity has/will have: its own, or (for a copy made in this wad) its source's
  function tintInfo(q) {
    const P = getProject(), w = wadOf(q.L); if (!w) return null;
    let i = q.i;
    if (q.added) { const ad = ((P.wads[w] || {}).adds || [])[q.added - 1]; if (!ad || !ad.from || ad.from.w !== w) return null; i = ad.from.i; }
    const rgb = effective(w, i); return rgb ? { rgb, src: w + '#' + i } : null;
  }
  Viewer.tintInfo = tintInfo;

  // while the colour picker is dragged: recolour what is already drawn, no rebuild
  function live(src, rgb) {
    Viewer.root.traverse(o => { if (o.userData && o.userData.tintSrc === src && o.material && o.material.color) o.material.color.setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255); });
    Viewer.need = true;
  }

  function inject() {
    const S = Viewer.$('ed_sel'); if (!S || !Viewer.sel) return;
    const old = Viewer.$('ed_tint_box'); if (old) old.remove();
    const R = rec(Viewer.sel); if (!R) return;
    const L = Viewer.sel.L, w = wadOf(L); if (!w) return;
    const e = R.e, box = document.createElement('div'); box.id = 'ed_tint_box'; box.style.cssText = 'margin-top:5px;border-top:1px solid #333;padding-top:4px';
    const g = getWad(w); let warn = '';
    try { if (g) warn = warnText(colourCalls(g.A, g.B, e.n)); } catch (x) { console.error('colour call scan', x); }
    const wmsg = warn ? '<div id=tn_warn style="color:#fc6;margin-top:3px">⚠ ' + Viewer.esc(warn) + '</div>' : '<div id=tn_warn class=h style="margin-top:3px">No Strat_SetColor or Strat_ClearColor found in this object\'s own code.</div>';
    if (R.add) { box.innerHTML = '<span class=h>colour tint: a new copy keeps the tint of the instance it was copied from</span>' + wmsg; S.appendChild(box); return; }
    const t = effective(w, e.i), fromWad = !!t && projEntry(w, e.i) === undefined;
    box.innerHTML = '<label title="Adds a small tint check to this class in this level when you build. Instances that are not tinted behave exactly as before."><input type=checkbox id=tn_on' + (t ? ' checked' : '') + '> colour tint</label> '
      + '<input type=color id=tn_c value="' + hex(t || [255, 255, 255]) + '"' + (t ? '' : ' disabled') + '> <span id=tn_v class=h>' + (t ? t.join(', ') : '') + '</span>'
      + '<div class=h>applies to this ' + Viewer.esc(e.n) + ' only' + (fromWad ? '; this tint is already in the loaded .vol (made by the editor)' : '') + '. The 3D view shows an approximation; the real result is in the patched .vol.</div>' + wmsg;
    S.appendChild(box);
    const on = box.querySelector('#tn_on'), c = box.querySelector('#tn_c'), v = box.querySelector('#tn_v');
    const rgb = () => [1, 3, 5].map(k => parseInt(c.value.slice(k, k + 2), 16)), src = w + '#' + e.i;
    on.onchange = () => { c.disabled = !on.checked; if (on.checked) { const x = rgb(); v.textContent = x.join(', '); set(w, e.i, x); } else { v.textContent = ''; set(w, e.i, null); } Viewer.refresh(); };
    c.oninput = () => { const x = rgb(); v.textContent = x.join(', '); if (on.checked) { set(w, e.i, x); live(src, x); } };
    c.onchange = () => { const x = rgb(); v.textContent = x.join(', '); if (on.checked) set(w, e.i, x); };
  }
  return { inject };
}

export { planTints, applyTintData, installTintUi, colourCalls, embeddedTints, MAGIC };
