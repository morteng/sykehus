/* The after's landscape: what is laid on the ground and planted, as changes like design.js's (the before's terrain and
   trees stay as they are). Points are [east, north] in metres from the site origin.

   { kind: "surface", ring, surface, name?, plants?, why? }
        an area laid as grass, meadow, planting (a bed), gravel, paving, asphalt or water; plants are hagekart ids
        (or Latin names) for a bed, listed, not drawn one by one
   { kind: "path", line, width?, surface?, name?, why? }
        a path or a road along line (2 or more points), width metres (default 2), gravel, paving, asphalt or wood
   { kind: "trees", species, points? | line + spacing?, height?, crown?, why? }
        trees or shrubs: species is hagekart's id (search_plants) or a Latin name; at points, or along line
        every spacing metres (default 8). Sized from hagekart's height and spread unless height and crown (the width)
        are given. A species banned in Norway is refused. points is a list of [east, north].
   { kind: "fell", ring, why? }
        the trees there today inside ring are taken down

   What they make (applyLandscape): site.landscape [{ id, kind, name, surface, ring, area_m2 | length_m, plants }],
   the new trees added to site.trees ([east, north, height, crown radius, form], as tools/trees.py writes them, with a
   sixth item, the species id or name, and a seventh, its planting's id), site.plantings [{ id: tre-1, species, name,
   latin, count, height, crown }] (each trees change, picked and changed or taken away by its id, U3569),
   site.planted [{ species, name, count }] and site.felled (how many). */
import { pointInRing as inRing, ringArea as signedArea, ringOf } from "./renderkit/paths2d.js";   // one copy (DRY 1, 2)
import { SIDE_KEYS } from "./renderkit/dirs.js";
import { PLANTS } from "./plants.js";

export const SURFACES = ["grass", "meadow", "planting", "gravel", "paving", "asphalt", "water"];
export const PATHS = ["gravel", "paving", "asphalt", "wood"];
const MAX_POINTS = 200, MAX_TREES = 300;
const BY_ID = new Map(PLANTS.map(p => [p.id, p])), BY_LA = new Map(PLANTS.filter(p => p.la).map(p => [p.la.toLowerCase(), p]));
/* for a species outside hagekart's list, a size by what it is (pm, 2026-10-25): a tree unless it says shrub */
const DEFAULT = { tree: { ht: 12, sp: 7, form: "round" }, conifer: { ht: 18, sp: 6, form: "cone" }, shrub: { ht: 2.5, sp: 2, form: "dome" } };

const pt = (v, what) => {
  if (!Array.isArray(v) || v.length !== 2) throw new Error(`${what} er [øst, nord] i meter fra tomtas origo`);
  const [x, y] = v.map(Number); if (![x, y].every(Number.isFinite) || Math.abs(x) > 500 || Math.abs(y) > 500) throw new Error(`${what} må ligge innen 500 m fra tomtas origo`);
  return [Math.round(x * 100) / 100, Math.round(y * 100) / 100];
};
const pts = (v, what, min) => {
  if (!Array.isArray(v) || v.length < min || v.length > MAX_POINTS) throw new Error(`${what} er ${min} til ${MAX_POINTS} punkter [øst, nord]`);
  return v.map((p, i) => pt(p, `${what}[${i}]`));
};
const num = (v, lo, hi, what, dflt) => {
  if (v == null) { if (dflt === undefined) throw new Error(`${what} mangler`); return dflt; }
  const x = +v; if (!Number.isFinite(x) || x < lo || x > hi) throw new Error(`${what} må være et tall mellom ${lo} og ${hi}`); return Math.round(x * 100) / 100;
};
const ringArea = r => Math.abs(signedArea(r));   // the m², either way round
const lineLength = l => l.slice(1).reduce((a, p, i) => a + Math.hypot(p[0] - l[i][0], p[1] - l[i][1]), 0);
const round1 = v => Math.round(v * 10) / 10;

