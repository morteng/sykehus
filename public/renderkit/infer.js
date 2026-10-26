/* Inference snaps (U3876): what a point should catch while it is dragged. Pure: no three.js, no DOM, no scene.
   Units are site metres, plan view (x east, y north). Every call is cheap: rings out of reach are skipped by their
   bounding box before any edge is looked at.

   inferPoint(p, ctx) → { p, kind, guides }   the first kind (in KINDS order) that is within reach wins
     ctx.rings    [ring, ...]    closed outlines of the near buildings and shapes (the last point is not repeated)
     ctx.lines    [line, ...]    open polylines
     ctx.reach    metres          or ctx.scale (metres per pixel) × ctx.px (pixels, default 10)
     ctx.origin   [x, y]          where the drag started: enables perpendicular, parallel and axis
     ctx.axes     [{ c?, u, v }]  a building's own frame (frame.js ringFrame); lines along u and v through origin (else c)
     ctx.mirror   { a, b, refs }  a mirror axis a→b and the reference points to mirror across it
     ctx.grid     metres          the last fallback; 0 or missing: none
     ctx.span     metres          how far the two edges of a midline may be from the point (default 30)
     ctx.kinds    [names]         limit to these kinds (default all)
   guides: [{ kind, from, to, label? }] in plan metres; label is set where a number is worth showing.
   KINDS is the stable list of names (priority order) for UI text.
   Also: snapAngle (a heading to a step or to near directions), snapAlign (a point in line with reference points, in a
   frame), snapRect (a box's edges and corners against near outlines). */

export const KINDS = ["endpoint", "midpoint", "edge", "perpendicular", "parallel", "axis", "symmetry", "midline", "extension", "grid"];

const deg = r => r * 180 / Math.PI, rad = d => d * Math.PI / 180;
const wrap = a => ((a % 360) + 540) % 360 - 180;
const round = (v, s) => Math.round(v / s) * s;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];

/* the closest point on the segment p–q, and its parameter t in [0, 1] */
function onSeg(x, p, q) {
  const dx = q[0] - p[0], dy = q[1] - p[1], t = Math.max(0, Math.min(1, ((x[0] - p[0]) * dx + (x[1] - p[1]) * dy) / (dx * dx + dy * dy || 1)));
  return { q: [p[0] + t * dx, p[1] + t * dy], t };
}
/* the foot of x on the infinite line through p with unit direction d, and the signed along-distance from p */
function onLine(x, p, d) { const s = (x[0] - p[0]) * d[0] + (x[1] - p[1]) * d[1]; return { q: [p[0] + d[0] * s, p[1] + d[1] * s], s }; }

/* the edges within reach of p: [{ a, b, len, d }]; a ring that p is not within reach of (bounding box) is skipped */
function nearEdges(p, rings, lines, reach) {
  const out = [];
  const take = (pts, closed) => {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const q of pts) { if (q[0] < x0) x0 = q[0]; if (q[0] > x1) x1 = q[0]; if (q[1] < y0) y0 = q[1]; if (q[1] > y1) y1 = q[1]; }
    if (p[0] < x0 - reach || p[0] > x1 + reach || p[1] < y0 - reach || p[1] > y1 + reach) return;
    const n = closed ? pts.length : pts.length - 1;
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len > 1e-9) out.push({ a, b, len, d: [(b[0] - a[0]) / len, (b[1] - a[1]) / len] });
    }
  };
  for (const r of rings || []) take(r, true);
  for (const l of lines || []) take(l, false);
  return out;
}

