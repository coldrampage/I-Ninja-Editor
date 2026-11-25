import { installTriggerEditor } from './trigger-editor.js?v=step16-cylinder-resize';
import { installPathEditor } from './path-editor.js?v=step146-strat-appearance-preview';
import { decodeXboxAdpcm, encodeXboxAdpcm } from './audio-preview.js?v=step38-music-preview-replacement';
// Entity inspector, transforms, register editing, link reassignment and entity copy/paste.
// All application state and cross-feature operations are injected by the coordinator.
export function installEntityEditor({
  Viewer, EC, getProject, wadOf, getWad, WS, base, put, unzero, srcEnt,
  addMaxId, ensureClass, pushAdds, stripLinkRegs, summary, rmList, r3, getAudioPca = null, setTriggerOverlayRender = () => {}, setPathOverlayRender = () => {}, onCustomModelChange = () => {}
}) {
  let clip = null;
  let customPasteSeq = 0;
  let grab = false;
  let mouse = { x: 0, y: 0 };
  let linkPick = null;
  let regOpen = false;
  const dataCtxCache = new WeakMap();
  const previewCache = new Map();
  const previewCacheLimit = 64 * 1024 * 1024;
  let previewCacheBytes = 0;
  let previewAudio = { context: null, source: null, button: null, buffer: null, offset: 0, startedAt: 0, playing: false, request: 0 };

  function setPreviewButton(button, state) {
    if (!button) return;
    const label = button.dataset && button.dataset.soundMusic === '1' ? 'music' : 'audio';
    if (state === 'playing') { button.textContent = 'Ⅱ'; button.title = 'Pause ' + label + ' preview'; button.setAttribute && button.setAttribute('aria-label', 'Pause ' + label + ' preview'); }
    else if (state === 'loading') { button.textContent = '…'; button.title = 'Loading ' + label + ' preview'; button.setAttribute && button.setAttribute('aria-label', 'Loading ' + label + ' preview'); }
    else { button.textContent = '▶'; button.title = 'Play ' + label + ' preview'; button.setAttribute && button.setAttribute('aria-label', 'Play ' + label + ' preview'); }
  }
  function stopPreview(resetOffset = true) {
    const old = previewAudio;
    previewAudio = { ...old, source: null, playing: false, button: null, buffer: resetOffset ? null : old.buffer, offset: resetOffset ? 0 : old.offset, request: old.request + 1 };
    if (old.source) { old.source.onended = null; try { old.source.stop(); } catch (_) {} }
    setPreviewButton(old.button, 'stopped');
  }
  function pausePreview() {
    const p = previewAudio;
    if (!p.playing || !p.source || !p.context) return;
    p.offset = Math.min(p.buffer.duration, p.offset + Math.max(0, p.context.currentTime - p.startedAt));
    const node = p.source; p.source = null; p.playing = false; node.onended = null;
    try { node.stop(); } catch (_) {}
    setPreviewButton(p.button, 'stopped');
  }
  function cachePreview(key, buffer) {
    const size = buffer.length * buffer.numberOfChannels * 4;
    if (size > previewCacheLimit) return buffer;
    if (previewCache.has(key)) { previewCacheBytes -= previewCache.get(key).size; previewCache.delete(key); }
    previewCache.set(key, { buffer, size }); previewCacheBytes += size;
    while (previewCacheBytes > previewCacheLimit && previewCache.size > 1) {
      const first = previewCache.keys().next().value, old = previewCache.get(first);
      previewCache.delete(first); previewCacheBytes -= old.size;
    }
    return buffer;
  }
  async function audioBufferFor(wad, bankOff, context, options = {}) {
    const key = String(wad) + '|' + Number(bankOff);
    const cached = previewCache.get(key);
    if (cached) { previewCache.delete(key); previewCache.set(key, cached); return cached.buffer; }
    if (typeof getAudioPca !== 'function') throw new Error('Audio preview needs the matching .avl archive loaded');
    const g = getWad(wad);
    if (!g || !g.A || !g.B) throw new Error('The source level for this sound is not loaded');
    const info = EC.bankInfo(g.A, bankOff), riff = EC.riffChunks(g.A, bankOff), bank = EC.parseBank(g.A, bankOff);
    if (!info || !riff || !bank || !['WAVE', 'WAVS'].includes(info.kind)) throw new Error('This is not a supported WAVE/WAVS sound bank');
    const fmt = riff.chunks['fmt '] && riff.chunks['fmt '][0];
    if (!fmt || fmt.n < 20) throw new Error('The sound bank has no complete Xbox ADPCM format record');
    const d = new DataView(g.A.buffer, g.A.byteOffset, g.A.byteLength);
    const formatTag = d.getUint16(fmt.at, true), channels = d.getUint16(fmt.at + 2, true), sampleRate = d.getUint32(fmt.at + 4, true);
    const blockAlign = d.getUint16(fmt.at + 12, true), bits = d.getUint16(fmt.at + 14, true), samplesPerBlock = d.getUint16(fmt.at + 18, true);
    const fact = riff.chunks.fact && riff.chunks.fact[0], samples = fact && fact.n >= 4 ? d.getUint32(fact.at, true) : bank.samples;
    if (formatTag !== 0x0069 || (channels !== 1 && channels !== 2) || bits !== 4 || blockAlign !== 36 * channels || samplesPerBlock !== 64 || !sampleRate || !samples) {
      throw new Error('Unsupported sound format (expected Xbox IMA ADPCM)');
    }
    const isMusic = !!options.music, maxSeconds = isMusic ? 300 : 180, maxBytes = isMusic ? 96 * 1024 * 1024 : 64 * 1024 * 1024;
    if (samples > sampleRate * maxSeconds) throw new Error('Sound is longer than the ' + (isMusic ? '5-minute music' : '3-minute sound') + ' preview limit');
    if (samples * channels * 4 > maxBytes) throw new Error('Decoded audio exceeds the ' + Math.round(maxBytes / (1024 * 1024)) + ' MiB temporary preview-memory limit');
    const source = await getAudioPca(wad);
    if (!source || !(source.pca instanceof Uint8Array) || !Number.isInteger(source.h78)) throw new Error('The matching .PCA audio data could not be read');
    const streamAt = (info.kind === 'WAVE' ? 0 : Math.ceil(source.h78 / 0x800) * 0x800) + info.off;
    if (info.len <= 0 || streamAt < 0 || streamAt + info.len > source.pca.length) throw new Error('The sound stream is outside its .PCA file');
    const audio = context.createBuffer(channels, samples, sampleRate);
    const destinations = Array.from({ length: channels }, (_, ch) => audio.getChannelData(ch));
    decodeXboxAdpcm(source.pca.subarray(streamAt, streamAt + info.len), channels, samples, destinations);
    return cachePreview(key, audio);
  }
  function base64ToBytes(text) {
    if (typeof text !== 'string' || !text) throw new Error('custom sound has no ADPCM payload');
    const binary = atob(text), bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  function bytesToBase64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x6000) binary += String.fromCharCode(...bytes.subarray(i, Math.min(bytes.length, i + 0x6000)));
    return btoa(binary);
  }
  function randomHex(n = 16) {
    const bytes = new Uint8Array(n);
    if (!globalThis.crypto || typeof globalThis.crypto.getRandomValues !== 'function') throw new Error('secure random IDs are unavailable in this browser');
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, x => x.toString(16).padStart(2, '0')).join('');
  }
  async function customAudioBufferFor(id, context, options = {}) {
    const key = 'custom|' + id, cached = previewCache.get(key);
    if (cached) { previewCache.delete(key); previewCache.set(key, cached); return cached.buffer; }
    const asset = (getProject().audioAssets || {})[id];
    if (!asset) throw new Error('custom sound asset is missing from the project');
    const data = base64ToBytes(asset.adpcm);
    const isMusic = !!options.music || !!asset.isMusic, maxSeconds = isMusic ? 300 : 180, maxBytes = isMusic ? 96 * 1024 * 1024 : 64 * 1024 * 1024;
    if (+asset.samples > +asset.sampleRate * maxSeconds) throw new Error('Custom audio exceeds the ' + (isMusic ? '5-minute music' : '3-minute sound') + ' preview limit');
    if (+asset.samples * +asset.channels * 4 > maxBytes) throw new Error('Decoded audio exceeds the ' + Math.round(maxBytes / (1024 * 1024)) + ' MiB temporary preview-memory limit');
    const audio = context.createBuffer(+asset.channels, +asset.samples, +asset.sampleRate);
    const destinations = Array.from({ length: +asset.channels }, (_, ch) => audio.getChannelData(ch));
    decodeXboxAdpcm(data, +asset.channels, +asset.samples, destinations);
    return cachePreview(key, audio);
  }
  // Imported audio is project content, not a browser cache. Keep only assets
  // still referenced by an entity edit or the copy buffer; replaced/unused
  // imports are pruned so repeated experiments do not grow project memory.
  function pruneUnusedAudioAssets() {
    const project = getProject(), assets = project && project.audioAssets;
    if (!assets) return;
    const used = new Set();
    const inspectEdits = edits => {
      for (const value of Object.values(edits || {})) {
        if (value && typeof value === 'object' && value.customId) used.add(String(value.customId));
      }
    };
    for (const P of Object.values(project.wads || {})) {
      for (const edit of Object.values(P.mods || {})) inspectEdits(edit && edit.sounds);
      for (const add of P.adds || []) inspectEdits(add && add.sounds);
      for (const id of Object.values(P.music || {})) if (id) used.add(String(id));
    }
    inspectEdits(clip && clip.sounds);
    for (const id of Object.keys(assets)) if (!used.has(id)) {
      delete assets[id];
      const key = 'custom|' + id, cached = previewCache.get(key);
      if (cached) { previewCache.delete(key); previewCacheBytes = Math.max(0, previewCacheBytes - cached.size); }
    }
  }
  function releasePreviewResources() {
    const context = previewAudio.context;
    stopPreview();
    previewCache.clear(); previewCacheBytes = 0;
    previewAudio = { context: null, source: null, button: null, buffer: null, offset: 0, startedAt: 0, playing: false, request: previewAudio.request + 1 };
    if (context && typeof context.close === 'function') {
      try { const closing = context.close(); if (closing && typeof closing.catch === 'function') closing.catch(() => {}); } catch (_) {}
    }
  }

  async function importCustomAudio(file, kind, options = {}) {
    if (!file || typeof file.arrayBuffer !== 'function') throw new Error('choose an audio file');
    if (Number.isFinite(file.size) && file.size > 64 * 1024 * 1024) throw new Error('source audio file is larger than the 64 MiB import limit');
    const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Audio) throw new Error('audio decoding is not supported by this browser');
    let context = previewAudio.context;
    if (!context) { context = new Audio(); previewAudio.context = context; }
    const input = await file.arrayBuffer();
    const decoded = await context.decodeAudioData(input.slice(0));
    const channels = decoded.numberOfChannels;
    if (channels !== 1 && channels !== 2) throw new Error('custom sounds must be mono or stereo (1 or 2 channels)');
    const sampleRate = Math.round(decoded.sampleRate), samples = decoded.length;
    if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 48000) throw new Error('audio sample rate must be between 8,000 and 48,000 Hz');
    const isMusic = !!options.music, maxSeconds = isMusic ? 300 : 180, maxBytes = isMusic ? 16 * 1024 * 1024 : 12 * 1024 * 1024;
    if (!Number.isInteger(samples) || samples < 1 || samples > sampleRate * maxSeconds) throw new Error('audio must be no longer than ' + (isMusic ? '5 minutes' : '3 minutes'));
    if (samples * channels * 4 > 96 * 1024 * 1024) throw new Error('decoded audio exceeds the 96 MiB temporary import-memory limit');
    const pcm = Array.from({ length: channels }, (_, ch) => new Float32Array(decoded.getChannelData(ch)));
    const adpcm = encodeXboxAdpcm(pcm);
    if (adpcm.length > maxBytes) throw new Error('encoded ' + (isMusic ? 'music' : 'sound') + ' is larger than the ' + Math.round(maxBytes / (1024 * 1024)) + ' MiB per-file limit');
    const id = randomHex(12), stem = String(file.name || 'imported').replace(/\.[^.]*$/, '').normalize('NFKD').replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 22) || 'imported';
    return {
      id, name: String(file.name || 'imported audio').slice(0, 120),
      bankName: 'custom_' + stem + '_' + id.slice(0, 6) + '.wav',
      guid: randomHex(16), kind: kind === 'WAVS' ? 'WAVS' : 'WAVE',
      sampleRate, channels, samples, isMusic, adpcm: bytesToBase64(adpcm), bytes: adpcm.length
    };
  }
  async function togglePreview(button) {
    const customId = button && button.dataset && button.dataset.soundCustomId;
    const bankOff = Number(button && button.dataset && button.dataset.soundBankOff);
    const wad = button && button.dataset && button.dataset.soundWad;
    const isMusic = !!(button && button.dataset && button.dataset.soundMusic === '1');
    if (!button || (!customId && (!Number.isInteger(bankOff) || bankOff <= 0 || !wad))) return;
    if (previewAudio.button === button && previewAudio.playing) { pausePreview(); return; }
    if (previewAudio.button === button && previewAudio.buffer && !previewAudio.playing) {
      if (previewAudio.offset >= previewAudio.buffer.duration) previewAudio.offset = 0;
      try { await startPreview(button, previewAudio.buffer, previewAudio.offset); }
      catch (error) {
        stopPreview();
        if (Viewer.$('ed_sum')) Viewer.$('ed_sum').textContent = 'audio preview unavailable: ' + (error && error.message || error);
      }
      return;
    }
    stopPreview();
    const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Audio) { if (Viewer.$('ed_sum')) Viewer.$('ed_sum').textContent = 'audio preview is not supported by this browser'; return; }
    let context = previewAudio.context;
    if (!context) { context = new Audio(); previewAudio.context = context; }
    const request = previewAudio.request + 1;
    previewAudio = { ...previewAudio, context, button, buffer: null, offset: 0, playing: false, request };
    setPreviewButton(button, 'loading');
    try {
      if (context.state === 'suspended' && typeof context.resume === 'function') await context.resume();
      const buffer = customId ? await customAudioBufferFor(customId, context, { music: isMusic }) : await audioBufferFor(wad, bankOff, context, { music: isMusic });
      if (previewAudio.request !== request || previewAudio.button !== button) return;
      previewAudio.buffer = buffer;
      await startPreview(button, buffer, 0);
    } catch (error) {
      if (previewAudio.request === request) {
        stopPreview();
        if (Viewer.$('ed_sum')) Viewer.$('ed_sum').textContent = 'audio preview unavailable: ' + (error && error.message || error);
      }
    }
  }
  async function startPreview(button, buffer, offset) {
    const p = previewAudio, context = p.context;
    if (!context || p.button !== button) return;
    if (context.state === 'suspended' && typeof context.resume === 'function') await context.resume();
    const node = context.createBufferSource(); node.buffer = buffer; node.connect(context.destination);
    const request = p.request;
    node.onended = () => {
      if (previewAudio.request === request && previewAudio.source === node) {
        const b = previewAudio.button;
        previewAudio = { ...previewAudio, source: null, playing: false, buffer: null, offset: 0, button: null };
        setPreviewButton(b, 'stopped');
      }
    };
    previewAudio.source = node; previewAudio.buffer = buffer; previewAudio.offset = offset;
    previewAudio.startedAt = context.currentTime; previewAudio.playing = true;
    setPreviewButton(button, 'playing');
    node.start(0, offset);
  }
  const LANG = ['English', 'French', 'German', 'Spanish', 'Italian'];
  const LANG_CODE = { eng: 'English', fre: 'French', fra: 'French', ger: 'German', deu: 'German', spa: 'Spanish', ita: 'Italian' };
  const BELTS = ['Yellow', 'Green', 'Blue', 'Red', 'Black'];
  const MISSION_TYPES = { 1: 'Beat the clock', 2: 'Beat the highscore', 3: 'Hunt the enemies', 4: 'Find the red coinage' };
  const MISSION_GOAL_HINT = { 1: 'time to beat · seconds', 2: 'score to beat', 3: 'enemies to defeat', 4: 'red coins to find' };

  const musicCueKey = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  function dataContext(w) {
    const g = getWad(w);
    if (!g || !g.A || !g.B) return null;
    let c = dataCtxCache.get(g);
    if (c) return c;
    try {
      const S = EC.SrcCtx(g.A, g.B), sounds = [], musicBanks = [];
      for (const [off, type] of S.res) if (type === 0x115 && S.w.rel.has(off)) {
        const bankOff = S.U(off), bank = EC.parseBank(g.A, bankOff), info = EC.bankInfo(g.A, bankOff);
        if (S.res.get(bankOff) !== 0x113 || !bank || !info) continue;
        const item = { off, bankOff, name: bank.name || ('bank @0x' + bankOff.toString(16)), kind: info.kind };
        if (info.kind === 'WAVE' || info.kind === 'WAVS') sounds.push(item);
        else if (info.kind === 'AMPC') {
          try {
            const catalog = EC.ampcTracks(S, bankOff);
            item.catalog = catalog;
            item.tracksByCue = new Map(catalog.tracks.filter(t => t.bankOff != null).map(t => [musicCueKey(t.cueName), t]));
          } catch (error) { item.musicError = String(error && error.message || error); item.tracksByCue = new Map(); }
          musicBanks.push(item);
        }
      }
      sounds.sort((a, b) => a.name.localeCompare(b.name));
      musicBanks.sort((a, b) => a.name.localeCompare(b.name));
      c = { S, sounds, musicBanks }; dataCtxCache.set(g, c); return c;
    } catch (_) { return null; }
  }
  function readText(S, off) {
    if (!Number.isInteger(off) || off < 1 || off >= S.A.length) return null;
    let end = off; while (end < S.A.length && end - off <= 4096 && S.A[end] !== 0) end++;
    if (end >= S.A.length || end - off > 4096) return null;
    try { return new TextDecoder('utf-8').decode(S.A.subarray(off, end)); }
    catch (_) { return String.fromCharCode(...S.A.subarray(off, end)); }
  }
  function languageFor(name, index) {
    const m = /_([a-z]{3})_/i.exec(name || '');
    return m && LANG_CODE[m[1].toLowerCase()] || LANG[index] || ('Language ' + (index + 1));
  }
  function localisedTable(ctx, baseOff) {
    const S = ctx && ctx.S, U = S && S.U;
    if (!S || !Number.isInteger(baseOff) || baseOff < 0 || baseOff + 5 * 8 > S.A.length) return null;
    const entries = [];
    for (let i = 0; i < 5; i++) {
      const textSlot = baseOff + i * 8;
      if (!S.w.rel.has(textSlot)) return null;
      const textOff = U(textSlot), text = readText(S, textOff);
      if (text === null || !text.trim()) return null;
      const audioField = textSlot + 4, audioHandle = U(audioField);
      let audioOff = null, audioBankOff = null, audioName = null, audioKind = null;
      if (audioHandle) {
        if (!S.w.rel.has(audioField) || !S.w.rel.has(audioHandle) || S.res.get(audioHandle) !== 0x115) return null;
        audioBankOff = U(audioHandle);
        if (S.res.get(audioBankOff) !== 0x113) return null;
        const b = EC.parseBank(S.A, audioBankOff), bi = EC.bankInfo(S.A, audioBankOff);
        if (!b || !bi || !['WAVE', 'WAVS'].includes(bi.kind)) return null;
        audioOff = audioHandle; audioName = b.name; audioKind = bi.kind;
      }
      entries.push({ index: i, lang: languageFor(audioName, i), textSlot, textOff, text, audioSlot: audioHandle ? audioField : null, audioOff, audioBankOff, audioName, audioKind });
    }
    return entries.length === 5 ? entries : null;
  }
  function floatFromBits(v) { const b = new ArrayBuffer(4), d = new DataView(b); d.setUint32(0, v >>> 0, true); return d.getFloat32(0, true); }
  function floatToBits(v) { const b = new ArrayBuffer(4), d = new DataView(b); d.setFloat32(0, +v, true); return d.getUint32(0, true); }
  // Script angles are fixed-point turns: 4096 units = 360 degrees.
  function angleFromBits(v) { const n = (((v >>> 0) + 2048) % 4096 + 4096) % 4096 - 2048; return n * 360 / 4096; }
  function angleToBits(v) { return Math.round((+v || 0) * 4096 / 360) >>> 0; }
  function customAngleToBits(v) { const deg = (((Number(v) || 0) % 360) + 360) % 360; return Math.round(deg * 4096 / 360) & 4095; }
  function musicCuesFor(wad) {
    const m = /^(\d+)-\d+\.LCS$/i.exec(String(wad || ''));
    if (!m) return null;
    const bankWad = m[1] + '-99.LCS', ctx = dataContext(bankWad);
    if (!ctx) return null;
    try {
      const S = ctx.S, cues = [];
      for (const inst of S.w.instances) {
        const cls = S.w.classes[inst.cls];
        if (!cls || cls.name !== 'MusicPlayerBank') continue;
        const handleOff = S.w.rel.has(inst.init) ? S.U(inst.init) : 0;
        const musicBank = ctx.musicBanks.find(x => x.off === handleOff);
        // MusicStart value N selects MusicPlayerBank register R(N+1).
        for (let k = 1; k < 11; k++) {
          const slot = inst.init + 4 * k;
          if (!S.w.rel.has(slot)) continue;
          const name = S.str(S.U(slot));
          if (!name) continue;
          const track = musicBank && musicBank.tracksByCue && musicBank.tracksByCue.get(musicCueKey(name));
          const musicEdits = getProject().wads[bankWad] && getProject().wads[bankWad].music || {};
          const customId = track && track.bankOff != null ? musicEdits[String(track.bankOff)] || null : null;
          cues.push({ value: k, name, register: k + 1, bankOff: track ? track.bankOff : null, kind: track ? track.kind : null, customId, replaceable: !!(track && track.replaceable), related: track ? track.related : [] });
        }
        if (cues.length) return { wad: bankWad, cues, musicBank };
      }
      return { wad: bankWad, cues: [] };
    } catch (_) { return null; }
  }

  const ent = q => {
    if (q && q.customModel) return q;
    const lv = Viewer.D.find(l => l.id === q.L);
    return lv && lv.ents.find(e => e.i === q.i);
  };
  function customModelRecord(q) {
    if (!q || !q.customModel) return null;
    const records = getProject().customModels && getProject().customModels[q.customModelWad || wadOf(q.L)];
    return records && Array.isArray(records.instances) ? records.instances.find(x => x && x.id === q.customModelId) || null : null;
  }

  // Editable records cover native LCS entities plus project-backed custom-model
  // placements surfaced by the Models panel as virtual selectable entities.
  function rec(q) {
    const e = ent(q), w = wadOf(q.L);
    if (!e || !w) return null;
    if (e.customModel) { const custom = customModelRecord(e); return custom ? { e, w, custom } : null; }
    const P = WS(w);
    if (e.added) return { e, w, add: P.adds[e.added - 1] };
    const m = P.mods[e.i] || (P.mods[e.i] = { d: [0, 0, 0], dy: 0, dp: 0, dr: 0, regs: {}, texts: {}, sounds: {} });
    return { e, w, m };
  }

  function redo(R) {
    const PRJ = getProject();
    if (R.custom) {
      const p = R.custom.position || [0, 0, 0], rot = R.custom.rotation || [0, 0, 0];
      R.e.p = p.slice(0, 3); R.e.r = customAngleToBits(180 + (Number(rot[1]) || 0)); R.e.customScale = (R.custom.scale || [1, 1, 1])[0] || 1;
      const half = (180 + (Number(rot[1]) || 0)) * Math.PI / 360;
      R.e.q = [0, Math.sin(half), 0, Math.cos(half)];
      Viewer.buildEnts(); Viewer.need = true;
      update();
      return;
    }
    if (R.add) {
      const s = srcEnt(R.add), B = base(s);
      put(R.e, {
        d: R.add.p.map((v, j) => v - B.p[j]),
        dy: R.add.dy || 0, dp: R.add.dp || 0, dr: R.add.dr || 0,
        regs: R.add.regs, trigger: R.add.trigger, path: R.add.path, pathMap: R.add.pathMap
      });
    } else {
      put(R.e, R.m);
      if (!unzero(R.m)) delete PRJ.wads[R.w].mods[R.e.i];
    }
    const q = Viewer.all.find(o => o.L === Viewer.sel.L && o.i === R.e.i);
    Object.assign(q, {
      p: R.e.p, b: R.e.b, poly: R.e.poly, path: R.e.path, shape: R.e.shape, pathbox: R.e.pathbox, xzOnly: R.e.xzOnly,
      r: R.e.r, q: R.e.q, params: R.e.params
    });
    Viewer.sel = q;
    Viewer.buildEnts();
    Viewer.need = true;
    update();
  }

  function setPos(R, p) {
    if (R.custom) R.custom.position = p.map(r3);
    else if (R.add) R.add.p = p.map(r3);
    else R.m.d = p.map((v, k) => r3(v - base(R.e).p[k]));
    redo(R);
  }
  function setYaw(R, deg) {
    if (R.custom) { const yaw = ((Number(deg) || 0) % 360 + 360) % 360; R.custom.rotation = [0, r3(yaw), 0]; }
    else { const dy = r3((deg / 360 * 4096) - (R.add ? base(srcEnt(R.add)).r : base(R.e).r)); if (R.add) R.add.dy = dy; else R.m.dy = dy; }
    redo(R);
  }
  function setCustomScale(R, value) {
    const scale = Number(value); if (!Number.isFinite(scale) || scale <= 0) throw 'scale must be a positive finite number';
    if (!R.custom) return;
    R.custom.scale = [scale, scale, scale]; redo(R);
  }
  function setTilt(R, key, deg) {
    const v = r3(deg / 360 * 4096);
    if (R.add) R.add[key] = v;
    else R.m[key] = v;
    redo(R);
  }
  function setReg(R, k, v) {
    const H = R.add || R.m; H.regs = H.regs || {}; H.regs[k] = v >>> 0;
    redo(R);
  }
  function setText(R, owner, slot, value, ownerKind = 'data') {
    const H = R.add || R.m; H.texts = H.texts || {}; H.texts[slot] = { owner, slot, ownerKind, value: String(value) };
    summary();
  }
  function resetText(R, slot) { const H = R.add || R.m; if (H.texts) delete H.texts[slot]; redo(R); }
  function setSound(R, owner, slot, off, ownerKind = 'data') {
    const H = R.add || R.m; H.sounds = H.sounds || {}; H.sounds[slot] = { owner, slot, off: +off, ownerKind };
    pruneUnusedAudioAssets(); summary();
  }
  function setCustomSound(R, owner, slot, customId, ownerKind = 'data') {
    const H = R.add || R.m; H.sounds = H.sounds || {}; H.sounds[slot] = { owner, slot, customId: String(customId), ownerKind };
    pruneUnusedAudioAssets(); summary();
  }
  function resetSound(R, slot) { const H = R.add || R.m; if (H.sounds) delete H.sounds[slot]; pruneUnusedAudioAssets(); redo(R); }
  function setTrigger(R, trigger) {
    const H = R.add || R.m;
    if (trigger) H.trigger = { ty: trigger.ty, box: trigger.box.slice(), poly: trigger.poly ? trigger.poly.slice() : null };
    else delete H.trigger;
    redo(R);
  }
  function setPath(R, path, pathMap = null) {
    const H = R.add || R.m;
    if (path) {
      H.path = path.map(node => node.map((v, k) => r3(v - R.e.p[k])));
      if (Array.isArray(pathMap)) H.pathMap = pathMap.slice();
      else delete H.pathMap;
    } else { delete H.path; delete H.pathMap; }
    redo(R);
  }
  const triggerEditor = installTriggerEditor({
    Viewer, setOverlayRender: setTriggerOverlayRender,
    commit: (q, trigger) => { const R = rec(q); if (R) setTrigger(R, trigger); }
  });
  const pathEditor = installPathEditor({
    Viewer, setOverlayRender: setPathOverlayRender,
    commit: (q, path, pathMap) => { const R = rec(q); if (R) setPath(R, path, pathMap); }
  });

  function currentYawForStep(R, pendingInputYaw = null) {
    if (Number.isFinite(pendingInputYaw)) return pendingInputYaw;
    // Custom placements store editor yaw directly in degrees. Native STRAT
    // entities store their heading in 4096 units per turn.
    return R.custom
      ? (Number((R.custom.rotation || [0, 0, 0])[1]) || 0)
      : ((Number(R.e.r) || 0) / 4096 * 360);
  }

  function rotateByStep(R, delta, pendingInputYaw = null) {
    if (!R) return;
    setYaw(R, currentYawForStep(R, pendingInputYaw) + delta);
  }

  function bindRotateStep(button, R, delta) {
    // Keep the yaw input focused until click is dispatched. Its blur/change
    // handler redraws the inspector and used to detach the button before the
    // click could run when the user had just typed 15 or -15 degrees.
    button.onmousedown = event => {
      if (event && event.button !== undefined && event.button !== 0) return;
      if (event && typeof event.preventDefault === 'function') event.preventDefault();
    };
    button.onclick = () => {
      const yawInput = Viewer.$('ed_w');
      const active = typeof document !== 'undefined' ? document.activeElement : null;
      let pendingYaw = null;
      if (active && active === yawInput) {
        const value = String(active.value ?? '').trim();
        const parsed = Number(value);
        if (value !== '' && Number.isFinite(parsed)) pendingYaw = parsed;
      } else if (active && active !== button && typeof active.onchange === 'function') {
        // Preserve a pending position/scale/tilt edit before update() redraws
        // the inspector in response to the rotation step.
        active.onchange.call(active);
      }
      // Resolve the current record after committing another focused field;
      // that commit may itself have rebuilt the inspector and selection row.
      rotateByStep(rec(Viewer.sel) || R, delta, pendingYaw);
    };
  }

  const nudge = (dx, dy, dz) => {
    if (!Viewer.sel) return;
    const R = rec(Viewer.sel);
    if (!R) return;
    const p = R.e.p;
    setPos(R, [p[0] + dx, p[1] + dy, p[2] + dz]);
  };

  function update() {
    stopPreview();
    pruneUnusedAudioAssets();
    summary();
    rmList();
    const S = Viewer.$('ed_sel'), R = Viewer.sel && rec(Viewer.sel), SI = Viewer.sel && Viewer.scr(Viewer.sel);
    const lv = Viewer.$('ed_lv'), cur = lv.value;
    lv.innerHTML = Viewer.D.filter(l => wadOf(l.id)).map(l => '<option>' + l.id + '</option>').join('');
    if (cur) lv.value = cur;
    else if (Viewer.sel && wadOf(Viewer.sel.L)) lv.value = Viewer.sel.L;
    if (!R) {
      S.innerHTML = '<span class=h>click an entity to edit it</span>';
      triggerEditor.render(S, null, null);
      pathEditor.render(S, null, null);
      return;
    }
    const e = R.e, f = (id, v, st) => '<input type=number id=' + id + ' value="' + v + '" step=' + st + ' style="width:62px">';
    if (R.custom) {
      const p = R.custom.position || [0, 0, 0], rot = R.custom.rotation || [0, 0, 0], scale = (R.custom.scale || [1, 1, 1])[0] || 1;
      S.innerHTML = '<b style="color:#8fd">' + Viewer.esc(e.n) + '</b> <span class=h>custom model · ' + Viewer.esc(R.w) + '</span><br>X ' + f('ed_x', p[0], .5) + ' Y ' + f('ed_y', p[1], .5) + ' Z ' + f('ed_z', p[2], .5) + '<br>yaw ' + f('ed_w', +(rot[1] || 0).toFixed(1), 5) + '&deg; &nbsp; scale ' + f('ed_custom_scale', scale, .1) + '<br>step <input type=number id=ed_st value=' + (S.dataset.st || 1) + ' style="width:48px"><br>'
        + ['-X', '+X', '-Y', '+Y', '-Z', '+Z'].map(t => '<button data-n="' + t + '">' + t + '</button>').join('') + ' <button data-n="L">&#8634;15</button><button data-n="R">&#8635;15</button><br><button id=ed_cp>copy</button> <button id=ed_ps>paste</button> <button id=ed_del>delete</button>'
        + '<div class=h>Hold G + move mouse to drag on the ground plane. Ctrl+C / Ctrl+V copies this model placement to the cursor. This custom static-model writer currently exports yaw and uniform scale.</div>';
      const g = id => +Viewer.$(id).value;
      for (const id of ['ed_x', 'ed_y', 'ed_z']) Viewer.$(id).onchange = () => setPos(R, [g('ed_x'), g('ed_y'), g('ed_z')]);
      Viewer.$('ed_w').onchange = () => setYaw(R, g('ed_w'));
      Viewer.$('ed_custom_scale').onchange = () => { try { setCustomScale(R, g('ed_custom_scale')); } catch (error) { Viewer.$('ed_sum').textContent = String(error); } };
      Viewer.$('ed_st').onchange = () => { S.dataset.st = g('ed_st'); };
      S.querySelectorAll('button[data-n]').forEach(b => {
        const t = b.dataset.n;
        if (t === 'L') { bindRotateStep(b, R, -15); return; }
        if (t === 'R') { bindRotateStep(b, R, 15); return; }
        b.onclick = () => {
          const step = +Viewer.$('ed_st').value || 1, axis = { X: 0, Y: 1, Z: 2 }[t[1]], delta = [0, 0, 0];
          delta[axis] = t[0] === '-' ? -step : step; nudge(...delta);
        };
      });
      Viewer.$('ed_cp').onclick = copy;
      Viewer.$('ed_ps').onclick = () => paste();
      Viewer.$('ed_del').onclick = () => {
        const models = getProject().customModels || {}, C = models[R.w];
        if (C && Array.isArray(C.instances)) C.instances = C.instances.filter(x => x && x.id !== R.custom.id);
        Viewer.sel = null; Viewer.refresh(); Viewer.inspect(null); update();
      };
      // Keep the Models panel's placement selector and transform fields in sync
      // when a custom object is selected directly in the 3D view or changed here.
      onCustomModelChange(R.w, R.custom.id);
      return;
    }
    // Resolve register pointers against the source wad. A small, validated
    // five-language record (text pointer + optional sound-bank pointer) is
    // presented as editable linked data rather than an opaque address.
    const source = R.add ? R.add.from : { w: R.w, i: e.i };
    const ctx = source && dataContext(source.w);
    const sourceInst = ctx && ctx.S.w.instances[source.i];
    const H = R.add || R.m, textEdits = H.texts || {}, soundEdits = H.sounds || {};
    const linkedTables = new Map(), directStrings = new Map(), audioLinks = new Map(), musicBankLinks = new Map();
    if (ctx && sourceInst) for (let k = 0; k < e.params.length; k++) {
      const slot = sourceInst.init + 4 * k;
      if (!ctx.S.w.rel.has(slot)) continue;
      const ptr = ctx.S.U(slot), table = localisedTable(ctx, ptr);
      if (table) linkedTables.set(k, { owner: ptr, entries: table });
      else if (e.n === 'MusicPlayerBank' && k === 0) {
        const bank = (ctx.musicBanks || []).find(x => x.off === ptr);
        if (bank) musicBankLinks.set(k, bank);
      } else if (ctx.S.res.get(ptr) === 0x115 && ctx.S.w.rel.has(ptr)) {
        const bankOff = ctx.S.U(ptr), info = EC.bankInfo(ctx.S.A, bankOff);
        if (ctx.S.res.get(bankOff) === 0x113 && info && (info.kind === 'WAVE' || info.kind === 'WAVS')) {
          audioLinks.set(k, { owner: sourceInst.init, ownerKind: 'init', slot, off: ptr, kind: info.kind });
        }
      } else {
        const text = !ctx.S.res.has(ptr) ? ctx.S.str(ptr) : null;
        if (text !== null) directStrings.set(k, { owner: sourceInst.init, ownerKind: 'init', slot, text });
      }
    }
    const musicCues = e.n === 'MusicStart' ? musicCuesFor(R.w) : null;
    const textControl = (owner, slot, value, key) => {
      const edit = textEdits[slot], current = edit && typeof edit === 'object' ? edit.value : (edit === undefined ? value : edit);
      return '<div class=regdata-row><label>' + Viewer.esc(key) + '</label><textarea rows=2 data-text-slot="' + slot + '" data-text-owner="' + owner + '">' + Viewer.esc(current == null ? '' : current) + '</textarea>'
        + (edit !== undefined ? ' <button data-text-reset="' + slot + '">reset</button>' : '') + '</div>';
    };
    const soundControl = (owner, slot, currentOff, kind, key, ownerKind = 'data') => {
      if (currentOff == null) return '<div class=regdata-row><label>' + Viewer.esc(key) + '</label><span class=h>no sound link</span></div>';
      const edit = soundEdits[slot], selectedCustomId = edit && typeof edit === 'object' ? edit.customId : null;
      const selected = selectedCustomId ? 'custom:' + selectedCustomId : String(edit === undefined ? currentOff : (edit && typeof edit === 'object' ? edit.off : edit));
      const choices = (ctx.sounds || []).filter(b => b.kind === kind);
      if (!selectedCustomId && !choices.some(b => String(b.off) === selected)) choices.unshift({ off: +selected, bankOff: null, name: 'current sound @0x' + Number(selected).toString(16), kind });
      const assets = Object.entries(getProject().audioAssets || {}).filter(([, a]) => a && a.kind === kind).sort((a, b) => String(a[1].name).localeCompare(String(b[1].name)));
      const selectedAsset = selectedCustomId && (getProject().audioAssets || {})[selectedCustomId];
      if (selectedCustomId && !assets.some(([id]) => id === selectedCustomId)) assets.unshift([selectedCustomId, selectedAsset || { name: 'missing custom audio', kind }]);
      const options = choices.map(b => '<option value="' + b.off + '" data-bank-off="' + (b.bankOff == null ? '' : b.bankOff) + '"' + (String(b.off) === selected ? ' selected' : '') + '>' + Viewer.esc(b.name) + '</option>').join('')
        + assets.map(([id, a]) => '<option value="custom:' + Viewer.esc(id) + '"' + (selected === 'custom:' + id ? ' selected' : '') + '>' + Viewer.esc('★ ' + (a.name || a.bankName || id) + ' · imported') + '</option>').join('');
      const selectedChoice = choices.find(b => String(b.off) === selected);
      const preview = '<button type=button data-sound-preview data-sound-wad="' + Viewer.esc(source.w).replace(/"/g, '&quot;') + '" data-sound-bank-off="' + (selectedChoice && selectedChoice.bankOff != null ? selectedChoice.bankOff : '') + '" data-sound-custom-id="' + Viewer.esc(selectedCustomId || '') + '" title="Play audio preview" aria-label="Play audio preview"' + ((!selectedCustomId && (!selectedChoice || selectedChoice.bankOff == null)) || (selectedCustomId && !selectedAsset) ? ' disabled' : '') + '>▶</button>';
      const importButton = '<button type=button data-sound-import data-sound-slot="' + slot + '" data-sound-owner="' + owner + '" data-sound-owner-kind="' + ownerKind + '" data-sound-kind="' + kind + '">import audio…</button><input type=file accept="audio/*,.wav" data-sound-import-file data-sound-slot="' + slot + '" data-sound-owner="' + owner + '" data-sound-owner-kind="' + ownerKind + '" data-sound-kind="' + kind + '" style="display:none">';
      return '<div class=regdata-row><label>' + Viewer.esc(key) + '</label><select data-sound-slot="' + slot + '" data-sound-owner="' + owner + '" data-sound-owner-kind="' + ownerKind + '">' + options + '</select> ' + preview + ' ' + importButton
        + (edit !== undefined ? ' <button data-sound-reset="' + slot + '">reset</button>' : '') + '<div class=h>' + Viewer.esc(kind + ' bank · select, import or play to preview') + '</div></div>';
    };
    const dataRegisterHtml = (k, meta) => '<details class=regdata><summary>↗ linked text/audio data · 5 languages</summary>' + meta.entries.map(item => {
      const text = textControl(meta.owner, item.textSlot, item.text, item.lang + ' text');
      const audio = item.audioSlot == null ? '<div class=regdata-row><label>' + Viewer.esc(item.lang + ' audio') + '</label><span class=h>no audio pointer</span></div>' : soundControl(meta.owner, item.audioSlot, item.audioOff, item.audioKind, item.lang + ' audio');
      return '<div class=regdata-lang><b>' + Viewer.esc(item.lang) + '</b>' + text + audio + '</div>';
    }).join('') + '</details>';
    const regHtml = e.params.map((p, k) => {
      // EnemyGenerator reserves R1–R20 as enemy-object handles. These are
      // optional slots even when the LCS link table has no entry yet, so expose
      // every slot as a link picker rather than a numeric register textbox.
      if (/^EnemyGenerators?$/i.test(e.n) && k === 0) {
        const value = (H.regs || {})[k] === undefined ? p.v : H.regs[k];
        return '<div>r0 <input type=number id=ed_r0 data-wave-count-k=0 min=0 step=1 value="' + (value >>> 0) + '" style="width:100px"> <span class=h>enemies per wave · 0 spawns all configured enemies at once</span></div>';
      }
      if (/^EnemyGenerators?$/i.test(e.n) && k >= 1 && k <= 20) {
        const sourceLink = SI && SI.l && SI.l.find(a => a[0] == k);
        const addedLink = (H.lk || []).find(a => a[0] == k);
        const hasRegOverride = Object.prototype.hasOwnProperty.call(H.regs || {}, k);
        const isManualLink = (H.linkRegs || []).some(r => +r === k);
        const rawTargetIndex = hasRegOverride ? (H.regs[k] >>> 0) : (p.v >>> 0);
        let target = null, targetText = 'empty enemy slot';
        if (addedLink) {
          const adds = WS(R.w).adds || [], ai = adds.findIndex(a => a.id === addedLink[1]);
          if (ai >= 0) target = Viewer.all.find(o => o.L === Viewer.sel.L && o.added === ai + 1) || null;
        } else if (hasRegOverride || sourceLink || isManualLink || rawTargetIndex !== 0) {
          const targetIndex = sourceLink && !hasRegOverride ? sourceLink[1] : rawTargetIndex;
          target = Viewer.all.find(o => o.L === Viewer.sel.L && o.i === targetIndex) || null;
        }
        if (target) targetText = '→ #' + target.i + ' ' + target.n;
        else if (addedLink) targetText = '→ linked copied enemy';
        else if (sourceLink || hasRegOverride || isManualLink) targetText = '→ target #' + (sourceLink && !hasRegOverride ? sourceLink[1] : rawTargetIndex);
        const on = linkPick && linkPick.L === Viewer.sel.L && linkPick.i === e.i && linkPick.k == k;
        const overridden = hasRegOverride || isManualLink || !!addedLink;
        return '<div class=reglink>r' + k + ' <span class=h>enemy slot ' + k + '</span> <span class=h>' + Viewer.esc(targetText) + '</span> <button data-lk=' + k + (on ? ' style="background:#fa0"' : '') + '>' + (on ? 'click target...' : 'link...') + '</button>' + (overridden ? ' <button data-lkr=' + k + ' title="restore this enemy slot">reset</button>' : '') + '</div>';
      }
      const lq = !p.s && SI && SI.l.find(a => a[0] == k);
      if (lq) {
        const ov = (H.lk || []).some(l => l[0] == k) || (H.regs || {})[k] !== undefined;
        const on = linkPick && linkPick.L === Viewer.sel.L && linkPick.i === e.i && linkPick.k == k;
        return '<div>r' + k + ' <span class=h>' + Viewer.esc(Viewer.regTxt(Viewer.sel, SI, k)) + '</span> <button data-lk=' + k + (on ? ' style="background:#fa0"' : '') + '>' + (on ? 'click target...' : 'link...') + '</button>' + (ov ? ' <button data-lkr=' + k + ' title="back to what the copied/original object had">reset</button>' : '') + '</div>';
      }
      if (linkedTables.has(k)) {
        const meta = linkedTables.get(k);
        return '<div class=reglink>r' + k + ' <span class=h>↗ ' + (meta.entries.some(x => x.audioOff != null) ? 'localised dialogue / audio' : 'localised text') + ' table</span></div>' + dataRegisterHtml(k, meta);
      }
      if (directStrings.has(k)) {
        const d = directStrings.get(k), edit = textEdits[d.slot], current = edit && typeof edit === 'object' ? edit.value : (edit === undefined ? d.text : edit);
        const levelDestination = /^(MissionSelectDoor|BossDoor_.+|HUBtoHUBDoor)$/i.test(e.n) && /^\d{2}-\d{2}$/.test(String(d.text || ''));
        if (e.n === 'MusicPlayerBank' && musicBankLinks.has(0)) {
          const musicBank = musicBankLinks.get(0), track = musicBank.tracksByCue && musicBank.tracksByCue.get(musicCueKey(current));
          const musicWad = source.w, projectMusic = getProject().wads[musicWad] && getProject().wads[musicWad].music || {};
          const customId = track && track.bankOff != null ? projectMusic[String(track.bankOff)] || '' : '';
          const asset = customId && (getProject().audioAssets || {})[customId];
          const playable = !!(track && track.bankOff != null);
          const preview = '<button type=button data-sound-preview data-sound-music="1" data-sound-wad="' + Viewer.esc(musicWad).replace(/"/g, '&quot;') + '" data-sound-bank-off="' + (track && track.bankOff != null ? track.bankOff : '') + '" data-sound-custom-id="' + Viewer.esc(customId).replace(/"/g, '&quot;') + '" title="Play music preview" aria-label="Play music preview"' + (!playable || (customId && !asset) ? ' disabled' : '') + '>▶</button>';
          const canReplace = !!(track && track.replaceable && track.bankOff != null);
          const reason = track && track.related && track.related.length ? 'replacement disabled: this cue has additional related streams (' + track.related.map(x => x.name).join(', ') + ')' : (!track ? 'cue does not match an AMPC track' : 'replace this cue in ' + musicWad);
          const importer = '<button type=button data-music-import data-music-wad="' + Viewer.esc(musicWad).replace(/"/g, '&quot;') + '" data-music-bank-off="' + (track && track.bankOff != null ? track.bankOff : '') + '" data-music-kind="' + (track && track.kind || 'WAVS') + '"' + (!canReplace ? ' disabled title="' + Viewer.esc(reason).replace(/"/g, '&quot;') + '"' : '') + '>replace music…</button><input type=file accept="audio/*,.wav" data-music-import-file data-music-wad="' + Viewer.esc(musicWad).replace(/"/g, '&quot;') + '" data-music-bank-off="' + (track && track.bankOff != null ? track.bankOff : '') + '" data-music-kind="' + (track && track.kind || 'WAVS') + '" style="display:none">';
          const reset = customId ? ' <button data-music-reset data-music-wad="' + Viewer.esc(musicWad).replace(/"/g, '&quot;') + '" data-music-bank-off="' + track.bankOff + '">reset original</button>' : '';
          const relatedHint = track && track.related && track.related.length ? ' · related AMPC streams: ' + track.related.map(x => x.name).join(', ') + ' (preview plays the primary stream only; replacement disabled)' : '';
          return '<div class=reglink>r' + k + ' <span class=h>↗ AMPC music cue</span> <input type=text data-text-slot="' + d.slot + '" data-text-owner="' + d.owner + '" data-text-kind="' + d.ownerKind + '" value="' + Viewer.esc(current == null ? '' : current).replace(/"/g, '&quot;') + '" data-music-cue-name="1" style="width:220px"> ' + preview + ' ' + importer + reset + '<div class=h>' + Viewer.esc((track && track.bankName ? track.bankName + ' · ' + track.kind : 'cue not resolved to a WAVE/WAVS track') + ' · name must match an AMPC cue; adding a new name also requires an AMPC catalogue entry' + relatedHint) + '</div></div>';
        }
        return '<div class=reglink>r' + k + ' <span class=h>↗ ' + (levelDestination ? 'destination level' : 'string') + '</span> <input type=text data-text-slot="' + d.slot + '" data-text-owner="' + d.owner + '" data-text-kind="' + d.ownerKind + '" value="' + Viewer.esc(current == null ? '' : current).replace(/"/g, '&quot;') + '" style="width:260px">' + (levelDestination ? ' <span class=h>level to load, e.g. 30-01</span>' : '') + (edit !== undefined ? ' <button data-text-reset="' + d.slot + '">reset</button>' : '') + '</div>';
      }
      const role = SI && SI.c && SI.c.roles && SI.c.roles[k] || {}, raw = (H.regs || {})[k] === undefined ? p.v : (H.regs || {})[k];
      if (audioLinks.has(k)) {
        const a = audioLinks.get(k);
        return '<div class=reglink>r' + k + ' ' + soundControl(a.owner, a.slot, a.off, a.kind, 'audio', a.ownerKind) + '</div>';
      }
      if (musicBankLinks.has(k)) {
        const b = musicBankLinks.get(k);
        return '<div class=reglink>r' + k + ' <span class=h>↗ music bank (AMPC)</span><div class=h>' + Viewer.esc(b.name) + '</div></div>';
      }
      if (e.n === 'MusicStart' && k === 0) {
        const value = raw >>> 0;
        if (musicCues && musicCues.cues.length) {
          const found = musicCues.cues.some(c => c.value === value);
          const options = (found ? '' : '<option value="' + value + '" selected>' + value + ' · cue not found</option>')
            + musicCues.cues.map(c => '<option value="' + c.value + '"' + (c.value === value ? ' selected' : '') + '>' + c.value + ' · ' + Viewer.esc(c.name) + '</option>').join('');
          const selectedCue = musicCues.cues.find(c => c.value === value);
          const preview = '<button type=button data-sound-preview data-sound-music="1" data-sound-wad="' + Viewer.esc(musicCues.wad).replace(/"/g, '&quot;') + '" data-sound-bank-off="' + (selectedCue && selectedCue.bankOff != null ? selectedCue.bankOff : '') + '" data-sound-custom-id="' + Viewer.esc(selectedCue && selectedCue.customId || '').replace(/"/g, '&quot;') + '" title="Play selected music cue" aria-label="Play selected music cue"' + ((!selectedCue || selectedCue.bankOff == null) ? ' disabled' : '') + '>▶</button>';
          return '<div>r' + k + ' <select data-music-k="' + k + '">' + options + '</select> ' + preview + ' <span class=h>music cue from ' + Viewer.esc(musicCues.wad) + ' · replace tracks in MusicPlayerBank on ' + Viewer.esc(musicCues.wad) + '</span></div>';
        }
        return '<div>r' + k + ' <input type=number id=ed_r' + k + ' data-k=' + k + ' value=' + value + ' style="width:100px"> <span class=h>music cue index; load ' + Viewer.esc((String(R.w || '').match(/^(\d+)-/) || [,'?'])[1] + '-99.LCS') + ' to resolve cue names</span></div>';
      }
      // These class-specific integer meanings are confirmed by the mission
      // select/boss select instances and the user's in-game register testing.
      if (e.n === 'RanxBlocker' && k === 3) {
        const value = raw >>> 0, labels = BELTS.map((name, v) => '<option value="' + v + '"' + (v === value ? ' selected' : '') + '>' + v + ' · ' + name + ' belt</option>').join('');
        const unknown = value > 4 ? '<option value="' + value + '" selected>' + value + ' · unknown belt</option>' : '';
        return '<div>r' + k + ' <select data-ranx-belt-k="' + k + '">' + unknown + labels + '</select> <span class=h>belt level · 0–4 (yellow to black)</span></div>';
      }
      if (e.n === 'Sensei_MissionSelect' && (k === 3 || k === 6)) {
        const value = raw >>> 0, options = Object.entries(MISSION_TYPES).map(([v, name]) => '<option value="' + v + '"' + (+v === value ? ' selected' : '') + '>' + v + ' · ' + Viewer.esc(name) + '</option>').join('');
        const unknown = MISSION_TYPES[value] ? '' : '<option value="' + value + '" selected>' + value + ' · unknown mission type</option>';
        return '<div>r' + k + ' <select data-mission-type-k="' + k + '">' + unknown + options + '</select> <span class=h>mission replay ' + (k === 3 ? '1' : '2') + ' type</span></div>';
      }
      if (e.n === 'Sensei_MissionSelect' && (k === 4 || k === 7)) {
        const value = raw >>> 0, typeReg = k - 1, missionType = (H.regs || {})[typeReg] === undefined ? e.params[typeReg]?.v : H.regs[typeReg], hint = MISSION_GOAL_HINT[missionType] || 'mission goal value';
        return '<div>r' + k + ' <input type=number id=ed_r' + k + ' data-k=' + k + ' value=' + value + ' style="width:100px"> <span class=h>' + Viewer.esc(hint) + ' · replay ' + (k === 4 ? '1' : '2') + '</span></div>';
      }
      if ((e.n === 'Sensei_MissionSelect' && (k === 5 || k === 8)) || (e.n === 'Sensei_BossSelect' && k === 1)) {
        const value = raw >>> 0, options = BELTS.map((name, i) => { const v = i + 1; return '<option value="' + v + '"' + (v === value ? ' selected' : '') + '>' + v + ' · ' + name + ' belt</option>'; }).join('');
        const unknown = value < 1 || value > 5 ? '<option value="' + value + '" selected>' + value + ' · unknown belt lock</option>' : '';
        const label = e.n === 'Sensei_BossSelect' ? 'boss belt lock' : 'mission replay ' + (k === 5 ? '1' : '2') + ' belt lock';
        return '<div>r' + k + ' <select data-belt-lock-k="' + k + '">' + unknown + options + '</select> <span class=h>' + label + ' · 1–5</span></div>';
      }
      if (e.n === 'Sensei_BossSelect' && k === 0) {
        return '<div>r' + k + ' <input type=number id=ed_r' + k + ' data-k=' + k + ' value=' + (raw >>> 0) + ' style="width:100px"> <span class=h>textbox text ID (numeric lookup; table not resolved)</span></div>';
      }
      if (role.ty === 'f') {
        const value = floatFromBits(raw), shown = Number.isFinite(value) ? +value.toPrecision(7) : 0;
        return '<div>r' + k + ' <input type=number data-float-k="' + k + '" value="' + shown + '" step="0.01" style="width:100px"> <span class=h>' + Viewer.esc(role.note || 'float') + '</span></div>';
      }
      if (role.ty === 'a') {
        const value = angleFromBits(raw), shown = Number.isFinite(value) ? +value.toFixed(3) : 0;
        return '<div>r' + k + ' <input type=number data-angle-k="' + k + '" value="' + shown + '" step="0.1" style="width:100px"> <span class=h>' + Viewer.esc(role.note || 'angle · degrees') + '</span></div>';
      }
      if (role.ty === 'b') {
        return '<div>r' + k + ' <label><input type=checkbox data-bool-k="' + k + '"' + (raw ? ' checked' : '') + '> ' + (raw ? 'true' : 'false') + '</label> <span class=h>' + Viewer.esc(role.note || 'boolean') + '</span></div>';
      }
      const isPointer = !!(ctx && sourceInst && ctx.S.w.rel.has(sourceInst.init + 4 * k));
      let semanticHint = '';
      if (e.n === 'Sensei_MissionSelect' && (k === 1 || k === 9)) semanticHint = 'possible text/string lookup ID · unconfirmed';
      else if (e.n.startsWith('Guardian_') && !/Prompt/i.test(e.n) && !isPointer && role.ty !== 'f' && role.ty !== 'a' && role.ty !== 'b') semanticHint = 'mission goal value · coin count or time target, depending on guardian';
      const note = semanticHint || (role.note && !/^(unused|tested in conditions|reassigned by the script)/i.test(role.note) ? role.note : '');
      const hint = note ? ' <span class=h>' + Viewer.esc(note) + '</span>' : '';
      return '<div>r' + k + ' ' + (p.s ? '<span class=h>"' + Viewer.esc(p.s) + '"</span>' : '<input type=number id=ed_r' + k + ' data-k=' + k + ' value=' + (raw >>> 0) + ' style="width:100px">') + hint + '</div>';
    }).join('');
    S.innerHTML = '<b style="color:' + Viewer.col(e.n) + '">' + Viewer.esc(e.n) + '</b> <span class=h>' + Viewer.sel.L + ' #' + e.i + (e.added ? ' (new, copy of #' + R.add.from.i + ')' : '') + '</span><br>X ' + f('ed_x', e.p[0], .5) + ' Y ' + f('ed_y', e.p[1], .5) + ' Z ' + f('ed_z', e.p[2], .5) + '<br>yaw ' + f('ed_w', +(e.r / 4096 * 360).toFixed(1), 5) + '&deg;<br>pitch ' + f('ed_pt', +(((R.add || R.m).dp || 0) / 4096 * 360).toFixed(1), 5) + '&deg; roll ' + f('ed_rl', +(((R.add || R.m).dr || 0) / 4096 * 360).toFixed(1), 5) + '&deg; <span class=h>(change from original)</span><br>step <input type=number id=ed_st value=' + (S.dataset.st || 1) + ' style="width:48px"><br>'
      + ['-X', '+X', '-Y', '+Y', '-Z', '+Z'].map(t => '<button data-n="' + t + '">' + t + '</button>').join('') + ' <button data-n="L">&#8634;15</button><button data-n="R">&#8635;15</button><br><button id=ed_cp>copy</button> <button id=ed_ps>paste</button> ' + '<button id=ed_del>' + (e.added ? 'delete' : 'remove') + '</button>'
      + '<div class=h>hold G + move mouse to drag on the ground plane; Ctrl+C / Ctrl+V copy and paste at the cursor</div>'
      + (e.params.length ? '<details' + (regOpen || linkPick ? ' open' : '') + '><summary>registers</summary>' + regHtml + '<div class=h>Pointer-backed strings, dialogue/audio tables, sound links with play/pause previews, and music-bank resources are shown as linked data. Float, fixed-point angle, boolean, music-cue, mission-type, belt-lock, and RanxBlocker belt registers use typed controls; other numeric registers remain raw values with script-use hints where available. Linked object registers have a link... button: press it, then click the object to link to (same level; Esc cancels).</div></details>' : '');

    triggerEditor.render(S, Viewer.sel, R);
    pathEditor.render(S, Viewer.sel, R);
    const g = id => +Viewer.$(id).value;
    for (const id of ['ed_x', 'ed_y', 'ed_z']) Viewer.$(id).onchange = () => setPos(R, [g('ed_x'), g('ed_y'), g('ed_z')]);
    Viewer.$('ed_w').onchange = () => setYaw(R, g('ed_w'));
    Viewer.$('ed_pt').onchange = () => setTilt(R, 'dp', g('ed_pt'));
    Viewer.$('ed_rl').onchange = () => setTilt(R, 'dr', g('ed_rl'));
    Viewer.$('ed_st').onchange = () => { S.dataset.st = g('ed_st'); };
    S.querySelectorAll('button[data-n]').forEach(b => {
      const t = b.dataset.n;
      if (t === 'L') { bindRotateStep(b, R, -15); return; }
      if (t === 'R') { bindRotateStep(b, R, 15); return; }
      b.onclick = () => {
        const s = +Viewer.$('ed_st').value || 1, ax = { X: 0, Y: 1, Z: 2 }[t[1]], v = [0, 0, 0];
        v[ax] = t[0] == '-' ? -s : s;
        nudge(...v);
      };
    });
    S.querySelectorAll('input[data-k]').forEach(i => i.onchange = () => setReg(R, +i.dataset.k, +i.value));
    S.querySelectorAll('input[data-wave-count-k]').forEach(i => i.onchange = () => setReg(R, +i.dataset.waveCountK, Math.max(0, Math.floor(Number(i.value) || 0))));
    S.querySelectorAll('input[data-float-k]').forEach(i => i.onchange = () => setReg(R, +i.dataset.floatK, floatToBits(+i.value)));
    S.querySelectorAll('input[data-angle-k]').forEach(i => i.onchange = () => setReg(R, +i.dataset.angleK, angleToBits(i.value)));
    S.querySelectorAll('input[data-bool-k]').forEach(i => i.onchange = () => setReg(R, +i.dataset.boolK, i.checked ? 1 : 0));
    S.querySelectorAll('select[data-music-k]').forEach(i => i.onchange = () => setReg(R, +i.dataset.musicK, +i.value));
    S.querySelectorAll('select[data-mission-type-k]').forEach(i => i.onchange = () => setReg(R, +i.dataset.missionTypeK, +i.value));
    S.querySelectorAll('select[data-belt-lock-k]').forEach(i => i.onchange = () => setReg(R, +i.dataset.beltLockK, +i.value));
    S.querySelectorAll('select[data-ranx-belt-k]').forEach(i => i.onchange = () => setReg(R, +i.dataset.ranxBeltK, +i.value));
    S.querySelectorAll('[data-text-slot]').forEach(i => { const commit = () => { setText(R, +i.dataset.textOwner, +i.dataset.textSlot, i.value, i.dataset.textKind || 'data'); if (i.dataset.musicCueName === '1') update(); }; i.onchange = commit; });
    S.querySelectorAll('select[data-sound-slot]').forEach(i => i.onchange = () => {
      const option = Array.from(i.options || []).find(o => String(o.value) === String(i.value));
      const row = i.parentNode, button = row && row.querySelector ? row.querySelector('button[data-sound-preview]') : null;
      if (button) {
        if (previewAudio.button === button) stopPreview();
        const isCustom = String(i.value).startsWith('custom:');
        button.dataset.soundCustomId = isCustom ? String(i.value).slice(7) : '';
        const off = option && option.dataset ? option.dataset.bankOff : '';
        button.dataset.soundBankOff = isCustom ? '' : (off || '');
        button.disabled = isCustom ? !((getProject().audioAssets || {})[button.dataset.soundCustomId]) : !off;
        setPreviewButton(button, 'stopped');
      }
      if (String(i.value).startsWith('custom:')) setCustomSound(R, +i.dataset.soundOwner, +i.dataset.soundSlot, String(i.value).slice(7), i.dataset.soundOwnerKind || 'data');
      else setSound(R, +i.dataset.soundOwner, +i.dataset.soundSlot, +i.value, i.dataset.soundOwnerKind || 'data');
    });
    S.querySelectorAll('button[data-sound-preview]').forEach(b => b.onclick = () => togglePreview(b));
    S.querySelectorAll('button[data-sound-import]').forEach(b => b.onclick = () => {
      const input = b.parentNode && b.parentNode.querySelector ? b.parentNode.querySelector('input[data-sound-import-file]') : null;
      if (input) input.click();
    });
    S.querySelectorAll('input[data-sound-import-file]').forEach(input => input.onchange = async () => {
      const file = input.files && input.files[0]; if (!file) return;
      try {
        const asset = await importCustomAudio(file, input.dataset.soundKind || 'WAVE');
        const project = getProject(); project.audioAssets = project.audioAssets || {}; project.audioAssets[asset.id] = asset;
        setCustomSound(R, +input.dataset.soundOwner, +input.dataset.soundSlot, asset.id, input.dataset.soundOwnerKind || 'data');
        update();
        if (Viewer.$('ed_sum')) Viewer.$('ed_sum').textContent = 'imported ' + asset.name + ' as ' + asset.kind + ' · ' + asset.sampleRate + ' Hz · ' + asset.channels + ' channel(s) · ' + (asset.samples / asset.sampleRate).toFixed(2) + ' s. Save the project to keep the imported sound.';
      } catch (error) {
        if (Viewer.$('ed_sum')) Viewer.$('ed_sum').textContent = 'audio import failed: ' + (error && error.message || error);
      } finally { input.value = ''; }
    });
    S.querySelectorAll('button[data-music-import]').forEach(b => b.onclick = () => {
      const input = b.parentNode && b.parentNode.querySelector ? b.parentNode.querySelector('input[data-music-import-file]') : null;
      if (input && !b.disabled) input.click();
    });
    S.querySelectorAll('input[data-music-import-file]').forEach(input => input.onchange = async () => {
      const file = input.files && input.files[0]; if (!file) return;
      try {
        const asset = await importCustomAudio(file, input.dataset.musicKind || 'WAVS', { music: true });
        const project = getProject(); project.audioAssets = project.audioAssets || {}; project.audioAssets[asset.id] = asset;
        const target = WS(input.dataset.musicWad); target.music = target.music || {}; target.music[String(+input.dataset.musicBankOff)] = asset.id;
        update();
        if (Viewer.$('ed_sum')) Viewer.$('ed_sum').textContent = 'imported ' + asset.name + ' as ' + asset.kind + ' music · ' + asset.sampleRate + ' Hz · ' + asset.channels + ' channel(s) · ' + (asset.samples / asset.sampleRate).toFixed(2) + ' s. Rebuild ' + input.dataset.musicWad + ' with its paired .avl; cue names and existing MusicStart IDs remain unchanged.';
      } catch (error) {
        if (Viewer.$('ed_sum')) Viewer.$('ed_sum').textContent = 'music import failed: ' + (error && error.message || error);
      } finally { input.value = ''; }
    });
    S.querySelectorAll('button[data-music-reset]').forEach(b => b.onclick = () => {
      const target = WS(b.dataset.musicWad); if (target.music) delete target.music[String(+b.dataset.musicBankOff)];
      update();
      if (Viewer.$('ed_sum')) Viewer.$('ed_sum').textContent = 'restored the original music stream for ' + b.dataset.musicWad + '; rebuild the level and paired .avl to apply it.';
    });
    S.querySelectorAll('button[data-text-reset]').forEach(b => b.onclick = () => resetText(R, +b.dataset.textReset));
    S.querySelectorAll('button[data-sound-reset]').forEach(b => b.onclick = () => resetSound(R, +b.dataset.soundReset));
    S.querySelectorAll('button[data-lk]').forEach(b => b.onclick = () => startLink(+b.dataset.lk));
    S.querySelectorAll('button[data-lkr]').forEach(b => b.onclick = () => resetLink(R, +b.dataset.lkr));
    const dt = S.querySelector('details');
    if (dt) dt.ontoggle = () => { regOpen = dt.open; };
    Viewer.$('ed_cp').onclick = copy;
    Viewer.$('ed_ps').onclick = () => paste();
    const dl = Viewer.$('ed_del');
    if (dl) dl.onclick = () => {
      if (R.custom) {
        const C = getProject().customModels && getProject().customModels[R.w];
        if (C && Array.isArray(C.instances)) C.instances = C.instances.filter(x => x && x.id !== R.custom.id);
        Viewer.sel = null; Viewer.refresh(); Viewer.inspect(null); update(); return;
      }
      const P = WS(R.w);
      if (R.e.added) {
        const rid = R.add && R.add.id;
        P.adds.splice(R.e.added - 1, 1);
        if (rid !== undefined) for (const x of [...P.adds, ...Object.values(P.mods)]) if (x.lk) x.lk = x.lk.filter(l => l[1] !== rid);
      } else {
        const g = getWad(R.w), rf = g ? EC.referrers(g.A, g.B, R.e.i).filter(o => !P.del.includes(o)) : [];
        // Include project-added optional links (not yet present in the source
        // LCS link table) in the deletion guard so a linked enemy cannot be
        // removed while an EnemyGenerator still points at it.
        const manualRefs = [];
        for (const [owner, edit] of Object.entries(P.mods || {})) {
          if (+owner === R.e.i || P.del.includes(+owner)) continue;
          for (const rg of edit.linkRegs || []) if ((edit.regs || {})[rg] === R.e.i) manualRefs.push('#' + owner + ' r' + rg);
        }
        for (let ai = 0; ai < (P.adds || []).length; ai++) {
          const add = P.adds[ai];
          for (const rg of add.linkRegs || []) if ((add.regs || {})[rg] === R.e.i) manualRefs.push('added #' + (add.id ?? ai + 1) + ' r' + rg);
        }
        if (rf.length || manualRefs.length) {
          Viewer.$('ed_sum').textContent = 'cannot remove #' + R.e.i + ': ' + rf.map(o => '#' + o).concat(manualRefs).join(', ') + ' link to it. Remove or change those first.';
          return;
        }
        P.del.push(R.e.i);
        delete P.mods[R.e.i];
      }
      Viewer.sel = null;
      Viewer.inspect(null);
      Viewer.refresh();
    };
  }

  // ---- manual link reassignment
  function startLink(k) {
    const R = Viewer.sel && rec(Viewer.sel);
    if (!R) return;
    linkPick = { L: Viewer.sel.L, i: R.e.i, k };
    Viewer.cv.style.cursor = 'crosshair';
    update();
    Viewer.$('ed_sum').textContent = 'r' + k + ' of ' + R.e.n + ' #' + R.e.i + ': click the object to link to (same level, Esc cancels)';
  }
  function endPick(msg) {
    linkPick = null;
    Viewer.cv.style.cursor = '';
    update();
    if (msg) Viewer.$('ed_sum').textContent = msg;
  }
  function finishLink(q) {
    const lp = linkPick;
    if (!lp) return;
    if (q.L !== lp.L) {
      Viewer.$('ed_sum').textContent = 'the target has to be in the same level (' + lp.L + '): click again, or Esc to cancel';
      return;
    }
    const src = Viewer.all.find(o => o.L === lp.L && o.i === lp.i), R = src && rec(src);
    if (!R) { endPick(); return; }
    const H = R.add || R.m, te = ent(q);
    H.lk = (H.lk || []).filter(l => l[0] !== lp.k);
    H.linkRegs = (H.linkRegs || []).filter(r => +r !== lp.k);
    if (te && te.added) {
      const T = WS(wadOf(q.L)).adds[te.added - 1];
      if (T.id === undefined) T.id = addMaxId() + 1;
      H.lk.push([lp.k, T.id]);
      delete H.regs[lp.k];
    } else {
      H.regs[lp.k] = q.i >>> 0;
      if (/^EnemyGenerators?$/i.test(R.e.n) && lp.k >= 1 && lp.k <= 20) H.linkRegs.push(lp.k);
    }
    const nm = q.n;
    linkPick = null;
    Viewer.cv.style.cursor = '';
    afterLink(lp.L, R.e.i);
    Viewer.$('ed_sum').textContent = 'r' + lp.k + ' of ' + R.e.n + ' #' + R.e.i + ' now links to #' + q.i + ' ' + nm;
  }
  function resetLink(R, k) {
    const H = R.add || R.m;
    H.lk = (H.lk || []).filter(l => l[0] !== k);
    H.linkRegs = (H.linkRegs || []).filter(r => +r !== k);
    delete H.regs[k];
    afterLink(Viewer.sel.L, R.e.i);
  }
  function afterLink(L, i) {
    Viewer.refresh();
    Viewer.sel = Viewer.all.find(o => o.L === L && o.i === i) || null;
    Viewer.inspect(Viewer.sel);
    update();
    Viewer.need = true;
  }

  const previousMouseUp = globalThis.onmouseup;
  globalThis.onmouseup = e => {
    if (linkPick && Viewer.mdown && Viewer.mdown.b == 0 && Math.hypot(e.clientX - Viewer.mdown.x, e.clientY - Viewer.mdown.y) < 4 && e.target === Viewer.cv) {
      const q = Viewer.nearest(e.clientX, e.clientY);
      Viewer.mdown = null;
      Viewer.drag = null;
      if (q) finishLink(q);
      return;
    }
    if (typeof previousMouseUp === 'function') previousMouseUp(e);
  };
  globalThis.addEventListener('keydown', e => { if (e.code === 'Escape' && linkPick) endPick('link pick cancelled'); });

  function copy() {
    if (!Viewer.sel) return;
    const R = rec(Viewer.sel);
    if (!R) return;
    if (R.custom) {
      clip = { customModel: true, fromWad: R.w, instance: { ...R.custom, position: (R.custom.position || [0, 0, 0]).slice(), rotation: (R.custom.rotation || [0, 0, 0]).slice(), scale: (R.custom.scale || [1, 1, 1]).slice() } };
      Viewer.$('ed_sum').textContent = 'copied custom model placement ' + (R.custom.name || R.custom.assetId);
      return;
    }
    const H = R.add || R.m;
    const cloneEdits = edits => Object.fromEntries(Object.entries(edits || {}).map(([k, v]) => [k, v && typeof v === 'object' ? { ...v } : v]));
    clip = R.add
      ? { from: { ...R.add.from }, dy: R.add.dy || 0, dp: R.add.dp || 0, dr: R.add.dr || 0, regs: { ...R.add.regs }, linkRegs: (R.add.linkRegs || []).slice(), texts: cloneEdits(R.add.texts), sounds: cloneEdits(R.add.sounds), trigger: R.add.trigger && { ty: R.add.trigger.ty, box: R.add.trigger.box.slice(), poly: R.add.trigger.poly && R.add.trigger.poly.slice() }, path: R.add.path && R.add.path.map(n => n.slice()), pathMap: R.add.pathMap && R.add.pathMap.slice() }
      : { from: { w: R.w, i: R.e.i }, dy: R.m.dy || 0, dp: R.m.dp || 0, dr: R.m.dr || 0, regs: { ...R.m.regs }, linkRegs: (R.m.linkRegs || []).slice(), texts: cloneEdits(R.m.texts), sounds: cloneEdits(R.m.sounds), trigger: R.m.trigger && { ty: R.m.trigger.ty, box: R.m.trigger.box.slice(), poly: R.m.trigger.poly && R.m.trigger.poly.slice() }, path: R.m.path && R.m.path.map(n => n.slice()), pathMap: R.m.pathMap && R.m.pathMap.slice() };
    clip.lk = (H.lk || []).map(l => l.slice());
    clip.at = R.w;
    pruneUnusedAudioAssets();
    Viewer.$('ed_sum').textContent = 'copied ' + R.e.n;
  }
  function ground(mx, my, y) {
    const v = new Viewer.V3(mx / globalThis.innerWidth * 2 - 1, -(my / globalThis.innerHeight) * 2 + 1, .5)
      .unproject(Viewer.camera).sub(Viewer.camera.position).normalize();
    if (Math.abs(v.y) < 1e-3) return null;
    const t = (y - Viewer.camera.position.y) / v.y;
    if (t < 0 || t > 5000) return null;
    return Viewer.ggame(Viewer.camera.position.clone().addScaledVector(v, t));
  }
  function paste(at) {
    if (!clip || !Viewer.sel) return;
    const w = wadOf(Viewer.sel.L);
    if (clip.customModel) {
      try {
        if (!w) throw 'select a loaded target level first';
        const source = getProject().customModels && getProject().customModels[clip.fromWad];
        const sourceAsset = source && (source.assets || []).find(a => a && a.id === clip.instance.assetId);
        if (!sourceAsset) throw 'the copied custom model asset is no longer available';
        getProject().customModels = getProject().customModels || {};
        const dest = getProject().customModels[w] || (getProject().customModels[w] = { assets: [], instances: [] });
        dest.assets = Array.isArray(dest.assets) ? dest.assets : []; dest.instances = Array.isArray(dest.instances) ? dest.instances : [];
        if (!dest.assets.some(a => a.id === sourceAsset.id)) dest.assets.push({ ...sourceAsset });
        const origin = Viewer.sel.p || clip.instance.position || [0, 0, 0];
        const position = (at || ground(mouse.x, mouse.y, origin[1]) || [origin[0] + 3, origin[1], origin[2] + 3]).map(r3);
        let id; do { id = 'cmi_paste_' + Date.now().toString(36) + '_' + (++customPasteSeq).toString(36); } while (dest.instances.some(x => x.id === id));
        const inst = { ...clip.instance, id, position, rotation: (clip.instance.rotation || [0, 0, 0]).slice(), scale: (clip.instance.scale || [1, 1, 1]).slice(), name: (clip.instance.name || 'Custom model') + ' copy' };
        dest.instances.push(inst); Viewer.refresh();
        Viewer.sel = Viewer.all.find(o => o.customModel && o.customModelId === id) || null;
        Viewer.inspect(Viewer.sel); update(); Viewer.need = true;
        Viewer.$('ed_sum').textContent = 'pasted custom model ' + inst.name + ' at ' + position.map(v => v.toFixed(1)).join(', ');
      } catch (error) { Viewer.$('ed_sum').textContent = 'cannot paste custom model: ' + (error && error.message || error); }
      return;
    }
    const p = at || (() => {
      const sp = Viewer.sel.p, g = ground(mouse.x, mouse.y, Viewer.sel.p[1]);
      return g || [sp[0] + 3, sp[1], sp[2] + 3];
    })();
    const cloneEdits = edits => Object.fromEntries(Object.entries(edits || {}).map(([k, v]) => [k, v && typeof v === 'object' ? { ...v } : v]));
    const a = { from: { ...clip.from }, p: p.map(r3), dy: clip.dy, dp: clip.dp || 0, dr: clip.dr || 0, regs: { ...clip.regs }, linkRegs: (clip.linkRegs || []).slice(), texts: cloneEdits(clip.texts), sounds: cloneEdits(clip.sounds), trigger: clip.trigger && { ty: clip.trigger.ty, box: clip.trigger.box.slice(), poly: clip.trigger.poly && clip.trigger.poly.slice() }, path: clip.path && clip.path.map(n => n.slice()), pathMap: clip.pathMap && clip.pathMap.slice() };
    if (clip.at === w && ((clip.lk && clip.lk.length) || (clip.linkRegs && clip.linkRegs.length))) {
      if (clip.lk && clip.lk.length) a.lk = clip.lk.map(l => l.slice());
    } else stripLinkRegs(a);
    // Cross-level clones require the source class and its dependencies in the target level.
    try {
      const t = getWad(w), s = getWad(clip.from.w);
      if (clip.from.w.replace(/\.LCS$/i, '') !== w.replace(/\.LCS$/i, '')) {
        const n = srcEnt(a).n, why = ensureClass(w, clip.from.w, n);
        if (why) throw n + ' cannot be copied into ' + w + ': ' + why;
        const bad = EC.prefabCheck(s.A, s.B, a.from.i);
        if (bad) throw bad;
      }
    } catch (x) {
      Viewer.$('ed_sum').textContent = 'cannot paste: ' + x;
      return;
    }
    const pi = pushAdds(w, a);
    Viewer.refresh();
    const L = w.replace(/\.LCS$/i, ''), lv = Viewer.D.find(l => l.id === L);
    Viewer.sel = Viewer.all.find(o => o.L === L && o.i === lv.nb + pi);
    Viewer.inspect(Viewer.sel);
    update();
    Viewer.need = true;
  }

  globalThis.addEventListener('keydown', e => {
    const t = e.target && e.target.tagName;
    if (t === 'INPUT' || t === 'SELECT') return;
    if (e.code === 'KeyG') grab = true;
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyC') { copy(); e.preventDefault(); }
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyV') { paste(); e.preventDefault(); }
  });
  globalThis.addEventListener('keyup', e => { if (e.code === 'KeyG') grab = false; });
  globalThis.addEventListener('pagehide', releasePreviewResources, { once: true });
  Viewer.cv.addEventListener('mousemove', e => {
    mouse = { x: e.clientX, y: e.clientY };
    if (grab && Viewer.sel && !Viewer.drag) {
      const R = rec(Viewer.sel), g = R && ground(e.clientX, e.clientY, Viewer.sel.p[1]);
      if (g) setPos(R, [g[0], Viewer.sel.p[1], g[2]]);
    }
  });

  return {
    update,
    ent,
    rec,
    setPosition: (q, p) => { const R = rec(q); if (R) setPos(R, p); },
    setYaw: (q, deg) => { const R = rec(q); if (R) setYaw(R, deg); },
    setRegister: (q, k, v) => { const R = rec(q); if (R) setReg(R, k, v); },
    setTrigger: (q, trigger) => { const R = rec(q); if (R) setTrigger(R, trigger); },
    setPath: (q, path, pathMap) => { const R = rec(q); if (R) setPath(R, path, pathMap); },
    copy,
    paste,
    ground,
    cancelLinkPick: () => { if (linkPick) endPick('link pick cancelled'); }
  };
}
