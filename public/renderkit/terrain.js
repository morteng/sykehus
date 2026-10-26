/* renderkit terrain: terrain ops over a laser ground (from hagekart build.js, U1546; moved here U3655). Pure: no DOM, no three.js,
   no words for a person. The shapes are in a FRAME the app gives: ok(p) and toXY(p) (hagekart: lng/lat to UTM; sykehus: its own
   metres, the default METRES).

   Ops that raise, lower, flatten, smooth, dig a pond or level a terrace over the laser ground, and the cut and fill volumes.

   A build is never baked into the laser data. `designedSurface(s, builds)` makes a copy of the surface with the ops applied in order;
   the Drøm view uses it and the Nå view keeps the laser. Shapes are kept in the app's frame and worked in metres.
   Accuracy is the laser's, 0.1-0.3 m; ground under trees and buildings is interpolated, so volumes there are rougher.

   build: { id, kind: "terrain", op, shape, h?, level?, rel?, skirt?, soft?, water?, by: "person"|"ai", st: "planned"|"exists", off?, src }
   shape: { t: "circle", c: [x, y], r } | { t: "poly", ring: [[x, y], ...] } | { t: "stroke", pts: [[x, y], ...], r }   (x, y in the frame)
   op: raise (h m up) | lower (h m down) | flatten (to `level` m above sea, or `rel` m above the shape's mean) | smooth (k 0..1)
       | pond (dig `h` m with a 1:2 bank; `water` is the water level, kept for later) | terrace (flatten, with a `skirt` m slope outside) */
import { pointInRing } from "./paths2d.js";

/* a frame: ok(p) says a point of a shape is a usable one, toXY(p) puts it on the grid in metres */
export const METRES = { ok: p => Math.abs(p[0]) <= 1e6 && Math.abs(p[1]) <= 1e6, toXY: p => [p[0], p[1]] };

export const TERRAIN_OPS = ["raise", "lower", "flatten", "smooth", "pond", "terrace"];
export const TIPPER_M3 = 10;   // one tipper load, about (src: approx)
const num = v => typeof v === "number" && Number.isFinite(v);
const pt = (p, F) => Array.isArray(p) && p.length >= 2 && num(p[0]) && num(p[1]) && F.ok(p);

/* A clean build or null. Unknown ops, bad shapes and absurd sizes are dropped, never guessed at. */
export function normalizeBuild(b, F = METRES) {
  if (!b || typeof b !== "object" || b.kind !== "terrain" || !TERRAIN_OPS.includes(b.op)) return null;
  const s = b.shape; let shape = null;
  if (s?.t === "circle" && pt(s.c, F) && num(s.r) && s.r > 0 && s.r <= 200) shape = { t: "circle", c: [s.c[0], s.c[1]], r: s.r };
  else if (s?.t === "poly" && Array.isArray(s.ring) && s.ring.length >= 4 && s.ring.length <= 400 && s.ring.every(p => pt(p, F))) shape = { t: "poly", ring: s.ring.map(p => [p[0], p[1]]) };
  else if (s?.t === "stroke" && Array.isArray(s.pts) && s.pts.length >= 1 && s.pts.length <= 2000 && s.pts.every(p => pt(p, F)) && num(s.r) && s.r > 0 && s.r <= 50) shape = { t: "stroke", pts: s.pts.map(p => [p[0], p[1]]), r: s.r };
  if (!shape) return null;
  const clamp = (v, lo, hi, d) => num(v) ? Math.min(hi, Math.max(lo, v)) : d;
  const out = { id: String(b.id || "").slice(0, 40), kind: "terrain", op: b.op, shape, by: b.by === "ai" ? "ai" : "person", st: b.st === "exists" ? "exists" : "planned", src: String(b.src || "approx").slice(0, 20) };
  if (b.off) out.off = true;
  if (["raise", "lower", "pond"].includes(b.op)) out.h = clamp(b.h, 0, 10, 0.3);
  if (b.op === "flatten" || b.op === "terrace") { if (num(b.level)) out.level = clamp(b.level, -50, 3000, 0); else out.rel = clamp(b.rel, -10, 10, 0); }
  if (b.op === "terrace") out.skirt = clamp(b.skirt, 0, 20, 1.5);
  if (b.op === "smooth") out.k = clamp(b.k, 0, 1, 0.6);
  if (b.op === "pond" && num(b.water)) out.water = clamp(b.water, -50, 3000, 0);
  if (num(b.soft)) out.soft = clamp(b.soft, 0, 20, 0);
  return out;
}

