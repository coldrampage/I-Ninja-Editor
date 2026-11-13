// Prefab library, dependency checks, linked-child copying and cross-level moves.
// The coordinator injects live project/archive services and narrow entity-editor
// callbacks so this module does not depend on coordinator lexical scope.
export function installPrefabManager({
  Viewer, EC, getProject, wadOf, getWad, readWad, instances, fixups, siWad,
  volOf, avlOk, vbase, WS, r3, sndPlan, summary,
  getGround, getEntityRecord, ensureSourceArchives = async () => {}, updateEntity
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


  // ---- project-wide prefab favourites
  // A favourite is a reusable recipe pointing at a source game instance. It stores
  // root transform/register overrides separately from the source binary data; linked
  // children are reconstructed by the same link-aware copy path used by normal prefabs.
  function library() {
    const project = getProject();
    if (!Array.isArray(project.prefabs)) project.prefabs = [];
    // Project JSON can be hand-edited or imported from an older experimental
    // build. Keep malformed entries from breaking the editor's startup UI.
    const valid = project.prefabs.filter(f => f && typeof f === 'object'
      && f.from && typeof f.from.w === 'string'
      && Number.isInteger(Number(f.from.i)) && Number(f.from.i) >= 0);
    if (valid.length !== project.prefabs.length) {
      project.prefabs.splice(0, project.prefabs.length, ...valid);
    }
    return project.prefabs;
  }

  const safeText = (value, max) => String(value == null ? '' : value).trim().slice(0, max);
  const escapeHtml = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);

  function currentFavorite() {
    const id = Viewer.$('ed_fav_list').value;
    return library().find(f => String(f.id) === String(id)) || null;
  }

  function renderFavorites(keepSelection = true) {
    const list = Viewer.$('ed_fav_list');
    if (!list) return;
    const previous = keepSelection ? String(list.value || '') : '';
    const items = library();
    list.innerHTML = items.map(f => {
      const category = f.category ? '[' + f.category + '] ' : '';
      const linked = f.includeLinked && f.linkedCount ? ' +' + f.linkedCount : '';
      const label = category + (f.name || f.sourceName || 'Unnamed prefab')
        + ' — ' + (f.sourceName || f.from.w + '#' + f.from.i) + linked;
      return '<option value="' + escapeHtml(f.id) + '">' + escapeHtml(label) + '</option>';
    }).join('');
    if (items.some(f => String(f.id) === previous)) list.value = previous;
    Viewer.$('ed_fav_count').textContent = '(' + items.length + ')';
    showFavorite();
  }

  function showFavorite(message) {
    const info = Viewer.$('ed_fav_info');
    if (!info) return;
    const f = currentFavorite();
    if (!f) {
      info.textContent = message || (library().length
        ? 'Select a favourite to see its source and placement details.'
        : 'No favourites saved yet. Select an entity and save it here.');
      return;
    }
    const src = srcEnt({ from: f.from });
    const sourceText = src
      ? src.n + ' · ' + f.from.w + ' #' + f.from.i
      : (f.sourceName || 'Unknown class') + ' · ' + f.from.w + ' #' + f.from.i + ' (source not loaded)';
    const graphCount = Array.isArray(f.nodes) && f.nodes.length ? f.nodes.length - 1 : (f.linkedCount || 0);
    const linkText = f.includeLinked
      ? 'Linked children: ' + graphCount + ' (per-child registers and internal links saved)'
      : 'Linked children: not included';
    info.textContent = (message ? message + '\n' : '')
      + sourceText + '\n' + (f.category ? 'Category: ' + f.category + '\n' : '')
      + linkText
      + (f.note ? '\n' + f.note : '');
  }

  function nextFavoriteId() {
    return library().reduce((max, f) => Math.max(max, Number(f.id) || 0), 0) + 1;
  }

  function selectedRecipe() {
    const R = getEntityRecord();
    if (!R || !R.e) throw 'select an entity in the 3D view first';
    const H = R.add || R.m || {};
    const from = R.add
      ? { w: R.add.from.w, i: +R.add.from.i }
      : { w: R.w, i: +R.e.i };
    const source = srcEnt({ from });
    if (!source) throw 'the original source instance could not be found';
    const sourceWad = getWad(from.w);
    if (!sourceWad) throw 'load the source volume containing ' + from.w;
    const linkedCount = Math.max(0, linkTree(from.w, from.i).length - 1);
    const hasCustomLinks = !!(H.lk && H.lk.length);
    return {
      from, source, sourceWad, linkedCount, hasCustomLinks, record: R,
      dy: Number(H.dy) || 0, dp: Number(H.dp) || 0, dr: Number(H.dr) || 0,
      regs: { ...(H.regs || {}) }
    };
  }

  function saveFavorite() {
    try {
      const recipe = selectedRecipe();
      const name = safeText(Viewer.$('ed_fav_name').value, 80)
        || recipe.source.n + ' (' + lvOf(recipe.from.w) + ')';
      const category = safeText(Viewer.$('ed_fav_category').value, 32);
      const includeLinked = !!Viewer.$('ed_fav_links').checked;
      const graph = captureFavoriteGraph(recipe, includeLinked);
      const fps = {};
      for (const node of graph.nodes) {
        if (fps[node.from.w]) continue;
        const g = getWad(node.from.w);
        if (!g) throw 'load the source volume containing ' + node.from.w;
        fps[node.from.w] = typeof EC.fnv === 'function'
          ? { A: EC.fnv(g.A), B: EC.fnv(g.B) } : null;
      }
      const fp = fps[recipe.from.w] || (typeof EC.fnv === 'function'
        ? { A: EC.fnv(recipe.sourceWad.A), B: EC.fnv(recipe.sourceWad.B) } : null);
      const nodes = graph.nodes.map(n => ({
        from: { ...n.from }, vol: n.vol, offset: n.offset.slice(),
        dy: n.dy, dp: n.dp, dr: n.dr, regs: { ...n.regs },
        links: n.links.map(x => x.slice())
      }));
      const favorite = {
        id: nextFavoriteId(), name, category,
        sourceName: recipe.source.n,
        from: recipe.from,
        vol: volOf(recipe.from.w) || nodes[0]?.vol || null,
        includeLinked,
        linkedCount: includeLinked ? Math.max(0, nodes.length - 1) : 0,
        dy: recipe.dy, dp: recipe.dp, dr: recipe.dr,
        regs: recipe.regs,
        fp, fps, nodes,
        note: graph.truncated ? 'Linked group reached the 24-object safety limit; some linked objects may not be included.' : ''
      };
      library().push(favorite);
      Viewer.$('ed_fav_name').value = '';
      renderFavorites(false);
      Viewer.$('ed_fav_list').value = String(favorite.id);
      showFavorite('Saved favourite "' + name + '" with ' + Math.max(0, nodes.length - 1) + ' linked child setting(s).');
      summary();
    } catch (error) {
      Viewer.$('ed_fav_info').textContent = 'Could not save favourite: ' + error;
    }
  }

  function validateFavorite(raw, id) {
    if (!raw || typeof raw !== 'object' || !raw.from || typeof raw.from.w !== 'string'
      || !Number.isInteger(Number(raw.from.i)) || Number(raw.from.i) < 0) return null;
    const name = safeText(raw.name || raw.sourceName, 80);
    if (!name) return null;
    const cleanRegs = value => {
      const regs = {};
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        for (const [key, item] of Object.entries(value)) {
          if (/^\d+$/.test(key) && Number.isFinite(Number(item))) regs[key] = Number(item) >>> 0;
        }
      }
      return regs;
    };
    const fp = raw.fp && typeof raw.fp.A === 'string' && typeof raw.fp.B === 'string'
      ? { A: raw.fp.A, B: raw.fp.B } : null;
    const fps = {};
    if (raw.fps && typeof raw.fps === 'object' && !Array.isArray(raw.fps)) {
      for (const [wad, hash] of Object.entries(raw.fps)) {
        if (hash && typeof hash.A === 'string' && typeof hash.B === 'string') {
          fps[safeText(wad, 128)] = { A: hash.A, B: hash.B };
        }
      }
    }
    const nodes = [];
    if (Array.isArray(raw.nodes) && raw.nodes.length > 0 && raw.nodes.length <= 24) {
      for (const n of raw.nodes) {
        if (!n || !n.from || typeof n.from.w !== 'string'
          || !Number.isInteger(Number(n.from.i)) || Number(n.from.i) < 0) { nodes.length = 0; break; }
        const offset = Array.isArray(n.offset) && n.offset.length === 3 ? n.offset.map(Number) : [0, 0, 0];
        if (!offset.every(Number.isFinite)) { nodes.length = 0; break; }
        const links = [];
        if (Array.isArray(n.links)) for (const edge of n.links) {
          if (Array.isArray(edge) && edge.length >= 2
            && Number.isInteger(Number(edge[0])) && Number(edge[0]) >= 0
            && Number.isInteger(Number(edge[1])) && Number(edge[1]) >= 0
            && Number(edge[1]) < raw.nodes.length) links.push([Number(edge[0]), Number(edge[1])]);
        }
        nodes.push({
          from: { w: safeText(n.from.w, 128), i: Number(n.from.i) },
          vol: safeText(n.vol, 128) || null, offset,
          dy: Number.isFinite(Number(n.dy)) ? Number(n.dy) : 0,
          dp: Number.isFinite(Number(n.dp)) ? Number(n.dp) : 0,
          dr: Number.isFinite(Number(n.dr)) ? Number(n.dr) : 0,
          regs: cleanRegs(n.regs), links
        });
      }
    }
    // The first graph node must be the same source as the legacy root reference.
    if (nodes.length && (nodes[0].from.w !== raw.from.w || nodes[0].from.i !== Number(raw.from.i))) nodes.length = 0;
    return {
      id, name, category: safeText(raw.category, 32),
      sourceName: safeText(raw.sourceName || name, 80),
      from: { w: safeText(raw.from.w, 128), i: Number(raw.from.i) },
      vol: safeText(raw.vol, 128) || null,
      includeLinked: raw.includeLinked !== false,
      linkedCount: Math.max(0, Math.min(1000, Number(raw.linkedCount) || 0)),
      dy: Number.isFinite(Number(raw.dy)) ? Number(raw.dy) : 0,
      dp: Number.isFinite(Number(raw.dp)) ? Number(raw.dp) : 0,
      dr: Number.isFinite(Number(raw.dr)) ? Number(raw.dr) : 0,
      regs: cleanRegs(raw.regs), fp, fps, nodes,
      note: safeText(raw.note, 240)
    };
  }

  async function placeFavorite() {
    try {
      const favorite = currentFavorite();
      if (!favorite) throw 'select a saved favourite first';
      const targetId = Viewer.$('ed_lv').value, tw = wadOf(targetId);
      if (!targetId || !tw) throw 'select a loaded target level first';
      await ensureSourceArchives(favorite, { targetW: tw });
      const source = srcEnt({ from: favorite.from });
      if (!source) throw 'source instance ' + favorite.from.w + ' #' + favorite.from.i + ' could not be read';
      const checkFingerprint = (wadName, expected) => {
        if (!expected || typeof EC.fnv !== 'function') return;
        const g = getWad(wadName);
        if (!g) throw 'source volume containing ' + wadName + ' is not available';
        const actual = { A: EC.fnv(g.A), B: EC.fnv(g.B) };
        if (actual.A !== expected.A || actual.B !== expected.B) {
          throw 'source ' + wadName + ' does not match the game data this favourite was saved from';
        }
      };
      if (favorite.fp) checkFingerprint(favorite.from.w, favorite.fp);
      for (const [wadName, expected] of Object.entries(favorite.fps || {})) checkFingerprint(wadName, expected);
      const ground = getGround();
      const at = ground(innerWidth / 2, innerHeight / 2, Viewer.sel ? Viewer.sel.p[1] : 0)
        || Viewer.ggame(Viewer.camera.position.clone().addScaledVector(Viewer.fwd(), 25));
      const start = Array.isArray(favorite.nodes) && favorite.nodes.length
        ? pushFavoriteGraph(tw, favorite, at)
        : (() => {
          const sourceWad = getWad(favorite.from.w);
          if (!sourceWad) throw 'source volume containing ' + favorite.from.w + ' is not available';
          if (tw !== favorite.from.w) {
            const reason = ensureClass(tw, favorite.from.w, source.n);
            if (reason) throw 'cannot place ' + source.n + ': ' + reason;
            const bad = EC.prefabCheck(sourceWad.A, sourceWad.B, favorite.from.i);
            if (bad) throw 'source instance cannot be copied safely: ' + bad;
          }
          return pushAdds(tw, {
            from: { ...favorite.from }, p: at.map(r3),
            dy: favorite.dy || 0, dp: favorite.dp || 0, dr: favorite.dr || 0,
            regs: { ...(favorite.regs || {}) }
          }, { deep: favorite.includeLinked });
        })();
      Viewer.refresh();
      const level = Viewer.D.find(l => l.id === targetId);
      Viewer.sel = level && Viewer.all.find(o => o.L === targetId && o.i === level.nb + start) || null;
      Viewer.inspect(Viewer.sel);
      updateEntity();
      Viewer.need = true;
      showFavorite('Placed "' + favorite.name + '" in ' + targetId + '.');
    } catch (error) {
      Viewer.$('ed_fav_info').textContent = 'Could not place favourite: ' + error;
    }
  }

  function removeFavorite() {
    const favorite = currentFavorite();
    if (!favorite) return;
    const items = library(), index = items.indexOf(favorite);
    if (index >= 0) items.splice(index, 1);
    renderFavorites(false);
    summary();
  }

  function downloadLibrary() {
    const items = library();
    if (!items.length) {
      showFavorite('There are no favourites to export.');
      return;
    }
    const blob = new Blob([JSON.stringify({
      app: 'ininja-prefab-library', v: 2, prefabs: items
    }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ininja-prefabs.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    showFavorite('Exported ' + items.length + ' favourite(s).');
  }

  async function importLibrary(event) {
    const input = event.target, file = input.files && input.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (data.app !== 'ininja-prefab-library' || ![1, 2].includes(data.v) || !Array.isArray(data.prefabs)) {
        throw 'not an I-Ninja prefab library';
      }
      const items = library(), keys = new Set(items.map(f => f.name + '|' + f.from.w + '|' + f.from.i));
      let imported = 0, skipped = 0;
      for (const raw of data.prefabs) {
        const candidate = validateFavorite(raw, nextFavoriteId());
        if (!candidate) { skipped++; continue; }
        const key = candidate.name + '|' + candidate.from.w + '|' + candidate.from.i;
        if (keys.has(key)) { skipped++; continue; }
        candidate.id = nextFavoriteId();
        items.push(candidate);
        keys.add(key);
        imported++;
      }
      renderFavorites(false);
      summary();
      showFavorite('Imported ' + imported + ' favourite(s); skipped ' + skipped + ' invalid or duplicate entr' + (skipped === 1 ? 'y.' : 'ies.'));
    } catch (error) {
      showFavorite('Import failed: ' + error);
    }
    input.value = '';
  }

  Viewer.$('ed_fav_save').onclick = saveFavorite;
  Viewer.$('ed_fav_place').onclick = placeFavorite;
  Viewer.$('ed_fav_delete').onclick = removeFavorite;
  Viewer.$('ed_fav_export').onclick = downloadLibrary;
  Viewer.$('ed_fav_import').onclick = () => Viewer.$('ed_fav_file').click();
  Viewer.$('ed_fav_file').onchange = importLibrary;
  Viewer.$('ed_fav_list').onfocus = () => renderFavorites();
  Viewer.$('ed_fav_list').onchange = () => showFavorite();
  renderFavorites();

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

  // Capture the live linked prefab, not just the source's original link tree.
  // Register changes and link retargets on original children and copied children
  // are stored per node, with links expressed as indices within this portable graph.
  function captureFavoriteGraph(recipe, includeLinked) {
    const project = getProject(), nodes = [], byKey = new Map(), queue = [];
    let truncated = false;
    const rootRecord = recipe.record, rootPosition = rootRecord.e.p.slice();
    const sourceWadOf = w => volOf(w) || String(w).split('-')[0] + '.vol';
    const addNode = (key, from, position, H, kind, ownerW) => {
      if (byKey.has(key)) return byKey.get(key);
      if (nodes.length >= 24) { truncated = true; return -1; }
      const idx = nodes.length;
      byKey.set(key, idx);
      nodes.push({
        from: { w: from.w, i: +from.i }, vol: sourceWadOf(from.w),
        offset: position.map((v, k) => r3(v - rootPosition[k])),
        dy: Number(H.dy) || 0, dp: Number(H.dp) || 0, dr: Number(H.dr) || 0,
        regs: { ...(H.regs || {}) }, links: []
      });
      queue.push({ idx, kind, ownerW, from: { w: from.w, i: +from.i }, H });
      return idx;
    };
    const addOriginal = (w, i, override) => {
      const key = 'o|' + w + '#' + i;
      if (byKey.has(key)) return byKey.get(key);
      const src = srcEnt({ from: { w, i } });
      if (!src) return -1;
      const H = override || (((project.wads || {})[w] || {}).mods || {})[i] || {};
      const d = H.d || [0, 0, 0], position = src.p.map((v, k) => v + (Number(d[k]) || 0));
      return addNode(key, { w, i }, position, H, 'original', w);
    };
    const addAdded = (ownerW, a, index) => {
      const key = 'a|' + ownerW + '#' + (a.id === undefined ? index : a.id);
      if (byKey.has(key)) return byKey.get(key);
      const src = srcEnt(a);
      if (!src) return -1;
      return addNode(key, a.from, a.p.slice(), a, 'added', ownerW);
    };
    const findAdded = (w, id) => {
      const adds = (((project.wads || {})[w] || {}).adds || []);
      const index = adds.findIndex(a => a.id !== undefined && String(a.id) === String(id));
      return index < 0 ? null : { a: adds[index], index };
    };

    const rootIndex = rootRecord.add
      ? addAdded(rootRecord.w, rootRecord.add, rootRecord.e.added - 1)
      : addOriginal(recipe.from.w, recipe.from.i, rootRecord.m);
    if (rootIndex < 0) throw 'could not capture the selected prefab root';
    if (!includeLinked) return { nodes: [nodes[rootIndex]], truncated: false };

    for (let q = 0; q < queue.length; q++) {
      const item = queue[q], L = srcLinks(item.from.w);
      if (!L) continue;
      const sourceIndex = item.from.i, ip = L.U(L.ins + sourceIndex * 0x3c + 0x2c);
      for (const [owner, rg] of L.rows) {
        if (owner !== sourceIndex) continue;
        let child = -1;
        const customLink = (item.H.lk || []).find(edge => +edge[0] === rg);
        if (customLink) {
          const found = findAdded(item.ownerW || item.from.w, customLink[1]);
          if (found) child = addAdded(item.ownerW || item.from.w, found.a, found.index);
        } else {
          let target;
          if (item.H.regs && item.H.regs[rg] !== undefined) target = Number(item.H.regs[rg]) >>> 0;
          else if (item.kind === 'added' && item.ownerW && item.ownerW !== item.from.w) {
            // A cross-level copy has no valid inherited instance links unless the
            // user explicitly reconnected them in the destination level.
            continue;
          } else target = L.U(ip + 4 * rg);
          const targetW = item.kind === 'added' ? (item.ownerW || item.from.w) : item.from.w;
          const targetL = targetW === item.from.w ? L : srcLinks(targetW);
          if (targetL && target < targetL.nin) child = addOriginal(targetW, target);
        }
        if (child >= 0) nodes[item.idx].links.push([rg, child]);
      }
    }
    return { nodes, truncated };
  }

  function pushFavoriteGraph(tw, favorite, at) {
    const nodes = favorite.nodes, P = WS(tw), base = P.adds.length;
    if (!Array.isArray(nodes) || !nodes.length || nodes.length > 24) throw 'invalid favourite linked-object graph';
    // Validate all source classes and dependencies before adding any prefab
    // instances. Roll back dependency entries if a later child is not copyable.
    const oldClassCount = P.classes.length;
    try {
      nodes.forEach(node => {
        const src = srcEnt({ from: node.from }), g = getWad(node.from.w);
        if (!src || !g) throw 'source instance ' + node.from.w + ' #' + node.from.i + ' is unavailable';
        if (tw !== node.from.w) {
          const reason = ensureClass(tw, node.from.w, src.n);
          if (reason) throw 'cannot place child ' + src.n + ': ' + reason;
          const bad = EC.prefabCheck(g.A, g.B, node.from.i);
          if (bad) throw 'child ' + src.n + ' cannot be copied safely: ' + bad;
        }
      });
    } catch (error) {
      P.classes.splice(oldClassCount);
      throw error;
    }
    let id = addMaxId();
    const recs = nodes.map((node, i) => ({
      from: { ...node.from },
      p: at.map((v, k) => r3(v + (node.offset[k] || 0))),
      dy: node.dy || 0, dp: node.dp || 0, dr: node.dr || 0,
      regs: { ...(node.regs || {}) }, id: ++id, lk: []
    }));
    nodes.forEach((node, i) => {
      for (const edge of node.links || []) {
        const rg = +edge[0], target = +edge[1];
        if (!Number.isInteger(rg) || rg < 0 || !Number.isInteger(target) || target < 0 || target >= recs.length) continue;
        recs[i].lk.push([rg, recs[target].id]);
      }
    });
    P.adds.push(...recs);
    Viewer.$('ed_sum').textContent = 'placed favourite graph: ' + recs.length + ' linked object(s)';
    return base;
  }

  const addMaxId = () => Math.max(0, ...Object.values(getProject().wads || {})
    .flatMap(P => (P.adds || []).map(x => x.id || 0)));

  // Add one prefab, or include the recursively linked objects as independent
  // project additions and rewire every internal link between those copies.
  function pushAdds(tw, a, options = {}) {
    const P = WS(tw), base = P.adds.length;
    const deep = options.deep === undefined
      ? !!(Viewer.$('ed_deep') && Viewer.$('ed_deep').checked)
      : !!options.deep;
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
    captureFavoriteGraph, pushFavoriteGraph,
    fillPrefabs, showRep, renderFavorites, saveFavorite, placeFavorite
  };
}
