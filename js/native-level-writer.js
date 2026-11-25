// Stage 2: append Blender .inilevel render resources and merge native collision into a retail LCM.
// Imported render resources and separate tagged collision geometry are merged into a native LCM.
// When collision is added, preserve the retail KD split backbone and extend only the destination leaves/empty branches.
import {fixups, parseLcm, parseColl} from './vol-core.js?v=step146-strat-appearance-preview';

const TEXT_ENCODER = new TextEncoder();
const u32 = (d, o) => d.getUint32(o, true);
const f32 = (d, o) => d.getFloat32(o, true);
const w32 = (d, o, v) => d.setUint32(o, v >>> 0, true);
const isFinite3 = (p) => p.length === 3 && p.every(Number.isFinite);

function doubleSidedTriangleList(indices, label) {
  if (!(indices instanceof Uint16Array) || indices.length < 3 || indices.length % 3) {
    throw label + ': triangle-list indices are invalid';
  }
  // LCM level-part templates use the game's normal back-face culling state.
  // The .inilevel material's doubleSided bit has no native per-material field
  // in this writer, so emit the reverse-wound face as well. This is equivalent
  // to the two-sided preview material and keeps either viewing side visible.
  const out = new Uint16Array(indices.length * 2);
  let at = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i], b = indices[i + 1], c = indices[i + 2];
    out[at++] = a; out[at++] = b; out[at++] = c;
    out[at++] = a; out[at++] = c; out[at++] = b;
  }
  return out;
}

function triangleStrip(indices, label) {
  if (!(indices instanceof Uint16Array) || indices.length < 3 || indices.length % 3) {
    throw label + ': triangle-list indices are invalid';
  }
  const out = [indices[0], indices[1], indices[2]];
  for (let t = 3; t < indices.length; t += 3) {
    const a = indices[t], b = indices[t + 1], c = indices[t + 2];
    const last = out[out.length - 1];
    // Retail LCM parts are triangle strips. Degenerate connectors keep the
    // source triangle order while allowing independent Blender triangles.
    const odd = ((out.length + 2) & 1) !== 0;
    out.push(last, odd ? b : a, odd ? b : a, odd ? a : b, c);
  }
  return Uint16Array.from(out);
}

function findRenderTemplate(A, B, wadName, allowedParts = null, options = {}) {
  const referenceStaticPart = 0x3e3f60; // verified plain opaque wall part in 10-20.LCM
  if (options.referenceStaticTemplate && String(wadName).toLowerCase() !== '10-20.lcm') {
    throw wadName + ': the plain Heart Room Wall reference template is verified only for 10-20.LCM';
  }
  const imp = fixups(B), parts = (imp[0x80000020] || []).slice().sort((a, b) => a - b);
  const vertexBuffers = new Set(imp[0x80000023] || []), textures = new Set(imp[0x80000001] || []);
  const d = new DataView(A.buffer, A.byteOffset, A.byteLength), rel = imp.rel;
  // Verified retail draw-part layouts. We choose an unlinked opaque queue head
  // as the clone template; the +0x44 queue-next pointer is written explicitly
  // when the cloned part is inserted into the live opaque list.
  const layouts = options.untextured ? {
    // Retail untextured c0 parts have no +0x10 texture pointer. Their three
    // render-state records live at +0x50 and are addressed by +0x28.
    0xc0: {internal: [0x28, 0x38], hasTexture: false}
  } : {
    0xb0: {internal: [0x30, 0x38], hasTexture: true},
    0xc0: {internal: [0x20, 0x30, 0x38], hasTexture: true},
    0xd0: {internal: [0x20, 0x30, 0x38], hasTexture: true},
    0x100: {internal: [0x28, 0x30, 0x38], hasTexture: true}
  };
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]; if (allowedParts && !allowedParts.has(p)) continue;
    if (options.referenceStaticTemplate && p !== referenceStaticPart) continue;
    const next = parts[i + 1] ?? (p + 0x400), partSize = next - p;
    const layout = layouts[partSize];
    if (!layout || p + partSize > A.length) continue;
    const tail = partSize - 0x2c, metaSlot = partSize - 0x30;
    // The per-part +0x44 next pointer is deliberately excluded from template
    // shape matching: the writer always replaces it with the destination
    // opaque-queue head, whether or not that retail template slot is relocated.
    const rels = [...rel].filter(o => o >= p && o < p + partSize && o !== p + 0x44).map(o => o - p).sort((a, b) => a - b);
    const expected = [0x0c, ...(layout.hasTexture ? [0x10] : []), ...layout.internal, metaSlot].sort((a, b) => a - b);
    if (rels.length !== expected.length || rels.some((v, k) => v !== expected[k])) continue;
    const vb = u32(d, p + 0x0c), tex = u32(d, p + 0x10), meta = u32(d, p + metaSlot);
    if (!vertexBuffers.has(vb) || (layout.hasTexture ? (!tex || !textures.has(tex)) : tex !== 0) || !meta || meta + 0x60 > A.length) continue;
    if (layout.internal.some(o => { const target = u32(d, p + o); return target < p || target >= p + partSize; })) continue;
    if (layout.internal.includes(0x20) && u32(d, p + 0x20) !== p + 0x50) continue;
    if (layout.internal.includes(0x28) && u32(d, p + 0x28) !== p + 0x50) continue;
    if (layout.hasTexture && u32(d, p + 0x30) !== p + partSize - 0x60) continue;
    if (!layout.hasTexture && (u32(d, p + 0x24) !== 3 || u32(d, p + 0x2c) !== 0 || u32(d, p + 0x30) !== 0)) continue;
    if (u32(d, p + 0x38) !== p + partSize - 0x3c) continue;
    if (u32(d, p + tail - 20) !== 1 || u32(d, p + tail - 16) !== 5 || u32(d, p + tail + 12) !== 0) continue;
    if (u32(d, vb) !== 0x0054bbd8 || !rel.has(vb + 0x10) || !rel.has(vb + 0x18)) continue;
    if (layout.hasTexture && (u32(d, tex + 0x10) < 0x20 || !rel.has(tex + 0x10))) continue;
    const templateName = new TextDecoder().decode(A.subarray(meta + 0x20, meta + 0x30)).replace(/\0.*$/, '').trim();
    if (options.referenceStaticTemplate && (p !== referenceStaticPart || partSize !== 0xb0 || !layout.hasTexture || templateName.toLowerCase() !== 'heart room wall' || u32(d, p + 0x40) !== 0x61 || tex !== 0x251240)) {
      throw wadName + ': the expected Heart Room Wall reference part no longer matches its verified static template signature';
    }
    // The level-part auxiliary record is a 0x60-byte, pointer-free record.
    if ([...rel].some(o => o >= meta && o < meta + 0x60)) continue;
    return {part: p, vb, tex, meta, partSize, tail, metaSlot, internalOffsets: layout.internal, hasTexture: layout.hasTexture, templateName};
  }
  throw wadName + ': no compatible retail LCM draw-part template was found. This LCM uses a draw-part layout not yet supported by the native render writer; it has not been modified.';
}
// Retail LCM draw parts are not rendered merely because their kind-0x20
// resources appear in the fixup directory. The level header owns two adjacent
// relocated list-head pointers: opaque first, ordinary-alpha second. Each part
// links to the previous part in its list at +0x44.
function findLevelDrawQueues(A, B, wadName) {
  const imp = fixups(B), parts = (imp[0x80000020] || []).slice().sort((a, b) => a - b);
  if (!parts.length) throw wadName + ': no native level draw parts were found';
  const d = new DataView(A.buffer, A.byteOffset, A.byteLength), U = o => d.getUint32(o, true);
  const set = new Set(parts), linkSlots = new Set(), inbound = new Set();
  for (const part of parts) {
    const slot = part + 0x44;
    if (!imp.rel.has(slot)) continue;
    linkSlots.add(slot);
    const previous = U(slot);
    if (set.has(previous)) inbound.add(previous);
    else if (previous !== 0) throw wadName + ': draw-part link at 0x' + slot.toString(16) + ' points outside the native part list';
  }
  const heads = parts.filter(part => !inbound.has(part));
  if (heads.length !== 2) throw wadName + ': expected exactly two native draw-queue heads, found ' + heads.length + '; render insertion is unsafe';
  const headSet = new Set(heads), refs = [];
  for (const slot of imp.rel) {
    if (linkSlots.has(slot) || slot < 0 || slot + 4 > A.length) continue;
    const target = U(slot);
    if (headSet.has(target)) refs.push({slot, target});
  }
  refs.sort((a, b) => a.slot - b.slot);
  if (refs.length !== 2 || refs[1].slot !== refs[0].slot + 4 || refs.some(r => !headSet.has(r.target)) || refs[0].target === refs[1].target) {
    throw wadName + ': the two adjacent opaque/translucent draw-queue head pointers could not be identified safely';
  }
  const queues = [], seenAll = new Set();
  for (let qi = 0; qi < refs.length; qi++) {
    const members = new Set(); let current = refs[qi].target;
    while (set.has(current)) {
      if (members.has(current) || seenAll.has(current)) throw wadName + ': level draw queues contain a cycle or overlap';
      members.add(current); seenAll.add(current);
      const slot = current + 0x44;
      if (!imp.rel.has(slot)) break;
      const previous = U(slot);
      if (!previous) break;
      if (!set.has(previous)) throw wadName + ': draw queue from head ' + qi + ' points outside the part list';
      current = previous;
    }
    queues.push(members);
  }
  if (seenAll.size !== parts.length) throw wadName + ': draw queues cover ' + seenAll.size + ' of ' + parts.length + ' native parts; refusing to add an unlinked render part';
  return {headSlots: refs.map(r => r.slot), heads: refs.map(r => r.target), opaqueParts: queues[0], translucentParts: queues[1], totalParts: parts.length};
}

