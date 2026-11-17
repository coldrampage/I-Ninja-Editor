// Textures panel: browse a level wad's textures, export one as PNG, replace it with your own image, or add a brand-new texture.
// Edits are stored in the project as base64 TGA (your pixels only) under project.textures[wad].ops and applied by "build patched .vol".
import { listTextures, listMaterialResources, encodeTga, isPow2 } from './texture-tools.js?v=step43-native-layer-uv';
import { parseTga, setTexOverride, clearTexOverrides, setTexMode, clearTexModes } from './vol-core.js?v=step43-native-layer-uv';

export function installTexturePanel({ Viewer, getProject, getWad, onChange = () => {} }) {
  const $ = id => document.getElementById(id);
  const panel = document.createElement('div');
  panel.id = 'tx_panel';
  panel.style.cssText = 'position:fixed;left:262px;bottom:10px;width:560px;max-height:80vh;overflow:auto;background:#1b1e24f2;border:1px solid #444;padding:6px;display:none;z-index:21;font-size:12px';
  panel.innerHTML = '<b>Textures</b> <span class=h>replace or add images; inspect animated and layered material wrappers</span> <button id=tx_x style=float:right>x</button><br>'
    + '<select id=tx_w style="width:100%"></select>'
    + '<div style="margin:4px 0"><label title="Resample your image to the size of the texture it replaces. Safest: the model\'s UVs and the file layout stay exactly as in the original."><input type=checkbox id=tx_keep checked> replace at the original size</label> '
    + '<select id=tx_mode title="palette = 8-bit, up to 256 colours, like the game\'s own textures. truecolour = 32-bit, 4x bigger."><option value=palette>256-colour palette<option value=truecolour>32-bit truecolour</select></div>'
    + '<div style="margin:4px 0"><label title="How the editor draws the selected texture. The game decides this itself and it is not stored where the editor can read it, so set it to match what you see in game. Display only: nothing is written to the game files."><b>display as</b> <select id=tx_disp disabled><option value=auto>auto<option value=opaque>opaque<option value=blend>translucent<option value=additive>additive (black = see-through)<option value=cutout>cutout (alpha)<option value=keyblack>cutout (black = transparent)</select></label> '
    + '<label title="List only textures without alpha that are at least 40% near-black: the usual smoke, glow and light-ray candidates"><input type=checkbox id=tx_blk> black-background candidates</label></div>'
    + '<div id=tx_grid style="display:flex;flex-wrap:wrap;gap:4px;max-height:260px;overflow:auto;border:1px solid #333;padding:3px"></div>'
    + '<div id=tx_sel class=h style="margin:4px 0">click a texture</div>'
    + '<div><button id=tx_exp disabled>export PNG</button> <button id=tx_rep disabled>replace with image…</button> <button id=tx_add>add new texture from image…</button> <button id=tx_undo disabled>revert this texture</button></div>'
    + '<input id=tx_file type=file accept="image/png,image/jpeg,image/webp,image/gif,image/bmp" style=display:none>'
    + '<div id=tx_ops class=h style="white-space:pre-wrap;margin-top:4px"></div>'
    + '<div style="margin-top:8px;border-top:1px solid #444;padding-top:6px"><b>Animated &amp; layered resources</b> <span class=h>kind 6 / kind 7; inspection only</span><select id=tx_res style="width:100%;margin-top:4px" disabled><option value="">No resources loaded</option></select><div id=tx_res_info class=h style="max-height:310px;overflow:auto;margin-top:5px">Choose a resource to inspect its frames or layers.</div></div>';
  document.body.appendChild(panel);

  let list = [], cur = null, mode = null, resources = []; // mode: 'replace' | 'add'
  const shown = new Map(); // wad -> Set(texture offsets currently previewed from the project)
  const modeShown = new Map(); // wad -> Set(texture offsets whose display mode was applied)
  const modes = w => { const D = getProject().display; return (D && D[w]) || {}; };
  // editor-only display modes: register them for the parsers, then re-texture the live level; objects are redrawn by onChange
  function syncModes(w) {
    const g = getWad(w), id = w.replace(/\.\w+$/, ''), m = modes(w), prev = modeShown.get(w) || new Set(), now = new Set(Object.keys(m).map(Number));
    clearTexModes(w); for (const off of now) setTexMode(w, off, m[off]);
    if (g && /\.LCM$/i.test(w) && Viewer.retexture) for (const off of new Set([...prev, ...now])) Viewer.retexture(id, off, parseTga(g.A, off));
    modeShown.set(w, now);
  }
  function darkFrac(img) { const a = img.rgba; let d = 0; for (let i = 0; i < a.length; i += 4) if (a[i] < 24 && a[i + 1] < 24 && a[i + 2] < 24) d++; return d / (a.length / 4); }

  const b64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const store = w => { const P = getProject(); P.textures = P.textures || {}; return P.textures[w] = P.textures[w] || { ops: [] }; };
  const ops = w => (getProject().textures && getProject().textures[w] && getProject().textures[w].ops) || [];
  const wad = () => $('tx_w').value;

  function decodeStored(t) { // a stored TGA op -> {w,h,rgba} via the wad parser (it falls back to obj+0x20 for the pixel data)
    const A = new Uint8Array(0x20 + t.length); A.set(t, 0x20); return parseTga(A, 0);
  }

  // Make the editor show the project's replacements without reloading: register them as parse overrides, then swap the live level textures.
  function sync(w) {
    const g = getWad(w), id = w.replace(/\.\w+$/, ''), reps = ops(w).filter(x => x.op === 'replace'), prev = shown.get(w) || new Set(), now = new Set();
    clearTexOverrides(w);
    for (const x of reps) { try { const img = decodeStored(unb64(x.tga)); if (img) { setTexOverride(w, x.tex, img); now.add(x.tex); if (/\.LCM$/i.test(w) && Viewer.retexture) Viewer.retexture(id, x.tex, img); } } catch (e) { console.error('texture preview', e); } }
    for (const off of prev) if (!now.has(off) && g && /\.LCM$/i.test(w) && Viewer.retexture) Viewer.retexture(id, off, parseTga(g.A, off)); // reverted: put the original back
    shown.set(w, now);
  }
  function syncAll() { const T = getProject().textures || {}; for (const w of Object.keys(T)) { try { sync(w); } catch (e) { console.error(e); } } const D = getProject().display || {}; for (const w of Object.keys(D)) { try { syncModes(w); } catch (e) { console.error(e); } } }

  function thumb(img, size) {
    const c = document.createElement('canvas'); c.width = img.w; c.height = img.h;
    c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(img.rgba), img.w, img.h), 0, 0);
    const k = Math.min(1, size / Math.max(img.w, img.h));
    c.style.width = Math.round(img.w * k) + 'px'; c.style.height = Math.round(img.h * k) + 'px';
    c.style.imageRendering = 'pixelated'; return c;
  }

  const hex = n => '0x' + (Number(n) >>> 0).toString(16).padStart(8, '0');
  const ftxt = n => Number.isFinite(n) ? Number(n).toFixed(4).replace(/0+$/, '').replace(/\.$/, '') : 'not a finite float';
  const axisModeName = n => ({0:'linear',1:'sine',2:'cosine'}[n] || ('unknown (' + n + ')'));
  function addInfoLine(host, text, strong = false) {
    const el = document.createElement('div'); el.textContent = text; if (strong) el.style.fontWeight = 'bold'; host.appendChild(el); return el;
  }
  function showResource(r) {
    const host = $('tx_res_info'); host.innerHTML = '';
    const g = wad() && getWad(wad());
    if (!r) { addInfoLine(host, 'Choose a resource to inspect its frames or layers.'); return; }
    addInfoLine(host, (r.type === 'animated' ? 'Animated texture' : 'Layered material') + ' @' + hex(r.offset), true);
    if (!r.valid) { addInfoLine(host, 'Could not decode this wrapper: ' + r.error); return; }
    if (r.type === 'animated') {
      addInfoLine(host, r.frameCount + ' frames · animation data @' + hex(r.animationDataOffset) + ' · frame pointer array @' + hex(r.frameArrayOffset));
      addInfoLine(host, 'Frame selection is manual in this inspector. The level viewport uses 60 Hz preview stepping; the exact native frame-selector formula is still under investigation.');
      const picker = document.createElement('select'); picker.style.width = '100%'; picker.style.margin = '4px 0';
      r.frameOffsets.forEach((off, i) => { const op = document.createElement('option'); op.value = String(i); op.textContent = 'Frame ' + (i + 1) + '/' + r.frameCount + ' · texture @' + hex(off); picker.appendChild(op); });
      const preview = document.createElement('div'); preview.style.cssText = 'display:flex;align-items:flex-start;gap:8px;margin-top:4px';
      const drawFrame = i => {
        preview.innerHTML = ''; const off = r.frameOffsets[i], img = g && parseTga(g.A, off);
        if (img) preview.appendChild(thumb(img, 144));
        const meta = document.createElement('div'); meta.textContent = 'Frame ' + (i + 1) + ' · texture @' + hex(off) + (img ? ' · ' + img.w + '×' + img.h : ' · no decodable TGA'); preview.appendChild(meta);
      };
      picker.onchange = () => drawFrame(Math.max(0, Math.min(r.frameOffsets.length - 1, Number(picker.value) || 0)));
      host.appendChild(picker); host.appendChild(preview); drawFrame(0);
      addInfoLine(host, 'Wrapper words: ' + r.headerWords.map(hex).join(' '));
    } else {
      addInfoLine(host, 'Target ' + r.targetWidth + '×' + r.targetHeight + ' · ' + r.layerCount + ' layers · records @' + hex(r.layerRecordsOffset));
      addInfoLine(host, 'U/V mode bytes are native UV motion selectors (0 linear, 1 sine, 2 cosine), not blend modes. Rotation remains a separate transform.');
      r.layers.forEach(layer => {
        const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:7px;padding:5px 0;border-top:1px solid #343943';
        const img = g && layer.textureValid ? parseTga(g.A, layer.textureOffset) : null;
        if (img) row.appendChild(thumb(img, 54));
        const detail = document.createElement('div'); detail.style.minWidth = '0';
        const color = layer.color.map(ftxt).join(', ');
        detail.textContent = 'Layer ' + (layer.index + 1) + ' @' + hex(layer.offset) + '\n' +
          'Texture ' + hex(layer.textureOffset) + (layer.textureValid ? '' : ' (not a kind-1 texture)') + '\n' +
          'U ' + axisModeName(layer.uMode) + ' · value ' + ftxt(layer.uVelocity) + ' · frequency ' + ftxt(layer.uFrequency) + ' rad/s · phase ' + ftxt(layer.uOffset) + '\n' +
          'V ' + axisModeName(layer.vMode) + ' · value ' + ftxt(layer.vVelocity) + ' · frequency ' + ftxt(layer.vFrequency) + ' rad/s · phase ' + ftxt(layer.vOffset) + '\n' +
          'RGBA [' + color + '] · rotation rate ' + ftxt(layer.rotationVelocity) + ' · rotation phase ' + ftxt(layer.rotationOffset) + '\n' +
          'mode word ' + hex(layer.modeRaw) + ' · raw +0x24 ' + hex(layer.value24Raw) + ' · raw +0x28 ' + hex(layer.value28Raw) + '\n' +
          'Raw 16 words: ' + layer.rawWords.map(hex).join(' ');
        detail.style.whiteSpace = 'pre-wrap'; detail.style.overflowWrap = 'anywhere'; row.appendChild(detail); host.appendChild(row);
      });
      addInfoLine(host, 'Wrapper words: ' + r.headerWords.map(hex).join(' '));
    }
  }
  function fillResources() {
    const w = wad(), g = w && getWad(w), keep = $('tx_res').value;
    resources = g ? listMaterialResources(g.A, g.B) : [];
    const sel = $('tx_res'); sel.innerHTML = '';
    const first = document.createElement('option'); first.value = ''; first.textContent = resources.length ? 'Select an animated or layered resource…' : 'No kind-6 / kind-7 resources in this wad'; sel.appendChild(first);
    for (const r of resources) {
      const op = document.createElement('option'); op.value = String(r.offset);
      op.textContent = (r.type === 'animated' ? 'Animated · ' + r.frameCount + ' frames' : 'Layered · ' + r.layerCount + ' layers') + ' · @' + hex(r.offset) + (r.valid ? '' : ' · invalid'); sel.appendChild(op);
    }
    sel.disabled = !resources.length;
    const chosen = resources.find(r => String(r.offset) === keep) || null;
    sel.value = chosen ? String(chosen.offset) : '';
    showResource(chosen);
  }

  function status() {
    const w = wad(), o = ops(w);
    $('tx_ops').textContent = o.length ? 'pending in project for ' + w + ':\n' + o.map(x => x.op === 'replace' ? ' replace @0x' + x.tex.toString(16) : ' add "' + x.id + '"').join('\n') : 'no texture edits for this wad yet';
    $('tx_undo').disabled = !cur || !o.some(x => x.op === 'replace' && x.tex === cur.off);
  }

  function select(t, el) {
    cur = t;
    for (const c of $('tx_grid').children) c.style.outline = '';
    if (el) el.style.outline = '2px solid #fc6';
    $('tx_sel').textContent = 'texture @0x' + t.off.toString(16) + ' · ' + t.w + 'x' + t.h + ' · ' + t.tgaLen + ' bytes' + (ops(wad()).some(x => x.op === 'replace' && x.tex === t.off) ? ' · REPLACED in project' : '');
    $('tx_exp').disabled = !t.img; $('tx_rep').disabled = false; $('tx_disp').disabled = false; $('tx_disp').value = modes(wad())[t.off] || 'auto'; status();
  }

  function fill() {
    const w = wad(), g = w && getWad(w); $('tx_grid').innerHTML = ''; list = []; cur = null; $('tx_sel').textContent = 'click a texture'; $('tx_exp').disabled = $('tx_rep').disabled = $('tx_disp').disabled = true;
    if (!g) { fillResources(); status(); return; }
    list = listTextures(g.A, g.B);
    fillResources();
    const rep = new Map(ops(w).filter(x => x.op === 'replace').map(x => [x.tex, x]));
    for (const t of list) {
      const img = t.img, r = rep.get(t.off); // t.img already shows the project's replacement (parse override)
      if (!img) continue;
      if ($('tx_blk').checked && !modes(w)[t.off] && (img.alpha || darkFrac(img) < 0.4)) continue;
      const c = thumb(img, 64); c.title = '@0x' + t.off.toString(16) + ' ' + t.w + 'x' + t.h; c.style.cursor = 'pointer'; c.style.border = r ? '1px solid #fc6' : modes(w)[t.off] ? '1px solid #6cf' : '1px solid #333';
      c.onclick = () => select(t, c); $('tx_grid').appendChild(c);
    }
    status();
  }
  async function readImage(file, w, h) {
    const bmp = await createImageBitmap(file);
    let tw = w, th = h;
    if (!tw) { const near = n => { let p = 4; while (p * 2 <= n && p < 512) p *= 2; return (n - p) < (p * 2 - n) ? p : Math.min(512, p * 2); }; tw = isPow2(bmp.width) ? bmp.width : near(bmp.width); th = isPow2(bmp.height) ? bmp.height : near(bmp.height); tw = Math.min(512, Math.max(4, tw)); th = Math.min(512, Math.max(4, th)); }
    const c = document.createElement('canvas'); c.width = tw; c.height = th;
    const x = c.getContext('2d', { willReadFrequently: true }); x.imageSmoothingQuality = 'high'; x.drawImage(bmp, 0, 0, tw, th);
    return { w: tw, h: th, rgba: new Uint8Array(x.getImageData(0, 0, tw, th).data), from: bmp.width + 'x' + bmp.height };
  }

  $('tx_x').onclick = () => { panel.style.display = 'none'; };
  $('tx_w').onchange = fill;
  $('tx_res').onchange = () => showResource(resources.find(r => String(r.offset) === $('tx_res').value) || null);
  $('tx_blk').onchange = fill;
  $('tx_disp').onchange = () => {
    if (!cur) return; const w = wad(), P = getProject(); P.display = P.display || {}; const m = P.display[w] = P.display[w] || {};
    const v = $('tx_disp').value; if (v === 'auto') delete m[cur.off]; else m[cur.off] = v;
    if (!Object.keys(m).length) delete P.display[w];
    const keep = cur; syncModes(w); onChange(); fill(); const el = [...$('tx_grid').children].find(c => c.title && c.title.startsWith('@0x' + keep.off.toString(16) + ' ')); const t = list.find(x => x.off === keep.off); if (t) select(t, el);
  };
  $('tx_exp').onclick = () => {
    if (!cur || !cur.img) return;
    const c = document.createElement('canvas'); c.width = cur.w; c.height = cur.h;
    c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(cur.img.rgba), cur.w, cur.h), 0, 0);
    c.toBlob(b => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = wad().replace(/\.\w+$/, '') + '_tex_' + cur.off.toString(16) + '.png'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 60000); });
  };
  $('tx_rep').onclick = () => { mode = 'replace'; $('tx_file').click(); };
  $('tx_add').onclick = () => { mode = 'add'; $('tx_file').click(); };
  $('tx_undo').onclick = () => {
    const T = store(wad()); T.ops = T.ops.filter(x => !(x.op === 'replace' && x.tex === cur.off)); sync(wad()); onChange(); fill();
  };
  $('tx_file').onchange = async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try {
      const keep = $('tx_keep').checked, w = wad(), o = mode === 'replace' ? cur : null;
      if (mode === 'replace' && !o) throw 'select a texture first';
      const im = await readImage(f, o && keep ? o.w : 0, o && keep ? o.h : 0);
      const tga = encodeTga(im.rgba, im.w, im.h, { mode: $('tx_mode').value });
      const T = store(w);
      if (mode === 'replace') { T.ops = T.ops.filter(x => !(x.op === 'replace' && x.tex === o.off)); T.ops.push({ op: 'replace', tex: o.off, tga: b64(tga) }); }
      else { const id = (f.name || 'texture').replace(/\.\w+$/, '').slice(0, 40); T.ops.push({ op: 'add', id, tga: b64(tga), assign: [] }); }
      sync(w); onChange(); fill();
      $('tx_sel').textContent = (mode === 'replace' ? 'replaced' : 'added') + ' from ' + f.name + ' (' + im.from + ' → ' + im.w + 'x' + im.h + ', ' + tga.length + ' bytes). Build the patched .vol to apply it.';
    } catch (x) { $('tx_sel').textContent = 'texture edit failed: ' + x; }
  };

  Viewer.$('ed_tx').onclick = () => {
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    if (panel.style.display === 'none') return;
    const names = Viewer.files.map(f => f.name).filter(n => /\.(LCM|LCS)$/i.test(n) && !/FAIL/i.test(n)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const keep = wad(); $('tx_w').innerHTML = names.map(n => '<option>' + n + '</option>').join('');
    if (names.includes(keep)) $('tx_w').value = keep; fill();
  };
  return { fill, sync, syncAll };
}
