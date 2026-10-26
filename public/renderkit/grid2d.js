/* renderkit grid2d: the raster geometry of a flat site in metres (from hagekart detect.js, U3655): a grid over a box, a ring
   filled into it, its cells grown, labelled and traced again as a ring with holes, the ring simplified and put onto known
   edges, and the cells a known road, path, fence or water covers. Pure: arrays and numbers in a frame in metres (UTM
   in hagekart, the site's own in sykehus), no DOM, no projection. paint.js (the magnetic brush) works on it. */

/* ---------- Grid helpers ---------- */
export function makeGrid(ringUtm, pad = 6) {
  const xs = ringUtm.map(p => p[0]), ys = ringUtm.map(p => p[1]);
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) + 2 * pad;
  const res = span <= 250 ? 0.5 : span <= 400 ? 1 : 2;   // keep grids under ~160k cells
  const x0 = Math.floor(Math.min(...xs) - pad), y0 = Math.floor(Math.min(...ys) - pad);
  const x1 = Math.ceil(Math.max(...xs) + pad), y1 = Math.ceil(Math.max(...ys) + pad);
  return { x0, y0, x1, y1, res, w: Math.round((x1 - x0) / res), h: Math.round((y1 - y0) / res) };
}
export const cellXY = (g, c, r) => [g.x0 + (c + 0.5) * g.res, g.y1 - (r + 0.5) * g.res];

/* Cells whose centre lies inside any ring (even-odd per ring). A scanline fill: each row finds where the ring's edges cross it
   and fills between the crossings, so the cost is rows x edges, not cells x edges (a stroke window on a long lawn stays cheap).
   Same answer as testing every cell centre with pointInRing. */
export function rasterize(g, rings) {
  const m = new Uint8Array(g.w * g.h);
  for (const ring of rings) {
    const n = ring.length; if (n < 3) continue;
    let ymin = Infinity, ymax = -Infinity;
    for (const p of ring) { if (p[1] < ymin) ymin = p[1]; if (p[1] > ymax) ymax = p[1]; }
    const r0 = Math.max(0, Math.floor((g.y1 - ymax) / g.res) - 1), r1 = Math.min(g.h - 1, Math.ceil((g.y1 - ymin) / g.res) + 1);
    for (let r = r0; r <= r1; r++) {
      const y = g.y1 - (r + 0.5) * g.res, xs = [];
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const yi = ring[i][1], yj = ring[j][1];
        if ((yi > y) !== (yj > y)) xs.push(((ring[j][0] - ring[i][0]) * (y - yi)) / (yj - yi) + ring[i][0]);
      }
      if (xs.length < 2) continue;
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const c0 = Math.max(0, Math.ceil((xs[k] - g.x0) / g.res - 0.5)), c1 = Math.min(g.w - 1, Math.ceil((xs[k + 1] - g.x0) / g.res - 0.5) - 1);
        for (let c = c0; c <= c1; c++) m[r * g.w + c] = 1;
      }
    }
  }
  return m;
}

export function dilate(g, m, steps) {
  let cur = m;
  for (let s = 0; s < steps; s++) {
    const nx = cur.slice();
    for (let r = 0; r < g.h; r++) for (let c = 0; c < g.w; c++) {
      if (cur[r * g.w + c]) continue;
      if ((c > 0 && cur[r * g.w + c - 1]) || (c < g.w - 1 && cur[r * g.w + c + 1]) ||
          (r > 0 && cur[(r - 1) * g.w + c]) || (r < g.h - 1 && cur[(r + 1) * g.w + c])) nx[r * g.w + c] = 1;
    }
    cur = nx;
  }
  return cur;
}


export function components(g, m) {
  const lab = new Int32Array(m.length), comps = [];
  for (let i = 0; i < m.length; i++) {
    if (!m[i] || lab[i]) continue;
    const id = comps.length + 1, cells = [i], stack = [i];
    lab[i] = id;
    while (stack.length) {
      const k = stack.pop(), r = (k / g.w) | 0, c = k % g.w;
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const rr = r + dr, cc = c + dc, j = rr * g.w + cc;
        if (rr < 0 || cc < 0 || rr >= g.h || cc >= g.w || !m[j] || lab[j]) continue;
        lab[j] = id; cells.push(j); stack.push(j);
      }
    }
    comps.push({ id, cells });
  }
  return { lab, comps };
}

/* Outline of one component along the cell sides, with its holes: { ring, holes } in UTM, closed, or null. A mask of n cells
   encloses n cells, so an outline traced again after each edit does not shrink by half a cell as traceOutline (which runs through
   the centres of the edge cells) does, and a neighbour's outline meets this one with no gap. Holes (ground of another class
   inside it) under minHoleM2 are dropped. */
