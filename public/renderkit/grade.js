/* The ground as a builder moves it (sykehus U3616; hagekart's terraces and ponds can take it too): an area set to a level
   or a slope, and the ground around it cut or filled to meet it with a batter, or held by a wall; a basin dug inside it
   (a pool); the cut and the fill in m³. Pure: no three.js, no DOM.

   The terrain is a grid, as fit.js reads it: T { x0, y1, res, w, h, z: [kote per cell, row by row from the north] }, a
   cell's height at its middle. Points are [east, north] in metres. gradeRing writes into T.z (the app gives it its own
   copy) and counts what it moved:

     gradeRing(T, { ring, z, edge, slope, hole, lower, keep }, write)
       ring    the area, set to z(p) inside (z: a number, or a function of the point: planeZ for a slope)
       edge    "batter" (default): outside the ring the ground goes from the ring's level to the ground at slope (run per
               rise, default SLOPE 1:2), till it meets it; "wall": the ground outside stays, a wall at the ring takes the
               step (edge_step, the highest); "none": the same, and the step is not a wall (a pond's bank)
       hole    { ring, z }: inside it the ground goes down to z (a pool's basin); its depth under the area's level is
               hole_m3, not cut_m3
       lower   only ever take ground away inside the ring (a pond dug to its depth, never filled)
       keep    a Set of cells the batter leaves as they are (outside the lot: the neighbour's ground): the highest step it
               would have made there is kept_step
     returns { cut_m3, fill_m3, hole_m3, max_cut, max_fill, reach_m, edge_step, kept_step, moved: Map(cell, dz) }

   balanceKote(net, lo, hi) the level between lo and hi where net(level) (cut − fill) is nought, to 2 cm;
   rootsHit(T, trees, moved) the trees ([east, north, …]) standing where the ground moved more than ROOT_M. */
import { pointInRing, ringDist } from "./paths2d.js";

export const SLOPE = 2, ROOT_M = 0.2;
/* the one batter rule: from the level zp, dist metres out, to the ground z0 at 1:slope */
export const batterZ = (z0, zp, dist, slope = SLOPE) => z0 > zp ? Math.min(z0, zp + dist / slope) : Math.max(z0, zp - dist / slope);
export const cellXY = (T, i) => [T.x0 + (i % T.w + 0.5) * T.res, T.y1 - (Math.floor(i / T.w) + 0.5) * T.res];
export const cellAt = (T, [x, y]) => { const c = Math.floor((x - T.x0) / T.res), r = Math.floor((T.y1 - y) / T.res); return c >= 0 && r >= 0 && c < T.w && r < T.h ? r * T.w + c : -1; };

/* the cells whose middles are inside ring */
export function cellsIn(T, ring) {
  const out = new Set(); box(T, ring, 0, i => { if (pointInRing(cellXY(T, i), ring)) out.add(i); });
  return out;
}
function box(T, ring, R, f) {
  const xs = ring.map(p => p[0]), ys = ring.map(p => p[1]);
  const c0 = Math.max(0, Math.floor((Math.min(...xs) - R - T.x0) / T.res)), c1 = Math.min(T.w - 1, Math.ceil((Math.max(...xs) + R - T.x0) / T.res));
  const r0 = Math.max(0, Math.floor((T.y1 - Math.max(...ys) - R) / T.res)), r1 = Math.min(T.h - 1, Math.ceil((T.y1 - Math.min(...ys) + R) / T.res));
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) f(r * T.w + c);
}

/* a level at `at` with a fall: toward a unit direction [east, north], 1 in per (a fall of 1:per) */
export const planeZ = ({ kote, at = [0, 0], fall = null }) => fall ? p => kote - ((p[0] - at[0]) * fall.toward[0] + (p[1] - at[1]) * fall.toward[1]) / fall.per : () => kote;

