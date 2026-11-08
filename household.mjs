/* U3639: the household parts as plain volumes (garage, extension, dormer, winter garden, solar panels, roof types; a flat roof is the extension's).
   Each part is ONE volume from a length (from -> to) and a width, so it can stand on the ground or on a roof (on). Pure. */
const r2 = x => Math.round(x * 100) / 100;
const P = (def, min, max, say) => ({ type: "number", default: def, min, max, say });
const MATS = ["concrete", "brick", "steel", "wood", "glass"];
const pair = (v, what) => { if (!Array.isArray(v) || v.length !== 2 || !v.every(Number.isFinite)) throw new Error(`${what} er [øst, nord] i meter`); return v; };
function take(e, spec, defMat) {
  const p = e.params || {}, bad = Object.keys(p).filter(k => !(k in spec) && k !== "material");
  if (bad.length) throw new Error(`Delen ${e.part} tar ikke ${bad.join(", ")} (den tar ${[...Object.keys(spec), "material"].join(", ")})`);
  const out = {};
  for (const [k, s] of Object.entries(spec)) { const v = p[k] == null ? s.default : +p[k]; if (!Number.isFinite(v) || v < s.min || v > s.max) throw new Error(`${k} er et tall fra ${s.min} til ${s.max}`); out[k] = v; }
  const material = p.material ?? defMat; if (!MATS.includes(material)) throw new Error(`material er ${MATS.join(", ")}`);
  return { ...out, material };
}
/* one volume: the part's name, its shape and size, material; where it stands (base_kote, on) comes from the edit */
function one(e, name, spec, defMat, shape, size) {
  if (e.at != null) throw new Error(`Delen ${e.part} settes med from og to (delens lengde), ikke med at`);
  const f = pair(e.from, "from"), t = pair(e.to, "to"), L = Math.hypot(t[0] - f[0], t[1] - f[1]);
  if (L < 1) throw new Error("from til to må være minst 1 m");
  const p = take(e, spec, defMat), s = size(p);
  return [{ kind: "volume", shape: s.shape ?? shape, name: e.name ?? name, from: f, to: t, material: p.material, ...(e.group ? { group: e.group } : {}), ...(e.why ? { why: e.why } : {}),
    ...(e.on != null ? { on: e.on } : {}), ...(e.base_kote != null ? { base_kote: e.base_kote } : {}), width: s.width, height: r2(s.height), ...(s.wall_height != null ? { wall_height: r2(s.wall_height) } : {}) }];
}
const GARAGE = { width: P(3.6, 2.8, 8, "m across (a car: 3 m, two: 6 m)"), wall_height: P(2.5, 2.2, 4, "m, to the eaves"), ridge_height: P(3.7, 2.5, 6, "m, to the ridge (over the foot)") };
const EXT = { width: P(4, 2, 12, "m out from the house"), wall_height: P(2.6, 2.2, 6, "m, the low eaves (a flat roof: the whole height)"), roof: P(0, 0, 1, "0 = flat roof, 1 = a single slope (lean_to) rising 0.6 m") };
const DORMER = { width: P(2, 1, 5, "m deep up the roof"), cheek_height: P(1.4, 0.8, 3, "m, the dormer's walls"), ridge_height: P(2, 1.2, 4, "m, to its ridge") };
const WINTER = { width: P(3, 2, 8, "m out from the wall"), wall_height: P(2.4, 2.2, 4, "m, the glass walls"), ridge_height: P(3.2, 2.4, 6, "m, to the glass ridge") };
const SOLAR = { width: P(3.4, 1, 20, "m across (two panels of 1,7 m: 3,4 m)"), thickness: P(0.15, 0.05, 0.5, "m, the panels with their rack") };
const ROOF = { width: P(8, 2, 40, "m across the ridge"), rise: P(2.5, 0.3, 15, "m from the eaves to the ridge") };
const mk = (no, say, params, classes, defMat, run) => ({ no, say, params, classes, engine: "volumes", make: (e, site) => run(e) });
export const HOUSEHOLD = {
  garage: mk("Garasje", "A garage as one volume with a gable roof; from to to is its length, params.width its width", GARAGE, ["volumes"], "wood",
    e => one(e, "Garasje", GARAGE, "wood", "gable", p => { if (p.ridge_height <= p.wall_height) throw new Error("ridge_height må være over wall_height"); return { width: p.width, wall_height: p.wall_height, height: p.ridge_height }; })),
  extension: mk("Tilbygg", "An extension to a house as one volume with a flat or single-slope roof; from to to is the length along the wall, params.width how far it goes out", EXT, ["volumes"], "brick",
    e => one(e, "Tilbygg", EXT, "brick", "box", p => p.roof >= 0.5 ? { shape: "lean_to", width: p.width, wall_height: p.wall_height, height: p.wall_height + 0.6 } : { width: p.width, height: p.wall_height })),
  dormer: mk("Takkupe", "A dormer as one volume with a gable roof; put it on a roof with on = the wing; from to to is its width along the roof, params.width up the roof", DORMER, ["volumes"], "wood",
    e => one(e, "Takkupe", DORMER, "wood", "gable", p => { if (p.ridge_height <= p.cheek_height) throw new Error("ridge_height må være over cheek_height"); return { width: p.width, wall_height: p.cheek_height, height: p.ridge_height }; })),
  winter_garden: mk("Uterom (vinterhage)", "A winter garden: a glass volume with a gable roof against a wall; from to to is its length along the wall, params.width how far out", WINTER, ["volumes"], "glass",
    e => one(e, "Uterom", WINTER, "glass", "gable", p => { if (p.ridge_height <= p.wall_height) throw new Error("ridge_height må være over wall_height"); return { width: p.width, wall_height: p.wall_height, height: p.ridge_height }; })),
  solar_panels: mk("Solcellepanel", "A field of solar panels as one thin slab, e.g. on a roof (on = the wing); from to to is its length, params.width its width; each panel is about 1,7 × 1,1 m", SOLAR, ["volumes"], "glass",
    e => one(e, "Solcellepanel", SOLAR, "glass", "box", p => ({ width: p.width, height: p.thickness }))),
  roof_gable: mk("Saltak", "A saltak (gable roof) alone, to put on a building or a wall without a roof; from to to is the ridge line", ROOF, ["volumes"], "wood",
    e => one(e, "Saltak", ROOF, "wood", "gable", p => ({ width: p.width, wall_height: 0.1, height: p.rise + 0.1 }))),
  roof_hip: mk("Valmtak (pyramidetak)", "A hip (pyramid) roof alone: four slopes to one point over the middle", ROOF, ["volumes"], "wood",
    e => one(e, "Valmtak", ROOF, "wood", "pyramid", p => ({ width: p.width, height: p.rise }))),
  roof_shed: mk("Pulttak", "A single-slope roof alone (pulttak)", ROOF, ["volumes"], "wood",
    e => one(e, "Pulttak", ROOF, "wood", "lean_to", p => ({ width: p.width, wall_height: 0.1, height: p.rise + 0.1 }))),
};
