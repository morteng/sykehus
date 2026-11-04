/* U3870: shadow and view toward the neighbours, in numbers, for a proposal: pure, no network.
   shadowView(site, { radius_m }) reads site.added (new volumes: from, to, width, base_kote, top_kote), site.demolished and the
   neighbours in site.buildings (not own). For each neighbour near a new volume and for 21 March, 21 June and 21 December:
   - sun: the hours of direct sun at the worst-hit point of its facades (ground-floor window height), before and after. A point
     counts only while its wall faces the sun. The ray to the sun is tried against the walls of every standing building and every
     new volume (the sun from sunPosition, Oslo clock time). «Before» is the site with the demolished taken away and nothing added.
   - view: from the same point, the nearest distance to the new volume, the width of the sky it takes (degrees of bearing) and the
     angle up to its top. Every number is «beregnet» from the model, a 1 m ground-floor point, no trees, no roof overhang. */
import { sunPosition, osloTime } from "./public/renderkit/sun.js";

const RAD = Math.PI / 180, SITE = { lat: 59.74, lon: 10.2 }, YEAR = 2026, WINDOW_M = 1.5, STEP_MIN = 30;
const DAYS = [{ month: 3, day: 21, name: "21. mars" }, { month: 6, day: 21, name: "21. juni" }, { month: 12, day: 21, name: "21. desember" }];
const r1 = x => Math.round(x * 10) / 10, num = x => typeof x === "number" && Number.isFinite(x);

const rectRing = a => { const d = [a.to[0] - a.from[0], a.to[1] - a.from[1]], L = Math.hypot(...d) || 1, n = [-d[1] / L * a.width / 2, d[0] / L * a.width / 2];
  return [[a.from[0] + n[0], a.from[1] + n[1]], [a.to[0] + n[0], a.to[1] + n[1]], [a.to[0] - n[0], a.to[1] - n[1]], [a.from[0] - n[0], a.from[1] - n[1]]]; };