export function gradeRing(T, { ring, z, edge = "batter", slope = SLOPE, hole = null, lower = false, keep = null }, write = true) {
  const zf = typeof z === "function" ? z : () => z, cell = T.res * T.res, moved = new Map();
  const lo = Math.min(...T.z.filter(v => v != null)), hi = Math.max(...T.z.filter(v => v != null)), R = edge === "batter" ? Math.min(80, (hi - lo + 1) * slope) : 0;
  let cut = 0, fill = 0, holeV = 0, maxCut = 0, maxFill = 0, reach = 0, kept = 0;
  box(T, ring, R + T.res, i => {
    const z0 = T.z[i]; if (z0 == null) return;
    const p = cellXY(T, i), inside = pointInRing(p, ring);
    let z, off = 0, deep = 0;
    if (inside) {
      z = zf(p); if (lower) z = Math.min(z0, z);
      if (hole && pointInRing(p, hole.ring)) deep = Math.max(0, z - hole.z);
    } else {
      if (edge !== "batter") return;
      off = ringDist(p, ring); if (off > R) return;
      z = batterZ(z0, zf(p), off, slope);
      if (keep?.has(i)) { if (Math.abs(z - z0) > Math.abs(kept)) kept = z - z0; return; }
    }
    const dz = z0 - z;
    if (Math.abs(dz) >= 0.005) {
      if (dz > 0) { cut += dz * cell; maxCut = Math.max(maxCut, dz); } else { fill -= dz * cell; maxFill = Math.max(maxFill, -dz); }
      if (off > 0) reach = Math.max(reach, off);
    }
    holeV += deep * cell;
    const zz = z - deep;
    if (Math.abs(zz - z0) < 0.005) return;
    moved.set(i, zz - z0); if (write) T.z[i] = zz;
  });
  /* the step at the ring's edge, where the ground outside is left: the area's level against the ground a cell out */
  let step = 0;
  if (edge !== "batter") for (let k = 0; k < ring.length; k++) {
    const a = ring[k], b = ring[(k + 1) % ring.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(L));
    const nv = [(b[1] - a[1]) / (L || 1), -(b[0] - a[0]) / (L || 1)];
    for (let j = 0; j < n; j++) {
      const q = [a[0] + (b[0] - a[0]) * (j + 0.5) / n, a[1] + (b[1] - a[1]) * (j + 0.5) / n];
      const out = [q[0] + nv[0] * T.res, q[1] + nv[1] * T.res], o = pointInRing(out, ring) ? [q[0] - nv[0] * T.res, q[1] - nv[1] * T.res] : out, ci = cellAt(T, o);
      if (ci < 0 || T.z[ci] == null || moved.has(ci)) continue;
      const s = (lower ? Math.min(T.z[ci], zf(q)) : zf(q)) - T.z[ci]; if (Math.abs(s) > Math.abs(step)) step = s;
    }
  }
  const r2 = v => Math.round(v * 100) / 100;
  return { cut_m3: Math.round(cut), fill_m3: Math.round(fill), hole_m3: Math.round(holeV), max_cut: r2(maxCut), max_fill: r2(maxFill), reach_m: r2(reach), edge_step: r2(step), kept_step: r2(kept), moved };
}

/* the level where cut and fill are the same, between lo and hi (net: cut − fill at a level; it falls as the level rises) */
export function balanceKote(net, lo, hi, tol = 0.02) {
  let a = lo, b = hi; if (b - a < 0.05) return Math.round(lo * 10) / 10;
  while (b - a > tol) { const m = (a + b) / 2; if (net(m) > 0) a = m; else b = m; }
  return Math.round((a + b) / 2 * 10) / 10;
}

/* the trees standing where the ground goes down or up more than root: their roots are cut or buried */
export function rootsHit(T, trees, moved, root = ROOT_M) {
  let count = 0, deepest = 0;
  for (const t of trees || []) { const i = cellAt(T, t), dz = i >= 0 ? moved.get(i) : undefined; if (dz != null && Math.abs(dz) > root) { count++; deepest = Math.max(deepest, Math.abs(dz)); } }
  return count ? { count, deepest: Math.round(deepest * 100) / 100 } : null;
}