function collisionTriangleKey(mesh, index) {
  const points = [0, 1, 2].map(k => Array.from(mesh.positions.subarray(index * 9 + k * 3, index * 9 + k * 3 + 3), v => Object.is(v, -0) ? 0 : v));
  // Canonicalize only the cyclic start vertex, not winding. This makes the
  // preservation assertion sensitive to a flipped face while allowing the
  // triangle-strip encoder to choose a different cyclic starting corner.
  const compare = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  let first = 0;
  for (let i = 1; i < 3; i++) if (compare(points[i], points[first]) < 0) first = i;
  const oriented = [0, 1, 2].map(k => points[(first + k) % 3]);
  const flags = mesh.triangleFlags ? mesh.triangleFlags[index] >>> 0 : 0;
  const extra = flags & 0xffff & ~(0x80 | 0x40 | 0x100);
  return mesh.materials[index] + '|' + extra + '|' + oriented.map(p => p.join(',')).join(';');
}
function assertOriginalCollisionPreserved(before, after, wadName) {
  // Whole-triangle KD routing does not alter any original face, even when a
  // face crosses one or more split planes. Compare the complete canonical
  // triangle multiset, including material tag, low auxiliary flags and winding.
  const counts = new Map();
  for (let i = 0; i < before.triangleCount; i++) {
    const key = collisionTriangleKey(before, i);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  for (let i = 0; i < after.triangleCount; i++) {
    const key = collisionTriangleKey(after, i), count = counts.get(key) || 0;
    if (count) counts.set(key, count - 1);
  }
  const missing = [...counts].filter(([, count]) => count > 0);
  if (missing.length) throw wadName + ': collision merge read-back lost ' + missing.reduce((n, [, count]) => n + count, 0) + ' original whole triangles, tags or auxiliary flags';
}

function appendInilevelCollision(bld, A0, B0, collision, EC, wadName) {
  if (!collision || !collision.triangleCount) {
    const oldCount = parseColl(A0)?.mat?.length || 0;
    return {added: 0, sourceAdded: 0, preLocalFragments: 0, initialDuplicatePlacements: 0, localSubtreeDuplicatePlacements: 0, duplicatePlacements: 0, sourcePlacementCounts: [], fragmentedSources: 0, preserved: oldCount, total: oldCount, kdNodes: null, kdLeaves: null, touchedLeaves: 0, splitLeaves: 0, addedBranches: 0, maxLeafRecordCount: null, maxAreaError: 0};
  }
  const original = EC.parseCollisionMesh(A0, B0, 0);
  if (!original?.valid || !original.kdTree?.valid) throw wadName + ': existing level collision/KD tree is not valid enough to merge safely (' + (original?.kdTree?.warnings?.slice(0, 3).join('; ') || original?.error || 'unknown collision parse error') + ')';
  if (!bld.rel.has(0) || !bld.rel.has(0x20)) throw wadName + ': global LCM collision header is missing its node/record pointer relocations';
  const oldCount = original.triangleCount, addCount = collision.triangleCount;
  if (!original.triangleFlags || original.triangleFlags.length !== oldCount) throw wadName + ': existing level collision auxiliary flags are unavailable; refusing to alter the retail collision stream';
  if (!collision.positions || collision.positions.length !== addCount * 9 || !collision.tags || collision.tags.length !== addCount) throw wadName + ': imported collision geometry does not match its triangle/tag counts';

  // Preserve the retail root AABB as the authoritative broadphase bounds.
  // Across all 14 global collision trees in the supplied 10.vol, the stored
  // radius is the half-diagonal of this six-word KD AABB (within <0.001), not
  // the maximum distance to a referenced vertex. Recomputing it from vertices
  // can shrink the retail sphere and break broadphase queries / ground snaps.
  const signed32 = value => value >= 0x80000000 ? value - 0x100000000 : value;
  const rootMinWords = [0, 2, 4].map(index => signed32(original.nodes[index].word0));
  const rootMaxWords = [1, 3, 5].map(index => signed32(original.nodes[index].word0));
  const newBounds = [rootMinWords.map(value => value / 8192), rootMaxWords.map(value => value / 8192)];
  let rootBoundsExpanded = false;
  // Expand only when incoming geometry is actually outside the original root
  // bounds. An unchanged collision extent must keep its original header and
  // sphere exactly, rather than being silently tightened to surface vertices.
  const readIncomingTriangle = t => {
    const at = t * 9;
    return [[collision.positions[at], collision.positions[at + 1], collision.positions[at + 2]],
      [collision.positions[at + 3], collision.positions[at + 4], collision.positions[at + 5]],
      [collision.positions[at + 6], collision.positions[at + 7], collision.positions[at + 8]]];
  };
  for (let t = 0; t < addCount; t++) for (const point of readIncomingTriangle(t)) for (let k = 0; k < 3; k++) {
    if (!Number.isFinite(point[k])) throw wadName + ': imported collision triangle ' + t + ' has non-finite coordinates';
    const qMin = Math.floor(point[k] * 8192) - 2, qMax = Math.ceil(point[k] * 8192) + 2;
    if (qMin < -0x80000000 || qMax > 0x7fffffff) throw wadName + ': imported collision bounds exceed the signed 32-bit KD coordinate range on axis ' + k;
    if (qMin < rootMinWords[k]) { rootMinWords[k] = qMin; rootBoundsExpanded = true; }
    if (qMax > rootMaxWords[k]) { rootMaxWords[k] = qMax; rootBoundsExpanded = true; }
  }
  for (let k = 0; k < 3; k++) {
    newBounds[0][k] = rootMinWords[k] / 8192;
    newBounds[1][k] = rootMaxWords[k] / 8192;
  }

  const nodesByIndex = new Map(original.kdTree.nodes.map(node => [node.index, node]));
  // Re-derive every inherited node region from the bounds that will actually
  // be written. The retail parser's cached regions are based on the old root
  // AABB and become stale when imported geometry expands it.
  const regionsByNode = new Map();
  const collectNodeRegions = (nodeIndex, region, depth = 0) => {
    if (depth > original.nodeCount) throw wadName + ': KD region reconstruction exceeded the retail node count';
    const node = nodesByIndex.get(nodeIndex); if (!node) throw wadName + ': KD region reconstruction found missing node ' + nodeIndex;
    regionsByNode.set(nodeIndex, {min: region.min.slice(), max: region.max.slice()});
    if (node.type !== 'internal') return;
    const left = {min: region.min.slice(), max: region.max.slice()}, right = {min: region.min.slice(), max: region.max.slice()};
    left.max[node.axis] = Math.min(left.max[node.axis], node.split); right.min[node.axis] = Math.max(right.min[node.axis], node.split);
    if (node.childA != null) collectNodeRegions(node.childA, left, depth + 1);
    if (node.childB != null) collectNodeRegions(node.childB, right, depth + 1);
  };
  collectNodeRegions(6, {min: newBounds[0].slice(), max: newBounds[1].slice()});
  const leafAdditions = new Map(), missingBranchAdditions = new Map();
  const triangleDoubleArea = points => {
    const a = points[1].map((v, k) => v - points[0][k]), b = points[2].map((v, k) => v - points[0][k]);
    return Math.hypot(a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]);
  };
  // A centroid-only owner can leave part of a large triangle absent from the
  // KD branch selected by a query at that point. The editor's collision spray
  // draws the whole record stream, so it can look watertight even when runtime
  // traversal misses a face outside its centroid owner's region. Keep every
  // source face whole, but place a copy in every terminal KD region actually
  // intersected by the triangle. Triangle/AABB SAT avoids the over-duplication
  // caused by testing only the triangle's coordinate ranges.
  const triangleIntersectsAabb = (points, boxMin, boxMax) => {
    const centre = boxMin.map((v, k) => (v + boxMax[k]) * 0.5);
    const half = boxMin.map((v, k) => (boxMax[k] - v) * 0.5 + 1e-5);
    const v = points.map(point => point.map((value, k) => value - centre[k]));
    const edges = [
      v[1].map((value, k) => value - v[0][k]),
      v[2].map((value, k) => value - v[1][k]),
      v[0].map((value, k) => value - v[2][k])
    ];
    const axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1],
      [edges[0][1] * edges[1][2] - edges[0][2] * edges[1][1], edges[0][2] * edges[1][0] - edges[0][0] * edges[1][2], edges[0][0] * edges[1][1] - edges[0][1] * edges[1][0]]];
    for (const edge of edges) axes.push([0, edge[2], -edge[1]], [-edge[2], 0, edge[0]], [edge[1], -edge[0], 0]);
    for (const axis of axes) {
      const lengthSq = axis[0] * axis[0] + axis[1] * axis[1] + axis[2] * axis[2];
      if (lengthSq < 1e-18) continue;
      const projections = v.map(point => point[0] * axis[0] + point[1] * axis[1] + point[2] * axis[2]);
      const radius = half[0] * Math.abs(axis[0]) + half[1] * Math.abs(axis[1]) + half[2] * Math.abs(axis[2]);
      if (Math.min(...projections) > radius + 1e-6 || Math.max(...projections) < -radius - 1e-6) return false;
    }
    return true;
  };
  const registerTriangle = (destination, points, tag, sourceTriangle) => {
    const item = {points: points.map(point => point.slice()), tag, sourceTriangle};
    if (destination.kind === 'leaf') {
      if (!leafAdditions.has(destination.leaf)) leafAdditions.set(destination.leaf, []);
      leafAdditions.get(destination.leaf).push(item);
    } else {
      const key = destination.parent + ':' + destination.side;
      if (!missingBranchAdditions.has(key)) missingBranchAdditions.set(key, {parent: destination.parent, side: destination.side, region: destination.region, additions: []});
      missingBranchAdditions.get(key).additions.push(item);
    }
  };
  const sourcePlacementCounts = new Uint16Array(addCount);
  const routeTriangle = (nodeIndex, region, points, tag, sourceTriangle, depth = 0) => {
    if (depth > original.nodeCount) throw wadName + ': collision triangle traversal exceeded the retail KD node count';
    if (!triangleIntersectsAabb(points, region.min, region.max)) return;
    const node = nodesByIndex.get(nodeIndex);
    if (!node) throw wadName + ': imported collision triangle reached missing retail KD node ' + nodeIndex;
    if (node.type === 'leaf') {
      registerTriangle({kind: 'leaf', leaf: node.index}, points, tag, sourceTriangle);
      sourcePlacementCounts[sourceTriangle]++;
      return;
    }
    const axis = node.axis, split = node.split;
    const regionA = {min: region.min.slice(), max: region.max.slice()};
    const regionB = {min: region.min.slice(), max: region.max.slice()};
    regionA.max[axis] = Math.min(regionA.max[axis], split);
    regionB.min[axis] = Math.max(regionB.min[axis], split);
    for (const branch of [
      {side: 'A', child: node.childA, region: regionA},
      {side: 'B', child: node.childB, region: regionB}
    ]) {
      if (!triangleIntersectsAabb(points, branch.region.min, branch.region.max)) continue;
      if (branch.child == null) {
        registerTriangle({kind: 'missing', parent: node.index, side: branch.side, region: branch.region}, points, tag, sourceTriangle);
        sourcePlacementCounts[sourceTriangle]++;
      } else routeTriangle(branch.child, branch.region, points, tag, sourceTriangle, depth + 1);
    }
  };
  for (let t = 0; t < addCount; t++) {
    const points = readIncomingTriangle(t), area = triangleDoubleArea(points) * 0.5;
    if (area < 1e-10) throw wadName + ': imported collision contains a degenerate triangle at index ' + t;
    routeTriangle(6, {min: newBounds[0].slice(), max: newBounds[1].slice()}, points, Number(collision.tags[t]) >>> 0, t);
  }
  const outputTriangleCount = [...leafAdditions.values()].reduce((sum, list) => sum + list.length, 0) + [...missingBranchAdditions.values()].reduce((sum, branch) => sum + branch.additions.length, 0);
  const unassignedSources = Array.from(sourcePlacementCounts).map((count, index) => count ? -1 : index).filter(index => index >= 0);
  if (unassignedSources.length) throw wadName + ': overlap-aware KD routing failed to assign imported source triangles ' + unassignedSources.slice(0, 12).join(', ');
  if (outputTriangleCount < addCount || outputTriangleCount > addCount * 512) throw wadName + ': overlap-aware KD routing produced an unsafe number of whole-triangle region copies (' + outputTriangleCount + '/' + addCount + ')';

  // Build a local PC subtree from an ordered set of whole triangles. Positions are
  // reflected for the shared source-model builder, then restored to game space
  // by buildMeshCollisionShape. Original reversed triangles are re-authored with
  // their original reverse bit and their low 16-bit auxiliary flags.
  const buildLocalShape = (triangles, partitionRegion) => {
    const positions = new Float32Array(triangles.length * 9), normals = new Float32Array(triangles.length * 9);
    const indices = new Uint32Array(triangles.length * 3), faceMaterialTags = new Uint16Array(triangles.length), faceFlags = new Uint16Array(triangles.length), facePlacementModes = new Array(triangles.length);
    for (let ti = 0; ti < triangles.length; ti++) {
      const tri = triangles[ti], p = tri.reverse ? [tri.points[1], tri.points[0], tri.points[2]] : tri.points;
      const a = p[1].map((v, k) => v - p[0][k]), b = p[2].map((v, k) => v - p[0][k]);
      const cross = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
      const normal = tri.reverse ? cross.map(v => -v) : cross;
      for (let c = 0; c < 3; c++) {
        const v = ti * 3 + c, o = v * 3;
        positions[o] = p[c][0]; positions[o + 1] = p[c][1]; positions[o + 2] = -p[c][2];
        normals[o] = normal[0]; normals[o + 1] = normal[1]; normals[o + 2] = -normal[2];
        indices[v] = v;
      }
      faceMaterialTags[ti] = tri.tag; faceFlags[ti] = tri.flags ?? 0x10; facePlacementModes[ti] = tri.placementMode || 'overlap';
    }
    let shape = null, lastError = null;
    for (const maxTrianglesPerLeaf of [48, 44, 40, 36, 32, 28, 24, 20, 16, 12, 8, 4, 2, 1]) {
      try { shape = EC.buildMeshCollisionShape({positions, normals, indices}, {scale: 1, faceMaterialTags, faceFlags, facePlacementModes, maxTrianglesPerLeaf, trianglePlacementMode: 'overlap', partitionBounds: partitionRegion}); break; }
      catch (error) { lastError = error; }
    }
    if (!shape) throw wadName + ': could not build a local collision subtree (' + String(lastError?.message || lastError || 'unknown partition error') + ')';
    const sourceCounts = new Uint16Array(addCount);
    for (const placed of shape.kdTriangles || []) {
      const sourceIndex = triangles[placed.sourceId]?.sourceTriangle;
      if (Number.isInteger(sourceIndex) && sourceIndex >= 0 && sourceIndex < addCount) sourceCounts[sourceIndex]++;
    }
    shape.importedSourcePlacementCounts = Array.from(sourceCounts);
    return shape;
  };

  const leaves = original.kdTree.nodes.filter(node => node.type === 'leaf').slice().sort((a, b) => a.firstRecord - b.firstRecord);
  if (leaves.length !== original.kdTree.leafCount || leaves.some(node => !node.recordCount || node.lastRecord >= original.vertexCount)) throw wadName + ': retail KD leaf stream layout is not safe to preserve';
  const leafPlans = new Map();
  for (const leaf of leaves) {
    const additions = leafAdditions.get(leaf.index) || [];
    if (!additions.length) {
      leafPlans.set(leaf.index, {kind: 'keep', additions, recordCount: leaf.recordCount});
      continue;
    }
    const oldTriangles = [];
    for (let ti = 0; ti < original.triangleCount; ti++) if (original.triangleLeaves[ti] === leaf.index) {
      const at = ti * 9, decoded = [[original.positions[at], original.positions[at + 1], original.positions[at + 2]],
        [original.positions[at + 3], original.positions[at + 4], original.positions[at + 5]],
        [original.positions[at + 6], original.positions[at + 7], original.positions[at + 8]]];
      oldTriangles.push({points: decoded, tag: original.materials[ti], flags: original.triangleFlags[ti] & 0xffff, reverse: !!(original.triangleFlags[ti] & 0x100), placementMode: 'centroid'});
    }
    const shape = buildLocalShape(oldTriangles.concat(additions.map(x => ({...x, flags: 0x10, reverse: false, placementMode: 'overlap'}))), regionsByNode.get(leaf.index) || leaf.region);
    leafPlans.set(leaf.index, {kind: 'replace', additions, shape, recordCount: shape.records.length});
  }

  const branchPlans = [...missingBranchAdditions.values()].sort((a, b) => a.parent - b.parent || a.side.localeCompare(b.side));
  for (const branch of branchPlans) branch.shape = buildLocalShape(branch.additions.map(x => ({...x, flags: 0x10, reverse: false, placementMode: 'overlap'})), branch.region);

  let resultingTriangleCount = 0;
  for (const leaf of leaves) {
    const plan = leafPlans.get(leaf.index);
    if (plan.kind === 'replace') resultingTriangleCount += plan.shape.kdTriangleCount;
    else resultingTriangleCount += original.triangleLeaves.filter(index => index === leaf.index).length;
  }
  for (const branch of branchPlans) resultingTriangleCount += branch.shape.kdTriangleCount;
  const total = resultingTriangleCount;
  let newNodeCount = original.nodeCount;
  for (const plan of leafPlans.values()) if (plan.kind === 'replace') newNodeCount += plan.shape.nodeCount - 7;
  for (const branch of branchPlans) newNodeCount += branch.shape.nodeCount - 6;
  if (newNodeCount > 4096) throw wadName + ': collision tree extension would exceed the currently validated 4096-node limit (' + newNodeCount + ')';

  const oldTreePtr = original.nodePtr, oldTreeBytes = original.nodeCount * 8, footerStart = oldTreePtr + oldTreeBytes;
  if (footerStart + 0x1c > A0.length) throw wadName + ': retail collision node footer is truncated';
  const footer = A0.subarray(footerStart, footerStart + 0x1c);
  const nodePlans = [];
  let newRecordCount = 0;
  for (const leaf of leaves) {
    const plan = leafPlans.get(leaf.index);
    plan.firstRecord = newRecordCount;
    plan.recordCount = plan.kind === 'keep' ? plan.recordCount : plan.shape.records.length;
    newRecordCount += plan.recordCount;
    if (plan.kind === 'replace') nodePlans.push({kind: 'replace-leaf', oldIndex: leaf.index, shape: plan.shape, baseRecord: plan.firstRecord});
  }
  for (const branch of branchPlans) {
    branch.baseRecord = newRecordCount; newRecordCount += branch.shape.records.length;
    nodePlans.push({kind: 'add-branch', branch, shape: branch.shape, baseRecord: branch.baseRecord});
  }
  if (newRecordCount > 0xffffff) throw wadName + ': collision record stream exceeds the 24-bit leaf start range';

  const nodesOff = bld.alloc(newNodeCount * 8 + 0x1c, 8), recordsOff = bld.alloc(newRecordCount * 16, 16);
  bld.A.set(A0.subarray(oldTreePtr, oldTreePtr + oldTreeBytes), nodesOff);
  const d = bld.d, W = bld.W;
  const writeRecord = (index, position, flags) => {
    const off = recordsOff + index * 16;
    d.setFloat32(off, position[0], true); d.setFloat32(off + 4, position[1], true); d.setFloat32(off + 8, position[2], true); W(off + 12, flags >>> 0);
  };
  let recordCursor = 0, maxLeafRecordCount = 0;
  for (const leaf of leaves) {
    const plan = leafPlans.get(leaf.index);
    if (plan.kind === 'keep') {
      for (let r = 0; r < leaf.recordCount; r++) {
        const source = original.vertexPtr + (leaf.firstRecord + r) * 16, target = recordsOff + recordCursor * 16;
        bld.A.set(A0.subarray(source, source + 16), target); recordCursor++;
      }
      W(nodesOff + leaf.index * 8 + 4, ((plan.firstRecord << 8) | plan.recordCount) >>> 0);
      maxLeafRecordCount = Math.max(maxLeafRecordCount, plan.recordCount);
    } else {
      for (const rec of plan.shape.records) writeRecord(recordCursor++, rec.position, rec.flags);
      for (const localLeaf of plan.shape.nodes.filter(n => n.type === 'leaf')) maxLeafRecordCount = Math.max(maxLeafRecordCount, localLeaf.recordCount);
    }
  }
  const expectedOldLeafRecordCount = leaves.reduce((sum, leaf) => sum + leafPlans.get(leaf.index).recordCount, 0);
  if (recordCursor !== expectedOldLeafRecordCount) {
    throw wadName + ': old-leaf collision stream accounting failed (' + recordCursor + '/' + expectedOldLeafRecordCount + ')';
  }
  for (const branch of branchPlans) {
    for (const rec of branch.shape.records) writeRecord(recordCursor++, rec.position, rec.flags);
    for (const localLeaf of branch.shape.nodes.filter(n => n.type === 'leaf')) maxLeafRecordCount = Math.max(maxLeafRecordCount, localLeaf.recordCount);
  }
  if (recordCursor !== newRecordCount) throw wadName + ': collision record stream accounting failed (' + recordCursor + '/' + newRecordCount + ')';

  let nextNodeIndex = original.nodeCount;
  const encodeShape = (shape, baseRecord, rootIndex = null) => {
    const map = new Map();
    let next = nextNodeIndex;
    for (let ni = 6; ni < shape.nodeCount; ni++) {
      if (ni === 6 && rootIndex != null) map.set(shape.nodes[ni], rootIndex);
      else map.set(shape.nodes[ni], next++);
    }
    nextNodeIndex = next;
    for (let ni = 6; ni < shape.nodeCount; ni++) {
      const node = shape.nodes[ni], globalIndex = map.get(node), off = nodesOff + globalIndex * 8;
      if (node.type === 'leaf') {
        const first = baseRecord + node.firstRecord;
        if (first > 0xffffff || node.recordCount > 255) throw wadName + ': generated local leaf payload exceeds PC encoding limits';
        W(off, 3); W(off + 4, ((first << 8) | node.recordCount) >>> 0);
      } else {
        const q = Math.round(node.split * 1024), left = map.get(node.left), right = map.get(node.right);
        if (q < -0x10000000 || q > 0x0fffffff || !Number.isInteger(left) || !Number.isInteger(right) || left > 0xffff || right > 0xffff) throw wadName + ': generated local KD split/child encoding is invalid';
        W(off, ((q << 3) | node.axis) >>> 0); W(off + 4, ((left << 16) | right) >>> 0);
      }
    }
    return map.get(shape.nodes[6]);
  };
  for (const plan of nodePlans) {
    if (plan.kind === 'replace-leaf') encodeShape(plan.shape, plan.baseRecord, plan.oldIndex);
    else {
      const rootIndex = encodeShape(plan.shape, plan.baseRecord);
      const parent = plan.branch.parent, wordOff = nodesOff + parent * 8 + 4, oldWord = d.getUint32(wordOff, true);
      const a = (oldWord >>> 16) & 0xffff, b = oldWord & 0xffff;
      if (plan.branch.side === 'A') {
        if (a !== 0xffff) throw wadName + ': missing KD child A is no longer empty';
        W(wordOff, ((rootIndex << 16) | b) >>> 0);
      } else {
        if (b !== 0xffff) throw wadName + ': missing KD child B is no longer empty';
        W(wordOff, ((a << 16) | rootIndex) >>> 0);
      }
    }
  }
  if (nextNodeIndex !== newNodeCount) throw wadName + ': collision KD node accounting failed (' + nextNodeIndex + '/' + newNodeCount + ')';

  bld.A.set(footer, nodesOff + newNodeCount * 8);
  const centre = rootBoundsExpanded
    ? newBounds[0].map((v, k) => (v + newBounds[1][k]) * 0.5)
    : original.centre.slice();
  const halfExtents = rootBoundsExpanded
    ? newBounds[0].map((v, k) => (newBounds[1][k] - v) * 0.5)
    : original.kdBounds[0].map((v, k) => (original.kdBounds[1][k] - v) * 0.5);
  const radiusSq = rootBoundsExpanded ? halfExtents.reduce((sum, value) => sum + value * value, 0) : original.radiusSq;
  const radius = rootBoundsExpanded ? Math.sqrt(radiusSq) : original.radius;
  for (let k = 0; k < 3; k++) {
    W(nodesOff + k * 16, rootMinWords[k] >>> 0);
    W(nodesOff + (k * 2 + 1) * 8, rootMaxWords[k] >>> 0);
    d.setFloat32(0x0c + k * 4, centre[k], true);
  }
  d.setFloat32(0x18, radiusSq, true); d.setFloat32(0x1c, radius, true);
  W(0, nodesOff); W(4, newNodeCount); W(0x20, recordsOff); W(0x24, newRecordCount);
  W(0x28, original.headerWord28 === original.nodeCount ? newNodeCount : original.headerWord28);
  const assigned = [...leafAdditions].map(([leaf, list]) => ({leaf, triangles: list.length, split: leafPlans.get(leaf)?.shape?.nodes[6]?.type === 'internal'})).sort((a, b) => a.leaf - b.leaf);
  const addedBranches = branchPlans.map(branch => ({parent: branch.parent, side: branch.side, triangles: branch.additions.length, region: branch.region}));
  const newLeafCount = original.kdTree.leafCount + [...leafPlans.values()].reduce((n, p) => n + (p.kind === 'replace' ? p.shape.leafCount - 1 : 0), 0) + branchPlans.reduce((n, b) => n + b.shape.leafCount, 0);
  const finalAddedFragments = total - oldCount;
  const finalSourcePlacementCounts = new Uint32Array(addCount);
  for (const plan of leafPlans.values()) if (plan.kind === 'replace') for (let i = 0; i < addCount; i++) finalSourcePlacementCounts[i] += plan.shape.importedSourcePlacementCounts[i] || 0;
  for (const branch of branchPlans) for (let i = 0; i < addCount; i++) finalSourcePlacementCounts[i] += branch.shape.importedSourcePlacementCounts[i] || 0;
  const finalSourcePlacementTotal = finalSourcePlacementCounts.reduce((sum, count) => sum + count, 0);
  if (finalSourcePlacementTotal !== finalAddedFragments) throw wadName + ': final collision KD placement accounting failed (' + finalSourcePlacementTotal + ' source placements vs ' + finalAddedFragments + ' added triangle records)';
  const initialDuplicatePlacements = outputTriangleCount - addCount;
  const localSubtreeDuplicatePlacements = finalSourcePlacementTotal - outputTriangleCount;
  if (localSubtreeDuplicatePlacements < 0) throw wadName + ': local KD subtree placement count unexpectedly shrank imported faces';
  const finalDuplicatePlacements = finalSourcePlacementTotal - addCount;
  const localSubtreeFragments = 0;
  const maxLocalAreaError = Math.max(0, ...[...leafPlans.values()].filter(p => p.kind === 'replace').map(p => p.shape.maxSourceAreaError || 0), ...branchPlans.map(p => p.shape.maxSourceAreaError || 0));
  return {added: finalAddedFragments, preLocalFragments: outputTriangleCount, sourceAdded: addCount, initialDuplicatePlacements, localSubtreeDuplicatePlacements, duplicatePlacements: finalDuplicatePlacements, sourcePlacementCounts: Array.from(finalSourcePlacementCounts), fragmentedSources: 0, localSubtreeFragments, preserved: oldCount, total, kdNodes: newNodeCount, kdLeaves: newLeafCount,
    records: newRecordCount, touchedLeaves: assigned.length, splitLeaves: assigned.filter(x => x.split).length,
    addedBranches: branchPlans.length, branchAssignments: addedBranches, leafAssignments: assigned,
    maxLeafRecordCount, maxAreaError: maxLocalAreaError, rootBoundsExpanded, rootBounds: {min: newBounds[0].slice(), max: newBounds[1].slice()}, broadphaseSphere: {centre: centre.slice(), radius, radiusSq},
    retailBackbonePreserved: true};
}

