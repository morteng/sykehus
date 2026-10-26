/* renderkit paint (from hagekart paint.js, U3655): the paint brush: paint lawn (paving, beds) onto the plan, or rub it out, as a stroke with a radius.
   Pure geometry in UTM metres; the UI (brush.js) feeds it strokes and reads rings back.
   What makes it more than a circle on the map:
     - the brush never paints on what is already known: outside the lot, in a building, on a road, path, fence or water;
     - it is magnetic: ground left between the stroke and such an edge, up to SNAP_M, is painted too, and the outline is put
       onto the edge, so the lawn meets the road and the wall without anyone aiming for the last half metre;
     - painting lawn takes the ground from other surfaces under it, and joins the lawn it touches; the pieces it changes
       become the owner's own (src "user"), so a new analysis keeps them. */
import { cellOutline, components, dilate, fillGaps, rasterKnown, rasterize, simplify, snapChain, snapRing } from "./grid2d.js";
import { pointInRing } from "./paths2d.js";

export const SNAP_M = 0.8;                 // the pull toward a known edge
export const SURFACES = ["lawn", "paving", "bed", "driveway"];   // what a stroke can replace
export const SIZES = [0.5, 8];             // brush radius range, m
export const STROKE_RES = 0.25;

const bboxOfPts = pts => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const [x, y] of pts) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } return [x0, y0, x1, y1]; };

/* A grid over a box, `res` metres a cell (same layout as detect.js makeGrid). */
export function gridOver([x0, y0, x1, y1], res = STROKE_RES, pad = 0) {
  const X0 = Math.floor(x0 - pad), Y0 = Math.floor(y0 - pad), X1 = Math.ceil(x1 + pad), Y1 = Math.ceil(y1 + pad);
  return { x0: X0, y0: Y0, x1: X1, y1: Y1, res, w: Math.max(1, Math.round((X1 - X0) / res)), h: Math.max(1, Math.round((Y1 - Y0) / res)) };
}
/* Finer than half a metre where the lot is small; never more than about 1.2 million cells. */
export const resFor = (box, pad = 0) => Math.max(STROKE_RES, Math.ceil(((Math.max(box[2] - box[0], box[3] - box[1]) + 2 * pad) / 1100) / STROKE_RES) * STROKE_RES);

/* Cells the brush cannot paint: outside the lot, inside a building, on known geometry (roads, paths, fences, water). */
export function blockedFor(g, { lot, buildings = [], known = null }) {
  const out = rasterize(g, [lot]), b = new Uint8Array(out.length);
  for (let i = 0; i < b.length; i++) b[i] = out[i] ? 0 : 1;
  if (buildings.length) { const m = rasterize(g, buildings); for (let i = 0; i < b.length; i++) if (m[i]) b[i] = 1; }
  if (known) { const m = rasterKnown(g, known); for (let i = 0; i < b.length; i++) if (m[i]) b[i] = 1; }
  return b;
}

/* Cells within r of the line a-b, set in `mask` (a capsule); a single point is a disc. */
export function stamp(g, mask, a, b, r) {
  const x0 = Math.min(a[0], b[0]) - r, x1 = Math.max(a[0], b[0]) + r, y0 = Math.min(a[1], b[1]) - r, y1 = Math.max(a[1], b[1]) + r;
  const c0 = Math.max(0, Math.floor((x0 - g.x0) / g.res)), c1 = Math.min(g.w - 1, Math.ceil((x1 - g.x0) / g.res));
  const r0 = Math.max(0, Math.floor((g.y1 - y1) / g.res)), r1 = Math.min(g.h - 1, Math.ceil((g.y1 - y0) / g.res));
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy, r2 = r * r;
  for (let rr = r0; rr <= r1; rr++) for (let c = c0; c <= c1; c++) {
    const x = g.x0 + (c + 0.5) * g.res, y = g.y1 - (rr + 0.5) * g.res, t = l2 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2)) : 0, ex = x - (a[0] + t * dx), ey = y - (a[1] + t * dy);
    if (ex * ex + ey * ey <= r2) mask[rr * g.w + c] = 1;
  }
}
export function stampStroke(g, pts, r, mask = new Uint8Array(g.w * g.h)) {
  if (pts.length === 1) stamp(g, mask, pts[0], pts[0], r);
  for (let i = 1; i < pts.length; i++) stamp(g, mask, pts[i - 1], pts[i], r);
  return mask;
}

