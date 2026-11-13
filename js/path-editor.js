// Waypoint path inspector and direct 3D node editing.
// Path positions are shown in world coordinates but stored project-relative to
// the owning entity, so moving a prefab instance carries its edited path with it.

const r3 = n => Math.round(Number(n) * 1000) / 1000;
const clonePath = path => Array.isArray(path) ? path.map(p => p.slice(0, 3).map(Number)) : null;

export function normalizePath(path) {
  if (!Array.isArray(path) || path.length < 1 || path.length > 64
    || path.some(p => !Array.isArray(p) || p.length < 3 || !p.slice(0, 3).every(Number.isFinite))) {
    throw new Error('Waypoint path must contain 1 to 64 finite XYZ nodes');
  }
  return path.map(p => p.slice(0, 3).map(r3));
}

export function movePathNode(path, index, axis, value) {
  const next = normalizePath(path);
  if (!Number.isInteger(index) || index < 0 || index >= next.length
    || !Number.isInteger(axis) || axis < 0 || axis > 2 || !Number.isFinite(value)) {
    throw new Error('Invalid waypoint node edit');
  }
  next[index][axis] = r3(value);
  return next;
}

export function installPathEditor({ Viewer, commit, setOverlayRender = () => {} }) {
  let current = null;
  let drag = null;
  let handles = [];
  let detailsOpen = true;
  let focusNode = 0;

  function render(container, q, R) {
    current = q && R && Array.isArray(R.e.path) && R.e.path.length
      ? { q, R } : null;
    handles = [];
    if (!current) {
      Viewer.need = true;
      return;
    }
    const path = normalizePath(R.e.path);
    const H = R.add || R.m || {};
    const rows = path.map((p, i) =>
      `<div class="ed-path-node" data-path-row="${i}" style="margin:4px 0;padding:3px;border-top:1px solid #333">` +
      `<b>Node ${i + 1}</b> <span class="h">#${i}</span><br>` +
      `X <input type="number" data-path-node="${i}" data-path-axis="0" value="${p[0].toFixed(2)}" step="0.5" style="width:64px"> ` +
      `Y <input type="number" data-path-node="${i}" data-path-axis="1" value="${p[1].toFixed(2)}" step="0.5" style="width:64px"> ` +
      `Z <input type="number" data-path-node="${i}" data-path-axis="2" value="${p[2].toFixed(2)}" step="0.5" style="width:64px"></div>`
    ).join('');
    container.insertAdjacentHTML('beforeend',
      `<details id="ed_path" ${detailsOpen ? 'open' : ''} style="margin-top:6px;border-top:1px solid #444;padding-top:4px">` +
      `<summary style="cursor:pointer;color:#fc6">Waypoint path · ${path.length} node${path.length === 1 ? '' : 's'}</summary>` +
      `<div class="h" style="margin:3px 0">Drag a coloured axis handle on a waypoint to move it in 3D. Or enter exact world coordinates below. Node order and links are preserved.</div>` +
      `<div class="h">X = red · Y = green · Z = blue</div>` +
      `<div style="margin-top:4px">${rows}</div>` +
      `<div style="margin-top:4px"><button id="ed_path_reset" ${H.path ? '' : 'disabled'}>reset path</button> <span class="h">${H.path ? 'project override active' : 'original game path'}</span></div>` +
      `</details>`);
    const detail = container.querySelector('#ed_path');
    if (detail) detail.ontoggle = () => { detailsOpen = detail.open; };
    for (const input of container.querySelectorAll('[data-path-node][data-path-axis]')) {
      input.onfocus = () => { focusNode = Number(input.dataset.pathNode); Viewer.need = true; };
      input.onchange = () => {
        const next = clonePath(path);
        const i = Number(input.dataset.pathNode), axis = Number(input.dataset.pathAxis), value = Number(input.value);
        if (!Number.isFinite(value) || !next[i]) return;
        next[i][axis] = r3(value);
        focusNode = i;
        commit(q, next);
      };
    }
    const reset = container.querySelector('#ed_path_reset');
    if (reset) reset.onclick = () => commit(q, null);
    Viewer.need = true;
  }

  function projectNode(project, p) {
    const s = project(p);
    return s && Number.isFinite(s.x) && Number.isFinite(s.y) ? s : null;
  }

  function overlay({ ctx, project, selected }) {
    if (!current || !selected || selected.L !== current.q.L || selected.i !== current.q.i) return;
    const path = drag && drag.q.L === selected.L && drag.q.i === selected.i
      ? drag.positions : normalizePath(current.R.e.path);
    handles = [];
    const projected = path.map(p => projectNode(project, p));
    ctx.save?.();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#65d6ff';
    ctx.beginPath();
    let started = false;
    for (const s of projected) {
      if (!s || s.z < -1 || s.z > 1) { started = false; continue; }
      if (!started) { ctx.moveTo(s.x, s.y); started = true; }
      else ctx.lineTo(s.x, s.y);
    }
    ctx.stroke();

    const colors = ['#ff6868', '#70e090', '#65aaff'];
    for (let i = 0; i < path.length; i++) {
      const p = path[i], s = projected[i];
      if (!s || s.z < -1 || s.z > 1) continue;
      const radius = i === focusNode ? 7 : 5.5;
      ctx.fillStyle = i === focusNode ? '#fff0a8' : '#10202b';
      ctx.strokeStyle = '#65d6ff';
      ctx.beginPath();
      ctx.arc(s.x, s.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.font = '10px sans-serif';
      ctx.fillText(String(i + 1), s.x + 8, s.y - 7);

      for (let axis = 0; axis < 3; axis++) {
        const unit = p.slice();
        unit[axis] += 1;
        const s1 = projectNode(project, unit);
        if (!s1) continue;
        const px = s1.x - s.x, py = s1.y - s.y;
        const denom = px * px + py * py;
        // Near a view-aligned axis the projected direction collapses and is
        // not safely draggable; the numeric coordinate remains available.
        if (!Number.isFinite(denom) || denom < 0.02) continue;
        const scale = 15 / Math.sqrt(denom);
        const end = projectNode(project, p.map((v, k) => v + (k === axis ? scale : 0)));
        if (!end || end.z < -1 || end.z > 1) continue;
        ctx.strokeStyle = colors[axis];
        ctx.fillStyle = colors[axis];
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(end.x, end.y);
        ctx.stroke();
        ctx.fillRect(end.x - 4, end.y - 4, 8, 8);
        handles.push({ index: i, axis, x: end.x, y: end.y, px, py, denom, start: p[axis] });
      }
    }
    ctx.restore?.();
  }

  function onMouseDown(e) {
    if (e.button !== 0 || !current || !Viewer.sel
      || Viewer.sel.L !== current.q.L || Viewer.sel.i !== current.q.i) return;
    let hit = null, distance = 10;
    for (const h of handles) {
      const d = Math.hypot(e.clientX - h.x, e.clientY - h.y);
      if (d < distance) { hit = h; distance = d; }
    }
    if (!hit) return;
    drag = {
      q: current.q, R: current.R, positions: normalizePath(current.R.e.path),
      index: hit.index, axis: hit.axis, start: hit.start,
      startX: e.clientX, startY: e.clientY,
      px: hit.px, py: hit.py, denom: hit.denom
    };
    Viewer.drag = null;
    Viewer.mdown = null;
    Viewer.cv.style.cursor = 'grabbing';
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  function onMouseMove(e) {
    if (!drag) return;
    const dx = e.clientX - drag.startX, dy = e.clientY - drag.startY;
    const delta = (dx * drag.px + dy * drag.py) / drag.denom;
    drag.positions[drag.index][drag.axis] = r3(drag.start + delta);
    Viewer.need = true;
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  function onMouseUp(e) {
    if (!drag) return;
    const done = drag;
    drag = null;
    Viewer.cv.style.cursor = '';
    focusNode = done.index;
    commit(done.q, done.positions);
    Viewer.need = true;
    e.preventDefault?.();
    e.stopImmediatePropagation?.();
  }

  Viewer.cv.addEventListener('mousedown', onMouseDown, true);
  globalThis.addEventListener('mousemove', onMouseMove, true);
  globalThis.addEventListener('mouseup', onMouseUp, true);
  setOverlayRender(overlay);

  return {
    render,
    cancelDrag: () => { drag = null; Viewer.cv.style.cursor = ''; },
  };
}
