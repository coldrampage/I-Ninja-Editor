// Prefab library, dependency checks, linked-child copying and cross-level moves.
// The coordinator injects live project/archive services and narrow entity-editor
// callbacks so this module does not depend on coordinator lexical scope.
export function installPrefabManager({
  Viewer, EC, getProject, wadOf, getWad, readWad, instances, fixups, siWad,
  volOf, avlOk, vbase, WS, r3, sndPlan, summary,
  getGround, getEntityRecord, updateEntity
}) {
  let SP = {}, PFI = {}, SCx = {}, PFR = {}, LKC = {}, pfFor = null;
  const lvOf = w => w.replace(/\.LCS$/i, '');

  // Any strat wad in a loaded volume can provide a prefab, whether or not its
  // level is currently open in the 3D view.
  function spLoad(w) {
    if (SP[w]) return SP[w];
    const f = Viewer.files.find(x => x.name === w);
    if (!f) return null;
    const [A, B] = readWad(f.buf, f), ents = instances(A, B), pick = {}, first = {};
    for (const e of ents) {
      if (first[e.n] === undefined) first[e.n] = e.i;
      if (pick[e.n] === undefined && !EC.prefabCheck(A, B, e.i)) pick[e.n] = e.i;
    }
    let rep = {};
    try { rep = EC.classReports(A, B); }
    catch (e) { console.error('class report failed for', w, e); }
    return SP[w] = {
      ents, pick, first, rep,
      cls: new Set(siWad(A, B).classes.map(c => c.name))
    };
  }

  function srcEnt(a) {
    const l = Viewer.D.find(x => x.id === lvOf(a.from.w));
    if (l) return (l.all0 || l.ents).find(e => e.i === a.from.i && !e.added);
    const s = spLoad(a.from.w);
    return s && s.ents[a.from.i];
  }
  const sourceClass = a => { const e = srcEnt(a); return e && e.n; };

  const srcCtx = w => SCx[w] || (SCx[w] = (() => {
    const g = getWad(w);
    return EC.SrcCtx(g.A, g.B);
  })());

  // Dry-run the actual class transplant so the UI can say whether a prefab
  // and its dependencies can be introduced into the target level.
  function tryClass(tw, w, name) {
    const k = tw + '|' + w + '|' + name;
    if (PFR[k]) return PFR[k];
    const tg = getWad(tw), tc = new Map(siWad(tg.A, tg.B).classes.map(c => [c.name, c.off]));
    try {
      const SS = srcCtx(w);
      SS.wadName = w;
      const r = EC.transplantClasses(tg.A, tg.B, SS, [name], {
        res: EC.resResolver(SS, srcCtx(tw)).hook,
        cls: n => tc.get(n), addRes: true, snd: sndPlan(tw)
      });
      return PFR[k] = { ok: true, classes: r.classes, bytes: r.A.length - tg.A.length };
    } catch (e) {
      return PFR[k] = { ok: false, why: String(e) };
    }
  }

  // Ensure the target project's class list contains the required dependency.
  function ensureClass(tw, w, name) {
    const t = getWad(tw);
    if (t.cls.has(name)) return null;
    const P = WS(tw);
    if (P.classes.some(k => k.from.name === name && k.from.w === w)) return null;
    const r = tryClass(tw, w, name);
    if (!r.ok) return r.why;
    P.classes.push({ from: { w, name } });
    return null;
  }

  function why(s, name, tcls, seen = new Set()) {
    if (tcls.has(name) || seen.has(name)) return [];
    seen.add(name);
    const r = s.rep[name];
    if (!r) return ['no dependency data'];
    const out = [...r.reasons];
    for (const c of r.classes) {
      if (tcls.has(c)) continue;
      const sub = why(s, c, tcls, seen);
      if (sub.length) out.push('needs class ' + c + ': ' + sub[0]);
    }
    return out;
  }

  function repText(s, name, tcls, w) {
    const r = s.rep[name];
    if (!r) return name + ': no dependency data';
    const k = Object.entries(r.kinds).filter(([t]) => t !== 'code').map(([t, n]) => n + ' ' + t).join(', ');
    const ws = why(s, name, tcls);
    return name + ' (' + lvOf(w) + '): ' + r.bytes + ' bytes of code. Pointers: ' + (k || 'none') + '.'
      + (r.classes.length ? ' Uses classes: ' + r.classes.map(c => c + (tcls.has(c) ? '' : ' (missing here)')).join(', ') + '.' : '')
      + (r.strs.length ? ' Strings: ' + r.strs.map(x => '"' + x + '"').join(', ') + '.' : '')
      + (tcls.has(name) ? ' This level already has the class.' : ws.length
        ? ' Cannot be placed: ' + ws.join('; ') + '.'
        : ' Select it to check whether it can be copied into this level.');
  }

  async function fillPrefabs(force) {
    const T = Viewer.$('ed_lv').value, tw = wadOf(T), cl = Viewer.$('ed_cl');
    if (!tw) { cl.innerHTML = ''; pfFor = null; return; }
    if (pfFor === T && !force && cl.options.length) return;
    pfFor = T;
    const ws = [tw, ...Viewer.files.map(f => f.name)
      .filter(n => /^\d+-\d+\.LCS$/i.test(n) && n !== tw)
      .sort((a, b) => a.localeCompare(b, 0, { numeric: true }))];
    let h = '', k = 0;
    const na = {};
    for (const w of ws) {
      if (!SP[w]) {
        Viewer.$('ed_sum').textContent = 'reading prefabs from ' + w + ' (' + ++k + '/' + ws.length + ')...';
        await new Promise(r => setTimeout(r));
      }
      const s = spLoad(w), t = SP[tw];
      if (!s) continue;
      const own = w === tw, src = own ? s.first : s.pick;
      const names = Object.keys(src).filter(n => t.cls.has(n)).sort();
      if (!own) for (const n of Object.keys(s.first)) {
        if (!t.cls.has(n) && !na[n]) na[n] = { w, i: s.first[n], s };
      }
      if (names.length) h += '<optgroup label="' + lvOf(w) + (own ? ' (this level)' : '') + '">'
        + names.map(n => {
          const v = w + '|' + src[n];
          PFI[v] = repText(s, n, t.cls, w);
          return '<option value="' + v + '">' + n + ' (#' + src[n] + ')</option>';
        }).join('') + '</optgroup>';
    }
    const nn = Object.keys(na).sort(), t = SP[tw];
    if (nn.length) h += '<optgroup label="class missing in this level (cannot place)">'
      + nn.map(n => {
        const v = '!' + na[n].w + '|' + na[n].i, ok = !why(na[n].s, n, t.cls).length;
        PFI[v] = repText(na[n].s, n, t.cls, na[n].w);
        return '<option value="' + v + '">' + n + ' (' + lvOf(na[n].w) + ')'
          + (ok ? (((na[n].s.rep[n] || { kinds: {} }).kinds.sound || 0)
            && !(avlOk(volOf(tw)) && avlOk(volOf(na[n].w)))
            ? ' - copyable (load the .avl for its sounds)' : ' - copyable') : ' - not copyable')
          + '</option>';
      }).join('') + '</optgroup>';
    if (pfFor === T) { cl.innerHTML = h; showRep(); }
    summary();
  }

  function showRep() {
    let r = Viewer.$('ed_rep');
    if (!r) {
      r = document.createElement('div');
      r.id = 'ed_rep'; r.className = 'h';
      r.style.cssText = 'margin-top:3px;max-height:110px;overflow:auto';
      Viewer.$('ed_cl').parentNode.after(r);
    }
    const v = Viewer.$('ed_cl').value;
    let t = PFI[v] || '';
    if (v && v[0] === '!') {
      const [w] = v.slice(1).split('|');
      const name = Viewer.$('ed_cl').selectedOptions[0].textContent.split(' (')[0];
      const tw = wadOf(Viewer.$('ed_lv').value);
      if (tw) {
        const x = tryClass(tw, w, name);
        t += x.ok
          ? '\nCheck: can be copied into ' + lvOf(tw) + ' (' + x.classes.join(', ') + ' ; +' + x.bytes + ' bytes). Press add to place one.'
          : '\nCheck: cannot be copied: ' + x.why + '.';
      }
    }
    r.style.whiteSpace = 'pre-wrap';
    r.textContent = t;
  }

  Viewer.$('ed_lv').onfocus = Viewer.$('ed_cl').onfocus = () => fillPrefabs();
  Viewer.$('ed_lv').onchange = () => fillPrefabs();
  Viewer.$('ed_cl').onchange = showRep;
  Viewer.$('ed_add').onclick = () => {
    const T = Viewer.$('ed_lv').value, v = Viewer.$('ed_cl').value;
    if (!T || !v) return;
    const miss = v[0] === '!', [w, i] = (miss ? v.slice(1) : v).split('|'), tw = wadOf(T);
    if (miss) {
      const name = Viewer.$('ed_cl').selectedOptions[0].textContent.split(' (')[0];
      const reason = ensureClass(tw, w, name);
      if (reason) { showRep(); Viewer.$('ed_sum').textContent = 'cannot add ' + name + ': ' + reason; return; }
    }
    const ground = getGround();
    const p = ground(innerWidth / 2, innerHeight / 2, Viewer.sel ? Viewer.sel.p[1] : 0)
      || Viewer.ggame(Viewer.camera.position.clone().addScaledVector(Viewer.fwd(), 25));
    const pi = pushAdds(tw, { from: { w, i: +i }, p: p.map(r3), dy: 0, regs: {} });
    Viewer.refresh();
    const lv = Viewer.D.find(l => l.id === T);
    Viewer.sel = Viewer.all.find(o => o.L === T && o.i === lv.nb + pi);
    Viewer.inspect(Viewer.sel);
    updateEntity();
    Viewer.need = true;
  };

  // Source link table cache: each pair is [owner instance, register index].
  function srcLinks(w) {
    if (LKC[w]) return LKC[w];
    const g = getWad(w);
    if (!g) return null;
    const imp = fixups(g.B), h = (imp[0x8000010e] || [])[0];
    if (h == null) return null;
    const d = new DataView(g.A.buffer, g.A.byteOffset, g.A.length), U = o => d.getUint32(o, true);
    const ins = U(h + 0x28), nin = d.getUint16(h + 0x30, true), lnk = U(h + 0x2c), nlk = d.getUint16(h + 0x32, true), rows = [];
    for (let i = 0; i < nlk; i++) rows.push([d.getUint16(lnk + 4 * i, true), d.getUint16(lnk + 4 * i + 2, true)]);
    return LKC[w] = { U, F: o => d.getFloat32(o, true), ins, nin, rows, imp };
  }

  function linkTree(w, i) {
    const L = srcLinks(w);
    if (!L) return [{ i, par: -1, reg: -1 }];
    const out = [{ i, par: -1, reg: -1 }], seen = new Set([i]);
    for (let n = 0; n < out.length && out.length < 24; n++) {
      const o = L.ins + out[n].i * 0x3c, ip = L.U(o + 0x2c);
      for (const [ow, rg] of L.rows) {
        if (ow !== out[n].i) continue;
        const c = L.U(ip + 4 * rg);
        if (c < L.nin && !seen.has(c)) { seen.add(c); out.push({ i: c, par: n, reg: rg }); }
      }
    }
    return out;
  }

  const addMaxId = () => Math.max(0, ...Object.values(getProject().wads || {})
    .flatMap(P => (P.adds || []).map(x => x.id || 0)));

  // Add one prefab, or include the recursively linked objects as independent
  // project additions and rewire every internal link between those copies.
  function pushAdds(tw, a) {
    const P = WS(tw), base = P.adds.length, deep = Viewer.$('ed_deep') && Viewer.$('ed_deep').checked;
    if (!deep) { P.adds.push(a); return base; }
    const tree = linkTree(a.from.w, a.from.i);
    if (tree.length < 2) { P.adds.push(a); return base; }
    const L = srcLinks(a.from.w);
    const pos = n => {
      const o = L.ins + tree[n].i * 0x3c;
      return [L.F(o + 0x10), L.F(o + 0x14), L.F(o + 0x18)];
    };
    const root = pos(0);
    let id = addMaxId();
    const recs = tree.map((t, n) => {
      const p = pos(n);
      return {
        from: { w: a.from.w, i: t.i },
        p: n ? a.p.map((v, k) => r3(v + p[k] - root[k])) : a.p,
        dy: n ? 0 : a.dy, dp: n ? 0 : (a.dp || 0), dr: n ? 0 : (a.dr || 0),
        regs: n ? {} : { ...a.regs }, id: ++id, lk: []
      };
    });
    const tIdx = new Map(tree.map((t, n) => [t.i, n]));
    tree.forEach((t, n) => {
      const ip = L.U(L.ins + t.i * 0x3c + 0x2c), seenR = new Set();
      for (const [ow, rg] of L.rows) {
        if (ow !== t.i || seenR.has(rg)) continue;
        const c = L.U(ip + 4 * rg), m = c < L.nin ? tIdx.get(c) : undefined;
        if (m === undefined) continue;
        seenR.add(rg);
        recs[n].lk.push([rg, recs[m].id]);
      }
    });
    const skipped = [];
    const keep = recs.map((r, n) => {
      if (!n || lvOf(r.from.w) === lvOf(tw)) return true;
      try {
        const nm = srcEnt(r).n, reason = ensureClass(tw, r.from.w, nm);
        if (reason) throw nm + ': ' + reason;
        const s = getWad(r.from.w), bad = EC.prefabCheck(s.A, s.B, r.from.i);
        if (bad) throw bad;
        return true;
      } catch (x) { skipped.push(String(x)); return false; }
    });
    const ids = new Set(recs.filter((r, n) => keep[n]).map(r => r.id));
    recs.forEach(r => { r.lk = r.lk.filter(l => ids.has(l[1])); });
    recs.forEach((r, n) => { if (keep[n]) P.adds.push(r); });
    Viewer.$('ed_sum').textContent = 'copied ' + recs.filter((r, n) => keep[n]).length + ' linked object(s)'
      + (skipped.length ? '; skipped: ' + skipped.join(' | ') : '');
    return base;
  }

  function stripLinkRegs(a) {
    const L = srcLinks(a.from.w);
    if (L) for (const [ow, rg] of L.rows) if (ow === a.from.i) delete a.regs[rg];
    a.lk = [];
  }

  // Attach the existing cross-level control to the current entity inspector.
  // Entity-editor calls this after it has re-rendered the inspector markup.
  function injectMoveControl() {
    const R = getEntityRecord(), S = Viewer.$('ed_sel');
    if (!R || !R.add || !S) return;
    S.insertAdjacentHTML('beforeend', '<div style="margin-top:3px"><span class=h>belongs to level</span> <select id=ed_relv>'
      + Viewer.D.filter(l => wadOf(l.id)).map(l => '<option' + (l.id === Viewer.sel.L ? ' selected' : '') + '>' + l.id + '</option>').join('')
      + '</select></div>');
    Viewer.$('ed_relv').onchange = ev => {
      const nw = wadOf(ev.target.value), old = R.w;
      if (!nw || nw === old) return;
      const P = WS(old), a0 = R.add, grp = new Set([a0]);
      if (a0.id !== undefined) {
        let ch = true;
        while (ch) {
          ch = false;
          for (const x of P.adds) {
            if (grp.has(x)) continue;
            if ([...grp].some(y => (y.lk || []).some(l => l[1] === x.id))
              || (x.lk || []).some(l => [...grp].some(y => y.id === l[1]))) {
              grp.add(x); ch = true;
            }
          }
        }
      }
      try {
        for (const a of grp) {
          if (lvOf(a.from.w) !== lvOf(nw)) {
            const nm = srcEnt(a).n, reason = ensureClass(nw, a.from.w, nm);
            if (reason) throw nm + ' cannot be copied into ' + nw + ': ' + reason;
            const s = getWad(a.from.w), bad = EC.prefabCheck(s.A, s.B, a.from.i);
            if (bad) throw bad;
          }
        }
      } catch (x) {
        Viewer.$('ed_sum').textContent = 'cannot move: ' + x;
        updateEntity();
        return;
      }
      P.adds = P.adds.filter(x => !grp.has(x));
      const N = WS(nw), first = N.adds.length;
      for (const a of grp) {
        const keep = a.lk || [];
        stripLinkRegs(a);
        a.lk = keep.filter(l => [...grp].some(y => y.id === l[1]));
        N.adds.push(a);
      }
      Viewer.refresh();
      const L = lvOf(nw), lv = Viewer.D.find(l => l.id === L);
      Viewer.sel = Viewer.all.find(o => o.L === L && o.i === lv.nb + first + [...grp].indexOf(a0));
      Viewer.inspect(Viewer.sel);
      updateEntity();
      Viewer.need = true;
      Viewer.$('ed_sum').textContent = 'moved ' + grp.size + ' object(s) to ' + nw;
    };
  }

  function resetCaches() {
    SP = {}; PFI = {}; SCx = {}; PFR = {}; LKC = {}; pfFor = null;
  }
  function invalidateChecks() { PFR = {}; }

  return {
    srcEnt, sourceClass, ensureClass, pushAdds, stripLinkRegs, addMaxId,
    injectMoveControl, resetCaches, invalidateChecks,
    fillPrefabs, showRep
  };
}
