/* The after's paint and earthworks as edits (U3655): the same geometry hagekart paints with (renderkit/paint.js, terrain.js),
   in this site's metres [east, north] from the origin.

   { kind: "paint", surface, mode?, line, r?, why? }
        a brush stroke along line (1 or more points), radius r metres, laid as grass, planting (a bed), paving or gravel;
        mode "erase" rubs that surface out instead. The brush stops at buildings, water, paths and the lot's edge, and
        pulls the last 0.8 m to a building, a road or a path, so the lawn meets the wall. Joins the surface it touches.
        around (set by the connector, not asked for): the rings of the ways near the stroke.
   { kind: "terrain", op, shape, h?, level?, rel?, skirt?, why? }
        raise | lower | flatten | smooth | pond | terrace on the ground; shape is { t: "circle", c, r }, { t: "poly", ring }
        or { t: "stroke", pts, r }; what it digs and fills comes back (cut and fill, in m³ and tipper loads). */
import { commit, ghost, gridOver, resFor, stampStroke, blockedFor } from "./renderkit/paint.js";
import { designedSurface, TERRAIN_OPS } from "./renderkit/terrain.js";
import { ringArea as signedArea } from "./renderkit/paths2d.js";
const ringArea = r => Math.abs(signedArea(r));

export const PAINT_SURFACES = ["grass", "planting", "paving", "gravel"];
const KIND = { grass: "lawn", planting: "bed", paving: "paving", gravel: "driveway" }, BACK = Object.fromEntries(Object.entries(KIND).map(([k, v]) => [v, k]));
const r1 = v => Math.round(v * 10) / 10;

export function checkPaint(e, { pts, num, name, w_ }) {
  const surface = String(e.surface ?? ""); if (!PAINT_SURFACES.includes(surface)) throw new Error(`surface for paint er ${PAINT_SURFACES.join(", ")}`);
  const mode = e.mode == null ? "add" : String(e.mode); if (!["add", "erase"].includes(mode)) throw new Error("mode er add (mal) eller erase (visk ut)");
  const out = { kind: "paint", surface, mode, line: pts(e.line, "line", 1), r: num(e.r, 0.3, 10, "Penselens radius (r, m)", 1.5), ...w_ };
  if (e.around != null) { if (!Array.isArray(e.around) || e.around.length > 120) throw new Error("around er en liste med høyst 120 ringer"); out.around = e.around.map(r => r.map(p => [r1(p[0]), r1(p[1])])); }
  const n = name(); if (n) out.name = n;
  return out;
}

export function checkTerrain(e, { pts, num, name, w_ }) {
  const op = String(e.op ?? ""); if (!TERRAIN_OPS.includes(op)) throw new Error(`op er ${TERRAIN_OPS.join(", ")}`);
  const s = e.shape; if (!s || typeof s !== "object") throw new Error("shape mangler: { t: circle, c: [øst, nord], r } | { t: poly, ring } | { t: stroke, pts, r }");
  let shape;
  if (s.t === "circle") shape = { t: "circle", c: pts([s.c], "shape.c", 1)[0], r: num(s.r, 0.5, 100, "Radius (shape.r)") };
  else if (s.t === "poly") { const rg = pts(s.ring, "shape.ring", 3); shape = { t: "poly", ring: rg[0][0] === rg.at(-1)[0] && rg[0][1] === rg.at(-1)[1] ? rg : [...rg, rg[0]] }; if (ringArea(shape.ring) < 1 || ringArea(shape.ring) > 40000) throw new Error("Flaten må være mellom 1 og 40 000 m²"); }
  else if (s.t === "stroke") shape = { t: "stroke", pts: pts(s.pts, "shape.pts", 1), r: num(s.r, 0.3, 50, "Radius (shape.r)") };
  else throw new Error("shape.t er circle, poly eller stroke");
  const out = { kind: "terrain", op, shape, ...w_ };
  for (const [k, lo, hi] of [["h", 0.05, 20], ["level", -20, 200], ["rel", -20, 20], ["skirt", 0, 30], ["k", 0, 1]]) if (e[k] != null) out[k] = num(e[k], lo, hi, k);
  if (op === "flatten" && out.level == null && out.rel == null) { /* the mean of the shape: nothing to say */ }
  if (["raise", "lower", "pond"].includes(op) && out.h == null) throw new Error(`${op} trenger h (m)`);
  const n = name(); if (n) out.name = n;
  return out;
}

/* the stroke laid on the surfaces so far (land, as applyLandscape keeps them), as hagekart's brush lays it (brush.js):
   the stroke is stamped on a grid, made into the rings the brush would paint (stopped by what is blocked, pulled the last
   0.8 m to its edge), and committed against the surfaces there are. gone: the buildings the after has torn down already.
   Returns { land, m2 }: the surfaces after, and the net change of that surface in m². */
