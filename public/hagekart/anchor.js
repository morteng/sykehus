/* Start spots for a photo run ("stå her, se dit") and the ghost the phone shows there.

   Footprints are roof edges (FKB takkant: the outer edge of roof and gutter), so the ghost is made of roof lines at
   the height the laser surface (DOM) gives them: eaves, gable rakes and the ridge, plus the building skyline seen from
   the spot. Wall corners sit 0.3-0.8 m inside the footprint and are not used. The ghost is drawn from the TARGET pose
   (the planned spot, heading and pitch) with the live camera's lens, so compass and GPS error never enter it: the user
   moves until the house sits in it.

   Pure functions over a "world" in EPSG:25833: { lot: ring, buildings: [{ id, ring }], dom(x, y), dtm(x, y) } where
   dom/dtm return metres above sea level or NaN outside the grid (gridSampler makes them from fetchSurface's grids).
   What goes into the plan (doc.anchorPlan) is EPSG:4326: [lng, lat, z]. */
import { projectSegment, camAxes, makeRun, anchorSrcOf } from "./pose.js";

const RAD = Math.PI / 180;
const wrap180 = a => ((((a + 180) % 360) + 360) % 360) - 180;
const norm360 = h => ((h % 360) + 360) % 360;
/** @returns {P3} */
const p3 = (x, y, z) => [x, y, z];
const median = a => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };

/**
 * @typedef {[number, number]} XY
 * @typedef {[number, number, number]} P3
 * @typedef {{ lot: XY[], buildings: { id: string, ring: XY[] }[], dom: (x: number, y: number) => number, dtm: (x: number, y: number) => number, gate?: XY|null }} World
 * @typedef {{ A: P3, B: P3, kind: "eave"|"rake"|"ridge"|"skyline", bld?: string, edge?: number }} RoofLine
 * @typedef {{ w: number, h: number, hfov: number }} Cam
 * @typedef {{ id: string, spot: [number, number], z: number, eye: number, heading: number, pitch: number, hfov: number, w: number, h: number,
 *   ghost: { A: P3, B: P3, kind: string }[], lines: number, spread: number, dist: number, bld: string|null, why: string, acc: number, src: "plan" }} AnchorSpot
 *   one entry of doc.anchorPlan (public: no photo, no camera of a real shot); ghost points are [lng, lat, z]
 */

/** Portrait phone frame, the default camera for planning: the walk camera is portrait 1200 x 1600 with walk.js
 *  DEFAULT_FOV 65° on the long side, so about 51° across (walk.js frameHfov). */
export const PHONE_CAM = Object.freeze({ w: 1200, h: 1600, hfov: +((2 * Math.atan(Math.tan((65 * Math.PI) / 360) * (1200 / 1600)) * 180) / Math.PI).toFixed(1) });
export const EYE_M = 1.5;

/** Bilinear sampler over a detect.js grid (cell centres, row 0 at the top): NaN outside or on missing cells.
 *  @param {{ x0: number, y1: number, res: number, w: number, h: number }} g @param {ArrayLike<number>} a */
export function gridSampler(g, a) {
  return (x, y) => {
    const fc = (x - g.x0) / g.res - 0.5, fr = (g.y1 - y) / g.res - 0.5, c = Math.floor(fc), r = Math.floor(fr);
    if (c < 0 || r < 0 || c >= g.w - 1 || r >= g.h - 1) return NaN;
    const u = fc - c, v = fr - r, i = r * g.w + c, q = [a[i], a[i + 1], a[i + g.w], a[i + g.w + 1]];
    if (q.some(z => !(z > -100 && z < 3000))) return NaN;
    return q[0] * (1 - u) * (1 - v) + q[1] * u * (1 - v) + q[2] * (1 - u) * v + q[3] * u * v;
  };
}

/** The planner's world from a plan and the height grids of detect.js fetchSurface ({ g, surf, ground }).
 *  @param {(p: number[]) => number[]} utm @returns {World} */
export function anchorWorld(doc, surface, utm) {
  const open = r => (r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1] ? r.slice(0, -1) : r);
  const gate = (doc.paths || []).find(p => p.kind === "gate" && p.pts?.length);
  return {
    lot: open((doc.lot?.ring || []).map(p => /** @type {XY} */ (utm(p)))),
    buildings: (doc.buildings || []).filter(b => b.ring?.length >= 3).map(b => ({ id: b.id, ring: open(b.ring.map(p => /** @type {XY} */ (utm(p)))) })),
    dom: gridSampler(surface.g, surface.surf), dtm: gridSampler(surface.g, surface.ground),
    gate: gate ? /** @type {XY} */ (utm(gate.pts[0])) : null,
  };
}