function boundsFromRenderBuffers(buffers) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]; let count = 0;
  for (const buffer of buffers || []) for (let i = 0; i < (buffer.pos || []).length; i += 3) {
    for (let k = 0; k < 3; k++) { const v = buffer.pos[i + k]; min[k] = Math.min(min[k], v); max[k] = Math.max(max[k], v); }
    count++;
  }
  return count ? [min, max] : null;
}
function boundsFromInilevelMeshes(meshes) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]; let count = 0;
  for (const mesh of meshes || []) for (let i = 0; i < (mesh.positions || []).length; i += 3) {
    for (let k = 0; k < 3; k++) { const v = mesh.positions[i + k]; min[k] = Math.min(min[k], v); max[k] = Math.max(max[k], v); }
    count++;
  }
  return count ? [min, max] : null;
}
function levelPlacementWarning(existingBounds, importedBounds) {
  if (!existingBounds || !importedBounds) return null;
  const axes = ['X', 'Y', 'Z'], overruns = [];
  const fmt = n => Number(n.toFixed(2));
  for (let k = 0; k < 3; k++) {
    const below = existingBounds[0][k] - importedBounds[0][k];
    const above = importedBounds[1][k] - existingBounds[1][k];
    if (below > 0.01 || above > 0.01) {
      const parts = [];
      if (below > 0.01) parts.push(fmt(below) + ' below');
      if (above > 0.01) parts.push(fmt(above) + ' above');
      overruns.push(axes[k] + ' extends ' + parts.join(' and '));
    }
  }
  if (!overruns.length) return null;
  return 'Imported render geometry extends beyond the existing render-geometry envelope (' + overruns.join('; ') + '). This envelope is calculated from the current LCM vertex buffers; it is not a confirmed native chunk/streaming bound. The warning identifies an extent mismatch, not proof that the game will clip the part.';
}

