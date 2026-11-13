import { installTriggerEditor } from './trigger-editor.js?v=step16-cylinder-resize';
import { installPathEditor } from './path-editor.js?v=step21-sneaksentinel-runtime-companions';
// Entity inspector, transforms, register editing, link reassignment and entity copy/paste.
// All application state and cross-feature operations are injected by the coordinator.
export function installEntityEditor({
  Viewer, EC, getProject, wadOf, getWad, WS, base, put, unzero, srcEnt,
  addMaxId, ensureClass, pushAdds, stripLinkRegs, summary, rmList, r3, setTriggerOverlayRender = () => {}, setPathOverlayRender = () => {}
}) {
  let clip = null;
  let grab = false;
  let mouse = { x: 0, y: 0 };
  let linkPick = null;
  let regOpen = false;

  const ent = q => {
    const lv = Viewer.D.find(l => l.id === q.L);
    return lv && lv.ents.find(e => e.i === q.i);
  };

  // The editable record is either a project modification of an original entity
  // or a project-added instance copied from a source level.
  function rec(q) {
    const e = ent(q), w = wadOf(q.L);
    if (!e || !w) return null;
    const P = WS(w);
    if (e.added) return { e, w, add: P.adds[e.added - 1] };
    const m = P.mods[e.i] || (P.mods[e.i] = { d: [0, 0, 0], dy: 0, dp: 0, dr: 0, regs: {} });
    return { e, w, m };
  }

  function redo(R) {
    const PRJ = getProject();
    if (R.add) {
      const s = srcEnt(R.add), B = base(s);
      put(R.e, {
        d: R.add.p.map((v, j) => v - B.p[j]),
        dy: R.add.dy || 0, dp: R.add.dp || 0, dr: R.add.dr || 0,
        regs: R.add.regs, trigger: R.add.trigger, path: R.add.path, pathMap: R.add.pathMap
      });
    } else {
      put(R.e, R.m);
      if (!unzero(R.m)) delete PRJ.wads[R.w].mods[R.e.i];
    }
    const q = Viewer.all.find(o => o.L === Viewer.sel.L && o.i === R.e.i);
    Object.assign(q, {
      p: R.e.p, b: R.e.b, poly: R.e.poly, path: R.e.path, shape: R.e.shape, pathbox: R.e.pathbox, xzOnly: R.e.xzOnly,
      r: R.e.r, q: R.e.q, params: R.e.params
    });
    Viewer.sel = q;
    Viewer.buildEnts();
    Viewer.need = true;
    update();
  }

  function setPos(R, p) {
    if (R.add) R.add.p = p.map(r3);
    else R.m.d = p.map((v, k) => r3(v - base(R.e).p[k]));
    redo(R);
  }
  function setYaw(R, deg) {
    const dy = r3((deg / 360 * 4096) - (R.add ? base(srcEnt(R.add)).r : base(R.e).r));
    if (R.add) R.add.dy = dy;
    else R.m.dy = dy;
    redo(R);
  }
  function setTilt(R, key, deg) {
    const v = r3(deg / 360 * 4096);
    if (R.add) R.add[key] = v;
    else R.m[key] = v;
    redo(R);
  }
  function setReg(R, k, v) {
    (R.add || R.m).regs[k] = v >>> 0;
    redo(R);
  }
  function setTrigger(R, trigger) {
    const H = R.add || R.m;
    if (trigger) H.trigger = { ty: trigger.ty, box: trigger.box.slice(), poly: trigger.poly ? trigger.poly.slice() : null };
    else delete H.trigger;
    redo(R);
  }
  function setPath(R, path, pathMap = null) {
    const H = R.add || R.m;
    if (path) {
      H.path = path.map(node => node.map((v, k) => r3(v - R.e.p[k])));
      if (Array.isArray(pathMap)) H.pathMap = pathMap.slice();
      else delete H.pathMap;
    } else { delete H.path; delete H.pathMap; }
    redo(R);
  }
  const triggerEditor = installTriggerEditor({
    Viewer, setOverlayRender: setTriggerOverlayRender,
    commit: (q, trigger) => { const R = rec(q); if (R) setTrigger(R, trigger); }
  });
  const pathEditor = installPathEditor({
    Viewer, setOverlayRender: setPathOverlayRender,
    commit: (q, path, pathMap) => { const R = rec(q); if (R) setPath(R, path, pathMap); }
  });

  const nudge = (dx, dy, dz, dyaw) => {
    if (!Viewer.sel) return;
    const R = rec(Viewer.sel);
    if (!R) return;
    const p = R.e.p;
    setPos(R, [p[0] + dx, p[1] + dy, p[2] + dz]);
    if (dyaw) setYaw(R, (R.e.r / 4096 * 360 + dyaw + 360) % 360);
  };

  function update() {
    summary();
    rmList();
    const S = Viewer.$('ed_sel'), R = Viewer.sel && rec(Viewer.sel), SI = Viewer.sel && Viewer.scr(Viewer.sel);
    const lv = Viewer.$('ed_lv'), cur = lv.value;
    lv.innerHTML = Viewer.D.filter(l => wadOf(l.id)).map(l => '<option>' + l.id + '</option>').join('');
    if (cur) lv.value = cur;
    else if (Viewer.sel && wadOf(Viewer.sel.L)) lv.value = Viewer.sel.L;
    if (!R) {
      S.innerHTML = '<span class=h>click an entity to edit it</span>';
      triggerEditor.render(S, null, null);
      pathEditor.render(S, null, null);
      return;
    }
    const e = R.e, f = (id, v, st) => '<input type=number id=' + id + ' value="' + v + '" step=' + st + ' style="width:62px">';
    S.innerHTML = '<b style="color:' + Viewer.col(e.n) + '">' + Viewer.esc(e.n) + '</b> <span class=h>' + Viewer.sel.L + ' #' + e.i + (e.added ? ' (new, copy of #' + R.add.from.i + ')' : '') + '</span><br>X ' + f('ed_x', e.p[0], .5) + ' Y ' + f('ed_y', e.p[1], .5) + ' Z ' + f('ed_z', e.p[2], .5) + '<br>yaw ' + f('ed_w', +(e.r / 4096 * 360).toFixed(1), 5) + '&deg;<br>pitch ' + f('ed_pt', +(((R.add || R.m).dp || 0) / 4096 * 360).toFixed(1), 5) + '&deg; roll ' + f('ed_rl', +(((R.add || R.m).dr || 0) / 4096 * 360).toFixed(1), 5) + '&deg; <span class=h>(change from original)</span><br>step <input type=number id=ed_st value=' + (S.dataset.st || 1) + ' style="width:48px"><br>'
      + ['-X', '+X', '-Y', '+Y', '-Z', '+Z'].map(t => '<button data-n="' + t + '">' + t + '</button>').join('') + ' <button data-n="L">&#8634;15</button><button data-n="R">&#8635;15</button><br><button id=ed_cp>copy</button> <button id=ed_ps>paste</button> ' + '<button id=ed_del>' + (e.added ? 'delete' : 'remove') + '</button>'
      + '<div class=h>hold G + move mouse to drag on the ground plane; Ctrl+C / Ctrl+V copy and paste at the cursor</div>'
      + (e.params.some(p => !p.s) ? '<details' + (regOpen || linkPick ? ' open' : '') + '><summary>registers</summary>' + e.params.map((p, k) => {
        const lq = !p.s && SI && SI.l.find(a => a[0] == k);
        if (lq) {
          const H = R.add || R.m, ov = (H.lk || []).some(l => l[0] == k) || H.regs[k] !== undefined;
          const on = linkPick && linkPick.L === Viewer.sel.L && linkPick.i === e.i && linkPick.k == k;
          return '<div>r' + k + ' <span class=h>' + Viewer.esc(Viewer.regTxt(Viewer.sel, SI, k)) + '</span> <button data-lk=' + k + (on ? ' style="background:#fa0"' : '') + '>' + (on ? 'click target...' : 'link...') + '</button>' + (ov ? ' <button data-lkr=' + k + ' title="back to what the copied/original object had">reset</button>' : '') + '</div>';
        }
        return '<div>r' + k + ' ' + (p.s ? '<span class=h>"' + Viewer.esc(p.s) + '"</span>' : '<input type=number id=ed_r' + k + ' data-k=' + k + ' value=' + (p.v >>> 0) + ' style="width:100px">') + '</div>';
      }).join('') + '<div class=h>raw 32-bit values (floats are stored as their bit pattern). A register that links to another object has a link... button: press it, then click the object to link to (same level; Esc cancels).</div></details>' : '');

    triggerEditor.render(S, Viewer.sel, R);
    pathEditor.render(S, Viewer.sel, R);
    const g = id => +Viewer.$(id).value;
    for (const id of ['ed_x', 'ed_y', 'ed_z']) Viewer.$(id).onchange = () => setPos(R, [g('ed_x'), g('ed_y'), g('ed_z')]);
    Viewer.$('ed_w').onchange = () => setYaw(R, g('ed_w'));
    Viewer.$('ed_pt').onchange = () => setTilt(R, 'dp', g('ed_pt'));
    Viewer.$('ed_rl').onchange = () => setTilt(R, 'dr', g('ed_rl'));
    Viewer.$('ed_st').onchange = () => { S.dataset.st = g('ed_st'); };
    S.querySelectorAll('button[data-n]').forEach(b => b.onclick = () => {
      const s = +Viewer.$('ed_st').value || 1, t = b.dataset.n, ax = { X: 0, Y: 1, Z: 2 }[t[1]], v = [0, 0, 0];
      if (t == 'L') return nudge(0, 0, 0, -15);
      if (t == 'R') return nudge(0, 0, 0, 15);
      v[ax] = t[0] == '-' ? -s : s;
      nudge(...v, 0);
    });
    S.querySelectorAll('input[data-k]').forEach(i => i.onchange = () => setReg(R, +i.dataset.k, +i.value));
    S.querySelectorAll('button[data-lk]').forEach(b => b.onclick = () => startLink(+b.dataset.lk));
    S.querySelectorAll('button[data-lkr]').forEach(b => b.onclick = () => resetLink(R, +b.dataset.lkr));
    const dt = S.querySelector('details');
    if (dt) dt.ontoggle = () => { regOpen = dt.open; };
    Viewer.$('ed_cp').onclick = copy;
    Viewer.$('ed_ps').onclick = () => paste();
    const dl = Viewer.$('ed_del');
    if (dl) dl.onclick = () => {
      const P = WS(R.w);
      if (R.e.added) {
        const rid = R.add && R.add.id;
        P.adds.splice(R.e.added - 1, 1);
        if (rid !== undefined) for (const x of [...P.adds, ...Object.values(P.mods)]) if (x.lk) x.lk = x.lk.filter(l => l[1] !== rid);
      } else {
        const g = getWad(R.w), rf = g ? EC.referrers(g.A, g.B, R.e.i).filter(o => !P.del.includes(o)) : [];
        if (rf.length) {
          Viewer.$('ed_sum').textContent = 'cannot remove #' + R.e.i + ': ' + rf.map(o => '#' + o).join(', ') + ' link to it. Remove or change those first.';
          return;
        }
        P.del.push(R.e.i);
        delete P.mods[R.e.i];
      }
      Viewer.sel = null;
      Viewer.inspect(null);
      Viewer.refresh();
    };
  }

  // ---- manual link reassignment
  function startLink(k) {
    const R = Viewer.sel && rec(Viewer.sel);
    if (!R) return;
    linkPick = { L: Viewer.sel.L, i: R.e.i, k };
    Viewer.cv.style.cursor = 'crosshair';
    update();
    Viewer.$('ed_sum').textContent = 'r' + k + ' of ' + R.e.n + ' #' + R.e.i + ': click the object to link to (same level, Esc cancels)';
  }
  function endPick(msg) {
    linkPick = null;
    Viewer.cv.style.cursor = '';
    update();
    if (msg) Viewer.$('ed_sum').textContent = msg;
  }
  function finishLink(q) {
    const lp = linkPick;
    if (!lp) return;
    if (q.L !== lp.L) {
      Viewer.$('ed_sum').textContent = 'the target has to be in the same level (' + lp.L + '): click again, or Esc to cancel';
      return;
    }
    const src = Viewer.all.find(o => o.L === lp.L && o.i === lp.i), R = src && rec(src);
    if (!R) { endPick(); return; }
    const H = R.add || R.m, te = ent(q);
    H.lk = (H.lk || []).filter(l => l[0] !== lp.k);
    if (te && te.added) {
      const T = WS(wadOf(q.L)).adds[te.added - 1];
      if (T.id === undefined) T.id = addMaxId() + 1;
      H.lk.push([lp.k, T.id]);
      delete H.regs[lp.k];
    } else H.regs[lp.k] = q.i >>> 0;
    const nm = q.n;
    linkPick = null;
    Viewer.cv.style.cursor = '';
    afterLink(lp.L, R.e.i);
    Viewer.$('ed_sum').textContent = 'r' + lp.k + ' of ' + R.e.n + ' #' + R.e.i + ' now links to #' + q.i + ' ' + nm;
  }
  function resetLink(R, k) {
    const H = R.add || R.m;
    H.lk = (H.lk || []).filter(l => l[0] !== k);
    delete H.regs[k];
    afterLink(Viewer.sel.L, R.e.i);
  }
  function afterLink(L, i) {
    Viewer.refresh();
    Viewer.sel = Viewer.all.find(o => o.L === L && o.i === i) || null;
    Viewer.inspect(Viewer.sel);
    update();
    Viewer.need = true;
  }

  const previousMouseUp = globalThis.onmouseup;
  globalThis.onmouseup = e => {
    if (linkPick && Viewer.mdown && Viewer.mdown.b == 0 && Math.hypot(e.clientX - Viewer.mdown.x, e.clientY - Viewer.mdown.y) < 4 && e.target === Viewer.cv) {
      const q = Viewer.nearest(e.clientX, e.clientY);
      Viewer.mdown = null;
      Viewer.drag = null;
      if (q) finishLink(q);
      return;
    }
    if (typeof previousMouseUp === 'function') previousMouseUp(e);
  };
  globalThis.addEventListener('keydown', e => { if (e.code === 'Escape' && linkPick) endPick('link pick cancelled'); });

  function copy() {
    if (!Viewer.sel) return;
    const R = rec(Viewer.sel);
    if (!R) return;
    const H = R.add || R.m;
    clip = R.add
      ? { from: { ...R.add.from }, dy: R.add.dy || 0, dp: R.add.dp || 0, dr: R.add.dr || 0, regs: { ...R.add.regs }, trigger: R.add.trigger && { ty: R.add.trigger.ty, box: R.add.trigger.box.slice(), poly: R.add.trigger.poly && R.add.trigger.poly.slice() }, path: R.add.path && R.add.path.map(n => n.slice()), pathMap: R.add.pathMap && R.add.pathMap.slice() }
      : { from: { w: R.w, i: R.e.i }, dy: R.m.dy || 0, dp: R.m.dp || 0, dr: R.m.dr || 0, regs: { ...R.m.regs }, trigger: R.m.trigger && { ty: R.m.trigger.ty, box: R.m.trigger.box.slice(), poly: R.m.trigger.poly && R.m.trigger.poly.slice() }, path: R.m.path && R.m.path.map(n => n.slice()), pathMap: R.m.pathMap && R.m.pathMap.slice() };
    clip.lk = (H.lk || []).map(l => l.slice());
    clip.at = R.w;
    Viewer.$('ed_sum').textContent = 'copied ' + R.e.n;
  }
  function ground(mx, my, y) {
    const v = new Viewer.V3(mx / globalThis.innerWidth * 2 - 1, -(my / globalThis.innerHeight) * 2 + 1, .5)
      .unproject(Viewer.camera).sub(Viewer.camera.position).normalize();
    if (Math.abs(v.y) < 1e-3) return null;
    const t = (y - Viewer.camera.position.y) / v.y;
    if (t < 0 || t > 5000) return null;
    return Viewer.ggame(Viewer.camera.position.clone().addScaledVector(v, t));
  }
  function paste(at) {
    if (!clip || !Viewer.sel) return;
    const w = wadOf(Viewer.sel.L);
    const p = at || (() => {
      const sp = Viewer.sel.p, g = ground(mouse.x, mouse.y, Viewer.sel.p[1]);
      return g || [sp[0] + 3, sp[1], sp[2] + 3];
    })();
    const a = { from: { ...clip.from }, p: p.map(r3), dy: clip.dy, dp: clip.dp || 0, dr: clip.dr || 0, regs: { ...clip.regs }, trigger: clip.trigger && { ty: clip.trigger.ty, box: clip.trigger.box.slice(), poly: clip.trigger.poly && clip.trigger.poly.slice() }, path: clip.path && clip.path.map(n => n.slice()), pathMap: clip.pathMap && clip.pathMap.slice() };
    if (clip.at === w && clip.lk && clip.lk.length) a.lk = clip.lk.map(l => l.slice());
    else stripLinkRegs(a);
    // Cross-level clones require the source class and its dependencies in the target level.
    try {
      const t = getWad(w), s = getWad(clip.from.w);
      if (clip.from.w.replace(/\.LCS$/i, '') !== w.replace(/\.LCS$/i, '')) {
        const n = srcEnt(a).n, why = ensureClass(w, clip.from.w, n);
        if (why) throw n + ' cannot be copied into ' + w + ': ' + why;
        const bad = EC.prefabCheck(s.A, s.B, a.from.i);
        if (bad) throw bad;
      }
    } catch (x) {
      Viewer.$('ed_sum').textContent = 'cannot paste: ' + x;
      return;
    }
    const pi = pushAdds(w, a);
    Viewer.refresh();
    const L = w.replace(/\.LCS$/i, ''), lv = Viewer.D.find(l => l.id === L);
    Viewer.sel = Viewer.all.find(o => o.L === L && o.i === lv.nb + pi);
    Viewer.inspect(Viewer.sel);
    update();
    Viewer.need = true;
  }

  globalThis.addEventListener('keydown', e => {
    const t = e.target && e.target.tagName;
    if (t === 'INPUT' || t === 'SELECT') return;
    if (e.code === 'KeyG') grab = true;
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyC') { copy(); e.preventDefault(); }
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyV') { paste(); e.preventDefault(); }
  });
  globalThis.addEventListener('keyup', e => { if (e.code === 'KeyG') grab = false; });
  Viewer.cv.addEventListener('mousemove', e => {
    mouse = { x: e.clientX, y: e.clientY };
    if (grab && Viewer.sel && !Viewer.drag) {
      const R = rec(Viewer.sel), g = R && ground(e.clientX, e.clientY, Viewer.sel.p[1]);
      if (g) setPos(R, [g[0], Viewer.sel.p[1], g[2]]);
    }
  });

  return {
    update,
    ent,
    rec,
    setPosition: (q, p) => { const R = rec(q); if (R) setPos(R, p); },
    setYaw: (q, deg) => { const R = rec(q); if (R) setYaw(R, deg); },
    setRegister: (q, k, v) => { const R = rec(q); if (R) setReg(R, k, v); },
    setTrigger: (q, trigger) => { const R = rec(q); if (R) setTrigger(R, trigger); },
    setPath: (q, path, pathMap) => { const R = rec(q); if (R) setPath(R, path, pathMap); },
    copy,
    paste,
    ground,
    cancelLinkPick: () => { if (linkPick) endPick('link pick cancelled'); }
  };
}
