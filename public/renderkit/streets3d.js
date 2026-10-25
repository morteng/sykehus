/* The meshes of streets and what stands on them: kerbed road and path ribbons, fences and walls, street furniture (lamps, benches, bollards, bus stops),
   NVDB crossings, markings, kerbs and islands, tram rails and car parks, from the items streets.js makes. Moved from hagekart public/streets3d.js (U3530),
   which had split it out of garden3d.js.
   Every call takes the app's frame F: F.L([x, y]) -> [lx, lz] local metres (x east, z south, y up); F.ground(x, y) the ground's local height at a
   UTM point; F.cellAt(x, y) >= 0 inside the drawn area, else -1 (street furniture outside is dropped); F.toUtm([lon, lat]) -> [x, y] in the app's
   UTM (an arrow function: it is passed to map); F.streetCtx = streetContext(F, items), set by the app once the street items are in.
   createStreetMeshes(options): pathTexture(surface) a texture per surface key (PATHS), breakTiling(material) -> material, PATHLIFT metres paths lie
   above the ground, kerbTex() the kerb top's texture or null. Each has a plain default, so an app without hagekart's pictures gets flat colours. */
import * as THREE from "../vendor/three.module.js";
import { smoothPath, pointInRing } from "./paths2d.js";
import { MARKINGS, FENCE_TYPES, ROAD_TYPES, PATHS, runs, nearestRoad, crossSection } from "./streetnorms.js";

/* The default path picture: one pixel of the surface's base colour (hagekart's own pictures' ground colour), tinted by PATHS[surface].c like theirs. */
const FLAT = { asphalt: "#7b7d80", slabs: "#d2cfc8", cobble: "#8e8a83", gravel: "#cfa98c", sand: "#e9d8a8" }, flatTex = {};
function flatTexture(surface) {
  if (flatTex[surface]) return flatTex[surface];
  const h = parseInt((FLAT[surface] || FLAT.gravel).slice(1), 16), t = new THREE.DataTexture(new Uint8Array([h >> 16, (h >> 8) & 255, h & 255, 255]), 1, 1);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true; return (flatTex[surface] = t);
}

/* How the street pieces meet (see blocker below), from the street items: carriageways with their half widths and boxes, NVDB crossings
   (gangfelt polygons) and lowered kerbs (nedsenka). trunks (tree trunks the kerbs stop at, {x, y, r} UTM) is the app's to fill. Moved from
   hagekart garden3d.js. Each item gets sid = its index (the blocker skips a road's own carriageway). */
export function streetContext(F, sts) {
  sts.forEach((q, i) => { q.sid = i; });
  return { trunks: [], lowered: sts.filter(q => q.kind === "nvdb" && q.t === "nedsenka" && q.geo.type === "Point").map(q => F.toUtm(q.geo.coordinates)), zebras: sts.filter(q => q.kind === "nvdb" && q.t === "gangfelt" && q.geo.type === "Polygon").map(q => { const ring = q.geo.coordinates[0].map(F.toUtm).slice(0, -1), xs = ring.map(p => p[0]), ys = ring.map(p => p[1]); return { ring, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }; }), roads: sts.filter(q => q.kind === "road").map(q => { const pts = q.pts.map(F.toUtm), xs = pts.map(p => p[0]), ys = pts.map(p => p[1]), hw = (q.width || 5.5) / 2; return { sid: q.sid, pts, hw, x0: Math.min(...xs) - hw, x1: Math.max(...xs) + hw, y0: Math.min(...ys) - hw, y1: Math.max(...ys) + hw }; }) };
}

