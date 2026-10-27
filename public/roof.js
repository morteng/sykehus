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
function outerRing(rects) {
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
  return pts.sort((a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a)))[0] || [];
}

/* about_wing's roof: per building of the wing (the largest first; `roof_other` when a wing has more than one), as numbers.
   grid_bearing_deg: the way the grid's long axis lies, degrees from north (0..180). Every length in m, corners [east, north]. */
export function roofOf(site, wing) {
  const outs = piecesOf(site, wing).filter(c => c.pieces.length).map(c => {
    const th = c.th, cs = Math.cos(th), sn = Math.sin(th), toU = ([x, y]) => [x * cs + y * sn, -x * sn + y * cs], toXY = ([u, v]) => [r2(u * cs - v * sn), r2(u * sn + v * cs)];
    const rects = c.pieces.map(k => { const q = k.p.map(toU), u = q.map(p => p[0]), v = q.map(p => p[1]); return { u0: Math.min(...u), u1: Math.max(...u), v0: Math.min(...v), v1: Math.max(...v), top: k.top }; });
    const box = rs => { const u0 = Math.min(...rs.map(r => r.u0)), u1 = Math.max(...rs.map(r => r.u1)), v0 = Math.min(...rs.map(r => r.v0)), v1 = Math.max(...rs.map(r => r.v1)), du = u1 - u0, dv = v1 - v0;
      return { corners: [[u0, v0], [u1, v0], [u1, v1], [u0, v1]].map(toXY), length_m: r2(Math.max(du, dv)), width_m: r2(Math.min(du, dv)), axis_bearing_deg: r1(du >= dv ? bearing(cs, sn) : bearing(-sn, cs)), area: du * dv }; };
    const merged = mergeRects(rects), area = rs => rs.reduce((s, r) => s + (r.u1 - r.u0) * (r.v1 - r.v0), 0);
    const levels = [...new Set(rects.map(r => r.top))].sort((a, b) => b - a).map(top => { const rs = rects.filter(r => r.top === top), b = box(rs), a = area(rs);
      return { kote: top, area_m2: Math.round(a), bounding_rect: { corners: b.corners, length_m: b.length_m, width_m: b.width_m, axis_bearing_deg: b.axis_bearing_deg }, fills_rect: r2(a / b.area) }; });
    const all = box(rects);
    return { building: c.id, grid_deg: r1(th * 180 / Math.PI), grid_bearing_deg: r1(bearing(cs, sn)), outline: outerRing(merged).map(toXY), outline_note: "the roof's outer edge, counter-clockwise, [east, north] in site metres",
      bounding_rect: { corners: all.corners, length_m: all.length_m, width_m: all.width_m, axis_bearing_deg: all.axis_bearing_deg }, levels,
      blocks: merged.filter(r => (r.u1 - r.u0) * (r.v1 - r.v0) >= 10).sort((a, b) => b.top - a.top || (b.u1 - b.u0) * (b.v1 - b.v0) - (a.u1 - a.u0) * (a.v1 - a.v0)).map(r => { const b = box([r]); return { kote: r.top, corners: b.corners, length_m: b.length_m, width_m: b.width_m, axis_bearing_deg: b.axis_bearing_deg }; }),
      blocks_under_10m2: merged.filter(r => (r.u1 - r.u0) * (r.v1 - r.v0) < 10).length, area_m2: Math.round(area(rects)) };
  }).sort((a, b) => b.area_m2 - a.area_m2);
  if (!outs.length) return null;
  return { ...outs[0], ...(outs.length > 1 ? { roof_other: outs.slice(1) } : {}),
    levels_say: `The roof has ${outs[0].levels.length} level${outs[0].levels.length === 1 ? "" : "s"}: kote ${outs[0].levels.map(l => `${l.kote} (${l.area_m2} m²)`).join(", ")}. A volume on it stands on the level that holds most of its footprint.` };
}

/* where a footprint (from -> to, width) stands on a wing's roof: sampled on a grid about 1 m apart (and its corners and edge middles).
   -> { kote (the level that holds most of it, a tie the higher; null when none of it is on the roof), levels: [{kote, m2}] by m² desc,
        several, area_m2, outside_m2, overhang_m (the farthest a point of it is off the roof's edge), on_roof }.
   `levels` and `overhang_m` are what to name to the person; kote is the one number a foot takes. */
