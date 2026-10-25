/* The street norms and the pure geometry of a cross-section, shared by the street drawing (streets3d.js) and an app's plan:
   road and path types (N100), fence types, road paint (N302), the surface presets, and crossSection(a) (carriageway, kerbs,
   pavements, shoulders, centre line, vertical faces, as offsets from the centreline). Pure: no three.js, no DOM.
   Moved from hagekart (U3530): the tables were public/norms.json (here as NORMS, the same data), the rest data.js and model.js. */
const NORMS = {
 "source": "N100 Veg- og gateutforming 2019; N302 Vegoppmerking 2021 (Statens vegvesen)",
 "roads": {
  "hage": {
   "no": "Hagesti",
   "kind": "path",
   "width": 1.4,
   "surface": "gravel",
   "kerb": false,
   "walk": "none",
   "approx": true
  },
  "gangsykkel": {
   "no": "Gang- og sykkelveg",
   "kind": "path",
   "width": 3,
   "surface": "asphalt",
   "kerb": false,
   "walk": "none",
   "shoulder": 0.25,
   "src": "N100 E.2 (3 m, grusskulder 0,25 m)"
  },
  "fortau": {
   "no": "Fortau",
   "kind": "path",
   "width": 2.5,
   "surface": "slabs",
   "kerb": true,
   "kerbH": 0.1,
   "walk": "none",
   "src": "N100 B.2, tabell B.1 (minst 2,5 m)"
  },
  "adkomst": {
   "no": "Adkomstveg",
   "kind": "road",
   "width": 3.5,
   "surface": "gravel",
   "kerb": false,
   "walk": "none",
   "approx": true
  },
  "boliggate": {
   "no": "Boliggate",
   "kind": "road",
   "width": 5.5,
   "surface": "asphalt",
   "kerb": true,
   "kerbH": 0.1,
   "walk": "both",
   "walkW": 2.5,
   "line": {
    "on": 1,
    "off": 3,
    "w": 0.1,
    "color": "#e3b81f"
   },
   "src": "N100 B (2 x 2,75 m, minst 4,5 m mellom kantstein, fortau 2,5 m, lav kantstein 4-10 cm); N302 tabell 3.1 (1 m / 3 m, 0,10 m, gul)"
  }
 },
 "fences": {
  "stakitt": {
   "no": "Stakitt (malt)",
   "kind": "fence",
   "form": "picket",
   "h": 1,
   "width": 0.1,
   "surface": "gravel",
   "post": 0.09,
   "gap": 2.4,
   "pitch": 0.12,
   "pw": 0.07,
   "color": "#efece4",
   "post_c": "#e6e2d8",
   "src": "approx"
  },
  "sprinkel": {
   "no": "Sprinkelgjerde",
   "kind": "fence",
   "form": "slats",
   "h": 1.2,
   "width": 0.1,
   "surface": "gravel",
   "post": 0.1,
   "gap": 2,
   "slats": 5,
   "color": "#8a6a48",
   "post_c": "#7a5c3e",
   "src": "approx"
  },
  "skjerm": {
   "no": "Plankegjerde / skjermvegg",
   "kind": "fence",
   "form": "boards",
   "h": 1.8,
   "width": 0.12,
   "surface": "gravel",
   "post": 0.1,
   "gap": 2,
   "pitch": 0.12,
   "pw": 0.115,
   "color": "#6b5640",
   "post_c": "#5b4834",
   "src": "approx"
  },
  "nett": {
   "no": "Nettinggjerde",
   "kind": "fence",
   "form": "mesh",
   "h": 1.2,
   "width": 0.08,
   "surface": "gravel",
   "post": 0.05,
   "gap": 2.5,
   "color": "#7f8488",
   "post_c": "#5f6468",
   "src": "approx"
  },
  "smijern": {
   "no": "Smijernsgjerde",
   "kind": "fence",
   "form": "bars",
   "spear": true,
   "h": 1.1,
   "width": 0.08,
   "surface": "gravel",
   "post": 0.05,
   "gap": 2,
   "pitch": 0.12,
   "color": "#26282b",
   "post_c": "#26282b",
   "src": "approx"
  },
  "mur": {
   "no": "Steinmur",
   "kind": "fence",
   "form": "wall",
   "h": 0.7,
   "width": 0.4,
   "surface": "gravel",
   "post": 0,
   "gap": 0.5,
   "color": "#8b867c",
   "post_c": "#9b968c",
   "src": "approx"
  }
 },
 "markings": {
  "src": "N302 2015",
  "zebra": {
   "bar": 0.5,
   "gap": 0.5
  },
  "colors": {
   "Hvit": "#f2f2ee",
   "Gul": "#e3b81f"
  }
 }
};

/* Roads and paths, from Norwegian standards (Statens vegvesen): N100 Veg- og gateutforming (2019 edition) and N302 Vegoppmerking (2021).
   Figures stated there: fortau at least 2.5 m (table B.1); low kerb 4-10 cm for 30-40 km/h streets with ÅDT < 4 000, 16-18 cm at bus stops,
   2 cm lowered at crossings; two-way street at least 4.5 m between kerbs, lane 2.75 m in the lowest design class; gang- og sykkelveg 3 m when
   it also serves as access, with a 0.25 m gravel shoulder each side; marking lines 0.10 m wide, yellow centre line, white edge line;
   kjørefeltlinje (type 1000) 1 m stripe / 3 m gap at up to 50 km/h, varsellinje on cycle paths 0.75 m / 0.25 m.
   Entries marked approx are our own defaults where the standards leave the choice open. */
