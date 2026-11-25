// Project lifecycle: project JSON loading/saving and patched VOL/AVL generation.
// All mutable editor state and format-specific helpers are supplied by the coordinator.
import { applyTextureOps } from './texture-tools.js?v=step146-strat-appearance-preview';
import { siWad, instances as parseLcsInstances, parseLcm, wadName } from './vol-core.js?v=step146-strat-appearance-preview';
import { collisionWadSnapshot } from './collision-diagnostics.js?v=step146-strat-appearance-preview';
import { planTints, applyTintData } from './class-tint.js';
import {parseIninjaLevelBundle, base64ToBytes} from './custom-models.js?v=step146-strat-appearance-preview';
import {makeInilevelStratAsset} from './inilevel-strat-adapter.js?v=step146-strat-appearance-preview';
import {appendInilevelRender, makeEmptyStandaloneLcm, inspectSpatialCellRoot, findLevelDrawQueues} from './native-level-writer.js?v=step146-strat-appearance-preview';
function inilevelBounds(data) {
  const bounds = [[Infinity, Infinity, Infinity], [-Infinity, -Infinity, -Infinity]];
  let count = 0;
  const visit = positions => {
    if (!positions || typeof positions.length !== 'number' || positions.length % 3) return;
    for (let i = 0; i < positions.length; i += 3) {
      const x = Number(positions[i]), y = Number(positions[i + 1]), z = Number(positions[i + 2]);
      if (![x, y, z].every(Number.isFinite)) throw new Error('bundle contains a non-finite position');
      bounds[0][0] = Math.min(bounds[0][0], x); bounds[0][1] = Math.min(bounds[0][1], y); bounds[0][2] = Math.min(bounds[0][2], z);
      bounds[1][0] = Math.max(bounds[1][0], x); bounds[1][1] = Math.max(bounds[1][1], y); bounds[1][2] = Math.max(bounds[1][2], z);
      count++;
    }
  };
  for (const mesh of data.meshes || []) visit(mesh.positions);
  if (data.collision) visit(data.collision.positions);
  if (!count) throw new Error('bundle has no positions to place');
  return {bounds, centre: bounds[0].map((v, k) => (v + bounds[1][k]) * 0.5), count};
}
function translateInilevel(data, delta) {
  const translate = source => {
    if (!source) return source;
    const out = new Float32Array(source);
    for (let i = 0; i < out.length; i += 3) {
      out[i] += delta[0]; out[i + 1] += delta[1]; out[i + 2] += delta[2];
    }
    return out;
  };
  return {
    ...data,
    meshes: (data.meshes || []).map(mesh => ({...mesh, positions: translate(mesh.positions)})),
    collision: data.collision ? {...data.collision, positions: translate(data.collision.positions)} : data.collision
  };
}
function placementNearNinjaStart(data, lcsA, lcsB, wadName) {
  const start = parseLcsInstances(lcsA, lcsB).find(entity => entity.n === 'NinjaStartPoint');
  if (!start || !Array.isArray(start.p) || !start.p.every(Number.isFinite)) {
    throw wadName + ': cannot place static level geometry near spawn because the paired LCS has no readable NinjaStartPoint; choose Preserve bundle world coordinates instead';
  }
  const q = Array.isArray(start.q) && start.q.length === 4 ? start.q : [0, 0, 0, 1];
  const qn = Math.hypot(...q) || 1, [qx, qy, qz, qw] = q.map(v => v / qn);
  const forward = [-2 * (qx * qz + qw * qy), 2 * (qw * qx - qy * qz), -1 + 2 * (qx * qx + qy * qy)];
  const fn = Math.hypot(...forward) || 1;
  // Put the centre of the complete render+collision bundle eight units in
  // front of the spawn and two units above it. The quaternion supplies the
  // local -Z forward direction, so 10-00's rotated spawn is handled correctly.
  const target = [start.p[0] + forward[0] / fn * 8, start.p[1] + 2 + forward[1] / fn * 8, start.p[2] + forward[2] / fn * 8];
  const {centre, bounds} = inilevelBounds(data);
  const delta = target.map((v, k) => v - centre[k]);
  return {data: translateInilevel(data, delta), start, bounds, originalCentre: centre, targetCentre: target, delta};
}

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
    j.levelModels = Array.isArray(j.levelModels) ? j.levelModels : [];
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
      const PRJ = getProject();
      if (!isVol() && !(PRJ.levelModels || []).length) throw 'load a .vol or import a .inilevel first';
      const wads = withFp();
      const vv = {...PRJ.vols};
      for (const f of Viewer.files) if (f.vol) vv[f.vol] = f.buf.byteLength;
      PRJ.vols = vv;
      const scr = buildScriptWadsFp();
      dl([JSON.stringify({app:'ininja-editor', v:1, vols:PRJ.vols, models:PRJ.models || {}, customModels:PRJ.customModels || {}, levelModels:PRJ.levelModels || [], prefabs:PRJ.prefabs || [], audioAssets:PRJ.audioAssets || {}, wads, scripts:scr, textures:texturesFp(), tints:tintsFp(), display:PRJ.display || {}}, null, 1)], 'ininja-project.json', 'application/json');
      $('ed_sum').textContent = 'project saved: ' + Object.keys(wads).length + ' level(s) with instance edits, ' + Object.keys(scr).length + ' with code edits, ' + (PRJ.prefabs || []).length + ' prefab favourite(s), ' + Object.values(PRJ.customModels || {}).reduce((n,c)=>n+(c.assets||[]).length,0) + ' imported custom model asset(s), ' + (PRJ.levelModels || []).length + ' imported level-model bundle(s) (build mode, target and preview data saved)';
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
      const levelModelRecords = (getProject().levelModels || []).filter(r => r && typeof r.bundle === 'string' && (r.targetLcm || String(r.standaloneId || '').trim()));
      for (const r of levelModelRecords) if (r.targetLcm && !/\.LCM$/i.test(r.targetLcm)) throw 'invalid level-model destination: ' + r.targetLcm + ' (choose an LCM chunk)';
      // STRAT objects remain available as a workaround; native-static now
      // writes LCM draw parts and registers their bounds in the target spatial cells.
      const nativeLevelModelRecords = levelModelRecords.filter(r => r.buildMode === 'native-static');
      const objectLevelModelRecords = levelModelRecords.filter(r => r.buildMode !== 'native-static');
      const pairedLcs = r => String(r.targetLcm).replace(/\.LCM$/i, '.LCS');
      const standaloneCandidates = levelModelRecords.filter(r => String(r.standaloneId || '').trim());
      if (standaloneCandidates.some(r => r.buildMode !== 'native-static')) throw 'a separate streamed chunk can only be built with Static LCM geometry';
      const standaloneIds = new Set();
      for (const record of standaloneCandidates) {
        const id = String(record.standaloneId).trim();
        if (!/^\d{2}-\d{2}$/.test(id)) throw 'invalid separate chunk ID "' + id + '" (use a two-digit area ID such as 10-98)';
        if (standaloneIds.has(id.toLowerCase())) throw 'only one .inilevel bundle may target separate chunk ' + id + ' in this prototype';
        standaloneIds.add(id.toLowerCase());
        const selectedTarget = String(record.targetLcm || '').trim();
        const volume = selectedTarget
          ? (volOf(selectedTarget) || record.targetVol || '')
          : (record.targetVol || loadedVols().find(v => String(vbase(v)).toLowerCase() === id.slice(0, 2).toLowerCase()) || (id.slice(0, 2) + '.vol'));
        if (!volume || String(vbase(volume)).toLowerCase() !== id.slice(0, 2).toLowerCase()) throw id + ' must use the same two-digit prefix as its destination VOL (' + (volume || 'unknown volume') + '); choose a matching destination volume or update the chunk ID';
        if (!loadedVols().some(v => String(vbase(v)).toLowerCase() === String(vbase(volume)).toLowerCase())) throw 'load the source ' + vbase(volume) + '.vol before building standalone chunk ' + id;
        if (selectedTarget) {
          if (!getWad(selectedTarget)) throw 'load the template LCM ' + selectedTarget + ' from its source VOL first';
          const sourceLcs = pairedLcs(record);
          if (!getWad(sourceLcs)) throw 'load the paired template LCS ' + sourceLcs + ' from the same source VOL first';
        }
        const cleanDonorName = String(record.cleanDonorLcm || '').trim();
        if (cleanDonorName) {
          const donorFile = (Viewer.files || []).find(f => f && f.name.toLowerCase() === cleanDonorName.toLowerCase() && String(f.vol || '').toLowerCase() === String(volume).toLowerCase());
          if (!donorFile) throw 'clean donor ' + cleanDonorName + ' must be loaded from the same destination VOL (' + volume + '); it is used only for scaffolding, not cloned as scenery';
          const donorLcs = cleanDonorName.replace(/\.LCM$/i, '.LCS');
          if (!getWad(donorLcs)) throw 'load the paired clean-donor LCS ' + donorLcs + ' from ' + volume;
        }
        const existingNames = (Viewer.files || []).filter(f => f && f.vol && String(f.vol).toLowerCase() === String(volume).toLowerCase()).map(f => String(f.name).toLowerCase());
        for (const ext of ['.LCS', '.LCM']) if (existingNames.includes((id + ext).toLowerCase())) throw 'cannot create ' + id + ': ' + id + ext + ' already exists in ' + volume;
      }
      const standaloneRecords = standaloneCandidates;
      const regularNativeLevelModelRecords = nativeLevelModelRecords.filter(r => !String(r.standaloneId || '').trim());
      const levelModelWads = [...new Set(objectLevelModelRecords.map(pairedLcs))];
      const nativeLevelModelWads = [...new Set(regularNativeLevelModelRecords.map(r => String(r.targetLcm)))];
      const missingLevelLcs = levelModelWads.filter(w => !getWad(w));
      if (missingLevelLcs.length) throw 'load the paired LCS file(s) for the selected object-mode level chunk(s): ' + missingLevelLcs.join(', ');
      const nativeStartLcsWads = [...new Set(regularNativeLevelModelRecords.filter(r => r.placementMode !== 'world').map(pairedLcs))];
      const missingNativeStartLcs = nativeStartLcsWads.filter(w => !getWad(w));
      if (missingNativeStartLcs.length) throw 'load the paired LCS file(s) to place native static geometry near NinjaStartPoint: ' + missingNativeStartLcs.join(', ') + ' (or select Preserve bundle world coordinates)';
      const missingNativeLcms = nativeLevelModelWads.filter(w => !getWad(w));
      if (missingNativeLcms.length) throw 'load the source VOL containing these native LCM target(s): ' + missingNativeLcms.join(', ');
      const names = [...new Set([...Object.keys(wads), ...Object.keys(sc), ...Object.keys(tx), ...Object.keys(tn), ...customModelWads, ...levelModelWads, ...nativeLevelModelWads])].filter(w => getWad(w));
      const pend = [...new Set([...pending(wads), ...Object.keys(sc).filter(w => !getWad(w)).map(w => sc[w].vol || w.split('-')[0] + '.vol'), ...customModelWads.filter(w => !getWad(w)).map(w => w.split('-')[0] + '.vol'), ...levelModelWads.filter(w => !getWad(w)).map(w => volOf(w) || w.split('-')[0] + '.vol'), ...nativeLevelModelWads.filter(w => !getWad(w)).map(w => volOf(w) || w.split('-')[0] + '.vol')])];
      if (!names.length && !standaloneRecords.length) {
        const importedLevelBundles = (getProject().levelModels || []).filter(r => r && typeof r.bundle === 'string').length;
        throw 'the project has no loaded game-data edits for ' + loadedVols().join(', ') + (importedLevelBundles ? '. It contains ' + importedLevelBundles + ' .inilevel bundle(s); select either the confirmed STRAT-object route or native static-LCM route in the Level Models panel and load the required source files.' : '') + (customAssets || customInstances ? ' It also contains ' + customAssets + ' imported custom model asset(s) and ' + customInstances + ' placed custom model instance(s).' : '') + (pend.length ? ' (it has edits for ' + pend.join(', ') + ': load that volume and build again)' : '');
      }
      const byVol = {}, standaloneByVol = {};
      for (const w of names) (byVol[volOf(w)] = byVol[volOf(w)] || []).push(w);
      for (const record of standaloneRecords) {
        const id = String(record.standaloneId || '').trim();
        const desired = record.targetLcm ? (volOf(record.targetLcm) || record.targetVol) : (record.targetVol || (id.slice(0, 2) + '.vol'));
        const volume = loadedVols().find(v => String(vbase(v)).toLowerCase() === String(vbase(desired)).toLowerCase()) || desired;
        (standaloneByVol[volume] = standaloneByVol[volume] || []).push(record);
      }
      const buildVolumes = [...new Set([...Object.keys(byVol), ...Object.keys(standaloneByVol)])];
      const srcWad = n => getWad(n), healed = [], outs = [], texRep = [], tintRep = [], customModelReports = [], nativeLevelReports = [], standaloneReports = [];
      let i = 0;
      for (const V of buildVolumes) {
        const rep = {}, additions = {}, avlAdditions = {}, plans = {};
        for (const w of (byVol[V] || [])) {
          $('ed_sum').textContent = 'patching ' + w + ' (' + ++i + '/' + names.length + ')...';
          await new Promise(r => setTimeout(r));
          const f = Viewer.files.find(x => x.name === w);
          const hdr = new Uint8Array(f.buf, f.off, new DataView(f.buf, f.off).getUint32(4, true) + 16).slice();
          const g = getWad(w);
          const baseA=g.A,baseB=g.B;
          let A = g.A, B = g.B, tplan = null;
          // Legacy direct-LCM writer retained for compatibility with old projects.
          // New builds schedule .inilevel objects against the paired .LCS instead.
          if (/\.LCM$/i.test(w)) {
            const assigned = regularNativeLevelModelRecords.filter(r => r.targetLcm.toLowerCase() === w.toLowerCase());
            if (!assigned.length) throw w + ': an LCM was queued without an native-static .inilevel bundle';
            let currentA = A, currentB = B;
            const bundleReports = [];
            for (const record of assigned) {
              let data;
              try { data = parseIninjaLevelBundle(base64ToBytes(record.bundle)); }
              catch (e) { throw w + ': could not reopen ' + (record.sourceName || record.name || 'the stored .inilevel') + ': ' + (e && e.message || e); }
              let placementDescription = 'preserve bundle world coordinates';
              if (record.placementMode !== 'world') {
                const lcs = getWad(pairedLcs(record));
                const placed = placementNearNinjaStart(data, lcs.A, lcs.B, w);
                data = placed.data;
                placementDescription = 'bundle centre translated to NinjaStartPoint +8 local-forward/+2Y; delta [' + placed.delta.map(v => Number(v.toFixed(3))).join(', ') + ']';
              }
              const writerOptions = {forceSingleSided: !!record.nativeSingleSided, untextured: !!record.nativeUntextured, useTemplateTexture: !!record.nativeTemplateTexture, clearTemplateFlag200: !!record.nativeClearTemplateFlag200, clearTemplateFlag20: !!record.nativeClearTemplateFlag20, referenceStaticTemplate: !!record.nativeReferenceStaticTemplate};
              const built = appendInilevelRender(currentA, currentB, w, data, EC, writerOptions);
              currentA = built.A; currentB = built.B;
              const partBoundsSummary = (built.reports || []).map(r => (r.name || 'part') + ' radius ' + Number(r.templateBoundRadius).toFixed(3) + '→' + Number(r.boundRadius).toFixed(3)).join(', ');
              const visibility = built.visibilityRegistration || {};
              const visibilitySummary = (visibility.addedDescriptors || 0) + ' visibility descriptor(s) assigned to spatial cells ' + (visibility.assignments || []).map(a => (a.name || 'part') + ': [' + (a.cells || []).join(', ') + ']').join('; ') + '; ' + (visibility.orphanDescriptors ?? 'unknown') + ' orphan descriptor(s)';
              bundleReports.push((record.name || data.manifest.name || record.sourceName || 'level bundle') + ' (' + placementDescription + (writerOptions.forceSingleSided ? '; single-sided diagnostic' : '') + (writerOptions.untextured ? '; vertex-colour-only diagnostic' : '') + (writerOptions.useTemplateTexture ? '; retail-template-texture control' : '') + (writerOptions.clearTemplateFlag200 ? '; cleared template part flag 0x200 only' : '') + (writerOptions.clearTemplateFlag20 ? '; cleared template part flag 0x20 only' : '') + (writerOptions.referenceStaticTemplate ? '; plain Heart Room Wall static-template diagnostic' : '') + (built.added.singleLayerMaterialStage1Reset ? '; stage 1 COLOROP disabled for single-layer custom textures' : '') + '): ' + built.added.parts + ' native render part(s), ' + built.added.triangles + ' native render triangles (' + built.added.sourceTriangles + ' source' + (built.added.doubleSidedParts ? ', ' + built.added.doubleSidedParts + ' two-sided part(s) expanded for back-face visibility' : '') + '), ' + built.added.textures + ' texture(s), ' + built.resourceDirectory.tex + ' texture and ' + built.resourceDirectory.mesh + ' vertex-buffer directory entries; ' + visibilitySummary + '; ' + built.added.collisionPreserved + ' existing collision triangles/tags/auxiliary flags retained, ' + built.added.collisionSourceTriangles + ' imported source collision faces placed into ' + built.added.collisionTriangles + ' final KD query regions (' + built.added.collisionDuplicatePlacements + ' additional whole-face copies) in a ' + (built.readback.collisionKdNodes || 'existing') + '-node KD tree; linked into opaque draw queue; per-part bounds: ' + partBoundsSummary + (built.placementWarning ? '. PLACEMENT WARNING: ' + built.placementWarning : '') + (built.collisionStructureWarning ? '. COLLISION WARNING: ' + built.collisionStructureWarning : ''));
            }
            rep[w] = EC.packWad(hdr, currentA, currentB);
            nativeLevelReports.push(w + ': ' + bundleReports.join(' | '));
            continue;
          }
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
          let buildCustomRec = customRec ? {assets:[...(customRec.assets||[])],instances:[...(customRec.instances||[])]} : {assets:[],instances:[]};
          const assignedLevelModels = objectLevelModelRecords.filter(record => pairedLcs(record).toLowerCase() === w.toLowerCase());
          const levelObjectDetails = [];
          for (let li=0;li<assignedLevelModels.length;li++) {
            const record=assignedLevelModels[li];
            let data;
            try { data=parseIninjaLevelBundle(base64ToBytes(record.bundle)); }
            catch(e) { throw w+': could not reopen '+(record.sourceName||record.name||'the stored .inilevel')+': '+(e&&e.message||e); }
            const adapted=makeInilevelStratAsset(data,record);
            const placementMode=record.placementMode==='world'?'world':'start';
            let position;
            if (placementMode==='world') position=adapted.anchor.slice();
            else {
              const start=parseLcsInstances(A,B).find(entity=>entity.n==='NinjaStartPoint');
              if(!start||!Array.isArray(start.p)||!start.p.every(Number.isFinite)) throw w+': cannot place '+(record.name||'the level model')+' near spawn because this LCS has no readable NinjaStartPoint; choose Preserve bundle world coordinates instead';
              // Place the model a few units along the spawn's local -Z axis.
              // Retail STRAT movement uses local-Z-negative movement; use the
              // actual NinjaStartPoint quaternion rather than assuming world +Z
              // is in front of the player (10-00 has a different heading).
              const q=Array.isArray(start.q)&&start.q.length===4?start.q:[0,0,0,1];
              const qn=Math.hypot(...q)||1, [qx,qy,qz,qw]=q.map(v=>v/qn);
              const forward=[-2*(qx*qz+qw*qy),2*(qw*qx-qy*qz),-1+2*(qx*qx+qy*qy)];
              const fn=Math.hypot(...forward)||1;
              position=[start.p[0]+forward[0]/fn*4,start.p[1]+2+forward[1]/fn*4,start.p[2]+forward[2]/fn*4];
            }
            buildCustomRec.assets.push(adapted.asset);
            buildCustomRec.instances.push({id:'inilevel_instance_'+String(record.id||li),assetId:adapted.asset.id,name:record.name||data.manifest.name||'Imported level model',position,rotation:[0,0,0],scale:[1,1,1],collisionType:adapted.asset.collisionType});
            levelObjectDetails.push((record.name||data.manifest.name||record.sourceName||'level model')+' → '+placementMode+' placement at ['+position.map(v=>Number(v.toFixed(2))).join(', ')+'], '+adapted.vertexCount+' vertices, '+Math.floor(adapted.indexCount/3)+' render triangles'+(adapted.twoSided?' (two-sided)':'')+', '+adapted.collisionTriangles+' private CollMesh collision triangles');
          }
          let afterCustomA=r0.A,afterCustomB=r0.B,hasCustomBuild=false;
          if (buildCustomRec.instances && buildCustomRec.instances.length) {
            // Both ordinary .inimodel placements and .inilevel geometry use the
            // same complete native LCS STRAT render graph. Level collision is
            // emitted as the object's private CollMesh, not merged into LCM KD.
            const cm = EC.patchCustomModels(r0.A, r0.B, w, buildCustomRec, null, []);
            r0 = {A:cm.A, B:cm.B};afterCustomA=cm.A;afterCustomB=cm.B;hasCustomBuild=true;
            if (customRec && customRec.instances && customRec.instances.length) customModelReports.push(w + ': ' + customRec.instances.length + ' regular custom model placement(s)');
            if (assignedLevelModels.length) nativeLevelReports.push(w+': '+levelObjectDetails.join(' | ')+'; registered as native STRAT object(s), not static LCM draw parts');
            customModelReports.push(w + ': ' + cm.added.models + ' native model(s), ' + cm.added.instances + ' STRAT instance(s), ' + cm.added.textures + ' texture(s)' + (cm.templateSource ? ' using STRAT template from ' + cm.templateSource : '') + (cm.templateName ? ', render template ' + cm.templateName : '') + (cm.added.collisions ? ', ' + cm.added.collisions + ' private CollMesh collision(s)' + (cm.collisionTemplateSource ? ' using CollMesh from ' + cm.collisionTemplateSource : '') : ''));
          }
          if (tx[w]) { const t = applyTextureOps(r0.A, r0.B, tx[w].ops); r0 = {A:t.A, B:t.B}; texRep.push(w + ': ' + t.report.join('; ')); }
          const r = EC.healResDir(r0.A, r0.B, baseResourceFixups);
          if(hasCustomBuild)recordCollisionDiagnostics(w,V,baseA,baseB,beforeCustomA,beforeCustomB,afterCustomA,afterCustomB,r.A,r.B,buildCustomRec);
          if (r.added.tex || r.added.mesh || (r.removed && (r.removed.tex || r.removed.mesh || r.removed.invalidVertexResources))) healed.push(w + ' (+' + r.added.tex + ' tex, +' + r.added.mesh + ' mesh' + (r.removed && (r.removed.tex || r.removed.mesh || r.removed.invalidVertexResources) ? ', removed ' + r.removed.tex + ' stale tex, ' + r.removed.mesh + ' stale mesh and ' + r.removed.invalidVertexResources + ' malformed vertex resource(s)' : '') + ')');
          if (sp && sp.adds.length) {
            const dh = new DataView(hdr.buffer, hdr.byteOffset);
            dh.setUint32(0x78, sp.h78, true); dh.setUint32(0x7c, sp.h7c, true);
            plans[w] = sp;
          }
          rep[w] = EC.packWad(hdr, r.A, r.B);
        }
        // Standalone chunks have two modes:
        // - selected template: clone that retail LCS/LCM/PCA pair as-is;
        // - blank template: select a compatible donor automatically, copy its
        //   LCS/PCA loader scaffolding, but clear its static LCM render/collision
        //   before appending the imported custom level.
        for (const record of (standaloneByVol[V] || [])) {
          const id = String(record.standaloneId).trim(), newLcmName = id + '.LCM', newLcsName = id + '.LCS';
          const selectedTemplate = String(record.targetLcm || '').trim();
          const avl = await avlLoad(V);
          if (!avl || !Array.isArray(avl.list)) throw 'load the paired ' + vbase(V) + '.avl before building standalone chunk ' + id;
          const newPcaName = id + '.PCA';
          if (avl.list.some(x => x.name.toLowerCase() === newPcaName.toLowerCase())) throw 'cannot create ' + newPcaName + ': that audio entry already exists in ' + avl.name;
          const resolvePair = name => {
            const lcmName = String(name), lcsName = lcmName.replace(/\.LCM$/i, '.LCS');
            const lcm = getWad(lcmName), lcs = getWad(lcsName);
            const lcmFile = (Viewer.files || []).find(f => f && f.name.toLowerCase() === lcmName.toLowerCase() && String(f.vol || '').toLowerCase() === String(V).toLowerCase());
            const lcsFile = (Viewer.files || []).find(f => f && f.name.toLowerCase() === lcsName.toLowerCase() && String(f.vol || '').toLowerCase() === String(V).toLowerCase());
            return lcm && lcs && lcmFile && lcsFile ? {lcmName, lcsName, lcm, lcs, lcmFile, lcsFile} : null;
          };
          let donor = null, emptySeed = null;
          const requestedCleanDonor = String(record.cleanDonorLcm || '').trim();
          if (selectedTemplate) {
            donor = resolvePair(selectedTemplate);
            if (!donor) throw id + ': could not resolve the selected template LCS/LCM pair inside ' + V;
          } else {
            const candidateFiles = requestedCleanDonor
              ? (Viewer.files || []).filter(f => f && f.name.toLowerCase() === requestedCleanDonor.toLowerCase() && String(f.vol || '').toLowerCase() === String(V).toLowerCase())
              : (Viewer.files || []).filter(f => f && /\.LCM$/i.test(f.name || '') && String(f.vol || '').toLowerCase() === String(V).toLowerCase());
            const candidates = candidateFiles
              .map(f => resolvePair(f.name))
              .filter(Boolean)
              .map(pair => {
                let parsed = null; try { parsed = parseLcm(pair.lcm.A, pair.lcm.B); } catch (_) {}
                const title = String(wadName(pair.lcmFile.buf, pair.lcmFile) || '').replace(/\0/g, '').trim();
                let entities = [], entityError = '';
                try { entities = parseLcsInstances(pair.lcs.A, pair.lcs.B); } catch (error) { entityError = error && error.message || String(error); }
                const bossClasses = [...new Set(entities.filter(entity => entity && /boss/i.test(entity.n || '')).map(entity => entity.n))];
                const specialTitle = /\b(boss|hub)\b/i.test(title);
                const risk = (specialTitle ? 1000 : 0) + bossClasses.length * 100 + (entityError ? 10000 : 0);
                const rootInfo = inspectSpatialCellRoot(pair.lcm.A, pair.lcm.B, pair.lcmName);
                let drawQueueInfo = null, drawQueueError = '';
                try { drawQueueInfo = findLevelDrawQueues(pair.lcm.A, pair.lcm.B, pair.lcmName); } catch (error) { drawQueueError = error && error.message || String(error); }
                return {...pair, parsed, donorTitle:title, donorEntities:entities, donorRisk:risk, donorSpecialReasons:[...(specialTitle?['special title']:[]), ...(bossClasses.length?['boss classes: '+bossClasses.join(', ')]:[]), ...(entityError?['unreadable LCS: '+entityError]:[])], rootInfo, drawQueueInfo, drawQueueError};
              })
              .filter(pair => pair.parsed && pair.parsed.parts > 0)
              // Runtime-confirmed donors outrank render-part count. These are
              // grounded in user in-game tests: 30-17 works; 50-00 works while
              // the formerly-smallest 50-05 donor does not load reliably.
              .sort((a, b) => {
                const preferred = {'30.vol':'30-17.LCM','50.vol':'50-00.LCM'}[String(V).toLowerCase()] || '';
                const ap = a.lcmName.toLowerCase() === preferred.toLowerCase() ? 0 : 1;
                const bp = b.lcmName.toLowerCase() === preferred.toLowerCase() ? 0 : 1;
                return ap - bp || a.donorRisk - b.donorRisk || a.parsed.parts - b.parsed.parts || a.lcmName.localeCompare(b.lcmName);
              });
            const failures = [];
            if (requestedCleanDonor && !candidates.length) throw id + ': selected clean donor ' + requestedCleanDonor + ' is not a readable LCS/LCM pair inside ' + V;
            const viable = candidates.filter(candidate => candidate.rootInfo && candidate.rootInfo.ok && candidate.drawQueueInfo && !candidate.donorSpecialReasons.some(reason => reason.startsWith('unreadable LCS:')));
            const safeViable = viable.filter(candidate => candidate.donorRisk === 0);
            const preferredRuntimeDonor = {'30.vol':'30-17.LCM','50.vol':'50-00.LCM'}[String(V).toLowerCase()] || '';
            const knownRuntimeGood = preferredRuntimeDonor ? viable.find(candidate => candidate.lcmName.toLowerCase() === preferredRuntimeDonor.toLowerCase()) : null;
            // A confirmed in-game donor is allowed to outrank heuristic risk
            // labels. This preserves known working 30-17 and 50-00 choices,
            // while leaving untested candidates under the conservative filter.
            const orderedCandidates = requestedCleanDonor
              ? viable
              : [...(knownRuntimeGood ? [knownRuntimeGood] : []), ...safeViable.filter(candidate => candidate !== knownRuntimeGood)];
            if (!requestedCleanDonor && !orderedCandidates.length && viable.length) failures.push('all spatially compatible donors appear to be unverified boss/hub streams; choose a Clean donor LCM explicitly to override the safety filter');
            for (const candidate of orderedCandidates) {
              const sourceId = candidate.lcsName.replace(/\.LCS$/i, ''), sourcePcaName = sourceId + '.PCA';
              const pcaEntry = avl.list.find(x => x.name.toLowerCase() === sourcePcaName.toLowerCase());
              if (!pcaEntry) { failures.push(candidate.lcmName + ': no paired ' + sourcePcaName + ' in ' + avl.name); continue; }
              if (record.placementMode !== 'world') {
                const start = candidate.donorEntities.find(entity => entity && entity.n === 'NinjaStartPoint');
                if (!start || !Array.isArray(start.p) || !start.p.every(Number.isFinite)) { failures.push(candidate.lcmName + ': no readable NinjaStartPoint for spawn-relative placement'); continue; }
              }
              try {
                emptySeed = makeEmptyStandaloneLcm(candidate.lcm.A, candidate.lcm.B, candidate.lcmName, EC);
                donor = candidate;
                break;
              } catch (error) { failures.push(candidate.lcmName + ': ' + (error && error.message || error)); }
            }
            if (!donor) {
              const rejected = candidates.filter(candidate => !candidate.rootInfo?.ok || !candidate.drawQueueInfo || candidate.donorSpecialReasons.some(reason => reason.startsWith('unreadable LCS:'))).map(candidate => candidate.lcmName + ': ' + (!candidate.rootInfo?.ok ? (candidate.rootInfo?.reason || 'unsupported spatial root') : candidate.drawQueueError || candidate.donorSpecialReasons.join(', ') || 'unreadable donor')).slice(0, 8);
              throw id + ': no compatible automatic donor pair was found in ' + V + (requestedCleanDonor ? ' for selected clean donor ' + requestedCleanDonor : '') + (failures.length || rejected.length ? '. Tried: ' + [...failures, ...rejected].slice(0, 8).join(' | ') : '. Load a normal retail LCS/LCM pair with a matching PCA into the editor first.');
            }
          }
          const sourceId = donor.lcsName.replace(/\.LCS$/i, ''), sourcePcaName = sourceId + '.PCA';
          const pcaEntry = avl.list.find(x => x.name.toLowerCase() === sourcePcaName.toLowerCase());
          if (!pcaEntry) throw 'no ' + sourcePcaName + ' in the paired ' + vbase(V) + '.avl; a complete standalone chunk needs its cloned .PCA audio entry too';
          if (!Number.isInteger(pcaEntry.off) || !Number.isInteger(pcaEntry.size) || pcaEntry.off < 0 || pcaEntry.size <= 0 || pcaEntry.off + pcaEntry.size > avl.buf.byteLength) throw sourcePcaName + ' has an invalid archive range';
          let data;
          try { data = parseIninjaLevelBundle(base64ToBytes(record.bundle)); }
          catch (e) { throw id + ': could not reopen ' + (record.sourceName || record.name || 'the stored .inilevel') + ': ' + (e && e.message || e); }
          let placementDescription = 'preserve bundle world coordinates';
          if (record.placementMode !== 'world') {
            const placed = placementNearNinjaStart(data, donor.lcs.A, donor.lcs.B, donor.lcsName);
            data = placed.data;
            placementDescription = 'bundle centre translated to donor NinjaStartPoint +8 local-forward/+2Y; delta [' + placed.delta.map(v => Number(v.toFixed(3))).join(', ') + ']';
          }
          const writerOptions = {forceSingleSided: !!record.nativeSingleSided, untextured: !!record.nativeUntextured, useTemplateTexture: !!record.nativeTemplateTexture, clearTemplateFlag200: !!record.nativeClearTemplateFlag200, clearTemplateFlag20: !!record.nativeClearTemplateFlag20, referenceStaticTemplate: !!record.nativeReferenceStaticTemplate};
          const seedA = emptySeed ? emptySeed.A : donor.lcm.A, seedB = emptySeed ? emptySeed.B : donor.lcm.B;
          const built = appendInilevelRender(seedA, seedB, donor.lcmName, data, EC, writerOptions);
          const lcmHeaderSize = new DataView(donor.lcmFile.buf, donor.lcmFile.off, donor.lcmFile.size).getUint32(4, true) + 16;
          const lcmHeader = new Uint8Array(donor.lcmFile.buf, donor.lcmFile.off, lcmHeaderSize).slice();
          additions[newLcmName] = EC.packWad(lcmHeader, built.A, built.B);
          let removedDonorInstances = 0, retainedStartPointCount = 0, copiedHubSkyNames = [], hubSkyLcsName = '';
          if (selectedTemplate) {
            additions[newLcsName] = new Uint8Array(donor.lcsFile.buf, donor.lcsFile.off, donor.lcsFile.size).slice();
          } else {
            // A clean standalone must not inherit the donor's placed objects,
            // triggers, enemies, ambience emitters, pickups, or scripted props.
            // Keep the native NinjaStartPoint as the minimal player-spawn anchor;
            // keep the source class table/scripts/resources intact as conservative
            // loader scaffolding until a safe minimal-class format is understood.
            const donorEntities = parseLcsInstances(donor.lcs.A, donor.lcs.B);
            // A spawn point is useful but not required to create a clean chunk:
            // users may copy/place one manually after the archive build. Keep
            // any donor NinjaStartPoint instances that already exist, but allow
            // zero (and do not require exactly one).
            const startEntities = donorEntities.filter(entity => entity && entity.n === 'NinjaStartPoint');
            retainedStartPointCount = startEntities.length;
            const removeInstances = donorEntities
              .filter(entity => !entity || entity.n !== 'NinjaStartPoint')
              .map(entity => entity && entity.i)
              .filter(Number.isInteger);
            removedDonorInstances = removeInstances.length;
            const cleanOps = {del: removeInstances};
            let hubSkyWad = null;
            if (record.copyHubSkyEnvironment) {
              const volumePrefix = id.slice(0, 2);
              const requestedSkySource = String(record.skyEnvironmentSourceLcs || '').trim();
              const sameVolumeLcs = (Viewer.files || []).filter(file => file && /\.LCS$/i.test(file.name || '') && String(file.vol || '').toLowerCase() === String(V).toLowerCase());
              const inspectSkySource = file => {
                if (!file) return null;
                let wad = null, entities = [];
                try { wad = getWad(file.name); if (!wad) return null; entities = parseLcsInstances(wad.A, wad.B); }
                catch (_) { return null; }
                const custom = entities.find(entity => entity && /^CustomSkydome$/i.test(entity.n || ''));
                const blank = entities.find(entity => entity && /^SkydomeBlank$/i.test(entity.n || ''));
                const dome = custom || blank;
                return dome ? {name: file.name, wad, entities, dome, custom: !!custom, fog: entities.filter(entity => entity && /^Fog$/i.test(entity.n || ''))} : null;
              };
              let skySource = null;
              if (requestedSkySource) {
                const selectedFile = sameVolumeLcs.find(file => file.name.toLowerCase() === requestedSkySource.toLowerCase());
                if (!selectedFile) throw id + ': selected sky source ' + requestedSkySource + ' is not loaded from destination ' + V + '.';
                skySource = inspectSkySource(selectedFile);
                if (!skySource) throw id + ': selected sky source ' + requestedSkySource + ' has no readable CustomSkydome or SkydomeBlank instance.';
              } else {
                // Prefer the actual map/hub definition (-00) when present, then
                // the optional global fallback (-99), then any local map that
                // already carries the sky. Different volumes do not use one
                // universal convention for their sky setup.
                const orderedFiles = [...sameVolumeLcs].sort((a, b) => {
                  const rank = file => file.name.toLowerCase() === (volumePrefix + '-00.lcs') ? 0 : file.name.toLowerCase() === (volumePrefix + '-99.lcs') ? 1 : 2;
                  return rank(a) - rank(b) || a.name.localeCompare(b.name);
                });
                for (const file of orderedFiles) { skySource = inspectSkySource(file); if (skySource) break; }
                if (!skySource) throw id + ': no readable CustomSkydome or SkydomeBlank instance was found in any loaded LCS in ' + V + '. Select/load a level LCS that already contains the sky environment.';
              }
              hubSkyLcsName = skySource.name;
              hubSkyWad = skySource.wad;
              const dome = skySource.dome;
              const environmentEntities = [dome, ...skySource.fog];
              const sourceReports = EC.classReports(hubSkyWad.A, hubSkyWad.B);
              const donorReports = EC.classReports(donor.lcs.A, donor.lcs.B);
              const classNames = [...new Set(environmentEntities.map(entity => entity.n))];
              cleanOps.classes = [];
              for (const className of classNames) {
                const sourceReport = sourceReports[className];
                if (!sourceReport || String(sourceReport.fingerprint || '').startsWith('analysis-error:')) throw id + ': could not verify the ' + className + ' class in ' + hubSkyLcsName + '; sky environment copy was stopped rather than risking a mismatched script.';
                const donorReport = donorReports[className];
                if (!donorReport) {
                  cleanOps.classes.push({from: {w: hubSkyLcsName, name: className}, variants: []});
                } else if (donorReport.fingerprint !== sourceReport.fingerprint) {
                  // Preserve the donor's existing class and import this source
                  // implementation under a private alias. The copied instance
                  // is rebound to that alias by patchLcs, including its own
                  // class/script/resource closure.
                  const suffix = hubSkyLcsName.replace(/\.LCS$/i, '').replace(/[^A-Za-z0-9]/g, '_');
                  const alias = className + '__SkySrc_' + suffix;
                  cleanOps.classes.push({from: {w: hubSkyLcsName, name: className}, variants: [{name: className, alias}]});
                }
              }
              cleanOps.adds = environmentEntities.map((entity, index) => {
                if (!Array.isArray(entity.p) || !entity.p.every(Number.isFinite)) throw id + ': ' + hubSkyLcsName + ' contains a ' + entity.n + ' instance without a readable position.';
                return {id: 'sky-env-' + index, from: {w: hubSkyLcsName, i: entity.i}, p: entity.p, dy: 0};
              });
              copiedHubSkyNames = environmentEntities.map(entity => entity.n);
            }
            const stripped = EC.patchLcs(
              donor.lcs.A,
              donor.lcs.B,
              cleanOps,
              donor.lcsName,
              name => hubSkyWad && String(name).toLowerCase() === hubSkyLcsName.toLowerCase() ? hubSkyWad : null,
              {}
            );
            const readbackEntities = parseLcsInstances(stripped.A, stripped.B);
            const expectedCounts = new Map();
            for (const entity of startEntities) expectedCounts.set(entity.n, (expectedCounts.get(entity.n) || 0) + 1);
            for (const name of copiedHubSkyNames) expectedCounts.set(name, (expectedCounts.get(name) || 0) + 1);
            const actualCounts = new Map();
            for (const entity of readbackEntities) if (entity && entity.n) actualCounts.set(entity.n, (actualCounts.get(entity.n) || 0) + 1);
            if (readbackEntities.length !== startEntities.length + copiedHubSkyNames.length || [...expectedCounts].some(([name, count]) => actualCounts.get(name) !== count)) {
              throw id + ': clean standalone LCS verification failed after donor stripping' + (copiedHubSkyNames.length ? ' and hub sky import from ' + hubSkyLcsName : '') + '; only NinjaStartPoint and explicitly copied sky environment instances should remain';
            }
            const lcsHeaderSize = new DataView(donor.lcsFile.buf, donor.lcsFile.off, donor.lcsFile.size).getUint32(4, true) + 16;
            if (!Number.isInteger(lcsHeaderSize) || lcsHeaderSize < 16 || lcsHeaderSize > donor.lcsFile.size) throw id + ': donor LCS header is invalid';
            const lcsHeader = new Uint8Array(donor.lcsFile.buf, donor.lcsFile.off, lcsHeaderSize).slice();
            additions[newLcsName] = EC.packWad(lcsHeader, stripped.A, stripped.B);
          }
          avlAdditions[newPcaName] = new Uint8Array(avl.buf, pcaEntry.off, pcaEntry.size).slice();
          if (selectedTemplate) {
            standaloneReports.push(id + ': cloned ' + donor.lcsName + '/' + donor.lcmName + ' as ' + newLcsName + '/' + newLcmName + ' plus ' + newPcaName + '; appended ' + built.added.parts + ' render part(s), ' + built.added.triangles + ' render triangle(s), ' + built.added.collisionSourceTriangles + ' source collision face(s) routed into ' + built.added.collisionTriangles + ' final KD region placement(s); ' + placementDescription + '. Template STRATs, scenery and existing collision are copied as-is.');
          } else {
            standaloneReports.push(id + ': created clean custom-only LCM from ' + (requestedCleanDonor ? 'selected clean donor ' : 'automatic safe donor ') + donor.lcmName + (donor.donorTitle ? ' [' + donor.donorTitle + ']' : '') + ' (donor used only for loader/render scaffolding; neutralised ' + emptySeed.report.neutralisedParts + ' draw parts and cleared ' + emptySeed.report.originalCollisionTriangles + ' donor collision triangles); rebuilt ' + newLcsName + ' from donor ' + donor.lcsName + ' with ' + retainedStartPointCount + ' NinjaStartPoint instance(s) retained (' + removedDonorInstances + ' other donor STRAT instances removed; zero spawn points is allowed and one can be copied in manually; donor class definitions/scripts/resources retained as loader scaffolding)' + (copiedHubSkyNames.length ? '; copied hub sky environment [' + copiedHubSkyNames.join(', ') + '] from ' + hubSkyLcsName : '') + '; cloned paired ' + sourcePcaName + ' as ' + newPcaName + '; appended ' + built.added.parts + ' custom render part(s), ' + built.added.triangles + ' render triangle(s), ' + built.added.collisionSourceTriangles + ' source collision face(s) routed into ' + built.added.collisionTriangles + ' final KD region placement(s); ' + placementDescription + '.');
          }
        }
        // Rebuild copied sound PCA blocks, then lay this volume's AVL out again.
        let ap = null, avlOut = '';
        if (Object.keys(plans).length || Object.keys(avlAdditions).length) {
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
          ap = Object.keys(avlAdditions).length ? EC.rebuildVolWithAdditions(A.buf, rep2, avlAdditions) : EC.rebuildVol(A.buf, rep2);
          avlOut = A.name.replace(/\.avl$/i, '') + '.patched.avl';
        }
        const vf = Viewer.files.find(x => x.vol === V);
        const volumeParts = Object.keys(additions).length ? EC.rebuildVolWithAdditions(vf.buf, rep, additions) : EC.rebuildVol(vf.buf, rep);
        outs.push({V, parts:volumeParts, out:V.replace(/\.vol$/i, '') + '.patched.vol', ap, avlOut, A:ap && getAvl(V).name, n:byVol[V] || []});
      }
      // Space downloads so browsers do not drop multiple file downloads.
      let k = 0;
      for (const o of outs) {
        setTimeout(() => dl(o.parts, o.out, 'application/octet-stream'), 600*k++);
        if (o.ap) setTimeout(() => dl(o.ap, o.avlOut, 'application/octet-stream'), 600*k++);
      }
      $('ed_sum').textContent = 'built ' + outs.map(o => o.out + (o.ap ? ' + ' + o.avlOut : '')).join(', ') + ' (' + [...names, ...standaloneRecords.flatMap(r => [String(r.standaloneId).trim() + '.LCS', String(r.standaloneId).trim() + '.LCM'])].join(', ') + '). Back up your originals, then replace each with its patched file (rename it to the original name).' +
        (outs.some(o => o.ap) ? ' Sounds were copied, so a patched .avl was built for ' + outs.filter(o => o.ap).map(o => o.V).join(', ') + ': install it together with its .vol.' : '') +
        (healed.length ? ' Added missing entries to the level resource directory: ' + healed.join(', ') + '.' : '') +
        (texRep.length ? ' Textures: ' + texRep.join(' | ') + '.' : '') +
        (tintRep.length ? ' Colour tints: ' + tintRep.join(' | ') + '.' : '') +
        (customModelReports.length ? ' Custom models: ' + customModelReports.join(' | ') + '.' : '') +
        (nativeLevelReports.length ? ' Native level build: ' + nativeLevelReports.join(' | ') + '.' : '') +
        (standaloneReports.length ? ' Separate streamed chunk prototype: ' + standaloneReports.join(' | ') + ' The original template pair remains unchanged. A StreamNextArea/transition reference to the new ID is still a separate step; this build does not create a portal, world-map entry or prove in-game streaming.' : '') +
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