function validateAndBakeTga(bytesInput, material, wadName) {
  let bytes;
  if (bytesInput) bytes = bytesInput.slice();
  else {
    // A no-texture material still needs a valid native texture resource.
    bytes = new Uint8Array(18 + 4 * 4 * 4);
    bytes[2] = 2; bytes[12] = 4; bytes[14] = 4; bytes[16] = 32; bytes[17] = 0x28;
    for (let p = 18; p < bytes.length; p += 4) bytes.set([255, 255, 255, 255], p);
  }
  if (bytes.length < 18 || bytes[2] !== 2 || bytes[16] !== 32) {
    throw wadName + ': material ' + material.name + ' uses a TGA format not supported by the native LCM writer (requires 32-bit truecolour TGA)';
  }
  const idEnd = 18 + bytes[0], width = bytes[12] | (bytes[13] << 8), height = bytes[14] | (bytes[15] << 8);
  const payloadEnd = idEnd + width * height * 4;
  if (!width || !height || width > 4096 || height > 4096 || payloadEnd > bytes.length) {
    throw wadName + ': material ' + material.name + ' has an invalid or truncated TGA';
  }
  if (material.alphaMode !== 'OPAQUE' || material.baseColor[3] < 0.999) {
    throw wadName + ': material ' + material.name + ' uses alpha mode/opacity not supported by this first native LCM writer (OPAQUE only)';
  }
  const colour = material.baseColor || [1, 1, 1, 1];
  if (colour.some(v => Math.abs(v - 1) > 1e-8)) {
    const srgbToLinear = x => x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    const linearToSrgb = x => x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
    for (let p = idEnd; p < payloadEnd; p += 4) {
      bytes[p] = Math.round(linearToSrgb(srgbToLinear(bytes[p] / 255) * colour[2]) * 255);
      bytes[p + 1] = Math.round(linearToSrgb(srgbToLinear(bytes[p + 1] / 255) * colour[1]) * 255);
      bytes[p + 2] = Math.round(linearToSrgb(srgbToLinear(bytes[p + 2] / 255) * colour[0]) * 255);
    }
  }
  return {bytes: bytes.subarray(0, payloadEnd), width, height};
}

/**
 * Append .inilevel render geometry into a retail LCM.
 * Existing collision triangles/tags are decoded, merged with the bundle's separate
 * collision mesh, and written with a rebuilt native KD tree. `EC` provides the
 * editor's shared CollMesh encoder and growable relocation/import builder.
 */

// Replace one resource object's import record while preserving its resource kind
// and all other fixups. The inline VB must move as a whole because the retail
// layout requires its vertex data at +0x30 and its index stream immediately
// after the vertex records. The old VB's two internal relocations are replaced
// with the corresponding slots in the relocated object.
function replaceResourceImport(B, kind, oldLocation, newLocation, oldRelocations, newRelocations) {
  const words = new Uint32Array(B.buffer.slice(B.byteOffset, B.byteOffset + B.byteLength));
  const remove = new Set(oldRelocations), out = [];
  let replaced = 0, removed = 0;
  for (let i = 0; i < words.length;) {
    const value = words[i] >>> 0;
    if (value >= 0x80000000) {
      if (i + 1 >= words.length) throw new Error('Truncated resource import record while relocating shared VB');
      const recordKind = value & 0xffff, location = words[i + 1] >>> 0;
      out.push(value, recordKind === kind && location === oldLocation ? (replaced++, newLocation >>> 0) : location);
      i += 2;
    } else {
      if (remove.has(value)) removed++;
      else out.push(value);
      i++;
    }
  }
  if (replaced !== 1 || removed !== oldRelocations.length) {
    throw new Error('Could not safely replace the single shared VB resource import (records=' + replaced + ', removed relocations=' + removed + ')');
  }
  for (const relocation of newRelocations) out.push(relocation >>> 0);
  const result = new Uint8Array(out.length * 4), dv = new DataView(result.buffer);
  for (let i = 0; i < out.length; i++) dv.setUint32(i * 4, out[i] >>> 0, true);
  return result;
}


// Rewrite only the location word paired with imports of one resource kind.
// This is used when a visibility descriptor is copied into a relocated cell
// array: the resource import must point at the copied record, not its orphaned
// original location. All other B-stream words remain byte-for-byte unchanged.
function replaceImportLocations(B, kind, locations) {
  if (!locations || !locations.size) return B;
  const words = new Uint32Array(B.buffer.slice(B.byteOffset, B.byteOffset + B.byteLength));
  const out = new Uint32Array(words.length);
  const seen = new Map();
  let oi = 0;
  for (let i = 0; i < words.length;) {
    const value = words[i] >>> 0;
    if (value >= 0x80000000) {
      if (i + 1 >= words.length) throw new Error('Truncated B-stream import while relocating visibility descriptors');
      const recordKind = value & 0xffff;
      const location = words[i + 1] >>> 0;
      const replacement = recordKind === kind && locations.has(location) ? locations.get(location) : location;
      if (recordKind === kind && locations.has(location)) seen.set(location, (seen.get(location) || 0) + 1);
      out[oi++] = value;
      out[oi++] = replacement >>> 0;
      i += 2;
    } else {
      out[oi++] = value;
      i++;
    }
  }
  for (const oldLocation of locations.keys()) {
    if (seen.get(oldLocation) !== 1) throw new Error('Expected exactly one kind-0x' + kind.toString(16) + ' import at 0x' + oldLocation.toString(16) + ', found ' + (seen.get(oldLocation) || 0));
  }
  return new Uint8Array(out.buffer, 0, oi * 4).slice();
}

function inspectSpatialCellRoot(A, B, wadName = 'LCM') {
  const imp = fixups(B), roots = imp[0x8000010c] || [];
  if (roots.length !== 1) return {ok:false, reason:'expected exactly one native 0x8000010C spatial-cell table, found ' + roots.length};
  const root = roots[0];
  if (root < 0 || root + 0x10 > A.length) return {ok:false, reason:'truncated 0x10C spatial table root header at 0x' + Number(root).toString(16)};
  const dv = new DataView(A.buffer, A.byteOffset, A.byteLength), u = o => dv.getUint32(o, true);
  const mode = u(root), count = u(root + 4), cellArray = u(root + 8), reserved = u(root + 0x0c);
  if ((mode !== 0 && mode !== 1) || reserved !== 0) return {ok:false, reason:'unsupported 0x10C root header mode=0x' + mode.toString(16) + ', count=0x' + count.toString(16) + ', array=0x' + cellArray.toString(16) + ', reserved=0x' + reserved.toString(16)};
  if (!Number.isInteger(count) || count < 1 || count >= 256 || cellArray + count * 0x80 > A.length || !imp.rel.has(root + 8)) return {ok:false, reason:'invalid root cell count/array or missing +0x08 relocation (mode=' + mode + ', count=' + count + ', array=0x' + cellArray.toString(16) + ')'};
  return {ok:true, root, mode, count, cellArray};
}