/* What the brush paints: the stroke without the blocked cells, plus the ground left between it and a blocked edge (≤ SNAP_M).
   Returns a new mask. */
export function magnet(g, mask, blocked, snapM = SNAP_M) {
  const cls = new Uint8Array(mask.length), open = new Uint8Array(mask.length);
  for (let i = 0; i < cls.length; i++) { cls[i] = mask[i] && !blocked[i] ? 1 : 0; open[i] = !cls[i] && !blocked[i] ? 1 : 0; }
  if (snapM > 0) fillGaps(g, cls, open, blocked, snapM);
  return cls;
}

/* Outlines (UTM, closed) of the pieces of a mask, put onto known edges within `tol`. Pieces under minM2 are dropped. */
export function ringsOf(g, mask, edges = [], { tol = 0.6, minM2 = 0.3, minHoleM2 = 1 } = {}) {
  const { lab, comps } = components(g, mask), out = [];
  for (const c of comps) {
    if (c.cells.length * g.res * g.res < minM2) continue;
    const o = cellOutline(g, lab, c.id, c.cells, minHoleM2);
    const snap = r => (edges.length ? snapRing(r, edges, tol) : r);
    if (o) out.push({ ring: snap(o.ring), holes: o.holes.map(snap), cells: c.cells.length });
  }
  return out;
}

/* The preview of a stroke in progress: a window around it, so a long lot costs no more than the stroke does. */
export function windowOf(g, box, padM) {
  const c0 = Math.max(0, Math.floor((box[0] - padM - g.x0) / g.res)), c1 = Math.min(g.w, Math.ceil((box[2] + padM - g.x0) / g.res));
  const r0 = Math.max(0, Math.floor((g.y1 - (box[3] + padM)) / g.res)), r1 = Math.min(g.h, Math.ceil((g.y1 - (box[1] - padM)) / g.res));
  const w = Math.max(1, c1 - c0), h = Math.max(1, r1 - r0);
  return { c0, r0, g: { x0: g.x0 + c0 * g.res, y1: g.y1 - r0 * g.res, x1: g.x0 + (c0 + w) * g.res, y0: g.y1 - (r0 + h) * g.res, res: g.res, w, h } };
}
export const cut = (g, src, win) => { const o = new Uint8Array(win.g.w * win.g.h); for (let r = 0; r < win.g.h; r++) { const s = (win.r0 + r) * g.w + win.c0; o.set(src.subarray(s, s + win.g.w), r * win.g.w); } return o; };

/* The ghost of a stroke: the rings that would be painted. `box` is the stroke's bounding box in UTM. */
export function ghost({ g, mask, blocked, box, edges = [], snapM = SNAP_M }) {
  const win = windowOf(g, box, snapM + 2 * g.res + 0.5), m = cut(g, mask, win), b = cut(g, blocked, win);
  const painted = magnet(win.g, m, b, snapM);
  let n = 0; for (let i = 0; i < painted.length; i++) n += painted[i];
  const parts = ringsOf(win.g, painted, edges);
  return { rings: parts.map(r => r.ring), polys: parts.map(r => ({ ring: r.ring, holes: r.holes })), m2: n * g.res * g.res };
}

const count = m => { let n = 0; for (let i = 0; i < m.length; i++) n += m[i]; return n; };


