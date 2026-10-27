/* A wing's roof as numbers, and which roof a footprint stands on (Anton's reports 2026-10-26/27: a volume «on» Sentralblokka
   came out at kote 69.9 here and 73.2 there, stuck out past the edge, and the roof could not be read as numbers).
   The roof is site.buildings[].blocks (tools/massing.py): flat rectangles on the building's own grid, each {p: 4 corners in
   site metres, top: kote}. Sentralblokka has three levels (66.41, 69.91, 73.16), not one: the building's `top` (70.87) is
   not any of them. A building without blocks is one flat piece: its ring at its top.
   THE RULE for a foot: the roof level that holds the most of the footprint (m² on the roof, sampled), a tie the higher.
   Never the highest level under the middle (which changed with the middle). The levels under it are all named. */
import { inRing, groundAt, overlapArea } from "./renderkit/fit.js";
import { ringDist, ringArea } from "./renderkit/paths2d.js";
import { measureOf } from "./renderkit/measure.js";   // «Mål»'s own maths: distance, height difference, run (one copy)

const r2 = v => Math.round(v * 100) / 100 + 0, r1 = v => Math.round(v * 10) / 10 + 0;   // + 0: no -0
const kk = v => Math.round(v * 100) / 100;
const cache = new WeakMap();   // a building's roof pieces, once

/* the pieces of a wing's roof: [{ p, top, th }] with th the grid angle of the building they belong to (radians) */
function piecesOf(site, wing) {
  const out = [];
  for (const b of site.buildings.filter(b => b.wing === wing)) {
    let c = cache.get(b); if (!c) {
      const bl = b.blocks?.length ? b.blocks.filter(k => k.top != null) : (b.top != null ? [{ p: b.ring.slice(0, b.ring.length - (b.ring.length > 1 && b.ring[0][0] === b.ring.at(-1)[0] && b.ring[0][1] === b.ring.at(-1)[1] ? 1 : 0)), top: b.top }] : []);
      let th = b.grid_deg != null ? b.grid_deg * Math.PI / 180 : null;
      if (th == null) { const q = bl[0]?.p; th = q && q.length > 1 ? Math.atan2(q[1][1] - q[0][1], q[1][0] - q[0][0]) : 0; }
      c = { id: b.id, th, pieces: bl.map(k => ({ p: k.p, top: kk(k.top), th })) }; cache.set(b, c);
    }
    out.push(c);
  }
  return out;
}
/* T5: a wing's roof pieces as they are ({ p: 4 corners or the ring, top, building }): one copy for the drawings (drawing.js) */
export const roofPieces = (site, wing) => piecesOf(site, wing).flatMap(c => c.pieces.map(k => ({ p: k.p, top: k.top, building: c.id })));
const bearing = (dx, dy) => (((Math.atan2(dx, dy) * 180 / Math.PI) % 180) + 180) % 180;   // of a line, 0..180 from north clockwise

/* axis-aligned rectangles in the grid frame (u along th, v across), same kote, edge-sharing: merged until none can be */
function mergeRects(rects) {
  const R = rects.map(x => ({ ...x })), eq = (a, b) => Math.abs(a - b) < 0.02;
  for (let again = true; again;) {
    again = false;
    for (let i = 0; i < R.length && !again; i++) for (let j = i + 1; j < R.length && !again; j++) {
      const a = R[i], b = R[j]; if (a.top !== b.top) continue;
      if (eq(a.v0, b.v0) && eq(a.v1, b.v1) && (eq(a.u1, b.u0) || eq(b.u1, a.u0))) { a.u0 = Math.min(a.u0, b.u0); a.u1 = Math.max(a.u1, b.u1); R.splice(j, 1); again = true; }
      else if (eq(a.u0, b.u0) && eq(a.u1, b.u1) && (eq(a.v1, b.v0) || eq(b.v1, a.v0))) { a.v0 = Math.min(a.v0, b.v0); a.v1 = Math.max(a.v1, b.v1); R.splice(j, 1); again = true; }
    }
  }
  return R;
}
/* the outer ring of the union of grid rectangles (exact: compressed grid, boundary edges chained, collinear points dropped) */
function ringsOfRects(rects) {
  const us = [...new Set(rects.flatMap(r => [kk(r.u0), kk(r.u1)]))].sort((a, b) => a - b), vs = [...new Set(rects.flatMap(r => [kk(r.v0), kk(r.v1)]))].sort((a, b) => a - b);
  const fill = (i, j) => { if (i < 0 || j < 0 || i >= us.length - 1 || j >= vs.length - 1) return false; const cu = (us[i] + us[i + 1]) / 2, cv = (vs[j] + vs[j + 1]) / 2; return rects.some(r => cu > r.u0 && cu < r.u1 && cv > r.v0 && cv < r.v1); };
  const next = new Map(), key = (i, j) => `${i},${j}`;
  for (let i = 0; i < us.length - 1; i++) for (let j = 0; j < vs.length - 1; j++) if (fill(i, j)) {   // counter-clockwise in (u, v)
    if (!fill(i, j - 1)) next.set(key(i, j), [i + 1, j]);
    if (!fill(i + 1, j)) next.set(key(i + 1, j), [i + 1, j + 1]);
    if (!fill(i, j + 1)) next.set(key(i + 1, j + 1), [i, j + 1]);
    if (!fill(i - 1, j)) next.set(key(i, j + 1), [i, j]);
  }
  const rings = [];
  while (next.size) {
    const [k0, n0] = next.entries().next().value; const ring = []; let k = k0, n = n0; next.delete(k);
    ring.push(k.split(",").map(Number));
    while (key(...n) !== k0) { ring.push(n); const nn = next.get(key(...n)); if (!nn) break; next.delete(key(...n)); n = nn; }
    rings.push(ring);
  }
  const pts = rings.map(g => g.map(([i, j]) => [us[i], vs[j]])).map(g => g.filter((p, i) => { const a = g[(i + g.length - 1) % g.length], b = g[(i + 1) % g.length]; return Math.abs((p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0])) > 1e-6; }));
  return pts;   // every ring, the filled side on the left: an outer ring counter-clockwise, a hole clockwise
}
const outerRing = rects => ringsOfRects(rects).sort((a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a)))[0] || [];