/* a species as hagekart knows it, or a Latin name it does not; banned ones refused */
export function plantOf(s) {
  const k = String(s ?? "").trim(); if (!k) throw new Error("species mangler: hagekarts id (search_plants) eller et latinsk navn");
  const p = BY_ID.get(k.toLowerCase()) || BY_LA.get(k.toLowerCase());
  if (p?.banned) throw new Error(`${p.no} (${p.la}) er forbudt å plante i Norge.`);
  if (p) return p;
  if (!/^[A-Z][a-z]+( [a-z×-]+){0,3}$/.test(k)) throw new Error(`Kjenner ikke «${k}». Bruk hagekarts id fra search_plants, eller det latinske navnet (slekt og art).`);
  return { id: null, no: k, la: k, cat: "tree", ...DEFAULT.tree };
}

/* one landscape change, checked: its tidy form, or null when it is not one */
/* U3617: a surface is kept as its settings: the points given (ring), and how its corners go (radius: rounded with an arc
   of that many metres; smooth: a curve through the points); its outline is made from them, so one setting can change */
const outlineOf = (points, radius, smooth) => radius || smooth ? ringOf({ points, radius: radius || 0, smooth: !!smooth, step: 1 }).map(p => [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100]) : points;
function cornersOf(e, out) {
  if (e.radius != null) out.radius = num(e.radius, 0, 50, "Hjørneradien (radius, m)");
  if (e.smooth != null) { if (typeof e.smooth !== "boolean") throw new Error("smooth er true (en myk kurve gjennom punktene) eller false"); out.smooth = e.smooth; }
  return out;
}

export function checkLandscape(site, e, str) {
  const why = e.why == null ? undefined : str(e.why, 300, "Begrunnelsen"), w_ = why ? { why } : {};
  const name = (d) => e.name == null ? undefined : str(String(e.name), 80, "Navnet") || d;
  switch (e.kind) {
    case "surface": {
      const ring = pts(e.ring, "ring", 3), corners = cornersOf(e, {}), a = ringArea(outlineOf(ring, corners.radius, corners.smooth));
      if (a < 1 || a > 60000) throw new Error("Flaten må være mellom 1 og 60 000 m²");
      const surface = String(e.surface ?? ""); if (!SURFACES.includes(surface)) throw new Error(`surface er ${SURFACES.join(", ")}`);
      const out = { kind: "surface", ring, surface, ...corners, ...w_ }, n = name(); if (n) out.name = n;
      if (e.plants != null) { if (!Array.isArray(e.plants) || e.plants.length > 30) throw new Error("plants er en liste med høyst 30 arter"); out.plants = e.plants.map(p => { const q = plantOf(p); return q.id || q.la; }); }
      Object.assign(out, waterOf(e, surface));
      return out;
    }
    case "ground": {   // U3616: the ground set to a level (grading.js)
      const ring = pts(e.ring, "ring", 3), a = ringArea(ring);
      if (a < 4 || a > 20000) throw new Error("Flaten som planeres må være mellom 4 og 20 000 m²");
      return { kind: "ground", ring, ...groundOf(e), ...(name() ? { name: name() } : {}), ...w_ };
    }
    case "path": {
      const line = pts(e.line, "line", 2), L = lineLength(line); if (L < 1) throw new Error("Stien må være minst 1 m lang");
      const surface = String(e.surface ?? "gravel"); if (!PATHS.includes(surface)) throw new Error(`surface for en sti er ${PATHS.join(", ")}`);
      const out = { kind: "path", line, width: num(e.width, 0.5, 20, "Bredden", 2), surface, ...w_ }, n = name(); if (n) out.name = n;
      return out;
    }
    case "trees": {
      const p = plantOf(e.species), out = { kind: "trees", species: p.id || p.la, ...w_ };
      if (e.points != null) out.points = pts(e.points, "points", 1);
      else if (e.line != null) { out.line = pts(e.line, "line", 2); out.spacing = num(e.spacing, 1, 50, "Avstanden (spacing)", 8); }
      else throw new Error("Gi points (punktene) eller line (en linje å plante langs)");
      if (e.height != null) out.height = num(e.height, 0.3, 40, "Høyden");
      if (e.crown != null) out.crown = num(e.crown, 0.3, 30, "Kronebredden (crown)");
      if (treePoints(out).length > MAX_TREES) throw new Error(`Høyst ${MAX_TREES} trær i én endring`);
      return out;
    }
    case "fell": { const ring = pts(e.ring, "ring", 3); if (ringArea(ring) < 1) throw new Error("Området er for lite"); return { kind: "fell", ring, ...w_ }; }
  }
  return null;
}