// The PC runtime does not cull all kind-0x0A resources in an LCM. It first
// chooses the spatial cell containing the camera, walks that cell's neighbour
// list, and tests only the 0x20-byte visibility descriptors stored in those
// cells' +0x6C arrays. Therefore every imported descriptor must be referenced
// by one or more cell arrays. The retail invariant is one descriptor per cell
// list, and each imported kind-0x0A record appears exactly once across them.
//
// A bounding sphere can cross spatial-cell boundaries, so a custom descriptor
// is copied into every cell whose four half-spaces it can overlap. The test is
// deliberately conservative: false-positive cell assignments only cause an
// extra visibility test; false negatives would make a valid part disappear.
function registerVisibilityDescriptors(bld, A0, B0, wadName, descriptors) {
  if (!descriptors.length) return {relocations: new Map(), cells: [], assignments: [], addedSpatialCells: 0, remoteRegion: null};
  const sourceImp = fixups(B0);
  const rootInfo = inspectSpatialCellRoot(A0, B0, wadName);
  if (!rootInfo.ok) throw wadName + ': ' + rootInfo.reason;
  const dv0 = new DataView(A0.buffer, A0.byteOffset, A0.byteLength);
  const u32 = o => dv0.getUint32(o, true);
  const f32 = o => dv0.getFloat32(o, true);
  const u16 = o => dv0.getUint16(o, true);
  const root = rootInfo.root;
  const cellCount = rootInfo.count, cellArray = rootInfo.cellArray;
  if (!Number.isInteger(cellCount) || cellCount < 1 || cellCount >= 256 || cellArray + cellCount * 0x80 > A0.length || !sourceImp.rel.has(root + 8)) {
    throw wadName + ': invalid 0x10C spatial-cell array/count or missing root relocation (need room for one additional custom-region cell)';
  }
  const importLocations = new Set(sourceImp[0x8000000a] || []);
  const oldDescriptorOwner = new Map();
  const cells = [];
  for (let i = 0; i < cellCount; i++) {
    const sourceOffset = cellArray + i * 0x80;
    // +0x60 is the set processed for visibility updates after a cell is
    // selected; +0x61 is the smaller candidate prefix used to find the next
    // current cell. Retail data consistently has +0x60 >= +0x61.
    const updateCount = dv0.getUint8(sourceOffset + 0x60);
    const lookupCount = dv0.getUint8(sourceOffset + 0x61);
    const descriptorCount = u16(sourceOffset + 0x62);
    const neighbourArray = u32(sourceOffset + 0x64);
    const descriptorArray = u32(sourceOffset + 0x6c);
    if (updateCount > 64 || lookupCount > updateCount || (updateCount && (neighbourArray + updateCount * 4 > A0.length || !sourceImp.rel.has(sourceOffset + 0x64)))) {
      throw wadName + ': spatial cell ' + i + ' has invalid update/lookup neighbour counts or an invalid pointer array';
    }
    if (descriptorCount > 4096 || (descriptorCount && (descriptorArray + descriptorCount * 0x20 > A0.length))) {
      throw wadName + ': spatial cell ' + i + ' has an invalid visibility descriptor array';
    }
    if (!sourceImp.rel.has(sourceOffset + 0x64) || !sourceImp.rel.has(sourceOffset + 0x6c)) {
      throw wadName + ': spatial cell ' + i + ' is missing a relocation for a native pointer field';
    }
    const oldDescriptors = [];
    for (let j = 0; j < descriptorCount; j++) {
      const descriptor = descriptorArray + j * 0x20;
      if (!importLocations.has(descriptor)) throw wadName + ': spatial cell ' + i + ' descriptor 0x' + descriptor.toString(16) + ' has no matching kind-0x0A import';
      if (oldDescriptorOwner.has(descriptor)) throw wadName + ': visibility descriptor 0x' + descriptor.toString(16) + ' is shared by multiple spatial cells';
      oldDescriptorOwner.set(descriptor, i);
      oldDescriptors.push(descriptor);
    }
    cells.push({index: i, sourceOffset, offset: sourceOffset, updateCount, lookupCount, neighbourArray, descriptorCount, descriptorArray, oldDescriptors, additions: []});
  }
  // Every native descriptor must be owned by exactly one spatial-cell list.
  if (oldDescriptorOwner.size !== importLocations.size) {
    const missing = [...importLocations].filter(o => !oldDescriptorOwner.has(o));
    const extras = [...oldDescriptorOwner.keys()].filter(o => !importLocations.has(o));
    throw wadName + ': retail visibility registration invariant failed before import (imports=' + importLocations.size + ', cell references=' + oldDescriptorOwner.size + ', unreferenced=' + missing.length + ', unimported=' + extras.length + ')';
  }

  const overlapCells = (centre, radius, cell) => {
    for (let plane = 0; plane < 4; plane++) {
      const p = cell.sourceOffset + plane * 0x10;
      const nx = f32(p), ny = f32(p + 4), nz = f32(p + 8), d = f32(p + 12);
      if (![nx, ny, nz, d].every(Number.isFinite)) throw wadName + ': cell ' + cell.index + ' has a non-finite spatial plane';
      const signed = nx * centre[0] + ny * centre[1] + nz * centre[2] + d;
      const reach = radius * Math.hypot(nx, ny, nz);
      if (signed + reach < -1e-4) return false;
    }
    return true;
  };
  const containsSphere = (centre, radius, cell) => {
    for (let plane = 0; plane < 4; plane++) {
      const p = cell.sourceOffset + plane * 0x10;
      const nx = f32(p), ny = f32(p + 4), nz = f32(p + 8), d = f32(p + 12);
      const signed = nx * centre[0] + ny * centre[1] + nz * centre[2] + d;
      const reach = radius * Math.hypot(nx, ny, nz);
      if (signed - reach < -1e-4) return false;
    }
    return true;
  };

  const assignments = [], remoteEntries = [];
  for (const entry of descriptors) {
    const hits = cells.filter(cell => overlapCells(entry.centre, entry.radius, cell));
    // A partially overlapping large model can extend beyond every retail cell
    // that currently owns its descriptor. Add a dedicated region cell whenever
    // no one retail cell fully contains its visibility sphere. This is also the
    // path for a model placed wholly outside the original level's cell grid.
    const needsCustomRegion = !cells.some(cell => containsSphere(entry.centre, entry.radius, cell));
    for (const cell of hits) cell.additions.push(entry);
    if (needsCustomRegion) remoteEntries.push(entry);
    assignments.push({name: entry.name, cells: hits.map(c => c.index), remoteRegion: needsCustomRegion});
  }

  let remoteCell = null, remoteRegion = null;
  if (remoteEntries.length) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const entry of remoteEntries) {
      minX = Math.min(minX, entry.centre[0] - entry.radius);
      maxX = Math.max(maxX, entry.centre[0] + entry.radius);
      minZ = Math.min(minZ, entry.centre[2] - entry.radius);
      maxZ = Math.max(maxZ, entry.centre[2] + entry.radius);
    }
    minX -= 1; maxX += 1; minZ -= 1; maxZ += 1;
    const newCount = cellCount + 1;
    const newCellArray = bld.alloc(newCount * 0x80, 16);
    bld.A.set(A0.subarray(cellArray, cellArray + cellCount * 0x80), newCellArray);
    // The root now points at the expanded contiguous table. Retarget every
    // existing neighbour pointer to the copied cell record; the neighbour
    // arrays themselves remain in place and retain their separate +0x60/+0x61
    // counts (the latter is a prefix of the former in retail 10/30 data).
    bld.W(root + 4, newCount); bld.W(root + 8, newCellArray); bld.addRel(root + 8);
    for (const cell of cells) {
      const newOffset = newCellArray + cell.index * 0x80;
      bld.addRel(newOffset + 0x64); bld.addRel(newOffset + 0x6c);
      for (let j = 0; j < cell.updateCount; j++) {
        const slot = cell.neighbourArray + j * 4;
        if (!sourceImp.rel.has(slot)) throw wadName + ': spatial cell ' + cell.index + ' neighbour pointer ' + j + ' has no relocation';
        const target = u32(slot), delta = target - cellArray;
        if (delta < 0 || delta >= cellCount * 0x80 || delta % 0x80 !== 0) throw wadName + ': spatial cell ' + cell.index + ' neighbour ' + j + ' points outside the original cell table';
        bld.W(slot, newCellArray + delta);
      }
      cell.offset = newOffset;
    }
    const newCellOffset = newCellArray + cellCount * 0x80;
    bld.A.fill(0, newCellOffset, newCellOffset + 0x80);
    const planeData = [
      [1, 0, 0, -minX], [0, 0, 1, -minZ], [-1, 0, 0, maxX], [0, 0, -1, maxZ]
    ];
    for (let i = 0; i < 4; i++) for (let k = 0; k < 4; k++) bld.d.setFloat32(newCellOffset + i * 0x10 + k * 4, planeData[i][k], true);
    bld.A[newCellOffset + 0x60] = 1; // visibility update set: [self]
    bld.A[newCellOffset + 0x61] = 1; // current-cell lookup candidates: [self]
    const selfArray = bld.alloc(4, 4);
    bld.W(newCellOffset + 0x64, selfArray); bld.addRel(newCellOffset + 0x64);
    bld.W(selfArray, newCellOffset); bld.addRel(selfArray);
    bld.addRel(newCellOffset + 0x6c);
    remoteCell = {index: cellCount, sourceOffset: null, offset: newCellOffset, updateCount: 1, lookupCount: 1,
      neighbourArray: selfArray, descriptorCount: 0, descriptorArray: 0, oldDescriptors: [], additions: remoteEntries};
    cells.push(remoteCell);
    for (const assignment of assignments) if (assignment.remoteRegion) assignment.cells.push(remoteCell.index);
    remoteRegion = {cell: remoteCell.index, bounds: {minX, maxX, minZ, maxZ}, descriptorCount: remoteEntries.length, disconnectedSelfNeighbour: true};
  }

  const relocatedImports = new Map();
  const changedCells = [];
  for (const cell of cells) {
    if (!cell.additions.length) continue;
    const total = cell.descriptorCount + cell.additions.length;
    if (total > 0xffff) throw wadName + ': spatial cell ' + cell.index + ' visibility descriptor count would overflow uint16';
    const newArray = bld.alloc(total * 0x20, 16);
    // Preserve and relocate the existing descriptors, remapping their import
    // locations so the cell table and B-stream continue to identify one copy.
    for (let j = 0; j < cell.oldDescriptors.length; j++) {
      const oldOffset = cell.oldDescriptors[j], newOffset = newArray + j * 0x20;
      bld.A.set(A0.subarray(oldOffset, oldOffset + 0x20), newOffset);
      bld.addRel(newOffset + 0x1c);
      relocatedImports.set(oldOffset, newOffset);
    }
    // Register each custom descriptor in this cell. If a part overlaps more
    // than one cell (or is also included in the remote coverage cell), clone
    // the descriptor while sharing the same metadata block.
    for (let j = 0; j < cell.additions.length; j++) {
      const entry = cell.additions[j];
      let descriptorOffset;
      if (!entry.used) {
        descriptorOffset = entry.offset;
        entry.used = true;
      } else {
        descriptorOffset = bld.alloc(0x20, 16);
        bld.A.set(bld.A.subarray(entry.offset, entry.offset + 0x20), descriptorOffset);
      }
      const target = newArray + (cell.descriptorCount + j) * 0x20;
      bld.A.set(bld.A.subarray(descriptorOffset, descriptorOffset + 0x20), target);
      const rels = [];
      bld.addRelTo(rels, target + 0x1c);
      bld.addSpec(0x0A, target, rels);
    }
    bld.d.setUint16(cell.offset + 0x62, total, true);
    bld.W(cell.offset + 0x6c, newArray);
    bld.addRel(cell.offset + 0x6c);
    changedCells.push({cell: cell.index, oldCount: cell.descriptorCount, added: cell.additions.length, newCount: total, oldArray: cell.descriptorArray, newArray,
      updateNeighbours: cell.updateCount, lookupCandidates: cell.lookupCount, remoteRegion: cell === remoteCell});
  }
  return {relocations: relocatedImports, cells: changedCells, assignments, originalImports: importLocations.size,
    addedDescriptors: assignments.reduce((n, a) => n + a.cells.length, 0), addedSpatialCells: remoteCell ? 1 : 0, remoteRegion};
}


// Create an empty-but-valid static LCM seed while retaining the donor's native
// loader/render scaffolding. The donor LCS/PCA remain paired separately; this
// clears only the donor LCM's static draw geometry and global collision.
function makeEmptyStandaloneLcm(A0, B0, wadName, EC) {
  if (!A0 || !B0 || !EC || typeof EC.Builder !== 'function') throw new TypeError('makeEmptyStandaloneLcm needs a retail LCM and editor core');
  const before = parseLcm(A0, B0);
  if (!before || !before.bufs.length) throw wadName + ': donor has no supported static LCM render buffer';
  const imp = fixups(B0), parts = (imp[0x80000020] || []).slice().sort((a, b) => a - b), vbs = imp[0x80000023] || [];
  if (!parts.length) throw wadName + ': donor has no native level draw parts';
  if (vbs.length !== 1) throw wadName + ': blank standalone chunks currently require one shared retail level vertex buffer (found ' + vbs.length + ')';
  const queues = findLevelDrawQueues(A0, B0, wadName);
  if (!queues.opaqueParts.size) throw wadName + ': donor has no opaque draw part to use as the native render template';
  const vb = vbs[0], d0 = new DataView(A0.buffer, A0.byteOffset, A0.byteLength), U0 = o => d0.getUint32(o, true);
  const vertexCount = U0(vb + 0x0c), vertexOffset = U0(vb + 0x10), indexCount = U0(vb + 0x14), indexOffset = U0(vb + 0x18);
  if (!vertexCount || vertexCount > 65535 || !indexCount || indexCount < 3 ||
      vertexOffset + vertexCount * 24 > A0.length || indexOffset + indexCount * 2 > A0.length ||
      !imp.rel.has(vb + 0x10) || !imp.rel.has(vb + 0x18)) {
    throw wadName + ': donor shared vertex/index buffer is not a supported inline retail resource';
  }
  const template = findRenderTemplate(A0, B0, wadName, queues.opaqueParts);
  const A = A0.slice(), d = new DataView(A.buffer, A.byteOffset, A.byteLength), U = o => d.getUint32(o, true), W = (o, v) => d.setUint32(o, v >>> 0, true);
  const tailAt = o => {
    if (o < 0 || o + 24 > A.length) return false;
    const a = U(o + 16), b = U(o + 20), nI = U(o - 8);
    if (U(o - 20) !== 1 || U(o - 16) !== 5 || !nI || a >= vertexCount || b + nI + 2 > indexCount) return false;
    if (d.getUint16(indexOffset + b * 2, true) !== a || U(o + 12) !== 0) return false;
    for (let k = 0; k < 3; k++) if (!Number.isFinite(d.getFloat32(o + k * 4, true))) return false;
    return true;
  };
  let neutralised = 0;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i], end = parts[i + 1] ?? (part + 0x400);
    if (U(part + 0x0c) !== vb) throw wadName + ': part 0x' + part.toString(16) + ' does not use the donor shared vertex buffer';
    let tail = end - 44;
    if (!tailAt(tail)) {
      tail = -1;
      for (let o = part + 0x40; o < Math.min(end - 20, part + 0x200); o += 4) if (tailAt(o)) { tail = o; break; }
    }
    if (tail < 0) throw wadName + ': could not locate the native draw tail for part 0x' + part.toString(16);
    W(tail - 8, 1); W(tail + 16, 0); W(tail + 20, 0); neutralised++;
  }
  d.setUint16(indexOffset, 0, true); d.setUint16(indexOffset + 2, 0, true); d.setUint16(indexOffset + 4, 0, true);
  const blankRender = parseLcm(A, B0);
  if (!blankRender || blankRender.parts !== parts.length || blankRender.tris !== 0 || blankRender.missed > before.missed) {
    throw wadName + ': could not neutralise donor draw parts (parts=' + (blankRender?.parts ?? 'n/a') + ', triangles=' + (blankRender?.tris ?? 'n/a') + ', missed=' + (blankRender?.missed ?? 'n/a') + ')';
  }
  const oldCollision = EC.parseCollisionMesh(A, B0, 0);
  if (!oldCollision?.valid || !oldCollision.kdTree?.valid || !oldCollision.relocations?.nodePointer || !oldCollision.relocations?.vertexPointer) {
    throw wadName + ': donor global collision structure cannot be converted to an empty valid seed (' + (oldCollision?.kdTree?.warnings?.slice(0, 3).join('; ') || oldCollision?.error || 'missing relocation') + ')';
  }
  const bounds = oldCollision.kdBounds;
  if (!bounds || bounds[0].some((v, k) => !Number.isFinite(v) || !(v < bounds[1][k]))) throw wadName + ': donor collision root bounds are invalid';
  const centre = bounds[0].map((v, k) => (v + bounds[1][k]) * 0.5);
  const radius = Math.hypot(...bounds[1].map((v, k) => (v - bounds[0][k]) * 0.5));
  const bld = EC.Builder(A, B0), nodes = bld.alloc(7 * 8, 16), records = bld.alloc(3 * 16, 16);
  bld.A.set(A.subarray(oldCollision.nodePtr, oldCollision.nodePtr + 6 * 8), nodes);
  bld.W(nodes + 6 * 8, 3); bld.W(nodes + 6 * 8 + 4, 3);
  const recordDv = bld.d;
  for (let i = 0; i < 3; i++) {
    const o = records + i * 16;
    recordDv.setFloat32(o, centre[0], true); recordDv.setFloat32(o + 4, centre[1], true); recordDv.setFloat32(o + 8, centre[2], true);
    bld.W(o + 12, i < 2 ? 0x80 : 0);
  }
  bld.W(0, nodes); bld.W(4, 7);
  for (let k = 0; k < 3; k++) bld.d.setFloat32(0x0c + k * 4, centre[k], true);
  bld.d.setFloat32(0x18, radius * radius, true); bld.d.setFloat32(0x1c, radius, true);
  bld.W(0x20, records); bld.W(0x24, 3); bld.W(0x28, 7); bld.addRel(0); bld.addRel(0x20);
  const empty = bld.finish(), collisionReadback = EC.parseCollisionMesh(empty.A, empty.B, 0), collisionRecords = parseColl(empty.A);
  if (!collisionReadback?.valid || !collisionReadback.kdTree?.valid || collisionReadback.triangleCount !== 0 || collisionReadback.nodeCount !== 7 ||
      !collisionRecords || collisionRecords.n !== 3 || collisionRecords.mat.length !== 0) {
    throw wadName + ': empty collision seed failed read-back (' + (collisionReadback?.kdTree?.warnings?.slice(0, 3).join('; ') || collisionReadback?.error || 'unexpected triangle records') + ')';
  }
  return {A: empty.A, B: empty.B, report: {donorParts: parts.length, neutralisedParts: neutralised, originalRenderTriangles: before.tris,
    finalRenderTriangles: blankRender.tris, originalCollisionTriangles: oldCollision.triangleCount, finalCollisionTriangles: collisionReadback.triangleCount,
    collisionNodes: collisionReadback.nodeCount, collisionLeaves: collisionReadback.kdTree.leafCount, templateName: template.templateName}};
}

