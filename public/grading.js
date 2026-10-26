/* The ground as a builder moves it, in the after (U3616, Morten 2026-10-26 10:38Z: «the water on the swimming pool … is
   not flat … dig swimming pool hole, move earth around buildings like a builder would do»). The rules are renderkit's
   (grade.js: the batter, the balance, the basin), the terrain sampler fit.js's groundAt; this lays them on the after's
   own copy of the terrain grid, so 3D, Gateplan, Plan, the server's pictures and the IFC all stand on the changed ground.

   { kind: "ground", ring, kote?, fall?, fall_toward?, edge?, slope?, name?, why? }
        the ground inside ring set to kote (default: where its cut and fill are the same), falling 1:fall toward
        fall_toward (N, Ø, S, V) from its middle when fall is given; outside it a batter of 1:slope (default 1:2) to the
        ground, or with edge "wall" the ground outside stays and a retaining wall takes the step. Its id is terreng-1, …:
        reshape changes it, demolish takes it away.
   A water surface (landscape.js) lies flat at its own level: a pond at the lowest ground on its edge (kote: another),
   dug depth deep (default 0,6 m) where the ground inside is higher; a pool (pool: true) is a dug basin depth deep
   (default 1,4 m) under its coping (coping m wide, default 0,3) at kote (default: balanced), on a level surround of
   1 m with a batter to the ground, the water 15 cm under the coping.

   What it makes: site.grading [{ id, kind: "ground", name, ring, kote, fall, fall_toward, edge, slope, area_m2, cut_m3,
   fill_m3, max_cut, max_fill, reach_m, wall_m?, lot_wall?, trees?, balanced, plane }], and on each water surface
   level and basin { kote, bottom?, depth, coping?, cut_m3, fill_m3, hole_m3?, … }. The cells outside the lot stay as
   they are (the neighbour's ground): the step there is lot_wall. */
import { gradeRing, balanceKote, planeZ, rootsHit, cellsIn, SLOPE } from "./renderkit/grade.js";
import { offsetRing, ringArea } from "./renderkit/paths2d.js";
import { groundAt } from "./renderkit/fit.js";

export const POOL = { depth: 1.4, coping: 0.3, surround: 1, freeboard: 0.15 }, POND_DEPTH = 0.6;
export const COMPASS = { N: [0, 1], "Ø": [1, 0], S: [0, -1], V: [-1, 0] };
export const TERRAIN_ID = /^terreng-\d+$/;

/* the cells of the terrain inside the lot (site.lot.ring), or null when there is no lot; made once a grid and lot */
const lotKept = new Map();
export function lotCells(site) {
  const T = site.terrain, ring = site.lot?.ring; if (!T?.z || !(ring?.length > 2)) return null;
  const key = `${T.x0},${T.y1},${T.res},${T.w},${T.h}:${ring.length}:${ring.flat().join(",")}`;
  if (!lotKept.has(key)) { if (lotKept.size > 4) lotKept.clear(); lotKept.set(key, cellsIn(T, ring)); }
  return lotKept.get(key);
}
const centre = r => r.reduce((a, p) => [a[0] + p[0] / r.length, a[1] + p[1] / r.length], [0, 0]);
/* points along a ring's edge, about a metre apart */
const along = r => r.flatMap((a, i) => { const b = r[(i + 1) % r.length], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]))); return Array.from({ length: n }, (_, j) => [a[0] + (b[0] - a[0]) * j / n, a[1] + (b[1] - a[1]) * j / n]); });
const span = (site, r) => { const zs = [...along(r), centre(r)].map(p => groundAt(site, p)); return [Math.min(...zs), Math.max(...zs)]; };
const r2 = v => Math.round(v * 100) / 100;