export function inRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function ringDist([x, y], ring) {
  let m = Infinity;
  for (let k = 0; k < ring.length; k++) {
    const [ax, ay] = ring[k], [bx, by] = ring[(k + 1) % ring.length], vx = bx - ax, vy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy || 1)));
    m = Math.min(m, Math.hypot(x - ax - vx * t, y - ay - vy * t));
  }
  return m;
}
const area = ring => Math.abs(ring.reduce((s, p, i) => { const q = ring[(i + 1) % ring.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
const centroid = ring => [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length];

/* Douglas-Peucker on [s, z] points: indices kept. */
function simplifyIdx(pts, tol) {
  const keep = new Set([0, pts.length - 1]);
  const rec = (a, b) => {
    let best = -1, dm = tol;
    for (let i = a + 1; i < b; i++) {
      const [x0, y0] = pts[a], [x1, y1] = pts[b], [x, y] = pts[i], L = Math.hypot(x1 - x0, y1 - y0) || 1;
      const d = Math.abs((x - x0) * (y1 - y0) - (y - y0) * (x1 - x0)) / L;
      if (d > dm) { dm = d; best = i; }
    }
    if (best >= 0) { keep.add(best); rec(a, best); rec(best, b); }
  };
  rec(0, pts.length - 1);
  return [...keep].sort((x, y) => x - y);
}

/**
 * Roof lines of every building at laser height: each footprint edge becomes one or more segments following the roof
 * edge (flat "eave", sloping gable "rake"), and a pitched roof gets its "ridge". The roof-edge height is extrapolated to
 * the footprint from two samples inside it (0.75 and 1.5 m in), since the laser cell on the edge itself mixes roof and
 * ground. Edges lower than `minH` above the ground (or covered by trees, too few good samples) give no line.
 * @param {World} world @returns {RoofLine[]}
 */
export function roofLines(world, { minH = 2, in1 = 0.75, in2 = 1.5, tol = 0.4, minEdge = 2 } = {}) {
  const out = /** @type {RoofLine[]} */ ([]);
  for (const b of world.buildings) {
    const ring = b.ring, n = ring.length; if (n < 3) continue;
    const g0 = median(ring.map(p => world.dtm(p[0], p[1])).filter(Number.isFinite));
    if (!Number.isFinite(g0)) continue;
    for (let k = 0; k < n; k++) {
      const A = ring[k], B = ring[(k + 1) % n], L = Math.hypot(B[0] - A[0], B[1] - A[1]); if (L < minEdge) continue;
      const d = [(B[0] - A[0]) / L, (B[1] - A[1]) / L]; let nrm = [-d[1], d[0]];
      if (!inRing([(A[0] + B[0]) / 2 + nrm[0] * 0.5, (A[1] + B[1]) / 2 + nrm[1] * 0.5], ring)) nrm = [d[1], -d[0]];
      const m = Math.max(3, Math.round(L)), prof = [];
      for (let i = 0; i < m; i++) {
        const s = 0.3 + ((L - 0.6) * i) / (m - 1), p = [A[0] + d[0] * s, A[1] + d[1] * s];
        const z1 = world.dom(p[0] + nrm[0] * in1, p[1] + nrm[1] * in1), z2 = world.dom(p[0] + nrm[0] * in2, p[1] + nrm[1] * in2);
        if (!Number.isFinite(z1) || !Number.isFinite(z2)) continue;
        const ze = Math.max(z1 - 1.5, Math.min(z1, 2 * z1 - z2));
        if (ze - g0 >= minH) prof.push([s, ze]);
      }
      if (prof.length < Math.max(3, 0.6 * m)) continue;
      const sm = prof.map((q, i) => [q[0], median(prof.slice(Math.max(0, i - 1), i + 2).map(o => o[1]))]);   // 3-point median: laser noise
      prof.splice(0, prof.length, ...sm);
      prof[0] = [0, prof[0][1]]; prof[prof.length - 1] = [L, prof[prof.length - 1][1]];
      const idx = simplifyIdx(prof, tol);
      for (let j = 0; j < idx.length - 1; j++) {
        const [s0, z0] = prof[idx[j]], [s1, z1] = prof[idx[j + 1]]; if (s1 - s0 < 1.5) continue;
        out.push({ A: p3(A[0] + d[0] * s0, A[1] + d[1] * s0, z0), B: p3(A[0] + d[0] * s1, A[1] + d[1] * s1, z1), kind: Math.abs(z1 - z0) / (s1 - s0) < 0.15 ? "eave" : "rake", bld: b.id, edge: k });
      }
    }
    const r = ridgeOf(world, ring, g0); if (r) out.push({ A: r.A, B: r.B, kind: /** @type {"ridge"} */ ("ridge"), bld: b.id });
  }
  return out;
}

/* The ridge of a pitched roof: along one of the footprint's main directions (its longest edge, or across it), the
   line of highest roof; whichever direction shows the clearer peak. */
function ridgeOf(world, ring, g0) {
  let best = 0, u = [1, 0];
  for (let k = 0; k < ring.length; k++) { const A = ring[k], B = ring[(k + 1) % ring.length], L = Math.hypot(B[0] - A[0], B[1] - A[1]); if (L > best) { best = L; u = [(B[0] - A[0]) / L, (B[1] - A[1]) / L]; } }
  const a = ridgeAlong(world, ring, g0, u), b = ridgeAlong(world, ring, g0, [-u[1], u[0]]);
  return a && b ? (a.peak >= b.peak ? a : b) : a || b;
}
function ridgeAlong(world, ring, g0, u) {
  const v = [-u[1], u[0]], c = centroid(ring), U = p => (p[0] - c[0]) * u[0] + (p[1] - c[1]) * u[1], V = p => (p[0] - c[0]) * v[0] + (p[1] - c[1]) * v[1];
  const u0 = Math.min(...ring.map(U)), u1 = Math.max(...ring.map(U)), v0 = Math.min(...ring.map(V)), v1 = Math.max(...ring.map(V));
  if (u1 - u0 < 4 || v1 - v0 < 4) return null;
  /** @returns {XY} */ const at = (a, b) => [c[0] + u[0] * a + v[0] * b, c[1] + u[1] * a + v[1] * b], prof = [];
  for (let b = v0 + 0.5; b <= v1 - 0.5; b += 0.5) {
    const zs = []; for (let a = u0 + 0.2 * (u1 - u0); a <= u1 - 0.2 * (u1 - u0); a += 0.5) { const p = at(a, b); if (inRing(p, ring)) { const z = world.dom(p[0], p[1]); if (Number.isFinite(z)) zs.push(z); } }
    prof.push([b, zs.length >= 3 ? median(zs) : NaN]);
  }
  const ok = prof.filter(p => Number.isFinite(p[1])); if (ok.length < 5) return null;
  const top = ok.reduce((m, p) => (p[1] > m[1] ? p : m)), peak = top[1] - Math.max(ok[0][1], ok[ok.length - 1][1]);
  if (top[1] - Math.min(ok[0][1], ok[ok.length - 1][1]) < 1 || peak < 0.6 || top[0] - v0 < 1.5 || v1 - top[0] < 1.5 || top[1] - g0 < 3) return null;
  const along = []; for (let a = u0 + 0.5; a <= u1 - 0.5; a += 0.5) { const p = at(a, top[0]); if (!inRing(p, ring)) continue; const z = world.dom(p[0], p[1]); if (z >= top[1] - 0.4) along.push([a, z]); }
  if (along.length < 4) return null;
  const a0 = along[0][0], a1 = along[along.length - 1][0]; if (a1 - a0 < 2) return null;
  const z = median(along.map(p => p[1])), A = at(a0, top[0]), B = at(a1, top[0]);
  return { A: /** @type {P3} */ ([A[0], A[1], z]), B: /** @type {P3} */ ([B[0], B[1], z]), peak };
}

/** Is the 3D point P seen from C (no laser surface above the sight line on the way)? The last `stopM` metres are
 *  not tested: P sits on that surface.
 *  @param {World} world @param {P3} C @param {P3} P */
export function visibleFrom(world, C, P, { tol = 0.2, stopM = 0.6, step = 0.5 } = {}) {
  const dx = P[0] - C[0], dy = P[1] - C[1], dz = P[2] - C[2], L = Math.hypot(dx, dy);
  for (let s = step; s < L - stopM; s += step) {
    const t = s / L, h = world.dom(C[0] + dx * t, C[1] + dy * t);
    if (h > C[2] + dz * t + tol) return false;
  }
  return true;
}
/* Is there sky behind P seen from C: the sight line, carried on past P, never meets the surface again (within maxM). */
function skyBehind(world, C, P, { maxM = 80, step = 1, clear = 0.3 } = {}) {
  const dx = P[0] - C[0], dy = P[1] - C[1], dz = P[2] - C[2], L = Math.hypot(dx, dy) || 1;
  for (let s = L + 1.2; s < L + maxM; s += step) {
    const t = s / L, h = world.dom(C[0] + dx * t, C[1] + dy * t);
    if (Number.isNaN(h)) return true;
    if (h > C[2] + dz * t - clear) return false;
  }
  return true;
}

const lineSamples = (L, every = 1) => { const n = Math.max(3, Math.min(12, Math.round(Math.hypot(L.B[0] - L.A[0], L.B[1] - L.A[1], L.B[2] - L.A[2]) / every) + 1)); return Array.from({ length: n }, (_, i) => L.A.map((v, k) => v + ((L.B[k] - v) * i) / (n - 1))); };
/* Lines that count as separate: one per footprint edge (its pieces together) and the ridge of each building. */
export const lineKey = L => `${L.bld ?? "?"}:${L.kind === "ridge" ? "ridge" : L.kind === "skyline" ? "sky" : L.edge}`;
const countLines = ls => new Set(ls.map(lineKey)).size;
const dirOf = L => (L.kind === "rake" ? 1000 + Math.round(Math.atan2(L.B[2] - L.A[2], Math.hypot(L.B[0] - L.A[0], L.B[1] - L.A[1])) / RAD) : ((Math.atan2(L.B[0] - L.A[0], L.B[1] - L.A[1]) / RAD) + 180) % 180);
function distinctDirs(lines) {
  const ds = []; for (const L of lines) { const d = dirOf(L); if (!ds.some(e => (d >= 1000 || e >= 1000 ? Math.abs(d - e) < 1 : Math.min(Math.abs(d - e), 180 - Math.abs(d - e)) < 20))) ds.push(d); }
  return ds.length;
}

/**
 * Start spots on a lot: places to stand (on the lot, 6-14 m from a building, open ground with nothing above eye
 * height) from which a phone held at eye height sees at least `minLines` roof lines, in at least two directions,
 * spread over at least `minSpread` degrees across the frame. The best (line spread, number of lines, sky behind the
 * roof, about 9 m away) are kept, spread round the main building (at least `sepDeg` apart, relaxed to a half, then to
 * any side, while that leaves fewer than 2; always 8 m apart); one near the gate when the plan has one. Poses in EPSG:25833.
 * @param {World} world
 * @param {{ cam?: Cam, eye?: number, n?: number, step?: number, dMin?: number, dMax?: number, minLines?: number, minSpread?: number, sepDeg?: number, lines?: RoofLine[] }} [opts]
 * @returns {{ x: number, y: number, z: number, heading: number, pitch: number, roll: number, hfov: number, w: number, h: number, lines: RoofLine[], count: number, spread: number, dist: number, bld: string|null, sky: number, score: number }[]}
 */
export function planSpots(world, { cam = PHONE_CAM, eye = EYE_M, n = 4, step = 1.5, dMin = 6, dMax = 14, minLines = 3, minSpread = 30, sepDeg = 90, lines = null } = {}) {
  const all = lines || roofLines(world); if (!all.length || world.lot.length < 3) return [];
  const samples = all.map(L => lineSamples(L)), vfov = 2 * Math.atan(Math.tan((cam.hfov * RAD) / 2) * (cam.h / cam.w)) / RAD;
  const halfH = (cam.hfov / 2) * 0.92, halfV = (vfov / 2) * 0.92, focal = cam.w / 2 / Math.tan((cam.hfov * RAD) / 2);
  const xs = world.lot.map(p => p[0]), ys = world.lot.map(p => p[1]), cands = [];
  const main = [...world.buildings].sort((a, b) => area(b.ring) - area(a.ring))[0], mc = main ? centroid(main.ring) : null;
  for (let x = Math.min(...xs) + step / 2; x < Math.max(...xs); x += step) for (let y = Math.min(...ys) + step / 2; y < Math.max(...ys); y += step) {
    const p = /** @type {XY} */ ([x, y]); if (!inRing(p, world.lot) || world.buildings.some(b => inRing(p, b.ring))) continue;
    let near = null, dn = Infinity; for (const b of world.buildings) { const d = ringDist(p, b.ring); if (d < dn) { dn = d; near = b; } }
    if (dn < dMin || dn > dMax) continue;
    const g = world.dtm(x, y); if (!Number.isFinite(g)) continue;
    if (!(world.dom(x, y) - g < 0.6) || [[0.7, 0], [-0.7, 0], [0, 0.7], [0, -0.7]].some(([a, b]) => !(world.dom(x + a, y + b) - world.dtm(x + a, y + b) < 1.2))) continue;   // open ground, nothing overhead, at most a low shrub beside
    const C = /** @type {P3} */ ([x, y, g + eye]), seen = [];
    for (let i = 0; i < all.length; i++) {
      const pts = [];
      for (const P of samples[i]) { const d = Math.hypot(P[0] - x, P[1] - y); if (d < 2 || d > 45 || !visibleFrom(world, C, P)) continue; pts.push({ az: Math.atan2(P[0] - x, P[1] - y) / RAD, el: Math.atan2(P[2] - C[2], d) / RAD, P }); }
      if (pts.length >= 0.5 * samples[i].length) seen.push({ i, pts, n: samples[i].length });
    }
    if (countLines(seen.map(s => all[s.i])) < minLines) continue;
    let best = null;
    for (let h = 0; h < 360; h += 10) {
      const inH = seen.map(s => ({ ...s, pts: s.pts.filter(q => Math.abs(wrap180(q.az - h)) <= halfH) })).filter(s => s.pts.length >= 0.5 * s.n);
      if (countLines(inH.map(s => all[s.i])) < minLines) continue;
      const els = inH.flatMap(s => s.pts.map(q => q.el)), pitch = Math.max(-15, Math.min(35, (Math.min(...els) + Math.max(...els)) / 2));
      const inF = inH.map(s => ({ ...s, pts: s.pts.filter(q => Math.abs(q.el - pitch) <= halfV) })).filter(s => {
        if (s.pts.length < 0.5 * s.n) return false;
        const az = s.pts.map(q => wrap180(q.az - h)), el = s.pts.map(q => q.el);
        return Math.hypot(Math.max(...az) - Math.min(...az), Math.max(...el) - Math.min(...el)) * RAD * focal >= 60;
      });
      const nL = countLines(inF.map(s => all[s.i]));
      if (nL < minLines || distinctDirs(inF.map(s => all[s.i])) < 2) continue;
      const az = inF.flatMap(s => s.pts.map(q => wrap180(q.az - h))), spread = Math.max(...az) - Math.min(...az);
      if (spread < minSpread) continue;
      const centre = norm360(h + (Math.max(...az) + Math.min(...az)) / 2), score = spread * Math.sqrt(nL) * (1 - Math.abs(dn - 9) / 20);
      if (!best || score > best.score) best = { heading: centre, pitch, used: inF, nL, spread, score };
    }
    if (best) cands.push({ x, y, z: C[2], C, dn, bld: near?.id ?? null, sky: 0, ...best });
  }
  cands.sort((a, b) => b.score - a.score);
  for (const c of cands.slice(0, 40)) {   // sky behind the roof line makes the edge stand out: a bonus for the leaders only
    const pts = c.used.flatMap(s => s.pts), sky = pts.filter(q => skyBehind(world, c.C, q.P)).length / (pts.length || 1);
    c.sky = sky; c.score *= 1 + 0.5 * sky;
  }
  cands.sort((a, b) => b.score - a.score);
  const around = c => (mc ? Math.atan2(c.x - mc[0], c.y - mc[1]) / RAD : 0), chosen = [];
  const pickFrom = (list, sep) => { for (const c of list) { if (chosen.length >= n) break; if (chosen.includes(c)) continue; if (chosen.every(o => Math.abs(wrap180(around(o) - around(c))) >= sep && Math.hypot(o.x - c.x, o.y - c.y) >= 8)) chosen.push(c); } };
  if (world.gate) { const g = cands.find(c => Math.hypot(c.x - world.gate[0], c.y - world.gate[1]) <= 12); if (g) chosen.push(g); }
  for (const sep of [sepDeg, sepDeg / 2, 0]) if (chosen.length < 2 || sep === sepDeg) pickFrom(cands, sep);
  return chosen.map(c => ({ x: c.x, y: c.y, z: c.z, heading: +c.heading.toFixed(1), pitch: +c.pitch.toFixed(1), roll: 0, hfov: cam.hfov, w: cam.w, h: cam.h, lines: c.used.map(s => all[s.i]), count: c.nL, spread: +c.spread.toFixed(1), dist: +c.dn.toFixed(1), bld: c.bld, sky: +c.sky.toFixed(2), score: +c.score.toFixed(1) }));
}

/**
 * The ghost seen from a pose: the visible, in-frame parts of the roof lines (at least 1 m long), then the building
 * skyline (the highest laser surface per picture column, where it is a building) as straight pieces.
 * @param {import("./pose.js").Pose} pose @param {World} world @param {RoofLine[]} [lines]
 * @returns {RoofLine[]}
 */
export function ghostLines(pose, world, lines = roofLines(world), { skyline = true, max = 40 } = {}) {
  const C = /** @type {P3} */ ([pose.x, pose.y, pose.z]), out = [];
  const inFrame = P => { const s = projectSegment(pose, P, P); return !!s && s.a[0] >= 0 && s.a[0] <= pose.w && s.a[1] >= 0 && s.a[1] <= pose.h && camDepth(pose, P) > 0.5; };
  for (const L of lines) {
    const len = Math.hypot(L.B[0] - L.A[0], L.B[1] - L.A[1], L.B[2] - L.A[2]), m = Math.max(2, Math.ceil(len / 0.5));
    let run = null;
    const flush = () => { if (run && Math.hypot(run[1][0] - run[0][0], run[1][1] - run[0][1], run[1][2] - run[0][2]) >= 1) out.push({ ...L, A: run[0], B: run[1] }); run = null; };
    for (let i = 0; i <= m; i++) {
      const P = /** @type {P3} */ (L.A.map((v, k) => v + ((L.B[k] - v) * i) / m));
      if (inFrame(P) && visibleFrom(world, C, P)) run = run ? [run[0], P] : [P, P]; else flush();
    }
    flush();
  }
  if (skyline) out.push(...skylineLines(pose, world));
  return out.slice(0, max);
}
function camDepth(pose, P) { const { f } = camAxes(pose); return (P[0] - pose.x) * f[0] + (P[1] - pose.y) * f[1] + (P[2] - pose.z) * f[2]; }

/** The skyline of buildings seen from a pose: per picture column (every w/cols pixels) the laser point with the highest
 *  elevation angle out to `maxD` m, kept where it lies on a building and above the camera's horizon; neighbouring
 *  columns at a similar range are joined and straightened (3 px).
 *  @param {import("./pose.js").Pose} pose @param {World} world @returns {RoofLine[]} */
export function skylineLines(pose, world, { cols = 48, maxD = 80, minEl = 1, buildingsOnly = true, tolPx = 3 } = {}) {
  const { focal } = camAxes(pose), pts = [];
  const onBld = (x, y) => world.buildings.some(b => inRing([x, y], b.ring) || ringDist([x, y], b.ring) < 0.5);
  for (let k = 0; k <= cols; k++) {
    const u = (pose.w * k) / cols, az = (pose.heading + Math.atan((u - pose.w / 2) / focal) / RAD) * RAD, sx = Math.sin(az), sy = Math.cos(az);
    let best = null;
    for (let d = 1; d <= maxD; d += d < 30 ? 0.5 : 1) {
      const x = pose.x + sx * d, y = pose.y + sy * d, z = world.dom(x, y); if (Number.isNaN(z)) break;
      const el = Math.atan2(z - pose.z, d) / RAD; if (!best || el > best.el) best = { el, d, P: /** @type {P3} */ ([x, y, z]) };
    }
    const pr = best && projectSegment(pose, best.P, best.P);
    pts.push(best && best.el >= minEl && (!buildingsOnly || onBld(best.P[0], best.P[1])) && pr && pr.a[1] >= 0 && pr.a[1] <= pose.h ? { ...best, uv: pr.a } : null);
  }
  const out = [];
  let chain = [];
  const flush = () => {
    if (chain.length >= 3) { const idx = simplifyIdx(chain.map(c => c.uv), tolPx); for (let j = 0; j < idx.length - 1; j++) out.push({ A: chain[idx[j]].P, B: chain[idx[j + 1]].P, kind: /** @type {"skyline"} */ ("skyline") }); }
    chain = [];
  };
  for (const p of pts) {
    const last = chain[chain.length - 1];
    if (p && (!last || Math.abs(p.d - last.d) < 0.15 * Math.max(p.d, last.d) + 1)) chain.push(p); else { flush(); if (p) chain.push(p); }
  }
  flush();
  return out;
}

const r7 = v => +v.toFixed(7), r2 = v => +v.toFixed(2);
/**
 * doc.anchorPlan for a plan: 2-4 start spots with their ghost. Needs the buildings (doc.buildings) and the height
 * grids from detect.js fetchSurface ({ g, surf, ground }); an empty list when no spot has three roof lines in view
 * (say so in the status text: "Fant ikke noe godt startpunkt; bruk knappenålen").
 * @param {{ lot?: { ring: number[][] }, buildings?: { id: string, ring: number[][] }[], paths?: any[] }} doc
 * @param {{ g: any, surf: ArrayLike<number>, ground: ArrayLike<number> }} surface
 * @param {{ utm: (p: number[]) => number[], toLL: (p: number[]) => number[], cam?: Cam, n?: number }} opts
 * @returns {AnchorSpot[]}
 */
export function planAnchors(doc, surface, { utm, toLL, cam = PHONE_CAM, n = 4, ...rest }) {
  const world = anchorWorld(doc, surface, utm), lines = roofLines(world);
  return planSpots(world, { cam, n, lines, ...rest }).map((s, i) => {
    const ghost = ghostLines(s, world, lines), ll = P => { const [lng, lat] = toLL([P[0], P[1]]); return p3(r7(lng), r7(lat), r2(P[2])); };
    const [lng, lat] = toLL([s.x, s.y]), nRoof = s.count, ridge = s.lines.some(l => l.kind === "ridge");
    return {
      id: `anc-${i + 1}`, spot: [r7(lng), r7(lat)], z: r2(s.z), eye: EYE_M, heading: s.heading, pitch: s.pitch, hfov: cam.hfov, w: cam.w, h: cam.h,
      ghost: ghost.map(g => ({ A: ll(g.A), B: ll(g.B), kind: g.kind })), lines: nRoof, spread: s.spread, dist: s.dist, bld: s.bld,
      why: `${nRoof} taklinjer${ridge ? " med møne" : ""} synlige over ${Math.round(s.spread)}°, ${Math.round(s.dist)} m fra huset${s.sky > 0.5 ? ", himmel bak taket" : ""}`,
      acc: nRoof >= 5 ? 0.3 : 0.5, src: "plan",
    };
  });
}

/** The pose a spot asks for, in metres, with the live camera's lens (its own pixel size and field of view) when given.
 *  @param {AnchorSpot} spot @param {(p: number[]) => number[]} utm @param {Partial<Cam>} [cam] @returns {import("./pose.js").Pose} */
export function planPose(spot, utm, cam = {}) {
  const [x, y] = utm(spot.spot);
  return { x, y, z: spot.z, heading: spot.heading, pitch: spot.pitch, roll: 0, hfov: cam.hfov ?? spot.hfov, w: cam.w ?? spot.w, h: cam.h ?? spot.h };
}
/** The ghost lines in metres (for solvePose6's `ghost`). @param {AnchorSpot} spot @returns {RoofLine[]} */
export function ghost3(spot, utm) {
  const m = P => /** @type {P3} */ ([...utm([P[0], P[1]]).slice(0, 2), P[2]]);
  return spot.ghost.map(g => ({ A: m(g.A), B: m(g.B), kind: /** @type {any} */ (g.kind) }));
}
/** The ghost to draw over the live camera: pixel segments seen from the TARGET pose (never from the sensors).
 *  @param {AnchorSpot} spot @param {Partial<Cam>} cam @returns {{ kind: string, a: number[], b: number[] }[]} */
export function ghostScreen(spot, cam, utm) {
  const pose = planPose(spot, utm, cam), out = [];
  for (const g of ghost3(spot, utm)) { const s = projectSegment(pose, g.A, g.B); if (s) out.push({ kind: g.kind, a: s.a, b: s.b }); }
  return out;
}

/* ---------- Lining up on the spot ---------- */
const DIRS = ["nord", "nordøst", "øst", "sørøst", "sør", "sørvest", "vest", "nordvest"];
export const dirWord = bearing => DIRS[Math.round(norm360(bearing) / 45) % 8];
export const LINE_UP = Object.freeze({ nearM: 3, headingDeg: 8, pitchDeg: 5, steadyMs: 800, edgePx: 2.5 });

/** How long (ms) the phone has held still: the readings (newest last, { t, heading, pitch }) stayed within `tolDeg` of the latest. */
export function steadyFor(hist, t, tolDeg = 1.5) {
  if (!hist?.length) return 0;
  const last = hist[hist.length - 1]; let since = last.t;
  for (let i = hist.length - 1; i >= 0; i--) {
    const q = hist[i];
    if (Math.abs(wrap180((q.heading ?? 0) - (last.heading ?? 0))) > tolDeg || Math.abs((q.pitch ?? 0) - (last.pitch ?? 0)) > tolDeg) break;
    since = q.t;
  }
  return Math.max(0, t - since);
}

/**
 * Is the user standing on the spot, looking the right way, holding still? Distance must be within max(3 m, the GPS
 * accuracy), pitch within 5°, still for 0.8 s; heading within 8° is advice only (the compass is what the anchor
 * corrects, the ghost is the truth). `edge` (edgeScore mean, edge-map pixels) at or under 2.5 turns the ghost green and
 * lets the shutter fire by itself.
 * @param {AnchorSpot} spot
 * @param {{ lng: number, lat: number, acc?: number|null, heading?: number|null, pitch?: number|null, steadyMs?: number, edge?: number|null }} live
 * @param {{ utm: (p: number[]) => number[], limits?: Partial<typeof LINE_UP> }} opts
 * @returns {{ ready: boolean, auto: boolean, near: boolean, dist: number, bearing: number, dHeading: number|null, headingOk: boolean, dPitch: number|null, pitchOk: boolean, steady: boolean, green: boolean, say: string, hint: string|null }}
 */
export function lineUpVerdict(spot, live, { utm, limits = {} }) {
  const L = { ...LINE_UP, ...limits }, [x0, y0] = utm(spot.spot), [x, y] = utm([live.lng, live.lat]);
  const dist = Math.hypot(x0 - x, y0 - y), bearing = norm360(Math.atan2(x0 - x, y0 - y) / RAD), near = dist <= Math.max(L.nearM, live.acc ?? 0);
  const dHeading = live.heading == null ? null : wrap180(live.heading - spot.heading), headingOk = dHeading == null || Math.abs(dHeading) <= L.headingDeg;
  const dPitch = live.pitch == null ? null : live.pitch - spot.pitch, pitchOk = dPitch != null && Math.abs(dPitch) <= L.pitchDeg;
  const steady = (live.steadyMs ?? 0) >= L.steadyMs, green = live.edge != null && live.edge <= L.edgePx;
  const ready = near && pitchOk && steady, auto = ready && green;
  const say = !near ? `Gå til startpunktet (${Math.round(dist)} m mot ${dirWord(bearing)})`
    : dPitch == null ? "Hold telefonen opp mot huset"
    : !pitchOk ? (dPitch < 0 ? "Vipp telefonen litt opp" : "Vipp telefonen litt ned")
    : !steady ? "Hold telefonen stille"
    : green ? "Treffer! Tar startbildet" : "Legg huset i omrisset og trykk";
  const hint = near && !headingOk ? (dHeading > 0 ? "Snu deg litt mot venstre" : "Snu deg litt mot høyre") : null;
  return { ready, auto, near, dist: +dist.toFixed(1), bearing: Math.round(bearing), dHeading: dHeading == null ? null : +dHeading.toFixed(1), headingOk, dPitch: dPitch == null ? null : +dPitch.toFixed(1), pitchOk, steady, green, say, hint };
}

/** "Kan ikke stå her": the next planned spot not yet skipped, or null (the run then starts with anchorSrc "none").
 *  @param {AnchorSpot[]} plan @param {string[]} skipped */
export const nextAnchor = (plan, skipped = []) => (plan || []).find(s => !skipped.includes(s.id)) || null;

/* ---------- The run on the phone: start spot, recording, end anchor (a pure reducer; tests/anchor-flow.test.mjs) ----------
   phase "check" (Sjekk utstyret) → "start" (line up on a start spot; the shutter takes the start anchor) → "run" (frames as
   today) → "end" (Ferdig: line up on the start spot again, or another planned one) → "done". "Kan ikke stå her" is the only
   way past a spot: the next one, and with none left the run starts without an anchor (anchorSrc "none", said in the status
   line) or ends without an end anchor. Ferdig in the end phase ends the run there. */

/** @typedef {{ phase: "check"|"start"|"run"|"end"|"done", plan: AnchorSpot[], spot: string|null, run: import("./pose.js").Run|null,
 *   endSkipped: string[], note: null|"no-plan"|"not-ready"|"skipped"|"no-end"|"closed" }} Flow */
/** @returns {Flow} */
export const flowInit = () => ({ phase: "check", plan: [], spot: null, run: null, endSkipped: [], note: null });
/* The end anchor: the start spot first (a closed loop), then the others in plan order. */
const endOrder = (plan, startId) => [...plan.filter(s => s.id === startId), ...plan.filter(s => s.id !== startId)];

/**
 * @param {Flow} s
 * @param {{ type: "go", plan: AnchorSpot[]|null|undefined, id: string, at?: string, why?: "no-plan"|"not-ready" }
 *   | { type: "skip" } | { type: "frame" } | { type: "finish" }
 *   | { type: "anchor", which: "start"|"end", photo: string, at: string, bias?: any, drift?: any, z?: number|null }} a
 * @returns {Flow}
 */
export function runFlow(s, a) {
  const run = s.run;
  switch (a.type) {
    case "go": {
      if (s.phase !== "check") return s;
      const plan = (a.plan || []).filter(p => p?.id && p.spot), r = makeRun({ id: a.id, at: a.at }), first = nextAnchor(plan, []);
      return first ? { ...s, phase: "start", plan, spot: first.id, run: { ...r, plan: first.id }, note: null }
        : { ...s, phase: "run", plan, spot: null, run: r, note: a.why || "no-plan" };
    }
    case "skip": {
      if (s.phase === "start") {
        const skipped = [...run.skipped, s.spot], next = nextAnchor(s.plan, skipped);
        return next ? { ...s, spot: next.id, run: { ...run, plan: next.id, skipped } } : { ...s, phase: "run", spot: null, run: { ...run, plan: null, skipped }, note: "skipped" };
      }
      if (s.phase === "end") {
        const endSkipped = [...s.endSkipped, s.spot], next = nextAnchor(endOrder(s.plan, run.plan), endSkipped);
        return next ? { ...s, spot: next.id, endSkipped } : { ...s, phase: "done", spot: null, endSkipped, note: "no-end" };
      }
      return s;
    }
    case "anchor": {
      if (a.which === "start" && s.phase === "start") {
        return { ...s, phase: "run", spot: null, note: null, run: { ...run, start: { photo: a.photo, at: a.at }, bias: a.bias ?? null, anchorSrc: anchorSrcOf({ start: true }), frames: run.frames + 1, ...(a.z != null ? { z: a.z } : {}) } };
      }
      if (a.which === "end" && s.phase === "end") {
        return { ...s, phase: "done", spot: null, note: "closed", run: { ...run, end: { photo: a.photo, at: a.at }, drift: a.drift ?? null, anchorSrc: anchorSrcOf({ start: true, end: true }), frames: run.frames + 1 } };
      }
      return s;
    }
    case "frame": return s.phase === "run" ? { ...s, run: { ...run, frames: run.frames + 1 } } : s;
    case "finish": {
      if (s.phase === "run" && run?.bias && run.anchorSrc === "start-frame") {
        const next = nextAnchor(endOrder(s.plan, run.plan), []);
        if (next) return { ...s, phase: "end", spot: next.id, endSkipped: [] };
      }
      if (s.phase === "end") return { ...s, phase: "done", spot: null, note: "no-end" };
      return { ...s, phase: "done", spot: null, run: s.phase === "start" || s.phase === "check" ? null : run };   // nothing taken yet: no run
    }
  }
  return s;
}
/** The spot the flow asks for now. @param {Flow} s */
export const flowSpot = s => (s.spot ? s.plan.find(p => p.id === s.spot) || null : null);
/** What the shutter does in this phase: take the start or end anchor, an ordinary frame, or nothing. @param {Flow} s */
export const shutterKind = s => (s.phase === "start" ? "start" : s.phase === "end" ? "end" : s.phase === "run" ? "frame" : null);
/** A run worth keeping in doc.runs: it has an anchor or at least one frame. */
export const keepRun = s => !!s.run && (s.run.frames > 0 || !!s.run.start);
/** The line the status shows about the run's anchor (never silent about a missing one). @param {Flow} s */
export function flowNote(s, closure = "") {
  if (s.note === "no-plan") return "Runden er uten ankerbilde: fant ikke noe godt startpunkt (ingen tre taklinjer i synsfeltet fra tomta). Plasser og pek startbildet i kartet etterpå.";
  if (s.note === "not-ready") return "Runden er uten ankerbilde: startpunktet var ikke planlagt ennå (høydedataene svarer sakte). Plasser og pek startbildet i kartet etterpå.";
  if (s.note === "skipped") return "Runden er uten ankerbilde: alle startpunktene ble hoppet over. Plasser og pek startbildet i kartet etterpå.";
  if (s.note === "no-end") return "Runden ble avsluttet uten sluttbilde: retningen er rettet fra startbildet alene.";
  if (s.note === "closed") return `Runden er lukket: ${closure}`;
  return "";
}

/* ---------- Drawing over a picture shown with object-fit: cover ---------- */
/** Video (or photo) pixels to screen pixels for a w x h picture covering a W x H box. */
export function coverMap(w, h, W, H) {
  const k = Math.max(W / (w || 1), H / (h || 1)), ox = (W - w * k) / 2, oy = (H - h * k) / 2;
  return { k, ox, oy, to: ([u, v]) => [ox + u * k, oy + v * k], from: ([x, y]) => [(x - ox) / k, (y - oy) / k] };
}

/* ---------- "Rett inn bildet": a ghost line dragged onto the real edge becomes a line tie ---------- */
/** The tie for a ghost line (3D A-B, drawn as screen segment a-b in photo pixels) moved by (du, dv) pixels: two points on
 *  the moved segment, inside the photo, as pose.js solvePose6 `lines` wants them. null when it moved under 1 pixel. */
export function dragTie(line, seg, du, dv, { w, h } = { w: Infinity, h: Infinity }) {
  if (Math.hypot(du, dv) < 1) return null;
  const pts = [0.25, 0.75].map(t => [seg.a[0] + (seg.b[0] - seg.a[0]) * t + du, seg.a[1] + (seg.b[1] - seg.a[1]) * t + dv]).map(([u, v]) => [Math.max(0, Math.min(w, u)), Math.max(0, Math.min(h, v))]);
  return { A: line.A, B: line.B, kind: line.kind, pts };
}
/** The shift that carries segment a-b across to pass through point p (a tap after choosing the line): [du, dv]. */
export function shiftThrough(seg, p) {
  const dx = seg.b[0] - seg.a[0], dy = seg.b[1] - seg.a[1], L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
  const d = (p[0] - seg.a[0]) * nx + (p[1] - seg.a[1]) * ny;
  return [nx * d, ny * d];
}
/** The ghost segment nearest a point (photo pixels), within `max` pixels: its index, or -1. */
export function nearestSeg(segs, p, max = 30) {
  let best = -1, dm = max;
  segs.forEach((s, i) => {
    if (!s) return;
    const dx = s.b[0] - s.a[0], dy = s.b[1] - s.a[1], t = Math.max(0, Math.min(1, ((p[0] - s.a[0]) * dx + (p[1] - s.a[1]) * dy) / (dx * dx + dy * dy || 1)));
    const d = Math.hypot(p[0] - s.a[0] - dx * t, p[1] - s.a[1] - dy * t); if (d < dm) { dm = d; best = i; }
  });
  return best;
}
