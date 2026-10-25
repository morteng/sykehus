/* Paths and rings in the plane, in metres (an app's UTM): the even-odd point test, a centreline smoothed and sampled with its
   direction and arc length, and a path's outline. Pure: no three.js, no DOM. Moved from hagekart public/detect.js (U3530), where
   the street drawing (streets.js, streets3d.js) and the plan share them; hagekart's detect.js now takes them from here. */
export function pointInRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/* ---------- paths and roads: a centreline with a width ----------
   pts are EPSG:25833 metres. smoothPath runs a Catmull-Rom curve through them and returns samples about `step` m apart,
   each with arc length s and the unit direction (tx, ty); pathRing is the closed outline (left side out, right side back),
   for the map fill, hit tests and shade. The 3D strip uses the same samples, so map and model always agree. */
export function smoothPath(pts, step = 0.5) {
  if (pts.length < 2) return [];
  const P = [pts[0], ...pts, pts[pts.length - 1]], out = [];
  let s = 0;
  for (let i = 1; i < P.length - 2; i++) {
    const [p0, p1, p2, p3] = [P[i - 1], P[i], P[i + 1], P[i + 2]], len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]), n = Math.max(1, Math.ceil(len / step));
    for (let k = 0; k < n + (i === P.length - 3 ? 1 : 0); k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t, at = j => 0.5 * ((2 * p1[j]) + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3);
      out.push({ x: at(0), y: at(1) });
    }
  }
  for (let i = 0; i < out.length; i++) {
    const a = out[Math.max(0, i - 1)], b = out[Math.min(out.length - 1, i + 1)], dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
    // @ts-ignore inferred too narrowly (tuples, growing objects)
    out[i].tx = dx / l; out[i].ty = dy / l;
    if (i) s += Math.hypot(out[i].x - out[i - 1].x, out[i].y - out[i - 1].y);
    // @ts-ignore inferred too narrowly (growing objects)
    out[i].s = s;
  }
  return out;
}
export function pathRing(pts, width, step = 1) {
  // @ts-ignore inferred too narrowly (growing objects)
  const sm = smoothPath(pts, step), h = width / 2, L = sm.map(p => [p.x - p.ty * h, p.y + p.tx * h]), R = sm.map(p => [p.x + p.ty * h, p.y - p.tx * h]);
  if (sm.length < 2) return [];
  return [...L, ...R.reverse(), L[0]];
}
