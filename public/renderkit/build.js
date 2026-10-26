/* Build mode: move, turn and resize a thing on the ground as in a good city builder (U3569, Morten 2026-10-25 22:29Z
   via pm: «better move/rotate/scale etc for buildings and objects», «make it like in a good game»). One copy for every
   app (sykehus first; Fab's U3560 can take it), on top of select.js's selection.

   A body is a box on the ground along an axis: { from: [e, n], to: [e, n], width, height } in the app's metres, east
   and north (the from → to line is its length, width across it), the same as sykehus's new buildings.

   - Picked, it gets handles: drag the body to move it, the ring to turn it, an end or a side to make it longer or
     wider, the top to add or take storeys.
   - While it moves a ghost follows the pointer, eased, lifted a little over a soft shadow: green where it fits, red
     where it hits another building or leaves the lot, with a short tip why.
   - It snaps to 1 m, to 15°, to the directions of the buildings near it, and to their edges and corners, with guide
     lines where an edge lines up; Alt turns snapping off.
   - R turns it a quarter, Q and E 15° (Alt: 1°), Shift and the wheel turns it freely; the arrow keys nudge it 1 m
     (Shift: 5 m).
   - A drag is one change (onCommit), a run of keys one change too; a red place is not taken. Esc or a right click
     while moving puts it back.
   The pure part (no three.js) is exported for tests: bodyOf, toBody, cornersOf, snapBody, fitBody. */
import { pointInRing as inRing } from "./paths2d.js";

const rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI;
const wrap = a => ((a % 360) + 540) % 360 - 180;   // degrees into (-180, 180]
const round = (v, s) => Math.round(v / s) * s;

/* centre, angle (degrees anticlockwise from east), length, width, height */
export function bodyOf(b) {
  const L = Math.hypot(b.to[0] - b.from[0], b.to[1] - b.from[1]);
  return { c: [(b.from[0] + b.to[0]) / 2, (b.from[1] + b.to[1]) / 2], a: deg(Math.atan2(b.to[1] - b.from[1], b.to[0] - b.from[0])), L, W: b.width, H: b.height ?? 0 };
}
export function toBody(s) {
  const u = [Math.cos(rad(s.a)), Math.sin(rad(s.a))], h = s.L / 2, r2 = v => Math.round(v * 100) / 100;
  return { from: [r2(s.c[0] - u[0] * h), r2(s.c[1] - u[1] * h)], to: [r2(s.c[0] + u[0] * h), r2(s.c[1] + u[1] * h)], width: r2(s.W), height: r2(s.H) };
}
export function cornersOf(s) {
  const u = [Math.cos(rad(s.a)), Math.sin(rad(s.a))], v = [-u[1], u[0]], l = s.L / 2, w = s.W / 2;
  return [[-l, -w], [l, -w], [l, w], [-l, w]].map(([p, q]) => [s.c[0] + u[0] * p + v[0] * q, s.c[1] + u[1] * p + v[1] * q]);
}

const edges = r => r.map((p, i) => [p, r[(i + 1) % r.length]]).filter(([p, q]) => p[0] !== q[0] || p[1] !== q[1]);
function segHit(p, q, r, s) {
  const d = (q[0] - p[0]) * (s[1] - r[1]) - (q[1] - p[1]) * (s[0] - r[0]); if (Math.abs(d) < 1e-12) return false;
  const t = ((r[0] - p[0]) * (s[1] - r[1]) - (r[1] - p[1]) * (s[0] - r[0])) / d, u = ((r[0] - p[0]) * (q[1] - p[1]) - (r[1] - p[1]) * (q[0] - p[0])) / d;
  return t > 1e-6 && t < 1 - 1e-6 && u > 1e-6 && u < 1 - 1e-6;
}
const ptSeg = (x, p, q) => { const dx = q[0] - p[0], dy = q[1] - p[1], t = Math.max(0, Math.min(1, ((x[0] - p[0]) * dx + (x[1] - p[1]) * dy) / (dx * dx + dy * dy || 1))); return Math.hypot(x[0] - p[0] - t * dx, x[1] - p[1] - t * dy); };
function ringsMeet(A, B) {
  for (const [p, q] of edges(A)) for (const [r, s] of edges(B)) if (segHit(p, q, r, s)) return true;
  return A.some(p => inRing(p, B)) || B.some(p => inRing(p, A));
}
function ringGap(A, B) { let d = Infinity; for (const [p, q] of edges(A)) for (const x of B) d = Math.min(d, ptSeg(x, p, q)); for (const [p, q] of edges(B)) for (const x of A) d = Math.min(d, ptSeg(x, p, q)); return d; }
const shrink = (r, k) => { const c = r.reduce((a, p) => [a[0] + p[0] / r.length, a[1] + p[1] / r.length], [0, 0]); return r.map(p => { const d = Math.hypot(p[0] - c[0], p[1] - c[1]) || 1; return [p[0] - (p[0] - c[0]) / d * k, p[1] - (p[1] - c[1]) / d * k]; }); };

