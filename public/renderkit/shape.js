/* Shape mode: a surface (a ring: a pool, a lawn) or a path (a line) reshaped by its points, as build.js moves a body
   (pm 2026-10-26 00:31Z: «the pool with corner and edge knobs and a turn ring, and paths by their points»). One copy
   for every app, beside build.js, on top of select.js's selection.

   - A ring has a knob at each corner (drag it), a smaller one on each edge (drag it out or in: the edge moves square to
     itself), and the turn ring round it; a press inside it drags the whole.
   - A line has a knob at each point and a small one between two (drag it: a new point there), the turn ring, and a
     press on it drags the whole. A double click on a point takes it away (a ring keeps 3, a line 2); on an edge's knob,
     a new point there.
   - A point snaps to 0,5 m, and in line with its neighbours along the shape's own long direction (so a rectangle stays
     square); Alt turns snapping off. The turn snaps to 15°.
   - R turns it a quarter, Q and E 15° (Alt: 1°); the arrows move it 1 m (Shift: 5 m), while the pointer is over the view.
   - While it changes, the new shape is drawn over everything with its area or length; let go, it is one change
     (onCommit). Esc or a right click puts it back.
   The pure part (no three.js) is exported for tests: centroidOf, areaOf, lengthOf, turnPts, moveEdge, snapPoint. */

import { snapAlign } from "./infer.js";
import { dragContext, snapDragPoint, guideList, POINT_KINDS } from "./dragsnap.js";
import { createGuides } from "./guidelines.js";

const rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI;
const r2 = v => Math.round(v * 100) / 100;
const round = (v, s) => Math.round(v / s) * s;

