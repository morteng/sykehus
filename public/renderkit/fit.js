/* How a site's new buildings sit, in numbers beside the picture (sykehus U3557; the toolkit audit: numbers beside a
   picture beat a picture alone, CADCodeVerify). One copy for every app that builds on a site (U3559): sykehus, Fab.
   No three.js, no DOM: the page and the server alike.

   The site, as look.js takes it too:
     terrain   { x0, y1, res, w, h, z: [kote per cell, row by row from the north] }   (optional: the ground is then 0)
     buildings [{ id, ring: [[east, north], …], base, top, blocks?: [{ p: ring, top }], wing?, own? }]
     wings     [{ id, name }]          a building's group by name (optional)
     added     [{ id, kind: "volume", name, from, to, width, base_kote, top_kote, on? }]   on: the wing whose roof it is on
     lot       { ring }                (optional)
   fitOf(site) returns, for each added volume: { id, name, stands_on, ground_kote: [low, high], base_kote, top_kote,
     overlaps: [{ with, m2 }], nearest: [{ to, m }] (the two closest), on_lot? }. stands_on is Norwegian, for the agent
     to pass on: «på bakken», «på bakken i skråning: …», «på taket til X, kote …», «på ingenting: … (svever)», «under bakken: …». */

export const inRing = ([x, y], r) => { let o = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [a, b] = r[i], [e, f] = r[j]; if ((b > y) !== (f > y) && x < (e - a) * (y - b) / (f - b) + a) o = !o; } return o; };

/* the ground under a point, from the site's terrain grid (as the viewer reads it) */
export function groundAt(site, [x, y]) {
  const T = site.terrain; if (!T) return 0;
  const c = Math.floor((x - T.x0) / T.res), r = Math.floor((T.y1 - y) / T.res);
  const z = c >= 0 && r >= 0 && c < T.w && r < T.h ? T.z[r * T.w + c] : null;
  return z ?? Math.min(...T.z.filter(v => v != null));
}

/* how each new building sits (U3557, the toolkit audit: numbers beside the picture beat a picture alone): which wings
   and buildings its footprint overlaps and by how many m², the nearest one it does not touch and the gap to it, the
   ground under it (lowest and highest), and what its foot stands on: the ground, a roof, nothing (it floats), or under
   the ground (it is buried) */
const rectOf = a => { const d = [a.to[0] - a.from[0], a.to[1] - a.from[1]], L = Math.hypot(...d), n = [-d[1] / L * a.width / 2, d[0] / L * a.width / 2];
  return [[a.from[0] - n[0], a.from[1] - n[1]], [a.to[0] - n[0], a.to[1] - n[1]], [a.to[0] + n[0], a.to[1] + n[1]], [a.from[0] + n[0], a.from[1] + n[1]]]; };
const ringArea = r => Math.abs(r.reduce((s, p, i) => { const q = r[(i + 1) % r.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
/* a ring clipped to a convex one (Sutherland–Hodgman); the convex one counter-clockwise */
function clip(subject, convex) {
  let out = subject.slice(); const ccw = convex.reduce((s, p, i) => { const q = convex[(i + 1) % convex.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) > 0 ? convex : convex.slice().reverse();
  for (let i = 0; i < ccw.length && out.length; i++) {
    const a = ccw[i], b = ccw[(i + 1) % ccw.length], inside = p => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= 0;
    const cut = (p, q) => { const d1 = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]), d2 = (b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0]), t = d1 / (d1 - d2); return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]; };
    const inp = out; out = [];
    for (let k = 0; k < inp.length; k++) { const p = inp[k], q = inp[(k + 1) % inp.length];
      if (inside(q)) { if (!inside(p)) out.push(cut(p, q)); out.push(q); } else if (inside(p)) out.push(cut(p, q)); }
  }
  return out;
}
const segDist = (p, a, b) => { const d = [b[0] - a[0], b[1] - a[1]], t = Math.max(0, Math.min(1, ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / (d[0] ** 2 + d[1] ** 2 || 1))); return Math.hypot(p[0] - a[0] - d[0] * t, p[1] - a[1] - d[1] * t); };
const ringGap = (r, s) => Math.min(...r.flatMap((p, i) => s.map((q, j) => Math.min(segDist(p, q, s[(j + 1) % s.length]), segDist(q, r[i], r[(i + 1) % r.length])))));
export function fitOf(site) {
  const open = r => r.length > 1 && r[0][0] === r.at(-1)[0] && r[0][1] === r.at(-1)[1] ? r.slice(0, -1) : r;
  const things = [...site.buildings.reduce((m, b) => { const k = b.wing || b.id, w = (site.wings || []).find(x => x.id === b.wing);
    const name = w ? w.name : b.own ? `bygning ${b.id} på tomta` : `nabobygg ${b.id}`; if (!m.has(k)) m.set(k, { name, rings: [], top: -Infinity }); const t = m.get(k); t.rings.push(open(b.ring)); t.top = Math.max(t.top, b.top ?? b.base); return m; }, new Map()).values()];
  const vols = (site.added || []).filter(a => a.kind === "volume");
  return vols.map(a => {
    const r = rectOf(a), others = [...things, ...vols.filter(v => v !== a).map(v => ({ name: v.name, rings: [rectOf(v)], top: v.top_kote }))];
    const overlaps = [], gaps = [];
    for (const t of others) {
      if (a.on && t.name === (site.wings || []).find(w => w.id === a.on)?.name) continue;   // the roof it stands on
      const m2 = t.rings.reduce((s, ring) => { const c = clip(ring, r); return s + (c.length > 2 ? ringArea(c) : 0); }, 0);
      if (m2 > 0.5) overlaps.push({ with: t.name, m2: Math.round(m2) }); else gaps.push({ to: t.name, m: Math.round(Math.min(...t.rings.map(ring => ringGap(r, ring))) * 10) / 10 });
    }
    gaps.sort((x, y) => x.m - y.m);
    const g = [...r, [(a.from[0] + a.to[0]) / 2, (a.from[1] + a.to[1]) / 2]].map(p => groundAt(site, p)), lo = Math.min(...g), hi = Math.max(...g);
    const base = a.base_kote, stands = a.on ? `på taket til ${(site.wings || []).find(w => w.id === a.on)?.name || a.on}, kote ${base}`
      : base > hi + 0.5 ? `på ingenting: foten er ${Math.round((base - hi) * 10) / 10} m over bakken (svever)`
      : base < lo - 0.5 ? `under bakken: foten er ${Math.round((lo - base) * 10) / 10} m under det laveste terrenget`
      : hi - base > 1.5 ? `på bakken i skråning: terrenget stiger ${Math.round((hi - base) * 10) / 10} m inn over foten på den høye siden` : "på bakken";
    const lot = site.lot?.ring ? r.filter(p => inRing(p, site.lot.ring)).length : null;
    return { id: a.id, name: a.name, stands_on: stands, ground_kote: [Math.round(lo * 10) / 10, Math.round(hi * 10) / 10], base_kote: base, top_kote: a.top_kote,
      overlaps, nearest: gaps.slice(0, 2), ...(lot != null ? { on_lot: lot === 4 ? "helt på tomta" : lot === 0 ? "utenfor tomta" : `${lot} av 4 hjørner på tomta` } : {}) };
  });
}