const open = ring => ring.length > 1 && ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1] ? ring.slice(0, -1) : ring;
const area2 = R => R.reduce((s, p, i) => { const q = R[(i + 1) % R.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0);
const centroid = R => [R.reduce((s, p) => s + p[0], 0) / R.length, R.reduce((s, p) => s + p[1], 0) / R.length];

/* a prism: the ring's walls between base and top */
const prism = (id, ring, base, top) => ({ id, ring: open(ring), base, top });

/* does the ray from P (x, y, z) toward the sun (azimuth from north, elevation, degrees) hit a wall of one of the prisms? */
function shaded(P, sun, prisms, skip) {
  const ce = Math.cos(sun.elevation * RAD), dx = Math.sin(sun.azimuth * RAD) * ce, dy = Math.cos(sun.azimuth * RAD) * ce, dz = Math.sin(sun.elevation * RAD);
  for (const b of prisms) {
    if (b.id === skip) continue;
    for (let i = 0; i < b.ring.length; i++) {
      const a = b.ring[i], c = b.ring[(i + 1) % b.ring.length], ex = c[0] - a[0], ey = c[1] - a[1], den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-12) continue;
      const wx = a[0] - P[0], wy = a[1] - P[1], t = (wx * ey - wy * ex) / den, s = (wx * dy - wy * dx) / den;
      if (t > 1e-6 && s >= 0 && s <= 1) { const z = P[2] + t * dz / 1; if (z >= b.base && z <= b.top) return true; }
    }
  }
  return false;
}

/* the points on a neighbour's facades: the middle of each wall, pushed 0.3 m out, with the wall's outward normal */
function facadePoints(b) {
  const R = open(b.ring), ccw = area2(R) > 0, out = [];
  R.forEach((p, i) => {
    const q = R[(i + 1) % R.length], ex = q[0] - p[0], ey = q[1] - p[1], L = Math.hypot(ex, ey); if (L < 2) return;
    const n = ccw ? [ey / L, -ex / L] : [-ey / L, ex / L];
    out.push({ at: [(p[0] + q[0]) / 2 + n[0] * 0.3, (p[1] + q[1]) / 2 + n[1] * 0.3, b.base + WINDOW_M], n });
  });
  return out;
}

const times = ({ month, day }) => {
  const out = [];
  for (let m = 0; m < 1440; m += STEP_MIN) { const d = osloTime(YEAR, month - 1, day, m + STEP_MIN / 2), s = sunPosition(d, SITE.lat, SITE.lon); if (s.elevation > 0) out.push(s); }
  return out;
};

const facing = (n, s) => n[0] * Math.sin(s.azimuth * RAD) + n[1] * Math.cos(s.azimuth * RAD) > 0.05;

/* the view of a volume from a point: nearest distance, the bearing span it takes, the angle up to its top */
function viewOf(P, ring, top) {
  const R = open(ring), bear = R.map(p => Math.atan2(p[0] - P[0], p[1] - P[1]) / RAD);
  let span = 0;                                       // the smallest arc that holds every corner bearing
  const sorted = bear.map(b => (b + 360) % 360).sort((a, b) => a - b);
  let gap = 0; sorted.forEach((b, i) => { gap = Math.max(gap, (i ? b - sorted[i - 1] : b + 360 - sorted.at(-1))); }); span = 360 - gap;
  let best = Infinity;
  R.forEach((p, i) => { const q = R[(i + 1) % R.length], dx = q[0] - p[0], dy = q[1] - p[1], L2 = dx * dx + dy * dy, t = L2 ? Math.max(0, Math.min(1, ((P[0] - p[0]) * dx + (P[1] - p[1]) * dy) / L2)) : 0; best = Math.min(best, Math.hypot(p[0] + t * dx - P[0], p[1] + t * dy - P[1])); });
  return { distance_m: r1(best), span_deg: Math.round(span), up_deg: r1(Math.atan2(top - P[2], best) / RAD) };
}

export function shadowView(site, { radius_m = 40 } = {}) {
  const gone = new Set((site.demolished || []).map(d => d.id));
  const added = (site.added || []).filter(a => a.kind === "volume" && Array.isArray(a.from) && Array.isArray(a.to) && num(a.width) && num(a.base_kote) && num(a.top_kote));
  if (!added.length) return { neighbours: [], counted: 0, note: "Ingen nye volumer i prosjektet: det er ingen skygge eller utsikt å regne på." };
  const standing = site.buildings.filter(b => !gone.has(b.id) && num(b.base) && num(b.top)).map(b => prism(b.id, b.ring, b.base, b.top));
  const news = added.map(a => ({ a, ring: rectRing(a), prism: prism("ny:" + (a.id ?? a.name), rectRing(a), a.base_kote, a.top_kote) }));
  const after = [...standing, ...news.map(n => n.prism)], sunsBy = DAYS.map(d => ({ ...d, suns: times(d) }));
  const out = [];
  for (const b of site.buildings) {
    if (b.own || gone.has(b.id) || !num(b.base)) continue;
    const c = centroid(open(b.ring)), near = news.filter(n => Math.min(...n.ring.map(p => Math.hypot(p[0] - c[0], p[1] - c[1]))) <= radius_m + 10);
    if (!near.length) continue;
    const pts = facadePoints(b); if (!pts.length) continue;
    let nearest = null;
    for (const p of pts) for (const n of near) { const v = viewOf(p.at, n.ring, n.a.top_kote); if (!nearest || v.distance_m < nearest.distance_m) nearest = { ...v, volume: n.a.name, from_wall: p }; }
    if (nearest.distance_m > radius_m) continue;
    const days = sunsBy.map(d => {
      let worst = null;
      for (const p of pts) {
        let before = 0, aft = 0;
        for (const s of d.suns) if (facing(p.n, s)) { if (!shaded(p.at, s, standing, b.id)) before++; if (!shaded(p.at, s, after, b.id)) aft++; }
        const h = x => x * STEP_MIN / 60, lost = h(before - aft);
        if (!worst || lost > worst.lost) worst = { lost, before: h(before), after: h(aft) };
      }
      return { day: d.name, sun_hours_before: r1(worst.before), sun_hours_after: r1(worst.after), hours_lost: r1(worst.lost) };
    });
    const { from_wall, ...view } = nearest;
    out.push({ id: b.id, type: b.type, levels: b.levels ?? null, ...view, sun: days });
  }
  out.sort((x, y) => x.distance_m - y.distance_m);
  const worst = out.flatMap(n => n.sun.map(s => ({ n, s }))).sort((a, b) => b.s.hours_lost - a.s.hours_lost)[0];
  return { neighbours: out, counted: out.length, radius_m,
    say: !out.length ? `Ingen nabobygg innen ${radius_m} m av de nye volumene.` : `${out.length} nabobygg innen ${radius_m} m. ` + (worst && worst.s.hours_lost > 0 ? `Mest tapt sol: ${worst.s.hours_lost} timer ${worst.s.day} (nabobygg ${worst.n.id}, fra ${worst.s.sun_hours_before} til ${worst.s.sun_hours_after} timer).` : "Ingen nabo mister direkte sol i punktene som er målt."),
    note: "Beregnet fra modellen: direkte sol ved et vindu i første etasje (1,5 m over fot) på den verste fasaden, timer med halvtimes steg, uten trær og takutstikk. Utsikt: nærmeste avstand, hvor mange grader av horisonten volumet tar og vinkelen opp til toppen, fra den fasaden som står nærmest. Ikke en solstudie etter plan- og bygningsloven." };
}