/* the edge of one roof level as rings (A: Anton's wish 2026-10-27, «høyt glassgjerde rundt takkanten»: one merged outline gave one line at one kote).
   rects: the building's pieces in its grid frame (u0, u1, v0, v1, top); rot / toXY: grid -> site. Each ring: its points in site metres,
   each edge's length, the way it faces (bearing of its outward normal, 0..360) and whether it stands against a higher level (a wall: no fall there). */
const sideOf = (dx, dy) => Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "øst" : "vest") : (dy > 0 ? "nord" : "sør");
export { sideOf };
function levelRings(rects, top, rot, toXY) {
  const rs = mergeRects(rects.filter(r => r.top === top)), higher = rects.filter(r => r.top > top);
  return ringsOfRects(rs).filter(g => g.length >= 3 && Math.abs(ringArea(g)) > 0.5).map(g => {
    const n = g.length, edges = g.map((a, i) => { const b = g[(i + 1) % n], d = [b[0] - a[0], b[1] - a[1]], L = Math.hypot(d[0], d[1]) || 1, out = [d[1] / L, -d[0] / L], m = [(a[0] + b[0]) / 2 + out[0] * 0.3, (a[1] + b[1]) / 2 + out[1] * 0.3], o = rot(out);
      return { length_m: r2(L), facing_deg: r1((((Math.atan2(o[0], o[1]) * 180 / Math.PI) % 360) + 360) % 360), wall: higher.some(h => m[0] > h.u0 && m[0] < h.u1 && m[1] > h.v0 && m[1] < h.v1) }; });
    return { ring: g.map(toXY), area_m2: Math.abs(ringArea(g)), hole: ringArea(g) < 0, edges };
  });
}

/* a building's pieces in its own grid frame: rects (u0, u1, v0, v1, top), and the way from the grid to site metres */
function gridFrame(c) {
  const th = c.th, cs = Math.cos(th), sn = Math.sin(th), toU = ([x, y]) => [x * cs + y * sn, -x * sn + y * cs], toXY = ([u, v]) => [r2(u * cs - v * sn), r2(u * sn + v * cs)];
  const rects = c.pieces.map(k => { const q = k.p.map(toU), u = q.map(p => p[0]), v = q.map(p => p[1]); return { u0: Math.min(...u), u1: Math.max(...u), v0: Math.min(...v), v1: Math.max(...v), top: k.top }; });
  return { th, cs, sn, toXY, rects, rot: ([u, v]) => [u * cs - v * sn, u * sn + v * cs] };
}
/* the rings of one level's edge on a wing (every building of it that has the level): [{ building, ring, hole, area_m2, edges: [{ length_m, facing_deg, wall }] }]; edge i runs ring[i] -> ring[i+1] */
export function levelRingsOf(site, wing, kote) {
  return piecesOf(site, wing).filter(c => c.pieces.length).flatMap(c => { const g = gridFrame(c), top = c.pieces.map(k => k.top).find(t => Math.abs(t - kote) < 0.06);
    return top == null ? [] : levelRings(g.rects, top, g.rot, g.toXY).map(r => ({ building: c.id, kote: top, ...r })); });
}
export const roofKotes = (site, wing) => [...new Set(piecesOf(site, wing).flatMap(c => c.pieces.map(k => k.top)))].sort((a, b) => b - a);

