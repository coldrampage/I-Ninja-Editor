// Adapter from Blender .inilevel world geometry to the editor's proven
// native .LCS STRAT-model path. The mesh is converted to one local-space
// .inimodel bundle and instantiated through Strat_SetModel / Strat_SetModelCollide.
import {bytesToBase64, crc32} from './custom-models.js?v=step146-strat-appearance-preview';

const te = new TextEncoder();

function concat(parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

function storedZip(entries) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, raw] of entries) {
    const filename = te.encode(name), bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
    const crc = crc32(bytes);
    const lh = new Uint8Array(30 + filename.length), ld = new DataView(lh.buffer);
    ld.setUint32(0, 0x04034b50, true); ld.setUint16(4, 20, true);
    ld.setUint16(6, 0, true); ld.setUint16(8, 0, true);
    ld.setUint32(14, crc, true); ld.setUint32(18, bytes.length, true); ld.setUint32(22, bytes.length, true);
    ld.setUint16(26, filename.length, true); ld.setUint16(28, 0, true); lh.set(filename, 30);
    locals.push(lh, bytes);

    const ch = new Uint8Array(46 + filename.length), cd = new DataView(ch.buffer);
    cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true);
    cd.setUint16(8, 0, true); cd.setUint16(10, 0, true);
    cd.setUint32(16, crc, true); cd.setUint32(20, bytes.length, true); cd.setUint32(24, bytes.length, true);
    cd.setUint16(28, filename.length, true); cd.setUint16(30, 0, true); cd.setUint16(32, 0, true);
    cd.setUint16(34, 0, true); cd.setUint16(36, 0, true); cd.setUint32(38, 0, true); cd.setUint32(42, offset, true);
    ch.set(filename, 46); centrals.push(ch);
    offset += lh.length + bytes.length;
  }
  const central = concat(centrals), eocd = new Uint8Array(22), ed = new DataView(eocd.buffer);
  ed.setUint32(0, 0x06054b50, true); ed.setUint16(8, entries.length, true); ed.setUint16(10, entries.length, true);
  ed.setUint32(12, central.length, true); ed.setUint32(16, offset, true); ed.setUint16(20, 0, true);
  return concat([...locals, central, eocd]);
}

function normalise(v) {
  const n = Math.hypot(v[0], v[1], v[2]);
  if (!(n > 1e-12) || !Number.isFinite(n)) throw new Error('cannot generate a normal for a degenerate triangle');
  return [v[0] / n, v[1] / n, v[2] / n];
}
function cross(a, b, c) {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
}

function meshNormals(positions, indices) {
  const sums = new Float64Array(positions.length);
  for (let i = 0; i < indices.length; i += 3) {
    const ids = [indices[i], indices[i + 1], indices[i + 2]];
    const p = ids.map(k => [positions[k * 3], positions[k * 3 + 1], positions[k * 3 + 2]]);
    const n = cross(p[0], p[1], p[2]);
    if (Math.hypot(...n) < 1e-10) throw new Error('render mesh contains a degenerate triangle at index ' + (i / 3));
    for (const id of ids) for (let k = 0; k < 3; k++) sums[id * 3 + k] += n[k];
  }
  const out = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    const n = normalise([sums[i], sums[i + 1], sums[i + 2]]);
    out.set(n, i);
  }
  return out;
}

function getUnionAnchor(meshes, collision) {
  const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  const add = (a) => {
    for (let i = 0; i < a.length; i += 3) for (let k = 0; k < 3; k++) {
      const v = Number(a[i + k]);
      if (!Number.isFinite(v)) throw new Error('level bundle contains a non-finite coordinate');
      b[k] = Math.min(b[k], v); b[k + 3] = Math.max(b[k + 3], v);
    }
  };
  for (const m of meshes) add(m.positions);
  if (collision?.positions?.length) add(collision.positions);
  if (!b.every(Number.isFinite)) throw new Error('level bundle has no usable geometry bounds');
  return [0, 1, 2].map(k => (b[k] + b[k + 3]) * 0.5);
}