export function roofHold(site, e) {
  const pcs = piecesOf(site, e.on).flatMap(c => c.pieces); if (!pcs.length) return null;
  const { from, to, width: W } = e, d = [to[0] - from[0], to[1] - from[1]], L = Math.hypot(d[0], d[1]) || 1, n = [-d[1] / L, d[0] / L], at = (u, v) => [from[0] + d[0] * u + n[0] * (v - 0.5) * W, from[1] + d[1] * u + n[1] * (v - 0.5) * W];
  const nu = Math.max(1, Math.min(60, Math.ceil(L / Math.max(1, Math.sqrt(L * W / 2500))))), nv = Math.max(1, Math.min(60, Math.ceil(W / Math.max(1, Math.sqrt(L * W / 2500))))), cell = L * W / (nu * nv);
  const bb = pcs.map(k => { const x = k.p.map(p => p[0]), y = k.p.map(p => p[1]); return [Math.min(...x), Math.min(...y), Math.max(...x), Math.max(...y)]; });
  const levelAt = p => { let t = null; for (let i = 0; i < pcs.length; i++) { const b = bb[i]; if (p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3] && inRing(p, pcs[i].p)) t = Math.max(t ?? -Infinity, pcs[i].top); } return t; };
  const by = new Map(); let out = 0, over = 0;
  const off = p => pcs.reduce((m, k) => Math.min(m, ringDist(p, k.p)), Infinity);
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) { const p = at((i + 0.5) / nu, (j + 0.5) / nv), t = levelAt(p); if (t == null) { out += cell; over = Math.max(over, off(p)); } else by.set(t, (by.get(t) || 0) + cell); }
  for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 1], [0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]]) { const p = at(u, v); if (levelAt(p) == null) over = Math.max(over, off(p)); }
  const levels = [...by].map(([kote, m2]) => ({ kote, m2: r1(m2) })).sort((a, b) => b.m2 - a.m2 || b.kote - a.kote);
  const area = r1(L * W), tot = [...by.values()].reduce((s, v) => s + v, 0);
  return { kote: levels.length ? levels[0].kote : null, levels, several: levels.length > 1, area_m2: area, outside_m2: r1(out), overhang_m: r2(over), on_roof: tot > 0 };
}

/* the roof's words for the answer: which level, over how many, how far past the edge; "" when it stands cleanly on one level */
export function roofSay(site, e) {
  const h = roofHold(site, e); if (!h) return null;
  const w = (site.wings || []).find(x => x.id === e.on)?.name || e.on, com = v => String(v).replace(".", ",");
  const said = [];
  if (h.several) said.push(`står over ${h.levels.length} takhøyder: ${h.levels.map(l => `kote ${com(l.kote)} (${com(l.m2)} m²)`).join(", ")}; foten står på kote ${com(h.kote)}, nivået som bærer mest. Hele tak-nivået er ikke ett: legg det på ett nivå (flytt eller gjør det mindre) eller del det`);
  if (h.overhang_m > 0.05) said.push(`stikker ${com(h.overhang_m)} m (${com(h.outside_m2)} m²) ut over takkanten til ${w}`);
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
   base_kote, top_kote }) against the others that stand on the same wing's roof. Under 0.5 m² is not a meeting (fitOf's limit). */
export function roofCollisions(site, v) {
  if (!v.on || v.base_kote == null) return [];
  const r = footRing(v), z = [v.base_kote, v.top_kote ?? v.base_kote + (v.height || 0)];
  return (site.added || []).filter(x => x.kind === "volume" && x.on === v.on && x.id !== v.id && x.from && x.to)
    .map(x => ({ id: x.id, name: x.name, m2: r1(overlapArea(footRing(x), r, [x.base_kote, x.top_kote], z)) })).filter(c => c.m2 > 0.5);
}
export const collisionSay = (c, wingName) => `${c.map(x => `«${x.name}» (${String(x.m2).replace(".", ",")} m²)`).join(", ")} på taket til ${wingName}`;