/* ---------- local edits ----------
   A stroke changes ground near itself. The plan is edited in a window around the stroke: the part of each touched outline
   outside the window is kept as it is (same vertices), the part inside is traced again from the raster of the window,
   and the two are stitched where the outline crosses the window's frame. A stroke on a large lawn then costs by the
   stroke, not by the lawn. When the stitch is not clean (the ends do not pair up), commit() falls back to the whole area. */
const WINDOW_PAD_M = 3;
const inBox = (p, F) => p[0] >= F[0] && p[0] <= F[2] && p[1] >= F[1] && p[1] <= F[3];
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const shoelace = r => { let a = 0; for (let i = 0; i < r.length - 1; i++) a += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]; return Math.abs(a) / 2; };
/* The part of segment a-b inside box F, as [t0, t1] along it (Liang-Barsky), or null. */
function clipSeg(a, b, F) {
  let t0 = 0, t1 = 1; const dx = b[0] - a[0], dy = b[1] - a[1];
  for (const [p, q] of [[-dx, a[0] - F[0]], [dx, F[2] - a[0]], [-dy, a[1] - F[1]], [dy, F[3] - a[1]]]) {
    if (p === 0) { if (q < 0) return null; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return null; if (r > t0) t0 = r; } else { if (r < t0) return null; if (r < t1) t1 = r; }
  }
  return t0 <= t1 ? [t0, t1] : null;
}
/* A closed ring cut by the frame F: { inside } when it lies in F, { untouched } when it never enters F, else the runs of
   it outside F as open chains whose ends lie on the frame. */
export function splitRing(ring, F) {
  const pts = ring.slice(0, -1), n = pts.length, k0 = pts.findIndex(p => !inBox(p, F));
  if (k0 < 0) return { inside: true, chains: [] };
  const P = [...pts.slice(k0), ...pts.slice(0, k0)], chains = [];
  let cur = [P[0]];
  for (let i = 0; i < n; i++) {
    const a = P[i], b = P[(i + 1) % n], c = clipSeg(a, b, F);
    if (!c) { cur?.push(b); continue; }
    if (cur) { cur.push(lerp(a, b, c[0])); chains.push(cur); cur = null; }
    if (c[1] < 1) cur = [lerp(a, b, c[1]), b];
  }
  if (!chains.length) return { untouched: true, chains: [] };
  if (cur) chains[0] = [...cur, ...chains[0].slice(1)];
  return { chains };
}
/* The boundary of a mask along cell sides, except where it runs along the grid's frame: closed loops, and open chains
   that begin and end on the frame (the region goes on outside the window). */
function traceChains(g, mask) {
  const W = g.w + 1, out = new Map(), indeg = new Map();
  const edge = (a, b) => { (out.get(a) || out.set(a, []).get(a)).push(b); indeg.set(b, (indeg.get(b) || 0) + 1); };
  const has = (r, c) => r >= 0 && c >= 0 && r < g.h && c < g.w && mask[r * g.w + c];
  for (let r = 0; r < g.h; r++) for (let c = 0; c < g.w; c++) {
    if (!mask[r * g.w + c]) continue;
    const tl = r * W + c, tr = tl + 1, bl = tl + W, br = bl + 1;
    if (r > 0 && !has(r - 1, c)) edge(tl, tr);
    if (c < g.w - 1 && !has(r, c + 1)) edge(tr, br);
    if (r < g.h - 1 && !has(r + 1, c)) edge(br, bl);
    if (c > 0 && !has(r, c - 1)) edge(bl, tl);
  }
  const xy = v => [g.x0 + (v % W) * g.res, g.y1 - Math.floor(v / W) * g.res], chains = [], loops = [];
  for (const [start, nx] of [...out]) for (let k = nx.length - (indeg.get(start) || 0); k > 0; k--) {
    const ch = [start]; let cur = start;
    for (let guard = 0; guard < 4e6 && out.get(cur)?.length; guard++) { cur = out.get(cur).pop(); ch.push(cur); }
    chains.push(ch.map(xy));
  }
  for (const [start] of out) while (out.get(start)?.length) {
    const lp = [start]; let cur = start;
    for (let guard = 0; guard < 4e6; guard++) { const nx = out.get(cur)?.pop(); if (nx === undefined || nx === start) break; lp.push(nx); cur = nx; }
    if (lp.length >= 4) loops.push(lp.map(xy));
  }
  return { chains, loops };
}
/* The rings of a surface (outline first, then holes; UTM, closed) with its window part replaced by the trace of `mNew`.
   Returns [{ ring, holes }] or null when the stitch is not clean. */
