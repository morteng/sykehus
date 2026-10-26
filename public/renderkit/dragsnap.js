/* What a dragged volume or ground corner catches, for build.js and shape.js (U3878). Pure: no three.js, no DOM.
   One context per drag (dragContext: the near outlines, their own axes, the mirror lines across them), then one cheap
   call per pointer move (snapDragPoint → infer.js inferPoint). Units are the app's metres, x east, y north.
   Guides leave here as [from, to, kind, label?]: the first two are what build.js and shape.js always drew. */
import { inferPoint } from "./infer.js";
import { ringFrame } from "./frame.js";

/* the kinds a dragged volume tries (its rectangle's own edges and corners are snapRect's) */
export const VOLUME_KINDS = ["midpoint", "perpendicular", "parallel", "axis", "symmetry", "midline"];
/* a corner of a volume leaves the midline to the centre (the midline looks at every pair of near edges: the dear one) */
export const CORNER_KINDS = VOLUME_KINDS.filter(k => k !== "midline");
/* the kinds a ground corner tries, before the grid */
export const POINT_KINDS = ["endpoint", "midpoint", "edge", "perpendicular", "parallel", "axis", "symmetry", "midline", "extension"];

const LABELS = { symmetry: "symmetri", midline: "lik avstand" };

/* the outlines in reach of c (at most max, the nearest first), each one's frame, and the mirror lines through each
   frame's centre along u and across it, with the near outlines' points as the things to mirror */
export function dragContext(rings, c, reach = 40, max = 10) {
  const centre = r => { let x = 0, y = 0; for (const p of r) { x += p[0]; y += p[1]; } return [x / r.length, y / r.length]; };
  const near = rings.filter(r => r.length >= 3 && r.some(p => Math.hypot(p[0] - c[0], p[1] - c[1]) < reach))
    .map(r => ({ r, d: Math.hypot(...centre(r).map((v, i) => v - c[i])) })).sort((a, b) => a.d - b.d).slice(0, max).map(x => x.r);
  const axes = near.map(r => { const f = ringFrame(r); return { c: f.c, u: f.u, v: f.v }; });
  const refs = []; for (const r of near) for (const p of r) if (refs.length < 80) refs.push(p);
  const mirrors = [];
  for (const f of axes) for (const d of [f.u, f.v]) mirrors.push({ a: f.c, b: [f.c[0] + d[0], f.c[1] + d[1]], refs });
  return { rings: near, axes, mirrors, midlines: midlinesOf(near, c, 30) };
}

/* the lines half way between two near edges that run the same way (within half a degree), overlap along their length
   and are 1 to span m apart; found once per drag, so a pointer move only measures a distance to each */
function midlinesOf(rings, c, span, max = 200) {
  const E = [];
  for (const r of rings) for (let i = 0; i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L >= 2 && Math.hypot((a[0] + b[0]) / 2 - c[0], (a[1] + b[1]) / 2 - c[1]) < 60 + L) E.push({ a, b, L, d: [(b[0] - a[0]) / L, (b[1] - a[1]) / L] });
  }
  const out = [];
  for (let i = 0; i < E.length && out.length < max; i++) for (let j = i + 1; j < E.length && out.length < max; j++) {
    const e = E[i], f = E[j];
    if (Math.abs(e.d[0] * f.d[1] - e.d[1] * f.d[0]) > 0.009) continue;
    const n = [-e.d[1], e.d[0]], g = (f.a[0] - e.a[0]) * n[0] + (f.a[1] - e.a[1]) * n[1];
    if (Math.abs(g) < 1 || Math.abs(g) > span) continue;
    const t0 = (f.a[0] - e.a[0]) * e.d[0] + (f.a[1] - e.a[1]) * e.d[1], t1 = (f.b[0] - e.a[0]) * e.d[0] + (f.b[1] - e.a[1]) * e.d[1];
    if (Math.max(t0, t1) < 0 || Math.min(t0, t1) > e.L) continue;   // side by side, not one beyond the other
    out.push({ mid: [e.a[0] + n[0] * g / 2, e.a[1] + n[1] * g / 2], d: e.d });
  }
  return out;
}

