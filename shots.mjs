/* A few good shots of a version that also explain it (U3527, Morten 2026-10-25 17:26Z «help him put togeather a few
   really good shots that are also informative»): from what the after changes, 4–6 saved views, each with its caption,
   in the order one would show them:
     1. the whole of it from the air (south-west, as a drawing's perspective is), names on;
     2. each new building (the two largest) as a person on the street sees it: from the nearest named street or place
        (OpenStreetMap names, gater.mjs places), the eye 1,7 m over the ground (the viewer's eye camera);
     3. a torn-down wing before and after, from the same place in the air (era før / etter: the page paints the before
        in place for the first);
     4. the plan, names on.
   Each view's state is the page's (saved.js VIEW_SPEC): the camera as the viewer's orbit (x, y, kote of the centre;
   yaw, pitch, dist), cam "eye" for the person's eye, and series, so a new series replaces the last. */
import { bearing, dirWord } from "./public/renderkit/dirs.js";   // one copy (DRY 5)
import { pointInRing as inRing } from "./public/renderkit/paths2d.js";   // one copy (DRY 1)
import { groundAt } from "./public/renderkit/fit.js";

const r1 = v => Math.round(v * 10) / 10, r3 = v => Math.round(v * 1000) / 1000;
const m1 = v => String(r1(v)).replace(".", ",");
const mid = ring => ring.reduce((a, p) => [a[0] + p[0] / ring.length, a[1] + p[1] / ring.length], [0, 0]);
/* the viewer's yaw for a camera standing toward deg (0 north, 90 east) of the centre */
const yawFrom = deg => r3(Math.PI - deg * Math.PI / 180);
const degTo = bearing;   // renderkit dirs.js: deg of the direction from c to p
const EYE_MIN = 30, EYE_MAX = 260;

/* the nearest point of a named street or place to c, between EYE_MIN and EYE_MAX metres off, roads first, from where
   nothing standing is in the way (avoid: the standing buildings' rings; the line on the ground to c crosses none) */
export function nearestPlace(places, c, avoid = []) {
  const all = [];
  for (const p of places || []) for (const q of p.pts || []) {
    const d = Math.hypot(q[0] - c[0], q[1] - c[1]);
    if (d < EYE_MIN || d > EYE_MAX || avoid.some(r => inRing(q, r))) continue;
    all.push({ name: p.name, at: q, d, score: d + (p.road ? 0 : EYE_MAX) });   // a street where there is one in reach; a path or a place else
  }
  return all.sort((x, y) => x.score - y.score).find(x => clear(x.at, c, avoid)) || null;
}
/* the named streets and places around c, for Anton to know them by name (about_site): each one's nearest point, how
   far and which way from c, nearest first */
export function streetsAround(places, c) {
  return (places || []).map(p => {
    const q = p.pts.reduce((b, q) => Math.hypot(q[0] - c[0], q[1] - c[1]) < Math.hypot(b[0] - c[0], b[1] - c[1]) ? q : b, p.pts[0]);
    return { name: p.name, road: !!p.road, nearest_m: Math.round(Math.hypot(q[0] - c[0], q[1] - c[1])), side: dirWord(degTo(c, q)) };
  }).sort((a, b) => a.nearest_m - b.nearest_m);
}

/* the line on the ground from a toward b goes through none of the rings, to within near metres of b (what is looked at
   is not in the way of itself) */
export function clear(a, b, rings, near = 12) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.ceil(L / 2);
  for (let i = 1; i < n; i++) {
    const t = i / n; if (L * (1 - t) < near) break;
    const q = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; if (rings.some(r => inRing(q, r))) return false;
  }
  return true;
}