export function cellOutline(g, lab, id, cells, minHoleM2 = 1) {
  const W = g.w + 1, out = new Map();
  const edge = (a, b) => { (out.get(a) || out.set(a, []).get(a)).push(b); };
  const inC = (r, c) => r >= 0 && c >= 0 && r < g.h && c < g.w && lab[r * g.w + c] === id;
  for (const k of cells) {
    const r = (k / g.w) | 0, c = k % g.w, tl = r * W + c, tr = tl + 1, bl = tl + W, br = bl + 1;
    if (!inC(r - 1, c)) edge(tl, tr);
    if (!inC(r, c + 1)) edge(tr, br);
    if (!inC(r + 1, c)) edge(br, bl);
    if (!inC(r, c - 1)) edge(bl, tl);
  }
  const xy = v => [g.x0 + (v % W) * g.res, g.y1 - Math.floor(v / W) * g.res];
  const loops = [];
  for (const [start] of out) {
    while (out.get(start)?.length) {
      const loop = [start]; let cur = start;
      for (let guard = 0; guard < 4e6; guard++) {
        const nx = out.get(cur)?.pop(); if (nx === undefined) break;
        if (nx === start) break;
        loop.push(nx); cur = nx;
      }
      if (loop.length < 4) continue;
      const pts = loop.map(xy); let a = 0;
      for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; }
      loops.push({ pts, a: a / 2 });
    }
  }
  if (!loops.length) return null;
  const big = loops.reduce((m, l) => (Math.abs(l.a) > Math.abs(m.a) ? l : m));
  const close = pts => { const r = simplify(pts, g.res * 0.6); if (r.length < 3) return null; r.push(r[0]); return r; };   // simplified open, as snapRing does
  const ring = close(big.pts); if (!ring) return null;
  const holes = loops.filter(l => l !== big && Math.sign(l.a) !== Math.sign(big.a) && Math.abs(l.a) >= minHoleM2).map(l => close(l.pts)).filter(Boolean);
  return { ring, holes };
}

export function simplify(pts, tol) {
  if (pts.length < 4) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop(); let best = 0, idx = -1;
    const [ax, ay] = pts[a], [bx, by] = pts[b], L = Math.hypot(bx - ax, by - ay) || 1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / L;
      if (d > best) { best = d; idx = i; }
    }
    if (best > tol) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/* ---------- Known geometry (known.js): roads, paths, fences, kerbs and water from maps and registers ----------
   rasterKnown marks the cells a known object covers: 1 road, path or traffic island, 2 fence or wall, 3 water.
   Detection keeps lawn, paving, beds, hedges and shrubs off them. A band narrower than a cell still gets a
   connected line of cells, so a fence splits the lawn on its two sides. */
export const KNOWN_CODE = { road: 1, path: 1, island: 1, fence: 2, hedge: 2, water: 3 };
export function rasterKnown(g, known) {
  const m = new Uint8Array(g.w * g.h);
  if (!known) return m;
  const thin = 0.71 * g.res;
  for (const b of known.bands || []) {
    const code = KNOWN_CODE[b.kind] || 1, L = Math.max(b.left, thin), R = Math.max(b.right, thin), reach = Math.max(L, R), cap = Math.min(L, R);
    for (let k = 0; k < b.pts.length - 1; k++) {
      const [ax, ay] = b.pts[k], [bx, by] = b.pts[k + 1], dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
      if (!len2) continue;
      const len = Math.sqrt(len2);
      const c0 = Math.max(0, Math.floor((Math.min(ax, bx) - reach - g.x0) / g.res)), c1 = Math.min(g.w - 1, Math.ceil((Math.max(ax, bx) + reach - g.x0) / g.res));
      const r0 = Math.max(0, Math.floor((g.y1 - Math.max(ay, by) - reach) / g.res)), r1 = Math.min(g.h - 1, Math.ceil((g.y1 - Math.min(ay, by) + reach) / g.res));
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
        const i = r * g.w + c; if (m[i]) continue;
        const [x, y] = cellXY(g, c, r), u = ((x - ax) * dx + (y - ay) * dy) / len2;
        let inside;
        if (u >= 0 && u <= 1) { const s = (dx * (y - ay) - dy * (x - ax)) / len; inside = s <= L && s >= -R; }   // s > 0: left of travel
        else { const qx = u < 0 ? ax : bx, qy = u < 0 ? ay : by; inside = Math.hypot(x - qx, y - qy) <= cap; }
        if (inside) m[i] = code;
      }
    }
  }
  for (const a of known.areas || []) {
    const inA = rasterize(g, [a.ring]), holes = a.holes?.length ? rasterize(g, a.holes) : null, code = KNOWN_CODE[a.kind] || 1;
    for (let i = 0; i < m.length; i++) if (inA[i] && !m[i] && !(holes && holes[i])) m[i] = code;
  }
  return m;
}