/* Road paint from N302 Vegoppmerking 2015 (Statens vegvesen), read 2026-09-30, see hagekart docs/NORM-VEGOPPMERKING.md (metres).
   Gangfelt: white bars 0.50 m with 0.50 m gaps (§8.1). Dashes (paint / gap) by speed limit: yellow varsellinje 9/3 at 60-80 km/t, 3/1 at 50 or less;
   white kjørefeltlinje 3/9 at 60-80, 1/3 at 50 or less; cycle-lane separator 1/1. Some dash values are "likely": the handbook table was garbled. */
export const MARKINGS = {
  ...NORMS.markings,
  dash(color, pattern, type = "") {
    const fast = /over 50/.test(pattern || ""), yellow = color === "Gul";
    if (/sykkelfelt|1008/i.test(type)) return { on: 1, off: 1 };
    if (/heltrukket|sperre/i.test(pattern || type)) return { on: 1, off: 0 };
    return yellow ? (fast ? { on: 9, off: 3 } : { on: 3, off: 1 }) : (fast ? { on: 3, off: 9 } : { on: 1, off: 3 });
  },
};
export const NORM_SRC = NORMS.source;
/* Fence types common in Norway. Sizes are typical dimensions from builders' practice (approximate, src "approx"), not a standard:
   h height, thick = how thick the line is on the map, post = post section, gap = distance between posts. Rules on height and distance to the
   boundary are in plan- og bygningsloven / SAK10 (check the current text before you build). */
export const FENCE_TYPES = NORMS.fences;
export const ROAD_TYPES = NORMS.roads;

/* Path surfaces: thickness above the ground h, colour c (multiplies the app's texture), texture tile in metres, kerb colour. */
export const PATHS = { cobble: { h: 0.035, c: "#ffffff", tile: 1, kerb: "#9d978d" }, gravel: { h: 0.025, c: "#d8ccb0", tile: 1.2 }, slabs: { h: 0.03, c: "#ece8e0", tile: 1.2, kerb: "#b9b3a8" }, asphalt: { h: 0.03, c: "#ffffff", tile: 2, kerb: "#a9a7a2" }, sand: { h: 0.025, c: "#e7d6a5", tile: 1.5 } };

export function runs(sm, o0, o1, bad) {   // the stretches of the path where the ribbon between two offsets is clear
  if (!bad) return [sm];
  const om = (o0 + o1) / 2, out = []; let cur = [];
  for (const p of sm) { if ([o0, om, o1].some(o => bad(p.x - p.ty * o, p.y + p.tx * o))) { if (cur.length > 1) out.push(cur); cur = []; } else cur.push(p); }
  if (cur.length > 1) out.push(cur); return out;
}

export function nearestRoad(F, x, y) {
  let best = null;
  for (const r of F.streetCtx?.roads || []) for (let i = 0; i < r.pts.length - 1; i++) {
    const [ax, ay] = r.pts[i], [bx, by] = r.pts[i + 1], dx = bx - ax, dy = by - ay, l = Math.hypot(dx, dy) || 1, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (l * l))), cx = ax + dx * t, cy = ay + dy * t, d = Math.hypot(x - cx, y - cy);
    if (!best || d < best.d) best = { d, cx, cy, tx: dx / l, ty: dy / l, hw: r.hw };
  }
  return best;
}

/* What a path is made of. a.type picks a preset from the Norwegian standards (ROAD_TYPES); a's own fields override it. */
export function crossSection(a) {
  const T = ROAD_TYPES[a.type] || {}, key = PATHS[a.surface || T.surface] ? (a.surface || T.surface) : "gravel", K = PATHS[key], road = (a.kind || T.kind) === "road", w = a.width || T.width || 2, h = w / 2;
  const kerb = a.kerb ?? T.kerb ?? (road || !!K.kerb), walk = a.walk ?? T.walk ?? (road ? "both" : "none"), KH = a.kerbH || T.kerbH || 0.12, KW = 0.15, WALK = a.walkW || T.walkW || 2.5;
  const lineOn = a.line ?? (T.line ? true : a.type ? false : road), L = typeof a.line === "object" ? a.line : T.line || { on: 1, off: 3, w: 0.1, color: "#e3b81f" };
  const s = { K, key, surf: [-h, h, K.h], kerbs: [], walks: [], shoulders: [], line: lineOn && w >= 4 ? { ...L } : null, wallFaces: [] };
  for (const side of [-1, 1]) {   // -1 = right of the direction of travel, 1 = left
    const hasWalk = walk === "both" || (walk === "left" && side === 1) || (walk === "right" && side === -1);
    if (T.shoulder) s.shoulders.push([side * h, side * (h + T.shoulder), K.h - 0.005]);
    if (kerb || hasWalk) { s.kerbs.push([side * h, side * (h + KW), K.h + KH]); s.wallFaces.push([side * h, K.h, K.h + KH]); }
    if (hasWalk) { s.walks.push([side * (h + KW), side * (h + KW + WALK), K.h + KH]); s.wallFaces.push([side * (h + KW + WALK), -0.06, K.h + KH]); }
  }
  if (a.raise) { s.surf[2] = a.raise; s.wallFaces.push([-h, -0.06, a.raise], [h, -0.06, a.raise]); }   // a pavement: slabs at kerb height, edge faces down to the ground
  return s;
}
