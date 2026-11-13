// Trigger-shape inspector and viewport resize handles.
// Geometry is stored project-relative to the owning entity, then serialized by editor-core.

const TYPES = [
  [0, 'Box (XZ only)'],
  [1, 'Box (3D)'],
  [2, 'Infinite cylinder'],
  [3, 'Cylinder (3D)'],
  [4, 'Sphere'],
  [5, 'Polygon (XZ only)'],
  [6, 'Polygon (3D)'],
];
const POLYGON_TYPES = new Set([5, 6]);
const Y_IGNORED_TYPES = new Set([0, 2, 5]);
const r3 = n => Math.round(Number(n) * 1000) / 1000;
const cloneTrigger = t => t && ({
  ty: t.ty,
  box: t.box.slice(),
  poly: t.poly ? t.poly.slice() : null,
});

export function normalizeTriggerBounds(box, ty, resizeAxis = null) {
  const b = box.slice(0, 6).map(Number);
  if (b.length !== 6 || !b.every(Number.isFinite)) throw new Error('Trigger bounds must contain six finite numbers');
  for (let k = 0; k < 3; k++) if (b[k + 3] - b[k] < 0.1) b[k + 3] = b[k] + 0.1;
  const center = [0, 1, 2].map(k => (b[k] + b[k + 3]) / 2);
  let size = [0, 1, 2].map(k => b[k + 3] - b[k]);
  if (ty === 2 || ty === 3) {
    // A circular trigger has one horizontal diameter. During a drag, use the
    // face being manipulated as the controlling diameter; taking max(X, Z)
    // made an inward drag lose to the untouched axis and only shift the centre.
    const diameter = resizeAxis === 0 || resizeAxis === 2
      ? size[resizeAxis]
      : Math.max(size[0], size[2]);
    size[0] = size[2] = Math.max(diameter, 0.1);
  }
  if (ty === 4) size.fill(Math.max(...size, 0.1));
  for (let k = 0; k < 3; k++) {
    b[k] = center[k] - size[k] / 2;
    b[k + 3] = center[k] + size[k] / 2;
  }
  return b.map(r3);
}

export function scaleTriggerPolygon(poly, oldBox, newBox) {
  if (!poly || poly.length < 9 || poly.length % 3) return null;
  const out = [];
  for (let i = 0; i < poly.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const oldSize = oldBox[k + 3] - oldBox[k];
      const t = Math.abs(oldSize) > 1e-6 ? (poly[i + k] - oldBox[k]) / oldSize : 0.5;
      out.push(r3(newBox[k] + t * (newBox[k + 3] - newBox[k])));
    }
  }
  return out;
}

function rectanglePolygon(box) {
  const [x0, y0, z0, x1, y1, z1] = box;
  // Polygon types use an XZ footprint; Y remains the footprint's centre and
  // the trigger's own Y bounds define its vertical extent.
  const y = (y0 + y1) / 2;
  return [x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1].map(r3);
}

function fromEntity(e, R) {
  const H = R.add || R.m;
  if (H.trigger) return cloneTrigger(H.trigger);
  if (!e.b) return null;
  const ty = Number.isInteger(e.shape) ? e.shape : 1;
  return {
    ty,
    box: e.b.map((v, k) => r3(v - e.p[k % 3])),
    poly: e.poly ? e.poly.map((v, k) => r3(v - e.p[k % 3])) : null,
  };
}

function centreAndSize(box) {
  return {
    offset: [0, 1, 2].map(k => r3((box[k] + box[k + 3]) / 2)),
    size: [0, 1, 2].map(k => r3(box[k + 3] - box[k])),
  };
}

function makeBox(offset, size, oldBox, ty, resizeAxis = null) {
  const nextSize = size.map(v => Math.max(0.1, Math.abs(Number(v) || 0.1)));
  if (ty === 2 || ty === 3) {
    const diameter = resizeAxis === 0 || resizeAxis === 2
      ? nextSize[resizeAxis]
      : Math.max(nextSize[0], nextSize[2]);
    nextSize[0] = nextSize[2] = diameter;
  }
  if (ty === 4) nextSize.fill(Math.max(...nextSize));
  if (Y_IGNORED_TYPES.has(ty)) {
    const c = (oldBox[1] + oldBox[4]) / 2, h = oldBox[4] - oldBox[1];
    offset[1] = c;
    nextSize[1] = h;
  }
  return [0, 1, 2].map(k => r3(offset[k] - nextSize[k] / 2))
    .concat([0, 1, 2].map(k => r3(offset[k] + nextSize[k] / 2)));
}

function faceDescriptors(box, ty) {
  const c = [0, 1, 2].map(k => (box[k] + box[k + 3]) / 2);
  const out = [];
  for (let axis = 0; axis < 3; axis++) {
    if (Y_IGNORED_TYPES.has(ty) && axis === 1) continue;
    for (const positive of [false, true]) {
      const p = c.slice();
      p[axis] = box[axis + (positive ? 3 : 0)];
      out.push({ axis, positive, p, valueIndex: axis + (positive ? 3 : 0) });
    }
  }
  return out;
}