/* Ground the colour step could not see (shade, under tree crowns) and the bounded fill did not reach, where it lies
   between seen ground and a known edge (a building, road, path, fence or water). A cell is filled when the way from
   the nearest seen ground through it to that edge is at most GAP_M long; it takes the class of that ground. A gap
   that runs to no known edge stays open: there nothing says where the ground ends.
   cls: classes per cell (1 lawn, 2 paving, 3 hedge or low growth, 4 bed; 1, 2 and 4 may spread), open: cells that may
   be filled, stop: the known edges. Changes cls in place and returns how many cells it filled. */
export const GAP_M = 12;
const SPREAD = new Set([1, 2, 4]);
export function fillGaps(g, cls, open, stop, maxGapM = GAP_M) {
  const N = cls.length, INF = 0x3fffffff, ds = new Int32Array(N).fill(INF), de = new Int32Array(N).fill(INF), from = new Uint8Array(N);
  const bfs = (dist, isSource, carry) => {
    const q = [];
    for (let i = 0; i < N; i++) if (isSource(i)) { dist[i] = 0; q.push(i); if (carry) from[i] = cls[i]; }
    for (let h = 0; h < q.length; h++) {
      const k = q[h], r = (k / g.w) | 0, c = k % g.w;
      for (const j of [c > 0 ? k - 1 : -1, c < g.w - 1 ? k + 1 : -1, r > 0 ? k - g.w : -1, r < g.h - 1 ? k + g.w : -1]) {
        if (j < 0 || !open[j] || dist[j] !== INF) continue;
        dist[j] = dist[k] + 1; if (carry) from[j] = from[k]; q.push(j);
      }
    }
  };
  bfs(ds, i => !open[i] && SPREAD.has(cls[i]), true);
  bfs(de, i => !open[i] && !!stop[i], false);
  const most = Math.round(maxGapM / g.res) + 1;
  let n = 0;
  for (let i = 0; i < N; i++) if (open[i] && from[i] && ds[i] + de[i] <= most) { cls[i] = from[i]; n++; }
  return n;
}

/* An outline traced from the raster runs up to a cell or so beside a known edge. Points within `tol` metres of one
   are put onto it: the ring is sampled every metre, each sample within reach moves to the nearest point of the
   nearest edge, and the result is simplified again at 0.1 m. Points further away keep the trace. */
export function snapRing(ring, edges, tol) {
  if (!edges?.length || ring.length < 4) return ring;
  const r = snapRun(ring, edges, tol, false); if (!r) return ring;
  const s = simplify(r, 0.1);   // open, as traceOutline does: a closed chain has no base line to measure from
  s.push(s[0]);
  if (s.length < 4 || ringArea(s) < 0.5 * ringArea(ring)) return ring;   // a sliver along the edge would collapse onto it
  return s;
}
/* The same for an open chain (a stretch of outline between two points that stay where they are): the ends are kept. */
export function snapChain(pts, edges, tol) {
  if (!edges?.length || pts.length < 2) return pts;
  const r = snapRun(pts, edges, tol, true); if (!r) return pts;
  const s = simplify(r, 0.1);
  return s.length < 2 ? pts : s;
}
/* The sampled points of a run, each moved to the nearest known edge within tol; null when none moved. */
function snapRun(ring, edges, tol, open) {
  const xs = ring.map(p => p[0]), ys = ring.map(p => p[1]);
  const bx0 = Math.min(...xs) - tol, bx1 = Math.max(...xs) + tol, by0 = Math.min(...ys) - tol, by1 = Math.max(...ys) + tol;
  const segs = [];
  for (const e of edges) for (let i = 0; i < e.length - 1; i++) {
    const [ax, ay] = e[i], [cx, cy] = e[i + 1];
    if (Math.max(ax, cx) < bx0 || Math.min(ax, cx) > bx1 || Math.max(ay, cy) < by0 || Math.min(ay, cy) > by1) continue;
    segs.push([ax, ay, cx, cy]);
  }
  if (!segs.length) return null;
  const dense = [];
  for (let i = 0; i < ring.length - 1; i++) {
    const [ax, ay] = ring[i], [cx, cy] = ring[i + 1], n = Math.max(1, Math.ceil(Math.hypot(cx - ax, cy - ay)));
    for (let k = 0; k < n; k++) dense.push([ax + (cx - ax) * k / n, ay + (cy - ay) * k / n]);
  }
  if (open) dense.push(ring[ring.length - 1]);
  let moved = 0;
  const out = dense.map(([x, y]) => {
    let best = tol, q = null;
    for (const [ax, ay, cx, cy] of segs) {
      const dx = cx - ax, dy = cy - ay, l2 = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
      const px = ax + dx * t, py = ay + dy * t, d = Math.hypot(x - px, y - py);
      if (d < best) { best = d; q = [px, py]; }
    }
    if (q) moved++;
    return q || [x, y];
  });
  return moved ? out : null;
}
export const ringArea = r => { let a = 0; for (let i = 0; i < r.length - 1; i++) a += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]; return Math.abs(a) / 2; };