/* does it fit: not into another (touching is fine), and inside the lot when there is one; the nearest and how far */
export function fitBody(s, others, lot = null) {
  const R = cornersOf(s), inner = shrink(R, 0.05);
  let near = null;
  for (const o of others) {
    if (ringsMeet(inner, o.ring)) return { fits: false, why: `Treffer ${o.name || "et annet bygg"}`, near: { id: o.id, name: o.name, dist: 0 } };
    const d = ringGap(R, o.ring); if (!near || d < near.dist) near = { id: o.id, name: o.name, dist: Math.round(d * 10) / 10 };
  }
  if (lot && R.some(p => !inRing(p, lot))) return { fits: false, why: "Utenfor tomta", near };
  return { fits: true, why: null, near };
}

/* snapped: the angle to 15° or to a near building's direction (within 4°), the centre to 1 m, then an edge or a corner
   to a near building's (within tol m); guides are the lines that line up, [[e, n], [e, n]] */
export function snapBody(s, others, { grid = 1, step = 15, tol = 1.2, reach = 40, angle = true, place = true } = {}) {
  const out = { ...s, c: s.c.slice() }, guides = [];
  const near = others.filter(o => o.ring.some(p => Math.hypot(p[0] - s.c[0], p[1] - s.c[1]) < reach + s.L));
  if (angle) {
    const dirs = near.flatMap(o => edges(o.ring).filter(([p, q]) => Math.hypot(q[0] - p[0], q[1] - p[1]) > 3).map(([p, q]) => deg(Math.atan2(q[1] - p[1], q[0] - p[0]))));
    let best = null;
    for (const d of dirs) for (const k of [0, 90, 180, 270]) { const x = wrap(d + k), e = Math.abs(wrap(s.a - x)); if (e < 4 && (!best || e < best.e)) best = { e, x }; }
    out.a = best ? best.x : wrap(round(s.a, step));
  }
  if (!place) return { s: out, guides };
  out.c = [round(out.c[0], grid), round(out.c[1], grid)];
  const u = [Math.cos(rad(out.a)), Math.sin(rad(out.a))], v = [-u[1], u[0]], dot = (a, b) => a[0] * b[0] + a[1] * b[1];
  /* each of the body's four edges against the near buildings' edges that run the same way: the smallest shift a normal */
  const shift = { u: null, v: null };
  for (const o of near) for (const [p, q] of edges(o.ring)) {
    const L = Math.hypot(q[0] - p[0], q[1] - p[1]); if (L < 1) continue;
    const d = [(q[0] - p[0]) / L, (q[1] - p[1]) / L];
    for (const [n, ax, half, along, halfAlong] of [["v", v, out.W / 2, u, out.L / 2], ["u", u, out.L / 2, v, out.W / 2]]) {
      if (Math.abs(dot(d, ax)) > Math.sin(rad(2))) continue;   // not parallel to this pair of edges
      const off = dot([p[0] - out.c[0], p[1] - out.c[1]], ax), a0 = dot([p[0] - out.c[0], p[1] - out.c[1]], along), a1 = dot([q[0] - out.c[0], q[1] - out.c[1]], along);
      if (Math.min(a0, a1) > halfAlong + reach || Math.max(a0, a1) < -halfAlong - reach) continue;
      for (const side of [-half, half]) {
        const dl = off - side; if (Math.abs(dl) > tol) continue;
        if (!shift[n] || Math.abs(dl) < Math.abs(shift[n].dl)) shift[n] = { dl, ax, along, off, span: [Math.min(a0, a1, -halfAlong), Math.max(a0, a1, halfAlong)] };
      }
    }
  }
  /* else a corner to a near corner */
  if (!shift.u && !shift.v) {
    let best = null;
    for (const c of cornersOf(out)) for (const o of near) for (const p of o.ring) { const d = Math.hypot(p[0] - c[0], p[1] - c[1]); if (d < tol && (!best || d < best.d)) best = { d, dx: p[0] - c[0], dy: p[1] - c[1], p }; }
    if (best) { out.c = [out.c[0] + best.dx, out.c[1] + best.dy]; guides.push([[best.p[0] - 2, best.p[1]], [best.p[0] + 2, best.p[1]]], [[best.p[0], best.p[1] - 2], [best.p[0], best.p[1] + 2]]); }
    return { s: out, guides };
  }
  const c0 = out.c.slice();
  for (const k of ["u", "v"]) if (shift[k]) { out.c[0] += shift[k].ax[0] * shift[k].dl; out.c[1] += shift[k].ax[1] * shift[k].dl; }
  for (const k of ["u", "v"]) if (shift[k]) {
    const { ax, along, off, span } = shift[k], base = [c0[0] + ax[0] * off, c0[1] + ax[1] * off];
    guides.push([[base[0] + along[0] * (span[0] - 2), base[1] + along[1] * (span[0] - 2)], [base[0] + along[0] * (span[1] + 2), base[1] + along[1] * (span[1] + 2)]]);
  }
  return { s: out, guides };
}