export function installTriggerEditor({ Viewer, commit, setOverlayRender = () => {} }) {
  let current = null;
  let drag = null;
  let handles = [];
  let detailsOpen = true;

  function render(container, q, R) {
    current = q && R ? { q, R } : null;
    handles = [];
    if (!q || !R || !R.e.b) {
      Viewer.need = true;
      return;
    }
    const e = R.e;
    if (e.pathbox) {
      current = null;
      container.insertAdjacentHTML('beforeend',
        '<details id=ed_trigger open style="margin-top:6px;border-top:1px solid #444;padding-top:4px">' +
        '<summary style="cursor:pointer;color:#fc6">Trigger shape · waypoint-defined box</summary>' +
        '<div class="h" style="margin:3px 0">This NextArea trigger is derived from its linked path nodes rather than a shape record. Direct trigger resizing is not enabled for this special case yet, to avoid changing only the preview while leaving the game logic unchanged.</div></details>');
      Viewer.need = true;
      return;
    }
    const t = fromEntity(e, R), cs = centreAndSize(t.box);
    const h = (id, value, step = 0.5, disabled = false) => `<input type="number" id="${id}" value="${Number(value).toFixed(2)}" step="${step}" ${disabled ? 'disabled' : ''} style="width:64px">`;
    const options = TYPES.map(([v, name]) => `<option value="${v}" ${t.ty === v ? 'selected' : ''}>${name}</option>`).join('');
    const hasOverride = !!(R.add || R.m).trigger;
    container.insertAdjacentHTML('beforeend',
      `<details id="ed_trigger" ${detailsOpen ? 'open' : ''} style="margin-top:6px;border-top:1px solid #444;padding-top:4px">` +
      `<summary style="cursor:pointer;color:#fc6">Trigger shape · ${TYPES.find(x => x[0] === t.ty)?.[1] || 'unknown'}</summary>` +
      `<div class="h" style="margin:3px 0">Bounds are relative to this entity. Drag the square handles on the trigger outline, or enter exact values below.</div>` +
      `<div>Type <select id="ed_tr_type" style="max-width:175px">${options}</select></div>` +
      `<div style="margin-top:3px"><b>Centre offset</b><br>X ${h('ed_tr_ox', cs.offset[0])} Y ${h('ed_tr_oy', cs.offset[1], 0.5, Y_IGNORED_TYPES.has(t.ty))} Z ${h('ed_tr_oz', cs.offset[2])}</div>` +
      `<div style="margin-top:3px"><b>Size</b><br>X ${h('ed_tr_sx', cs.size[0])} Y ${h('ed_tr_sy', cs.size[1], 0.5, Y_IGNORED_TYPES.has(t.ty))} Z ${h('ed_tr_sz', cs.size[2])}</div>` +
      `<div style="margin-top:4px"><button id="ed_tr_reset" ${hasOverride ? '' : 'disabled'}>reset trigger</button> <span class="h">${hasOverride ? 'project override active' : 'original game bounds'}</span></div>` +
      `<div class="h" style="margin-top:3px">${(t.ty === 2 || t.ty === 3) ? 'Cylinder: horizontal resize handles change the shared XZ diameter while keeping the opposite face anchored.' : t.ty === 4 ? 'Sphere: all three dimensions are kept equal.' : t.ty === 5 ? 'Polygon footprint: vertices scale with X/Z dimensions.' : t.ty === 6 ? '3D polygon: vertices scale with the edited bounds.' : t.ty === 0 ? 'Flat box: vertical bounds are ignored by the game.' : 'Primitive trigger dimensions can be resized independently.'}</div>` +
      `</details>`);

    const detail = container.querySelector('#ed_trigger');
    if (detail) detail.ontoggle = () => { detailsOpen = detail.open; };
    const fields = ['ed_tr_ox', 'ed_tr_oy', 'ed_tr_oz', 'ed_tr_sx', 'ed_tr_sy', 'ed_tr_sz'];
    const read = () => fields.map(id => Number(container.querySelector('#' + id)?.value));
    const typeSelect = container.querySelector('#ed_tr_type');
    const apply = (newTy = Number(typeSelect.value), resizeAxis = null) => {
      const v = read();
      if (!v.every(Number.isFinite)) return;
      const old = fromEntity(e, R), nextBox = makeBox(v.slice(0, 3), v.slice(3), old.box, newTy, resizeAxis);
      let poly = null;
      if (POLYGON_TYPES.has(newTy)) {
        if (POLYGON_TYPES.has(old.ty) && old.poly) poly = scaleTriggerPolygon(old.poly, old.box, nextBox);
        else poly = rectanglePolygon(nextBox);
      }
      commit(q, { ty: newTy, box: nextBox, poly });
    };
    typeSelect.onchange = () => apply(Number(typeSelect.value));
    for (const id of fields) {
      const input = container.querySelector('#' + id);
      if (input) input.onchange = () => apply(undefined, id === 'ed_tr_sx' ? 0 : id === 'ed_tr_sz' ? 2 : null);
    }
    const reset = container.querySelector('#ed_tr_reset');
    if (reset) reset.onclick = () => commit(q, null);
    Viewer.need = true;
  }

  function overlay({ ctx, project, selected }) {
    if (!selected || !selected.b || !current || selected.L !== current.q.L || selected.i !== current.q.i) return;
    const t = fromEntity(current.R.e, current.R);
    const box = drag && drag.q.L === selected.L && drag.q.i === selected.i ? drag.box : current.R.e.b;
    const ty = t.ty;
    const viewportWidth = Number.isFinite(globalThis.innerWidth) ? globalThis.innerWidth : Infinity;
    const viewportHeight = Number.isFinite(globalThis.innerHeight) ? globalThis.innerHeight : Infinity;
    handles = faceDescriptors(box, ty).map(h => ({ ...h, screen: project(h.p) }))
      .filter(h => Number.isFinite(h.screen.x) && Number.isFinite(h.screen.y) && h.screen.z >= -1 && h.screen.z <= 1
        && h.screen.x >= 0 && h.screen.x <= viewportWidth
        && h.screen.y >= 0 && h.screen.y <= viewportHeight);
    ctx.save?.();
    ctx.lineWidth = 1.5;
    if (drag && drag.q.L === selected.L && drag.q.i === selected.i) {
      const corners = Array.from({ length: 8 }, (_, i) => project([
        drag.box[i & 1 ? 3 : 0], drag.box[i & 2 ? 4 : 1], drag.box[i & 4 ? 5 : 2],
      ]));
      const edges = [[0,1],[1,3],[3,2],[2,0],[4,5],[5,7],[7,6],[6,4],[0,4],[1,5],[2,6],[3,7]];
      ctx.strokeStyle = '#65d6ff';
      ctx.beginPath();
      for (const [a, b] of edges) { ctx.moveTo(corners[a].x, corners[a].y); ctx.lineTo(corners[b].x, corners[b].y); }
      ctx.stroke();
    }
    for (const h of handles) {
      if (h.screen.z < -1 || h.screen.z > 1) continue;
      ctx.fillStyle = '#101820';
      ctx.strokeStyle = '#65d6ff';
      ctx.fillRect(h.screen.x - 5, h.screen.y - 5, 10, 10);
      ctx.strokeRect(h.screen.x - 5, h.screen.y - 5, 10, 10);
    }
    ctx.restore?.();
  }

  function onMouseDown(e) {
    if (e.button !== 0 || !current || !Viewer.sel || !current.q || Viewer.sel.L !== current.q.L || Viewer.sel.i !== current.q.i) return;
    let hit = null, distance = 11;
    for (const h of handles) {
      const d = Math.hypot(e.clientX - h.screen.x, e.clientY - h.screen.y);
      if (d < distance) { hit = h; distance = d; }
    }
    if (!hit) return;
    const bounds = current.R.e.b.slice();
    const center = [0, 1, 2].map(k => (bounds[k] + bounds[k + 3]) / 2);
    const p0 = Viewer.projectPoint(center), axis = center.slice(); axis[hit.axis] += 1;
    const p1 = Viewer.projectPoint(axis), sx = p1.x - p0.x, sy = p1.y - p0.y;
    const denom = sx * sx + sy * sy;
    if (!Number.isFinite(denom) || denom < 1e-5) return;
    drag = { q: current.q, R: current.R, hit, bounds, startX: e.clientX, startY: e.clientY, sx, sy, denom, box: bounds.slice() };
    Viewer.drag = null;
    Viewer.mdown = null;
    Viewer.cv.style.cursor = 'nwse-resize';
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  function onMouseMove(e) {
    if (!drag) return;
    const delta = ((e.clientX - drag.startX) * drag.sx + (e.clientY - drag.startY) * drag.sy) / drag.denom;
    const next = drag.bounds.slice(), i = drag.hit.valueIndex, axis = drag.hit.axis;
    next[i] = drag.bounds[i] + delta;
    if (i === axis) next[i] = Math.min(next[i], next[axis + 3] - 0.1);
    else next[i] = Math.max(next[i], next[axis] + 0.1);
    const t = fromEntity(drag.R.e, drag.R);
    drag.box = normalizeTriggerBounds(next, t.ty, axis);
    Viewer.need = true;
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  function onMouseUp(e) {
    if (!drag) return;
    const done = drag;
    drag = null;
    Viewer.cv.style.cursor = '';
    const t = fromEntity(done.R.e, done.R);
    const localBox = done.box.map((v, k) => r3(v - done.R.e.p[k % 3]));
    const poly = POLYGON_TYPES.has(t.ty) && t.poly ? scaleTriggerPolygon(t.poly, t.box, localBox) : null;
    commit(done.q, { ty: t.ty, box: localBox, poly });
    Viewer.need = true;
    e.preventDefault?.();
    e.stopImmediatePropagation?.();
  }

  Viewer.cv.addEventListener('mousedown', onMouseDown, true);
  globalThis.addEventListener('mousemove', onMouseMove, true);
  globalThis.addEventListener('mouseup', onMouseUp, true);
  setOverlayRender(overlay);

  return { render, cancelDrag: () => { drag = null; Viewer.cv.style.cursor = ''; } };
}