export const centroidOf = p => p.reduce((a, q) => [a[0] + q[0] / p.length, a[1] + q[1] / p.length], [0, 0]);
export const areaOf = r => Math.abs(r.reduce((a, p, i) => { const q = r[(i + 1) % r.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
export const lengthOf = l => l.slice(1).reduce((a, p, i) => a + Math.hypot(p[0] - l[i][0], p[1] - l[i][1]), 0);
export const turnPts = (pts, c, d) => { const s = Math.sin(rad(d)), k = Math.cos(rad(d)); return pts.map(([x, y]) => [r2(c[0] + (x - c[0]) * k - (y - c[1]) * s), r2(c[1] + (x - c[0]) * s + (y - c[1]) * k)]); };
/* the ring's edge i (point i to i + 1) moved square to itself so its middle is as far out as g is */
export function moveEdge(ring, i, g) {
  const a = ring[i], b = ring[(i + 1) % ring.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, n = [(b[1] - a[1]) / L, -(b[0] - a[0]) / L];
  const d = (g[0] - (a[0] + b[0]) / 2) * n[0] + (g[1] - (a[1] + b[1]) / 2) * n[1];
  return ring.map((p, j) => j === i || j === (i + 1) % ring.length ? [r2(p[0] + n[0] * d), r2(p[1] + n[1] * d)] : p);
}
/* the shape's long direction: its longest edge's */
function axisOf(pts, closed) {
  let best = [1, 0], L = 0;
  for (let i = 0; i < pts.length - (closed ? 0 : 1); i++) { const a = pts[i], b = pts[(i + 1) % pts.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]); if (l > L) { L = l; best = [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; } }
  return best;
}
/* point i at g, snapped: in line with its neighbours (within tol m) along the shape's long direction and across it,
   else to the grid in that frame; the neighbours it lines up with are the guides. axis: the direction to use (a drag
   gives the shape's as it was, so the frame does not turn with the point in hand) */
export function snapPoint(pts, i, g, { closed = true, grid = 0.5, tol = 0.6, axis = null, near = null, origin = null, reach = 0.8 } = {}) {
  const u = axis || axisOf(pts, closed);
  const nb = [i - 1, i + 1].map(j => closed ? pts[(j + pts.length) % pts.length] : pts[j]).filter(Boolean);
  const a = snapAlign(g, nb, u, { grid, tol });
  if (a.su == null && a.sv == null && near) {
    /* in line with no neighbour: a catch on the near outlines (midpoint, edge, axis, mirror, midline ...) before the grid */
    const q = snapDragPoint(g, near, { origin, reach, kinds: POINT_KINDS });
    if (q.kind) return { p: [r2(q.p[0]), r2(q.p[1])], guides: guideList(q), kind: q.kind };
  }
  const p = [r2(a.p[0]), r2(a.p[1])];
  return { p, guides: a.hits.map(h => [h.ref, p]), kind: a.hits.length ? "align" : "grid" };
}
/* the edge i moved square to itself as far out as g: g first catches a near outline, then the middle of the edge is
   taken square to the edge; → { ring, guides } */
export function snapEdge(ring, i, g, { near = null, reach = 0.8, grid = 0.5 } = {}) {
  const a = ring[i], b = ring[(i + 1) % ring.length], m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, n = [(b[1] - a[1]) / L, -(b[0] - a[0]) / L];
  let h = g, guides = [];
  if (near) {
    const d = (g[0] - m[0]) * n[0] + (g[1] - m[1]) * n[1], on = [m[0] + n[0] * d, m[1] + n[1] * d], q = snapDragPoint(on, near, { origin: m, reach, kinds: POINT_KINDS });
    if (q.kind) { h = q.p; guides = guideList(q); }
  }
  if (!guides.length) h = [round(g[0], grid), round(g[1], grid)];
  return { ring: moveEdge(ring, i, h), guides };
}

/* the three.js part. The app gives THREE, el (the canvas), host (for the numbers), scene, camera() (the one in use),
   P([e, n], kote) → Vector3, ground(e, n) → kote, redraw(), onCommit(id, { ring } | { line }, how, by) → false when
   refused (or a promise of it): how is point, edge, add, remove, move or ring; by is drag, dblclick or keys;
   onBusy(on) (the picker stands aside).
   attach(item) shows the handles for item { id, ring } or { id, line, width }, with mesh (its Object3D, hidden while
   the new shape is drawn) */
export function createShape({ THREE, el, host = el.parentElement, scene, camera, P, ground, redraw, onCommit, onBusy = () => {}, others = () => [], onLive = () => {}, snapPx = 10, touchPx = 28 }) {
  const G = new THREE.Group(); scene.add(G); G.visible = false;
  const ACC = 0x2f6fde;
  const onTop = m => { m.depthTest = false; m.depthWrite = false; m.transparent = true; return m; };
  const kMat = onTop(new THREE.MeshBasicMaterial({ color: ACC })), mMat = onTop(new THREE.MeshBasicMaterial({ color: 0xffffff }));
  const ringMat = onTop(new THREE.MeshBasicMaterial({ color: ACC, opacity: 0.8, side: THREE.DoubleSide }));
  const fillMat = onTop(new THREE.MeshBasicMaterial({ color: ACC, opacity: 0.22, side: THREE.DoubleSide }));
  const lineMat = onTop(new THREE.LineBasicMaterial({ color: ACC }));
  const guideLines = createGuides({ THREE, scene, host, el, camera, P, ground });
  const knob = new THREE.SphereGeometry(1, 16, 12);
  const turnRing = new THREE.Mesh(new THREE.RingGeometry(0.94, 1, 96).rotateX(-Math.PI / 2), ringMat), turnKnob = new THREE.Mesh(knob, mMat);
  turnRing.userData.h = ["ring"]; turnKnob.userData.h = ["ring"]; turnRing.renderOrder = turnKnob.renderOrder = 21; G.add(turnRing, turnKnob);
  const knobs = new THREE.Group(), drawn = new THREE.Group(); G.add(knobs); scene.add(drawn);
  const num = Object.assign(document.createElement("div"), { className: "rk-build-num" }); num.hidden = true;
  num.style.cssText = "position:absolute;left:0;top:0;pointer-events:none;z-index:6;white-space:nowrap;font:600 13px/1.3 system-ui,sans-serif;padding:4px 8px;border-radius:8px;background:rgba(255,255,255,.94);box-shadow:0 1px 4px rgba(0,0,0,.2);color:#1d1b18";
  host.append(num);
  const m1 = v => String(Math.round(v * 10) / 10).replace(".", ",");

  /* item: what is picked; pts: its points now (what the handles and the drawn shape show); op: the drag in hand */
  let item = null, pts = null, op = null, keyRun = null, shown = false, over = false;
  const closed = () => !!item?.ring;
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const aim = e => { const r = el.getBoundingClientRect(); ndc.set((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera()); return ray; };
  const foot = () => { const c = centroidOf(pts); return ground(...c); };
  function onGround(e) {
    const r = aim(e), hit = new THREE.Vector3();
    if (!r.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -P([0, 0], foot()).y), hit)) return null;
    return [hit.x, -hit.z];
  }
  const at = (p, up = 0.35) => P(p, ground(...p) + up);

  function attach(it) {
    if (op) cancel();
    const next = (it.ring || it.line).map(p => p.slice());
    if (item && it.id === item.id && JSON.stringify(next) === JSON.stringify(item.ring || item.line) && it.mesh === item.mesh) return;
    if (item?.mesh && item.mesh !== it.mesh) item.mesh.visible = true;
    item = it; pts = next; shown = false; G.visible = true; draw(); redraw();
  }
  function detach() { if (op) cancel(); if (item?.mesh) item.mesh.visible = true; item = null; G.visible = false; num.hidden = true; clearDrawn(); redraw(); }
  function clearDrawn() { for (const o of drawn.children.splice(0)) o.geometry.dispose(); }

  /* the handles at the points and between them, the turn ring round it, sized to stay the same on the screen; while it
     changes, the new shape over everything */
  function draw(guides = []) {
    knobs.clear();   // the knobs share one geometry
    const n = pts.length, segs = closed() ? n : n - 1;
    pts.forEach((p, i) => { const m = new THREE.Mesh(knob, kMat); m.position.copy(at(p)); m.userData.h = ["point", i]; m.renderOrder = 22; knobs.add(m); });
    for (let i = 0; i < segs; i++) { const a = pts[i], b = pts[(i + 1) % n], m = new THREE.Mesh(knob, mMat); m.position.copy(at([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2])); m.userData.h = [closed() ? "edge" : "add", i]; m.userData.small = true; m.renderOrder = 22; knobs.add(m); }
    const c = centroidOf(pts), R = Math.max(...pts.map(p => Math.hypot(p[0] - c[0], p[1] - c[1]))) + 3, a0 = op?.kind === "ring" ? op.turned : 0;
    turnRing.position.copy(at(c, 0.3)); turnRing.scale.set(R, 1, R); turnKnob.position.copy(at([c[0] + Math.cos(rad(a0)) * R, c[1] + Math.sin(rad(a0)) * R], 0.3));
    sizeKnobs();
    clearDrawn();
    if (shown) {
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([...pts, ...(closed() ? [pts[0]] : [])].map(p => at(p, 0.3))), lineMat); line.renderOrder = 20; drawn.add(line);
      if (closed()) {
        const tris = THREE.ShapeUtils.triangulateShape(pts.map(p => new THREE.Vector2(...p)), []), pos = [];
        for (const t of tris) for (const j of t) { const v = at(pts[j], 0.25); pos.push(v.x, v.y, v.z); }
        const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); const f = new THREE.Mesh(g, fillMat); f.renderOrder = 19; drawn.add(f);
      } else {
        const w = (item.width || 2) / 2, pos = [];
        for (let i = 0; i + 1 < pts.length; i++) {
          const a = pts[i], b = pts[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, nx = -(b[1] - a[1]) / L * w, ny = (b[0] - a[0]) / L * w;
          for (const q of [[a, -1], [b, -1], [b, 1], [a, -1], [b, 1], [a, 1]]) { const v = at([q[0][0] + nx * q[1], q[0][1] + ny * q[1]], 0.25); pos.push(v.x, v.y, v.z); }
        }
        const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); const f = new THREE.Mesh(g, fillMat); f.renderOrder = 19; drawn.add(f);
      }
    }
    guideLines.set(shown ? guides : []);
    if (item?.mesh) item.mesh.visible = !shown;
    label();
  }
  function sizeKnobs() {
    const cam = camera(), k = cam.isOrthographicCamera ? (cam.top - cam.bottom) / cam.zoom / el.clientHeight * 6 : null;
    for (const m of [...knobs.children, turnKnob]) m.scale.setScalar((k ?? m.position.distanceTo(cam.position) / el.clientHeight * 6 * 2 * Math.tan(rad(cam.fov / 2))) * (m.userData.small ? 0.7 : 1));
  }
  function label() {
    if (!op) { num.hidden = true; return; }
    const c = centroidOf(pts), v = at(c, 4).project(camera()), x = (v.x + 1) / 2 * el.clientWidth, y = (1 - v.y) / 2 * el.clientHeight;
    const size = closed() ? `${Math.round(areaOf(pts)).toLocaleString("nb-NO")} m²` : `${m1(lengthOf(pts))} m`;
    num.textContent = op.kind === "ring" ? `${Math.round(((-op.turned % 360) + 360) % 360)}° · ${size}` : size;
    num.hidden = false; const hb = host.getBoundingClientRect(), eb = el.getBoundingClientRect();
    num.style.transform = `translate(${Math.round(x + eb.left - hb.left - num.offsetWidth / 2)}px, ${Math.round(y + eb.top - hb.top - num.offsetHeight - 8)}px)`;
  }

  /* what the pointer is on: a knob, the turn ring, or the shape itself (inside the ring, or near the line) */
  function handleAt(e) {
    const r = aim(e), h = r.intersectObjects([...knobs.children, turnKnob, turnRing], false)[0]; if (h) return h.object.userData.h;
    const g = onGround(e); if (!g) return null;
    if (closed()) { let o = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [a, b] = pts[i], [c, d] = pts[j]; if ((b > g[1]) !== (d > g[1]) && g[0] < (c - a) * (g[1] - b) / (d - b) + a) o = !o; } return o ? ["body"] : null; }
    const w = Math.max(1, (item.width || 2) / 2 + 0.5);
    for (let i = 0; i + 1 < pts.length; i++) { const a = pts[i], b = pts[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], t = Math.max(0, Math.min(1, ((g[0] - a[0]) * dx + (g[1] - a[1]) * dy) / (dx * dx + dy * dy || 1))); if (Math.hypot(g[0] - a[0] - t * dx, g[1] - a[1] - t * dy) < w) return ["body"]; }
    return null;
  }
  function down(e) {
    if (!item || e.button !== 0 || e.shiftKey) return;
    const h = handleAt(e); if (!h) return;
    e.stopImmediatePropagation(); e.preventDefault(); el.setPointerCapture?.(e.pointerId);
    const g = onGround(e) || centroidOf(pts), from = pts.map(p => p.slice());
    if (h[0] === "add") { pts.splice(h[1] + 1, 0, g.slice()); op = { kind: "point", i: h[1] + 1, from, how: "add" }; }
    else op = { kind: h[0], i: h[1], from, grab: g, how: h[0], turned: 0, a0: deg(Math.atan2(g[1] - centroidOf(pts)[1], g[0] - centroidOf(pts)[0])), press: { x: e.clientX, y: e.clientY } };
    op.axis = axisOf(from, closed()); op.touch = e.pointerType === "touch"; op.near = dragContext((others(item.id) || []).map(o => o.ring), centroidOf(from), 60); onBusy(true); shown = true; draw();
  }
  function move(e) {
    if (!op) { if (item && !e.buttons && e.target === el) el.style.cursor = handleAt(e) ? "grab" : ""; return; }
    const g = onGround(e); if (!g) return;
    const free = e.altKey || !snapsOn; let guides = [];
    const reach = Math.max(0.3, Math.min(3, (op.touch ? touchPx / 2 : snapPx) / pxPerM(g)));
    if (op.kind === "point") { const r = free ? { p: g, guides: [] } : snapPoint(pts, op.i, g, { closed: closed(), axis: op.axis, near: op.near, origin: op.from[op.i], reach }); pts[op.i] = r.p; guides = r.guides; }
    else if (op.kind === "edge") { if (free) pts = moveEdge(op.from, op.i, g); else { const r = snapEdge(op.from, op.i, g, { near: op.near, reach }); pts = r.ring; guides = r.guides; } }
    else if (op.kind === "body") { let d = [g[0] - op.grab[0], g[1] - op.grab[1]]; if (!free) d = d.map(v => round(v, 0.5)); pts = op.from.map(p => [r2(p[0] + d[0]), r2(p[1] + d[1])]); }
    else if (op.kind === "ring") { const c = centroidOf(op.from); let a = deg(Math.atan2(g[1] - c[1], g[0] - c[0])) - op.a0; if (!free) a = round(a, 15); op.turned = a; pts = turnPts(op.from, c, a); }
    draw(guides); redraw(); live(e);
  }
  /* metres on the ground to one pixel's worth: pixels per metre at g */
  function pxPerM(g) { const a = at(g).project(camera()), b = at([g[0] + 1, g[1]]).project(camera()); return Math.max(2, Math.hypot((a.x - b.x) / 2 * el.clientWidth, (a.y - b.y) / 2 * el.clientHeight)); }
  /* live numbers for the type-in box: a point's distance from the point before it, an edge's distance moved */
  function liveValues() {
    if (!op) return null;
    if (op.kind === "point") { const j = (op.i - 1 + pts.length) % pts.length, p = pts[op.i], q = pts[j]; return { L: Math.hypot(p[0] - q[0], p[1] - q[1]) }; }
    if (op.kind === "edge") { const a = op.from[op.i], b = op.from[(op.i + 1) % pts.length], c = pts[op.i], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return { d: ((c[0] - a[0]) * (b[1] - a[1]) - (c[1] - a[1]) * (b[0] - a[0])) / L }; }
    return null;
  }
  function live(e) { const v = liveValues(); if (v) onLive(op.kind, v, e ? { x: e.clientX, y: e.clientY } : null); }
  let snapsOn = true;
  /* typed numbers: a point at that distance from the point before it, in the direction it has; an edge that far out */
  function typed(v) {
    if (!op) return false;
    if (op.kind === "point" && Number.isFinite(v.L)) {
      const j = (op.i - 1 + pts.length) % pts.length, q = pts[j], p = pts[op.i], n = Math.hypot(p[0] - q[0], p[1] - q[1]) || 1;
      pts[op.i] = [r2(q[0] + (p[0] - q[0]) / n * Math.max(0.1, v.L)), r2(q[1] + (p[1] - q[1]) / n * Math.max(0.1, v.L))];
    } else if (op.kind === "edge" && Number.isFinite(v.d)) {
      const a = op.from[op.i], b = op.from[(op.i + 1) % pts.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, nn = [(b[1] - a[1]) / L, -(b[0] - a[0]) / L], m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      pts = moveEdge(op.from, op.i, [m[0] + nn[0] * v.d, m[1] + nn[1] * v.d]);
    } else return false;
    const o = op; op = null; snapsOn = true; onBusy(false); guideLines.clear(); finish(o.how, o.from, "typed"); return true;
  }
  function up(e) {
    if (!op) return;
    const o = op; op = null; snapsOn = true; onBusy(false); guideLines.clear();
    const moved = JSON.stringify(pts) !== JSON.stringify(o.from);
    if (!moved || (o.press && Math.hypot(e.clientX - o.press.x, e.clientY - o.press.y) < 4 && o.kind !== "point")) { back(o.from); return; }
    finish(o.how, o.from, "drag");
  }
  /* one change; refused, it goes back to where it was */
  function finish(how, from, by) {
    const id = item.id, body = closed() ? { ring: pts.map(p => p.slice()) } : { line: pts.map(p => p.slice()) };
    num.hidden = true; draw();
    Promise.resolve(onCommit(id, body, how, by)).then(ok => { if (ok === false && item?.id === id) back(from); }, () => { if (item?.id === id) back(from); });
  }
  function back(from) { pts = from.map(p => p.slice()); shown = false; draw(); redraw(); }
  function cancel() { if (!op) return; const o = op; op = null; snapsOn = true; onBusy(false); guideLines.clear(); back(o.from); }

  /* a double click: on a point, take it away; on an edge's knob, a new point there */
  function dbl(e) {
    if (!item) return; const r = aim(e), h = r.intersectObjects(knobs.children, false)[0]?.object.userData.h; if (!h) return;
    e.stopImmediatePropagation(); e.preventDefault();
    const from = pts.map(p => p.slice()), min = closed() ? 3 : 2;
    if (h[0] === "point") { if (pts.length <= min) return; pts.splice(h[1], 1); shown = true; finish("remove", from, "dblclick"); }
    else if (h[0] === "edge" || h[0] === "add") { const a = pts[h[1]], b = pts[(h[1] + 1) % pts.length]; pts.splice(h[1] + 1, 0, [r2((a[0] + b[0]) / 2), r2((a[1] + b[1]) / 2)]); shown = true; finish("add", from, "dblclick"); }
  }
  /* keys, while the pointer is over the view: R a quarter, Q and E 15° (Alt 1°), arrows 1 m (Shift 5) along the screen;
     a run of them one change, taken when they stop */
  function key(e) {
    if (!item || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName) || e.target?.isContentEditable || e.metaKey || e.ctrlKey) return;
    if (e.key === "Escape" && op) { cancel(); e.preventDefault(); e.stopImmediatePropagation(); return; }
    if (!over || op) return;
    const k = e.key.toLowerCase(), turn = k === "r" ? -90 : k === "q" ? (e.altKey ? 1 : 15) : k === "e" ? -(e.altKey ? 1 : 15) : 0;
    const arrows = { arrowup: [0, 1], arrowdown: [0, -1], arrowleft: [-1, 0], arrowright: [1, 0] }[k];
    if (!turn && !arrows) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (!keyRun) { keyRun = { from: pts.map(p => p.slice()), how: turn ? "ring" : "move" }; onBusy(true); shown = true; }
    else if (keyRun.how !== (turn ? "ring" : "move")) keyRun.how = "move";
    if (turn) pts = turnPts(pts, centroidOf(pts), turn);
    else {
      const f = new THREE.Vector3(); camera().getWorldDirection(f); let fw = [f.x, -f.z]; const n = Math.hypot(...fw); fw = n > 0.2 ? [fw[0] / n, fw[1] / n] : [0, 1];
      const rt = [fw[1], -fw[0]], d = e.shiftKey ? 5 : 1, dx = (rt[0] * arrows[0] + fw[0] * arrows[1]) * d, dy = (rt[1] * arrows[0] + fw[1] * arrows[1]) * d;
      pts = pts.map(p => [r2(p[0] + dx), r2(p[1] + dy)]);
    }
    draw(); redraw(); clearTimeout(keyRun.t);
    keyRun.t = setTimeout(() => { const r = keyRun; keyRun = null; onBusy(false); finish(r.how, r.from, "keys"); }, 700);
  }
  const menu = e => { if (op) { e.preventDefault(); cancel(); } };
  const enter = () => { over = true; }, leave = () => { over = false; };

  el.addEventListener("pointerdown", down, true); addEventListener("pointermove", move); addEventListener("pointerup", up, true);
  el.addEventListener("dblclick", dbl, true); addEventListener("keydown", key, true); el.addEventListener("contextmenu", menu, true);
  el.addEventListener("pointerenter", enter); el.addEventListener("pointerleave", leave);
  return {
    attach, detach, cancel, typed, setSnaps(on) { snapsOn = !!on; }, get snaps() { return snapsOn; }, get live() { return liveValues(); }, get busy() { return !!op || !!keyRun; }, get item() { return item; },
    /* the handles' size follows the camera: call when the view moves */
    frame() { if (item) { sizeKnobs(); if (op) label(); } },
    destroy() { detach(); scene.remove(G, drawn); guideLines.destroy(); num.remove(); el.removeEventListener("pointerdown", down, true); removeEventListener("pointermove", move); removeEventListener("pointerup", up, true); el.removeEventListener("dblclick", dbl, true); removeEventListener("keydown", key, true); el.removeEventListener("contextmenu", menu, true); el.removeEventListener("pointerenter", enter); el.removeEventListener("pointerleave", leave); },
  };
}
