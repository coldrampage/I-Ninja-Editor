// Project lifecycle: project JSON loading/saving and patched VOL/AVL generation.
// All mutable editor state and format-specific helpers are supplied by the coordinator.
import { applyTextureOps } from './texture-tools.js?v=step110-rotation-boundary-fix';
import { siWad } from './vol-core.js?v=step110-rotation-boundary-fix';
import { collisionWadSnapshot } from './collision-diagnostics.js?v=step110-rotation-boundary-fix';
import { planTints, applyTintData } from './class-tint.js';
export function installProjectManager({
  Viewer, EC, IA,
  getProject, setProject,
  isVol, getWad, volOf, getVolName, loadedVols,
  buildScriptWadsFp, sndPlan, avlLoad, avlOk, vbase, getAvl,
  sourceClass, unzero, onProjectLoaded = () => {}
}) {
  const $ = id => Viewer.$(id);
  // Build snapshots stay in memory for this editor session so the user can
  // compare None and Box outputs without uploading or installing Node.js.
  const collisionDiagnosticBuilds = new Map();

  function normalizeProject(j) {
    j.models = j.models || {};
    j.scripts = j.scripts || {};
    j.prefabs = Array.isArray(j.prefabs) ? j.prefabs : [];
    j.wads = j.wads || {};
    j.textures = j.textures || {};
    j.tints = j.tints || {};
    j.audioAssets = j.audioAssets || {};
    j.display = j.display || {};
    j.customModels = j.customModels && typeof j.customModels === 'object' ? j.customModels : {};
    for (const w in j.customModels) { const C = j.customModels[w] && typeof j.customModels[w] === 'object' ? j.customModels[w] : {}; C.assets = Array.isArray(C.assets) ? C.assets : []; C.instances = Array.isArray(C.instances) ? C.instances : []; j.customModels[w] = C; }
    for (const w in j.tints) j.tints[w].inst = j.tints[w].inst || {};
    for (const w in j.textures) j.textures[w].ops = Array.isArray(j.textures[w].ops) ? j.textures[w].ops : [];
    for (const w in j.wads) {
      j.wads[w].mods = j.wads[w].mods || {};
      j.wads[w].adds = j.wads[w].adds || [];
      j.wads[w].music = j.wads[w].music || {};
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

  function exportCollisionDiagnostics() {
    const targets=[...collisionDiagnosticBuilds.values()];
    if(!targets.length){$('ed_sum').textContent='No build diagnostics yet. Build a custom model with None or Box collision first.';return;}
    const report={tool:'I-Ninja Editor built-in collision diagnostics',version:1,createdUtc:new Date().toISOString(),
      instructions:'Build the same target LCS once with None collision and once with Box collision in this editor session, then export this report. It contains parsed metadata and instruction/resource summaries, not game-file contents.',targets};
    const stamp=new Date().toISOString().replace(/[:.]/g,'-');
    dl([JSON.stringify(report,null,2)],'ininja-collision-diagnostics-'+stamp+'.json','application/json');
    $('ed_sum').textContent='Downloaded collision diagnostics for '+targets.map(x=>x.wadName).join(', ')+'. Open the JSON file in a text editor and paste its contents here (or just the target/build sections if very long).';
  }
  function recordCollisionDiagnostics(wadName,volumeName,baseA,baseB,beforeA,beforeB,afterA,afterB,finalA,finalB,customRecord) {
    const record=customRecord||{assets:[],instances:[]};
    const modes=(record.instances||[]).map((inst,i)=>{
      const a=(record.assets||[]).find(x=>x.id===inst.assetId)||{};
      return {index:i,name:inst.name||a.name||'Custom model',asset:a.name||null,collision:String(inst.collisionType??a.collisionType??a.requestedCollisionType??'none').toLowerCase(),upwardTag:inst.collisionTopTag??a.collisionUpwardTagMode??a.collisionTopTag??'inherit',sideTag:inst.collisionSideTag??a.collisionSideTag??'slidey'};
    });
    const build={volumeName,wadName,createdUtc:new Date().toISOString(),modes,
      original:collisionWadSnapshot(EC,baseA,baseB,wadName,null,'original loaded WAD'),
      beforeCustomModels:collisionWadSnapshot(EC,beforeA,beforeB,wadName,null,'after other edits, before custom models'),
      afterCustomModels:collisionWadSnapshot(EC,afterA,afterB,wadName,record,'after custom-model writer',beforeB),
      finalAfterResourceDirectoryRepair:collisionWadSnapshot(EC,finalA,finalB,wadName,record,'final built LCS',beforeB)};
    const slot=collisionDiagnosticBuilds.get(wadName)||{wadName,builds:[]};
    slot.builds.push(build);if(slot.builds.length>6)slot.builds.splice(0,slot.builds.length-6);
    collisionDiagnosticBuilds.set(wadName,slot);
    const button=$('ed_collision_diag');if(button){button.disabled=false;button.title='Download '+[...collisionDiagnosticBuilds.values()].reduce((n,x)=>n+x.builds.length,0)+' recorded LCS build snapshot(s)';}
  }

  const collisionDiagButton=$('ed_collision_diag');
  if(collisionDiagButton){collisionDiagButton.onclick=exportCollisionDiagnostics;collisionDiagButton.disabled=true;}

  function clean() {
    const PRJ = getProject(), out = {};
    for (const w in PRJ.wads) {
      const P = PRJ.wads[w], mods = {};
      for (const k in P.mods) if (unzero(P.mods[k])) mods[k] = P.mods[k];
      const del = [...new Set(P.del || [])].sort((a,b) => a-b);
      const music = Object.fromEntries(Object.entries(P.music || {}).filter(([,id]) => !!id));
      const classes = (P.classes || []).filter(k => P.adds.some(a => a.from.w === k.from.w && sourceClass(a) === k.from.name));
      if (Object.keys(mods).length || P.adds.length || del.length || Object.keys(music).length) {
        out[w] = {vol: volOf(w) || P.vol, mods, adds: P.adds, del, classes, music, fp: P.fp};
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

  // Custom textures: {wad:{vol,fp,ops}}. Offsets refer to the base wad, so the fingerprint is checked when a loaded wad is built.
  function texturesFp() {
    const PRJ = getProject(), out = {};
    for (const w in PRJ.textures || {}) {
      const T = PRJ.textures[w];
      if (!T.ops || !T.ops.length) continue;
      const g = getWad(w);
      if (g) {
        const fp = {A: EC.fnv(g.A), B: EC.fnv(g.B)};
        if (T.fp && (T.fp.A !== fp.A || T.fp.B !== fp.B)) throw w + ' textures were made for a different base wad';
        T.fp = fp; T.vol = volOf(w) || T.vol || getVolName();
      }
      out[w] = {vol: T.vol, fp: T.fp, ops: T.ops};
    }
    return out;
  }

  // Colour tints: {wad:{vol,fp,inst:{index:[r,g,b]}}}; instance indices refer to the base wad, so the fingerprint is checked.
  function tintsFp() {
    const PRJ = getProject(), out = {};
    for (const w in PRJ.tints || {}) {
      const T = PRJ.tints[w];
      if (!T.inst || !Object.keys(T.inst).length) continue;
      const g = getWad(w);
      if (g) {
        const fp = {A: EC.fnv(g.A), B: EC.fnv(g.B)};
        if (T.fp && (T.fp.A !== fp.A || T.fp.B !== fp.B)) throw w + ' colour tints were made for a different base wad';
        T.fp = fp; T.vol = volOf(w) || T.vol || getVolName();
      }
      out[w] = {vol: T.vol, fp: T.fp, inst: T.inst};
    }
    return out;
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
      dl([JSON.stringify({app:'ininja-editor', v:1, vols:PRJ.vols, models:PRJ.models || {}, customModels:PRJ.customModels || {}, prefabs:PRJ.prefabs || [], audioAssets:PRJ.audioAssets || {}, wads, scripts:scr, textures:texturesFp(), tints:tintsFp(), display:PRJ.display || {}}, null, 1)], 'ininja-project.json', 'application/json');
      $('ed_sum').textContent = 'project saved: ' + Object.keys(wads).length + ' level(s) with instance edits, ' + Object.keys(scr).length + ' with code edits, ' + (PRJ.prefabs || []).length + ' prefab favourite(s), ' + Object.values(PRJ.customModels || {}).reduce((n,c)=>n+(c.assets||[]).length,0) + ' imported custom model asset(s) (holds only your edits, no game data)';
    } catch (x) {
      $('ed_sum').textContent = 'save failed: ' + x;
    }
  };

  $('ed_patch').onclick = async () => {
    try {
      if (!isVol()) throw 'load the original .vol first';
      const wads = withFp(), sc = buildScriptWadsFp(), tx = texturesFp(), tn = tintsFp();
      const customModelRecords = getProject().customModels || {};
      const customAssets = Object.values(customModelRecords).reduce((n,c)=>n+(c.assets||[]).length,0), customInstances = Object.values(customModelRecords).reduce((n,c)=>n+(c.instances||[]).length,0);
      const customModelWads = Object.keys(customModelRecords).filter(w => (customModelRecords[w].instances || []).length);
      const names = [...new Set([...Object.keys(wads), ...Object.keys(sc), ...Object.keys(tx), ...Object.keys(tn), ...customModelWads])].filter(w => getWad(w));
      const pend = [...new Set([...pending(wads), ...Object.keys(sc).filter(w => !getWad(w)).map(w => sc[w].vol || w.split('-')[0] + '.vol'), ...customModelWads.filter(w => !getWad(w)).map(w => w.split('-')[0] + '.vol')])];
      if (!names.length) throw 'the project has no game-data edits for ' + loadedVols().join(', ') + (customAssets || customInstances ? '. It contains ' + customAssets + ' imported custom model asset(s) and ' + customInstances + ' placed custom model instance(s).' : '') + (pend.length ? ' (it has edits for ' + pend.join(', ') + ': load that volume and build again)' : '');
      const byVol = {};
      for (const w of names) (byVol[volOf(w)] = byVol[volOf(w)] || []).push(w);
      const srcWad = n => getWad(n), healed = [], outs = [], texRep = [], tintRep = [], customModelReports = [];
      let i = 0;
      for (const V of Object.keys(byVol)) {
        const rep = {}, plans = {};
        for (const w of byVol[V]) {
          $('ed_sum').textContent = 'patching ' + w + ' (' + ++i + '/' + names.length + ')...';
          await new Promise(r => setTimeout(r));
          const f = Viewer.files.find(x => x.name === w);
          const hdr = new Uint8Array(f.buf, f.off, new DataView(f.buf, f.off).getUint32(4, true) + 16).slice();
          const g = getWad(w);
          const baseA=g.A,baseB=g.B;
          let A = g.A, B = g.B, tplan = null;
          // Keep the untouched level's import set so resource-directory repair
          // appends only assets this build introduces. Some original PC levels
          // intentionally omit alternate model resources from the D3D directory.
          const baseResourceFixups = B;
          const bl = new Map(sc[w] ? Object.entries(sc[w].blocks).map(([k,v]) => [+k,v]) : []);
          if (tn[w]) tplan = planTints(A, B, tn[w].inst, bl); // adds the tint prologue to the code block texts
          if (bl.size) {
            const x = IA.relink(A, B, bl);
            const v = IA.verify(IA.wadCtx(A, B), x.A, x.B, x.info.relocs, new Set(bl.keys()));
            if (v.bad.length) throw w + ': code edit verification failed: ' + v.bad.slice(0,3).join('; ');
            A = x.A; B = x.B;
          }
          if (tplan) { const t = applyTintData(A, B, tplan); A = t.A; B = t.B; tintRep.push(w + ': ' + t.report); }
          const sp = sndPlan(w);
          let r0 = wads[w] ? EC.patchLcs(A, B, wads[w], w, srcWad, {snd:sp, audioAssets:getProject().audioAssets || {}, musicAssets:wads[w] && wads[w].music || {}}) : {A,B};
          const customRec = customModelRecords[w];
          const beforeCustomA=r0.A,beforeCustomB=r0.B;
          let afterCustomA=r0.A,afterCustomB=r0.B,hasCustomBuild=false;
          if (customRec && customRec.instances && customRec.instances.length) {
            // Custom-model render and STRAT scaffolds are bundled with the editor.
            // Pass no level-source resolver: importing a model must not depend on
            // RoboPunchout_Boat, RobotHub_Flap_Flat, or any other map object.
            const cm = EC.patchCustomModels(r0.A, r0.B, w, customRec, null, []);
            r0 = {A:cm.A, B:cm.B};afterCustomA=cm.A;afterCustomB=cm.B;hasCustomBuild=true;
            customModelReports.push(w + ': ' + cm.added.models + ' native model(s), ' + cm.added.instances + ' STRAT instance(s), ' + cm.added.textures + ' texture(s)' + (cm.templateSource ? ' using STRAT template from ' + cm.templateSource : '') + (cm.templateName ? ', render template ' + cm.templateName : '') + (cm.added.collisions ? ', ' + cm.added.collisions + ' native box collision(s)' + (cm.collisionTemplateSource ? ' using CollMesh from ' + cm.collisionTemplateSource : '') : ''));
          }
          if (tx[w]) { const t = applyTextureOps(r0.A, r0.B, tx[w].ops); r0 = {A:t.A, B:t.B}; texRep.push(w + ': ' + t.report.join('; ')); }
          const r = EC.healResDir(r0.A, r0.B, baseResourceFixups);
          if(hasCustomBuild)recordCollisionDiagnostics(w,V,baseA,baseB,beforeCustomA,beforeCustomB,afterCustomA,afterCustomB,r.A,r.B,customRec);
          if (r.added.tex || r.added.mesh || (r.removed && (r.removed.tex || r.removed.mesh || r.removed.invalidVertexResources))) healed.push(w + ' (+' + r.added.tex + ' tex, +' + r.added.mesh + ' mesh' + (r.removed && (r.removed.tex || r.removed.mesh || r.removed.invalidVertexResources) ? ', removed ' + r.removed.tex + ' stale tex, ' + r.removed.mesh + ' stale mesh and ' + r.removed.invalidVertexResources + ' malformed vertex resource(s)' : '') + ')');
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
          const pn = n => n.replace(/\.LCS$/i, '.PCA');
          const pcaNames = new Set(Object.keys(plans));
          for (const w in plans) for (const a of plans[w].adds) if (a.w) pcaNames.add(a.w);
          // Copy only the PCA entries needed for this build. Full .avl buffers
          // can then be evicted as we move between source volumes.
          const pcaData = new Map();
          for (const n of pcaNames) {
            const volume = volOf(n);
            const a = await avlLoad(volume), entry = a.list && a.list.find(x => x.name.toLowerCase() === pn(n).toLowerCase());
            if (!entry) throw 'no ' + pn(n) + ' in ' + (a ? a.name : vbase(volume) + '.avl');
            if (!Number.isInteger(entry.off) || !Number.isInteger(entry.size) || entry.off < 0 || entry.size <= 0 || entry.off + entry.size > a.buf.byteLength) throw pn(n) + ' has an invalid archive range';
            const vf0 = Viewer.files.find(x => x.name.toLowerCase() === n.toLowerCase());
            if (!vf0) throw 'level ' + n + ' is not loaded';
            pcaData.set(n, {pca:new Uint8Array(a.buf, entry.off, entry.size).slice(), h78:new DataView(vf0.buf, vf0.off).getUint32(0x78, true)});
          }
          const pcaOf = n => { const data = pcaData.get(n); if (!data) throw 'no cached PCA data for ' + n; return data; };
          const rep2 = {};
          for (const w in plans) rep2[pn(w)] = EC.buildPca(pcaOf(w).pca, plans[w], sw => pcaOf(sw));
          // Reload the target .avl if the LRU evicted it while collecting source PCAs.
          const A = await avlLoad(V);
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
        (texRep.length ? ' Textures: ' + texRep.join(' | ') + '.' : '') +
        (tintRep.length ? ' Colour tints: ' + tintRep.join(' | ') + '.' : '') +
        (customModelReports.length ? ' Custom models: ' + customModelReports.join(' | ') + '.' : '') +
        (customAssets && !customInstances ? ' The project also contains ' + customAssets + ' imported custom model asset(s); place an instance in the Models panel to include one in the game build.' : '') +
        (pend.length ? ' Still to build: ' + pend.join(', ') + ' (load it, open the same project, build).' : '');
    } catch (x) {
      $('ed_sum').textContent = 'patch failed: ' + x;
      console.error(x);
    }
  };

  // Staged texture-only diagnostics. Stage 1A imports kind-1 texture
  // resources without runtime registration. Stage 1B additionally appends
  // the new texture to the level resource directory (including its fixups).
  // Both paths deliberately ignore unrelated project edits and never write an AVL.
  const buildTextureDiagnostic = async (registerRuntimeDirectory, stageButton) => {
    const stageName = registerRuntimeDirectory ? 'Stage 1B' : 'Stage 1A';
    const outputSuffix = registerRuntimeDirectory
      ? '.stage1b-texture-registered.vol'
      : '.stage1a-texture-import-only.vol';
    try {
      if (!isVol()) throw 'load the original .vol first';
      const records = getProject().customModels || {};
      const targets = Object.keys(records).filter(w => Array.isArray(records[w] && records[w].assets) && records[w].assets.length);
      const loaded = targets.filter(w => getWad(w));
      const pendingTargets = targets.filter(w => !getWad(w));
      if (!loaded.length) throw targets.length
        ? 'load the target level(s) for the imported custom model assets: ' + pendingTargets.join(', ')
        : 'import a .inimodel asset in the Models panel first';
      const byVol = {};
      for (const w of loaded) {
        const V = volOf(w) || ((w.match(/^(\d+)-/) || [])[1] + '.vol');
        (byVol[V] = byVol[V] || []).push(w);
      }
      const outs = [], reports = [];
      let index = 0;
      for (const V of Object.keys(byVol)) {
        const replacements = {};
        for (const w of byVol[V]) {
          if (stageButton) stageButton.disabled = true;
          $('ed_sum').textContent = stageName + ': importing textures from ' + w + ' (' + (++index) + '/' + loaded.length + ')...';
          await new Promise(r => setTimeout(r));
          const g = getWad(w), f = Viewer.files.find(x => x.name === w);
          if (!g || !f) throw 'target level ' + w + ' is not loaded';
          const headerSize = new DataView(f.buf, f.off).getUint32(4, true) + 16;
          const header = new Uint8Array(f.buf, f.off, headerSize).slice();
          const imported = EC.patchCustomTextures(g.A, g.B, w, records[w]);
          if (imported.added.textures < 1) throw w + ': no supported embedded textures were found in the imported .inimodel assets';
          const final = registerRuntimeDirectory
            ? EC.healResDir(imported.A, imported.B, g.B)
            : imported;
          replacements[w] = EC.packWad(header, final.A, final.B);
          reports.push(w + ': ' + imported.added.textures + ' texture resource(s), ' + imported.added.bytes + ' TGA bytes' +
            (registerRuntimeDirectory
              ? '; runtime directory +' + final.added.tex + ' texture(s), +' + final.added.mesh + ' mesh(es), relocation fixups retained'
              : '; runtime directory unchanged') +
            '; no mesh/model/STRAT data');
        }
        const volumeFile = Viewer.files.find(x => x.vol === V);
        if (!volumeFile) throw 'source volume ' + V + ' is not loaded';
        outs.push({V, parts: EC.rebuildVol(volumeFile.buf, replacements), name: V.replace(/\.vol$/i, outputSuffix)});
      }
      let n = 0;
      for (const out of outs) setTimeout(() => dl(out.parts, out.name, 'application/octet-stream'), 600 * n++);
      $('ed_sum').textContent = 'built ' + outs.map(x => x.name).join(', ') + '. ' + stageName +
        (registerRuntimeDirectory
          ? ' contains imported custom TGA texture resources and registers them in the native runtime texture directory, with the new directory-entry relocations preserved.'
          : ' contains imported custom TGA texture resources only; existing runtime resource directories were not modified.') +
        ' No mesh, model descriptor, render part, STRAT class/instance, collision or AVL data was added; unrelated project edits were not included.' +
        (reports.length ? ' Imported: ' + reports.join(' | ') + '.' : '') +
        (pendingTargets.length ? ' Still to build: ' + pendingTargets.join(', ') + ' (load those levels and run the same stage again).' : '');
    } catch (x) {
      $('ed_sum').textContent = stageName + ' build failed: ' + (x && x.message || x);
      console.error(x);
    } finally {
      if (stageButton) stageButton.disabled = false;
    }
  };

  const stage1Button = $('ed_patch_textures');
  if (stage1Button) stage1Button.onclick = () => buildTextureDiagnostic(false, stage1Button);
  const stage1bButton = $('ed_patch_textures_registered');
  if (stage1bButton) stage1bButton.onclick = () => buildTextureDiagnostic(true, stage1bButton);

  // Stage 2 adds one custom mesh + complete native render graph, registers
  // texture/mesh resources and redirects SavePointTop's existing visual model
  // table. It deliberately creates no STRAT class or instance and never
  // touches collision references or the paired AVL.
  const buildStage2VisualDiagnostic = async stageButton => {
    const stageName = 'Stage 2';
    try {
      if (!isVol()) throw 'load the genuine original 10.vol first';
      const wadName = '10-00.LCS', record = (getProject().customModels || {})[wadName];
      if (!record || !Array.isArray(record.assets) || !record.assets.length)
        throw 'import the Suzanne .inimodel asset for 10-00.LCS in the Models panel first';
      if (record.assets.length !== 1) throw 'Stage 2 currently supports exactly one imported custom-model asset';
      if (stageButton) stageButton.disabled = true;
      $('ed_sum').textContent = stageName + ': building the custom render graph and redirecting SavePointTop...';
      await new Promise(r => setTimeout(r));
      const g = getWad(wadName), f = Viewer.files.find(x => x.name === wadName);
      if (!g || !f) throw 'load 10-00.LCS from the original 10.vol first';
      const headerSize = new DataView(f.buf, f.off).getUint32(4, true) + 16;
      const header = new Uint8Array(f.buf, f.off, headerSize).slice();
      const graph = EC.patchCustomModelVisual(g.A, g.B, wadName, record);
      const registered = EC.healResDir(graph.A, graph.B, g.B);
      if (registered.added.tex !== 1 || registered.added.mesh !== 1)
        throw wadName + ': Stage 2 expected to register exactly one texture and one mesh; got ' + JSON.stringify(registered.added);
      const replacement = EC.packWad(header, registered.A, registered.B);
      const V = volOf(wadName) || '10.vol';
      const volumeFile = Viewer.files.find(x => x.vol === V);
      if (!volumeFile) throw 'source volume ' + V + ' is not loaded';
      const outName = V.replace(/\.vol$/i, '.stage2-savepointtop.vol');
      const outParts = EC.rebuildVol(volumeFile.buf, {[wadName]: replacement});
      dl(outParts, outName, 'application/octet-stream');
      $('ed_sum').textContent = outName + ' built from the loaded volume. Stage 2 added one custom texture, mesh and complete native render graph, then redirected only SavePointTop\'s existing ordinary Strat_SetModel reference to INI_SUZANNE. Added to the runtime directory: ' + registered.added.tex + ' texture and ' + registered.added.mesh + ' mesh. STRAT class count, instance count, collision references and the original AVL were left unchanged. Replace 10.vol with this file (renamed to 10.vol) for the in-game test; keep the original 10.avl.';
    } catch (x) {
      $('ed_sum').textContent = stageName + ' build failed: ' + (x && x.message || x);
      console.error(x);
    } finally {
      if (stageButton) stageButton.disabled = false;
    }
  };
  const stage2Button = $('ed_patch_model_stage2');
  if (stage2Button) stage2Button.onclick = () => buildStage2VisualDiagnostic(stage2Button);


  // Stage 3 adds a second, independent STRAT class/instance while retaining
  // Stage 2's proven Suzanne render graph on SavePointTop. The source class is
  // deliberately simple: RoboPunchout_Boat has a single entry-code block, no
  // static variables, no init registers, no active event handlers, no path,
  // and no trigger shape. Its existing script bytes are copied unchanged
  // (apart from pointer relocation) so Stage 4 can replace only this private
  // class's entry program.
  const buildStage3StratClone = async stageButton => {
    const stageName = 'Stage 3';
    try {
      if (!isVol()) throw 'load the genuine original 10.vol first';
      const wadName = '10-00.LCS', sourceWadName = '10-40.LCS';
      const record = (getProject().customModels || {})[wadName];
      if (!record || !Array.isArray(record.assets) || record.assets.length !== 1)
        throw 'import exactly one .inimodel asset for 10-00.LCS first';
      if (stageButton) stageButton.disabled = true;
      $('ed_sum').textContent = stageName + ': building Stage 2 model graph and cloning an existing STRAT class/instance...';
      await new Promise(r => setTimeout(r));

      const target = getWad(wadName), targetFile = Viewer.files.find(x => x.name === wadName);
      const source = getWad(sourceWadName), sourceFile = Viewer.files.find(x => x.name === sourceWadName);
      if (!target || !targetFile) throw 'load 10-00.LCS from the genuine original 10.vol first';
      if (!source || !sourceFile) throw 'load 10-40.LCS from the same original 10.vol; Stage 3 uses RoboPunchout_Boat as its unchanged script template';
      const V = volOf(wadName) || '10.vol';
      if (volOf(sourceWadName) !== V) throw '10-40.LCS must come from the same source volume as 10-00.LCS';

      const sourceClassName = 'RoboPunchout_Boat', classAlias = 'INIStage3_RoboBoat';
      const sourceParsed = siWad(source.A, source.B), targetParsed = siWad(target.A, target.B);
      if (!sourceParsed || !targetParsed) throw 'could not parse the source or target PC STRAT level';
      const sourceClassIndex = sourceParsed.classes.findIndex(c => c.name === sourceClassName);
      if (sourceClassIndex < 0) throw sourceWadName + ' does not contain ' + sourceClassName;
      const sourceClass = sourceParsed.classes[sourceClassIndex];
      if (sourceClass.ninit !== 0) throw sourceClassName + ' unexpectedly has static variables; refusing this Stage 3 template';
      const sourceInstanceIndex = sourceParsed.instances.findIndex(x => x.cls === sourceClassIndex);
      if (sourceInstanceIndex < 0) throw 'no source instance of ' + sourceClassName + ' exists in ' + sourceWadName;
      const sourceInstance = sourceParsed.instances[sourceInstanceIndex];
      const sourceDv = new DataView(source.A.buffer, source.A.byteOffset, source.A.byteLength);
      const readSourceU = o => sourceDv.getUint32(o, true);
      const activeEvents = sourceClass.events.filter(([, handler]) => handler !== 0);
      if (activeEvents.length) throw sourceClassName + ' now has active event handlers; Stage 3 needs an event-free source template';
      if (readSourceU(sourceInstance.off + 0x2c) === 0 || readSourceU(sourceInstance.off + 0x30) !== 0 || readSourceU(sourceInstance.off + 0x34) !== 0)
        throw 'the source instance no longer has the expected zero-register, no-path, no-trigger layout';

      // Use the first placed custom-model position when supplied. Otherwise
      // spawn 15 world units to the right of NinjaStartPoint so the test prop
      // is near the level's normal start location and easy to find.
      const placed = (record.instances || []).find(x => x && Array.isArray(x.position) && x.position.length === 3 && x.position.every(Number.isFinite));
      let position, rotation;
      if (placed) {
        position = placed.position.slice();
        rotation = Array.isArray(placed.rotation) && placed.rotation.length === 3 ? placed.rotation : [0, 0, 0];
      } else {
        const startClass = targetParsed.classes.findIndex(c => c.name === 'NinjaStartPoint');
        const startIndex = targetParsed.instances.findIndex(x => x.cls === startClass);
        if (startClass < 0 || startIndex < 0) throw 'no custom placement was supplied and NinjaStartPoint could not be found for the Stage 3 fallback position';
        const start = targetParsed.instances[startIndex];
        const targetDv = new DataView(target.A.buffer, target.A.byteOffset, target.A.byteLength);
        position = [0, 1, 2].map(k => targetDv.getFloat32(start.off + 0x10 + 4 * k, true));
        position[0] += 15;
        rotation = [0, 0, 0];
      }

      const graph = EC.patchCustomModelVisual(target.A, target.B, wadName, record);
      const ops = {
        classes: [{
          from: {w: sourceWadName, name: sourceClassName},
          variants: [{name: sourceClassName, alias: classAlias}]
        }],
        adds: [{
          id: 'stage3-custom-model-strat',
          from: {w: sourceWadName, i: sourceInstanceIndex},
          p: position,
          dy: Math.round((rotation[1] || 0) / 360 * 4096)
        }]
      };
      const copied = EC.patchLcs(graph.A, graph.B, ops, wadName, n => {
        if (n === sourceWadName) return source;
        return getWad(n);
      }, {});
      const registered = EC.healResDir(copied.A, copied.B, target.B);
      const finalWad = siWad(registered.A, registered.B);
      const finalClassIndex = finalWad.classes.findIndex(c => c.name === classAlias);
      if (finalClassIndex < 0) throw 'Stage 3 private class was not present after the clone';
      const finalInstanceIndex = finalWad.instances.findIndex(x => x.cls === finalClassIndex);
      if (finalInstanceIndex < 0) throw 'Stage 3 class instance was not present after the clone';

      const headerSize = new DataView(targetFile.buf, targetFile.off).getUint32(4, true) + 16;
      const header = new Uint8Array(targetFile.buf, targetFile.off, headerSize).slice();
      const replacement = EC.packWad(header, registered.A, registered.B);
      const volumeFile = Viewer.files.find(x => x.vol === V);
      if (!volumeFile) throw 'source volume ' + V + ' is not loaded';
      const outName = V.replace(/\.vol$/i, '.stage3-strat-copy.vol');
      const outParts = EC.rebuildVol(volumeFile.buf, {[wadName]: replacement});
      dl(outParts, outName, 'application/octet-stream');
      $('ed_sum').textContent = outName + ' built from the original volume. Stage 2 Suzanne remains on SavePointTop. Stage 3 copied ' + sourceWadName + '::' + sourceClassName + ' into private class ' + classAlias + ' and appended one new instance (#' + finalInstanceIndex + ') at [' + position.map(x => x.toFixed(2)).join(', ') + ']. The original entry script is retained; its non-pointer instruction words are unchanged. The copied class has no active event handlers, static variables, init registers, path or trigger. Runtime directories registered +' + registered.added.tex + ' texture(s) and +' + registered.added.mesh + ' mesh(es) for the copied model graph. Keep the original 10.avl unchanged.';
    } catch (x) {
      $('ed_sum').textContent = stageName + ' build failed: ' + (x && x.message || x);
      console.error(x);
    } finally {
      if (stageButton) stageButton.disabled = false;
    }
  };
  const stage3Button = $('ed_patch_model_stage3');
  if (stage3Button) stage3Button.onclick = () => buildStage3StratClone(stage3Button);

  // Stage 4 repeats the proven Stage 3 class/instance clone, but then changes
  // only the new private class: it redirects its model table to the Stage 2
  // INI_SUZANNE descriptor and installs the persistent WAIT/JMP idle loop.
  // The original source class and SavePointTop remain
  // untouched; the copied boat's remaining code becomes unreachable.
  const buildStage4StaticModel = async stageButton => {
    const stageName = 'Stage 4B';
    try {
      if (!isVol()) throw 'load the genuine original 10.vol first';
      const wadName = '10-00.LCS', sourceWadName = '10-40.LCS';
      const record = (getProject().customModels || {})[wadName];
      if (!record || !Array.isArray(record.assets) || record.assets.length !== 1)
        throw 'import exactly one .inimodel asset for 10-00.LCS first';
      if (stageButton) stageButton.disabled = true;
      $('ed_sum').textContent = stageName + ': building Suzanne and a private static-model STRAT script...';
      await new Promise(r => setTimeout(r));

      const target = getWad(wadName), targetFile = Viewer.files.find(x => x.name === wadName);
      const source = getWad(sourceWadName), sourceFile = Viewer.files.find(x => x.name === sourceWadName);
      if (!target || !targetFile) throw 'load 10-00.LCS from the genuine original 10.vol first';
      if (!source || !sourceFile) throw 'load 10-40.LCS from the same original 10.vol; Stage 4 uses RoboPunchout_Boat as its compatible STRAT layout';
      const V = volOf(wadName) || '10.vol';
      if (volOf(sourceWadName) !== V) throw '10-40.LCS must come from the same source volume as 10-00.LCS';

      const sourceClassName = 'RoboPunchout_Boat', classAlias = 'INIStage4_Suzanne';
      const sourceParsed = siWad(source.A, source.B), targetParsed = siWad(target.A, target.B);
      if (!sourceParsed || !targetParsed) throw 'could not parse the source or target PC STRAT level';
      const sourceClassIndex = sourceParsed.classes.findIndex(c => c.name === sourceClassName);
      if (sourceClassIndex < 0) throw sourceWadName + ' does not contain ' + sourceClassName;
      const sourceClass = sourceParsed.classes[sourceClassIndex];
      if (sourceClass.ninit !== 0) throw sourceClassName + ' unexpectedly has static variables; refusing this Stage 4 template';
      const sourceInstanceIndex = sourceParsed.instances.findIndex(x => x.cls === sourceClassIndex);
      if (sourceInstanceIndex < 0) throw 'no source instance of ' + sourceClassName + ' exists in ' + sourceWadName;
      const sourceInstance = sourceParsed.instances[sourceInstanceIndex];
      const sourceDv = new DataView(source.A.buffer, source.A.byteOffset, source.A.byteLength);
      const readSourceU = o => sourceDv.getUint32(o, true);
      if (sourceClass.events.some(([, handler]) => handler !== 0)) throw sourceClassName + ' now has active event handlers; refusing the static-model conversion';
      if (readSourceU(sourceInstance.off + 0x2c) === 0 || readSourceU(sourceInstance.off + 0x30) !== 0 || readSourceU(sourceInstance.off + 0x34) !== 0)
        throw 'the source instance no longer has the expected zero-register, no-path, no-trigger layout';

      const placed = (record.instances || []).find(x => x && Array.isArray(x.position) && x.position.length === 3 && x.position.every(Number.isFinite));
      let position, rotation;
      if (placed) {
        position = placed.position.slice();
        rotation = Array.isArray(placed.rotation) && placed.rotation.length === 3 ? placed.rotation : [0, 0, 0];
      } else {
        const startClass = targetParsed.classes.findIndex(c => c.name === 'NinjaStartPoint');
        const startIndex = targetParsed.instances.findIndex(x => x.cls === startClass);
        if (startClass < 0 || startIndex < 0) throw 'no custom placement was supplied and NinjaStartPoint could not be found for the Stage 4 fallback position';
        const start = targetParsed.instances[startIndex];
        const targetDv = new DataView(target.A.buffer, target.A.byteOffset, target.A.byteLength);
        position = [0, 1, 2].map(k => targetDv.getFloat32(start.off + 0x10 + 4 * k, true));
        position[0] += 15;
        rotation = [0, 0, 0];
      }

      const graph = EC.patchCustomModelVisual(target.A, target.B, wadName, record);
      const ops = {
        classes: [{
          from: {w: sourceWadName, name: sourceClassName},
          variants: [{name: sourceClassName, alias: classAlias}]
        }],
        adds: [{
          id: 'stage4-static-suzanne-instance',
          from: {w: sourceWadName, i: sourceInstanceIndex},
          p: position,
          dy: Math.round((rotation[1] || 0) / 360 * 4096)
        }]
      };
      const copied = EC.patchLcs(graph.A, graph.B, ops, wadName, n => {
        if (n === sourceWadName) return source;
        return getWad(n);
      }, {});
      const scripted = EC.patchCustomModelStaticScript(copied.A, copied.B, wadName, classAlias, graph.newDescriptor, 'INI_SUZANNE');
      if (scripted.reachable.length !== 4) throw 'Stage 4B script did not reduce to the expected four model-setup/idle-loop instructions';
      const registered = EC.healResDir(scripted.A, scripted.B, target.B);
      const finalWad = siWad(registered.A, registered.B);
      const finalClassIndex = finalWad.classes.findIndex(c => c.name === classAlias);
      if (finalClassIndex < 0) throw 'Stage 4 private static-model class was not present after the script rewrite';
      const finalInstanceIndex = finalWad.instances.findIndex(x => x.cls === finalClassIndex);
      if (finalInstanceIndex < 0) throw 'Stage 4 custom static-model instance was not present';

      const headerSize = new DataView(targetFile.buf, targetFile.off).getUint32(4, true) + 16;
      const header = new Uint8Array(targetFile.buf, targetFile.off, headerSize).slice();
      const replacement = EC.packWad(header, registered.A, registered.B);
      const volumeFile = Viewer.files.find(x => x.vol === V);
      if (!volumeFile) throw 'source volume ' + V + ' is not loaded';
      const outName = V.replace(/\.vol$/i, '.stage4b-static-suzanne-idle.vol');
      const outParts = EC.rebuildVol(volumeFile.buf, {[wadName]: replacement});
      dl(outParts, outName, 'application/octet-stream');
      $('ed_sum').textContent = outName + ' built from the original volume. Stage 4 created private class ' + classAlias + ' and one new instance (#' + finalInstanceIndex + ') at [' + position.map(x => x.toFixed(2)).join(', ') + ']. Its script is now MOV model-table, Strat_SetModel, WAIT(0), JMP-to-WAIT; the private model table points to INI_SUZANNE. Stage 2 SavePointTop and the original RoboPunchout_Boat class/instance remain unchanged. Runtime directories registered +' + registered.added.tex + ' texture(s) and +' + registered.added.mesh + ' mesh(es). Keep the original 10.avl unchanged.';
    } catch (x) {
      $('ed_sum').textContent = stageName + ' build failed: ' + (x && x.message || x);
      console.error(x);
    } finally {
      if (stageButton) stageButton.disabled = false;
    }
  };
  const stage4Button = $('ed_patch_model_stage4');
  if (stage4Button) stage4Button.onclick = () => buildStage4StaticModel(stage4Button);

  return { clean, withFp };
}
