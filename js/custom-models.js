// Import and validate the editor's Blender-exported .inimodel bundle.
// Format v1 deliberately uses ZIP_STORED entries: this keeps the browser importer
// dependency-free and makes geometry/TGA assets inspectable and deterministic.
const MAX_BUNDLE_BYTES = 96 * 1024 * 1024;
const MAX_ENTRY_BYTES = 64 * 1024 * 1024;
const MAX_ENTRIES = 1024;
const MAX_MESHES = 128;
const MAX_MATERIALS = 128;
const te = new TextDecoder('utf-8', {fatal: true});

function asBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  throw new TypeError('model bundle must be an ArrayBuffer or Uint8Array');
}

function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}

function safeName(name) {
  return typeof name === 'string' && name.length > 0 && name.length <= 240 &&
    !name.startsWith('/') && !name.includes('\\') &&
    name.split('/').every(x => x && x !== '.' && x !== '..');
}

function unzipStored(input) {
  const bytes = asBytes(input);
  if (bytes.length < 22 || bytes.length > MAX_BUNDLE_BYTES) throw new Error('invalid .inimodel size');
  const d = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries = new Map();
  let p = 0, count = 0, total = 0;
  while (p + 4 <= bytes.length) {
    const sig = d.getUint32(p, true);
    if (sig === 0x02014b50 || sig === 0x06054b50) break; // central directory / end record
    if (sig !== 0x04034b50) throw new Error('invalid ZIP local-file header at 0x' + p.toString(16));
    if (p + 30 > bytes.length) throw new Error('truncated ZIP local-file header');
    const flags = d.getUint16(p + 6, true), method = d.getUint16(p + 8, true);
    const expectedCrc = d.getUint32(p + 14, true), csize = d.getUint32(p + 18, true), usize = d.getUint32(p + 22, true);
    const nl = d.getUint16(p + 26, true), el = d.getUint16(p + 28, true);
    if (flags & 1) throw new Error('encrypted .inimodel bundles are not supported');
    if (flags & 8) throw new Error('ZIP data descriptors are not supported; re-export from Blender using the .inimodel exporter');
    if (method !== 0) throw new Error('compressed .inimodel entries are not supported; use the Blender exporter');
    if (csize !== usize || usize > MAX_ENTRY_BYTES) throw new Error('invalid or oversized .inimodel entry');
    const nameAt = p + 30, dataAt = nameAt + nl + el, end = dataAt + csize;
    if (nl < 1 || dataAt > bytes.length || end > bytes.length) throw new Error('truncated .inimodel entry');
    let name;
    try { name = te.decode(bytes.subarray(nameAt, nameAt + nl)); } catch { throw new Error('invalid ZIP entry filename'); }
    if (!safeName(name)) throw new Error('unsafe ZIP entry path: ' + name);
    if (entries.has(name)) throw new Error('duplicate ZIP entry: ' + name);
    const data = bytes.slice(dataAt, end);
    if (crc32(data) !== expectedCrc) throw new Error('CRC mismatch in .inimodel entry: ' + name);
    entries.set(name, data);
    total += data.length;
    if (total > MAX_BUNDLE_BYTES) throw new Error('.inimodel expands beyond the size limit');
    if (++count > MAX_ENTRIES) throw new Error('too many files in .inimodel bundle');
    p = end;
  }
  if (!entries.has('manifest.json')) throw new Error('.inimodel is missing manifest.json');
  return entries;
}

function pow2(n) { return n >= 4 && n <= 512 && (n & (n - 1)) === 0; }

function validateTga(bytes, name) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 18) throw new Error('texture ' + name + ' is not a TGA');
  const w = bytes[12] | bytes[13] << 8, h = bytes[14] | bytes[15] << 8, type = bytes[2];
  if (!pow2(w) || !pow2(h)) throw new Error('texture ' + name + ' must be 4–512 pixels and power-of-two');
  if (!((type === 2 && bytes[16] === 32) || (type === 1 && bytes[1] === 1 && bytes[16] === 8))) {
    throw new Error('texture ' + name + ' must be 32-bit truecolour or 8-bit paletted TGA');
  }
  const paletteBytes = type === 1 ? (bytes[5] | bytes[6] << 8) * (bytes[7] >> 3) : 0;
  const required = 18 + bytes[0] + paletteBytes + (type === 1 ? w * h : w * h * 4);
  if (required > bytes.length) throw new Error('texture ' + name + ' is truncated');
  return {width: w, height: h, byteLength: required};
}