export function applyPaint(land, e, site, gone, nextId) {
  const plan = paintPlan(land, e, site, gone); if (!plan) return { land, m2: 0 };
  const { rings, blocked, lot, kind, erase } = plan;
  if (!rings.length) return { land, m2: 0 };
  const areas = land.filter(x => x.kind === "surface" && KIND[x.surface]).map(x => ({ id: x.id, kind: KIND[x.surface], st: "exists", ring: closed(x.ring), holes: (x.holes || []).map(closed) }));
  const res = commit({ rings, mode: erase ? "erase" : "add", kind, st: "exists", areas, lot, buildings: blocked, known: { edges: blocked } });
  const out = land.filter(x => !res.remove.includes(x.id));
  for (const a of res.add) {
    const was = a.id && land.find(x => x.id === a.id), ring = a.ring.slice(0, -1), holes = (a.holes || []).map(h => h.slice(0, -1));
    const item = { id: a.id || nextId(), kind: "surface", name: was?.name ?? e.name ?? null, surface: BACK[a.kind] || e.surface, points: ring, ring, ...(holes.length ? { holes } : {}),
      area_m2: r1(ringArea(ring) - holes.reduce((s, h) => s + ringArea(h), 0)), plants: was?.plants || [], painted: true, why: e.why };
    const at = was ? out.findIndex(x => x.id === a.id) : -1; if (at >= 0) out[at] = item; else out.push(item);
  }
  return { land: out, m2: res.m2 };
}

const closed = r => r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1] ? r : [...r, r[0]];
/* what the brush would paint, before it is committed: the rings of the stroke stopped by what is blocked and pulled the last
   0.8 m to its edge. The page draws these while one drags (mal.js); applyPaint commits them: one function, one answer */
export function paintPlan(land, e, site, gone = new Set()) {
  const lot = site.lot?.ring; if (!lot) return null;
  const blocked = [...site.buildings.filter(b => !gone.has(b.id) && !gone.has(b.wing)).map(b => b.ring), ...(e.around || []),
    ...land.filter(g => g.kind === "path" || (g.kind === "surface" && (g.surface === "water" || !KIND[g.surface]))).map(g => g.ring)].map(closed);
  const erase = e.mode === "erase", L = e.line;
  const xs = L.map(p => p[0]), ys = L.map(p => p[1]), box = [Math.min(...xs) - e.r, Math.min(...ys) - e.r, Math.max(...xs) + e.r, Math.max(...ys) + e.r];
  const g = gridOver(box, resFor(box, 4), 4), mask = stampStroke(g, L, e.r);
  const gh = erase ? ghost({ g, mask, blocked: new Uint8Array(mask.length), box, edges: [], snapM: 0 }) : ghost({ g, mask, blocked: blockedFor(g, { lot: closed(lot), buildings: blocked }), box, edges: blocked });
  return { rings: gh.rings, polys: gh.polys, m2: gh.m2, blocked, lot: closed(lot), kind: KIND[e.surface], erase };
}

/* the rings of the ways within reach of a stroke (the edit's `around`), the same on the server and on the page */
export function nearWays(rings, e) {
  const r = (+e.r || 1.5) + 4, xs = e.line.map(p => +p[0]), ys = e.line.map(p => +p[1]), b = [Math.min(...xs) - r, Math.min(...ys) - r, Math.max(...xs) + r, Math.max(...ys) + r];
  return rings.filter(w => w.length > 2 && w.some(p => p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3])).slice(0, 100).map(w => w.map(p => [r1(p[0]), r1(p[1])]));
}

/* the terrain ops of the edits laid on the site's ground grid (a copy; the before's grid stays): what they dig and fill
   comes back as site.earthwork { cut_m3, fill_m3, net_m3, tippers, ops } */
export function applyTerrain(site, edits) {
  const list = edits.filter(e => e.kind === "terrain").map((e, i) => ({ id: `terreng-op-${i + 1}`, ...e }));
  if (!list.length || !site.terrain?.z) return;
  const T = site.terrain, s = designedSurface({ g: { x0: T.x0, y1: T.y1, res: T.res, w: T.w, h: T.h }, ground: Float32Array.from(T.z) }, list);
  if (!s.builds) return;
  site.terrain = { ...T, z: Array.from(s.ground, v => Math.round(v * 100) / 100) };
  const b = s.builds;
  site.earthwork = { cut_m3: r1(b.cut), fill_m3: r1(b.fill), net_m3: r1(b.net), tippers: b.tippers, ops: b.ops.map(o => ({ op: o.op, cut_m3: r1(o.cut), fill_m3: r1(o.fill) })) };
}