/* p against the context: the nearest catch within reach, else { p, kind: null, guides: [] }. origin: where p's drag
   started (enables perpendicular, parallel and the axes through it). */
export function snapDragPoint(p, ctx, { origin = null, reach = 1.2, kinds = VOLUME_KINDS } = {}) {
  if (!ctx || !ctx.rings.length) return { p: p.slice(), kind: null, guides: [] };
  const base = { rings: ctx.rings, origin, axes: ctx.axes, reach };
  const own = kinds.filter(k => k !== "symmetry" && k !== "midline");
  let best = own.length ? inferPoint(p, { ...base, kinds: own }) : { p, kind: null, guides: [] };
  if (kinds.includes("symmetry")) {
    /* the mirror of p across each line, then the nearest real point to that: a mirror image of a corner (what inferPoint's
       symmetry finds, turned round so a move costs one reflection per line, not one per point) */
    let sym = null, dd = Infinity;
    for (const m of ctx.mirrors) {
      const L = Math.hypot(m.b[0] - m.a[0], m.b[1] - m.a[1]); if (L < 1e-9) continue;
      const d = [(m.b[0] - m.a[0]) / L, (m.b[1] - m.a[1]) / L], t = (p[0] - m.a[0]) * d[0] + (p[1] - m.a[1]) * d[1], f = [m.a[0] + d[0] * t, m.a[1] + d[1] * t], q = [2 * f[0] - p[0], 2 * f[1] - p[1]];
      for (const r of m.refs) {
        const e = Math.hypot(r[0] - q[0], r[1] - q[1]); if (e > reach || e >= dd) continue;
        const u = (r[0] - m.a[0]) * d[0] + (r[1] - m.a[1]) * d[1], w = [2 * (m.a[0] + d[0] * u) - r[0], 2 * (m.a[1] + d[1] * u) - r[1]];   // r across the line
        dd = e; sym = { p: w, kind: "symmetry", guides: [{ kind: "symmetry", from: r, to: w }, { kind: "symmetry", from: m.a, to: m.b }] };
      }
    }
    /* symmetry is a mirror of a real point: it wins over the looser lines, never over a corner, a midpoint or an edge */
    if (sym && (!best.kind || ["axis", "midline", "parallel", "perpendicular", "extension"].includes(best.kind))) best = sym;
  }
  if (kinds.includes("midline") && ctx.midlines?.length && (!best.kind || best.kind === "extension")) {
    let m = null;
    for (const l of ctx.midlines) {
      const s = (p[0] - l.mid[0]) * l.d[0] + (p[1] - l.mid[1]) * l.d[1], q = [l.mid[0] + l.d[0] * s, l.mid[1] + l.d[1] * s], d = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (d <= reach && (!m || d < m.d)) m = { d, q, l };
    }
    if (m) best = { p: m.q, kind: "midline", guides: [{ kind: "midline", from: [m.l.mid[0] - m.l.d[0] * 1000, m.l.mid[1] - m.l.d[1] * 1000], to: [m.l.mid[0] + m.l.d[0] * 1000, m.l.mid[1] + m.l.d[1] * 1000] }] };
  }
  return best;
}

/* the guides as [from, to, kind, label], the endless midline cut to 2 × span round the point */
export function guideList(r, span = 25) {
  return r.guides.map(g => {
    let { from, to } = g;
    if (g.kind === "midline") { const L = Math.hypot(to[0] - from[0], to[1] - from[1]) || 1, d = [(to[0] - from[0]) / L, (to[1] - from[1]) / L]; from = [r.p[0] - d[0] * span, r.p[1] - d[1] * span]; to = [r.p[0] + d[0] * span, r.p[1] + d[1] * span]; }
    return [from, to, g.kind, g.label ?? LABELS[g.kind] ?? null];
  });
}