function parseIninjaModelBundle(input) {
  const entries = unzipStored(input);
  let manifest;
  try { manifest = JSON.parse(te.decode(entries.get('manifest.json'))); }
  catch (e) { throw new Error('invalid .inimodel manifest: ' + e.message); }
  if (!manifest || manifest.format !== 'ininja-model' || manifest.version !== 1) {
    throw new Error('unsupported .inimodel format (expected ininja-model v1)');
  }
  if (manifest.coordinateSystem !== 'i-ninja-y-up') {
    throw new Error('unsupported model coordinate system; re-export with the Blender .inimodel add-on');
  }
  if (!Array.isArray(manifest.materials) || !manifest.materials.length || manifest.materials.length > MAX_MATERIALS) {
    throw new Error('manifest must contain 1–' + MAX_MATERIALS + ' materials');
  }
  if (!Array.isArray(manifest.meshes) || !manifest.meshes.length || manifest.meshes.length > MAX_MESHES) {
    throw new Error('manifest must contain 1–' + MAX_MESHES + ' mesh parts');
  }
  const geometryName = manifest.geometryFile || 'geometry.bin';
  if (!safeName(geometryName) || !entries.has(geometryName)) throw new Error('missing geometry buffer');
  const geometry = entries.get(geometryName), gd = new DataView(geometry.buffer, geometry.byteOffset, geometry.byteLength);
  const materials = manifest.materials.map((m, i) => {
    if (!m || typeof m.name !== 'string') throw new Error('material ' + i + ' has no name');
    const color = Array.isArray(m.baseColor) && m.baseColor.length === 4 ? m.baseColor.map(Number) : [1, 1, 1, 1];
    if (color.some(v => !Number.isFinite(v) || v < 0 || v > 1)) throw new Error('material ' + i + ' has an invalid baseColor');
    const alphaMode = ['OPAQUE', 'MASK', 'BLEND'].includes(m.alphaMode) ? m.alphaMode : 'OPAQUE';
    const blendMode = ['normal', 'additive', 'subtractive'].includes(m.blendMode) ? m.blendMode : 'normal';
    const cutoff = Number.isFinite(+m.alphaCutoff) ? Math.max(0, Math.min(1, +m.alphaCutoff)) : 0.5;
    const texture = m.texture == null ? null : String(m.texture);
    if (texture !== null) {
      if (!safeName(texture) || !entries.has(texture)) throw new Error('material ' + i + ' references a missing/unsafe texture');
      validateTga(entries.get(texture), texture);
    }
    return {name: m.name, baseColor: color, alphaMode, alphaCutoff: cutoff, blendMode, doubleSided: !!m.doubleSided, texture};
  });
  const meshes = manifest.meshes.map((m, i) => {
    if (!m || typeof m.name !== 'string') throw new Error('mesh ' + i + ' has no name');
    const vo = Number(m.vertexOffset), vc = Number(m.vertexCount), io = Number(m.indexOffset), ic = Number(m.indexCount), mi = Number(m.material);
    if (![vo, vc, io, ic, mi].every(Number.isSafeInteger) || vo < 0 || io < 0 || vc < 3 || vc > 65535 || ic < 3 || ic % 3 || mi < 0 || mi >= materials.length) {
      throw new Error('mesh ' + i + ' has invalid buffer ranges or material index');
    }
    if ((vo & 3) || (io & 1) || vo + vc * 32 > geometry.length || io + ic * 2 > geometry.length) {
      throw new Error('mesh ' + i + ' buffer range is outside geometry.bin');
    }
    const positions = new Float32Array(vc * 3), normals = new Float32Array(vc * 3), uvs = new Float32Array(vc * 2);
    for (let v = 0; v < vc; v++) {
      const p = vo + v * 32;
      for (let k = 0; k < 8; k++) {
        const x = gd.getFloat32(p + 4 * k, true);
        if (!Number.isFinite(x)) throw new Error('mesh ' + i + ' contains a non-finite vertex value');
        if (k < 3) positions[v * 3 + k] = x;
        else if (k < 6) normals[v * 3 + k - 3] = x;
        else uvs[v * 2 + k - 6] = x;
      }
    }
    const indices = new Uint16Array(ic);
    for (let k = 0; k < ic; k++) {
      const v = gd.getUint16(io + k * 2, true);
      if (v >= vc) throw new Error('mesh ' + i + ' has an out-of-range triangle index');
      indices[k] = v;
    }
    return {name: m.name, material: mi, positions, normals, uvs, indices, vertexCount: vc, indexCount: ic};
  });
  const c = manifest.collision || {};
  const collisionType = ['none', 'box', 'sphere', 'cylinder', 'capsule', 'mesh'].includes(c.type) ? c.type : 'none';
  const collisionSize = Array.isArray(c.size) && c.size.length === 3 ? c.size.map(Number) : [1, 1, 1];
  const topTagMode = ['standable', 'slidey'].includes(c.topTagMode) ? c.topTagMode : 'slidey';
  const sideTagMode = ['walkable', 'slidey'].includes(c.sideTagMode) ? c.sideTagMode : 'slidey';
  if (collisionSize.some(v => !Number.isFinite(v) || v < 0 || v > 100000)) throw new Error('collision size is invalid');
  const textures = new Map();
  for (const m of materials) if (m.texture && !textures.has(m.texture)) textures.set(m.texture, entries.get(m.texture));
  return {
    manifest: {...manifest, name: String(manifest.name || 'Imported model'), collision: {...c, type: collisionType, size: collisionSize, topTagMode, sideTagMode}},
    meshes, materials, textures
  };
}