function buildCollisionMesh(collision, anchor) {
  if (!collision) return null;
  const triCount = collision.triangleCount, positions = new Float32Array(triCount * 9), normals = new Float32Array(triCount * 9);
  const indices = new Uint16Array(triCount * 3), faceMaterialTags = new Uint16Array(collision.tags), faceFlags = new Uint16Array(triCount);
  if (triCount * 3 > 65535) throw new Error('the native STRAT CollMesh adapter currently supports at most 21,845 collision triangles');
  for (let t = 0; t < triCount; t++) {
    const p = [0, 1, 2].map(c => [0, 1, 2].map(k => collision.positions[t * 9 + c * 3 + k]));
    const n = normalise(cross(p[0], p[1], p[2]));
    for (let c = 0; c < 3; c++) {
      const at = t * 9 + c * 3;
      positions[at] = p[c][0] - anchor[0];
      positions[at + 1] = p[c][1] - anchor[1];
      // The STRAT model writer reflects local Z when writing its native VB and
      // the CollMesh writer reflects it again; pre-reflect here to retain the
      // source .inilevel game-space position and winding.
      positions[at + 2] = -(p[c][2] - anchor[2]);
      normals[at] = n[0]; normals[at + 1] = n[1]; normals[at + 2] = -n[2];
      indices[t * 3 + c] = t * 3 + c;
    }
    const raw = collision.flags?.[t * 3] ?? 0x90;
    faceFlags[t] = (raw & 0xffff) & ~(0x80 | 0x40 | 0x100);
  }
  return {positions, normals, indices, faceMaterialTags, faceFlags};
}

/**
 * Convert a parsed .inilevel to the proven native STRAT object writer format.
 * One material is required; multiple meshes with that material are combined.
 * Placement is decided by the caller: either preserve anchor (world-space),
 * or put the model origin at a target LCS NinjaStartPoint.
 */