/* about_wing's roof: per building of the wing (the largest first; `roof_other` when a wing has more than one), as numbers.
   grid_bearing_deg: the way the grid's long axis lies, degrees from north (0..180). Every length in m, corners [east, north]. */
export function roofOf(site, wing) {
  const outs = piecesOf(site, wing).filter(c => c.pieces.length).map(c => {
    const { th, cs, sn, toXY, rects, rot } = gridFrame(c);
    const box = rs => { const u0 = Math.min(...rs.map(r => r.u0)), u1 = Math.max(...rs.map(r => r.u1)), v0 = Math.min(...rs.map(r => r.v0)), v1 = Math.max(...rs.map(r => r.v1)), du = u1 - u0, dv = v1 - v0;
      return { corners: [[u0, v0], [u1, v0], [u1, v1], [u0, v1]].map(toXY), length_m: r2(Math.max(du, dv)), width_m: r2(Math.min(du, dv)), axis_bearing_deg: r1(du >= dv ? bearing(cs, sn) : bearing(-sn, cs)), area: du * dv }; };
    const merged = mergeRects(rects), area = rs => rs.reduce((s, r) => s + (r.u1 - r.u0) * (r.v1 - r.v0), 0);
    const levels = [...new Set(rects.map(r => r.top))].sort((a, b) => b - a).map(top => { const rs = rects.filter(r => r.top === top), b = box(rs), a = area(rs);
      return { kote: top, area_m2: Math.round(a), bounding_rect: { corners: b.corners, length_m: b.length_m, width_m: b.width_m, axis_bearing_deg: b.axis_bearing_deg }, fills_rect: r2(a / b.area) }; });
    const all = box(rects);
    const edges = levels.map(l => { const rg = levelRings(rects, l.kote, rot, toXY), big = rg.filter(g => g.area_m2 >= 5).sort((a, b) => b.area_m2 - a.area_m2);
      return { kote: l.kote, rings: big.map(g => ({ ring: g.ring, ...(g.hole ? { hole: true } : {}), lengths_m: g.edges.map(e => r1(e.length_m)), facing_deg: g.edges.map(e => Math.round(e.facing_deg)), ...(g.edges.some(e => e.wall) ? { wall_edges: g.edges.flatMap((e, i) => e.wall ? [i] : []) } : {}) })), ...(rg.length > big.length ? { rings_under_5m2: rg.length - big.length } : {}) }; });
    return { building: c.id, grid_deg: r1(th * 180 / Math.PI), grid_bearing_deg: r1(bearing(cs, sn)), outline: outerRing(merged).map(toXY), outline_note: "the roof's outer edge, counter-clockwise, [east, north] in site metres",
      bounding_rect: { corners: all.corners, length_m: all.length_m, width_m: all.width_m, axis_bearing_deg: all.axis_bearing_deg }, levels,
      edges, edges_note: "edges = each level's own edge as rings; edge i runs ring[i] to ring[i+1], facing_deg[i] is where it looks out, wall_edges stand against a higher level. A railing round one: try_change edge_rail",
      blocks: merged.filter(r => (r.u1 - r.u0) * (r.v1 - r.v0) >= 10).sort((a, b) => b.top - a.top || (b.u1 - b.u0) * (b.v1 - b.v0) - (a.u1 - a.u0) * (a.v1 - a.v0)).map(r => { const b = box([r]); return { kote: r.top, corners: b.corners, length_m: b.length_m, width_m: b.width_m, axis_bearing_deg: b.axis_bearing_deg }; }),
      blocks_under_10m2: merged.filter(r => (r.u1 - r.u0) * (r.v1 - r.v0) < 10).length, area_m2: Math.round(area(rects)) };
  }).sort((a, b) => b.area_m2 - a.area_m2);
  if (!outs.length) return null;
  return { ...outs[0], ...(outs.length > 1 ? { roof_other: outs.slice(1) } : {}),
    levels_say: `The roof has ${outs[0].levels.length} level${outs[0].levels.length === 1 ? "" : "s"}: kote ${outs[0].levels.map(l => `${l.kote} (${l.area_m2} m²)`).join(", ")}. A volume on it stands on the level that holds most of its footprint.` };
}

/* a construction's footprint as the shape it has, not its bounding rectangle (Anton 2026-10-27: a railing laid round the roof edge was a «44 m overhang»,
   because its box, 97 × 28 m and turned as it was put, was tested against the roof). bim.foot is what bim.mjs made of the mesh: { cell, x0, y0, q, p }, the cells
   (cell m wide) the mesh covers, as whole units of q m from (x0, y0) in the construction's own frame. bimXY: its own frame -> site metres, the same as bimPlace's. */