export function createStreetMeshes({ pathTexture = flatTexture, breakTiling = m => m, PATHLIFT = 0.045, kerbTex = () => null } = {}) {
  function strip(F, sm, lift, off0, off1, norm) {   // a ribbon between two offsets, cut into columns of at most 0.4 m so it follows the ground across as well as along
    const pos = [], uv = [], idx = [], cols = Math.max(1, Math.ceil((off1 - off0) / 0.4 - 1e-6)), W = cols + 1;
    for (const p of sm) for (let c = 0; c < W; c++) {
      const o = off0 + (off1 - off0) * c / cols, x = p.x - p.ty * o, y = p.y + p.tx * o, [lx, lz] = F.L([x, y]);
      pos.push(lx, F.ground(x, y) + lift + PATHLIFT, lz); uv.push(norm ? p.s / norm[0] : p.s, norm ? (o - off0) / (off1 - off0) : o);
    }
    for (let i = 0; i < sm.length - 1; i++) for (let c = 0; c < cols; c++) { const a = i * W + c, b = a + W; idx.push(a, a + 1, b, a + 1, b + 1, b); }
    return ribbon(pos, uv, idx);
  }
  function wall(F, sm, off, yLow, yHigh) {   // a vertical face at one offset, from yLow to yHigh above the ground
    const pos = [], uv = [], idx = [];
    for (const p of sm) { const x = p.x - p.ty * off, y = p.y + p.tx * off, [lx, lz] = F.L([x, y]), gy = F.ground(x, y) + PATHLIFT; pos.push(lx, gy + yLow, lz, lx, gy + yHigh, lz); uv.push(p.s, 0, p.s, 1); }
    for (let i = 0; i < sm.length - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    return ribbon(pos, uv, idx);
  }
  function ribbon(pos, uv, idx) {
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    return g;
  }
  const dashTex = {};
  const dashTexture = (on, off, color) => {   // one period of the marking: `on` metres of paint, `off` of gap, along u
    const key = `${on}/${off}/${color}`; if (dashTex[key]) return dashTex[key];
    const W = 256, cv = document.createElement("canvas"); cv.width = W; cv.height = 8; const c = cv.getContext("2d"); c.clearRect(0, 0, W, 8); c.fillStyle = color; c.fillRect(0, 0, Math.round(W * on / (on + off)), 8);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping; return (dashTex[key] = t);
  };
  /* What a path is made of. a.type picks a preset from the Norwegian standards (data.js ROAD_TYPES); a's own fields override it. */

  /* Fences: posts every `gap` metres with the infill of the type (pickets, slats, boards, mesh wires, bars, or a solid wall), all following the ground.
     One mesh with vertex colours. A beam is a box from point A to point B with a section w x h, so panels tilt with the slope. */
  function fenceMesh(F, a) {
    const T = FENCE_TYPES[a.type] || FENCE_TYPES.stakitt, H = a.h || T.h, planned = a.st === "planned";
    const pts = (a.pts || []).map(F.toUtm); if (pts.length < 2) return null;
    const pos = [], col = [], cc = new THREE.Color();
    const at = (x, y, up) => { const [lx, lz] = F.L([x, y]); return [lx, F.ground(x, y) + up, lz]; };
    const beam = (A, B, w, h, color, dy = 0) => {
      const d = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], L = Math.hypot(...d) || 1e-6, u = d.map(v => v / L);
      let s = [u[2], 0, -u[0]]; const sl = Math.hypot(s[0], s[2]); s = sl < 1e-6 ? [w / 2, 0, 0] : [s[0] / sl * w / 2, 0, s[2] / sl * w / 2];
      const su = s.map(q => q / (w / 2)), n = [su[1] * u[2] - su[2] * u[1], su[2] * u[0] - su[0] * u[2], su[0] * u[1] - su[1] * u[0]], nl = Math.hypot(...n) || 1, v = n.map(q => (q / nl) * h / 2 * (n[1] < 0 ? -1 : 1));
      const c = (i, j, k) => [A[0] + (B[0] - A[0]) * i + s[0] * j + v[0] * k, A[1] + (B[1] - A[1]) * i + s[1] * j + v[1] * k + dy, A[2] + (B[2] - A[2]) * i + s[2] * j + v[2] * k];
      const P = [[0, -1, -1], [1, -1, -1], [1, 1, -1], [0, 1, -1], [0, -1, 1], [1, -1, 1], [1, 1, 1], [0, 1, 1]].map(q => c(...q));
      cc.set(color);
      for (const f of [[0, 1, 2, 3], [4, 7, 6, 5], [0, 4, 5, 1], [3, 2, 6, 7], [0, 3, 7, 4], [1, 5, 6, 2]]) for (const k of [0, 1, 2, 0, 2, 3]) { pos.push(...P[f[k]]); col.push(cc.r, cc.g, cc.b); }
    };
    const spear = (x, y, h) => {   // a small four-sided point on top of a bar (Palace Park railing)
      const b = at(x, y, h), w = 0.02, tip = [b[0], b[1] + 0.09, b[2]]; cc.set(T.color);
      const c = [[-w, 0, -w], [w, 0, -w], [w, 0, w], [-w, 0, w]].map(q => [b[0] + q[0], b[1], b[2] + q[2]]);
      for (let i = 0; i < 4; i++) { pos.push(...c[i], ...c[(i + 1) % 4], ...tip); col.push(cc.r, cc.g, cc.b, cc.r, cc.g, cc.b, cc.r, cc.g, cc.b); }
    };
    const post = (x, y, h) => { if (T.post) beam(at(x, y, -0.25), at(x, y, h), T.post, T.post, T.post_c); };
    const seg = (x0, y0, x1, y1) => {
      const len = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.round(len / T.gap)), step = len / n;
      const Q = t => [x0 + (x1 - x0) * t / len, y0 + (y1 - y0) * t / len];
      if (T.form === "wall") {   // solid stone wall with a coping, 0.5 m pieces
        for (let t = 0; t < len; t += T.gap) { const t1 = Math.min(len, t + T.gap), [ax, ay] = Q(t), [bx, by] = Q(t1); beam(at(ax, ay, 0), at(bx, by, 0), T.width, H + 0.15, T.color, (H - 0.15) / 2); beam(at(ax, ay, H), at(bx, by, H), T.width + 0.06, 0.06, T.post_c); }
        return;
      }
      for (let k = 0; k <= n; k++) { const [px, py] = Q(k * step); post(px, py, H + (T.form === "bars" || T.form === "mesh" ? 0.05 : 0.04)); }
      for (let k = 0; k < n; k++) {
        const t0 = k * step + (T.post || 0) / 2, t1 = (k + 1) * step - (T.post || 0) / 2, span = t1 - t0, [ax, ay] = Q(t0), [bx, by] = Q(t1), rail = (y, w = 0.045, h = 0.07) => beam(at(ax, ay, y), at(bx, by, y), h, w, T.color);
        const rx = (t, y0, y1, w, h, c = T.color) => { const [x, y] = Q(t); beam(at(x, y, y0), at(x, y, y1), w, h, c); };
        if (T.form === "picket") { rail(0.25); rail(H - 0.2); for (let t = t0 + T.pitch / 2; t < t1; t += T.pitch) rx(t, 0.08, H, T.pw, 0.02); }
        else if (T.form === "boards") { rail(0.3); rail(H * 0.55); rail(H - 0.3); for (let t = t0 + T.pitch / 2; t < t1; t += T.pitch) rx(t, 0.05, H, T.pw, 0.022); }
        else if (T.form === "slats") { const gapH = (H - 0.1) / T.slats; for (let j = 0; j < T.slats; j++) { const y = 0.12 + gapH * (j + 0.5); beam(at(ax, ay, y), at(bx, by, y), 0.09, 0.03, T.color); } }
        else if (T.form === "mesh") { for (let j = 0; j <= 6; j++) { const y = 0.05 + (H - 0.1) * j / 6; beam(at(ax, ay, y), at(bx, by, y), 0.012, 0.012, T.color); } for (let t = t0; t <= t1 + 1e-6; t += 0.3) rx(t, 0.05, H - 0.05, 0.008, 0.008); }
        else if (T.form === "bars") { rail(0.12, 0.03, 0.035); rail(H - 0.08, 0.03, 0.035); for (let t = t0 + T.pitch / 2; t < t1; t += T.pitch) { rx(t, 0.05, H, 0.016, 0.016); if (T.spear) spear(...Q(t), H); } }
      }
    };
    for (let i = 0; i < pts.length - 1; i++) seg(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3)); g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide, transparent: planned, opacity: planned ? 0.7 : 1 }));
    m.castShadow = !planned; m.receiveShadow = !planned; const grp = new THREE.Group(); grp.add(m);
    if (a.id) grp.traverse(o => { o.userData.ref = { type: "path", id: a.id }; });
    return grp;
  }
  /* Street furniture from OSM points, sized from the norms (hagekart docs/NORM-VEGOPPMERKING.md): Oslo's lamp masts are 8 m on streets and 5 m on gang- og
     sykkelveg, 76 mm top tube, black-green RAL 6012; bollards at least 1.0 m with a white reflective band; a bus stop sign hangs 2.5 m or more above the pavement. */
  function furnitureMesh(F, o) {
    const [x, y] = F.toUtm(o.pt); if (F.cellAt(x, y) < 0) return null;
    const [lx, lz] = F.L([x, y]), gy = F.ground(x, y), g = new THREE.Group(), dark = new THREE.MeshStandardMaterial({ color: "#1f2b27", roughness: 0.55, metalness: 0.45 });
    const add = (geo, mat, px, py, pz) => { const m = new THREE.Mesh(geo, mat); m.position.set(px, py, pz); m.castShadow = true; g.add(m); return m; };
    if (o.type === "lamp" && !o.hang) { const r = nearestRoad(F, x, y); if (r && r.d < r.hw - 0.3) o = { ...o, hang: true }; }   // a mast cannot stand on the carriageway or between tram rails: NVDB marks those as hung or tram-pole lamps, so draw them over the street
    if (o.type === "lamp" && o.hang) {   // hung on a wire across the street (NVDB Plassering): a dome luminaire, wires to both sides
      const H = o.h > 3 ? o.h : 7, lampMat = new THREE.MeshStandardMaterial({ color: "#d9d9d3", roughness: 0.4, metalness: 0.3, emissive: "#fff2c4", emissiveIntensity: 0.25 });
      let ang = 0, hw = 4, best = 1e9;   // the wire runs across the nearest carriageway
      for (const r of F.streetCtx?.roads || []) for (let k = 0; k < r.pts.length - 1; k++) { const [ax, ay] = r.pts[k], [bx, by] = r.pts[k + 1], d = segDist(x, y, [[ax, ay], [bx, by]]); if (d < best) { best = d; hw = r.hw; ang = Math.atan2(bx - ax, by - ay); } }   // along-road angle from +y; wire is perpendicular
      const half = hw + 2.5, wm = new THREE.MeshBasicMaterial({ color: "#2a2d2f" });
      add(new THREE.SphereGeometry(0.3, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.6), lampMat, 0, H, 0);
      for (const sgn of [-1, 1]) { const wire = add(new THREE.CylinderGeometry(0.006, 0.006, half, 4), wm, 0, H + 0.4, 0); wire.castShadow = false; wire.rotation.z = Math.PI / 2; wire.position.x = sgn * half / 2; wire.rotation.z = sgn * (Math.PI / 2 + 0.06); }   // the wires rise towards the facades, so the lamp hangs at the low point
      g.rotation.y = ang;
    } else if (o.type === "bench") {   // wooden slats on cast-iron ends, 1.6 m long, seat 0.45 m (Palace Park photos), facing the nearest road/path
      const iron = new THREE.MeshStandardMaterial({ color: "#1d1f20", roughness: 0.6, metalness: 0.4 }), wood = new THREE.MeshStandardMaterial({ color: "#7a5a3c", roughness: 0.8 });
      for (const sx of [-0.7, 0.7]) { add(new THREE.BoxGeometry(0.05, 0.45, 0.42), iron, sx, 0.225, 0); if (o.backrest) add(new THREE.BoxGeometry(0.05, 0.45, 0.04), iron, sx, 0.68, -0.22); }
      add(new THREE.BoxGeometry(1.6, 0.04, 0.44), wood, 0, 0.45, 0);
      if (o.backrest) add(new THREE.BoxGeometry(1.6, 0.3, 0.03), wood, 0, 0.75, -0.22);
      let best = 1e9, face = 0; for (const r of F.streetCtx?.roads || []) for (let k = 0; k < r.pts.length - 1; k++) { const a = r.pts[k], b = r.pts[k + 1], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2)), px = a[0] + dx * t - x, py = a[1] + dy * t - y, d = Math.hypot(px, py); if (d < best) { best = d; face = Math.atan2(px, -py); } }
      if (best < 30) g.rotation.y = face;
    } else if (o.type === "lamp") {
      const street = (F.streetCtx?.roads || []).some(r => segDist(x, y, r.pts) < r.hw + 6), H = o.h > 3 ? o.h : street ? 8 : 5;   // a mast within 6 m of a carriageway is a street mast
      add(new THREE.CylinderGeometry(0.038, street ? 0.085 : 0.07, H, 10), dark, 0, H / 2, 0);
      add(new THREE.BoxGeometry(street ? 1.4 : 0.9, 0.06, 0.06), dark, street ? 0.7 : 0.45, H - 0.05, 0);
      add(new THREE.BoxGeometry(0.75, 0.1, 0.3), new THREE.MeshStandardMaterial({ color: "#c9c9c2", emissive: "#fff2c4", emissiveIntensity: 0.3 }), street ? 1.4 : 0.9, H - 0.12, 0);
      let near = null;   // the arm reaches over the nearest carriageway
      for (const r of F.streetCtx?.roads || []) for (let k = 0; k < r.pts.length - 1; k++) { const [ax, ay] = r.pts[k], [bx, by] = r.pts[k + 1], dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)), px = ax + dx * t - x, py = ay + dy * t - y, d = Math.hypot(px, py); if (!near || d < near.d) near = { d, px, py }; }
      if (near) g.rotation.y = Math.atan2(near.py, near.px);
    } else if (o.type === "bollard") {
      add(new THREE.CylinderGeometry(0.055, 0.055, 1.0, 10), new THREE.MeshStandardMaterial({ color: "#2e3430", roughness: 0.6 }), 0, 0.5, 0);
      add(new THREE.CylinderGeometry(0.057, 0.057, 0.1, 10), new THREE.MeshStandardMaterial({ color: "#f2f2ee", roughness: 0.5 }), 0, 0.85, 0);
    } else {
      add(new THREE.CylinderGeometry(0.03, 0.03, 3.0, 6), dark, 0, 1.5, 0);
      add(new THREE.BoxGeometry(0.5, 0.5, 0.03), new THREE.MeshStandardMaterial({ color: "#f2c200" }), 0, 2.75, 0);
      if (o.shelter) { for (const sx of [-1.4, 1.4]) add(new THREE.CylinderGeometry(0.04, 0.04, 2.3, 6), dark, sx, 1.15, 1.0); add(new THREE.BoxGeometry(3.2, 0.08, 1.4), new THREE.MeshStandardMaterial({ color: "#5d6a72", roughness: 0.5, metalness: 0.3 }), 0, 2.3, 1.0); }
    }
    g.position.set(lx, gy, lz); return g;
  }
  /* How the street pieces meet. F.streetCtx = {roads: [{a, pts (utm), hw}], trunks: [{x, y, r}]} is set while the OSM streets are built.
     Raised parts (kerb tops, kerb faces, pavement strips) stop where they would run across another carriageway or into a tree trunk, and
     footways are not drawn on top of a carriageway, so junctions read as junctions and trees do not stand in kerbs. */
  const segDist = (px, py, pts) => { let m = 1e9; for (let i = 0; i < pts.length - 1; i++) { const [ax, ay] = pts[i], [bx, by] = pts[i + 1], dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy, t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0; m = Math.min(m, Math.hypot(px - ax - dx * t, py - ay - dy * t)); } return m; };
  function blocker(F, a, trees) {
    const C = F.streetCtx; if (!C) return null;
    const roads = C.roads.filter(r => r.sid !== a.sid), trunks = trees ? C.trunks : [];
    return (x, y) => {
      for (const r of roads) if (x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1 && segDist(x, y, r.pts) < r.hw - 0.05) return true;
      for (const t of trunks) if (Math.abs(x - t.x) < t.r + 0.4 && Math.abs(y - t.y) < t.r + 0.4 && Math.hypot(x - t.x, y - t.y) < t.r + 0.35) return true;
      return false;
    };
  }

  /* Gangfelt: white bars parallel to the road, 0.5 m wide every 1 m, from kerb to kerb over the width of the crossing way (the crossing
     way in OSM is often slanted, so the bars take the road's direction, not the way's). */
  function zebraMesh(F, a) {
    const C = F.streetCtx, pts = (a.pts || []).map(F.toUtm); if (!C || pts.length < 2) return null;
    const e0 = pts[0], e1 = pts[pts.length - 1], mx = (e0[0] + e1[0]) / 2, my = (e0[1] + e1[1]) / 2;
    let best = null;
    for (const r of C.roads) for (let i = 0; i < r.pts.length - 1; i++) {
      const [ax, ay] = r.pts[i], [bx, by] = r.pts[i + 1], dx = bx - ax, dy = by - ay, l = Math.hypot(dx, dy) || 1, t = Math.max(0, Math.min(1, ((mx - ax) * dx + (my - ay) * dy) / (l * l))), cx = ax + dx * t, cy = ay + dy * t, d = Math.hypot(mx - cx, my - cy);
      if (!best || d < best.d) best = { d, cx, cy, tx: dx / l, ty: dy / l, hw: r.hw };
    }
    if (!best || best.d > best.hw + 3) return null;
    const { cx, cy, tx, ty, hw } = best, nx = -ty, ny = tx, w = Math.min(a.width || 3, 4);
    const n0 = (e0[0] - cx) * nx + (e0[1] - cy) * ny, n1 = (e1[0] - cx) * nx + (e1[1] - cy) * ny, lo = Math.max(Math.min(n0, n1), -hw + 0.3), hi = Math.min(Math.max(n0, n1), hw - 0.3);
    const tc = Math.round(((mx - cx) * tx + (my - cy) * ty) / 0.5) * 0.5, pos = [], idx = [];
    for (let u = Math.ceil((lo + 0.25) / 1) ; u + 0.25 <= hi + 1e-6; u++) {   // bars on a 1 m grid from the road's centre line, so two halves of one crossing agree
      const base = pos.length / 3;
      for (const du of [-0.25, 0.25]) for (let k = 0; k <= 6; k++) { const along = tc - w / 2 + w * k / 6, x = cx + nx * (u + du) + tx * along, y = cy + ny * (u + du) + ty * along, [lx, lz] = F.L([x, y]); pos.push(lx, F.ground(x, y) + 0.085, lz); }
      for (let k = 0; k < 6; k++) { const q = base + k, r = q + 7; idx.push(q, q + 1, r, q + 1, r + 1, r); }
    }
    if (!idx.length) return null;
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: "#ecece6", roughness: 0.8, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 }));
    m.receiveShadow = true; const grp = new THREE.Group(); grp.add(m); return grp;
  }

  /* Varselfelt (tactile paving, V129 / Gatenormal for Oslo): 30 x 30 cm tiles with raised studs, 0.6 m deep against the kerb, the full width of the gangfelt. */
  let tactileTex = null;
  const tactile = () => tactileTex ||= (() => {
    const cv = document.createElement("canvas"); cv.width = cv.height = 128; const c = cv.getContext("2d");
    c.fillStyle = "#c9c5bb"; c.fillRect(0, 0, 128, 128); c.fillStyle = "#e4e1d8";
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { c.beginPath(); c.arc(16 + i * 32, 16 + j * 32, 6, 0, 6.3); c.fill(); }
    c.strokeStyle = "#8f8b82"; c.lineWidth = 3; c.strokeRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t;
  })();
  /* NVDB objects: the crossing polygons and the painted lines exactly where Statens vegvesen has them. */
  function nvdbMesh(F, o) {
    const grp = new THREE.Group(), white = new THREE.MeshStandardMaterial({ color: MARKINGS.colors.Hvit, roughness: 0.8, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
    if (o.t === "gangfelt" && o.geo.type === "Polygon") {
      const ring = o.geo.coordinates[0].map(F.toUtm).slice(0, -1); if (ring.length < 3) return null;
      let best = null;   // the longest edge is the way across the road; the bars run the other way, parallel to the traffic
      for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]); if (!best || l > best.l) best = { l, ux: (b[0] - a[0]) / l, uy: (b[1] - a[1]) / l }; }
      const { ux, uy } = best, vx = -uy, vy = ux, P = ring.map(p => [p[0] * ux + p[1] * uy, p[0] * vx + p[1] * vy]);
      const u0 = Math.min(...P.map(p => p[0])), u1 = Math.max(...P.map(p => p[0])), v0 = Math.min(...P.map(p => p[1])), v1 = Math.max(...P.map(p => p[1]));
      const { bar, gap } = MARKINGS.zebra, n = Math.floor((u1 - u0 + gap) / (bar + gap)), off = (u1 - u0 - (n * bar + (n - 1) * gap)) / 2, pos = [], idx = [];
      const at = (u, v) => { const x = u * ux + v * vx, y = u * uy + v * vy, [lx, lz] = F.L([x, y]); pos.push(lx, F.ground(x, y) + 0.085, lz); };
      for (let k = 0; k < n; k++) {
        const a = u0 + off + k * (bar + gap), base = pos.length / 3;
        for (const uu of [a, a + bar]) for (let j = 0; j <= 6; j++) at(uu, v0 + (v1 - v0) * j / 6);
        for (let j = 0; j < 6; j++) { const q = base + j, r = q + 7; idx.push(q, q + 1, r, q + 1, r + 1, r); }
      }
      for (const [a, b] of [[u0 - 0.6, u0], [u1, u1 + 0.6]]) {   // the varselfelt at both ends, against the kerb
        const tp = [], ti = [], tu = [];
        for (const uu of [a, b]) for (let j = 0; j <= 6; j++) { const v = v0 + (v1 - v0) * j / 6, x = uu * ux + v * vx, y = uu * uy + v * vy, [lx, lz] = F.L([x, y]); tp.push(lx, F.ground(x, y) + 0.07, lz); tu.push((uu - a) / 0.3, (v - v0) / 0.3); }
        for (let j = 0; j < 6; j++) { const q = j, r = q + 7; ti.push(q, q + 1, r, q + 1, r + 1, r); }
        const tg = new THREE.BufferGeometry(); tg.setAttribute("position", new THREE.Float32BufferAttribute(tp, 3)); tg.setAttribute("uv", new THREE.Float32BufferAttribute(tu, 2)); tg.setIndex(ti); tg.computeVertexNormals();
        const tm = new THREE.Mesh(tg, new THREE.MeshStandardMaterial({ map: tactile(), roughness: 0.9, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 })); tm.receiveShadow = true; grp.add(tm);
      }
      if (!idx.length && !grp.children.length) return null;
      const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
      const m = new THREE.Mesh(g, white); m.receiveShadow = true; grp.add(m); return grp;
    }
    if (o.t === "kantstein" && o.geo.type === "LineString") {
      /* the real kerb line: granite, 15 cm wide, height over the road from the record (12-16 cm), ramped down to 2 cm inside a gangfelt (N302/V129: 1:12) */
      const sm = smoothPath(o.geo.coordinates.map(F.toUtm), 0.5); if (sm.length < 2) return null;
      const H = Math.max(0.05, (+o.props["Høyde over vegdekke"] || 13) / 100), zs = F.streetCtx?.zebras || [], W = 0.15, pos = [], idx = [];
      const distTo = (x, y) => { let m = 1e9; for (const z of zs) { if (x < z.x0 - 4 || x > z.x1 + 4 || y < z.y0 - 4 || y > z.y1 + 4) continue; const inside = pointInRing([x, y], z.ring); m = Math.min(m, inside ? 0 : segDist(x, y, z.ring.concat([z.ring[0]]))); } return m; };
      const low = F.streetCtx?.lowered || [], distLow = (x, y) => { let m = 1e9; for (const q of low) { const d = Math.hypot(x - q[0], y - q[1]); if (d < m) m = d; } return Math.max(0, m - 1); };   // a lowered-kerb point (nedsenka) is about 2 m wide
      const hs = sm.map(p => 0.02 + Math.min(H - 0.02, Math.min(distTo(p.x, p.y), distLow(p.x, p.y)) / 12));
      // per sample: outer-bottom, outer-top, inner-top, inner-bottom (a box profile)
      const prof = [[-W, 0], [-W, 1], [W, 1], [W, 0]];
      sm.forEach((p, i) => { for (const [off, top] of prof) { const x = p.x - p.ty * off, y = p.y + p.tx * off, [lx, lz] = F.L([x, y]); pos.push(lx, F.ground(x, y) + 0.04 + (top ? hs[i] : 0), lz); } });
      for (let i = 0; i < sm.length - 1; i++) for (let c = 0; c < 3; c++) { const a = i * 4 + c, b = a + 4; idx.push(a, a + 1, b, a + 1, b + 1, b); }
      const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: "#a29e97", roughness: 0.9, side: THREE.DoubleSide })); m.castShadow = true; m.receiveShadow = true; grp.add(m); return grp;
    }
    if (o.t === "trafikkoy" && o.geo.type === "Polygon") {
      /* a traffic island: a raised, kerbed asphalt (or cobble) platform, 12 cm over the road (same kerb height as the record's kerbs) */
      const ring = o.geo.coordinates[0].map(F.toUtm).slice(0, -1); if (ring.length < 3) return null;
      const L = ring.map(p => F.L(p)), h0 = ring.reduce((a, p) => a + F.ground(p[0], p[1]), 0) / ring.length, D = 0.12;
      const sh = new THREE.Shape(L.map(([x, z]) => new THREE.Vector2(x, -z)));
      const g = new THREE.ExtrudeGeometry(sh, { depth: D, bevelEnabled: false }); g.rotateX(-Math.PI / 2); g.translate(0, h0 + 0.03, 0);
      const top = /stein|brostein/i.test(o.props.Belegning || "") ? "#8e8a83" : "#5e5f62";
      const m = new THREE.Mesh(g, [new THREE.MeshStandardMaterial({ color: top, roughness: 0.95 }), new THREE.MeshStandardMaterial({ color: "#a29e97", roughness: 0.9 })]); m.castShadow = true; m.receiveShadow = true; grp.add(m); return grp;
    }
    if ((o.t === "tverr" || o.t === "fartsdemper") && o.geo.type === "Point") {
      const [x, y] = F.toUtm(o.geo.coordinates), r = nearestRoad(F, x, y), ty = String(o.props.Type || ""); if (!r || r.d > r.hw + 6) return null;
      const { tx, ty: tyy } = r, nx = -tyy, ny = tx;
      const patch = (us, hs, vs, mat, lift) => {   // a grid over (along u, across v) with heights hs[i] at us[i]
        const pos = [], idx = [], W = vs.length;
        us.forEach((u, i) => vs.forEach(v => { const px = x + tx * u + nx * v, py = y + tyy * u + ny * v, [lx, lz] = F.L([px, py]); pos.push(lx, F.ground(px, py) + lift + hs[i], lz); }));
        for (let i = 0; i < us.length - 1; i++) for (let j = 0; j < W - 1; j++) { const a = i * W + j, b = a + W; idx.push(a, a + 1, b, a + 1, b + 1, b); }
        const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
        const m = new THREE.Mesh(g, mat); m.receiveShadow = true; m.castShadow = true; grp.add(m);
      };
      if (/Stopplinje/.test(ty)) { const lane = Math.min(3.2, r.hw - 0.3); patch([-0.25, 0.25], [0, 0], [-lane / 2, lane / 2], white, 0.085); return grp; }   // 0.50 m wide at a Stopp sign (N302)
      if (o.t === "fartsdemper" || /Fartshump/.test(ty)) {   // a flat-topped hump the full width of the carriageway: 10 cm, ramps 1.2 m, top 0.6 m (likely, see the norms file)
        const vs = []; for (let v = -r.hw; v <= r.hw + 1e-6; v += 0.5) vs.push(v);
        patch([-1.5, -0.3, 0.3, 1.5], [0, 0.1, 0.1, 0], vs, new THREE.MeshStandardMaterial({ color: /brostein|Stein/i.test(o.props["Materiale/belegning"] || "") ? "#8e8a83" : "#6f7073", roughness: 0.95, side: THREE.DoubleSide }), 0.06); return grp;
      }
      return null;
    }
    if (o.t === "linje" && o.geo.type === "LineString") {
      const sm = smoothPath(o.geo.coordinates.map(F.toUtm), 0.5); if (sm.length < 2) return null;
      const pat = MARKINGS.dash(o.props.Farge, o.props["Linjemønster"], (o.props.Type || "") + " " + (o.props.Bruksområde || "")), col = MARKINGS.colors[o.props.Farge] || MARKINGS.colors.Hvit, w = +o.props["Bredde, enkeltlinje"] || 0.15, period = pat.on + pat.off;
      const mat = pat.off ? new THREE.MeshBasicMaterial({ map: dashTexture(pat.on, pat.off, col), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5, side: THREE.DoubleSide }) : new THREE.MeshBasicMaterial({ color: col, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5, side: THREE.DoubleSide });
      const m = new THREE.Mesh(strip(F, sm, 0.04, -w / 2, w / 2, [period, 1]), mat); m.renderOrder = 1; grp.add(m); return grp;
    }
    return null;
  }
  /* Tram rails (OSM railway=tram, one way per track): two steel rails at standard gauge 1435 mm (head 0.07 m) flush with the carriageway. */
  function tramMesh(F, a) {
    const sm = smoothPath((a.pts || []).map(F.toUtm), 0.5); if (sm.length < 2) return null;
    const grp = new THREE.Group(), mat = new THREE.MeshStandardMaterial({ color: "#8c9094", roughness: 0.45, metalness: 0.6, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6, side: THREE.DoubleSide });
    for (const o of [-0.7175, 0.7175]) { const m = new THREE.Mesh(strip(F, sm, 0.02, o - 0.035, o + 0.035), mat); m.receiveShadow = true; grp.add(m); }
    return grp;
  }
  /* A car park: the ring (lng/lat) filled with the surface, following the ground on a 1 m grid (cells at the edge are the ring clipped to the cell),
     a little under the carriageways so the aisles and driveways that cross it lie on top. Only what is inside the drawn area (F.cellAt) is drawn.
     A kerb (a.kerb, from OSM's kerb tag) runs just inside the edge, as a road's does. */
  function parkingMesh(F, a) {
    const ring = (a.ring || []).map(F.toUtm).slice(0, -1); if (ring.length < 3) return null;
    const key = PATHS[a.surface] ? a.surface : "asphalt", K = PATHS[key], lift = K.h - 0.006, CELL = 1, planned = a.st === "planned";
    const xs = ring.map(p => p[0]), ys = ring.map(p => p[1]), x0 = Math.floor(Math.min(...xs)), y0 = Math.floor(Math.min(...ys)), x1 = Math.max(...xs), y1 = Math.max(...ys);
    const clip = (poly, inside, cut) => { const out = []; for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length], ip = inside(p), iq = inside(q); if (ip) out.push(p); if (ip !== iq) out.push(cut(p, q)); } return out; };
    const pos = [], uv = [], idx = [], put = (x, y) => { const [lx, lz] = F.L([x, y]); pos.push(lx, F.ground(x, y) + lift + PATHLIFT, lz); uv.push(x, y); return pos.length / 3 - 1; };
    for (let cx = x0; cx < x1; cx += CELL) for (let cy = y0; cy < y1; cy += CELL) {
      if (F.cellAt(cx + CELL / 2, cy + CELL / 2) < 0) continue;
      const sq = [[cx, cy], [cx + CELL, cy], [cx + CELL, cy + CELL], [cx, cy + CELL]];
      if (sq.every(p => pointInRing(p, ring)) && !ring.some(p => p[0] > cx && p[0] < cx + CELL && p[1] > cy && p[1] < cy + CELL)) {   // a whole cell
        const [i0, i1, i2, i3] = sq.map(p => put(...p)); idx.push(i0, i1, i2, i0, i2, i3); continue;
      }
      let poly = ring;   // an edge cell: the ring clipped to the cell (Sutherland-Hodgman against its four sides)
      for (const [d, k, keep] of [[0, cx, 1], [0, cx + CELL, -1], [1, cy, 1], [1, cy + CELL, -1]]) {
        poly = clip(poly, p => (p[d] - k) * keep >= 0, (p, q) => { const t = (k - p[d]) / (q[d] - p[d]); return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]; });
        if (poly.length < 3) break;
      }
      if (poly.length < 3) continue;
      const tris = THREE.ShapeUtils.triangulateShape(poly.map(p => new THREE.Vector2(p[0], p[1])), []), base = poly.map(p => put(...p));
      for (const [i, j, k] of tris) { const [P, Q, R] = [poly[i], poly[j], poly[k]], ccw = (Q[0] - P[0]) * (R[1] - P[1]) - (Q[1] - P[1]) * (R[0] - P[0]) > 0; idx.push(base[i], ccw ? base[j] : base[k], ccw ? base[k] : base[j]); }   // anticlockwise in UTM faces up
    }
    if (!idx.length) return null;
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    const tx = pathTexture(key); tx.repeat.set(1 / K.tile, 1 / K.tile);
    const op = { transparent: planned, opacity: planned ? 0.75 : 1 };
    const m = new THREE.Mesh(g, breakTiling(new THREE.MeshStandardMaterial({ map: tx, color: K.c, roughness: 0.95, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, ...op })));
    m.receiveShadow = true; m.userData.slab = true; m.userData.tex = tx; m.userData.col = K.c;
    const grp = new THREE.Group(); grp.add(m);
    if (a.kerb) {   // inside the edge: left of the way round when the ring runs anticlockwise
      let A = 0; for (let i = 0; i < ring.length; i++) { const p = ring[i], q = ring[(i + 1) % ring.length]; A += p[0] * q[1] - q[0] * p[1]; }
      const sgn = A > 0 ? 1 : -1, sm = smoothPath([...ring, ring[0]], 0.5), KH = 0.12, out = (x, y) => F.cellAt(x, y) < 0, [o0, o1] = sgn > 0 ? [0, 0.15] : [-0.15, 0];
      const kerbMat = new THREE.MeshStandardMaterial({ color: "#a09c95", map: kerbTex(), roughness: 0.9, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, ...op });
      const faceMat = new THREE.MeshStandardMaterial({ color: "#85817a", roughness: 0.9, side: THREE.DoubleSide, ...op });
      for (const r of runs(sm, o0, o1, out)) { const k = new THREE.Mesh(strip(F, r, K.h + KH, o0, o1), kerbMat); k.castShadow = k.receiveShadow = true; grp.add(k); }
      for (const r of runs(sm, sgn * 0.15, sgn * 0.15, out)) { const w = new THREE.Mesh(wall(F, r, sgn * 0.15, lift, K.h + KH), faceMat); w.receiveShadow = true; grp.add(w); }
    }
    if (a.id) grp.traverse(o => { o.userData.ref = { type: "path", id: a.id }; });
    return grp;
  }
  function pathMesh(F, a) {
    if (a.kind === "parking") return parkingMesh(F, a);
    if (a.kind === "fence") return fenceMesh(F, a);
    if (a.kind === "tram") return tramMesh(F, a);
    if (a.cross) return a.zebra ? zebraMesh(F, a) : null;   // a crossing is paint on the road, nothing more
    const pts = (a.pts || []).map(F.toUtm), sm = smoothPath(pts, 0.5); if (sm.length < 2) return null;
    const X = crossSection(a), K = X.K, planned = a.st === "planned", tx = pathTexture(X.key);
    tx.repeat.set(1 / K.tile, 1 / K.tile);
    const op = { transparent: planned, opacity: planned ? 0.75 : 1 };
    const mat = breakTiling(new THREE.MeshStandardMaterial({ map: tx, color: K.c, roughness: 0.95, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, ...op }));
    const grp = new THREE.Group(), road = (a.kind || (ROAD_TYPES[a.type] || {}).kind) === "road", onRoad = blocker(F, a, false), raisedBad = blocker(F, a, true);
    for (const r of runs(sm, X.surf[0], X.surf[1], road ? null : onRoad)) {   // a footway is not drawn on top of a carriageway
      const m = new THREE.Mesh(strip(F, r, X.surf[2], X.surf[0], X.surf[1]), mat);
      m.receiveShadow = true; m.userData.slab = true; m.userData.tex = tx; m.userData.col = K.c; grp.add(m);
    }
    const solid = (color, geo, offset = -3, shadow = true, map = null) => { const o = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, map, roughness: 0.9, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: offset, polygonOffsetUnits: offset, ...op })); o.receiveShadow = true; o.castShadow = shadow; grp.add(o); return o; };
    for (const [o0, o1, y] of X.kerbs) for (const r of runs(sm, o0, o1, raisedBad)) solid("#a09c95", strip(F, r, y, o0, o1), -3, true, kerbTex());   // kerb top (granite, joint every metre)
    for (const [o, y0, y1] of X.wallFaces) for (const r of runs(sm, o, o, raisedBad)) solid("#85817a", wall(F, r, o, y0, y1), 0);                  // vertical faces: kerb reveal and pavement edge
    if (X.walks.length) {
      const wt = pathTexture("slabs"), wm = breakTiling(new THREE.MeshStandardMaterial({ map: wt, color: "#ece8e0", roughness: 0.95, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, ...op }));
      for (const [o0, o1, y] of X.walks) for (const r of runs(sm, o0, o1, raisedBad)) { const wmesh = new THREE.Mesh(strip(F, r, y, o0, o1), wm); wmesh.receiveShadow = true; grp.add(wmesh); }
      wt.repeat.set(1 / 1.2, 1 / 1.2);
    }
    if (X.shoulders.length) for (const [o0, o1, y] of X.shoulders) { const sm2 = new THREE.Mesh(strip(F, sm, y, o0, o1), breakTiling(new THREE.MeshStandardMaterial({ map: pathTexture("gravel"), color: PATHS.gravel.c, roughness: 1, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, ...op }))); sm2.receiveShadow = true; grp.add(sm2); }
    if (X.line) {
      const period = X.line.on + X.line.off, dt = dashTexture(X.line.on, X.line.off, X.line.color), lw = X.line.w || 0.1;
      for (const r of runs(sm, -lw / 2, lw / 2, onRoad)) {
        const lm = new THREE.Mesh(strip(F, r, X.surf[2] + 0.004, -lw / 2, lw / 2, [period, 1]), new THREE.MeshBasicMaterial({ map: dt, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5, side: THREE.DoubleSide }));
        lm.renderOrder = 1; grp.add(lm);
      }
    }
    if (a.id) grp.traverse(o => { o.userData.ref = { type: "path", id: a.id }; });
    return grp;
  }
  return { segDist, strip, wall, ribbon, fenceMesh, furnitureMesh, blocker, zebraMesh, nvdbMesh, tramMesh, parkingMesh, pathMesh };
}
