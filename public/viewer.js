/* The site in 3D: terrain, the lot, the buildings, the sun. Shared by the web page (app.js) and the chat app (mcp-app.js).

   Drawn from site.json (tools/site.mjs): metres east and north of an origin, heights above sea level. In three.js
   x is east, z is south (-north) and y is up, with y = 0 at the lowest terrain, so the numbers stay small.
   Buildings on the lot get their roofs from the laser surface (one quad per 2 m cell, corners shared, so a 14-storey
   block over a 4-storey wing reads as it stands), walls from their outline up to the roof next to each edge. Other
   buildings are plain boxes to their laser top. building:parts on an outline (cut) are left out of its roof: they
   are buildings of their own.

   Floors (floors.json, tools/floors.mjs) are the drawings' walls stood from their kote. Showing a floor cuts the
   buildings on the lot 1.2 m above it, as a plan is cut, and lays a floor plate in each of them at that level.
   The plan view looks straight down, north up, without perspective, so a scale bar holds. */
import * as THREE from "./vendor/three.module.js";
import { sunPosition } from "./sun.js";

const C = { ground: "#c9cdb8", lot: "#c8102e", wall: "#ece6da", roof: "#8b8f94", own: "#f4efe4", nb: "#d9d6cf", nbRoof: "#a7a6a2", pick: "#ffcf33", sky: "#dfe8ee", cutWall: "#55524d", plate: "#e8e2d4", flatRoof: "#9a9890" };