export function bimXY(e) {
  const { min, max } = e.bim.box, bc = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2], c = [(e.from[0] + e.to[0]) / 2, (e.from[1] + e.to[1]) / 2];
  const a = Math.atan2(e.to[1] - e.from[1], e.to[0] - e.from[0]), k = Math.cos(a), s = Math.sin(a);
  return ([x, y]) => { const u = x - bc[0], v = y - bc[1]; return [c[0] + u * k - v * s, c[1] + u * s + v * k]; };
}
export function footSet(e) {
  const f = e?.bim?.foot; if (!f || !Array.isArray(f.p) || !f.p.length || !e.from || !e.to) return null;
  const at = bimXY(e), pts = []; for (let i = 0; i + 1 < f.p.length; i += 2) pts.push(at([f.x0 + f.p[i] * f.q, f.y0 + f.p[i + 1] * f.q]));
  return { cell: f.cell, pts };
}
/* the nearest point of a set of rings to p: [point, distance] */
function nearestOn(p, rings) {
  let best = [null, Infinity];
  for (const r of rings) for (let i = 0; i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length], d = [b[0] - a[0], b[1] - a[1]], L2 = d[0] * d[0] + d[1] * d[1], t = L2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / L2)) : 0, q = [a[0] + d[0] * t, a[1] + d[1] * t], dist = Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (dist < best[1]) best = [q, dist];
  }
  return best;
}
/* where a footprint stands on a wing's roof: a rectangle (from -> to, width) sampled on a grid about 1 m apart (and its corners and edge middles), or, for a
   construction, the cells its mesh covers. -> { kote (the level that holds most of it, a tie the higher; null when none of it is on the roof), levels: [{kote, m2}] by m² desc,
   several, area_m2, outside_m2, overhang_m (the farthest a point of it is off the edge), over: [{ side, m, m2 }] (which edge: øst, sør, vest, nord, by the way it
   points off the roof), on_roof, judged_on }. A rectangle is held against the whole roof; a shape (a railing, a frame) against the level it stands on
   (its kote), because a rail at 69,91 that runs over the 66,41 roof is off its own level. */
export function roofHold(site, e) {
  const pcs = piecesOf(site, e.on).flatMap(c => c.pieces); if (!pcs.length) return null;
  const F = footSet(e), bb = pcs.map(k => { const x = k.p.map(p => p[0]), y = k.p.map(p => p[1]); return [Math.min(...x), Math.min(...y), Math.max(...x), Math.max(...y)]; });
  const levelAt = p => { let t = null; for (let i = 0; i < pcs.length; i++) { const b = bb[i]; if (p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3] && inRing(p, pcs[i].p)) t = Math.max(t ?? -Infinity, pcs[i].top); } return t; };
  let samples, cell, extra = [], area;
  if (F) { samples = F.pts; cell = F.cell * F.cell; area = r1(cell * samples.length); }
  else {
    const { from, to, width: W } = e, d = [to[0] - from[0], to[1] - from[1]], L = Math.hypot(d[0], d[1]) || 1, n = [-d[1] / L, d[0] / L], at = (u, v) => [from[0] + d[0] * u + n[0] * (v - 0.5) * W, from[1] + d[1] * u + n[1] * (v - 0.5) * W];
    const nu = Math.max(1, Math.min(60, Math.ceil(L / Math.max(1, Math.sqrt(L * W / 2500))))), nv = Math.max(1, Math.min(60, Math.ceil(W / Math.max(1, Math.sqrt(L * W / 2500)))));
    cell = L * W / (nu * nv); area = r1(L * W); samples = [];
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) samples.push(at((i + 0.5) / nu, (j + 0.5) / nv));
    extra = [[0, 0], [1, 0], [1, 1], [0, 1], [0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]].map(([u, v]) => at(u, v));
  }
  const by = new Map(), outs = [];
  for (const p of samples) { const t = levelAt(p); if (t == null) outs.push([p, cell]); else by.set(t, (by.get(t) || 0) + cell); }
  for (const p of extra) if (levelAt(p) == null) outs.push([p, 0]);
  const levels = [...by].map(([kote, m2]) => ({ kote, m2: r1(m2) })).sort((a, b) => b.m2 - a.m2 || b.kote - a.kote), kote = levels.length ? levels[0].kote : null;
  /* what is off: a rectangle off the whole roof; a shape off the level it stands on (its pieces at that kote) */
  const mine = F && kote != null ? pcs.filter(k => Math.abs(k.top - kote) < 0.06) : pcs, rings = mine.map(k => k.p), off = [];
  if (F) { for (const p of samples) { if (mine.some(k => inRing(p, k.p))) continue; const [q, dist] = nearestOn(p, rings); if (dist > 0.02) off.push([p, cell, q, dist]); } }
  else for (const [p, w] of outs) { const [q, dist] = nearestOn(p, rings); off.push([p, w, q, dist]); }
  const sides = new Map(); let over = 0, out = 0;
  for (const [p, w, q, dist] of off) { over = Math.max(over, dist); out += w; const sd = sideOf(p[0] - q[0], p[1] - q[1]), s = sides.get(sd) || { side: sd, m: 0, m2: 0 }; s.m = Math.max(s.m, dist); s.m2 += w; sides.set(sd, s); }
  const tot = [...by.values()].reduce((s, v) => s + v, 0);
  return { kote, levels, several: levels.length > 1, area_m2: area, outside_m2: r1(out), overhang_m: r2(over), over: [...sides.values()].map(s => ({ side: s.side, m: r2(s.m), m2: r1(s.m2) })).sort((a, b) => b.m - a.m), on_roof: tot > 0, ...(F ? { judged_on: kote } : {}) };
}

