// Textures panel: browse a level wad's textures, export one as PNG, replace it with your own image, or add a brand-new texture.
// Edits are stored in the project as base64 TGA (your pixels only) under project.textures[wad].ops and applied by "build patched .vol".
import { listTextures, encodeTga, isPow2 } from './texture-tools.js';
import { parseTga, setTexOverride, clearTexOverrides } from './vol-core.js';

export function installTexturePanel({ Viewer, getProject, getWad, onChange = () => {} }) {
  const $ = id => document.getElementById(id);
  const panel = document.createElement('div');
  panel.id = 'tx_panel';
  panel.style.cssText = 'position:fixed;left:262px;bottom:10px;width:560px;max-height:80vh;overflow:auto;background:#1b1e24f2;border:1px solid #444;padding:6px;display:none;z-index:21;font-size:12px';
  panel.innerHTML = '<b>Textures</b> <span class=h>replace or add images; stored in the project, applied when you build the patched .vol</span> <button id=tx_x style=float:right>x</button><br>'
    + '<select id=tx_w style="width:100%"></select>'
    + '<div style="margin:4px 0"><label title="Resample your image to the size of the texture it replaces. Safest: the model\'s UVs and the file layout stay exactly as in the original."><input type=checkbox id=tx_keep checked> replace at the original size</label> '
    + '<select id=tx_mode title="palette = 8-bit, up to 256 colours, like the game\'s own textures. truecolour = 32-bit, 4x bigger."><option value=palette>256-colour palette<option value=truecolour>32-bit truecolour</select></div>'
    + '<div id=tx_grid style="display:flex;flex-wrap:wrap;gap:4px;max-height:260px;overflow:auto;border:1px solid #333;padding:3px"></div>'
    + '<div id=tx_sel class=h style="margin:4px 0">click a texture</div>'
    + '<div><button id=tx_exp disabled>export PNG</button> <button id=tx_rep disabled>replace with image…</button> <button id=tx_add>add new texture from image…</button> <button id=tx_undo disabled>revert this texture</button></div>'
    + '<input id=tx_file type=file accept="image/png,image/jpeg,image/webp,image/gif,image/bmp" style=display:none>'
    + '<div id=tx_ops class=h style="white-space:pre-wrap;margin-top:4px"></div>';
  document.body.appendChild(panel);

  let list = [], cur = null, mode = null; // mode: 'replace' | 'add'
  const shown = new Map(); // wad -> Set(texture offsets currently previewed from the project)

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
  function syncAll() { const T = getProject().textures || {}; for (const w of Object.keys(T)) { try { sync(w); } catch (e) { console.error(e); } } }

  function thumb(img, size) {
    const c = document.createElement('canvas'); c.width = img.w; c.height = img.h;
    c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(img.rgba), img.w, img.h), 0, 0);
    const k = Math.min(1, size / Math.max(img.w, img.h));
    c.style.width = Math.round(img.w * k) + 'px'; c.style.height = Math.round(img.h * k) + 'px';
    c.style.imageRendering = 'pixelated'; return c;
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
    $('tx_exp').disabled = !t.img; $('tx_rep').disabled = false; status();
  }

  function fill() {
    const w = wad(), g = w && getWad(w); $('tx_grid').innerHTML = ''; list = []; cur = null; $('tx_sel').textContent = 'click a texture'; $('tx_exp').disabled = $('tx_rep').disabled = true;
    if (!g) { status(); return; }
    list = listTextures(g.A, g.B);
    const rep = new Map(ops(w).filter(x => x.op === 'replace').map(x => [x.tex, x]));
    for (const t of list) {
      const img = t.img, r = rep.get(t.off); // t.img already shows the project's replacement (parse override)
      if (!img) continue;
      const c = thumb(img, 64); c.title = '@0x' + t.off.toString(16) + ' ' + t.w + 'x' + t.h; c.style.cursor = 'pointer'; c.style.border = r ? '1px solid #fc6' : '1px solid #333';
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