/* the three.js part. The app gives:
   THREE, el (the canvas), host (for the numbers), scene, camera() (the one in use), P([e, n], kote) → Vector3 (the
   app's world), ground(e, n) → kote, others(id) → [{ id, name, ring }], lot (a ring or null), storey (m, a storey's
   height), redraw(), onCommit(id, body, how, by) → false when refused (or a promise of it); by is drag, click («Flytt»), keys or wheel, onBusy(on) (the picker stands
   aside), baseFor(body) → the kote its foot will stand at there (optional; else where it stands now)
   attach(item) shows the handles for item { id, from, to, width, height, base, group (its Object3D), fixed? (its size is
   not the hand's, a construction's parameters make it: only the ring, and the body to move) }; move(item)
   starts a move with no button held («Flytt»): the ghost follows, a click places. */
export function createBuild({ THREE, el, host = el.parentElement, scene, camera, P, ground, others, lot = null, storey = 3.2, redraw, onCommit, onBusy = () => {}, baseFor = null }) {
  const G = new THREE.Group(); G.renderOrder = 20; scene.add(G); G.visible = false;
  const ACC = 0x2f6fde, OK = 0x3fae5a, BAD = 0xd6453d;
  const onTop = (m) => { m.depthTest = false; m.depthWrite = false; m.transparent = true; return m; };
  const hMat = onTop(new THREE.MeshBasicMaterial({ color: 0xffffff })), hEdge = onTop(new THREE.MeshBasicMaterial({ color: ACC }));
  const ringMat = onTop(new THREE.MeshBasicMaterial({ color: ACC, opacity: 0.8, side: THREE.DoubleSide }));
  const ghostOk = new THREE.MeshStandardMaterial({ color: OK, transparent: true, opacity: 0.55, roughness: 0.6, depthWrite: false, emissive: OK, emissiveIntensity: 0.25 });
  const ghostBad = new THREE.MeshStandardMaterial({ color: BAD, transparent: true, opacity: 0.55, roughness: 0.6, depthWrite: false, emissive: BAD, emissiveIntensity: 0.25 });
  const guideMat = onTop(new THREE.LineDashedMaterial({ color: ACC, dashSize: 1.2, gapSize: 0.8 }));
  /* the soft shadow: a picture of a blurred box, stretched under the ghost */
  const sc = document.createElement("canvas"); sc.width = sc.height = 128; { const x = sc.getContext("2d"); x.filter = "blur(10px)"; x.fillStyle = "rgba(0,0,0,.5)"; x.fillRect(22, 22, 84, 84); }
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sc), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
  shadow.visible = false; scene.add(shadow);

  /* the handles: a knob at each end and side, a ring with its knob, an arrow over the top */
  const knob = new THREE.SphereGeometry(1, 16, 12), cone = new THREE.ConeGeometry(0.9, 1.8, 16);
  const H = { ends: [0, 1].map(() => new THREE.Mesh(knob, hEdge)), sides: [0, 1].map(() => new THREE.Mesh(knob, hEdge)), top: new THREE.Mesh(cone, hEdge),
    ring: new THREE.Mesh(new THREE.RingGeometry(0.94, 1, 96).rotateX(-Math.PI / 2), ringMat), turn: new THREE.Mesh(knob, hMat) };
  H.ends.forEach((m, i) => m.userData.h = ["end", i]); H.sides.forEach((m, i) => m.userData.h = ["side", i]); H.top.userData.h = ["top"]; H.ring.userData.h = ["ring"]; H.turn.userData.h = ["ring"];
  const all = [...H.ends, ...H.sides, H.top, H.ring, H.turn]; for (const m of all) { m.renderOrder = 21; G.add(m); }
  const guides = new THREE.Group(); scene.add(guides);
  const num = Object.assign(document.createElement("div"), { className: "rk-build-num" }); num.hidden = true;
  num.style.cssText = "position:absolute;left:0;top:0;pointer-events:none;z-index:6;white-space:nowrap;font:600 13px/1.3 system-ui,sans-serif;padding:4px 8px;border-radius:8px;background:rgba(255,255,255,.94);box-shadow:0 1px 4px rgba(0,0,0,.2);color:#1d1b18";
  host.append(num);

  /* s0: where it stands now; g0: where its shapes were drawn (the app draws them anew after a change); real: the thing
     itself is posed (let go, or a preview), back: it is easing back to where its shapes are */
  let item = null, s0 = null, g0 = null, cur = null, target = null, op = null, ghost = null, fit = null, raf = 0, last = 0, keyRun = null, real = false, back = false;
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const aim = e => { const r = el.getBoundingClientRect(); ndc.set((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera()); return ray; };
  /* where on the ground at the body's foot the pointer points */
  function onGround(e) {
    const y = P([0, 0], item.base).y, r = aim(e), hit = new THREE.Vector3();
    if (!r.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), hit)) return null;
    return [hit.x, -hit.z];   // the app's P is x east, z south
  }
  const rest = id => others(id);
  const m1 = v => String(Math.round(v * 10) / 10).replace(".", ",");

  function attach(it) {
    if (item && it.id === item.id && it.group === item.group) return;   // the same shapes: where it stands (posed, maybe) is this file's
    if (item && real && item.group !== it.group) { item.group.matrix.identity(); item.group.matrixAutoUpdate = true; }   // the old shapes, if the app keeps them
    item = it; s0 = { ...bodyOf(it), base: it.base }; g0 = { ...s0, c: s0.c.slice() }; cur = { ...s0, lift: 0 }; target = { ...cur }; real = false; back = false;
    G.visible = true; place(cur); redraw();
  }
  function detach() { if (op) cancel(); item = null; G.visible = false; num.hidden = true; clearGuides(); redraw(); }

  /* the handles where the body is, sized to stay the same on the screen */
  function place(s) {
    const u = [Math.cos(rad(s.a)), Math.sin(rad(s.a))], v = [-u[1], u[0]], b = item.base, top = b + s.H;
    const at = (p, k) => P(p, k);
    H.ends[0].position.copy(at([s.c[0] - u[0] * s.L / 2, s.c[1] - u[1] * s.L / 2], b + 0.4)); H.ends[1].position.copy(at([s.c[0] + u[0] * s.L / 2, s.c[1] + u[1] * s.L / 2], b + 0.4));
    H.sides[0].position.copy(at([s.c[0] - v[0] * s.W / 2, s.c[1] - v[1] * s.W / 2], b + 0.4)); H.sides[1].position.copy(at([s.c[0] + v[0] * s.W / 2, s.c[1] + v[1] * s.W / 2], b + 0.4));
    H.top.position.copy(at(s.c, top + 2.2));
    const R = Math.hypot(s.L, s.W) / 2 + 3; H.ring.position.copy(at(s.c, b + 0.3)); H.ring.scale.set(R, 1, R);
    H.turn.position.copy(at([s.c[0] + u[0] * R, s.c[1] + u[1] * R], b + 0.3));
    const cam = camera(), k = cam.isOrthographicCamera ? (cam.top - cam.bottom) / cam.zoom / el.clientHeight * 7 : null;
    for (const m of [...H.ends, ...H.sides, H.top, H.turn]) m.scale.setScalar(k ?? m.position.distanceTo(cam.position) / el.clientHeight * 7 * 2 * Math.tan(rad(cam.fov / 2)));
    const showAll = !op || op.kind === "move"; for (const m of all) m.visible = (showAll || m.userData.h[0] === { end: "end", side: "side", top: "top", ring: "ring" }[op.kind]) && !(item.fixed && m.userData.h[0] !== "ring");
  }

  /* the ghost: the thing's own shapes in green or red, moved, turned and stretched from where it stood */
  function makeGhost() {
    ghost = item.group.clone(true);
    ghost.traverse(o => { if (o.isMesh) { o.material = ghostOk; o.castShadow = false; o.receiveShadow = false; o.renderOrder = 19; } else if (o.isLine || o.isLineSegments) o.visible = false; });
    ghost.matrixAutoUpdate = false; scene.add(ghost); item.group.visible = false;
  }
  /* from where its shapes were drawn (g0) to s: moved, turned and stretched */
  function matrixFor(s) {
    const T = new THREE.Matrix4(), y0 = P([0, 0], item.base).y, c0 = P(g0.c, item.base), c1 = P(s.c, (s.base ?? item.base) + (s.lift || 0));
    return T.makeTranslation(-c0.x, -y0, -c0.z)
      .premultiply(new THREE.Matrix4().makeRotationY(-rad(g0.a)))
      .premultiply(new THREE.Matrix4().makeScale(s.L / g0.L, g0.H ? s.H / g0.H : 1, s.W / g0.W))
      .premultiply(new THREE.Matrix4().makeRotationY(rad(s.a)))
      .premultiply(new THREE.Matrix4().makeTranslation(c1.x, c1.y, c1.z));
  }
  function poseOn(o, s) { o.matrixAutoUpdate = false; o.matrix.copy(matrixFor(s)); o.matrixWorldNeedsUpdate = true; }
  function poseGhost(s) {
    poseOn(ghost, s);
    const g = P(s.c, ground(...s.c) + 0.05); shadow.position.copy(g); shadow.rotation.y = rad(s.a); shadow.scale.set(s.L * 1.25, 1, s.W * 1.25); shadow.visible = true;
    shadow.material.opacity = 0.35 + 0.4 * Math.min(1, (s.lift || 0) / 0.8);
  }
  function clearGuides() { for (const l of guides.children.splice(0)) l.geometry.dispose(); }
  function drawGuides(list) {
    clearGuides();
    for (const [p, q] of list) { const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([P(p, ground(...p) + 0.3), P(q, ground(...q) + 0.3)]), guideMat); l.computeLineDistances(); l.renderOrder = 22; guides.add(l); }
  }

  /* the eased frame: the ghost goes toward the target, a little each frame, never a jump */
  function tick(t) {
    raf = 0; const dt = Math.min(0.05, (t - (last || t)) / 1000); last = t;
    const f = 1 - Math.exp(-dt * 20), da = wrap(target.a - cur.a);
    cur = { ...cur, c: [cur.c[0] + (target.c[0] - cur.c[0]) * f, cur.c[1] + (target.c[1] - cur.c[1]) * f], a: cur.a + da * f, L: cur.L + (target.L - cur.L) * f, W: cur.W + (target.W - cur.W) * f, H: cur.H + (target.H - cur.H) * f, base: cur.base + (target.base - cur.base) * f, lift: cur.lift + ((op ? 0.6 : 0) - cur.lift) * f };
    if (ghost) poseGhost(cur); else if (real && item) poseOn(item.group, cur);   // real: the thing itself, where it was let go, till the app draws it anew
    place(cur); label(); redraw();
    const still = Math.hypot(target.c[0] - cur.c[0], target.c[1] - cur.c[1]) < 0.005 && Math.abs(da) < 0.05 && Math.abs(target.L - cur.L) + Math.abs(target.W - cur.W) + Math.abs(target.H - cur.H) < 0.005 && Math.abs((op ? 0.6 : 0) - cur.lift) < 0.005 && Math.abs((target.base ?? 0) - (cur.base ?? 0)) < 0.005;
    if (!still) raf = requestAnimationFrame(tick); else { last = 0; if (real && item && back) { item.group.matrix.identity(); item.group.matrixWorldNeedsUpdate = true; real = false; back = false; redraw(); } }
  }
  const go = () => { if (!raf) raf = requestAnimationFrame(tick); };

  /* the numbers by the ghost: the size, the angle, the nearest building; red with why when it does not fit */
  function label() {
    if (!op || !fit) { num.hidden = true; return; }
    const top = P(cur.c, item.base + cur.H + 4).project(camera()), x = (top.x + 1) / 2 * el.clientWidth, y = (1 - top.y) / 2 * el.clientHeight;
    const a = Math.round(((90 - target.a) % 360 + 360) % 360);   // as a compass reads it: 0 north, 90 east
    const st = Math.round(target.H / storey);
    const parts = op.kind === "top" ? [`${st} ${st === 1 ? "etasje" : "etasjer"}`, `${m1(target.H)} m`] : op.kind === "ring" ? [`${a}°`] : op.kind === "end" || op.kind === "side" ? [`${m1(target.L)} × ${m1(target.W)} m`] : [`${m1(target.L)} × ${m1(target.W)} m`, `${a}°`];
    if (fit.near && fit.fits) parts.push(`${m1(fit.near.dist)} m til ${fit.near.name || "nærmeste bygg"}`);
    num.innerHTML = ""; num.append(parts.join(" · "));
    if (!fit.fits) { const w = document.createElement("div"); w.style.color = "#b3261e"; w.textContent = fit.why; num.append(w); }
    num.hidden = false; const hb = host.getBoundingClientRect(), eb = el.getBoundingClientRect();
    num.style.transform = `translate(${Math.round(x + eb.left - hb.left - num.offsetWidth / 2)}px, ${Math.round(y + eb.top - hb.top - num.offsetHeight - 8)}px)`;
  }

  /* a target from the pointer, snapped unless Alt */
  function aimAt(e) {
    const free = e.altKey, s = { ...target, c: target.c.slice() }, o = rest(item.id);
    if (op.kind === "move") { const g = onGround(e); if (!g) return; s.c = [g[0] - op.grab[0], g[1] - op.grab[1]]; }
    else if (op.kind === "ring") { const g = onGround(e); if (!g) return; s.a = deg(Math.atan2(g[1] - s.c[1], g[0] - s.c[0])) - op.grab; }
    else if (op.kind === "end" || op.kind === "side") {
      const g = onGround(e); if (!g) return;
      const u = [Math.cos(rad(s0.a)), Math.sin(rad(s0.a))], v = [-u[1], u[0]], ax = op.kind === "end" ? u : v, sgn = op.i ? 1 : -1, key = op.kind === "end" ? "L" : "W";
      const fixed = [op.from.c[0] - ax[0] * sgn * op.from[key] / 2, op.from.c[1] - ax[1] * sgn * op.from[key] / 2];   // the other end stays
      let len = ((g[0] - fixed[0]) * ax[0] + (g[1] - fixed[1]) * ax[1]) * sgn; len = Math.max(2, free ? len : round(len, 1));
      s[key] = len; s.c = [fixed[0] + ax[0] * sgn * len / 2, fixed[1] + ax[1] * sgn * len / 2];
    } else if (op.kind === "top") {
      const k = pxPerM(), h = op.from.H + (op.y - e.clientY) / k; s.H = Math.max(storey, free ? h : round(h, storey));
    }
    commitTarget(s, free && op.kind !== "top" ? null : op.kind === "move" ? { angle: false } : op.kind === "ring" ? { place: false } : null);
  }
  function commitTarget(s, snap) {
    const o = rest(item.id);
    let g = [];
    if (snap) { const r = snapBody(s, o, snap); s = { ...s, ...r.s }; g = r.guides; }
    s.base = baseFor ? baseFor(toBody(s)) : item.base;
    target = s; fit = fitBody(target, o, lot); drawGuides(g);
    if (ghost) ghost.traverse(m => { if (m.isMesh) m.material = fit.fits ? ghostOk : ghostBad; });
    go();
  }
  function pxPerM() { const cam = camera(), a = P(cur.c, item.base + cur.H).project(cam), b = P(cur.c, item.base + cur.H + 1).project(cam); return Math.max(2, Math.abs(a.y - b.y) / 2 * el.clientHeight); }

  function begin(kind, e, extra = {}) {
    op = { kind, from: { ...target, c: target.c.slice() }, ...extra }; onBusy(true);
    if (kind === "move" || kind === "ring" || kind === "end" || kind === "side" || kind === "top") makeGhost();
    fit = fitBody(target, rest(item.id), lot); go();
  }
  function end(e) {
    if (!op) return;
    const o = op; op = null; onBusy(false); clearGuides(); num.hidden = true;
    const changed = Math.hypot(target.c[0] - o.from.c[0], target.c[1] - o.from.c[1]) > 0.01 || Math.abs(wrap(target.a - o.from.a)) > 0.05 || Math.abs(target.L - o.from.L) + Math.abs(target.W - o.from.W) + Math.abs(target.H - o.from.H) > 0.01;
    if (!changed || !fit?.fits) { if (changed && fit && !fit.fits) tipOut(`${fit.why}: satt tilbake`); restore(o.from); return; }
    finish(o.kind, o.from, o.keys ? o.by : o.free ? "click" : "drag");
  }
  /* let go: the thing itself takes the ghost's place, size and angle in this frame and stays there (pm 23:58Z, Morten
     «it snapped to previous position then to the new one»); the app's answer either draws it anew there, or refuses
     and it eases back with why */
  function finish(how, from, by) {
    const body = toBody(target), was = from; s0 = { ...target, c: target.c.slice() };
    if (ghost) { scene.remove(ghost); ghost = null; } shadow.visible = false;
    real = true; back = false; poseOn(item.group, cur); item.group.visible = true; go();
    const id = item.id;
    Promise.resolve(onCommit(id, body, how, by)).then(ok => { if (ok === false && item?.id === id) unpreview(was); }, () => { if (item?.id === id) unpreview(was); });
  }
  /* the Endre fields: the thing goes to body at once, eased; unpreview puts it back when the change is refused */
  function preview(body) {
    if (!item || op) return; const s = bodyOf(body), from = { ...target, c: target.c.slice() };
    target = { ...target, ...s, H: body.height ?? target.H }; target.base = baseFor ? baseFor(toBody(target)) : item.base; s0 = { ...target, c: target.c.slice() }; real = true; back = false; go();
    return () => unpreview(from);
  }
  function unpreview(from) { target = { ...from, c: from.c.slice() }; s0 = { ...target, c: target.c.slice() }; real = true; back = true; go(); }
  function restore(from) { target = { ...from, c: from.c.slice() }; cur = { ...target, lift: 0 }; if (ghost) { scene.remove(ghost); ghost = null; } shadow.visible = false; item.group.visible = true; place(cur); redraw(); }
  function cancel() { if (!op) return; const o = op; op = null; onBusy(false); clearGuides(); num.hidden = true; restore(o.from); }
  let tipEl = null;
  function tipOut(t) { tipEl?.remove(); tipEl = Object.assign(document.createElement("div"), { textContent: t }); tipEl.style.cssText = num.style.cssText + ";color:#b3261e"; tipEl.style.transform = num.style.transform; host.append(tipEl); setTimeout(() => tipEl?.remove(), 1800); }

  /* the pointer: a press on a handle or on the picked body starts a drag, before the app's orbit */
  function handleAt(e) {
    const r = aim(e); const h = r.intersectObjects(all.filter(m => m.visible), false)[0]; if (h) return h.object.userData.h;
    const b = r.intersectObject(item.group, true).find(x => x.object.isMesh); return b ? ["body", b.point] : null;
  }
  function down(e) {
    if (!item) return;
    if (op && op.kind === "move" && op.free) { e.stopImmediatePropagation(); e.preventDefault(); if (e.button === 2) cancel(); else op.press = { x: e.clientX, y: e.clientY }; return; }
    if (e.button !== 0 || e.shiftKey) return;
    const h = handleAt(e); if (!h) return;
    e.stopImmediatePropagation(); e.preventDefault(); el.setPointerCapture?.(e.pointerId);
    const g = onGround(e) || target.c;
    if (h[0] === "body") begin("move", e, { grab: [g[0] - target.c[0], g[1] - target.c[1]], press: { x: e.clientX, y: e.clientY } });
    else if (h[0] === "ring") begin("ring", e, { grab: deg(Math.atan2(g[1] - target.c[1], g[0] - target.c[0])) - target.a });
    else if (h[0] === "top") begin("top", e, { y: e.clientY });
    else begin(h[0], e, { i: h[1] });
  }
  function move(e) {
    if (!op) { if (item && !e.buttons && e.target === el) el.style.cursor = handleAt(e) ? "grab" : ""; return; }
    aimAt(e);
  }
  function up(e) {
    if (!op) return;
    if (op.free) { if (op.press && Math.hypot(e.clientX - op.press.x, e.clientY - op.press.y) < 6) end(e); else op.press = null; return; }
    end(e);
  }
  /* «Flytt» from the card: the ghost follows the pointer with no button held, a click places it */
  function moveFree(it) { if (it && it !== item) attach(it); if (!item) return; begin("move", null, { free: true, grab: [0, 0] }); }

  /* keys: R a quarter, Q and E 15° (Alt 1°), arrows 1 m (Shift 5) along the screen; Esc puts it back */
  /* the keys are the view's only while the pointer is over it: an arrow in a list beside it (a storey strip) is the list's
     (pm 23:30Z: two moves came that no one meant) */
  let over = false; const enter = () => { over = true; }, leave = () => { over = false; };
  function key(e) {
    if (!item || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName) || e.target?.isContentEditable || e.metaKey || e.ctrlKey) return;
    if (!over && !op) return;
    if (e.key === "Escape" && op) { cancel(); e.preventDefault(); e.stopImmediatePropagation(); return; }
    const k = e.key.toLowerCase(), turn = k === "r" ? -90 : k === "q" ? (e.altKey ? 1 : 15) : k === "e" ? -(e.altKey ? 1 : 15) : 0;
    const arrows = { arrowup: [0, 1], arrowdown: [0, -1], arrowleft: [-1, 0], arrowright: [1, 0] }[k];
    if (!turn && !arrows) return;
    e.preventDefault(); e.stopImmediatePropagation();
    const s = { ...target, c: target.c.slice() };
    if (turn) s.a = wrap(e.altKey ? s.a + turn : round(s.a + turn, Math.abs(turn) === 90 ? 1 : 15));
    else {
      const cam = camera(), f = new THREE.Vector3(); cam.getWorldDirection(f); let fw = [f.x, -f.z]; const n = Math.hypot(...fw); fw = n > 0.2 ? [fw[0] / n, fw[1] / n] : [0, 1];   // straight down (the plan): north
      const rt = [fw[1], -fw[0]], d = e.shiftKey ? 5 : 1; s.c = [s.c[0] + (rt[0] * arrows[0] + fw[0] * arrows[1]) * d, s.c[1] + (rt[1] * arrows[0] + fw[1] * arrows[1]) * d];
    }
    run(s, turn ? "ring" : "move", "keys");
  }
  /* a run of keys or wheel turns is one change, taken when they stop */
  function run(s, kind = "move", by = "keys") {
    if (op && !op.keys) { commitTarget(s, null); return; }
    if (!keyRun) { keyRun = { from: { ...target, c: target.c.slice() } }; makeGhost(); onBusy(true); op = { kind, from: keyRun.from, keys: true, by }; }
    else if (op.kind !== kind) op.kind = "move";   // turned and moved: one change, a move
    commitTarget(s, null); clearTimeout(keyRun.t);
    keyRun.t = setTimeout(() => { keyRun = null; end(); }, 700);
  }
  function wheel(e) {
    if (!item || !e.shiftKey || (op && !op.keys && op.kind !== "move")) return;
    e.preventDefault(); e.stopImmediatePropagation();
    const s = { ...target, c: target.c.slice(), a: wrap(target.a - (e.deltaY || e.deltaX) * 0.15) }; run(s, "ring", "wheel");
  }
  const menu = e => { if (op) { e.preventDefault(); cancel(); } };

  el.addEventListener("pointerdown", down, true); addEventListener("pointermove", move); addEventListener("pointerup", up, true);
  addEventListener("keydown", key, true); el.addEventListener("wheel", wheel, { capture: true, passive: false }); el.addEventListener("contextmenu", menu, true);
  el.addEventListener("pointerenter", enter); el.addEventListener("pointerleave", leave);
  return {
    attach, detach, move: moveFree, cancel, preview, get busy() { return !!op; }, get item() { return item; },
    frame() { if (item) place(cur); },
    destroy() { detach(); scene.remove(G, shadow, guides); num.remove(); el.removeEventListener("pointerdown", down, true); removeEventListener("pointermove", move); removeEventListener("pointerup", up, true); removeEventListener("keydown", key, true); el.removeEventListener("wheel", wheel, true); el.removeEventListener("contextmenu", menu, true); el.removeEventListener("pointerenter", enter); el.removeEventListener("pointerleave", leave); },
  };
}