export function createViewer({ container, site, floors = [], lat = 59.749, lon = 10.198, onPick = () => {}, onView = () => {} }) {
  const T = site.terrain, base = Math.min(...T.z.filter(v => v != null));
  const at = (grid, x, y) => { const c = Math.floor((x - T.x0) / T.res), r = Math.floor((T.y1 - y) / T.res); if (c < 0 || r < 0 || c >= T.w || r >= T.h) return null; return grid[r * T.w + c]; };
  const ground = (x, y) => at(T.z, x, y) ?? base;
  const P = ([x, y], h) => new THREE.Vector3(x, h - base, -y);

  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio)); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.localClippingEnabled = true;
  container.appendChild(renderer.domElement); renderer.domElement.style.cssText = "display:block;width:100%;height:100%;touch-action:none";
  const scene = new THREE.Scene(); scene.background = new THREE.Color(C.sky);
  const persp = new THREE.PerspectiveCamera(40, 1, 1, 4000), ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 4000);
  let camera = persp, mode = "3d";
  const sky = new THREE.HemisphereLight("#f3f6ff", "#8d8f80", 2.2); scene.add(sky);
  const sunL = new THREE.DirectionalLight("#fff6e8", 2.2); sunL.castShadow = true; sunL.shadow.mapSize.set(4096, 4096);
  Object.assign(sunL.shadow.camera, { left: -260, right: 260, top: 260, bottom: -260, near: 10, far: 1500 }); sunL.shadow.bias = -0.0004; sunL.shadow.normalBias = 0.6;
  scene.add(sunL, sunL.target);
  const mat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, side: THREE.DoubleSide, ...o });

  /* ---------- terrain ---------- */
  {
    const pos = [], idx = [];
    for (let r = 0; r < T.h; r++) for (let c = 0; c < T.w; c++) { const z = T.z[r * T.w + c] ?? base; pos.push(T.x0 + (c + 0.5) * T.res, z - base - 0.05, -(T.y1 - (r + 0.5) * T.res)); }
    for (let r = 0; r < T.h - 1; r++) for (let c = 0; c < T.w - 1; c++) { const a = r * T.w + c; idx.push(a, a + T.w, a + 1, a + 1, a + T.w, a + T.w + 1); }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat(C.ground)); m.receiveShadow = true; scene.add(m);
    const lot = site.lot.ring.map(p => P(p, ground(...p) + 0.25));
    scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(lot), new THREE.LineDashedMaterial({ color: C.lot, dashSize: 2, gapSize: 1.2 })).computeLineDistances());
  }

  /* ---------- buildings ---------- */
  const inRing = ([x, y], r) => { let o = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [a, b] = r[i], [e, f] = r[j]; if ((b > y) !== (f > y) && x < (e - a) * (y - b) / (f - b) + a) o = !o; } return o; };
  const meshes = new Map();
  function wallsTo(ring, b0, topAt, m) {
    const pos = [];
    for (let i = 0; i < ring.length - 1; i++) {
      const [ax, ay] = ring[i], [bx, by] = ring[i + 1], len = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.ceil(len / T.res));
      for (let k = 0; k < n; k++) {
        const t0 = k / n, t1 = (k + 1) / n, p0 = [ax + (bx - ax) * t0, ay + (by - ay) * t0], p1 = [ax + (bx - ax) * t1, ay + (by - ay) * t1];
        const h = topAt([(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2], [(by - ay) / len, -(bx - ax) / len]);
        const a = P(p0, b0), b = P(p1, b0), c = P(p1, h), d = P(p0, h);
        pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, a.x, a.y, a.z, c.x, c.y, c.z, d.x, d.y, d.z);
      }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
    const w = new THREE.Mesh(g, m); w.castShadow = w.receiveShadow = true; return w;
  }
  /* facades as the documents describe them (LVPH 2012): the high-rise in natural concrete elements, the other wings
     in rendered, white-painted concrete; a window to every 2.5 m bay of a 3.5 m storey, drawn once and repeated */
  function facade(base, frame, glass) {
    const cv = document.createElement("canvas"); cv.width = 128; cv.height = 180; const g = cv.getContext("2d");
    g.fillStyle = base; g.fillRect(0, 0, 128, 180);
    g.fillStyle = frame; g.fillRect(24, 50, 80, 82); g.fillStyle = glass; g.fillRect(28, 54, 72, 74);
    g.fillStyle = "rgba(0,0,0,.06)"; g.fillRect(0, 176, 128, 4);
    const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
  }
  const BAY = 2.5, STOREY = 3.5;
  const wallTex = { render: facade("#f1eee6", "#d9d4ca", "#5d6a73"), concrete: facade("#cfc9bd", "#b8b2a6", "#4f5b63") };
  /* a building on the lot as blocks (tools/massing.py): flat roofs, and walls only where the roof steps down or the
     building ends, with the facade counted in bays and storeys from the base so the windows line up */
  function blocksMesh(b, tex) {
    const pos = [], uv = [], roof = [], b0 = b.base - 0.5;
    for (const [ax, ay, bx, by, lo, top] of b.walls || []) {
      const bot = lo ?? b0, len = Math.hypot(bx - ax, by - ay), along = (ax * (bx - ax) + ay * (by - ay)) / len / BAY;   // bays counted along the wall's line, so the walls on one line share them
      const A = P([ax, ay], bot), B = P([bx, by], bot), Cc = P([bx, by], top), D = P([ax, ay], top), u0 = along, u1 = along + len / BAY, v0 = (bot - b.base) / STOREY, v1 = (top - b.base) / STOREY;
      pos.push(A.x, A.y, A.z, B.x, B.y, B.z, Cc.x, Cc.y, Cc.z, A.x, A.y, A.z, Cc.x, Cc.y, Cc.z, D.x, D.y, D.z);
      uv.push(u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1);
    }
    for (const k of b.blocks) {
      const top = k.top, p = k.p;
      const q = p.map(pt => P(pt, top));
      roof.push(...[q[0], q[1], q[2], q[0], q[2], q[3]].flatMap(v => [v.x, v.y, v.z]));
    }
    const grp = new THREE.Group();
    const wg = new THREE.BufferGeometry(); wg.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); wg.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); wg.computeVertexNormals();
    const walls = new THREE.Mesh(wg, mat("#ffffff", { map: tex })); walls.castShadow = walls.receiveShadow = true; grp.add(walls);
    const rg = new THREE.BufferGeometry(); rg.setAttribute("position", new THREE.Float32BufferAttribute(roof, 3));
    rg.setAttribute("normal", new THREE.Float32BufferAttribute(roof.map((_, i) => i % 3 === 1 ? 1 : 0), 3));   // flat roofs face up
    const r = new THREE.Mesh(rg, mat(C.flatRoof)); r.castShadow = r.receiveShadow = true; grp.add(r);
    return grp;
  }
  for (const b of site.buildings) {
    const grp = new THREE.Group(), b0 = b.base - 0.5, ring = b.ring;
    if (b.own && b.blocks?.length) grp.add(blocksMesh(b, b.top - b.base > 40 ? wallTex.concrete : wallTex.render));
    else if (!b.own || b.top == null) {
      const top = b.top ?? b.base + (b.osmHeight || (b.levels || 2) * 3);
      grp.add(wallsTo(ring, b0, () => top, mat(b.own ? C.own : C.nb)));
      const shape = new THREE.Shape(ring.map(([x, y]) => new THREE.Vector2(x, y)));
      const lid = new THREE.Mesh(new THREE.ShapeGeometry(shape), mat(b.own ? C.roof : C.nbRoof)); lid.rotation.x = -Math.PI / 2; lid.position.y = top - base; lid.castShadow = lid.receiveShadow = true; grp.add(lid);
    } else {
      /* the roof: laser cells inside the outline and not under a part on it */
      const cells = new Map(), xs = ring.map(p => p[0]), ys = ring.map(p => p[1]), cut = b.cut || [];
      const c0 = Math.max(0, Math.floor((Math.min(...xs) - T.x0) / T.res)), c1 = Math.min(T.w - 1, Math.floor((Math.max(...xs) - T.x0) / T.res));
      const r0 = Math.max(0, Math.floor((T.y1 - Math.max(...ys)) / T.res)), r1 = Math.min(T.h - 1, Math.floor((T.y1 - Math.min(...ys)) / T.res));
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
        const p = [T.x0 + (c + 0.5) * T.res, T.y1 - (r + 0.5) * T.res], z = T.surface[r * T.w + c];
        if (z == null || !inRing(p, ring) || cut.some(q => inRing(p, q))) continue;
        cells.set(r * T.w + c, Math.max(z, b.base + 2.2));
      }
      const roofAt = (p, nrm) => { for (const d of [1.2, 2.5, 4]) { const q = [p[0] - nrm[0] * d, p[1] - nrm[1] * d], c = Math.floor((q[0] - T.x0) / T.res), r = Math.floor((T.y1 - q[1]) / T.res), z = cells.get(r * T.w + c); if (z != null) return z; } return b.top; };
      if (cells.size) {
        grp.add(wallsTo(ring, b0, (p, nrm) => { const s = [1, -1].map(k => roofAt(p, [nrm[0] * k, nrm[1] * k])); return Math.min(...s.filter(v => v != null)) || b.top; }, mat(C.own)));
        const pos = [], corner = (k, dc, dr) => { const ks = [k, k + dc, k + dr * T.w, k + dc + dr * T.w].filter(q => cells.has(q)); return Math.max(...ks.map(q => cells.get(q))); };
        for (const [k, z] of cells) {
          const r = Math.floor(k / T.w), c = k % T.w, x0 = T.x0 + c * T.res, x1 = x0 + T.res, y0 = T.y1 - r * T.res, y1 = y0 - T.res;
          const h00 = corner(k, -1, -1), h10 = corner(k, 1, -1), h01 = corner(k, -1, 1), h11 = corner(k, 1, 1), flat = Math.max(h00, h10, h01, h11) - Math.min(h00, h10, h01, h11) > 2.5;
          const q = flat ? [z, z, z, z] : [h00, h10, h01, h11], v = [P([x0, y0], q[0]), P([x1, y0], q[1]), P([x0, y1], q[2]), P([x1, y1], q[3])];
          pos.push(...[v[0], v[2], v[1], v[1], v[2], v[3]].flatMap(p => [p.x, p.y, p.z]));
        }
        const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
        const roof = new THREE.Mesh(g, mat(C.roof)); roof.castShadow = roof.receiveShadow = true; grp.add(roof);
      }
    }
    grp.userData.id = b.id; grp.traverse(o => { o.userData.id = b.id; }); scene.add(grp); meshes.set(b.id, grp);
  }

  /* ---------- floors: walls from the drawings, a floor plate in each building on the lot, the cut above ---------- */
  const cut = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e6), floorGroups = new Map();
  for (const f of floors) {
    const grp = new THREE.Group(), wm = mat(C.cutWall, { clippingPlanes: [cut] }), pm = mat(C.plate);
    for (const r of f.walls) {
      const g = new THREE.ExtrudeGeometry(new THREE.Shape(r.map(([x, y]) => new THREE.Vector2(x, y))), { depth: f.height, bevelEnabled: false });
      const w = new THREE.Mesh(g, wm); w.rotation.x = -Math.PI / 2; w.position.y = f.kote - base; w.castShadow = w.receiveShadow = true; grp.add(w);
    }
    for (const b of site.buildings) {
      if (!b.own || b.base >= f.kote || (b.top ?? 0) <= f.kote) continue;
      const plate = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(b.ring.map(([x, y]) => new THREE.Vector2(x, y)))), pm);
      plate.rotation.x = -Math.PI / 2; plate.position.y = f.kote - base - 0.02; plate.receiveShadow = true; grp.add(plate);
    }
    const xs = f.walls.flat().map(p => p[0]), ys = f.walls.flat().map(p => p[1]);
    grp.userData = { centre: [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2], size: Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) };
    grp.visible = false; scene.add(grp); floorGroups.set(f.id, grp);
  }
  /* the rooms' stamps from the drawing, as on the sheet: name, and the area under it, left edge at the stamp.
     A stamp that would overlap one already placed gives way; larger rooms are placed first. */
  const tags = document.createElement("div"); tags.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:hidden;font:12px/1.15 -apple-system,'Helvetica Neue',Arial,sans-serif;color:#23211e";
  if (getComputedStyle(container).position === "static") container.style.position = "relative";
  container.appendChild(tags);
  const roomTags = new Map(floors.map(f => [f.id, (f.rooms || []).map(r => {
    const el = document.createElement("div"); el.style.cssText = "position:absolute;left:0;top:0;white-space:nowrap;text-shadow:0 0 3px #fffbf0,0 0 3px #fffbf0";
    el.innerHTML = `<b style="font-weight:600">${r.name.replace(/</g, "&lt;")}</b>` + (r.area_m2 ? `<br>${r.area_m2.toLocaleString("nb-NO", { minimumFractionDigits: 1 })} m²` : "");
    tags.appendChild(el); return { el, at: P(r.at, f.kote + 0.05), area: r.area_m2 || 0 };
  }).sort((a, b) => b.area - a.area)]));
  const v3 = new THREE.Vector3();
  function placeTags() {
    const w = container.clientWidth, h = container.clientHeight, close = mode === "plan" ? view().mPerPx < 0.09 : O.dist < 150, placed = [];
    for (const [id, list] of roomTags) for (const t of list) {
      if (id !== floor || !close) { t.el.style.display = "none"; continue; }
      v3.copy(t.at).project(camera);
      const x = (v3.x + 1) / 2 * w, y = (1 - v3.y) / 2 * h;
      if (v3.z > 1 || x < -100 || y < -30 || x > w + 10 || y > h + 30) { t.el.style.display = "none"; continue; }
      t.el.style.display = "block"; t.size ??= [t.el.offsetWidth, t.el.offsetHeight];
      const box = [x - 2, y - 14 - 2, x + t.size[0] + 2, y - 14 + t.size[1] + 2];
      if (placed.some(b => box[0] < b[2] && b[0] < box[2] && box[1] < b[3] && b[1] < box[3])) { t.el.style.display = "none"; continue; }
      placed.push(box); t.el.style.transform = `translate(${x.toFixed(0)}px, ${(y - 14).toFixed(0)}px)`;
    }
  }
  let floor = null;
  function setFloor(id) {
    for (const [k, g] of floorGroups) g.visible = k === id;
    const f = floors.find(x => x.id === id); floor = f ? id : null;
    cut.constant = f ? f.kote + 1.2 - base : 1e6;
    if (f) { const g = floorGroups.get(id).userData; Object.assign(O, { x: g.centre[0], y: g.centre[1], h: f.kote - base, dist: Math.max(70, g.size * 1.3) }); place(); }
    dirty = true;
  }

  /* ---------- camera: orbit around a point, or straight down for the plan ---------- */
  const lotC = site.lot.ring.reduce((a, p) => [a[0] + p[0] / site.lot.ring.length, a[1] + p[1] / site.lot.ring.length], [0, 0]);
  const O = { x: lotC[0], y: lotC[1], h: ground(...lotC) - base + 15, yaw: Math.PI * 0.8, pitch: 0.62, dist: 380 };
  function place() {
    const t = new THREE.Vector3(O.x, O.h, -O.y), cp = Math.cos(O.pitch);
    if (mode === "plan") {
      const w = container.clientWidth || 600, h = container.clientHeight || 400, half = O.dist * 0.36;
      Object.assign(ortho, { left: -half * w / h, right: half * w / h, top: half, bottom: -half }); ortho.updateProjectionMatrix();
      ortho.position.set(t.x, 1500, t.z); ortho.up.set(0, 0, -1); ortho.lookAt(t.x, 0, t.z);
    } else { camera.position.set(t.x + O.dist * cp * Math.sin(O.yaw), t.y + O.dist * Math.sin(O.pitch), t.z + O.dist * cp * Math.cos(O.yaw)); camera.lookAt(t); }
    dirty = true; onView(view());
  }
  /* what the page shows around the picture: the north arrow's turn, and in the plan the metres per screen pixel */
  function view() { return { mode, floor, north: mode === "plan" ? 0 : O.yaw, mPerPx: mode === "plan" ? O.dist * 0.72 / (container.clientHeight || 400) : null }; }
  /* the plan reads as a drawing: even light, no cast shadows */
  function setMode(m) { mode = m === "plan" ? "plan" : "3d"; camera = mode === "plan" ? ortho : persp; sunL.castShadow = mode !== "plan"; sky.intensity = mode === "plan" ? 2.8 : 2.2; place(); }
  const el = renderer.domElement, pts = new Map();
  let drag = null, dirty = true;
  el.addEventListener("pointerdown", e => { el.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]); drag = { x: e.clientX, y: e.clientY, moved: 0, pan: e.button === 2 || e.shiftKey, pinch: pts.size === 2 ? pinchOf() : null }; });
  el.addEventListener("pointermove", e => {
    if (!drag || !pts.has(e.pointerId)) return; pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 2) { const p = pinchOf(); if (drag.pinch) { O.dist = Math.max(30, Math.min(1200, O.dist * drag.pinch.d / p.d)); pan(p.x - drag.pinch.x, p.y - drag.pinch.y); } drag.pinch = p; drag.moved += 10; place(); return; }
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY; drag.moved += Math.abs(dx) + Math.abs(dy);
    if (drag.pan || mode === "plan") pan(dx, dy); else { O.yaw -= dx * 0.006; O.pitch = Math.max(0.08, Math.min(1.53, O.pitch + dy * 0.005)); }
    place();
  });
  const up = e => { pts.delete(e.pointerId); if (drag && drag.moved < 6 && !pts.size) pick(e); if (!pts.size) drag = null; };
  el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up); el.addEventListener("contextmenu", e => e.preventDefault());
  /* a trackpad as in Maps: two fingers move the view the way the fingers go, a pinch zooms. Chrome and Firefox send
     the pinch as a wheel with ctrlKey, Safari as gesture events (and no wheel). A wheel in lines or pages is a mouse
     and zooms; a mouse on a Mac sends pixels like a trackpad, so it moves the view, and the + and - buttons zoom. */
  let gesture = null;
  el.addEventListener("wheel", e => {
    e.preventDefault();
    if (gesture) return;
    if (e.ctrlKey) zoom(Math.exp(e.deltaY * 0.01), e);
    else if (e.deltaMode !== 0) zoom(Math.exp(e.deltaY * (e.deltaMode === 1 ? 0.06 : 0.6)), e);
    else { pan(-e.deltaX, -e.deltaY); place(); }
  }, { passive: false });
  /* on an iPad the same gesture events come with the touches, which the pointer handlers already zoom */
  el.addEventListener("gesturestart", e => { e.preventDefault(); gesture = pts.size ? null : { dist: O.dist }; });
  el.addEventListener("gesturechange", e => { e.preventDefault(); if (gesture) zoom(gesture.dist / (e.scale || 1) / O.dist, e); });
  el.addEventListener("gestureend", e => { e.preventDefault(); gesture = null; });
  /* zoom by a factor on the distance; in the plan the ground under the pointer stays put */
  function zoom(f, at) {
    const d = Math.max(30, Math.min(1200, O.dist * f)); f = d / O.dist;
    if (mode === "plan" && at && at.clientX != null) {
      const r = el.getBoundingClientRect(), m = O.dist * 0.72 / (r.height || 400);
      O.x += (at.clientX - r.left - r.width / 2) * m * (1 - f); O.y -= (at.clientY - r.top - r.height / 2) * m * (1 - f);
    }
    O.dist = d; place();
  }
  function pinchOf() { const [a, b] = [...pts.values()]; return { d: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2 }; }
  /* drag the ground under the pointer: screen right is (cos yaw, sin yaw) east/north, screen up (away from the
     camera) is (-sin yaw, cos yaw); the centre moves against the pointer, so the ground goes with it */
  function pan(dx, dy) { const k = mode === "plan" ? O.dist * 0.72 / (container.clientHeight || 400) : O.dist * 0.0016, yaw = mode === "plan" ? 0 : O.yaw, s = Math.sin(yaw), c = Math.cos(yaw); O.x += (-dx * c - dy * s) * k; O.y += (-dx * s + dy * c) * k; }

  /* ---------- picking ---------- */
  const ray = new THREE.Raycaster(); let selected = null;
  function pick(e) {
    const r = el.getBoundingClientRect(); ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
    const hit = ray.intersectObjects([...meshes.values()], true)[0]; select(hit?.object.userData.id || null); onPick(selected);
  }
  function select(id) {
    if (selected) meshes.get(selected)?.traverse(o => o.material?.emissive?.set("#000"));
    selected = id && meshes.has(id) ? id : null;
    if (selected) meshes.get(selected).traverse(o => o.material?.emissive?.set("#6b5200"));
    dirty = true;
  }
  /* materials are shared within a building, so a building's own copies (made once) light up alone */
  for (const g of meshes.values()) g.traverse(o => { if (o.material) o.material = o.material.clone(); });
  for (const b of site.buildings) if (b.own) meshes.get(b.id)?.traverse(o => { if (o.material) o.material.clippingPlanes = [cut]; });

  /* ---------- sun ---------- */
  function setSun(date) {
    const s = sunPosition(date, lat, lon), az = s.azimuth * Math.PI / 180, el = Math.max(s.elevation, 1) * Math.PI / 180, d = 700;
    sunL.position.set(O.x + d * Math.cos(el) * Math.sin(az), d * Math.sin(el), -O.y - d * Math.cos(el) * Math.cos(az)); sunL.target.position.set(O.x, 0, -O.y);
    sunL.intensity = s.elevation > 0 ? 2.2 : 0.15; dirty = true; return s;
  }

  /* ---------- drawing ---------- */
  function size() { const w = container.clientWidth || 600, h = container.clientHeight || 400; renderer.setSize(w, h, false); persp.aspect = w / h; persp.updateProjectionMatrix(); place(); }
  new ResizeObserver(size).observe(container); size(); place();
  renderer.setAnimationLoop(() => { if (dirty) { renderer.render(scene, camera); placeTags(); dirty = false; } });

  const home = { ...O };
  return {
    setSun, select, setFloor, setMode, view, get selected() { return selected; },
    zoom(f) { zoom(f); },
    home() { setFloor(null); Object.assign(O, home); place(); },
    pose(p) { if (p) { Object.assign(O, p); place(); } return { ...O }; },
    focus(id) { const b = site.buildings.find(x => x.id === id); if (!b) return; const c = b.ring.reduce((a, p) => [a[0] + p[0] / b.ring.length, a[1] + p[1] / b.ring.length], [0, 0]); Object.assign(O, { x: c[0], y: c[1], h: (b.base + (b.top ?? b.base + 10)) / 2 - base, dist: Math.max(90, Math.sqrt(b.area_m2) * 3.2) }); place(); },
    snapshot() { renderer.render(scene, camera); return renderer.domElement.toDataURL("image/jpeg", 0.85); },
  };
}