function appendInilevelRender(A0, B0, wadName, data, EC, options = {}) {
  if (!A0 || !B0 || !data || !EC || typeof EC.Builder !== 'function') throw new TypeError('appendInilevelRender needs a retail LCM, parsed .inilevel data and editor core');
  if (!Array.isArray(data.meshes) || !data.meshes.length) throw wadName + ': .inilevel has no render parts';
  if (!Array.isArray(data.materials) || !data.materials.length) throw wadName + ': .inilevel has no materials';
  const before = parseLcm(A0, B0);
  if (!before || !before.bufs.length) throw wadName + ': target is not a supported retail LCM render resource';
  const drawQueuesBefore = findLevelDrawQueues(A0, B0, wadName);
  if (options.referenceStaticTemplate && (options.untextured || options.clearTemplateFlag200 || options.clearTemplateFlag20)) {
    throw wadName + ': the plain static reference-template test cannot be combined with other render diagnostics';
  }
  const template = findRenderTemplate(A0, B0, wadName, drawQueuesBefore.opaqueParts, {untextured: !!options.untextured, referenceStaticTemplate: !!options.referenceStaticTemplate});
  const useTemplateTexture = !!options.useTemplateTexture || !!options.referenceStaticTemplate;
  const sourceTemplateFlags = u32(new DataView(A0.buffer, A0.byteOffset, A0.byteLength), template.part + 0x40);
  if (options.clearTemplateFlag200 && (!template.hasTexture || options.untextured || !useTemplateTexture || !(sourceTemplateFlags & 0x200))) {
    throw wadName + ': clear-template-flag-0x200 diagnostic requires the retail-template-texture control and a textured template with bit 0x200 set';
  }
  if (options.clearTemplateFlag20 && (options.clearTemplateFlag200 || !template.hasTexture || options.untextured || !useTemplateTexture || !(sourceTemplateFlags & 0x20))) {
    throw wadName + ': clear-template-flag-0x20 diagnostic requires only the retail-template-texture control and a textured template with bit 0x20 set';
  }
  const placementWarning = levelPlacementWarning(boundsFromRenderBuffers(before.bufs), boundsFromInilevelMeshes(data.meshes));
  const vbTemplate = template.vb, texTemplate = template.tex;
  const sourceImp = fixups(B0), nativeVbs = sourceImp[0x80000023] || [];
  // All inspected retail 10-series LCMs use one shared level vertex buffer.
  // Every static draw part points to that same resource; the game does not
  // demonstrate a multi-VB level layout. Do not invent a second 0x23 resource.
  if (nativeVbs.length !== 1 || nativeVbs[0] !== vbTemplate) {
    throw wadName + ': this LCM does not use the single shared retail level vertex buffer layout; multi-buffer level rendering is not yet verified';
  }
  const nativeParts = sourceImp[0x80000020] || [];
  const sourceDv = new DataView(A0.buffer, A0.byteOffset, A0.byteLength);
  const sourceU = o => sourceDv.getUint32(o, true);
  const mismatchedParts = nativeParts.filter(p => sourceU(p + 0x0c) !== vbTemplate);
  if (mismatchedParts.length) {
    throw wadName + ': ' + mismatchedParts.length + ' retail level draw parts do not reference the shared vertex buffer; refusing an unverified mixed-buffer append';
  }
  const sourceVbData = {
    vertexCount: sourceU(vbTemplate + 0x0c),
    vertexOffset: sourceU(vbTemplate + 0x10),
    indexCount: sourceU(vbTemplate + 0x14),
    indexOffset: sourceU(vbTemplate + 0x18)
  };
  if (!sourceImp.rel.has(vbTemplate + 0x10) || !sourceImp.rel.has(vbTemplate + 0x18) ||
      !sourceVbData.vertexCount || !sourceVbData.indexCount ||
      sourceVbData.vertexOffset + sourceVbData.vertexCount * 24 > A0.length ||
      sourceVbData.indexOffset + sourceVbData.indexCount * 2 > A0.length) {
    throw wadName + ': shared retail vertex/index buffer payload or relocations are invalid';
  }
  const appendedVertexCapacity = data.meshes.reduce((n, mesh) => n + (Number.isInteger(mesh.vertexCount) ? mesh.vertexCount : 0), 0);
  const appendedIndexCapacity = data.meshes.reduce((n, mesh) => {
    const material = data.materials[mesh.material];
    const expandTwoSided = !!material?.doubleSided && !options.forceSingleSided;
    const triangleCount = mesh.indices instanceof Uint16Array ? mesh.indices.length / 3 * (expandTwoSided ? 2 : 1) : 0;
    return n + (triangleCount >= 1 && Number.isInteger(triangleCount) ? triangleCount * 5 - 2 : 0);
  }, 0);
  if (sourceVbData.vertexCount + appendedVertexCapacity > 65535) {
    throw wadName + ': appending custom vertices to the shared retail level buffer would exceed its 16-bit vertex-index limit (' + (sourceVbData.vertexCount + appendedVertexCapacity) + ')';
  }
  if (!appendedVertexCapacity || !appendedIndexCapacity || sourceVbData.indexCount + appendedIndexCapacity > 0xffffffff) {
    throw wadName + ': imported render geometry has invalid aggregate vertex/index capacity';
  }
  const bld = EC.Builder(A0, B0), W = bld.W, A = () => bld.A;
  // Retail level VBs are one inline resource: the vertex stream begins at
  // VB+0x30 and the index stream immediately follows it. Relocate the entire
  // shared resource as one block, keeping this native inline layout intact.
  const combinedVertexCount = sourceVbData.vertexCount + appendedVertexCapacity;
  const combinedIndexCount = sourceVbData.indexCount + appendedIndexCapacity;
  const combinedResourceOffset = bld.alloc(0x30 + combinedVertexCount * 24 + combinedIndexCount * 2, 16);
  const combinedVertexOffset = combinedResourceOffset + 0x30;
  const combinedIndexOffset = combinedVertexOffset + combinedVertexCount * 24;
  bld.A.set(A0.subarray(vbTemplate, vbTemplate + 0x30), combinedResourceOffset);
  bld.A.set(A0.subarray(sourceVbData.vertexOffset, sourceVbData.vertexOffset + sourceVbData.vertexCount * 24), combinedVertexOffset);
  bld.A.set(A0.subarray(sourceVbData.indexOffset, sourceVbData.indexOffset + sourceVbData.indexCount * 2), combinedIndexOffset);
  // Every retail part refers to the same VB object. Repoint all of those
  // existing pointer slots to the relocated shared resource before adding the
  // new parts, which will use the same pointer.
  for (const slot of sourceImp.rel) if (sourceU(slot) === vbTemplate) W(slot, combinedResourceOffset);
  let appendedVertices = 0, appendedIndices = 0;
  const textureOffsets = new Map(), reports = [], visibilityDescriptors = [];
  const d0 = new DataView(A0.buffer, A0.byteOffset, A0.byteLength);
  const sourceCollision = parseColl(A0);
  const allocCopy = (source, size, alignment = 16) => {
    const off = bld.alloc(size, alignment);
    bld.A.set(A0.subarray(source, source + size), off);
    return off;
  };
  const addTexture = materialIndex => {
    if (textureOffsets.has(materialIndex)) return textureOffsets.get(materialIndex);
    const material = data.materials[materialIndex];
    if (!material) throw wadName + ': mesh references missing material ' + materialIndex;
    if (!template.hasTexture || options.untextured) { textureOffsets.set(materialIndex, 0); return 0; }
    // Diagnostic control: bind the target LCM's own retail texture from the
    // selected textured part template. This keeps the new part/template/state
    // path unchanged while bypassing custom TGA payloads and new texture imports.
    if (useTemplateTexture) { textureOffsets.set(materialIndex, template.tex); return template.tex; }
    const sourceBytes = material.texture ? data.textures.get(material.texture) : null;
    if (material.texture && !sourceBytes) throw wadName + ': missing texture ' + material.texture;
    const tga = validateAndBakeTga(sourceBytes, material, wadName);
    const texture = allocCopy(texTemplate, 0x20);
    const image = bld.alloc(tga.bytes.length, 16);
    bld.A.set(tga.bytes, image);
    W(texture + 4, tga.width); W(texture + 8, tga.height);
    W(texture + 0x10, image); W(texture + 0x14, tga.bytes.length);
    const textureRels = []; bld.addRelTo(textureRels, texture + 0x10);
    bld.addSpec(1, texture, textureRels);
    textureOffsets.set(materialIndex, texture);
    return texture;
  };
  for (const mesh of data.meshes) {
    const name = mesh.name || ('Level mesh ' + (reports.length + 1));
    if (!Number.isInteger(mesh.vertexCount) || mesh.vertexCount < 3 || mesh.vertexCount > 65535 || mesh.positions.length !== mesh.vertexCount * 3 || mesh.colors.length !== mesh.vertexCount * 4 || mesh.uvs.length !== mesh.vertexCount * 2) {
      throw wadName + ': render part ' + name + ' has invalid vertex attributes';
    }
    if (!(mesh.indices instanceof Uint16Array) || mesh.indices.length < 3 || mesh.indices.length % 3 || mesh.indices.some(i => i >= mesh.vertexCount)) {
      throw wadName + ': render part ' + name + ' has invalid uint16 triangle indices';
    }
    for (let i = 0; i < mesh.positions.length; i += 3) if (!isFinite3(mesh.positions.subarray(i, i + 3))) throw wadName + ': render part ' + name + ' has a non-finite position';
    for (const u of mesh.uvs) if (!Number.isFinite(u)) throw wadName + ': render part ' + name + ' has a non-finite UV';
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < mesh.positions.length; i += 3) for (let k = 0; k < 3; k++) {
      const value = mesh.positions[i + k]; min[k] = Math.min(min[k], value); max[k] = Math.max(max[k], value);
    }
    const material = data.materials[mesh.material];
    if (!material) throw wadName + ': render part ' + name + ' references missing material ' + mesh.material;
    const texture = addTexture(mesh.material);
    const useDoubleSided = !!material.doubleSided && !options.forceSingleSided;
    const renderIndices = useDoubleSided ? doubleSidedTriangleList(mesh.indices, wadName + ' / ' + name) : mesh.indices;
    const strip = triangleStrip(renderIndices, wadName + ' / ' + name);
    // Append into the target's one shared retail VB. The prefix at vertex
    // indices 0..5, all original vertices/indices, and every existing part's
    // ranges are retained. A new part points to this same VB and selects its
    // appended vertex/index range through the draw-tail fields.
    const baseVertexCount = sourceVbData.vertexCount + appendedVertices;
    const baseIndexCount = sourceVbData.indexCount + appendedIndices;
    if (baseVertexCount + mesh.vertexCount > 65535) {
      throw wadName + ': shared native vertex buffer exceeds its 16-bit vertex-index limit';
    }
    let vertexDv = new DataView(bld.A.buffer, bld.A.byteOffset, bld.A.byteLength);
    for (let v = 0; v < mesh.vertexCount; v++) {
      const p = combinedVertexOffset + (baseVertexCount + v) * 24, c = v * 4;
      vertexDv.setFloat32(p, mesh.positions[v * 3], true);
      vertexDv.setFloat32(p + 4, mesh.positions[v * 3 + 1], true);
      vertexDv.setFloat32(p + 8, mesh.positions[v * 3 + 2], true);
      // .inilevel parser exposes colours as RGBA; native LCM stores BGRA.
      const base = material.baseColor || [1, 1, 1, 1];
      const colourByte = (source, factor) => Math.max(0, Math.min(255, Math.round(source * factor)));
      if (options.untextured) {
        // The diagnostic path uses a stock textureless LCM part. Bake the
        // material tint into the diffuse vertex colour instead of creating a
        // kind-1 texture resource, isolating texture binding from geometry.
        bld.A[p + 12] = colourByte(mesh.colors[c + 2], base[2]);
        bld.A[p + 13] = colourByte(mesh.colors[c + 1], base[1]);
        bld.A[p + 14] = colourByte(mesh.colors[c], base[0]);
        bld.A[p + 15] = colourByte(mesh.colors[c + 3], base[3]);
      } else {
        bld.A[p + 12] = mesh.colors[c + 2];
        bld.A[p + 13] = mesh.colors[c + 1];
        bld.A[p + 14] = mesh.colors[c];
        bld.A[p + 15] = colourByte(mesh.colors[c + 3], base[3]);
      }
      vertexDv.setFloat32(p + 16, mesh.uvs[v * 2], true);
      vertexDv.setFloat32(p + 20, 1 - mesh.uvs[v * 2 + 1], true);
    }
    for (let i = 0; i < strip.length; i++) vertexDv.setUint16(combinedIndexOffset + (baseIndexCount + i) * 2, baseVertexCount + strip[i], true);
    appendedVertices += mesh.vertexCount;
    appendedIndices += strip.length;

    const metaTemplate = u32(d0, template.part + template.metaSlot);
    const templateBoundRadius = f32(d0, metaTemplate + 0x1c);
    const meta = allocCopy(metaTemplate, 0x60);
    const part = allocCopy(template.part, template.partSize);
    let stage1ResetArray = 0;
    if (template.hasTexture && !options.untextured) {
      // Current .inilevel native material contract is one direct kind-1 base
      // texture per textured part. It has no layered-texture/animation model yet.
      // Always terminate stage 1 so a previously drawn retail kind-7 material
      // cannot leak its ADD combiner (and animated secondary layer) into this
      // single-layer custom material. This is part of normal material setup,
      // not an optional diagnostic. When layered materials are implemented,
      // their stage operations must be emitted explicitly from their own data.
      const templateStageCount = u32(d0, template.part + 0x24);
      const templateStagePointer = u32(d0, template.part + 0x28);
      if (templateStageCount !== 0 || templateStagePointer !== 0 || sourceImp.rel.has(template.part + 0x28)) {
        throw wadName + ': selected textured template has an existing texture-stage-state array; single-layer material reset cannot safely replace it';
      }
      stage1ResetArray = bld.alloc(0x0c, 4);
      const stageStateView = new DataView(bld.A.buffer, bld.A.byteOffset, bld.A.byteLength);
      stageStateView.setUint32(stage1ResetArray, 1, true); // D3D texture stage 1
      stageStateView.setUint32(stage1ResetArray + 4, 1, true); // D3DTSS_COLOROP
      stageStateView.setUint32(stage1ResetArray + 8, 1, true); // D3DTOP_DISABLE
      W(part + 0x24, 1);
    }
    const outputTemplateFlags = options.clearTemplateFlag20 ? (sourceTemplateFlags & ~0x20) : (options.clearTemplateFlag200 ? (sourceTemplateFlags & ~0x200) : sourceTemplateFlags);
    W(part + 0x40, outputTemplateFlags);
    const dv = new DataView(bld.A.buffer, bld.A.byteOffset, bld.A.byteLength);
    // The game does not discover per-part visibility bounds from the draw-part
    // resource alone. Each unique metadata block also has a kind-0x0A resource:
    // {reserved[4], integer origin xyz, metadata pointer}. During frame culling,
    // the loader walks these records and stamps metadata+0x30 with the current
    // visibility generation. The draw-list builder later skips parts whose
    // metadata was not stamped. Without this companion record, a valid queued
    // part is never submitted to Direct3D.
    const centre = [0, 1, 2].map(k => (min[k] + max[k]) * 0.5);
    const descriptor = bld.alloc(0x20, 16);
    bld.A.fill(0, descriptor, descriptor + 0x20);
    const descriptorRels = [];
    for (let k = 0; k < 3; k++) {
      if (!Number.isFinite(centre[k]) || Math.abs(centre[k]) > 2147483000) {
        throw wadName + ': render part ' + name + ' has a visibility centre outside the native descriptor range';
      }
      // The runtime adds signed integer descriptor coordinates to the float
      // centre stored in metadata. Split at the nearest integer so the float
      // residual remains small and their sum exactly reconstructs the mesh
      // centre used by the renderer's sphere/frustum test.
      const origin = Math.round(centre[k]);
      dv.setInt32(descriptor + 0x10 + k * 4, origin, true);
      dv.setFloat32(meta + 0x10 + k * 4, centre[k] - origin, true);
    }
    let radiusSq = 0;
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const dx = mesh.positions[i] - centre[0], dy = mesh.positions[i + 1] - centre[1], dz = mesh.positions[i + 2] - centre[2];
      radiusSq = Math.max(radiusSq, dx * dx + dy * dy + dz * dz);
    }
    const boundRadius = Math.sqrt(radiusSq) + 0.01;
    dv.setFloat32(meta + 0x1c, boundRadius, true);
    W(descriptor + 0x1c, meta);
    // The descriptor is registered in the target spatial-cell lists after all
    // mesh bounds have been calculated. Do not emit an orphan kind-0x0A import.
    descriptorRels.push(descriptor + 0x1c);
    visibilityDescriptors.push({name, offset: descriptor, rels: descriptorRels, centre, radius: boundRadius});
    // Keep the per-frame generation tag at its retail sentinel; the game's
    // visibility pass writes the current token when this descriptor is tested.
    // Give the new part a bounded display/name string in its copied metadata block.
    const label = TEXT_ENCODER.encode(name.slice(0, 15));
    bld.A.fill(0, meta + 0x20, meta + 0x30);
    bld.A.set(label.subarray(0, 15), meta + 0x20);
    const rels = [];
    const previousOpaqueHead = bld.U(drawQueuesBefore.headSlots[0]);
    const pointerValues = [[0x0c, combinedResourceOffset], ...(template.hasTexture ? [[0x10, texture]] : []), ...(stage1ResetArray ? [[0x28, stage1ResetArray]] : []), [template.metaSlot, meta],
      ...template.internalOffsets.map(at => [at, part + (u32(d0, template.part + at) - template.part)]),
      [0x44, previousOpaqueHead]];
    for (const [at, value] of pointerValues) { W(part + at, value); bld.addRelTo(rels, part + at); }
    // Prepend the new opaque draw part to the native level queue. The new part's
    // +0x44 link reaches the previous head, and the existing relocated LCM head
    // slot is redirected to this part. Resource-directory registration alone
    // is insufficient: the game renders only parts reachable from these lists.
    W(drawQueuesBefore.headSlots[0], part);
    // Preserve the retail draw-tail convention. firstVertex/firstIndex are
    // offsets into the target's existing shared VB streams.
    const tail = part + template.tail;
    W(tail - 20, 1); W(tail - 16, 5);
    let minReferencedVertex = 0xffff, maxReferencedVertex = 0;
    for (let i = 0; i < renderIndices.length; i++) { minReferencedVertex = Math.min(minReferencedVertex, renderIndices[i]); maxReferencedVertex = Math.max(maxReferencedVertex, renderIndices[i]); }
    const drawVertexCount = maxReferencedVertex - minReferencedVertex + 1;
    W(tail - 12, drawVertexCount); W(tail - 8, strip.length - 2);
    for (let k = 0; k < 3; k++) dv.setFloat32(tail + k * 4, (min[k] + max[k]) * 0.5, true);
    W(tail + 12, 0); W(tail + 16, baseVertexCount + minReferencedVertex); W(tail + 20, baseIndexCount);
    bld.addSpec(0x20, part, rels);
    reports.push({name, partOffset: part, vertices: mesh.vertexCount, sourceTriangles: mesh.indexCount / 3, triangles: renderIndices.length / 3,
      sourceDoubleSided: !!material.doubleSided, doubleSided: useDoubleSided, untextured: !!options.untextured, indices: strip.length, material: material.name,
      templateBoundRadius, boundRadius, visibilityDescriptorOffset: descriptor, visibilityCentre: centre, metadataSlot: template.metaSlot, tailOffset: template.tail,
      sharedVertexBuffer: combinedResourceOffset, baseVertexStart: baseVertexCount, baseIndexStart: baseIndexCount, minReferencedVertex, maxReferencedVertex, drawVertexCount, firstStripIndex: strip[0],
      totalVertexCount: sourceVbData.vertexCount + appendedVertices, totalIndexCount: sourceVbData.indexCount + appendedIndices,
      sourceTemplateFlags, outputTemplateFlags, templatePartOffset: template.part, templateTextureOffset: template.tex, templateName: template.templateName,
      stage1ColorOpDisabled: !!stage1ResetArray, stage1ResetArrayOffset: stage1ResetArray || null,
      clearedTemplateFlag200: !!options.clearTemplateFlag200, clearedTemplateFlag20: !!options.clearTemplateFlag20});
  }
  // Populate the relocated inline shared VB header. Its resource-directory
  // record and internal relocation slots are swapped in the finished fixup
  // stream below, so the game still sees exactly one native 0x23 resource.
  W(combinedResourceOffset + 0x0c, sourceVbData.vertexCount + appendedVertices);
  W(combinedResourceOffset + 0x10, combinedVertexOffset);
  W(combinedResourceOffset + 0x14, sourceVbData.indexCount + appendedIndices);
  W(combinedResourceOffset + 0x18, combinedIndexOffset);
  const visibilityRegistration = registerVisibilityDescriptors(bld, A0, B0, wadName, visibilityDescriptors);
  const collisionBefore = data.collision?.triangleCount ? EC.parseCollisionMesh(A0, B0, 0) : null;
  const collisionReport = appendInilevelCollision(bld, A0, B0, data.collision, EC, wadName);
  const built = bld.finish();
  const relocatedFixups = replaceResourceImport(built.B, 0x23, vbTemplate, combinedResourceOffset,
    [vbTemplate + 0x10, vbTemplate + 0x18], [combinedResourceOffset + 0x10, combinedResourceOffset + 0x18]);
  const visibilityFixups = replaceImportLocations(relocatedFixups, 0x0A, visibilityRegistration.relocations);
  // Resource directories are required by the PC LCM loader to instantiate newly imported
  // textures. The existing level vertex buffer remains the only 0x23 resource.
  const healed = EC.healResDir(built.A, visibilityFixups, B0);
  const finalLcm = parseLcm(healed.A, healed.B);
  const finalDrawQueues = findLevelDrawQueues(healed.A, healed.B, wadName);
  const finalImp = fixups(healed.B), finalVbs = finalImp[0x80000023] || [], finalPartResources = finalImp[0x80000020] || [];
  const finalDv = new DataView(healed.A.buffer, healed.A.byteOffset, healed.A.byteLength);
  const spatialRoot = (finalImp[0x8000010c] || [])[0];
  if (spatialRoot == null) throw wadName + ': final LCM lost its native spatial-cell table import';
  const spatialU32 = o => finalDv.getUint32(o, true);
  const spatialCount = spatialU32(spatialRoot + 4), spatialArray = spatialU32(spatialRoot + 8), spatialReferenced = new Set();
  let spatialDescriptorTotal = 0, spatialNeighbourPointers = 0, spatialLookupCandidates = 0;
  if (spatialCount < 1 || spatialCount > 256 || spatialArray + spatialCount * 0x80 > healed.A.length || !finalImp.rel.has(spatialRoot + 8)) {
    throw wadName + ': final spatial root has an invalid cell table/count or missing root relocation';
  }
  for (let i = 0; i < spatialCount; i++) {
    const cell = spatialArray + i * 0x80, updateCount = finalDv.getUint8(cell + 0x60), lookupCount = finalDv.getUint8(cell + 0x61),
      count = finalDv.getUint16(cell + 0x62, true), neighbourArray = spatialU32(cell + 0x64), ptr = spatialU32(cell + 0x6c);
    if (updateCount > 64 || lookupCount > updateCount || !finalImp.rel.has(cell + 0x64)) throw wadName + ': final spatial cell ' + i + ' has invalid update/lookup counts or missing neighbour relocation';
    if (updateCount && neighbourArray + updateCount * 4 > healed.A.length) throw wadName + ': final spatial cell ' + i + ' neighbour array is out of range';
    for (let j = 0; j < updateCount; j++) {
      const slot = neighbourArray + j * 4, target = spatialU32(slot), delta = target - spatialArray;
      if (!finalImp.rel.has(slot) || delta < 0 || delta >= spatialCount * 0x80 || delta % 0x80 !== 0) throw wadName + ': final spatial cell ' + i + ' has an invalid neighbour pointer at slot ' + j;
    }
    spatialNeighbourPointers += updateCount; spatialLookupCandidates += lookupCount;
    spatialDescriptorTotal += count;
    if (ptr + count * 0x20 > healed.A.length || !finalImp.rel.has(cell + 0x6c)) throw wadName + ': final spatial cell ' + i + ' has an invalid descriptor array or missing relocation';
    for (let j = 0; j < count; j++) {
      const descriptor = ptr + j * 0x20;
      if (spatialReferenced.has(descriptor)) throw wadName + ': final spatial descriptor 0x' + descriptor.toString(16) + ' is shared by multiple cell lists';
      spatialReferenced.add(descriptor);
    }
  }
  const finalVisibilityImports = new Set(finalImp[0x8000000a] || []);
  const missingVisibility = [...finalVisibilityImports].filter(offset => !spatialReferenced.has(offset));
  const unimportedVisibility = [...spatialReferenced].filter(offset => !finalVisibilityImports.has(offset));
  if (missingVisibility.length || unimportedVisibility.length || spatialDescriptorTotal !== finalVisibilityImports.size) {
    throw wadName + ': final visibility registration mismatch (kind-0x0A imports=' + finalVisibilityImports.size + ', cell descriptors=' + spatialDescriptorTotal + ', unique=' + spatialReferenced.size + ', orphan imports=' + missingVisibility.length + ', unimported cell entries=' + unimportedVisibility.length + ')';
  }
  const finalU = o => finalDv.getUint32(o, true);
  if (finalVbs.length !== 1 || finalVbs[0] !== combinedResourceOffset ||
      finalU(combinedResourceOffset + 0x10) !== combinedResourceOffset + 0x30 ||
      finalU(combinedResourceOffset + 0x18) !== combinedResourceOffset + 0x30 + finalU(combinedResourceOffset + 0x0c) * 24) {
    throw wadName + ': relocated shared VB failed native inline-layout read-back (one kind-0x23 resource, +0x30 vertices, contiguous index stream required)';
  }
  const staleVbReferences = [...finalImp.rel].filter(slot => finalU(slot) === vbTemplate);
  const mismatchedFinalParts = finalPartResources.filter(part => finalU(part + 0x0c) !== combinedResourceOffset);
  if (staleVbReferences.length || mismatchedFinalParts.length) {
    throw wadName + ': shared VB relocation left ' + staleVbReferences.length + ' stale pointer(s) and ' + mismatchedFinalParts.length + ' draw part(s) on the old resource';
  }
  const expectedTriangles = reports.reduce((n, r) => n + r.triangles, 0);
  if (!finalLcm || finalLcm.parts !== before.parts + reports.length || finalLcm.tris !== before.tris + expectedTriangles || finalLcm.missed > before.missed) {
    throw wadName + ': native LCM render read-back failed (parts ' + before.parts + '→' + (finalLcm?.parts ?? '?') + ', triangles ' + before.tris + '→' + (finalLcm?.tris ?? '?') + ', missed ' + before.missed + '→' + (finalLcm?.missed ?? '?') + ')';
  }
  const finalCollision = parseColl(healed.A);
  const finalCollisionMesh = data.collision?.triangleCount ? EC.parseCollisionMesh(healed.A, healed.B, 0) : null;
  if (data.collision?.triangleCount && (!finalCollisionMesh?.valid || !finalCollisionMesh.kdTree?.valid || finalCollisionMesh.triangleCount !== collisionReport.total || finalCollisionMesh.nodeCount !== collisionReport.kdNodes || finalCollisionMesh.kdTree.leafCount !== collisionReport.kdLeaves)) {
    throw wadName + ': native collision read-back failed (valid=' + !!finalCollisionMesh?.valid + ', kd=' + !!finalCollisionMesh?.kdTree?.valid + ', triangles=' + (finalCollisionMesh?.triangleCount ?? 'n/a') + '/' + collisionReport.total + ', error=' + (finalCollisionMesh?.error || finalCollisionMesh?.kdTree?.warnings?.slice(0, 4).join('; ') || 'unknown') + ')';
  }
  if (data.collision?.triangleCount) assertOriginalCollisionPreserved(EC.parseCollisionMesh(A0, B0, 0), finalCollisionMesh, wadName);
  if (finalDrawQueues.totalParts !== before.parts + reports.length || finalDrawQueues.opaqueParts.size !== drawQueuesBefore.opaqueParts.size + reports.length || finalDrawQueues.translucentParts.size !== drawQueuesBefore.translucentParts.size) {
    throw wadName + ': native render queue read-back failed (opaque ' + drawQueuesBefore.opaqueParts.size + '→' + finalDrawQueues.opaqueParts.size + ', translucent ' + drawQueuesBefore.translucentParts.size + '→' + finalDrawQueues.translucentParts.size + ')';
  }
  if (!data.collision?.triangleCount && (sourceCollision?.n || 0) !== (finalCollision?.n || 0)) throw wadName + ': existing native collision record count unexpectedly changed without an imported collision stream';
  const collisionStructureWarning = data.collision?.triangleCount && collisionBefore?.valid ?
    'Retail KD split backbone retained: ' + collisionBefore.nodeCount + '→' + collisionReport.kdNodes + ' nodes and ' + collisionBefore.kdTree.leafCount + '→' + collisionReport.kdLeaves +
    ' leaves. Imported triangles remain whole and are copied into every intersected final KD leaf region (' + collisionReport.sourceAdded + ' source faces → ' + collisionReport.preLocalFragments + ' retail-region placements; ' + collisionReport.localSubtreeDuplicatePlacements + ' additional local-subtree copies; ' + collisionReport.added + ' final placements total). ' + collisionReport.touchedLeaves +
    ' existing leaves were re-authored where needed, and ' + collisionReport.addedBranches + ' previously empty retail branches were populated. Original retail split nodes and split values were retained. Existing retail triangles retain centroid ownership inside newly generated local subtrees; imported faces use overlap ownership there as well. The broadphase sphere is preserved unchanged when possible and otherwise rebuilt from the expanded KD root AABB. This overlap-routing diagnostic addresses source faces that cross multiple query regions; in-game ground, seam and snap-to-ground behaviour still needs confirmation.' : null;
  return {A: healed.A, B: healed.B, placementWarning, collisionStructureWarning,
    visibilityRegistration: {spatialCells: spatialCount, changedCells: visibilityRegistration.cells, assignments: visibilityRegistration.assignments,
      originalDescriptors: visibilityRegistration.originalImports, addedDescriptors: visibilityRegistration.addedDescriptors,
      addedSpatialCells: visibilityRegistration.addedSpatialCells, remoteRegion: visibilityRegistration.remoteRegion,
      neighbourUpdatePointers: spatialNeighbourPointers, currentCellLookupCandidates: spatialLookupCandidates,
      finalDescriptors: finalVisibilityImports.size, orphanDescriptors: 0},
    added: {parts: reports.length, vertexBuffers: 0, sharedVertexBuffer: true, textures: [...textureOffsets.values()].filter(Boolean).length,
    triangles: expectedTriangles, sourceTriangles: reports.reduce((n, r) => n + r.sourceTriangles, 0),
    clearTemplateFlag200Diagnostic: !!options.clearTemplateFlag200,
    clearTemplateFlag20Diagnostic: !!options.clearTemplateFlag20,
    singleLayerMaterialStage1Reset: reports.some(r => r.stage1ColorOpDisabled),
    referenceStaticTemplateDiagnostic: !!options.referenceStaticTemplate,
    template: {partOffset: template.part, textureOffset: template.tex, name: template.templateName},
    templateFlags: {source: sourceTemplateFlags, output: options.clearTemplateFlag20 ? (sourceTemplateFlags & ~0x20) : (options.clearTemplateFlag200 ? (sourceTemplateFlags & ~0x200) : sourceTemplateFlags)},
    doubleSidedParts: reports.filter(r => r.doubleSided).length, oneSidedOverride: !!options.forceSingleSided, untexturedDiagnostic: !!options.untextured,
    collisionTriangles: collisionReport.added, collisionSourceTriangles: collisionReport.sourceAdded, collisionPreLocalFragments: collisionReport.preLocalFragments, collisionPreLocalDuplicatePlacements: collisionReport.initialDuplicatePlacements, collisionLocalSubtreeDuplicatePlacements: collisionReport.localSubtreeDuplicatePlacements, collisionDuplicatePlacements: collisionReport.duplicatePlacements, collisionSourcePlacementCounts: collisionReport.sourcePlacementCounts,
    collisionFragmentedSources: collisionReport.fragmentedSources, collisionLocalSubtreeFragments: collisionReport.localSubtreeFragments,
    collisionPreserved: collisionReport.preserved, collisionTotal: collisionReport.total, collisionMaxSourceAreaError: collisionReport.maxAreaError,
    collisionRetailBackbonePreserved: !!collisionReport.retailBackbonePreserved, collisionRootBoundsExpanded: !!collisionReport.rootBoundsExpanded, collisionBroadphaseSphere: collisionReport.broadphaseSphere, collisionRootBounds: collisionReport.rootBounds, collisionTouchedLeaves: collisionReport.touchedLeaves,
    collisionSplitLeaves: collisionReport.splitLeaves, collisionAddedBranches: collisionReport.addedBranches,
    collisionFinalKdNodes: collisionReport.kdNodes, collisionFinalKdLeaves: collisionReport.kdLeaves,
    collisionMaxLeafRecordCount: collisionReport.maxLeafRecordCount, drawQueue: 'opaque'},
    resourceDirectory: healed.added, reports, readback: {parts: finalLcm.parts, triangles: finalLcm.tris, missed: finalLcm.missed,
      textures: finalLcm.textureOffsets.length, vertexBufferResources: (fixups(healed.B)[0x80000023] || []).length, sharedVertexBuffer: combinedResourceOffset, vertexCount: sourceVbData.vertexCount + appendedVertices, indexCount: sourceVbData.indexCount + appendedIndices, collisionRecords: finalCollision?.n || 0, collisionTriangles: finalCollisionMesh?.triangleCount ?? (sourceCollision?.mat?.length || 0), collisionKdNodes: finalCollisionMesh?.nodeCount ?? null, collisionKdLeaves: finalCollisionMesh?.kdTree?.leafCount ?? null}};
}

export {appendInilevelRender, triangleStrip, findLevelDrawQueues, makeEmptyStandaloneLcm, inspectSpatialCellRoot};