/* how far over the edge, in words: «stikker 3,2 m (12 m²) ut over takkanten til Sentralblokka (øst 3,2 m, sør 1 m; målt mot taknivået kote 69,91)» */
const com = v => String(v).replace(".", ",");
export function overSay(h, wingName) {
  const sd = h.over?.length ? ` (${h.over.map(s => `${s.side} ${com(s.m)} m`).join(", ")}${h.judged_on != null ? `; målt mot taknivået kote ${com(h.judged_on)}` : ""})` : "";
  return `stikker ${com(h.overhang_m)} m (${com(h.outside_m2)} m²) ut over takkanten til ${wingName}${sd}`;
}

/* the roof's words for the answer: which level, over how many, how far past the edge; "" when it stands cleanly on one level */
export function roofSay(site, e) {
  const h = roofHold(site, e); if (!h) return null;
  const w = (site.wings || []).find(x => x.id === e.on)?.name || e.on;
  const said = [];
  if (h.several && !h.judged_on) said.push(`står over ${h.levels.length} takhøyder: ${h.levels.map(l => `kote ${com(l.kote)} (${com(l.m2)} m²)`).join(", ")}; foten står på kote ${com(h.kote)}, nivået som bærer mest. Hele tak-nivået er ikke ett: legg det på ett nivå (flytt eller gjør det mindre) eller del det`);
  if (h.overhang_m > 0.05) said.push(overSay(h, w));
  return { ...h, on: w, say: said.length ? `${e.name || "Volumet"} ${said.join("; ")}.` : null };
}

/* U-roof: «at» for a roof: { wing, roof: true, along?: «midt» | m from the roof's start end along its axis, gap_m?: m from the roof's left edge
   (looking along the axis from its start), absent = centred across, kote?: which level's rectangle, default the biggest }.
   length (m along the axis) and width (m across) are the footprint; it lies parallel to the axis. -> { from, to, text, kote, axis_bearing_deg } */
export function placeOnRoof(site, w, at, length, width) {
  if (!(length >= 1 && length <= 250)) throw new Error("length er lengden i meter langs takets akse, mellom 1 og 250");
  if (!(width >= 1 && width <= 120)) throw new Error("width er bredden i meter på tvers av taket, mellom 1 og 120");
  const R = roofOf(site, w.id); if (!R) throw new Error(`${w.name} har ikke noe tak å legge det på`);
  const lv = at.kote != null ? R.levels.find(l => Math.abs(l.kote - +at.kote) < 0.06) : R.levels.slice().sort((a, b) => b.area_m2 - a.area_m2)[0];
  if (!lv) throw new Error(`${w.name} har ikke tak på kote ${at.kote}; takene ligger på ${R.levels.map(l => l.kote).join(", ")}`);
  const [c0, c1, , c3] = lv.bounding_rect.corners, ax = [c1[0] - c0[0], c1[1] - c0[1]], aw = [c3[0] - c0[0], c3[1] - c0[1]], A = Math.hypot(...ax), B = Math.hypot(...aw), long = A >= B;
  /* the axis runs along the rectangle's long side; its left is that direction turned 90° counter-clockwise; s0 is the axis' start at the left edge */
  const u = long ? [ax[0] / A, ax[1] / A] : [aw[0] / B, aw[1] / B], v = [-u[1], u[0]], Lr = long ? A : B, Wr = long ? B : A, s0 = long ? c0 : c1;
  const alongM = at.along == null || at.along === "midt" ? (Lr - length) / 2 : Number(at.along), gap = at.gap_m == null ? (Wr - width) / 2 : Number(at.gap_m);
  if (!Number.isFinite(alongM) || !Number.isFinite(gap) || gap < 0) throw new Error("along er «midt» eller meter fra takets ene ende; gap_m er meter fra takets venstre kant (0 eller mer)");
  const mid = (t, q) => [r2(s0[0] + u[0] * t + v[0] * q), r2(s0[1] + u[1] * t + v[1] * q)], q = gap + width / 2;
  return { from: mid(alongM, q), to: mid(alongM + length, q), kote: lv.kote, axis_bearing_deg: lv.bounding_rect.axis_bearing_deg,
    text: `på taket til ${w.name} (kote ${String(lv.kote).replace(".", ",")}), langs takets akse ${String(lv.bounding_rect.axis_bearing_deg).replace(".", ",")}°: ${String(r1(alongM)).replace(".", ",")} m fra enden og ${String(r1(gap)).replace(".", ",")} m fra venstre kant; taket er ${String(lv.bounding_rect.length_m).replace(".", ",")} × ${String(lv.bounding_rect.width_m).replace(".", ",")} m` };
}