// Convert bundle UVs for the editor's Three.js DataTexture preview. parseTga()
// normalises TGA rows to top-origin pixels, while DataTexture's raw upload is
// bottom-origin; flipping V keeps the editor preview aligned with native PC
// output (the native writer uses the same V=1-v conversion).
// Stage 1 parser: validate and extract only the embedded TGA textures from an
// .inimodel bundle. It intentionally does not read geometry.bin or inspect mesh
// records, so the texture-only native test has no mesh/descriptor dependency.
function parseIninjaModelTextures(input) {
  const entries = unzipStored(input);
  let manifest;
  try { manifest = JSON.parse(te.decode(entries.get('manifest.json'))); }
  catch (e) { throw new Error('invalid .inimodel manifest: ' + e.message); }
  if (!manifest || manifest.format !== 'ininja-model' || manifest.version !== 1) {
    throw new Error('unsupported .inimodel format (expected ininja-model v1)');
  }
  if (!Array.isArray(manifest.materials) || !manifest.materials.length || manifest.materials.length > MAX_MATERIALS) {
    throw new Error('manifest must contain 1–' + MAX_MATERIALS + ' materials');
  }
  const textures = new Map();
  const materials = manifest.materials.map((m, i) => {
    if (!m || typeof m.name !== 'string') throw new Error('material ' + i + ' has no name');
    const texture = m.texture == null ? null : String(m.texture);
    if (texture !== null) {
      if (!safeName(texture) || !entries.has(texture)) throw new Error('material ' + i + ' references a missing/unsafe texture');
      const bytes = entries.get(texture);
      validateTga(bytes, texture);
      if (bytes[2] !== 2 || bytes[16] !== 32) {
        throw new Error('native texture-only import currently requires 32-bit truecolour TGA: ' + texture);
      }
      textures.set(texture, bytes);
    }
    return {name: m.name, texture};
  });
  return {manifest, materials, textures};
}

function editorPreviewUvs(input) {
  if (!(input instanceof Float32Array || input instanceof Float64Array || Array.isArray(input)) || input.length % 2) {
    throw new TypeError('UV data must be an even-length numeric array');
  }
  const out = new Float32Array(input.length);
  for (let i = 0; i < input.length; i += 2) {
    const u = Number(input[i]), v = Number(input[i + 1]);
    if (!Number.isFinite(u) || !Number.isFinite(v)) throw new TypeError('UV data contains a non-finite value');
    out[i] = u;
    out[i + 1] = 1 - v;
  }
  return out;
}

function bytesToBase64(input) {
  const bytes = asBytes(input);
  let out = '';
  const stride = 0x8000;
  for (let p = 0; p < bytes.length; p += stride) out += String.fromCharCode(...bytes.subarray(p, Math.min(bytes.length, p + stride)));
  return btoa(out);
}
function base64ToBytes(s) {
  if (typeof s !== 'string' || s.length > Math.ceil(MAX_BUNDLE_BYTES * 4 / 3) + 8) throw new Error('invalid stored model bundle');
  const raw = atob(s), out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export {parseIninjaModelBundle, parseIninjaModelTextures, bytesToBase64, base64ToBytes, crc32, editorPreviewUvs};