/* ---- shape -> cells ---- */
const segDist = (x, y, [ax, ay], [bx, by]) => { const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)); return Math.hypot(x - ax - dx * t, y - ay - dy * t); };
const ringEdgeDist = (x, y, ring) => { let m = Infinity; for (let i = 0; i < ring.length - 1; i++) m = Math.min(m, segDist(x, y, ring[i], ring[i + 1])); return m; };
/* Signed distance from the shape's edge in metres: negative inside, positive outside. */
function sdf(sh, x, y) {
  if (sh.t === "circle") return Math.hypot(x - sh.c[0], y - sh.c[1]) - sh.r;
  if (sh.t === "stroke") { let m = Infinity; for (let i = 0; i < sh.pts.length; i++) m = Math.min(m, sh.pts.length === 1 ? Math.hypot(x - sh.pts[0][0], y - sh.pts[0][1]) : i ? segDist(x, y, sh.pts[i - 1], sh.pts[i]) : Infinity); return m - sh.r; }
  const d = ringEdgeDist(x, y, sh.ring); return pointInRing([x, y], sh.ring) ? -d : d;
}
const toU = (b, F) => { const s = b.shape; return s.t === "circle" ? { t: "circle", c: F.toXY(s.c), r: s.r } : s.t === "poly" ? { t: "poly", ring: s.ring.map(F.toXY) } : { t: "stroke", pts: s.pts.map(F.toXY), r: s.r }; };
function bboxU(sh, pad) {
  const pts = sh.t === "circle" ? [sh.c] : sh.t === "poly" ? sh.ring : sh.pts, r = (sh.t === "poly" ? 0 : sh.r) + pad;
  return [Math.min(...pts.map(p => p[0])) - r, Math.min(...pts.map(p => p[1])) - r, Math.max(...pts.map(p => p[0])) + r, Math.max(...pts.map(p => p[1])) + r];
}

/* Apply one op to `G` (a Float32Array on grid g) in place. Returns { cut, fill } in m3 for this op alone (gross: what it removed and what it added). */
function applyOp(G, g, b, F) {
  const sh = toU(b, F), reach = Math.max(b.soft || 0, b.op === "terrace" ? b.skirt : 0, b.op === "pond" ? b.h * 2 : 0);
  const [bx0, by0, bx1, by1] = bboxU(sh, reach);
  const c0 = Math.max(0, Math.floor((bx0 - g.x0) / g.res)), c1 = Math.min(g.w - 1, Math.ceil((bx1 - g.x0) / g.res));
  const r0 = Math.max(0, Math.floor((g.y1 - by1) / g.res)), r1 = Math.min(g.h - 1, Math.ceil((g.y1 - by0) / g.res));
  const cells = [];   // [index, signed distance from the edge]
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
    const d = sdf(sh, g.x0 + (c + 0.5) * g.res, g.y1 - (r + 0.5) * g.res);
    if (d <= reach) cells.push([r * g.w + c, d, r, c]);
  }
  const inside = cells.filter(x => x[1] <= 0);
  let level = b.level;
  if (b.op === "flatten" || b.op === "terrace") { if (level == null) level = (inside.length ? inside.reduce((a, x) => a + G[x[0]], 0) / inside.length : 0) + (b.rel || 0); }
  const before = new Float32Array(cells.length); cells.forEach((x, i) => { before[i] = G[x[0]]; });
  const wt = d => d <= 0 ? 1 : (b.soft ? Math.max(0, 1 - d / b.soft) : 0);
  if (b.op === "raise" || b.op === "lower") for (const [i, d] of cells) { const w = wt(d); if (w) G[i] += (b.op === "raise" ? 1 : -1) * b.h * w; }
  else if (b.op === "flatten") for (const [i, d] of cells) { const w = wt(d); if (w) G[i] += (level - G[i]) * w; }
  else if (b.op === "terrace") for (const [i, d] of cells) { const w = d <= 0 ? 1 : b.skirt ? Math.max(0, 1 - d / b.skirt) : 0; if (w) G[i] += (level - G[i]) * w; }
  else if (b.op === "pond") {
    const band = Math.max(0.2, b.h * 2);   // a 1:2 bank
    for (const [i, d] of cells) { if (d > 0) continue; const k = Math.min(1, -d / band); G[i] -= b.h * k * k * (3 - 2 * k); }
  } else if (b.op === "smooth") {
    for (let pass = 0; pass < 3; pass++) {
      const snap = Float32Array.from(G);
      for (const [i, d, r, c] of cells) {
        const w = wt(d) * (b.k ?? 0.6); if (!w || r < 1 || c < 1 || r >= g.h - 1 || c >= g.w - 1) continue;
        let sum = 0; for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) sum += snap[i + dr * g.w + dc];
        G[i] += (sum / 9 - G[i]) * w;
      }
    }
  }
  let cut = 0, fill = 0; const a = g.res * g.res;
  cells.forEach(([i], k) => { const dz = G[i] - before[k]; if (dz < 0) cut -= dz * a; else fill += dz * a; });
  return { cut, fill };
}

/* The surface with the builds applied in order, or the same object when there is nothing to apply.
   `surf` (the top of trees and roofs) rides on the moved ground. Returns { ...s, ground, surf, builds: {cut, fill, net, ops: [{id, cut, fill}]} }. */
export function designedSurface(s, builds, F = METRES) {
  const list = (builds || []).map(b => normalizeBuild(b, F)).filter(b => b && !b.off);
  if (!list.length || !s?.ground) return s;
  const G = Float32Array.from(s.ground), ops = [];
  for (const b of list) ops.push({ id: b.id, op: b.op, ...applyOp(G, s.g, b, F) });
  let cut = 0, fill = 0; const a = s.g.res * s.g.res, surf = s.surf ? Float32Array.from(s.surf) : null;
  for (let i = 0; i < G.length; i++) { const dz = G[i] - s.ground[i]; if (dz < 0) cut -= dz * a; else fill += dz * a; if (surf) surf[i] += dz; }
  return { ...s, ground: G, ...(surf ? { surf } : {}), builds: { cut, fill, net: fill - cut, tippers: Math.ceil(Math.max(cut, fill) / TIPPER_M3), ops } };
}