export function applyGrading(site, edits) {
  const specs = []; let n = 0;
  for (const e of edits) {
    if (e.kind === "ground") specs.push({ ...e, id: `terreng-${++n}` });
    else if (e.kind === "demolish" && TERRAIN_ID.test(e.building)) { const i = specs.findIndex(s => s.id === e.building); if (i >= 0) specs.splice(i, 1); }
    else if (e.kind === "reshape" && TERRAIN_ID.test(e.id)) { const s = specs.find(x => x.id === e.id); if (s) { const { kind, id, ...set } = e; Object.assign(s, set); } }
  }
  const waters = (site.landscape || []).filter(g => g.kind === "surface" && g.surface === "water");
  if (!site.terrain?.z || !specs.length && !waters.length) return;
  site.terrain = { ...site.terrain, z: site.terrain.z.slice() };
  const T = site.terrain, lot = lotCells(site), keep = lot ? { has: i => !lot.has(i) } : null;
  site.grading = specs.map(s => {
    const ring = s.ring, at = centre(ring), fall = s.fall ? { toward: COMPASS[s.fall_toward || "S"], per: s.fall } : null, edge = s.edge || "batter", slope = s.slope || SLOPE;
    const spec = k => ({ ring, z: planeZ({ kote: k, at, fall }), edge, slope, keep });
    const [lo, hi] = span(site, ring);
    const kote = s.kote ?? balanceKote(k => { const g = gradeRing(T, spec(k), false); return g.cut_m3 - g.fill_m3; }, lo, hi);
    const g = gradeRing(T, spec(kote)), trees = rootsHit(T, site.trees, g.moved);
    return { id: s.id, kind: "ground", name: s.name || "Planert flate", ring, kote: r2(kote), ...(fall ? { fall: s.fall, fall_toward: s.fall_toward || "S" } : {}), edge, slope, area_m2: Math.round(Math.abs(ringArea(ring)) * 10) / 10,
      cut_m3: g.cut_m3, fill_m3: g.fill_m3, max_cut: g.max_cut, max_fill: g.max_fill, reach_m: g.reach_m, ...(edge === "wall" && Math.abs(g.edge_step) >= 0.05 ? { wall_m: r2(Math.abs(g.edge_step)) } : {}),
      ...(Math.abs(g.kept_step) >= 0.05 ? { lot_wall: g.kept_step } : {}), ...(trees ? { trees } : {}), balanced: s.kote == null, plane: { kote, at, fall }, ...(s.why ? { why: s.why } : {}) };
  });
  if (!site.grading.length) delete site.grading;
  for (const w of waters) {
    if (w.pool) {
      const coping = w.coping ?? POOL.coping, depth = w.depth ?? POOL.depth, pad = offsetRing(w.ring, coping + POOL.surround), [lo, hi] = span(site, pad);
      const kote = w.kote ?? balanceKote(k => { const g = gradeRing(T, { ring: pad, z: k, keep }, false); return g.cut_m3 - g.fill_m3; }, lo, hi);
      const g = gradeRing(T, { ring: pad, z: kote, hole: { ring: w.ring, z: kote - depth }, keep }), trees = rootsHit(T, site.trees, g.moved), hole = Math.round(Math.abs(ringArea(w.ring)) * depth);
      w.level = r2(kote - POOL.freeboard);
      w.basin = { kote: r2(kote), bottom: r2(kote - depth), depth, coping, surround: POOL.surround, cut_m3: g.cut_m3 + hole, fill_m3: g.fill_m3, hole_m3: hole, max_cut: g.max_cut, max_fill: g.max_fill, reach_m: g.reach_m,
        ...(Math.abs(g.kept_step) >= 0.05 ? { lot_wall: g.kept_step } : {}), ...(trees ? { trees } : {}), balanced: w.kote == null };
    } else {
      const depth = w.depth ?? POND_DEPTH, level = w.kote ?? Math.min(...along(w.ring).map(p => groundAt(site, p)));
      const g = gradeRing(T, { ring: w.ring, z: level - depth, lower: true, edge: "none" }), trees = rootsHit(T, site.trees, g.moved);
      w.level = r2(level);
      w.basin = { kote: r2(level), depth, cut_m3: g.cut_m3, fill_m3: 0, ...(trees ? { trees } : {}) };
    }
  }
}

/* in words, for the pane and for Anton */
const m1 = v => String(Math.round(v * 10) / 10).replace(".", ","), m3 = v => Math.round(v).toLocaleString("nb-NO"), SIDE = { N: "nord", "Ø": "øst", S: "sør", V: "vest" };
const treesText = t => t ? ` ${t.count === 1 ? "Ett tre står" : `${t.count} trær står`} der bakken flyttes mer enn 20 cm (opptil ${m1(t.deepest)} m): felles, eller rotsonen sikres.` : "";
const lotText = v => v ? ` Skråningen når tomtegrensen: terrenget utenfor blir som det er, og en mur på ${m1(Math.abs(v))} m tar opp forskjellen.` : "";
export function gradingText(g) {
  if (!g) return "";
  return `${g.name}: planeres på kote +${m1(g.kote)}${g.balanced ? " (der utgraving og fylling går opp i opp)" : ""}${g.fall ? `, med fall 1:${g.fall} mot ${SIDE[g.fall_toward]}` : ""}; `
    + (g.edge === "wall" ? `en støttemur rundt kanten tar opp forskjellen${g.wall_m ? `, opptil ${m1(g.wall_m)} m` : ""}.` : `skråning 1:${g.slope} ut til terrenget${g.reach_m ? `, opptil ${m1(g.reach_m)} m ut` : ""}.`)
    + ` Utgraving ${m3(g.cut_m3)} m³, fylling ${m3(g.fill_m3)} m³ (dypest skjæring ${m1(g.max_cut)} m, høyest fylling ${m1(g.max_fill)} m).` + lotText(g.lot_wall) + treesText(g.trees);
}
export function basinText(w) {
  const b = w?.basin; if (!b) return "";
  if (!w.pool) return `Vannet ligger flatt på kote +${m1(w.level)}, ${m1(b.depth)} m dypt; utgraving ${m3(b.cut_m3)} m³.` + treesText(b.trees);
  return `Bassenget graves ${m1(b.depth)} m dypt under kanten (${m1(b.coping)} m bred) på kote +${m1(b.kote)}${b.balanced ? ", der utgraving og fylling rundt går opp i opp" : ""}; vannet står flatt på kote +${m1(w.level)}. `
    + `Rundt det planeres ${m1(b.surround)} m på samme kote, med skråning 1:${SLOPE} til terrenget. Utgraving ${m3(b.cut_m3)} m³ (${m3(b.hole_m3)} m³ av det er bassenget), fylling ${m3(b.fill_m3)} m³.` + lotText(b.lot_wall) + treesText(b.trees);
}