/* U3616: a planed area's settings (grading.js), checked; each only when given */
const EDGES = ["batter", "wall"];
function groundOf(e) {
  const out = {};
  if (e.kote != null) out.kote = num(e.kote, -20, 200, "Koten");
  if (e.fall != null) out.fall = num(e.fall, 2, 500, "Fallet (1:fall)");
  if (e.fall_toward != null) { if (!SIDE_KEYS.includes(e.fall_toward)) throw new Error("fall_toward er N, Ø, S eller V"); out.fall_toward = e.fall_toward; }
  if (e.edge != null) { if (!EDGES.includes(e.edge)) throw new Error("edge er batter (skråning) eller wall (støttemur)"); out.edge = e.edge; }
  if (e.slope != null) out.slope = num(e.slope, 1, 10, "Skråningen (1:slope)");
  return out;
}
/* a water surface's settings: a pool (dug basin under a coping) or a pond, its depth and its kote */
function waterOf(e, surface) {
  const has = ["pool", "depth", "coping", "kote"].filter(k => e[k] != null);
  if (!has.length) return {};
  if (surface !== "water") throw new Error(`${has.join(", ")} gjelder bare vann (surface: water)`);
  const out = {};
  if (e.pool != null) out.pool = !!e.pool;
  if (e.depth != null) out.depth = num(e.depth, 0.2, 4, "Dybden");
  if (e.coping != null) out.coping = num(e.coping, 0, 1.5, "Kanten (coping)");
  if (e.kote != null) out.kote = num(e.kote, -20, 200, "Koten");
  return out;
}

/* a surface or a path by its id (flate-1, sti-2): changed (reshape) or taken away (demolish), U3569 (Morten 22:41Z «i
   can only select and manipulate buildings, not objects like the "pool"») */