function patchRings(g, F, rings, mNew, edges, minM2, minHoleM2 = 1) {
  const outside = [], kept = [];
  for (const r of rings) { const s = splitRing(r, F); if (s.untouched) kept.push(r); else if (!s.inside) outside.push(...s.chains); }
  const { chains, loops } = traceChains(g, mNew);
  if (outside.length !== chains.length) return null;
  const tidy = c => snapChain(simplify(c, g.res * 0.6), edges, 0.6), all = [...outside.map(p => ({ p })), ...chains.map(p => ({ p: tidy(p) }))];
  const ends = all.flatMap((c, i) => [{ id: i * 2, pt: c.p[0], o: i < outside.length }, { id: i * 2 + 1, pt: c.p[c.p.length - 1], o: i < outside.length }]);
  const mate = new Array(ends.length).fill(-1), cand = [];
  for (const a of ends) if (a.o) for (const b of ends) if (!b.o) cand.push([Math.hypot(a.pt[0] - b.pt[0], a.pt[1] - b.pt[1]), a.id, b.id]);
  cand.sort((x, y) => x[0] - y[0]);
  for (const [d, a, b] of cand) if (d <= 2.5 * g.res && mate[a] < 0 && mate[b] < 0) { mate[a] = b; mate[b] = a; }
  if (mate.includes(-1)) return null;
  const used = new Set(), made = [];
  for (let i = 0; i < all.length; i++) {
    if (used.has(i)) continue;
    const pts = []; let ci = i, e = 0;
    for (let guard = 0; ; guard++) {
      if (used.has(ci) || guard > all.length) return null;
      used.add(ci); const p = all[ci].p; pts.push(...(e === 0 ? p : [...p].reverse()));
      const m = mate[ci * 2 + (e === 0 ? 1 : 0)]; ci = m >> 1; e = m & 1;
      if (ci === i && e === 0) break;
    }
    const onF = q => q[0] === F[0] || q[0] === F[2] || q[1] === F[1] || q[1] === F[3], N = pts.length;
    const ring = pts.filter((q, k) => {   // a seam point on the frame, on the line between its neighbours, adds nothing
      const a = pts[(k + N - 1) % N], b = pts[(k + 1) % N];
      if (q[0] === a[0] && q[1] === a[1]) return false;
      return !(onF(q) && Math.abs((q[0] - a[0]) * (b[1] - a[1]) - (q[1] - a[1]) * (b[0] - a[0])) < 1e-9);
    });
    ring.push(ring[0]); made.push({ ring, fresh: true });
  }
  const closeL = l => { const o = simplify(l, g.res * 0.6); if (o.length < 3) return null; o.push(o[0]); return snapRing(o, edges, 0.6); };
  for (const l of loops) { const r = closeL(l); if (r) made.push({ ring: r, fresh: true }); }
  for (const r of kept) made.push({ ring: r, fresh: false });
  const area = made.map(m => shoelace(m.ring)), depth = made.map((m, i) => made.filter((o, j) => j !== i && area[j] > area[i] && pointInRing(m.ring[0], o.ring)).length);
  const polys = [];
  made.forEach((m, i) => { if (depth[i] % 2 === 0 && !(m.fresh && area[i] < minM2)) polys.push({ ring: m.ring, holes: [], a: area[i], at: i }); });
  made.forEach((m, i) => {
    if (depth[i] % 2 === 0 || (m.fresh && area[i] < minHoleM2)) return;
    const owner = polys.filter(p => depth[p.at] === depth[i] - 1 && pointInRing(m.ring[0], p.ring)).sort((x, y) => x.a - y.a)[0];
    owner?.holes.push(m.ring);
  });
  return polys.sort((x, y) => y.a - x.a).map(({ ring, holes }) => ({ ring, holes }));
}
/* commit() on a window around the stroke; null means "use the whole-area path". */
function commitLocal({ rings, mode, kind, areas, lot, buildings, known, minM2, edges, pb }) {
  const box = [pb[0] - WINDOW_PAD_M, pb[1] - WINDOW_PAD_M, pb[2] + WINDOW_PAD_M, pb[3] + WINDOW_PAD_M], res = resFor(box, 0), g = gridOver(box, res, 0);
  const F = [g.x0, g.y1 - g.h * res, g.x0 + g.w * res, g.y1], cell = res * res, P = rasterize(g, rings), remove = [], add = [];
  if (mode === "add") { const b = blockedFor(g, { lot, buildings, known }); for (let i = 0; i < P.length; i++) if (P[i] && b[i]) P[i] = 0; }
  const rast = a => { const m = rasterize(g, [a.ring]); if (a.holes?.length) { const h = rasterize(g, a.holes); for (let i = 0; i < m.length; i++) if (h[i]) m[i] = 0; } return m; };
  const meets = (A, B) => { for (let i = 0; i < A.length; i++) if (A[i] && B[i]) return true; return false; };
  const ringsOfA = a => [a.ring, ...(a.holes || [])];
  const put = (polys, k, id, src = "user") => polys.forEach((p, i) => add.push({ id: i === 0 ? id : undefined, kind: k, ring: p.ring, holes: p.holes, src }));
  let m2 = 0;
  if (mode === "add") {
    const grown = dilate(g, P, 1), same = areas.filter(a => a.kind === kind && meets(rast(a), grown));
    if (same.length > 1) return null;
    for (const a of areas) {
      if (a.kind === kind) continue;
      const R = rast(a); if (!meets(R, P)) continue;
      const rest = R.slice(); for (let i = 0; i < rest.length; i++) if (P[i]) rest[i] = 0;
      const polys = patchRings(g, F, ringsOfA(a), rest, edges, 1); if (!polys) return null;
      remove.push(a.id); polys.forEach(p => add.push({ id: undefined, kind: a.kind, ring: p.ring, holes: p.holes, src: "user" }));
    }
    if (same.length) {
      const a = same[0], R = rast(a), U = P.slice(); for (let i = 0; i < U.length; i++) if (R[i]) U[i] = 1;
      const polys = patchRings(g, F, ringsOfA(a), U, edges, 0.3); if (!polys) return null;
      remove.push(a.id); put(polys, kind, a.id); m2 = (count(U) - count(R)) * cell;
    } else {
      const parts = ringsOf(g, P, edges, { minM2: 0.3 }).sort((a, b) => b.cells - a.cells);
      parts.forEach(r => add.push({ id: undefined, kind, ring: r.ring, holes: r.holes, src: "user" })); m2 = count(P) * cell;
    }
  } else {
    for (const a of areas) {
      const R = rast(a); if (!meets(R, P)) continue;
      const rest = R.slice(); for (let i = 0; i < rest.length; i++) if (P[i]) rest[i] = 0;
      const polys = patchRings(g, F, ringsOfA(a), rest, edges, minM2); if (!polys) return null;
      remove.push(a.id); m2 -= (count(R) - count(rest)) * cell; put(polys, kind, a.id);
    }
  }
  return { remove: [...new Set(remove)], add, m2 };
}