/* T1 measure: what a new part, a wing or a point is, as numbers, and how two relate. ref: [east, north, kote?] | a new part's id or name | a wing
   (lookup is the caller's wingOf). A part's reference point is the middle of its footprint at its foot; a wing's the middle of its biggest roof level at that kote
   (so a part on a roof is 0 m above it). Throws a sentence for what it cannot find. */
function partOf(site, ref, wingOf) {
  if (Array.isArray(ref)) {
    const p = ref.map(Number); if (p.length < 2 || p.length > 3 || !p.every(Number.isFinite)) throw new Error("Et punkt er [øst, nord] eller [øst, nord, kote] i meter");
    const k = p[2] ?? r2(groundAt(site, p)); return { kind: "point", name: `punktet ${p[0]}, ${p[1]}`, pt: [p[0], p[1], k], kote_from: p[2] == null ? "terrenget" : "oppgitt" };
  }
  const key = String(ref ?? "").trim().toLowerCase(), v = key && (site.added || []).find(x => x.kind === "volume" && (x.id.toLowerCase() === key || x.name.toLowerCase() === key));
  if (v) {
    const d = [v.to[0] - v.from[0], v.to[1] - v.from[1]], L = Math.hypot(d[0], d[1]), c = [r2((v.from[0] + v.to[0]) / 2), r2((v.from[1] + v.to[1]) / 2)];
    return { kind: "part", id: v.id, name: v.name, corners: footRing(v).map(p => p.map(r2)), axis_bearing_deg: r1(bearing(d[0], d[1])), length_m: r2(L), width_m: r2(v.width), foot_kote: v.base_kote, top_kote: v.top_kote,
      area_m2: r1(L * v.width), stands_on: v.on ? `taket til ${(site.wings || []).find(w => w.id === v.on)?.name || v.on}` : "bakken", on: v.on || null, pt: [c[0], c[1], v.base_kote], vol: v };
  }
  const w = key && wingOf(site, ref), R = w && roofOf(site, w.id);
  if (R) {
    const lv = R.levels.slice().sort((a, b) => b.area_m2 - a.area_m2)[0], b = lv.bounding_rect, c = b.corners, m = [r2(c.reduce((s, p) => s + p[0], 0) / 4), r2(c.reduce((s, p) => s + p[1], 0) / 4)];
    return { kind: "wing", id: w.id, name: w.name, corners: c, axis_bearing_deg: b.axis_bearing_deg, length_m: b.length_m, width_m: b.width_m, foot_kote: site.buildings.find(x => x.wing === w.id)?.base ?? null, top_kote: lv.kote,
      area_m2: lv.area_m2, stands_on: "bakken", roof_levels: R.levels.map(l => l.kote), pt: [m[0], m[1], lv.kote] };
  }
  throw new Error(`Fant ikke «${ref}»: en fløy, et nytt bygg (id eller navn: ${(site.added || []).filter(x => x.kind === "volume").map(x => x.id).slice(0, 12).join(", ") || "forslaget har ingen ennå"}) eller et punkt [øst, nord]`);
}
const show = ({ pt, vol, kote_from, ...p }) => p, com = v => String(v).replace(".", ",");
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
  const [part, roof] = A.kind === "part" && B.kind === "wing" ? [A, B] : B.kind === "part" && A.kind === "wing" ? [B, A] : [];
  if (part) {
    const h = roofHold(site, { ...part.vol, on: roof.id });
    if (h && h.on_roof) { Object.assign(out, { overhang_m: h.overhang_m, outside_m2: h.outside_m2 }); said.push(h.overhang_m > 0.05 ? `${part.name} stikker ${com(h.overhang_m)} m (${com(h.outside_m2)} m²) ut over takkanten til ${roof.name}` : `${part.name} ligger innenfor takkanten til ${roof.name}`); }
    else if (h) { Object.assign(out, { overhang_m: null }); said.push(`${part.name} ligger ikke over taket til ${roof.name}`); }
  }
  out.say = said.join("; ") + ".";
  return out;
}