export const GROUND_ID = /^(flate|sti|tre|terreng)-\d+$/;   // tre: a planting, the trees one change planted; terreng: a planed area (U3616)
export function checkGroundEdit(site, e, str) {
  const id = String(e.kind === "demolish" ? e.building ?? "" : e.id ?? "").trim(), all = [...(site.landscape || []), ...(site.plantings || []), ...(site.grading || [])], g = all.find(x => x.id === id);
  if (!g) { const ls = all.map(x => `«${x.id}»`).slice(0, 8); throw new Error(`Fant ikke «${id}» på bakken${ls.length ? ` (${ls.join(", ")})` : "; forslaget har ingen flater, stier eller trær ennå"}`); }
  const why = e.why == null ? undefined : str(e.why, 300, "Begrunnelsen"), w_ = why ? { why } : {};
  if (e.kind === "demolish") return { kind: "demolish", building: id, ...w_ };
  const out = { kind: "reshape", id };
  if (e.name != null) out.name = str(String(e.name), 80, "Navnet");
  if (g.kind === "ground") {
    Object.assign(out, groundOf(e));
    if (e.ring != null) { out.ring = pts(e.ring, "ring", 3); const a = ringArea(out.ring); if (a < 4 || a > 20000) throw new Error("Flaten som planeres må være mellom 4 og 20 000 m²"); }
  } else if (g.kind === "trees") {
    if (e.height != null) out.height = num(e.height, 0.3, 40, "Høyden");
    if (e.crown != null) out.crown = num(e.crown, 0.3, 30, "Kronebredden (crown)");
  } else if (g.kind === "surface") {
    if (e.surface != null) { if (!SURFACES.includes(String(e.surface))) throw new Error(`surface er ${SURFACES.join(", ")}`); out.surface = String(e.surface); }
    cornersOf(e, out);
    if (e.ring != null || out.radius != null || out.smooth != null) { if (e.ring != null) out.ring = pts(e.ring, "ring", 3); const a = ringArea(outlineOf(out.ring || g.points || g.ring, out.radius ?? g.radius, out.smooth ?? g.smooth)); if (a < 1 || a > 60000) throw new Error("Flaten må være mellom 1 og 60 000 m²"); }
    if (e.plants != null) { if (!Array.isArray(e.plants) || e.plants.length > 30) throw new Error("plants er en liste med høyst 30 arter"); out.plants = e.plants.map(p => { const q = plantOf(p); return q.id || q.la; }); }
    Object.assign(out, waterOf(e, out.surface || g.surface));
  } else {
    if (e.surface != null) { if (!PATHS.includes(String(e.surface))) throw new Error(`surface for en sti er ${PATHS.join(", ")}`); out.surface = String(e.surface); }
    if (e.line != null) { out.line = pts(e.line, "line", 2); if (lineLength(out.line) < 1) throw new Error("Stien må være minst 1 m lang"); }
    if (e.width != null) out.width = num(e.width, 0.5, 20, "Bredden");
  }
  if (Object.keys(out).length < 3) throw new Error("Si hva som skal endres");
  return Object.assign(out, w_);
}

function treePoints(e) {
  if (e.points) return e.points;
  const out = [], l = e.line; let carry = 0;
  for (let i = 1; i < l.length; i++) {
    const [a, b] = [l[i - 1], l[i]], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (let t = carry; t <= L + 1e-6; t += e.spacing) out.push([round1(a[0] + (b[0] - a[0]) * t / L), round1(a[1] + (b[1] - a[1]) * t / L)]);
    carry = (carry - L) % e.spacing; if (carry < 0) carry += e.spacing;
  }
  return out;
}
/* a path's outline: its line offset half the width to each side (mitred, the mitre held to 3 widths) */
export function pathRing(line, width) {
  const h = width / 2, L = [], R = [];
  for (let i = 0; i < line.length; i++) {
    const dir = j => { const a = line[Math.max(0, j)], b = line[Math.min(line.length - 1, j + 1)], d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / d, (b[1] - a[1]) / d]; };
    const d0 = dir(i - 1), d1 = dir(i), m = [d0[0] + d1[0], d0[1] + d1[1]], ml = Math.hypot(...m) || 1, t = [m[0] / ml, m[1] / ml];
    /* the mitre against a side that has a length: at the last point the next side is none (it made every path's end three widths wide) */
    const s = d1[0] || d1[1] ? d1 : d0, n = [-t[1], t[0]], k = Math.min(3, 1 / Math.max(0.33, n[0] * -s[1] + n[1] * s[0]));
    L.push([line[i][0] + n[0] * h * k, line[i][1] + n[1] * h * k]); R.push([line[i][0] - n[0] * h * k, line[i][1] - n[1] * h * k]);
  }
  return [...L, ...R.reverse()];
}

