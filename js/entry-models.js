// Resolve a map STRAT's initial visible appearance from PC entry-routine model
// setters, indirect class-table references, and directly spawned visual children.
// This module is intentionally read-only: it never modifies a WAD or game resource.

const NUM = '[-+]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:e[-+]?\\d+)?';

function stripOuterParens(text) {
  let s = String(text ?? '').trim();
  while (s.startsWith('(') && s.endsWith(')')) {
    let depth = 0, wraps = true;
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '(') depth++;
      else if (s[i] === ')') depth--;
      if (depth === 0 && i < s.length - 1) { wraps = false; break; }
      if (depth < 0) { wraps = false; break; }
    }
    if (!wraps || depth !== 0) break;
    s = s.slice(1, -1).trim();
  }
  return s;
}

function splitTopLevel(text, op) {
  const s = String(text), out = [];
  let depth = 0, start = 0;
  for (let i = 0; i <= s.length - op.length; i++) {
    const c = s[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    if (depth === 0 && s.startsWith(op, i)) {
      out.push(s.slice(start, i).trim());
      start = i + op.length;
      i += op.length - 1;
    }
  }
  if (out.length) out.push(s.slice(start).trim());
  return out;
}

function initValue(params, index) {
  const p = params?.[index];
  if (p == null) return null;
  const n = typeof p === 'number' ? p : Number(p.v);
  return Number.isFinite(n) ? n : null;
}

// Three-valued evaluation. Save flags may be supplied as a preview assumption;
// random branches intentionally remain unknown and are handled deterministically
// only for static map preview, never for native/game output.
export function evaluateEntryCondition(expression, params = [], options = {}) {
  let s = stripOuterParens(expression);
  if (!s) return true;
  const ors = splitTopLevel(s, '||');
  if (ors.length) {
    const values = ors.map(x => evaluateEntryCondition(x, params, options));
    if (values.includes(true)) return true;
    return values.every(x => x === false) ? false : null;
  }
  const ands = splitTopLevel(s, '&&');
  if (ands.length) {
    const values = ands.map(x => evaluateEntryCondition(x, params, options));
    if (values.includes(false)) return false;
    return values.every(x => x === true) ? true : null;
  }
  if (s.startsWith('!')) {
    const v = evaluateEntryCondition(s.slice(1), params, options);
    return v === null ? null : !v;
  }
  if (/^Save_GetMyFlag\s*\(\s*\)$/i.test(s))
    return typeof options.defaultSaveFlag === 'boolean' ? options.defaultSaveFlag : null;
  if (/^Rand_Bool\s*\(\s*\)$/i.test(s)) return null;
  let m = s.match(new RegExp('^@([0-9]+)\\s*(==|!=|<=|>=|<|>)\\s*(' + NUM + ')$','i'));
  if (m) {
    const left = initValue(params, Number(m[1]));
    if (left === null) return null;
    const right = Number(m[3]);
    switch (m[2]) {
      case '==': return left === right;
      case '!=': return left !== right;
      case '<': return left < right;
      case '>': return left > right;
      case '<=': return left <= right;
      case '>=': return left >= right;
    }
  }
  m = s.match(/^@([0-9]+)$/);
  if (m) {
    const value = initValue(params, Number(m[1]));
    return value === null ? null : value !== 0;
  }
  return null;
}

function conditionState(conditions, params, options) {
  let unknown = false;
  for (const condition of conditions || []) {
    const value = evaluateEntryCondition(condition, params, options);
    if (value === false) return false;
    if (value === null) unknown = true;
  }
  return unknown ? null : true;
}

const validGroup = g => !!g && !g.suppressed && Array.isArray(g.parts) && g.parts.length > 0 && (g.kind === 'model' || g.source === 'groundtruth' || g.source === 'descriptor');

function groupForRef(ref, AL, q, A, dv) {
  let table = Number.isInteger(ref.table) ? ref.table : null;
  if (table === null && Number.isInteger(ref.register)) table = initValue(q?.params, ref.register);
  if (!Number.isInteger(table) || table < 4 || (table & 3) || table + 4 > A.length) return null;
  const descriptor = dv.getUint32(table, true);
  if (!descriptor || descriptor + 0x30 > A.length) return null;
  const candidates = (AL.modelGroups || []).filter(g => g.descriptor === descriptor && validGroup(g));
  candidates.sort((a, b) => {
    const rank = g => g.source === 'groundtruth' ? 3 : g.source === 'script' ? 2 : g.source === 'descriptor' ? 1 : 0;
    return rank(b) - rank(a) || (b.refs || 0) - (a.refs || 0) || String(a.id).localeCompare(String(b.id));
  });
  return candidates[0] || null;
}

function chooseCandidate(refs, AL, q, A, dv, options) {
  const rows = [];
  for (const ref of refs) {
    const state = conditionState(ref.conditions, q?.params || [], options);
    if (state === false) continue;
    const group = groupForRef(ref, AL, q, A, dv);
    if (group) rows.push({ ref, group, state });
  }
  rows.sort((a, b) => (a.ref.call || 0) - (b.ref.call || 0));
  const known = rows.filter(x => x.state === true);
  if (known.length) {
    // For the map's base appearance, the first active setter is the entry-time
    // model. Later setters commonly belong to collapse/damage/state transitions.
    return { ...known[0], certainty: 'known' };
  }
  const uncertain = rows.filter(x => x.state === null);
  if (uncertain.length && uncertain.every(x => (x.ref.conditions || []).some(c => /Rand_Bool\s*\(/i.test(c)))) {
    return { ...uncertain[0], certainty: 'random-preview-first-variant', randomPreview: true };
  }
  const unique = [...new Map(uncertain.map(x => [x.group.id, x])).values()];
  if (unique.length === 1) return { ...unique[0], certainty: 'single-unknown-variant' };
  return null;
}

function directSelection(AL, q, A, dv, options) {
  const refs = AL.entryModelRefs?.[q.n] || [];
  const visible = refs.filter(r => r.native === 'Strat_SetModel' || r.native === 'Strat_SetModelEx');
  const collide = refs.filter(r => r.native === 'Strat_SetModelCollide');
  const allDefinitelyInactive = rows => rows.length > 0 && rows.every(r =>
    (r.conditions || []).some(c => conditionState([c], q?.params || [], options) === false && /@[0-9]+/.test(c) && !/(?:Save_GetMyFlag|Rand_Bool)\s*\(/i.test(c))
  );
  if (visible.length) {
    const selected = chooseCandidate(visible, AL, q, A, dv, options);
    if (selected) return { group: selected.group, ref: selected.ref, native: selected.ref.native, reason: 'entry-visual-setter', certainty: selected.certainty, randomPreview: !!selected.randomPreview };
    const fallback = chooseCandidate(collide, AL, q, A, dv, options);
    if (fallback) return { group: fallback.group, ref: fallback.ref, native: fallback.ref.native, reason: 'entry-collision-fallback', certainty: fallback.certainty, randomPreview: !!fallback.randomPreview };
    // An explicit setter whose conditions are false means this instance does
    // not install that model at entry. Do not resurrect a destroyed/alternate
    // mesh from broad class-table associations in that case.
    if (allDefinitelyInactive(visible) && (!collide.length || allDefinitelyInactive(collide)))
      return { group: null, reason: 'entry-model-setters-inactive', handled: true };
    return null;
  }
  const selected = chooseCandidate(collide, AL, q, A, dv, options);
  if (selected) return { group: selected.group, ref: selected.ref, native: selected.ref.native, reason: 'entry-collision-only-model', certainty: selected.certainty, randomPreview: !!selected.randomPreview };
  if (allDefinitelyInactive(collide))
    return { group: null, reason: 'entry-model-setters-inactive', handled: true };
  return null;
}

function indirectClassSelection(AL, q) {
  const groups = (AL.modelGroups || []).filter(g => validGroup(g) && (g.probableClasses || []).includes(q.n) && (g.classTableRefs || []).some(r => r.cls === q.n));
  const unique = [...new Map(groups.map(g => [g.id, g])).values()];
  if (unique.length === 1) return { group: unique[0], reason: 'unique-class-table-reference', certainty: 'indirect-class-table' };
  // Some intact breakable props keep their base model as a class-table reference
  // while one-record debris pieces are also referenced by the same class. If a
  // single candidate is strictly larger than every alternative and all other
  // candidates are one-part fragments, it is the only defensible whole-object
  // fallback (e.g. petescreens01 plus gretvbrokebit01/02).
  if (unique.length > 1) {
    const sorted = [...unique].sort((a, b) => b.parts.length - a.parts.length);
    if (sorted[0].parts.length > 1 && sorted.slice(1).every(g => g.parts.length === 1) && sorted[0].parts.length > sorted[1].parts.length)
      return { group: sorted[0], reason: 'largest-whole-class-table-reference', certainty: 'indirect-whole-model' };
  }
  return null;
}

function groundTruthSelection(AL, q) {
  const groups = (AL.modelGroups || []).filter(g => validGroup(g) && g.source === 'groundtruth' && (g.classes || []).includes(q.n));
  const unique = [...new Map(groups.map(g => [g.id, g])).values()];
  if (unique.length === 1) return { group: unique[0], reason: 'confirmed-groundtruth-class', certainty: 'groundtruth' };
  return null;
}

function resolveBase(AL, q, A, dv, options) {
  const direct = directSelection(AL, q, A, dv, options);
  if (direct?.handled) return direct;
  return direct || groundTruthSelection(AL, q) || indirectClassSelection(AL, q) || { group: null, reason: 'no-entry-model-evidence' };
}

function sameGeometry(a, b) {
  const ap = (a?.parts || []).map(x => x.p).filter(Number.isInteger);
  const bp = (b?.parts || []).map(x => x.p).filter(Number.isInteger);
  if (!ap.length || !bp.length) return false;
  const bs = new Set(bp);
  const common = ap.filter(x => bs.has(x)).length;
  return common / Math.min(ap.length, bp.length) >= 0.9;
}

const NO_MAP_APPEARANCE = /^(?:PopupHelp(?:2|Ninja)?|EnterRegionToActivateStrats|StreamCheckComplete)$/i;
// Some classes are map helpers/controllers whose shared class-table references
// are not their own visible model. They may still have legitimate spawned
// children, so suppress only the root appearance and continue spawn traversal.
const NO_OWN_MODEL = /^(?:GrindRailHelper)$/i;
function skipSpawnClass(name) {
  return NO_MAP_APPEARANCE.test(name || '') || /^(?:DWExplode|DWBodyBit|KappaBodyBit)$/i.test(name || '') || (!/^FloatingTeleportCamera(?:Body|Arm)$/i.test(name || '') && /(?:Cutscene|Prompt|Dialog|Explosion|Explode|Flare|Smoke|Particle|Pickup|Debris|Chaser|Teleport|Restart|GeneratorPart|SpawnPickups|ComputerBit|Charging|SnapToParentLaser)/i.test(name || ''));
}
function noMapAppearance(name) { return NO_MAP_APPEARANCE.test(name || ''); }

// Robot_SneakDoor_Part offsets itself during entry using its direction vector
// (prop149) and its first init register. Keep the script-derived -4/+5 local
// offsets, but do not rotate the child mesh: the previous 180-degree preview
// correction was not visually correct for the affected placed instances.
function entryChildTransform(ownerName, childName, detail) {
  if (ownerName === 'Robot_SneakDoor' && childName === 'Robot_SneakDoor_Part') {
    const part = Number(detail?.init?.[0]?.value);
    if (part === 0) return { offset: [0, 0, -4], rotation: [0, 0, 0] };
    if (part === 1) return { offset: [0, 0, 5], rotation: [0, 0, 0] };
  }
  return { offset: [0, 0, 0], rotation: [0, 0, 0] };
}

function singleVisualGroupForClass(AL, className, displayName) {
  const groups = (AL.modelGroups || []).filter(g => validGroup(g) && g.name === displayName && (g.classes || []).includes(className));
  return groups.length === 1 ? groups[0] : null;
}

function singleModelGroupByName(AL, displayName) {
  const groups = (AL.modelGroups || []).filter(g => validGroup(g) && g.name === displayName);
  return groups.length === 1 ? groups[0] : null;
}

// The class scripts for these retail props do not expose the intact base model
// through an entry-time visible setter. The level still contains a unique model
// descriptor whose name distinguishes the intact object from its breakable
// fragments; use that descriptor for editor-only static map previews.
const INTACT_PREVIEW_MODELS = Object.freeze({
  BarrelOfPickups: 'sap_barrel',
  BarrelWithMissionGoalPickup: 'sap_barrel',
  BarrelOfPickupsForest: 'cylwoodbar01',
  BarrelOfPickupsForest2: 'cylwoodbar01',
  BarrelWithMissionGoalPickupForest: 'cylwoodbar01',
  BreakableComputerScreen: 'petescreens01'
});

export function resolveEntryModelSelection(AL, q, A, options = {}) {
  if (!AL || !q || !A || !Array.isArray(A) && !(A instanceof Uint8Array))
    return { group: null, groupOffset: [0,0,0], spawnedGroups: [], spawnedModels: [], reason: 'missing-input' };
  // These are map-control/trigger classes, not visible world props. PopupHelp
  // can spawn a temporary dialog helper at runtime; that helper is not part
  // of the static map appearance either.
  if (noMapAppearance(q.n))
    return { group: null, groupOffset: [0,0,0], spawnedGroups: [], spawnedModels: [], spawnedChildren: [], reason: 'non-rendering-trigger', noMapAppearance: true };

  // For a static map view, objects with save-controlled damage variants start
  // in the intact state. The viewer can override this assumption in future.
  const opts = { defaultSaveFlag: false, ...options };
  const dv = new DataView(A.buffer, A.byteOffset, A.byteLength);
  // The open-state Robot_SneakDoor instances (#44 in 10-31 and #74/#76/#77
  // in 10-32) have repeatedly previewed incorrectly as two spawned halves.
  // The user prefers the same stable combined appearance used by the working
  // closed-state instances. For the static editor preview, represent every
  // @1!=0 door with the class's RobotBigCollisi model and do not add its parts.
  // This is preview-only and does not alter the map STRAT or game state.
  const sneakDoorOpen = q.n === 'Robot_SneakDoor' && initValue(q.params, 1) !== null && initValue(q.params, 1) !== 0;
  const closedSneakDoorGroup = sneakDoorOpen
    ? singleVisualGroupForClass(AL, 'Robot_SneakDoor', 'RobotBigCollisi')
    : null;
  let result = closedSneakDoorGroup
    ? { group: closedSneakDoorGroup, reason: 'user-requested-closed-door-preview', certainty: 'explicit-preview-policy', previewOverride: true }
    : (NO_OWN_MODEL.test(q.n || '')
      ? { group: null, reason: 'helper-class-no-own-map-model', handled: true }
      : resolveBase(AL, q, A, dv, opts));

  // Static map previews should represent the intact/default object, not an
  // unresolved collision-only, broken, or controller-state mesh. These
  // overrides are visual-only and do not modify the STRAT or game data.
  const namedIntact = INTACT_PREVIEW_MODELS[q.n];
  if (!result.group && namedIntact) {
    const fallback = singleModelGroupByName(AL, namedIntact);
    if (fallback) result = { group: fallback, reason: 'editor-intact-preview-asset-override', certainty: 'unique-intact-model-descriptor', previewOverride: true };
  }
  if (q.n === 'ForestBamboo3') {
    const fallback = singleVisualGroupForClass(AL, 'ForestBamboo3', 'bamboofull');
    if (fallback) result = { group: fallback, reason: 'editor-intact-preview-asset-override', certainty: 'unique-intact-class-model', previewOverride: true };
  }
  if (q.n === 'CopterRanx' && !result.group) {
    const fallback = singleVisualGroupForClass(AL, 'CopterRanx', 'Rax Copter');
    if (fallback) result = { group: fallback, reason: 'editor-static-copter-preview-fallback', certainty: 'unique-class-model-param0-zero', previewOverride: true };
  }
  // SneakSentinel's entry model is gated by @7, but several retail level
  // instances start with @7=0 and are still intended to be visible scenery.
  // Reuse the unique Toes_Right body mesh wherever that entry branch is skipped.
  if (!result.group && q.n === 'SneakSentinel') {
    const fallback = singleVisualGroupForClass(AL, 'SneakSentinel', 'Toes_Right');
    if (fallback) result = { group: fallback, reason: 'editor-sentinel-preview-fallback', certainty: 'unique-class-model-param7-zero', previewOverride: true };
  }
  let group = result.group || null;
  let groupOffset = [0,0,0];
  let groupRotation = [0,0,0];
  const spawnedModels = [];
  const asOffset = value => Array.isArray(value) && value.length >= 3
    ? value.slice(0,3).map(v => Number.isFinite(Number(v)) ? Number(v) : 0)
    : [0,0,0];
  const addOffset = (a,b) => [0,1,2].map(i => (Number(a?.[i])||0)+(Number(b?.[i])||0));
  const sameOffset = (a,b) => asOffset(a).every((v,i) => Math.abs(v-asOffset(b)[i]) < 1e-4);
  const samePlacement = (g1,o1,g2,o2) => (g1?.id === g2?.id || sameGeometry(g1,g2)) && sameOffset(o1,o2);
  const addSpawnModel = (childGroup, offset, meta = {}) => {
    const rotation = asOffset(meta.rotation);
    if (!childGroup || (group && samePlacement(group, groupOffset, childGroup, offset)) || spawnedModels.some(x => samePlacement(x.group, x.offset, childGroup, offset) && asOffset(x.rotation).every((v,i)=>Math.abs(v-rotation[i])<1e-4))) return false;
    spawnedModels.push({ group: childGroup, offset: asOffset(offset), rotation, cls: meta.cls || null, owner: meta.owner || null });
    return true;
  };
  const spawnRecords = ownerName => {
    const details = AL.entrySpawnDetailsByClass?.[ownerName] || [];
    if (details.length) return details;
    return (AL.entryInitialSpawnsByClass?.[ownerName] || []).map(name => ({name, offset:[0,0,0], init:[]}));
  };
  const childParams = (detail, ownerParams = []) => Array.isArray(detail?.init)
    ? detail.init.map(v => {
        if (!v) return null;
        // The class analyser preserves register references as kind "y".
        // They are not literal numbers: substitute the owning map/spawn
        // instance's init register before resolving the child model.
        const raw = v.kind === 'y' ? initValue(ownerParams, Number(v.value)) : v.value;
        const n = Number(raw);
        return Number.isFinite(n) ? {v:n, kind:v.kind} : null;
      })
    : [];

  // Include every directly spawned visual child, then inspect each child's
  // entry spawns. Some map objects are assembled from sibling STRATs; others
  // use a child which itself spawns the remaining visual components.
  const MAX_SPAWN_DEPTH = 2;
  const MAX_SPAWNED_VISUALS = 16;
  const rootPath = new Set([`${q.n}|${(q.params||[]).map(x=>x?.v??'?').join(',')}`]);
  const resolveSpawnLayer = (ownerName, ownerParams, depth, parentOffset = [0,0,0], parentRotation = [0,0,0], path = rootPath) => {
    if (depth >= MAX_SPAWN_DEPTH || spawnedModels.length >= MAX_SPAWNED_VISUALS) return;
    for (const detail of spawnRecords(ownerName)) {
      if (spawnedModels.length >= MAX_SPAWNED_VISUALS) break;
      const childName = detail?.name;
      if (!childName || skipSpawnClass(childName)) continue;
      const spawnState = conditionState(detail.conditions || [], ownerParams, opts);
      if (spawnState === false) continue;
      const params = childParams(detail, ownerParams);
      const scripted = entryChildTransform(ownerName, childName, detail);
      const offset = addOffset(addOffset(parentOffset, asOffset(detail.offset)), scripted.offset);
      const rotation = addOffset(parentRotation, scripted.rotation || [0,0,0]);
      const child = resolveBase(AL, { n: childName, params }, A, dv, opts);
      if (child.group) {
        if (!group) {
          group = child.group;
          groupOffset = offset;
          groupRotation = rotation;
          result.group = group;
          result.groupOffset = groupOffset;
          result.groupRotation = groupRotation;
          result.reason = 'entry-spawned-child';
          result.spawnedChildClass = childName;
          result.childSelection = child;
        } else {
          addSpawnModel(child.group, offset, {cls:childName, owner:ownerName, rotation});
        }
      }
      // Continue through controller/intermediate STRATs as well as visible
      // children. Use a path-local cycle guard so repeated sibling instances
      // of the same class can still appear at different positions.
      const pathKey = `${childName}|${params.map(x=>x?.v??'?').join(',')}`;
      if (!path.has(pathKey)) {
        const nextPath = new Set(path);
        nextPath.add(pathKey);
        resolveSpawnLayer(childName, params, depth + 1, offset, rotation, nextPath);
      }
    }
  };
  if (!sneakDoorOpen) resolveSpawnLayer(q.n, q.params || [], 0, [0,0,0], [0,0,0], rootPath);
  result.group = group;
  result.groupOffset = groupOffset;
  result.groupRotation = groupRotation;
  result.spawnedModels = spawnedModels;
  result.spawnedGroups = spawnedModels.map(x => x.group); // Backwards-compatible group-only view.
  result.spawnedChildren = spawnedModels.map(x => x.cls || x.group.classes?.[0] || x.group.probableClasses?.[0] || x.group.name);
  return result;
}

export function resolveEntryModelGroup(AL, q, A) {
  return resolveEntryModelSelection(AL, q, A).group;
}