/* a new part's footprint, 4 corners (the edge on from's side first): the rectangle from -> to, width across */
export function footRing(v) {
  const d = [v.to[0] - v.from[0], v.to[1] - v.from[1]], L = Math.hypot(d[0], d[1]) || 1, n = [-d[1] / L * v.width / 2, d[0] / L * v.width / 2];
  return [[v.from[0] - n[0], v.from[1] - n[1]], [v.to[0] - n[0], v.to[1] - n[1]], [v.to[0] + n[0], v.to[1] + n[1]], [v.from[0] + n[0], v.from[1] + n[1]]];
}

/* T2: the new parts on one roof that meet one another in plan AND in height: [{ id, name, m2 }] for `v` (a new part { id?, name, on, from, to, width,
   base_kote, top_kote }) against the others that stand on the same wing's roof. Under 0.5 m² is not a meeting (fitOf's limit). Water fills a basin: a water volume and a non-water one never collide. */
export function roofCollisions(site, v) {
  if (!v.on || v.base_kote == null) return [];
  const r = footRing(v), z = [v.base_kote, v.top_kote ?? v.base_kote + (v.height || 0)], Fv = footSet(v);
  return (site.added || []).filter(x => x.kind === "volume" && x.on === v.on && x.id !== v.id && x.from && x.to && (x.material === "water") === (v.material === "water"))
    .map(x => ({ id: x.id, name: x.name, m2: r1(Fv || footSet(x) ? shapeOverlap(Fv, r, z, x) : overlapArea(footRing(x), r, [x.base_kote, x.top_kote], z)) })).filter(c => c.m2 > 0.5);
}
/* a shape against another footprint (a rectangle or a shape), in plan and in height: the m² of the cells of the one that lie on the other */
function shapeOverlap(Fv, r, z, x) {
  if (!(Math.max(z[0], x.base_kote) < Math.min(z[1], x.top_kote))) return 0;
  const Fx = footSet(x), [A, B] = Fv ? [Fv, Fx] : [Fx, null], ringB = Fv ? (Fx ? null : footRing(x)) : r;
  const grid = new Map(), g = B?.cell || 1, key = p => `${Math.floor(p[0] / g)},${Math.floor(p[1] / g)}`;
  if (B) for (const p of B.pts) { const k = key(p); (grid.get(k) || grid.set(k, []).get(k)).push(p); }
  const near = p => { const i = Math.floor(p[0] / g), j = Math.floor(p[1] / g); for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) if ((grid.get(`${i + a},${j + b}`) || []).some(q => Math.hypot(q[0] - p[0], q[1] - p[1]) < g * 0.72)) return true; return false; };
  return A.pts.filter(p => B ? near(p) : inRing(p, ringB)).length * A.cell * A.cell;
}
export const collisionSay = (c, wingName) => `${c.map(x => `«${x.name}» (${String(x.m2).replace(".", ",")} m²)`).join(", ")} på taket til ${wingName}`;

/* T1 measure: what a new part, a wing or a point is, as numbers, and how two relate. ref: [east, north, kote?] | a new part's id or name | a wing
   (lookup is the caller's wingOf). A part's reference point is the middle of its footprint at its foot; a wing's the middle of its biggest roof level at that kote
   (so a part on a roof is 0 m above it). Throws a sentence for what it cannot find. */