/* Put a stroke on the plan.
   rings: the ghost (UTM). mode "add" paints `kind` and takes the ground from the other surfaces under it; "erase" rubs `kind` out.
   areas: the plan's areas as { id, kind, st, ring, holes (UTM) }; only those of the same st (planned or exists) are touched.
   A surface is an outline with holes: a bed painted inside a lawn makes a hole in the lawn, an erase in the middle of a lawn a hole too.
   kinds: the surface kinds a stroke replaces (default SURFACES; an app with more surfaces gives its own list, U3664).
   Returns { remove: ids, add: [{ id?, kind, ring, holes, src }], m2: net change of `kind` }. */
export function commit({ rings, mode = "add", kind = "lawn", st = "exists", areas, lot, buildings = [], known = null, minM2 = 1, local = true, kinds = SURFACES }) {
  const none = { remove: [], add: [], m2: 0 };
  const pts = rings.flat(); if (pts.length < 3) return none;
  const pb = bboxOfPts(pts), edges = known?.edges || [];
  const near = a => { const b = bboxOfPts(a.ring); return !(b[2] < pb[0] - 1 || b[0] > pb[2] + 1 || b[3] < pb[1] - 1 || b[1] > pb[3] + 1); };
  const touched = areas.filter(a => a.st === st && near(a) && (mode === "erase" ? a.kind === kind : kinds.includes(a.kind)));
  if (mode === "erase" && !touched.length) return none;
  if (local) { const l = commitLocal({ rings, mode, kind, areas: touched, lot, buildings, known, minM2, edges, pb }); if (l) return l; }
  const box = bboxOfPts([...pts, ...touched.flatMap(a => a.ring)]), res = resFor(box, 2), g = gridOver(box, res, 2);
  const P = rasterize(g, rings);
  if (mode === "add") { const b = blockedFor(g, { lot, buildings, known }); for (let i = 0; i < P.length; i++) if (P[i] && b[i]) P[i] = 0; }
  const cell = res * res, remove = [], add = [];
  const rast = a => { const m = rasterize(g, [a.ring]); if (a.holes?.length) { const h = rasterize(g, a.holes); for (let i = 0; i < m.length; i++) if (h[i]) m[i] = 0; } return m; };
  const meets = (A, B) => { for (let i = 0; i < A.length; i++) if (A[i] && B[i]) return true; return false; };
  const pieces = (m, k, id, min = minM2) => ringsOf(g, m, edges, { minM2: min }).map((r, i) => ({ id: i === 0 ? id : undefined, kind: k, ring: r.ring, holes: r.holes, src: "user" }));
  let m2 = 0;
  if (mode === "add") {
    const grown = dilate(g, P, 1), U = P.slice(); let was = 0, keep;
    for (const a of touched) {
      const R = rast(a);
      if (a.kind === kind) { if (!meets(R, grown)) continue; remove.push(a.id); keep ??= a.id; was += count(R); for (let i = 0; i < U.length; i++) if (R[i]) U[i] = 1; }
      else if (meets(R, P)) {
        const rest = R.slice(); for (let i = 0; i < rest.length; i++) if (P[i]) rest[i] = 0;
        remove.push(a.id); add.push(...pieces(rest, a.kind, undefined, 1));
      }
    }
    ringsOf(g, U, edges, { minM2: 0.3 }).sort((a, b) => b.cells - a.cells).forEach((r, i) => add.push({ id: i === 0 ? keep : undefined, kind, ring: r.ring, holes: r.holes, src: "user" }));
    m2 = (count(U) - was) * cell;
  } else {
    for (const a of touched) {
      const R = rast(a); if (!meets(R, P)) continue;
      const rest = R.slice(); for (let i = 0; i < rest.length; i++) if (P[i]) rest[i] = 0;
      remove.push(a.id); m2 -= (count(R) - count(rest)) * cell;
      add.push(...pieces(rest, kind, a.id));
    }
  }
  return { remove: [...new Set(remove)], add, m2 };
}