/* after: applyEdits(...).site; before: the before's site; places: [{ name, pts: [[east, north]], road }] */
export function planShots(after, before, places = []) {
  const added = (after.added || []).filter(a => a.kind === "volume" && a.from && a.to);
  const gone = new Set((after.demolished || []).filter(d => d.own).map(d => d.id));
  const goneWings = (before.wings || []).map(w => ({ w, bs: before.buildings.filter(b => b.wing === w.id) })).filter(x => x.bs.length && x.bs.every(b => gone.has(b.id)));
  const standingB = before.buildings.filter(b => !gone.has(b.id)), standing = standingB.map(b => b.ring);
  /* what changed, as points, for the overview and the plan to take in */
  const pts = [...added.flatMap(a => [a.from, a.to]), ...goneWings.flatMap(x => x.bs.flatMap(b => b.ring))];
  const all = pts.length ? pts : before.lot.ring, c = [(Math.min(...all.map(p => p[0])) + Math.max(...all.map(p => p[0]))) / 2, (Math.min(...all.map(p => p[1])) + Math.max(...all.map(p => p[1]))) / 2];
  const span = Math.max(60, ...all.map(p => Math.hypot(p[0] - c[0], p[1] - c[1]) * 2));
  const kc = groundAt(after, c) ?? 15;
  const what = [...added.map(a => `${a.name} (nytt)`), ...goneWings.map(x => `${x.w.name} (revet)`)];
  const shots = [];
  shots.push({ name: "Oversikt", caption: what.length ? `Hele forslaget fra luften, fra sørvest: ${what.join(", ")}.` : "Tomta fra luften, fra sørvest. Forslaget endrer ingen bygg ennå.",
    state: { mode: "3d", x: r1(c[0]), y: r1(c[1]), kote: r1(kc + 6), yaw: yawFrom(225), pitch: r3(0.85), dist: r1(Math.min(900, Math.max(180, span * 2.1))), names: true } });
  for (const a of added.slice().sort((p, q) => (q.footprint_m2 || 0) - (p.footprint_m2 || 0)).slice(0, goneWings.length ? 1 : 2)) {
    const ac = [(a.from[0] + a.to[0]) / 2, (a.from[1] + a.to[1]) / 2], H = (a.top_kote ?? a.base_kote + 6) - a.base_kote;
    const look = r1(a.base_kote + Math.min(H * 0.4, 8)), near = nearestPlace(places, ac, standing);
    const free = [180, 225, 135, 270, 90, 315, 45, 0].map(g => [ac[0] + Math.sin(g * Math.PI / 180) * 70, ac[1] + Math.cos(g * Math.PI / 180) * 70]).find(q => !standing.some(r => inRing(q, r)) && clear(q, ac, standing));
    const at = near ? near.at : free || [ac[0], ac[1] - 70], d = Math.max(EYE_MIN, Math.hypot(at[0] - ac[0], at[1] - ac[1])), deg = degTo(ac, at);
    const facts = [a.storeys ? `${a.storeys} etasjer` : `${m1(H)} m høyt`, a.footprint_m2 ? `${Math.round(a.footprint_m2)} m² grunnflate` : null, a.use || null].filter(Boolean).join(", ");
    shots.push({ name: near ? `${a.name} fra ${near.name}` : `${a.name} fra ${dirWord(deg)}`,
      caption: `${a.name}${facts ? `, ${facts}` : ""}, slik en som står ${near ? `i ${near.name}` : `${Math.round(d)} m ${dirWord(deg)} for det`} ser det: øyehøyde 1,7 m, ${Math.round(d)} m unna, mot ${dirWord(deg + 180)}.`,
      state: { mode: "3d", cam: "eye", x: r1(ac[0]), y: r1(ac[1]), kote: look, yaw: yawFrom(deg), pitch: r3(0.1), dist: r1(Math.min(EYE_MAX, d)) } });
  }
  const g = goneWings.sort((p, q) => q.bs.reduce((t, b) => t + (b.area_m2 || 0), 0) - p.bs.reduce((t, b) => t + (b.area_m2 || 0), 0))[0];
  if (g) {
    const ring = g.bs.flatMap(b => b.ring), wc = mid(ring), top = Math.max(...g.bs.map(b => b.top ?? b.base + 10)), size = Math.max(40, ...ring.map(p => Math.hypot(p[0] - wc[0], p[1] - wc[1]) * 2));
    /* from where the taller ones standing do not hide it: the first side, south first, whose first 90 m are free of them */
    const tall = standingB.filter(b => (b.top ?? 0) > top - 4).map(b => b.ring), own = new Set(g.bs.map(b => b.ring));
    const side = [200, 160, 240, 120, 280, 80, 320, 40, 0].find(deg => clear([wc[0] + Math.sin(deg * Math.PI / 180) * 90, wc[1] + Math.cos(deg * Math.PI / 180) * 90], wc, tall.filter(r => !own.has(r)), size / 2)) ?? 200;
    const cam = { mode: "3d", x: r1(wc[0]), y: r1(wc[1]), kote: r1((Math.min(...g.bs.map(b => b.base)) + top) / 2), yaw: yawFrom(side), pitch: r3(0.55), dist: r1(Math.min(600, Math.max(120, size * 2.6))), names: true };
    shots.push({ name: `Før: ${g.w.name}`, caption: `Før: ${g.w.name} slik den står i dag${g.w.built ? ` (bygget ${g.w.built})` : ""}.`, state: { ...cam, era: "før" } });
    shots.push({ name: `Etter: ${g.w.name} revet`, caption: `Etter: ${g.w.name} er revet, sett fra samme sted.${goneWings.length > 1 ? ` Også revet: ${goneWings.filter(x => x !== g).map(x => x.w.name).join(", ")}.` : ""}`, state: { ...cam, era: "etter" } });
  }
  shots.push({ name: "Plan", caption: what.length ? `Planen, nord opp: ${what.join(", ")}.` : "Planen, nord opp.",
    state: { mode: "plan", x: r1(c[0]), y: r1(c[1]), dist: r1(Math.min(900, Math.max(120, span * 1.6))), names: true } });
  return shots.slice(0, 6).map((s, i) => ({ ...s, name: `${i + 1} ${s.name}`.slice(0, 60), state: { ...s.state, caption: s.caption.slice(0, 240), series: true } }));
}