export function inferPoint(p, ctx = {}) {
  const reach = ctx.reach ?? (ctx.px ?? 10) * (ctx.scale ?? 0);
  const want = ctx.kinds ? new Set(ctx.kinds) : null, on = k => !want || want.has(k);
  const O = ctx.origin || null;
  const E = nearEdges(p, ctx.rings, ctx.lines, reach);
  const hit = (kind, q, guides) => ({ p: q, kind, guides: guides.map(g => ({ kind, ...g })) });
  let best;

  if (on("endpoint")) {
    best = null;
    for (const e of E) for (const c of [e.a, e.b]) { const d = dist(c, p); if (d <= reach && (!best || d < best.d)) best = { d, c }; }
    if (best) return hit("endpoint", best.c.slice(), []);
  }
  if (on("midpoint")) {
    best = null;
    for (const e of E) { const m = [(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2], d = dist(m, p); if (d <= reach && (!best || d < best.d)) best = { d, m, e }; }
    if (best) return hit("midpoint", best.m, [{ from: best.e.a, to: best.e.b }]);
  }
  if (on("edge")) {
    best = null;
    for (const e of E) { const s = onSeg(p, e.a, e.b), d = dist(s.q, p); if (d <= reach && (!best || d < best.d)) best = { d, q: s.q, e }; }
    if (best) return hit("edge", best.q, [{ from: best.e.a, to: best.e.b }]);
  }
  if (O && on("perpendicular")) {
    best = null;
    for (const e of E) { const s = onSeg(O, e.a, e.b); if (s.t <= 0 || s.t >= 1) continue; const d = dist(s.q, p); if (d <= reach && (!best || d < best.d)) best = { d, q: s.q }; }
    if (best) return hit("perpendicular", best.q, [{ from: O, to: best.q }]);
  }
  if (O && on("parallel")) {
    best = null;
    for (const e of E) { const l = onLine(p, O, e.d), d = dist(l.q, p); if (Math.abs(l.s) > 1e-9 && d <= reach && (!best || d < best.d)) best = { d, q: l.q, e }; }
    if (best) return hit("parallel", best.q, [{ from: best.e.a, to: best.e.b }, { from: O, to: best.q }]);
  }
  if (on("axis")) {
    best = null;
    for (const ax of ctx.axes || []) {
      const o = O || ax.c; if (!o) continue;
      for (const d of [ax.u, ax.v]) { const l = onLine(p, o, d), dd = dist(l.q, p); if (dd <= reach && (!best || dd < best.d)) best = { d: dd, q: l.q, o }; }
    }
    if (best) return hit("axis", best.q, [{ from: best.o, to: best.q }]);
  }
  if (ctx.mirror && on("symmetry")) {
    const { a, b, refs = [] } = ctx.mirror, L = dist(a, b);
    if (L > 1e-9) {
      const d = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
      best = null;
      for (const r of refs) { const f = onLine(r, a, d).q, m = [2 * f[0] - r[0], 2 * f[1] - r[1]], dd = dist(m, p); if (dd <= reach && (!best || dd < best.d)) best = { d: dd, m, r }; }
      if (best) return hit("symmetry", best.m, [{ from: best.r, to: best.m }, { from: a, to: b }]);
    }
  }
  if (on("midline")) {
    /* the line half way between two edges that run the same way */
    best = null;
    const M = nearEdges(p, ctx.rings, ctx.lines, Math.max(reach, ctx.span ?? 30));   // the two edges may be far from p
    for (let i = 0; i < M.length; i++) for (let j = i + 1; j < M.length; j++) {
      const e = M[i], f = M[j];
      if (Math.abs(e.d[0] * f.d[1] - e.d[1] * f.d[0]) > 1e-6) continue;
      const n = [-e.d[1], e.d[0]], g = dot([f.a[0] - e.a[0], f.a[1] - e.a[1]], n);
      if (Math.abs(g) < 1e-6) continue;
      const mid = [e.a[0] + n[0] * g / 2, e.a[1] + n[1] * g / 2], l = onLine(p, mid, e.d), d = dist(l.q, p);
      if (d <= reach && (!best || d < best.d)) best = { d, q: l.q, mid, dir: e.d };
    }
    if (best) return hit("midline", best.q, [{ from: [best.mid[0] - best.dir[0] * 1000, best.mid[1] - best.dir[1] * 1000], to: [best.mid[0] + best.dir[0] * 1000, best.mid[1] + best.dir[1] * 1000] }]);
  }
  if (on("extension")) {
    best = null;
    for (const e of E) {
      const l = onLine(p, e.a, e.d), d = dist(l.q, p);
      if (d > reach || (l.s >= 0 && l.s <= e.len)) continue;   // beside the edge is "edge"; this is beyond its ends
      if (!best || d < best.d) best = { d, q: l.q, from: l.s < 0 ? e.a : e.b };
    }
    if (best) return hit("extension", best.q, [{ from: best.from, to: best.q }]);
  }
  if (ctx.grid > 0 && on("grid")) return hit("grid", [round(p[0], ctx.grid), round(p[1], ctx.grid)], []);
  return { p: p.slice(), kind: null, guides: [] };
}

/* a heading (degrees) snapped to the nearest of the directions (and their quarter turns) within tol degrees, else to
   the step; → { a, kind: "direction" | "step" } */
export function snapAngle(a, dirs = [], { step = 15, tol = 4 } = {}) {
  let best = null;
  for (const d of dirs) for (const k of [0, 90, 180, 270]) { const x = wrap(d + k), e = Math.abs(wrap(a - x)); if (e < tol && (!best || e < best.e)) best = { e, x }; }
  return best ? { a: best.x, kind: "direction" } : { a: wrap(round(a, step)), kind: "step" };
}
/* the directions (degrees) of the edges longer than minLen, of the rings with a point in reach of c */
export function edgeAngles(rings, c, reach, minLen = 3) {
  const out = [];
  for (const r of rings) {
    if (!r.some(p => Math.hypot(p[0] - c[0], p[1] - c[1]) < reach)) continue;
    for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; if (Math.hypot(q[0] - p[0], q[1] - p[1]) > minLen) out.push(deg(Math.atan2(q[1] - p[1], q[0] - p[0]))); }
  }
  return out;
}