function makeInilevelStratAsset(data, record = {}) {
  if (!data || !Array.isArray(data.meshes) || !data.meshes.length || !Array.isArray(data.materials) || !data.materials.length) {
    throw new Error('invalid parsed .inilevel data');
  }
  if (data.materials.length !== 1 || data.meshes.some(m => m.material !== 0)) {
    throw new Error('the native STRAT level-object route currently supports one material; combine the level model to one material before export');
  }
  const material = data.materials[0];
  if (material.alphaMode !== 'OPAQUE') throw new Error('the native STRAT level-object route currently supports OPAQUE materials only');
  if (material.texture) {
    const tga = data.textures.get(material.texture);
    if (!tga || tga[2] !== 2 || tga[16] !== 32) throw new Error('the native STRAT level-object route requires a 32-bit true-colour TGA texture');
  }

  const vertexCount = data.meshes.reduce((n, m) => n + m.vertexCount, 0);
  if (vertexCount < 3 || vertexCount > 65535) throw new Error('combined level render mesh must contain 3–65,535 vertices');
  const positionsWorld = new Float32Array(vertexCount * 3), uvs = new Float32Array(vertexCount * 2), colors = new Uint8Array(vertexCount * 4);
  const rawIndices = [];
  let vertexBase = 0;
  for (const mesh of data.meshes) {
    for (let i = 0; i < mesh.vertexCount; i++) {
      const at = (vertexBase + i) * 3, src = i * 3;
      positionsWorld[at] = mesh.positions[src]; positionsWorld[at + 1] = mesh.positions[src + 1]; positionsWorld[at + 2] = mesh.positions[src + 2];
      const uv = (vertexBase + i) * 2; uvs[uv] = mesh.uvs[i * 2]; uvs[uv + 1] = mesh.uvs[i * 2 + 1];
      const col = (vertexBase + i) * 4; colors.set(mesh.colors.subarray(i * 4, i * 4 + 4), col);
    }
    for (const index of mesh.indices) rawIndices.push(vertexBase + index);
    vertexBase += mesh.vertexCount;
  }
  // The current native STRAT model graph has no vertex-colour channel.
  for (let i = 0; i < colors.length; i++) if (colors[i] !== 255) {
    throw new Error('the native STRAT level-object route does not yet bake non-white vertex colours; use white vertex colours or bake them into the texture');
  }
  const anchor = getUnionAnchor([{positions: positionsWorld}], data.collision);
  const normalsWorld = meshNormals(positionsWorld, rawIndices);
  const localPositions = new Float32Array(positionsWorld.length), modelNormals = new Float32Array(normalsWorld.length);
  for (let i = 0; i < vertexCount; i++) {
    localPositions[i * 3] = positionsWorld[i * 3] - anchor[0];
    localPositions[i * 3 + 1] = positionsWorld[i * 3 + 1] - anchor[1];
    localPositions[i * 3 + 2] = -(positionsWorld[i * 3 + 2] - anchor[2]);
    modelNormals[i * 3] = normalsWorld[i * 3]; modelNormals[i * 3 + 1] = normalsWorld[i * 3 + 1]; modelNormals[i * 3 + 2] = -normalsWorld[i * 3 + 2];
  }
  if (material.doubleSided) {
    const original = rawIndices.slice();
    for (let i = 0; i < original.length; i += 3) {
      rawIndices.push(original[i], original[i + 2], original[i + 1]);
    }
  }
  if (rawIndices.length < 3 || rawIndices.length > 0xffffffff) throw new Error('invalid combined level index count');

  const geometry = new Uint8Array(vertexCount * 32 + rawIndices.length * 2), gd = new DataView(geometry.buffer);
  for (let v = 0; v < vertexCount; v++) {
    const p = v * 32;
    for (let k = 0; k < 3; k++) { gd.setFloat32(p + k * 4, localPositions[v * 3 + k], true); gd.setFloat32(p + 12 + k * 4, modelNormals[v * 3 + k], true); }
    gd.setFloat32(p + 24, uvs[v * 2], true); gd.setFloat32(p + 28, uvs[v * 2 + 1], true);
  }
  const indexOffset = vertexCount * 32;
  for (let i = 0; i < rawIndices.length; i++) gd.setUint16(indexOffset + i * 2, rawIndices[i], true);

  const name = String(record.name || data.manifest.name || 'Imported level model').slice(0, 96);
  const manifest = {
    format: 'ininja-model', version: 1, name,
    coordinateSystem: 'i-ninja-y-up', geometryFile: 'geometry.bin',
    materials: [{name: material.name, baseColor: material.baseColor, alphaMode: material.alphaMode,
      alphaCutoff: material.alphaCutoff, blendMode: material.blendMode, doubleSided: false,
      texture: material.texture || null}],
    meshes: [{name: data.meshes.map(m => m.name).join(' + ').slice(0, 96), material: 0,
      vertexOffset: 0, vertexCount, indexOffset, indexCount: rawIndices.length}],
    collision: {type: data.collision ? 'mesh' : 'none', topTagMode: 'slidey', sideTagMode: 'slidey'}
  };
  const entries = [['manifest.json', te.encode(JSON.stringify(manifest))], ['geometry.bin', geometry]];
  if (material.texture) entries.push([material.texture, data.textures.get(material.texture)]);
  const bundle = storedZip(entries);
  const nativeCollisionMesh = buildCollisionMesh(data.collision, anchor);
  const assetId = 'inilevel_' + String(record.id || name).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 48);
  return {
    asset: {id: assetId, name, bundle: bytesToBase64(bundle), collisionType: nativeCollisionMesh ? 'mesh' : 'none', nativeCollisionMesh},
    anchor,
    renderBounds: getBounds(positionsWorld),
    collisionTriangles: data.collision?.triangleCount || 0,
    meshCount: data.meshes.length,
    vertexCount,
    indexCount: rawIndices.length,
    twoSided: material.doubleSided
  };
}

function getBounds(positions) {
  const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) for (let k = 0; k < 3; k++) {
    const v = positions[i + k]; b[k] = Math.min(b[k], v); b[k + 3] = Math.max(b[k + 3], v);
  }
  return b;
}

export {makeInilevelStratAsset};