/* the line a thing is measured by: its points, the rings to take the nearest edge of (none: the nearest point), and whether a point is inside it */
const dens = (ring, step = 0.5) => ring.flatMap((a, i) => { const b = ring[(i + 1) % ring.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(L / step)); return Array.from({ length: n }, (_, k) => [a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]); });
function partOutline(v) {
  const F = footSet(v); if (F) return { pts: F.pts, segs: null, inside: null };
  const ring = footRing(v); return { pts: dens(ring), segs: [ring], inside: p => inRing(p, ring) };
}
function levelOutline(site, wing, kote) {
  const rings = levelRingsOf(site, wing, kote).map(g => g.ring), mine = piecesOf(site, wing).flatMap(c => c.pieces).filter(k => Math.abs(k.top - kote) < 0.06);
  return { pts: rings.flatMap(g => dens(g)), segs: rings, inside: p => mine.some(k => inRing(p, k.p)) };
}
/* DEVIATION of a's outline from b's nearest edge: smallest and largest distance, where the largest is (which side, by the way it points off b's edge), and for an edge
   with an inside (a roof level) the most outside and the most inside */
function deviation(A, B) {
  const a = A.outl, b = B.outl; if (!a?.pts.length || !b?.pts.length) return null;
  let min = Infinity, max = -1, worst = null, outside = 0, inside = 0;
  for (const p of a.pts) {
    let q, d; if (b.segs) [q, d] = nearestOn(p, b.segs); else { d = Infinity; for (const x of b.pts) { const e = Math.hypot(x[0] - p[0], x[1] - p[1]); if (e < d) { d = e; q = x; } } }
    if (d < min) min = d; if (d > max) { max = d; worst = { p, q }; }
    if (b.inside) { if (b.inside(p)) inside = Math.max(inside, d); else outside = Math.max(outside, d); }
  }
  return { min_m: r2(min), max_m: r2(max), max_side: sideOf(worst.p[0] - worst.q[0], worst.p[1] - worst.q[1]), max_at: worst.p.map(r2), samples: a.pts.length, ...(b.inside ? { outside_m: r2(outside), inside_m: r2(inside) } : {}) };
}
function partOf(site, ref, wingOf) {
  if (Array.isArray(ref)) {
    const p = ref.map(Number); if (p.length < 2 || p.length > 3 || !p.every(Number.isFinite)) throw new Error("Et punkt er [øst, nord] eller [øst, nord, kote] i meter");
    const k = p[2] ?? r2(groundAt(site, p)); return { kind: "point", name: `punktet ${p[0]}, ${p[1]}`, pt: [p[0], p[1], k], kote_from: p[2] == null ? "terrenget" : "oppgitt" };
  }
  const key = String(ref ?? "").trim().toLowerCase(), v = key && (site.added || []).find(x => x.kind === "volume" && (x.id.toLowerCase() === key || x.name.toLowerCase() === key));
  if (v) {
    const d = [v.to[0] - v.from[0], v.to[1] - v.from[1]], L = Math.hypot(d[0], d[1]), c = [r2((v.from[0] + v.to[0]) / 2), r2((v.from[1] + v.to[1]) / 2)];
    return { kind: "part", id: v.id, name: v.name, corners: footRing(v).map(p => p.map(r2)), axis_bearing_deg: r1(bearing(d[0], d[1])), length_m: r2(L), width_m: r2(v.width), foot_kote: v.base_kote, top_kote: v.top_kote,
      area_m2: r1(L * v.width), stands_on: v.on ? `taket til ${(site.wings || []).find(w => w.id === v.on)?.name || v.on}` : "bakken", on: v.on || null, pt: [c[0], c[1], v.base_kote], vol: v, outl: partOutline(v) };
  }
  /* «wing@kote»: one roof level's edge (about_wing roof.edges), as a thing to measure to */
  const at = key.lastIndexOf("@"), lvk = at > 0 && Number.isFinite(+key.slice(at + 1).replace(",", ".")) ? +key.slice(at + 1).replace(",", ".") : null;
  const w = key && wingOf(site, lvk != null ? String(ref).slice(0, at) : ref), R = w && roofOf(site, w.id);
  if (R) {
    const lv = lvk != null ? R.levels.find(l => Math.abs(l.kote - lvk) < 0.06) : R.levels.slice().sort((a, b) => b.area_m2 - a.area_m2)[0];
    if (!lv) throw new Error(`${w.name} har ikke tak på kote ${lvk}; takene ligger på ${R.levels.map(l => l.kote).join(", ")}`);
    const b = lv.bounding_rect, c = b.corners, m = [r2(c.reduce((s, p) => s + p[0], 0) / 4), r2(c.reduce((s, p) => s + p[1], 0) / 4)];
    return { kind: lvk != null ? "level" : "wing", id: w.id, name: lvk != null ? `kanten av taknivået kote ${com(lv.kote)} på ${w.name}` : w.name, corners: c, axis_bearing_deg: b.axis_bearing_deg, length_m: b.length_m, width_m: b.width_m, foot_kote: site.buildings.find(x => x.wing === w.id)?.base ?? null, top_kote: lv.kote,
      area_m2: lv.area_m2, stands_on: "bakken", roof_levels: R.levels.map(l => l.kote), pt: [m[0], m[1], lv.kote], outl: lvk != null ? levelOutline(site, w.id, lv.kote) : { pts: dens(R.outline), segs: [R.outline], inside: p => inRing(p, R.outline) } };
  }
  throw new Error(`Fant ikke «${ref}»: en fløy, et nytt bygg (id eller navn: ${(site.added || []).filter(x => x.kind === "volume").map(x => x.id).slice(0, 12).join(", ") || "forslaget har ingen ennå"}) eller et punkt [øst, nord]`);
}
const show = ({ pt, vol, kote_from, outl, ...p }) => p;
export function measureParts(site, a, b, wingOf) {
  const A = partOf(site, a, wingOf), B = b == null ? null : partOf(site, b, wingOf);
  if (!B) { if (A.kind === "point") throw new Error("Ett punkt har ingenting å lese tilbake: gi b også, eller en del eller fløy"); return { a: show(A), say: `${A.name}: ${com(A.length_m)} × ${com(A.width_m)} m, akse ${com(A.axis_bearing_deg)}°, fot kote ${com(A.foot_kote)}, topp kote ${com(A.top_kote)}, ${com(A.area_m2)} m², står på ${A.stands_on}.` }; }
  const m = measureOf([A.pt, B.pt]), out = { a: show(A), b: show(B), distance_m: m.distance_m, dh_m: m.dh_m, horizontal_m: m.horizontal_m }, said = [];
  said.push(`Fra ${A.name} til ${B.name}: ${com(m.distance_m)} m (${com(m.horizontal_m)} m vannrett, ${com(Math.abs(m.dh_m))} m ${m.dh_m < 0 ? "ned" : "opp"}), målt fra midten av grunnflaten i foten`);
  if (A.axis_bearing_deg != null && B.axis_bearing_deg != null) {
    const d = Math.abs(A.axis_bearing_deg - B.axis_bearing_deg) % 180, ang = r1(Math.min(d, 180 - d)), u = [Math.sin(B.axis_bearing_deg * Math.PI / 180), Math.cos(B.axis_bearing_deg * Math.PI / 180)];
    const rel = [A.pt[0] - B.pt[0], A.pt[1] - B.pt[1]], cross = u[0] * rel[1] - u[1] * rel[0], off = r2(Math.abs(cross));
    Object.assign(out, { angle_deg: ang, parallel: ang <= 0.5, offset_m: off, offset_side: Math.abs(cross) < 0.005 ? null : cross > 0 ? "venstre" : "høyre" });
    said.push(ang <= 0.5 ? "står parallelt" : `er skjev ${com(ang)}° (ikke parallelt; grensen er 0,5°)`, `${com(off)} m til siden for aksen til ${B.name}${out.offset_side ? ` (${out.offset_side}, sett langs aksen)` : ""}`);
  }
  const dev = deviation(A, B);
  if (dev) { out.deviation = dev; said.push(`avviket fra ${A.name} til ${B.name}: minst ${com(dev.min_m)} m, størst ${com(dev.max_m)} m (${dev.max_side}, ved [${com(dev.max_at[0])}, ${com(dev.max_at[1])}])${dev.outside_m != null ? `; lengst ut ${com(dev.outside_m)} m utenfor, lengst inn ${com(dev.inside_m)} m innenfor` : ""}`); }
  const [part, roof] = A.kind === "part" && (B.kind === "wing" || B.kind === "level") ? [A, B] : B.kind === "part" && (A.kind === "wing" || A.kind === "level") ? [B, A] : [];
  if (part) {
    const h = roofHold(site, { ...part.vol, on: roof.id }), wname = (site.wings || []).find(x => x.id === roof.id)?.name || roof.id;
    if (h && h.on_roof) { Object.assign(out, { overhang_m: h.overhang_m, outside_m2: h.outside_m2, ...(h.over.length ? { over: h.over } : {}) }); said.push(h.overhang_m > 0.05 ? `${part.name} ${overSay(h, wname)}` : `${part.name} ligger innenfor takkanten til ${wname}`); }
    else if (h) { Object.assign(out, { overhang_m: null }); said.push(`${part.name} ligger ikke over taket til ${wname}`); }
  }
  out.say = said.join("; ") + ".";
  return out;
}
