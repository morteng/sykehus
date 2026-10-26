/* A building's own frame (U3831): the axis of its outline and a rectangle set along it, inside it.
   ringFrame(ring)  the minimum-area rectangle of an outline: u along its long side, v across, centre, full length and width
                    (ported from hagekart's roof.js minRect: «u along the ridge, v across it»; hagekart is frozen)
   fitInRing(ring, want)  (want.within: a set of rings, blocks side by side, that is the room; ring then only gives the axis)  a rectangle { c, length, width } turned to the outline's axis and kept inside it: the nearest
                    centre to want.c where it fits, else a smaller one. Pure: no three.js, no DOM. */
import { pointInRing } from "./paths2d.js";

export function convexHull(pts) {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], hi = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo.at(-2), lo.at(-1), q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.slice().reverse()) { while (hi.length >= 2 && cross(hi.at(-2), hi.at(-1), q) <= 0) hi.pop(); hi.push(q); }
  return lo.slice(0, -1).concat(hi.slice(0, -1));
}

/* { c: [x, y], u: [ux, uy] (unit, along the long side), v (u turned 90° left), length, width, angle (deg, 0–180, from east) } */
export function ringFrame(ring) {
  const same = ring.length > 1 && ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1];
  const hull = convexHull(same ? ring.slice(0, -1) : ring);
  let best = null;
  for (let i = 0; i < hull.length; i++) {
    const [ax, ay] = hull[i], [bx, by] = hull[(i + 1) % hull.length], th = Math.atan2(by - ay, bx - ax), c = Math.cos(th), s = Math.sin(th);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const [x, y] of hull) { const u = x * c + y * s, v = -x * s + y * c; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
    const area = (u1 - u0) * (v1 - v0);
    if (!best || area < best.area - 1e-9) { const um = (u0 + u1) / 2, vm = (v0 + v1) / 2; best = { area, th, c: [um * c - vm * s, um * s + vm * c], a: u1 - u0, b: v1 - v0 }; }
  }
  let { th, a, b } = best; if (b > a) { th += Math.PI / 2; [a, b] = [b, a]; }
  th = ((th % Math.PI) + Math.PI) % Math.PI;
  return { c: best.c, u: [Math.cos(th), Math.sin(th)], v: [-Math.sin(th), Math.cos(th)], length: a, width: b, angle: th * 180 / Math.PI };
}

/* the rectangle's edge, a point every half metre, all inside the ring (with margin: the rectangle made that much larger) */
function inside(ring, c, u, v, L, W, margin) {
  const ok = Array.isArray(ring[0]?.[0]) ? q => ring.some(r => pointInRing(q, r) || [[.02, 0], [-.02, 0], [0, .02], [0, -.02]].some(d => pointInRing([q[0] + d[0], q[1] + d[1]], r))) : q => pointInRing(q, ring);   // a set of rings (blocks side by side) is one roof
  const hl = L / 2 + margin, hw = W / 2 + margin, nu = Math.max(1, Math.ceil(2 * hl / 0.5)), nv = Math.max(1, Math.ceil(2 * hw / 0.5));
  const at = (s, t) => [c[0] + u[0] * s + v[0] * t, c[1] + u[1] * s + v[1] * t];
  for (let i = 0; i <= nu; i++) { const s = -hl + 2 * hl * i / nu; if (!ok(at(s, -hw)) || !ok(at(s, hw))) return false; }
  for (let j = 0; j <= nv; j++) { const t = -hw + 2 * hw * j / nv; if (!ok(at(-hl, t)) || !ok(at(hl, t))) return false; }
  return true;
}

/* want { c?: [x, y] (default the outline's middle), length, width, along?: false keeps want.u, shrink?: true, margin?: 0.1 }
   → { c, u, v, length, width, angle, shifted_m (centre moved from want.c), shrunk (length or width made smaller), fits } */
export function fitInRing(ring, want) {
  const rings = want.within, F = ringFrame(ring), margin = want.margin ?? 0.1, shrink = want.shrink !== false;
  const u = F.u, v = F.v, c0 = want.c || F.c;
  let L = want.length, W = want.width, shrunk = false;
  if (shrink) { if (L > F.length - 2 * margin) { L = Math.max(1, F.length - 2 * margin); shrunk = true; } if (W > F.width - 2 * margin) { W = Math.max(1, F.width - 2 * margin); shrunk = true; } }
  const cs = [c0, F.c], n = 24;
  for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) cs.push([F.c[0] + u[0] * (i / n - 0.5) * F.length + v[0] * (j / n - 0.5) * F.width, F.c[1] + u[1] * (i / n - 0.5) * F.length + v[1] * (j / n - 0.5) * F.width]);
  cs.sort((p, q) => Math.hypot(p[0] - c0[0], p[1] - c0[1]) - Math.hypot(q[0] - c0[0], q[1] - c0[1]));
  for (let k = 0; k < 25; k++) {
    const f = shrink ? Math.pow(0.95, k) : (k ? 0 : 1); if (!f) break;
    const l = L * f, w = W * f;
    const hit = cs.find(c => inside(rings || ring, c, u, v, l, w, margin));
    if (hit) return { c: hit, u, v, length: l, width: w, angle: F.angle, shifted_m: Math.hypot(hit[0] - c0[0], hit[1] - c0[1]), shrunk: shrunk || k > 0, fits: true };
  }
  return { c: c0, u, v, length: L, width: W, angle: F.angle, shifted_m: 0, shrunk, fits: false };
}
