// Stage 2: append Blender .inilevel render resources and merge native collision into a retail LCM.
// Imported render resources and separate tagged collision geometry are merged into a native LCM.
// The global collision KD tree is rebuilt whenever the bundle contributes collision triangles.
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

export function findRenderTemplate(A, B, wadName, allowedParts = null, options = {}) {
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
    // The level-part auxiliary record is a 0x60-byte, pointer-free record.
    if ([...rel].some(o => o >= meta && o < meta + 0x60)) continue;
    return {part: p, vb, tex, meta, partSize, tail, metaSlot, internalOffsets: layout.internal, hasTexture: layout.hasTexture};
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
  const counts = new Map();
  for (let i = 0; i < before.triangleCount; i++) {
    const key = collisionTriangleKey(before, i); counts.set(key, (counts.get(key) || 0) + 1);
  }
  for (let i = 0; i < after.triangleCount; i++) {
    const key = collisionTriangleKey(after, i), count = counts.get(key) || 0;
    if (count) counts.set(key, count - 1);
  }
  const missing = [...counts].filter(([, count]) => count > 0);
  if (missing.length) throw wadName + ': collision merge read-back lost ' + missing.reduce((n, [, count]) => n + count, 0) + ' original triangles, tags or auxiliary flags';
}

function appendInilevelCollision(bld, A0, B0, collision, EC, wadName) {
  if (!collision || !collision.triangleCount) { const oldCount = parseColl(A0)?.mat?.length || 0; return {added: 0, preserved: oldCount, total: oldCount, kdNodes: null, kdLeaves: null}; }
  const original = EC.parseCollisionMesh(A0, B0, 0);
  if (!original?.valid || !original.kdTree?.valid) {
    throw wadName + ': existing level collision/KD tree is not valid enough to merge safely (' + (original?.kdTree?.warnings?.slice(0, 3).join('; ') || original?.error || 'unknown collision parse error') + ')';
  }
  if (!bld.rel.has(0) || !bld.rel.has(0x20)) {
    throw wadName + ': global LCM collision header is missing its node/record pointer relocations';
  }
  const oldCount = original.triangleCount, addCount = collision.triangleCount, total = oldCount + addCount;
  if (!original.triangleFlags || original.triangleFlags.length !== oldCount) throw wadName + ': existing collision triangle auxiliary flags are unavailable; refusing to rebuild and alter the retail collision stream';
  if (!collision.positions || collision.positions.length !== addCount * 9 || !collision.tags || collision.tags.length !== addCount) {
    throw wadName + ': imported collision geometry does not match its triangle/tag counts';
  }
  // The shared PC CollMesh encoder expects source-model Z and normals to be
  // mirrored on input, then converts both back to game coordinates. LCM and
  // .inilevel positions are already in game coordinates, so mirror here once.
  const positions = new Float32Array(total * 9), normals = new Float32Array(total * 9);
  const faceMaterialTags = new Uint16Array(total), faceFlags = new Uint16Array(total);
  positions.set(original.positions, 0); positions.set(collision.positions, oldCount * 9);
  faceMaterialTags.set(original.materials, 0); faceMaterialTags.set(collision.tags, oldCount);
  // Preserve all retail per-triangle auxiliary bits. The parser's 0x80 valid,
  // 0x40 triangle-end and 0x100 reverse bits are regenerated from topology;
  // every other low-16 bit is retained exactly. New Blender faces use the
  // known working 0x10 generated-mesh bit.
  for (let i = 0; i < oldCount; i++) faceFlags[i] = original.triangleFlags[i] & 0xffff;
  faceFlags.fill(0x10, oldCount);
  const indices = new Uint32Array(total * 3);
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  for (let t = 0; t < total; t++) {
    const at = t * 9, p0 = [positions[at], positions[at + 1], positions[at + 2]],
      p1 = [positions[at + 3], positions[at + 4], positions[at + 5]],
      p2 = [positions[at + 6], positions[at + 7], positions[at + 8]];
    const n = cross(sub(p1, p0), sub(p2, p0));
    if (!n.every(Number.isFinite) || Math.hypot(...n) < 1e-10) throw wadName + ': combined collision contains a degenerate triangle at index ' + t;
    for (let c = 0; c < 3; c++) {
      const v = t * 3 + c, q = at + c * 3;
      // Positions/normals are mirrored here so buildMeshCollisionShape's
      // established source-model Z reflection writes the original game-space.
      positions[q + 2] = -positions[q + 2];
      normals[q] = n[0]; normals[q + 1] = n[1]; normals[q + 2] = -n[2];
      indices[v] = v;
    }
  }
  let shape = null, lastPartitionError = null;
  // Different retail levels have different centroid distributions. Try several
  // leaf caps because the game's split planes are quantized to 1/1024 units;
  // one cap can fail on coincident/tightly clustered centroids while another
  // produces a valid tree without changing a single triangle.
  for (const maxTrianglesPerLeaf of [48, 45, 50, 46, 44, 42, 40, 36, 32, 28, 24, 20, 16, 12, 8, 4, 2, 1]) {
    try { shape = EC.buildMeshCollisionShape({positions, normals, indices}, {scale: 1, topTagMode: 'slidey', sideTagMode: 'slidey', faceMaterialTags, faceFlags, maxTrianglesPerLeaf}); break; }
    catch (error) { lastPartitionError = error; }
  }
  if (!shape) throw wadName + ': could not build a safe collision KD tree for the combined level mesh (' + String(lastPartitionError?.message || lastPartitionError || 'unknown partition error') + ')';
  if (shape.triangleCount !== total || shape.records.length > 0xffffff) throw wadName + ': combined collision geometry exceeds the native leaf-record address range';
  const oldTreePtr = original.nodePtr, oldTreeBytes = original.nodeCount * 8;
  const footerStart = oldTreePtr + oldTreeBytes;
  const footer = footerStart + 0x1c <= A0.length ? A0.subarray(footerStart, footerStart + 0x1c) : new Uint8Array(0x1c);
  const nodesOff = bld.alloc(shape.nodeCount * 8 + 0x1c, 8);
  const recordsOff = bld.alloc(shape.records.length * 16, 16);
  const d = bld.d, W = bld.W;
  const markerWords = [0xffff0001, 0x0002ffff, 0xffff0003, 0x0004ffff, 0xffff0005, 0x0006ffff];
  for (let k = 0; k < 3; k++) {
    const lo = Math.floor(shape.bounds[0][k] * 8192) - 2;
    const hi = Math.ceil(shape.bounds[1][k] * 8192) + 2;
    W(nodesOff + k * 16, lo >>> 0); W(nodesOff + k * 16 + 4, markerWords[k * 2]);
    W(nodesOff + (k * 2 + 1) * 8, hi >>> 0); W(nodesOff + (k * 2 + 1) * 8 + 4, markerWords[k * 2 + 1]);
  }
  const nodeMap = new Map(shape.nodes.slice(6).map((node, i) => [node, i + 6]));
  for (let i = 6; i < shape.nodeCount; i++) {
    const node = shape.nodes[i], off = nodesOff + i * 8;
    if (node.type === 'leaf') {
      if (node.firstRecord > 0xffffff || node.recordCount > 255) throw wadName + ': collision KD leaf range cannot be encoded';
      W(off, 3); W(off + 4, ((node.firstRecord << 8) | node.recordCount) >>> 0);
    } else {
      const q = Math.round(node.split * 1024), left = nodeMap.get(node.left), right = nodeMap.get(node.right);
      if (q < -0x10000000 || q > 0x0fffffff || !Number.isInteger(left) || !Number.isInteger(right)) throw wadName + ': collision KD split/child encoding is invalid';
      W(off, ((q << 3) | node.axis) >>> 0); W(off + 4, ((left << 16) | right) >>> 0);
    }
  }
  for (let r = 0; r < shape.records.length; r++) {
    const rec = shape.records[r], off = recordsOff + r * 16;
    for (let k = 0; k < 3; k++) d.setFloat32(off + k * 4, rec.position[k], true);
    W(off + 12, rec.flags >>> 0);
  }
  // Retain the level-specific 0x1c-byte footer that immediately follows the
  // retail node array. It is not part of the decoded node list and has no fixups.
  bld.A.set(footer, nodesOff + shape.nodeCount * 8);
  // The LCM owns one global CollMesh header at A+0. Its two pointer slots are
  // already relocated in retail; replace the targets and rebuild the combined tree.
  W(0, nodesOff); W(4, shape.nodeCount);
  for (let k = 0; k < 3; k++) d.setFloat32(0x0c + k * 4, shape.centre[k], true);
  d.setFloat32(0x18, shape.radiusSq, true); d.setFloat32(0x1c, shape.radius, true);
  W(0x20, recordsOff); W(0x24, shape.records.length); W(0x28, shape.nodeCount);
  return {added: addCount, preserved: oldCount, total, kdNodes: shape.nodeCount, kdLeaves: shape.leafCount,
    records: shape.records.length, materialCounts: shape.materialCounts};
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
  if (!descriptors.length) return {relocations: new Map(), cells: [], assignments: []};
  const sourceImp = fixups(B0);
  const roots = sourceImp[0x8000010c] || [];
  if (roots.length !== 1) throw wadName + ': expected exactly one native 0x8000010C spatial-cell table, found ' + roots.length;
  const dv0 = new DataView(A0.buffer, A0.byteOffset, A0.byteLength);
  const u32 = o => dv0.getUint32(o, true);
  const f32 = o => dv0.getFloat32(o, true);
  const u16 = o => dv0.getUint16(o, true);
  const root = roots[0];
  if (root + 0x10 > A0.length) throw wadName + ': truncated 0x10C spatial table root header';
  const rootMode = u32(root), cellCount = u32(root + 4), cellArray = u32(root + 8), rootReserved = u32(root + 0x0c);
  if ((rootMode !== 0 && rootMode !== 1) || rootReserved !== 0) {
    throw wadName + ': unsupported 0x10C spatial table header (mode=0x' + rootMode.toString(16) + ', count=0x' + cellCount.toString(16) + ', cellArray=0x' + cellArray.toString(16) + ', reserved=0x' + rootReserved.toString(16) + ')';
  }
  if (!Number.isInteger(cellCount) || cellCount < 1 || cellCount > 256 || cellArray + cellCount * 0x80 > A0.length || !sourceImp.rel.has(root + 8)) {
    throw wadName + ': invalid 0x10C spatial-cell array/count or missing root relocation';
  }
  const importLocations = new Set(sourceImp[0x8000000a] || []);
  const oldDescriptorOwner = new Map();
  const cells = [];
  for (let i = 0; i < cellCount; i++) {
    const offset = cellArray + i * 0x80;
    const neighbourCount = dv0.getUint8(offset + 0x60);
    const descriptorCount = u16(offset + 0x62);
    const neighbourArray = u32(offset + 0x64);
    const descriptorArray = u32(offset + 0x6c);
    if (neighbourCount > 64 || (neighbourCount && (neighbourArray + neighbourCount * 4 > A0.length || !sourceImp.rel.has(offset + 0x64)))) {
      throw wadName + ': spatial cell ' + i + ' has an invalid neighbour array';
    }
    if (descriptorCount > 4096 || (descriptorCount && (descriptorArray + descriptorCount * 0x20 > A0.length))) {
      throw wadName + ': spatial cell ' + i + ' has an invalid visibility descriptor array';
    }
    if (!sourceImp.rel.has(offset + 0x6c)) throw wadName + ': spatial cell ' + i + ' has no relocation for its descriptor-array pointer';
    const oldDescriptors = [];
    for (let j = 0; j < descriptorCount; j++) {
      const descriptor = descriptorArray + j * 0x20;
      if (!importLocations.has(descriptor)) throw wadName + ': spatial cell ' + i + ' descriptor 0x' + descriptor.toString(16) + ' has no matching kind-0x0A import';
      if (oldDescriptorOwner.has(descriptor)) throw wadName + ': visibility descriptor 0x' + descriptor.toString(16) + ' is shared by multiple spatial cells';
      oldDescriptorOwner.set(descriptor, i);
      oldDescriptors.push(descriptor);
    }
    cells.push({index: i, offset, neighbourCount, neighbourArray, descriptorCount, descriptorArray, oldDescriptors, additions: []});
  }
  // Every native descriptor must be owned by exactly one spatial-cell list.
  if (oldDescriptorOwner.size !== importLocations.size) {
    const missing = [...importLocations].filter(o => !oldDescriptorOwner.has(o));
    const extras = [...oldDescriptorOwner.keys()].filter(o => !importLocations.has(o));
    throw wadName + ': retail visibility registration invariant failed before import (imports=' + importLocations.size + ', cell references=' + oldDescriptorOwner.size + ', unreferenced=' + missing.length + ', unimported=' + extras.length + ')';
  }

  const overlapCells = (centre, radius, cell) => {
    for (let plane = 0; plane < 4; plane++) {
      const p = cell.offset + plane * 0x10;
      const nx = f32(p), ny = f32(p + 4), nz = f32(p + 8), d = f32(p + 12);
      if (![nx, ny, nz, d].every(Number.isFinite)) throw wadName + ': cell ' + cell.index + ' has a non-finite spatial plane';
      const signed = nx * centre[0] + ny * centre[1] + nz * centre[2] + d;
      const reach = radius * Math.hypot(nx, ny, nz);
      if (signed + reach < -1e-4) return false;
    }
    return true;
  };

  const assignments = [];
  for (const entry of descriptors) {
    const hits = cells.filter(cell => overlapCells(entry.centre, entry.radius, cell));
    if (!hits.length) {
      throw wadName + ': imported part ' + entry.name + ' (centre ' + entry.centre.map(v => v.toFixed(2)).join(', ') + ', radius ' + entry.radius.toFixed(2) + ') does not overlap any target spatial cell; refusing to create an invisible orphan descriptor';
    }
    for (const cell of hits) cell.additions.push(entry);
    assignments.push({name: entry.name, cells: hits.map(c => c.index)});
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
    // than one cell, clone its descriptor while sharing the same metadata block.
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
      // The original custom descriptor was already allocated by the mesh
      // writer. It is now treated as a template and need not itself be imported.
    }
    bld.d.setUint16(cell.offset + 0x62, total, true);
    bld.W(cell.offset + 0x6c, newArray);
    bld.addRel(cell.offset + 0x6c);
    changedCells.push({cell: cell.index, oldCount: cell.descriptorCount, added: cell.additions.length, newCount: total, oldArray: cell.descriptorArray, newArray});
  }
  return {relocations: relocatedImports, cells: changedCells, assignments, originalImports: importLocations.size,
    addedDescriptors: assignments.reduce((n, a) => n + a.cells.length, 0)};
}

