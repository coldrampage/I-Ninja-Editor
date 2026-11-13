// Project lifecycle: project JSON loading/saving and patched VOL/AVL generation.
// All mutable editor state and format-specific helpers are supplied by the coordinator.
export function installProjectManager({
  Viewer, EC, IA,
  getProject, setProject,
  isVol, getWad, volOf, getVolName, loadedVols,
  buildScriptWadsFp, sndPlan, avlLoad, avlOk, vbase, getAvl,
  sourceClass, unzero, onProjectLoaded = () => {}
}) {
  const $ = id => Viewer.$(id);

  function normalizeProject(j) {
    j.models = j.models || {};
    j.scripts = j.scripts || {};
    j.prefabs = Array.isArray(j.prefabs) ? j.prefabs : [];
    j.wads = j.wads || {};
    for (const w in j.wads) {
      j.wads[w].mods = j.wads[w].mods || {};
      j.wads[w].adds = j.wads[w].adds || [];
    }
    return j;
  }

  // Open a project from the editor's project picker.
  $('ed_pf').onchange = async e => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      if (j.app !== 'ininja-editor') throw 'not an editor project';
      setProject(normalizeProject(j));
      onProjectLoaded();
      Viewer.refresh();
      $('ed_sum').textContent = 'project loaded: ' + f.name + ' (apply to levels you load later by loading them again)';
    } catch (x) {
      $('ed_sum').textContent = 'open failed: ' + x;
    }
    e.target.value = '';
  };

  // Also recognise editor project JSON when loaded through the viewer's normal file picker.
  const originalLoadJson = Viewer.loadJson;
  Viewer.loadJson = async f => {
    let j;
    try { j = JSON.parse(await f.text()); } catch (e) {}
    if (j && j.app === 'ininja-editor') {
      setProject(normalizeProject(j));
      onProjectLoaded();
      if (Viewer.D.length) Viewer.refresh();
      $('st').textContent = 'editor project loaded (' + f.name + '); load its levels to see the edits';
      return;
    }
    return originalLoadJson(f);
  };

  const dl = (parts, name, type) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(parts, {type}));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  };

  function clean() {
    const PRJ = getProject(), out = {};
    for (const w in PRJ.wads) {
      const P = PRJ.wads[w], mods = {};
      for (const k in P.mods) if (unzero(P.mods[k])) mods[k] = P.mods[k];
      const del = [...new Set(P.del || [])].sort((a,b) => a-b);
      const classes = (P.classes || []).filter(k => P.adds.some(a => a.from.w === k.from.w && sourceClass(a) === k.from.name));
      if (Object.keys(mods).length || P.adds.length || del.length) {
        out[w] = {vol: volOf(w) || P.vol, mods, adds: P.adds, del, classes, fp: P.fp};
      }
    }
    return out;
  }

  // Wads belonging to other volumes keep their stored fingerprint; only loaded wads are checked.
  function withFp() {
    const PRJ = getProject(), c = clean();
    for (const w in c) {
      const g = getWad(w);
      if (!g) continue;
      const old = PRJ.wads[w].fp, fp = {A: EC.fnv(g.A), B: EC.fnv(g.B)};
      if (old && (old.A !== fp.A || old.B !== fp.B)) throw w + ' does not match the base this project was made for';
      c[w].fp = fp;
      c[w].vol = volOf(w) || getVolName();
      PRJ.wads[w].fp = fp;
      PRJ.wads[w].vol = volOf(w) || getVolName();
    }
    return c;
  }

  const pending = c => [...new Set(Object.keys(c).filter(w => !getWad(w)).map(w => c[w].vol || w.split('-')[0] + '.vol'))];

  $('ed_save').onclick = () => {
    try {
      if (!isVol()) throw 'load a .vol first';
      const PRJ = getProject(), wads = withFp();
      const vv = {...PRJ.vols};
      for (const f of Viewer.files) if (f.vol) vv[f.vol] = f.buf.byteLength;
      PRJ.vols = vv;
      const scr = buildScriptWadsFp();
      dl([JSON.stringify({app:'ininja-editor', v:1, vols:PRJ.vols, models:PRJ.models || {}, prefabs:PRJ.prefabs || [], wads, scripts:scr}, null, 1)], 'ininja-project.json', 'application/json');
      $('ed_sum').textContent = 'project saved: ' + Object.keys(wads).length + ' level(s) with instance edits, ' + Object.keys(scr).length + ' with code edits, ' + (PRJ.prefabs || []).length + ' prefab favourite(s) (holds only your edits, no game data)';
    } catch (x) {
      $('ed_sum').textContent = 'save failed: ' + x;
    }
  };

  $('ed_patch').onclick = async () => {
    try {
      if (!isVol()) throw 'load the original .vol first';
      const wads = withFp(), sc = buildScriptWadsFp();
      const names = [...new Set([...Object.keys(wads), ...Object.keys(sc)])].filter(w => getWad(w));
      const pend = [...new Set([...pending(wads), ...Object.keys(sc).filter(w => !getWad(w)).map(w => sc[w].vol || w.split('-')[0] + '.vol')])];
      if (!names.length) throw 'the project has no edits for ' + loadedVols().join(', ') + (pend.length ? ' (it has edits for ' + pend.join(', ') + ': load that volume and build again)' : '');
      const byVol = {};
      for (const w of names) (byVol[volOf(w)] = byVol[volOf(w)] || []).push(w);
      const srcWad = n => getWad(n), healed = [], outs = [];
      let i = 0;
      for (const V of Object.keys(byVol)) {
        const rep = {}, plans = {};
        for (const w of byVol[V]) {
          $('ed_sum').textContent = 'patching ' + w + ' (' + ++i + '/' + names.length + ')...';
          await new Promise(r => setTimeout(r));
          const f = Viewer.files.find(x => x.name === w);
          const hdr = new Uint8Array(f.buf, f.off, new DataView(f.buf, f.off).getUint32(4, true) + 16).slice();
          const g = getWad(w);
          let A = g.A, B = g.B;
          if (sc[w]) {
            const bl = new Map(Object.entries(sc[w].blocks).map(([k,v]) => [+k,v]));
            const x = IA.relink(A, B, bl);
            const v = IA.verify(IA.wadCtx(A, B), x.A, x.B, x.info.relocs, new Set(bl.keys()));
            if (v.bad.length) throw w + ': code edit verification failed: ' + v.bad.slice(0,3).join('; ');
            A = x.A; B = x.B;
          }
          const sp = sndPlan(w);
          const r0 = wads[w] ? EC.patchLcs(A, B, wads[w], w, srcWad, {snd:sp}) : {A,B};
          const r = EC.healResDir(r0.A, r0.B);
          if (r.added.tex || r.added.mesh) healed.push(w + ' (+' + r.added.tex + ' tex, +' + r.added.mesh + ' mesh)');
          if (sp && sp.adds.length) {
            const dh = new DataView(hdr.buffer, hdr.byteOffset);
            dh.setUint32(0x78, sp.h78, true); dh.setUint32(0x7c, sp.h7c, true);
            plans[w] = sp;
          }
          rep[w] = EC.packWad(hdr, r.A, r.B);
        }
        // Rebuild copied sound PCA blocks, then lay this volume's AVL out again.
        let ap = null, avlOut = '';
        if (Object.keys(plans).length) {
          const need = new Set([V]);
          for (const w in plans) for (const a of plans[w].adds) need.add(volOf(a.w));
          for (const v of need) await avlLoad(v);
          const pn = n => n.replace(/\.LCS$/i, '.PCA');
          const pcaOf = n => {
            const a = getAvl(volOf(n)), e = a && a.list && a.list.find(x => x.name === pn(n));
            if (!e) throw 'no ' + pn(n) + ' in ' + (a ? a.name : vbase(volOf(n)) + '.avl');
            return new Uint8Array(a.buf, e.off, e.size);
          };
          const rep2 = {};
          for (const w in plans) rep2[pn(w)] = EC.buildPca(pcaOf(w), plans[w], sw => {
            const sf = Viewer.files.find(x => x.name === sw);
            return sf ? {pca:pcaOf(sw), h78:new DataView(sf.buf, sf.off).getUint32(0x78, true)} : null;
          });
          const A = getAvl(V);
          ap = EC.rebuildVol(A.buf, rep2);
          avlOut = A.name.replace(/\.avl$/i, '') + '.patched.avl';
        }
        const vf = Viewer.files.find(x => x.vol === V);
        outs.push({V, parts:EC.rebuildVol(vf.buf, rep), out:V.replace(/\.vol$/i, '') + '.patched.vol', ap, avlOut, A:ap && getAvl(V).name, n:byVol[V]});
      }
      // Space downloads so browsers do not drop multiple file downloads.
      let k = 0;
      for (const o of outs) {
        setTimeout(() => dl(o.parts, o.out, 'application/octet-stream'), 600*k++);
        if (o.ap) setTimeout(() => dl(o.ap, o.avlOut, 'application/octet-stream'), 600*k++);
      }
      $('ed_sum').textContent = 'built ' + outs.map(o => o.out + (o.ap ? ' + ' + o.avlOut : '')).join(', ') + ' (' + names.join(', ') + '). Back up your originals, then replace each with its patched file (rename it to the original name).' +
        (outs.some(o => o.ap) ? ' Sounds were copied, so a patched .avl was built for ' + outs.filter(o => o.ap).map(o => o.V).join(', ') + ': install it together with its .vol.' : '') +
        (healed.length ? ' Added missing entries to the level resource directory: ' + healed.join(', ') + '.' : '') +
        (pend.length ? ' Still to build: ' + pend.join(', ') + ' (load it, open the same project, build).' : '');
    } catch (x) {
      $('ed_sum').textContent = 'patch failed: ' + x;
      console.error(x);
    }
  };

  return { clean, withFp };
}
