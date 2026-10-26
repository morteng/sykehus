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

/* ---------- areas: a ring from its settings (U3617) ----------
   A surface (a pool, a terrace, a bed) is kept as its settings, not as its outline: control points and how its corners go,
   so one setting can be changed later and the outline made again. ringOf({points, radius, smooth, step}) is that outline,
   open (the first point not repeated): radius rounds every corner with an arc of that radius (held to what the two sides
   leave), smooth runs a closed Catmull-Rom curve through the points instead; neither gives the points as they are. */
export function ringOf({ points, radius = 0, smooth = false, step = 0.5 }) {
  const P = open(points); if (P.length < 3) return P.map(p => [p[0], p[1]]);
  const n = P.length, out = [];
  if (smooth) {
    for (let i = 0; i < n; i++) {
      const p0 = P[(i - 1 + n) % n], p1 = P[i], p2 = P[(i + 1) % n], p3 = P[(i + 2) % n], k = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / step));
      for (let j = 0; j < k; j++) {
        const t = j / k, t2 = t * t, t3 = t2 * t, at = c => 0.5 * ((2 * p1[c]) + (-p0[c] + p2[c]) * t + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t2 + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * t3);
        out.push([at(0), at(1)]);
      }
    }
    return out;
  }
  if (!(radius > 0)) return P.map(p => [p[0], p[1]]);
  for (let i = 0; i < n; i++) {
    const a = P[(i - 1 + n) % n], b = P[i], c = P[(i + 1) % n];
    const la = Math.hypot(a[0] - b[0], a[1] - b[1]), lc = Math.hypot(c[0] - b[0], c[1] - b[1]);
    const u = [(a[0] - b[0]) / la, (a[1] - b[1]) / la], v = [(c[0] - b[0]) / lc, (c[1] - b[1]) / lc];
    const th = Math.acos(Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1])));   // the inside angle at b
    if (th < 1e-3 || Math.PI - th < 1e-3) { out.push([b[0], b[1]]); continue; }
    const r = Math.min(radius, Math.tan(th / 2) * Math.min(la, lc) / 2), d = r / Math.tan(th / 2);   // how far back along each side the arc starts
    const s = [b[0] + u[0] * d, b[1] + u[1] * d], e = [b[0] + v[0] * d, b[1] + v[1] * d], bis = [u[0] + v[0], u[1] + v[1]], bl = Math.hypot(...bis);
    const m = [b[0] + bis[0] / bl * r / Math.sin(th / 2), b[1] + bis[1] / bl * r / Math.sin(th / 2)];
    let a0 = Math.atan2(s[1] - m[1], s[0] - m[0]), a1 = Math.atan2(e[1] - m[1], e[0] - m[0]), sw = a1 - a0;
    while (sw > Math.PI) sw -= 2 * Math.PI; while (sw < -Math.PI) sw += 2 * Math.PI;
    const k = Math.max(2, Math.ceil(Math.abs(sw) * r / step));
    for (let j = 0; j <= k; j++) out.push([m[0] + r * Math.cos(a0 + sw * j / k), m[1] + r * Math.sin(a0 + sw * j / k)]);
  }
  return out;
}
const open = r => r.length > 1 && r[0][0] === r.at(-1)[0] && r[0][1] === r.at(-1)[1] ? r.slice(0, -1) : r;
/* the signed area (counter-clockwise positive), the shortest way from a point to a ring's edge, and the ring moved out
   d metres on every side (in for a negative d; each corner mitred, the mitre held to 3 × d) */
export const ringArea = r => r.reduce((a, p, i) => { const q = r[(i + 1) % r.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0) / 2;
export function segDist(p, a, b) {
  const d = [b[0] - a[0], b[1] - a[1]], L2 = d[0] * d[0] + d[1] * d[1] || 1, t = Math.max(0, Math.min(1, ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / L2));
  return Math.hypot(p[0] - a[0] - t * d[0], p[1] - a[1] - t * d[1]);
}
export const ringDist = (p, r) => r.reduce((m, a, i) => Math.min(m, segDist(p, a, r[(i + 1) % r.length])), Infinity);
export function offsetRing(ring, d) {
  const R = open(ring), s = ringArea(R) >= 0 ? 1 : -1, n = R.length;
  return R.map((b, i) => {
    const a = R[(i - 1 + n) % n], c = R[(i + 1) % n], nOf = (p, q) => { const L = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1; return [s * (q[1] - p[1]) / L, -s * (q[0] - p[0]) / L]; };
    const n0 = nOf(a, b), n1 = nOf(b, c), m = [n0[0] + n1[0], n0[1] + n1[1]], ml = Math.hypot(...m) || 1, k = Math.min(3, 1 / Math.max(1 / 3, (m[0] * n1[0] + m[1] * n1[1]) / ml));
    return [b[0] + m[0] / ml * d * k, b[1] + m[1] / ml * d * k];
  });
}