export function applyLandscape(site, edits) {
  /* n, nt: the ids given, so one taken away leaves the others' ids as they were; a planting's id has its own count, so
     the surfaces and paths keep the ids they had before plantings had any */
  let land = [], plantings = [], n = 0, nt = 0, felled = 0, trees = (site.trees || []).slice();
  for (const e of edits) {
    if (e.kind === "demolish" && /^tre-/.test(e.building)) { trees = trees.filter(t => t[6] !== e.building); plantings = plantings.filter(g => g.id !== e.building); }
    else if (e.kind === "demolish" && GROUND_ID.test(e.building)) land = land.filter(g => g.id !== e.building);
    else if (e.kind === "reshape" && /^tre-/.test(e.id)) {
      const g = plantings.find(x => x.id === e.id); if (!g) continue;
      if (e.height != null) g.height = e.height; if (e.crown != null) g.crown = e.crown; if (e.why != null) g.why = e.why;
      for (const t of trees) if (t[6] === e.id) { t[2] = g.height; t[3] = g.crown / 2; }
    }
    else if (e.kind === "reshape" && GROUND_ID.test(e.id)) {
      const g = land.find(x => x.id === e.id); if (!g) continue;
      for (const k of ["name", "surface", "plants", "pool", "depth", "coping", "kote", "why"]) if (e[k] != null) g[k] = e[k];
      if (g.kind === "surface" && (e.ring || e.radius != null || e.smooth != null)) { if (e.ring) g.points = e.ring; if (e.radius != null) g.radius = e.radius; if (e.smooth != null) g.smooth = e.smooth; g.ring = outlineOf(g.points, g.radius, g.smooth); g.area_m2 = round1(ringArea(g.ring)); }
      if (g.kind === "path" && (e.line || e.width != null)) { g.line = e.line || g.line; g.width = e.width ?? g.width; g.ring = pathRing(g.line, g.width); g.length_m = round1(lineLength(g.line)); g.area_m2 = round1(lineLength(g.line) * g.width); }
    }
    else if (e.kind === "surface") land.push({ id: `flate-${++n}`, kind: "surface", name: e.name || null, surface: e.surface, points: e.ring, ...(e.radius ? { radius: e.radius } : {}), ...(e.smooth ? { smooth: true } : {}), ring: outlineOf(e.ring, e.radius, e.smooth), area_m2: round1(ringArea(outlineOf(e.ring, e.radius, e.smooth))), plants: e.plants || [], ...Object.fromEntries(["pool", "depth", "coping", "kote"].filter(k => e[k] != null).map(k => [k, e[k]])), why: e.why });
    else if (e.kind === "path") land.push({ id: `sti-${++n}`, kind: "path", name: e.name || null, surface: e.surface, line: e.line, width: e.width, ring: pathRing(e.line, e.width), length_m: round1(lineLength(e.line)), area_m2: round1(lineLength(e.line) * e.width), why: e.why });
    else if (e.kind === "fell") { const n = trees.length; trees = trees.filter(t => !inRing(t, e.ring)); felled += n - trees.length; }
    else if (e.kind === "trees") {
      const p = plantOf(e.species), cat = p.cat === "conifer" ? "conifer" : /shrub|hedge|rose/.test(p.cat) ? "shrub" : "tree";
      const h = e.height ?? p.ht ?? DEFAULT[cat].ht, r = (e.crown ?? p.sp ?? DEFAULT[cat].sp) / 2, form = p.cat === "conifer" || /cone|pine|column/.test(p.form || "") ? "cone" : "round";
      const id = `tre-${++nt}`, at = treePoints(e); for (const [x, y] of at) trees.push([x, y, h, r, form, e.species, id]);
      plantings.push({ id, kind: "trees", species: e.species, name: p.no, latin: p.la || null, count: at.length, height: h, crown: Math.round(r * 200) / 100, why: e.why });
    }
  }
  if (!land.length && !n && !nt && !felled) return;
  const planted = new Map();
  for (const g of plantings) { const q = planted.get(g.species) || { species: g.species, name: g.name, latin: g.latin, count: 0 }; q.count += g.count; planted.set(g.species, q); }
  site.trees = trees; site.landscape = land; site.plantings = plantings; site.planted = [...planted.values()]; site.felled = felled;
}