function appendInilevelRender(A0, B0, wadName, data, EC, options = {}) {
  if (!A0 || !B0 || !data || !EC || typeof EC.Builder !== 'function') throw new TypeError('appendInilevelRender needs a retail LCM, parsed .inilevel data and editor core');
  if (!Array.isArray(data.meshes) || !data.meshes.length) throw wadName + ': .inilevel has no render parts';
  if (!Array.isArray(data.materials) || !data.materials.length) throw wadName + ': .inilevel has no materials';
  const before = parseLcm(A0, B0);
  if (!before || !before.bufs.length) throw wadName + ': target is not a supported retail LCM render resource';
  const drawQueuesBefore = findLevelDrawQueues(A0, B0, wadName);
  const template = findRenderTemplate(A0, B0, wadName, drawQueuesBefore.opaqueParts, {untextured: !!options.untextured});
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
    const pointerValues = [[0x0c, combinedResourceOffset], ...(template.hasTexture ? [[0x10, texture]] : []), [template.metaSlot, meta],
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
      totalVertexCount: sourceVbData.vertexCount + appendedVertices, totalIndexCount: sourceVbData.indexCount + appendedIndices});
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
  let spatialDescriptorTotal = 0;
  for (let i = 0; i < spatialCount; i++) {
    const cell = spatialArray + i * 0x80, count = finalDv.getUint16(cell + 0x62, true), ptr = spatialU32(cell + 0x6c);
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
  if (data.collision?.triangleCount && (!finalCollisionMesh?.valid || !finalCollisionMesh.kdTree?.valid || finalCollisionMesh.triangleCount !== collisionReport.total)) {
    throw wadName + ': native collision read-back failed (valid=' + !!finalCollisionMesh?.valid + ', kd=' + !!finalCollisionMesh?.kdTree?.valid + ', triangles=' + (finalCollisionMesh?.triangleCount ?? 'n/a') + '/' + collisionReport.total + ', error=' + (finalCollisionMesh?.error || finalCollisionMesh?.kdTree?.warnings?.slice(0, 4).join('; ') || 'unknown') + ')';
  }
  if (data.collision?.triangleCount) assertOriginalCollisionPreserved(EC.parseCollisionMesh(A0, B0, 0), finalCollisionMesh, wadName);
  if (finalDrawQueues.totalParts !== before.parts + reports.length || finalDrawQueues.opaqueParts.size !== drawQueuesBefore.opaqueParts.size + reports.length || finalDrawQueues.translucentParts.size !== drawQueuesBefore.translucentParts.size) {
    throw wadName + ': native render queue read-back failed (opaque ' + drawQueuesBefore.opaqueParts.size + '→' + finalDrawQueues.opaqueParts.size + ', translucent ' + drawQueuesBefore.translucentParts.size + '→' + finalDrawQueues.translucentParts.size + ')';
  }
  if (!data.collision?.triangleCount && (sourceCollision?.n || 0) !== (finalCollision?.n || 0)) throw wadName + ': existing native collision record count unexpectedly changed without an imported collision stream';
  const collisionStructureWarning = data.collision?.triangleCount && collisionBefore?.valid ?
    'Original collision triangles, tags and auxiliary flags are retained, but the global collision KD tree is regenerated (' +
    collisionBefore.nodeCount + '→' + finalCollisionMesh.nodeCount + ' nodes; ' + collisionBefore.kdTree.leafCount + '→' + finalCollisionMesh.kdTree.leafCount +
    ' leaves). Native parser validity does not prove identical in-game seam behaviour.' : null;
  return {A: healed.A, B: healed.B, placementWarning, collisionStructureWarning,
    visibilityRegistration: {spatialCells: spatialCount, changedCells: visibilityRegistration.cells, assignments: visibilityRegistration.assignments,
      originalDescriptors: visibilityRegistration.originalImports, addedDescriptors: visibilityRegistration.addedDescriptors,
      finalDescriptors: finalVisibilityImports.size, orphanDescriptors: 0},
    added: {parts: reports.length, vertexBuffers: 0, sharedVertexBuffer: true, textures: [...textureOffsets.values()].filter(Boolean).length,
    triangles: expectedTriangles, sourceTriangles: reports.reduce((n, r) => n + r.sourceTriangles, 0),
    doubleSidedParts: reports.filter(r => r.doubleSided).length, oneSidedOverride: !!options.forceSingleSided, untexturedDiagnostic: !!options.untextured,
    collisionTriangles: collisionReport.added, collisionPreserved: collisionReport.preserved, collisionTotal: collisionReport.total, drawQueue: 'opaque'},
    resourceDirectory: healed.added, reports, readback: {parts: finalLcm.parts, triangles: finalLcm.tris, missed: finalLcm.missed,
      textures: finalLcm.textureOffsets.length, vertexBufferResources: (fixups(healed.B)[0x80000023] || []).length, sharedVertexBuffer: combinedResourceOffset, vertexCount: sourceVbData.vertexCount + appendedVertices, indexCount: sourceVbData.indexCount + appendedIndices, collisionRecords: finalCollision?.n || 0, collisionTriangles: finalCollisionMesh?.triangleCount ?? (sourceCollision?.mat?.length || 0), collisionKdNodes: finalCollisionMesh?.nodeCount ?? null, collisionKdLeaves: finalCollisionMesh?.kdTree?.leafCount ?? null}};
}

export {appendInilevelRender, triangleStrip, findLevelDrawQueues};