/* g in line with the reference points along the frame's u (unit) and across it (within tol), else on the grid in that
   frame; → { gu, gv, su, sv, hits: refs that line up with each: [{ ref, axis: "u" | "v" }] } (su/sv null: the grid) */
export function snapAlign(g, refs, u, { grid = 0.5, tol = 0.6 } = {}) {
  const v = [-u[1], u[0]];
  let gu = dot(g, u), gv = dot(g, v);
  const su = refs.map(p => dot(p, u)).find(x => Math.abs(x - gu) < tol) ?? null, sv = refs.map(p => dot(p, v)).find(x => Math.abs(x - gv) < tol) ?? null;
  gu = su ?? round(gu, grid); gv = sv ?? round(gv, grid);
  const hits = [];
  for (const q of refs) { if (su != null && Math.abs(dot(q, u) - gu) < 1e-6) hits.push({ ref: q, axis: "u" }); if (sv != null && Math.abs(dot(q, v) - gv) < 1e-6) hits.push({ ref: q, axis: "v" }); }
  return { gu, gv, su, sv, hits, p: [u[0] * gu + v[0] * gv, u[1] * gu + v[1] * gv] };
}

/* a box { c, L, W, a (deg) } with its angle already set: each pair of its edges against the near outlines' edges that run
   the same way (within 2°): the smallest shift under tol wins; else a corner to a near corner (within tol).
   → { c, guides: [{ kind: "parallel" | "endpoint", from, to }] } */
export function snapRect(s, rings, { tol = 1.2, reach = 40 } = {}) {
  const c = s.c.slice(), guides = [];
  const near = rings.filter(r => r.some(p => Math.hypot(p[0] - s.c[0], p[1] - s.c[1]) < reach + s.L));
  const u = [Math.cos(rad(s.a)), Math.sin(rad(s.a))], v = [-u[1], u[0]];
  const shift = { u: null, v: null };
  for (const ring of near) for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length], L = Math.hypot(q[0] - p[0], q[1] - p[1]); if (L < 1) continue;
    const d = [(q[0] - p[0]) / L, (q[1] - p[1]) / L];
    for (const [n, ax, half, along, halfAlong] of [["v", v, s.W / 2, u, s.L / 2], ["u", u, s.L / 2, v, s.W / 2]]) {
      if (Math.abs(dot(d, ax)) > Math.sin(rad(2))) continue;
      const off = dot([p[0] - c[0], p[1] - c[1]], ax), a0 = dot([p[0] - c[0], p[1] - c[1]], along), a1 = dot([q[0] - c[0], q[1] - c[1]], along);
      if (Math.min(a0, a1) > halfAlong + reach || Math.max(a0, a1) < -halfAlong - reach) continue;
      for (const side of [-half, half]) {
        const dl = off - side; if (Math.abs(dl) > tol) continue;
        if (!shift[n] || Math.abs(dl) < Math.abs(shift[n].dl)) shift[n] = { dl, ax, along, off, span: [Math.min(a0, a1, -halfAlong), Math.max(a0, a1, halfAlong)] };
      }
    }
  }
  if (!shift.u && !shift.v) {
    const h = [[-s.L / 2, -s.W / 2], [s.L / 2, -s.W / 2], [s.L / 2, s.W / 2], [-s.L / 2, s.W / 2]].map(([a, b]) => [c[0] + u[0] * a + v[0] * b, c[1] + u[1] * a + v[1] * b]);
    let best = null;
    for (const k of h) for (const ring of near) for (const p of ring) { const d = Math.hypot(p[0] - k[0], p[1] - k[1]); if (d < tol && (!best || d < best.d)) best = { d, dx: p[0] - k[0], dy: p[1] - k[1], p }; }
    if (best) { c[0] += best.dx; c[1] += best.dy; guides.push({ kind: "endpoint", from: [best.p[0] - 2, best.p[1]], to: [best.p[0] + 2, best.p[1]] }, { kind: "endpoint", from: [best.p[0], best.p[1] - 2], to: [best.p[0], best.p[1] + 2] }); }
    return { c, guides };
  }
  const c0 = c.slice();
  for (const k of ["u", "v"]) if (shift[k]) { c[0] += shift[k].ax[0] * shift[k].dl; c[1] += shift[k].ax[1] * shift[k].dl; }
  for (const k of ["u", "v"]) if (shift[k]) {
    const { ax, along, off, span } = shift[k], base = [c0[0] + ax[0] * off, c0[1] + ax[1] * off];
    guides.push({ kind: "parallel", from: [base[0] + along[0] * (span[0] - 2), base[1] + along[1] * (span[0] - 2)], to: [base[0] + along[0] * (span[1] + 2), base[1] + along[1] * (span[1] + 2)] });
  }
  return { c, guides };
}
