/* The "after": what one builds and takes away, as changes like those in edits.js (the before is never touched).

   { kind: "demolish", building, why? }     a wing (its name or id), a building's id, or "alle": every building of the hospital
   { kind: "restore", building, why? }      puts back what a demolish took (so "alle" and then the one to keep)
   { kind: "balconies", wing, side, from_storey?, to_storey?, depth?, bay?, gap?, railing?, why? }
        balconies on the wing's facades that face side (N, Ø, S or V): a slab at each storey's floor, depth metres out
        (default 1,8), along the whole wall or in bays bay metres wide with gap between (default 0,6), and a railing
        (glass, steel or concrete; default glass); storeys from_storey to to_storey (default all above the ground floor)
   { kind: "volume", name, shape, from, to, width, height, wall_height?, high_side?, base_kote?, material?, why? }
        a new building or structure: its ridge or middle line from -> to ([east, north], metres from the site origin),
        width across it, height to the top (from base_kote; default the lowest ground under it). shape box, gable
        (walls wall_height high, a ridge), triangle (an A frame, roof to the ground) or lean_to (a single slope,
        high on high_side, left or right as one walks from -> to). material glass (a greenhouse), concrete, steel,
        wood or brick. pyramid: four sloping faces to one top over the middle (from -> to is its length, width its
        breadth); terraces: steps (2–10) one on another, each step_depth metres (default 3) narrower than the one under
        it, kept flush on high_side (the back; left or right walking from -> to). on: a wing (its id or name) whose roof
        it stands on, so its foot is that roof's kote under its middle (a roof garden, a greenhouse on a roof). Optional: id (n and 4–12 letters or digits; the page gives one, so later changes can name it),
        storeys (1–30; the height then defaults to 3,2 m a storey), use, built, note: the facts its card shows.
        bim (U3570): a construction a script made (IfcOpenShell, in the worker): bim { script, params, sha, box, classes }
        is filled in by the server after the worker ran the script (mcp.mjs); from -> to only places and turns it (its
        middle and direction), its length, width and height are its box's.
   { kind: "reshape", id, name?, use?, built?, note?, storeys?, from?, to?, width?, height?, bim?, why? }   (U3556)
        changes a new building made by a volume: renames it, sets its facts, moves or resizes it (from, to, width),
        or makes it taller (storeys, height). A demolish naming its id takes it away again.

   What they make (applyDesign): site.added, each { id, kind, name, parts, footprint_m2, volume_m3 }, and
   site.demolished. A part is a profile [across, kote] extruded along an axis [[east, north], [east, north]]: across
   is metres to the left of the axis as one walks along it, so a box, a gable, a slope and a balcony slab are all one
   kind of thing, which the viewer draws and the IFC writes the same way. A pyramid is the one that is not: its part
   is its faces as triangles, tris [[[east, north, kote] × 3], …].

   The ground (surfaces, paths, trees, felling) is landscape.js's. */
import { checkLandscape, applyLandscape, checkGroundEdit, GROUND_ID } from "./landscape.js";
import { checkRoadEdit, applyRoads, ROAD_ID } from "./roads.js";   // a road section taken away (U3543)
import { batterZ, balanceKote, rootsHit, SLOPE, ROOT_M } from "./renderkit/grade.js";   // the one batter rule (U3616)
import { applyGrading, lotCells } from "./grading.js";
import { BAY, windowsOn, kindOf } from "./bays.js";   // the window bays (U3624)
import { fitOf, surfaceFit, groundAt, inRing, overlapArea } from "./renderkit/fit.js";   // renderkit (U3559): one copy for every app
export { fitOf, surfaceFit, groundAt };

import { SIDES, SIDE_KEYS, SIDE_WORD, bearingOf, turn, norm360 } from "./renderkit/dirs.js";   // one copy of directions (DRY 5)
import { BUILDING as MATERIALS } from "./renderkit/materials.js";   // glass, concrete, steel, wood, brick (U3618)
import { segDist, ringArea } from "./renderkit/paths2d.js";   // one copy (DRY 2)
export const SHAPES = ["box", "gable", "triangle", "lean_to", "pyramid", "terraces", "bim"];
export const STOREY_M = 3.2;   // a new building's storey, floor to floor
const NID = /^n[A-Za-z0-9]{4,12}$/;
/* a new building's id: the one asked for when it has the form (n and 4–12 letters or digits) and is free; else one made
   from it that has and is (pm 23:31Z: Anton's «takhage1» was refused four times over a rule it could not see). A new
   thing is never refused over its id; the result's added says the id it got. */
export function freeId(asked, site) {
  const taken = new Set([...(site.added || []).map(a => a.id), ...(site.buildings || []).map(b => b.id)]);
  if (NID.test(asked) && !taken.has(asked)) return asked;
  let core = asked.normalize("NFKD").replace(/[^A-Za-z0-9]/g, "");
  if (core.startsWith("n")) core = core.slice(1);
  core = core.slice(0, 12); if (core.length < 4) core = (core + "nytt").slice(0, 4);
  let id = "n" + core;
  for (let k = 2; taken.has(id); k++) id = "n" + core.slice(0, 12 - String(k).length) + k;
  return id;
}
/* a construction's script and what it made, as the server filled it in: checked for form here (the server ran it) */
function bimOf(b) {
  /* a file brought in (U3571): no script, its sha the file's; where it came from and its licence go on its card */
  if (b && typeof b === "object" && b.file != null) {
    if (!/^[0-9a-f]{64}$/.test(String(b.file)) || b.sha !== b.file) throw new Error("Fila er ikke lastet opp ennå: serveren leser den først");
    const mn = b.box?.min, mx = b.box?.max; if (![mn, mx].every(v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite))) throw new Error("Fila har ingen form");
    const t = (v, n) => v == null ? undefined : String(v).slice(0, n);
    return { file: b.file, sha: b.file, script: null, params: {}, box: { min: mn, max: mx }, ...(b.classes ? { classes: b.classes } : {}), filename: t(b.filename, 120), ...(/^(step|glb|gltf|obj|stl|dxf|dwg)$/.test(b.format || "") ? { format: b.format } : {}), ...(b.format === "dxf" || b.format === "dwg" ? { plan: true } : {}), ...(b.source ? { source: t(b.source, 300) } : {}), licence: t(b.licence, 120) };
  }
  if (!b || typeof b !== "object" || typeof b.script !== "string" || !b.script.trim() || b.script.length > 100000) throw new Error("bim er { script, params } fra serveren: skriptet mangler");
  if (!/^[0-9a-f]{64}$/.test(String(b.sha))) throw new Error("Konstruksjonen er ikke bygget ennå: serveren kjører skriptet først");
  const params = {}; for (const [k, v] of Object.entries(b.params || {})) { if (!/^[A-Za-z_][A-Za-z0-9_]{0,30}$/.test(k) || !Number.isFinite(+v)) throw new Error(`Parameteren «${k}» må ha et navn av bokstaver og et tall`); params[k] = +v; }
  if (Object.keys(params).length > 30) throw new Error("Høyst 30 parametre");
  const mn = b.box?.min, mx = b.box?.max; if (![mn, mx].every(v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite))) throw new Error("Konstruksjonen har ingen form");
  return { script: b.script, params, sha: b.sha, box: { min: mn, max: mx }, ...(b.classes ? { classes: b.classes } : {}) };
}
/* where a construction's own points go on the site: its box's middle on plan to the middle of from -> to, its x along
   from -> to, its foot (the box's bottom) at base. local [x, y, z] → [east, north, kote] */
export function bimPlace(e, base) {
  const { min, max } = e.bim.box, bc = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2], c = [(e.from[0] + e.to[0]) / 2, (e.from[1] + e.to[1]) / 2];
  const a = Math.atan2(e.to[1] - e.from[1], e.to[0] - e.from[0]), k = Math.cos(a), s = Math.sin(a);
  return ([x, y, z]) => { const u = x - bc[0], v = y - bc[1]; return [c[0] + u * k - v * s, c[1] + u * s + v * k, base + z - min[2]]; };
}
/* from -> to as long as the box and through the same middle and direction; width and height the box's */
export function bimBody(from, to, box) {
  const L = Math.max(1, box.max[0] - box.min[0]), c = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2], d = Math.hypot(to[0] - from[0], to[1] - from[1]) || 1, u = [(to[0] - from[0]) / d, (to[1] - from[1]) / d], r = v => Math.round(v * 100) / 100;
  return { from: [r(c[0] - u[0] * L / 2), r(c[1] - u[1] * L / 2)], to: [r(c[0] + u[0] * L / 2), r(c[1] + u[1] * L / 2)], width: r(Math.max(1, box.max[1] - box.min[1])), height: r(Math.max(1, box.max[2] - box.min[2])) };
}
/* where a new building's foot stands: on a wing's roof (on), at a kote (base_kote), else on the ground under it */
function footOf(site, e, out, num) {
  if (e.on != null) {
    const k = String(e.on).toLowerCase().trim(), w = (site.wings || []).find(x => x.id === k || x.name.toLowerCase() === k);
    if (!w) throw new Error(`on er en fløy som står (${(site.wings || []).map(x => x.name).join(", ")})`);
    out.on = w.id; if (roofUnder(site, out) == null) throw new Error(`Midten av ${out.name} står ikke på taket til ${w.name}: flytt from og to så midten er innenfor fløyen`);
  } else if (e.base_kote != null) out.base_kote = num(e.base_kote, 0, 120, "Koten for foten (base_kote)");
  return out;
}
/* the facts a new building's card shows, checked (volume and reshape alike) */
function facts(e, str, out) {
  if (e.use != null) out.use = str(String(e.use), 80, "Bruken");
  if (e.built != null) out.built = str(String(e.built), 40, "Byggeåret");
  if (e.note != null) out.note = str(String(e.note), 600, "Merknaden");
  /* U3566 (b): the side of its step-free entrance (N, Ø, S, V); "" or null takes it away */
  if (e.entrance !== undefined) {
    const k = e.entrance == null ? "" : String(e.entrance).trim().toUpperCase().replace(/^(O|E|ØST|OST|EAST)$/, "Ø").replace(/^(W|VEST|WEST)$/, "V").replace(/^(NORD|NORTH)$/, "N").replace(/^(SØR|SOR|SOUTH)$/, "S");
    if (k && !SIDE_KEYS.includes(k)) throw new Error("entrance er siden inngangen vender mot: N, Ø, S eller V");
    out.entrance = k || null;
  }
  if (e.storeys != null) { const n = +e.storeys; if (!Number.isInteger(n) || n < 1 || n > 30) throw new Error("Etasjene er et helt tall fra 1 til 30"); out.storeys = n; }
  return out;
}
const num = (v, lo, hi, what, dflt) => {
  if (v == null) { if (dflt === undefined) throw new Error(`${what} mangler`); return dflt; }
  const x = +v; if (!Number.isFinite(x) || x < lo || x > hi) throw new Error(`${what} må være et tall mellom ${lo} og ${hi}`); return Math.round(x * 100) / 100;
};
const pt = (v, what) => {
  if (!Array.isArray(v) || v.length !== 2) throw new Error(`${what} er [øst, nord] i meter fra tomtas origo`);
  const [x, y] = v.map(Number); if (![x, y].every(Number.isFinite) || Math.abs(x) > 500 || Math.abs(y) > 500) throw new Error(`${what} må ligge innen 500 m fra tomtas origo`);
  return [Math.round(x * 100) / 100, Math.round(y * 100) / 100];
};

/* the buildings a demolish names: a wing's pieces, one building, or all the hospital's */
export function targets(site, key) {   // on a model where some are torn down already, those count too (a restore names them)
  const k = String(key ?? "").toLowerCase().trim(), was = site.demolished || [];
  if (k === "alle" || k === "all") return [...site.buildings.filter(b => b.own), ...was.filter(d => d.own)].map(b => b.id);
  const w = [...(site.wings || []), ...(site.wings_gone || [])].find(x => x.id === k || x.name.toLowerCase() === k || (x.aliases || []).some(a => a.toLowerCase() === k));
  if (w) return [...site.buildings, ...was].filter(b => b.wing === w.id).map(b => b.id);
  const b = [...site.buildings, ...was].find(x => String(x.id).toLowerCase() === k);
  if (b) return [b.id];
  throw new Error(`Fant ikke «${key}». Bruk en fløy (${(site.wings || []).map(x => x.name).join(", ")}), en bygnings id eller «alle»`);
}

/* one of the after's changes, checked: its tidy form, or an error that says what is wrong (in Norwegian, for the agent to pass on) */
export function checkDesign(site, e, str) {
  const why = e.why == null ? undefined : str(e.why, 300, "Begrunnelsen"), w_ = why ? { why } : {};
  switch (e.kind) {
    case "demolish": case "restore": {
      const k = String(e.building ?? "").trim();
      if (e.kind === "demolish" && GROUND_ID.test(k)) return checkGroundEdit(site, e, str);   // a surface or a path, by its id
      if (ROAD_ID.test(k)) return checkRoadEdit(e, str);   // a road section, by its way's id (U3543)
      if (!(e.kind === "demolish" && (site.added || []).some(a => a.id === k))) targets(site, e.building);   // a new building, by its id, goes the same way
      return { kind: e.kind, building: k, ...w_ };
    }
    case "reshape": {
      const id = String(e.id ?? ""), a = (site.added || []).find(x => x.id === id && x.kind === "volume");
      if (GROUND_ID.test(id)) return checkGroundEdit(site, e, str);
      /* teaches what reshape is for (21:22Z: «reshape» id «basseng» was meant as a new pool) */
      if (!a) { const n = (site.added || []).filter(x => x.kind === "volume"); throw new Error(`Fant ikke det nye bygget «${e.id}». reshape endrer et nytt bygg som alt står i forslaget${n.length ? ` (${n.slice(0, 8).map(x => `«${x.id}»`).join(", ")})` : "; forslaget har ingen nye bygg ennå"}. Et nytt bygg er kind volume; et basseng, en plass eller en plen er kind surface (surface: "water" for vann) med ring.`); }
      const out = facts(e, str, { kind: "reshape", id });
      if (e.name != null) out.name = str(String(e.name), 80, "Navnet");
      if (e.from != null) out.from = pt(e.from, "from"); if (e.to != null) out.to = pt(e.to, "to");
      const f = out.from || a.from, t = out.to || a.to, L = Math.hypot(t[0] - f[0], t[1] - f[1]), maxL = a.bim?.plan ? 1000 : 250; if (L < 1 || L > maxL) throw new Error(`Lengden må være mellom 1 og ${maxL} m`);
      if (a.shape === "bim") {
        /* a construction's size is its script's: its parameters change it (the server runs it again and sends bim) */
        if (e.bim != null) out.bim = bimOf(e.bim);
        if (e.params != null && e.bim == null) throw new Error("Parametrene kjøres av serveren: send reshape med params gjennom try_change");
        if (e.width != null && Math.abs(+e.width - a.width) > 0.05 || e.height != null && Math.abs(+e.height - a.height) > 0.05 || e.storeys != null) throw new Error(`${a.name} får størrelsen fra skriptet: endre parametrene (${Object.keys(a.bim?.params || {}).join(", ") || "params"}) i stedet for bredde og høyde`);
        if (out.from || out.to || out.bim) Object.assign(out, bimBody(out.from || a.from, out.to || a.to, (out.bim || a.bim).box));
      } else {
        if (e.width != null) out.width = num(e.width, 1, 120, "Bredden");
        if (e.height != null) out.height = num(e.height, 1, 80, "Høyden");
      }
      if (Object.keys(out).length < 3) throw new Error("Si hva som skal endres");
      return Object.assign(out, w_);
    }
    case "balconies": {
      const w = (site.wings || []).find(x => x.id === String(e.wing ?? "").toLowerCase().trim() || x.name.toLowerCase() === String(e.wing ?? "").toLowerCase().trim());
      if (!w) throw new Error(`Ukjent fløy «${e.wing}»`);
      const side = e.side == null && e.face != null ? SIDE_KEYS[Math.round(norm360(+e.face) / 90) % 4] : String(e.side ?? "").toUpperCase().replace("O", "Ø");
      if (!SIDES[side]) throw new Error("side er N, Ø, S eller V: fasaden balkongene vender mot (eller face: retningen i grader)");
      const names = (w.levels || []).map(l => l.name), storey = (s, what) => { if (s == null) return undefined; const n = /^\d+$/.test(String(s).trim()) ? `${String(s).trim()}. etasje` : String(s).trim(); if (!names.includes(n)) throw new Error(`${what}: ${w.name} har ikke «${n}» (har ${names.join(", ")})`); return n; };
      const out = { kind: "balconies", wing: w.id, side, depth: num(e.depth, 0.8, 4, "Dybden", 1.8), railing: e.railing == null ? "glass" : String(e.railing), ...w_ };
      if (!["glass", "steel", "concrete"].includes(out.railing)) throw new Error("railing er glass, steel eller concrete");
      const f = storey(e.from_storey, "from_storey"), t = storey(e.to_storey, "to_storey"); if (f) out.from_storey = f; if (t) out.to_storey = t;
      if (e.face != null) { const fs = facadesOf(site, w.id), d = num(e.face, 0, 360, "face (retningen fasaden vender, grader fra nord)") % 360; if (!fs.some(x => turn(x.bearing, d) <= 20)) throw new Error(`${w.name} har ingen fasade som vender ${d}°. Fasadene vender ${fs.map(x => `${x.bearing}° (${String(x.length_m).replace(".", ",")} m)`).join(", ")}`); out.face = d; }
      else faceFor(site, w, side);
      if (e.windows) { out.windows = true; if (e.bay != null) out.bay = num(e.bay, 1, 2.4, "Bredden på hver balkong (bay; høyst 2,4 m med én per vindu, 2,5 m mellom vinduene)"); }
      else if (e.bay != null) { out.bay = num(e.bay, 1.5, 20, "Bredden på hver balkong (bay)"); out.gap = num(e.gap, 0, 10, "Mellomrommet (gap)", 0.6); }
      if (!balconyParts(site, out).length) throw new Error(`${w.name} har ingen fasade mot ${side} der balkongene kan stå (eller ingen etasjer i det valgte spennet)`);
      return out;
    }
    case "volume": {
      const shape = String(e.shape ?? "box"); if (!SHAPES.includes(shape)) throw new Error(`shape er ${SHAPES.join(", ")}`);
      const material = String(e.material ?? "glass"); if (!MATERIALS.includes(material)) throw new Error(`material er ${MATERIALS.join(", ")}`);
      const from = pt(e.from, "from"), to = pt(e.to, "to"), L = Math.hypot(to[0] - from[0], to[1] - from[1]);
      /* a plan brought in (DXF, DWG) may be a whole quarter's: to 1 km */
      const maxL = /^(dxf|dwg)$/.test(e.bim?.format || "") ? 1000 : 250; if (L < 1 || L > maxL) throw new Error(`Fra from til to må være mellom 1 og ${maxL} m`);
      const out = facts(e, str, { kind: "volume", ...(e.id != null ? { id: String(e.id) } : {}), name: str(String(e.name ?? (material === "glass" ? "Drivhus" : "Nybygg")), 80, "Navnet"), shape, from, to, material });
      if (out.id) out.id = freeId(out.id, site);
      if (shape === "bim") { out.bim = bimOf(e.bim); Object.assign(out, bimBody(from, to, out.bim.box), w_); return footOf(site, e, out, num); }
      out.width = num(e.width, 1, 120, "Bredden"); out.height = num(e.height ?? (out.storeys ? out.storeys * STOREY_M : undefined), 1, 80, "Høyden"); Object.assign(out, w_);
      if (shape === "gable" || shape === "lean_to") { out.wall_height = num(e.wall_height, 0, out.height, "Vegghøyden (wall_height)", shape === "gable" ? Math.round(out.height * 50) / 100 : 0); }
      if (shape === "lean_to") { out.high_side = e.high_side == null ? "left" : String(e.high_side); if (!["left", "right"].includes(out.high_side)) throw new Error("high_side er left eller right (sett fra from mot to)"); }
      if (shape === "terraces") {
        out.steps = num(e.steps, 2, 10, "Trinnene (steps)", 3); if (!Number.isInteger(out.steps)) throw new Error("steps er et helt tall fra 2 til 10");
        out.step_depth = num(e.step_depth, 0.5, 20, "Dybden på hvert trinn (step_depth)", 3);
        if (out.step_depth * (out.steps - 1) >= out.width) throw new Error(`Med ${out.steps} trinn på ${out.step_depth} m blir det øverste uten bredde: gjør bredden større enn ${out.step_depth * (out.steps - 1)} m, eller trinnene grunnere`);
        out.high_side = e.high_side == null ? "left" : String(e.high_side); if (!["left", "right"].includes(out.high_side)) throw new Error("high_side er left eller right (sett fra from mot to): den siden trinnene er i flukt med");
      }
      return footOf(site, e, out, num);
    }
  }
  return checkLandscape(site, e, str);
}

/* the roof a volume set on a wing stands on: the highest of that wing's blocks (or outlines) under its middle */
export function roofUnder(site, e) {
  const m = [(e.from[0] + e.to[0]) / 2, (e.from[1] + e.to[1]) / 2]; let top = null;
  for (const b of site.buildings.filter(b => b.wing === e.on)) for (const k of b.blocks?.length ? b.blocks.map(k => ({ p: k.p, top: k.top })) : [{ p: b.ring, top: b.top }]) if (k.top != null && inRing(m, k.p)) top = Math.max(top ?? -Infinity, k.top);
  return top;
}

/* balconies: every outline wall of the wing that faces the side, at each storey it stands over. U3628: a balcony
   that would stand inside another building (a lower wing in front, under its roof) is not made; skipped says which
   building took how many, for Anton to say */
function balconyParts(site, e, gone = new Set(), skipped = new Map(), faces = new Map()) {
  const others = site.buildings.filter(b => b.wing !== e.wing && !gone.has(b.id)).flatMap(b => (b.blocks?.length ? b.blocks : [{ p: b.ring, top: b.top }]).filter(k => k.top != null)
    .map(k => ({ p: k.p, z: [b.lift ?? b.base, k.top], name: (site.wings || []).find(w => w.id === b.wing)?.name || b.name || `bygning ${b.id}` })));
  const w = site.wings.find(x => x.id === e.wing), bs = site.buildings.filter(b => b.wing === e.wing);
  const lv = (w.levels || []).slice().sort((a, b) => a.kote - b.kote), ground = Math.min(...bs.map(b => b.base));
  const i0 = e.from_storey ? lv.findIndex(l => l.name === e.from_storey) : lv.findIndex(l => l.kote > ground + 2);
  const i1 = e.to_storey ? lv.findIndex(l => l.name === e.to_storey) : lv.length - 1;
  const kotes = lv.slice(Math.max(0, i0), i1 + 1).map(l => l.kote), parts = [];
  for (const { b, wall, L, n, a, bb, flip, lo, hi, bearing } of facingWalls(site, e.wing, e.side, e.face)) {
      const dd = [(bb[0] - a[0]) / L, (bb[1] - a[1]) / L], runs = [], face = faces.get(faceKey(bearing)) || faces.set(faceKey(bearing), { bearing: faceKey(bearing), length_m: 0, per_storey: {} }).get(faceKey(bearing));
      face.length_m += L;
      if (e.windows) {   // U3624: one a window group, centred on it, as the facade's picture draws them (bays.js)
        for (const [t0, t1] of windowsOn(kindOf(b), wall)) {
          const c = flip ? L - (t0 + t1) / 2 : (t0 + t1) / 2, h = (e.bay ?? t1 - t0 + 0.6) / 2;
          if (c - h >= 0.05 && c + h <= L - 0.05) runs.push([c - h, c + h]);
        }
      } else if (e.bay) { const k = Math.floor((L + e.gap) / (e.bay + e.gap)); const used = k * e.bay + (k - 1) * e.gap; for (let j = 0; j < k; j++) { const t0 = (L - used) / 2 + j * (e.bay + e.gap); runs.push([t0, t0 + e.bay]); } }
      else runs.push([0.1, L - 0.1]);
      for (const z of kotes) {
        if (z < lo + 1 || z > hi - 1) continue;
        for (const [t0, t1] of runs) {
          const p = t => [a[0] + dd[0] * t, a[1] + dd[1] * t], ax = [p(t0), p(t1)];
          const body = [...ax, ...ax.slice().reverse().map(q => [q[0] + n[0] * e.depth, q[1] + n[1] * e.depth])], hit = others.find(o => overlapArea(o.p, body, o.z, [z - 0.2, z + 1.1]) > 0.05);
          if (hit) { skipped.set(hit.name, (skipped.get(hit.name) || 0) + 1); continue; }
          parts.push({ axis: ax, profile: [[0, z - 0.2], [e.depth, z - 0.2], [e.depth, z], [0, z]], mat: "concrete", role: "slab", face: face.bearing });
          face.per_storey[z] = (face.per_storey[z] || 0) + 1;
          const rail = e.railing === "concrete" ? 0.12 : 0.04;
          parts.push({ axis: ax, profile: [[e.depth - rail, z], [e.depth, z], [e.depth, z + 1.1], [e.depth - rail, z + 1.1]], mat: e.railing, role: "railing" });
          for (const q of ax) {   // the railing's ends, from the wall out
            const o = [q[0] + n[0] * e.depth, q[1] + n[1] * e.depth];
            parts.push({ axis: [q, o], profile: [[-rail / 2, z], [rail / 2, z], [rail / 2, z + 1.1], [-rail / 2, z + 1.1]], mat: e.railing, role: "railing" });
          }
        }
      }
  }
  return parts;
}
/* a wing's outline walls that face side (within 45°), or, given face (a bearing, degrees from north), those within
   20° of it: each with its outward normal n, its bearing, and its axis a -> bb run so that its left is out (flip:
   that is the wall's own end to start); walls under 3 m left out */
const faceKey = deg => (Math.round(deg / 5) * 5) % 360;   // a facade's bearing, to 5°, so the walls on one face are one
function* facingWalls(site, wing, side, face = null) {
  const [sx, sy] = SIDES[side];
  for (const b of site.buildings.filter(x => x.wing === wing)) {
    const rings = (b.blocks || []).map(k => k.p); if (!rings.length) rings.push(b.ring);
    for (const wall of b.walls || []) {
      const [x0, y0, x1, y1, lo, hi] = wall, L = Math.hypot(x1 - x0, y1 - y0); if (L < 3) continue;
      const d = [(x1 - x0) / L, (y1 - y0) / L]; let n = [-d[1], d[0]];
      const mid = [(x0 + x1) / 2 + n[0] * 0.5, (y0 + y1) / 2 + n[1] * 0.5];
      if (rings.some(r => inRing(mid, r))) n = [-n[0], -n[1]];   // n points out
      const bearing = bearingOf(n);
      if (face != null ? turn(bearing, face) > 20 : n[0] * sx + n[1] * sy < 0.7) continue;
      const flip = !(-d[1] === n[0] && d[0] === n[1]);
      yield { b, wall, L, n, a: flip ? [x1, y1] : [x0, y0], bb: flip ? [x0, y0] : [x1, y1], flip, lo: lo ?? b.base, hi, bearing };
    }
  }
}
/* U3615: a wing's facades: the bearings its outline walls face (to 5°), each with its length, longest first */
export function facadesOf(site, wing) {
  const m = new Map();
  for (const side of Object.keys(SIDES)) for (const { L, bearing } of facingWalls(site, wing, side)) { const k = faceKey(bearing); m.set(k, (m.get(k) || 0) + L); }
  return [...m].map(([bearing, L]) => ({ bearing, length_m: Math.round(L * 10) / 10 })).sort((a, b) => b.length_m - a.length_m);
}
const SIDE_DEG = Object.fromEntries(SIDE_KEYS.map(k => [k, bearingOf(SIDES[k])]));
/* the facade a side means on this wing, or a refusal naming both when the wing stands turned so that two faces are
   each 25–65° from it (Sentralblokka, turned 30°: «sør» is the short end at 210° and the long face at 120°) */
function faceFor(site, w, side) {
  const near = facadesOf(site, w.id).filter(f => f.length_m >= 6 && turn(f.bearing, SIDE_DEG[side]) <= 65).sort((a, b) => turn(a.bearing, SIDE_DEG[side]) - turn(b.bearing, SIDE_DEG[side]));
  if (near.length > 1 && turn(near[0].bearing, SIDE_DEG[side]) >= 25 && !near.slice(1).every(f => turn(f.bearing, near[0].bearing) <= 20))
    throw new Error(`${w.name} står skjevt: mot ${SIDE_WORD[side]} vender ${near.slice(0, 2).map(f => `fasaden mot ${f.bearing}° (${turn(f.bearing, SIDE_DEG[side])}° fra ${SIDE_WORD[side]}, ${String(f.length_m).replace(".", ",")} m lang)`).join(" og ")}. Si hvilken med face: ${near.slice(0, 2).map(f => f.bearing).join(" eller ")}, eller begge som to endringer.`);
  return null;
}

/* U3624: the window bays a wing's facades have by the rule the picture is drawn with (bays.js), per facade (pm 11:35Z:
   per compass side, «Ø» summed two faces of a turned wing, 63, where a balcony edit on one face used 38): the bearing
   balconies' face takes, its length, how many window groups along it (on one storey), and the bay; for about_wing */
/* how many window bays balcony slabs stand on: one axis a bay, on every storey */
const axesOf = slabs => new Set(slabs.map(p => p.axis.flat().map(v => Math.round(v * 10)).join())).size;
export function windowBays(site, wing) {
  /* counted as balconies with windows: true would stand there (a wall too low for a storey above the ground floor, a
     window too near the wall's end, or one a lower wing in front stands in, has none), so the number is the one a change
     gets; kind: the picture's rule */
  return facadesOf(site, wing).map(f => {
    const e = { wing, side: "N", face: f.bearing, windows: true, depth: 1.8 }, bays = axesOf(balconyParts(site, e).filter(p => p.role === "slab"));
    const b = site.buildings.find(x => x.wing === wing);
    return bays ? { face: f.bearing, length_m: f.length_m, bays, bay_m: BAY, picture: b && kindOf(b) === "tower" ? "par av vinduer i en nisje" : "vindusbånd" } : null; }).filter(Boolean);
}
/* pm 11:35Z: the facades a balconies edit puts balconies on (bearings), so a later one on the same face replaces it */
export function balconyFaces(site, e) {
  const faces = new Map(); balconyParts(site, e, new Set(), new Map(), faces);
  return [...faces.values()].filter(f => Object.keys(f.per_storey).length).map(f => f.bearing);
}

/* a volume's one part: its cross-section over the middle line */
/* a new building's foot: on the roof it stands on, at its base_kote, else the lowest ground under its corners and middle
   (the page's build tools stand the ghost there too, U3569) */
export function baseOf(site, e) {
  const { from, to, width: W } = e, h = W / 2, d = [to[0] - from[0], to[1] - from[1]], L = Math.hypot(...d), n = [-d[1] / L, d[0] / L];
  const corners = [-h, h].flatMap(s => [from, to].map(p => [p[0] + n[0] * s, p[1] + n[1] * s]));
  /* a plan brought in (DXF, DWG: flat) lies 5 cm over the highest ground under it, so the ground hides none of it */
  if (e.bim?.plan && !e.on && e.base_kote == null) {
    const at = (u, v) => [from[0] + d[0] * u + n[0] * (v - 0.5) * W, from[1] + d[1] * u + n[1] * (v - 0.5) * W], ks = [0, 0.25, 0.5, 0.75, 1];
    return Math.max(...ks.flatMap(u => ks.map(v => groundAt(site, at(u, v))))) + 0.05;
  }
  const lowest = () => Math.min(...corners.map(c => groundAt(site, c)), groundAt(site, [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2]));
  const roof = e.on ? roofUnder(site, e) : null;
  if (roof != null) return roof;
  if (e.base_kote != null) return e.base_kote;
  /* U3566 (f): a new building of its own shape stands where its pad's cut and fill are the same (what is dug out
     fills the rest), not on the lowest ground, which dug it deep into a slope; a construction or a file brought in
     keeps the lowest, as its IFC was made there */
  return e.shape && e.shape !== "bim" && site.terrain?.z ? balancedFoot(site, e, lowest()) : lowest();
}
/* the kote between the lowest and the highest ground under the pad where its cut and its fill (slopes and all) are
   the same, to 10 cm (the kote the card shows); the lowest when the ground is flat */
function balancedFoot(site, e, lo) {
  const { from, to, width: W } = e, d = [to[0] - from[0], to[1] - from[1]], L = Math.hypot(...d) || 1, n = [-d[1] / L, d[0] / L], ks = [0, 0.25, 0.5, 0.75, 1];
  const hu = 0.5 + PAD_M / L, at = (u, v) => [from[0] + d[0] * (0.5 + (u - 0.5) * 2 * hu) + n[0] * (v - 0.5) * (W + 2 * PAD_M), from[1] + d[1] * (0.5 + (u - 0.5) * 2 * hu) + n[1] * (v - 0.5) * (W + 2 * PAD_M)];
  const b = Math.max(lo, ...ks.flatMap(u => ks.map(v => groundAt(site, at(u, v)))));
  if (b - lo < 0.05) return lo;
  return balanceKote(k => { const g = padGround(site, e, k, false); return g ? g.cut - g.fill : 0; }, lo, b);
}
function volumeParts(site, e) {
  const { from, to, width: W, height: H } = e, h = W / 2, d = [to[0] - from[0], to[1] - from[1]], L = Math.hypot(...d), n = [-d[1] / L, d[0] / L];
  const z = baseOf(site, e);
  /* a construction: its mesh by its sha (the viewer fetches it, the server's picture reads it), placed by bimPlace */
  if (e.shape === "bim") return { parts: [{ axis: [from, to], mesh: e.bim.sha, mat: e.material, role: "volume" }], base: z };
  if (e.shape === "pyramid") {
    const top = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, z + H];
    const q = [[from[0] - n[0] * h, from[1] - n[1] * h], [to[0] - n[0] * h, to[1] - n[1] * h], [to[0] + n[0] * h, to[1] + n[1] * h], [from[0] + n[0] * h, from[1] + n[1] * h]].map(p => [...p, z]);
    return { parts: [{ axis: [from, to], tris: [0, 1, 2, 3].map(i => [q[i], q[(i + 1) % 4], top]).concat([[q[0], q[2], q[1]], [q[0], q[3], q[2]]]), mat: e.material, role: "volume" }], base: z };
  }
  if (e.shape === "terraces") {
    const k = e.steps, sh = H / k, back = e.high_side === "right" ? -h : h, dir = e.high_side === "right" ? 1 : -1;
    return { parts: Array.from({ length: k }, (_, i) => { const front = back + dir * (W - i * e.step_depth), [s0, s1] = [Math.min(back, front), Math.max(back, front)];
      return { axis: [from, to], profile: [[s0, z + i * sh], [s1, z + i * sh], [s1, z + (i + 1) * sh], [s0, z + (i + 1) * sh]], mat: e.material, role: "volume" }; }), base: z };
  }
  const wh = e.wall_height ?? 0, prof = {
    box: [[-h, 0], [h, 0], [h, H], [-h, H]],
    gable: [[-h, 0], [h, 0], [h, wh], [0, H], [-h, wh]],
    triangle: [[-h, 0], [h, 0], [0, H]],
    lean_to: e.high_side === "right" ? [[-h, 0], [h, 0], [h, H], [-h, wh]] : [[-h, 0], [h, 0], [h, wh], [-h, H]],
  }[e.shape].map(([s, k]) => [s, z + k]);
  return { parts: [{ axis: [from, to], profile: prof, mat: e.material, role: "volume" }], base: z };
}

/* U3566: the ground a new building stands on, as a builder leaves it: at its foot by the wall, falling away from it 1:50
   (FALL) for 3 m (PAD_M), so water runs off the house (Byggforsk 514.221), and from that edge a slope of 1:2 (SLOPE,
   run per rise) up to the ground where it is cut and down to it where it is filled, till it meets the ground. Made on the after's own copy of the terrain grid (the before's is shared
   and never written), so the viewer draws it, and what stands on the ground (paths, trees, the next building) stands on
   it. Its numbers on the building: ground { kote, cut_m3, fill_m3, max_cut, max_fill, sides { N, Ø, S, V: { cut, fill } }
   the deepest at each side (m), wall: the side a retaining wall would go, when the cut there is deeper than WALL_M }.
   Not a roof's (on): that one has no ground. Follow-ups (U3566): the fall away from the house, pads that meet, slopes
   onto roads, paths, pools and trees, the plot line, a step-free entrance, the foundation and geotechnics. Its foot,
   unless a kote is asked: where the cut and the fill are the same (balancedFoot, U3566 f), balanced: true. */
/* PAD_FAR: a foot set more than this over or under the ground (base_kote) stands on its own, on posts or in a pit: no pad */
const PAD_M = 3, FALL = 1 / 50, WALL_M = 1.5, PAD_FAR = 3;
/* U3566 (b), TEK17 § 8-6: a step-free entrance: level with the floor on a landing of 1.6 m (LANDING, room to turn),
   then a ramp at most 1:20 (RAMP) to the ground, 1.8 m wide (ENTRY_W), with a rest for every 0.6 m it rises; past
   RAMP_MAX m of ramp it is said to need a lift or another door */
const LANDING = 1.6, RAMP = 20, ENTRY_W = 1.8, REST_RISE = 0.6, RAMP_MAX = 80;
/* write false: only the numbers, the grid left as it is (balancedFoot tries koter with it). keep (U3566 c): the cells
   of the pads laid before, each with whose it is: what stands under a building or in its fall stays as that one left
   it, and where this pad meets one, the step between them is said (meets) */
function padGround(site, a, base, write = true, keep = null, guard = null, lot = null) {
  const T = site.terrain; if (!T?.z) return null;
  const d = [a.to[0] - a.from[0], a.to[1] - a.from[1]], L = Math.hypot(...d) || 1, u = [d[0] / L, d[1] / L], c = [(a.from[0] + a.to[0]) / 2, (a.from[1] + a.to[1]) / 2];
  const hu = L / 2 + PAD_M, hv = a.width / 2 + PAD_M, R = Math.hypot(hu, hv) + 40, cell = T.res * T.res;
  const c0 = Math.max(0, Math.floor((c[0] - R - T.x0) / T.res)), c1 = Math.min(T.w - 1, Math.ceil((c[0] + R - T.x0) / T.res));
  const r0 = Math.max(0, Math.floor((T.y1 - c[1] - R) / T.res)), r1 = Math.min(T.h - 1, Math.ceil((T.y1 - c[1] + R) / T.res));
  const sides = { N: { cut: 0, fill: 0 }, "Ø": { cut: 0, fill: 0 }, S: { cut: 0, fill: 0 }, V: { cut: 0, fill: 0 } };
  let cut = 0, fill = 0, reach = 0, lotStep = 0; const meets = new Map(), onto = new Map(), moved = new Map();
  /* the entrance's face: of the four, the one whose outward normal is nearest the side asked; f its normal in the
     building's own frame (along u, across n), off0 how far the face stands out from the middle */
  const nv = [-u[1], u[0]], want = a.entrance && SIDES[a.entrance];
  const face = want && [[1, 0, L / 2], [-1, 0, L / 2], [0, 1, a.width / 2], [0, -1, a.width / 2]].map(([fu, fn, off0]) => ({ fu, fn, off0, dot: (fu * u[0] + fn * nv[0]) * want[0] + (fu * u[1] + fn * nv[1]) * want[1] })).sort((p, q) => q.dot - p.dot)[0];
  let entry = null;
  if (face) {
    const dir = [face.fu * u[0] + face.fn * nv[0], face.fu * u[1] + face.fn * nv[1]], mid = [c[0] + dir[0] * face.off0, c[1] + dir[1] * face.off0];
    let meet = null;
    for (let t = LANDING; t <= LANDING + RAMP_MAX; t += 0.25) { const z0 = groundAt(site, [mid[0] + dir[0] * t, mid[1] + dir[1] * t]); if (Math.abs(z0 - base) <= (t - LANDING) / RAMP + 1e-9) { meet = { t, z0 }; break; } }
    const rise = meet ? Math.abs(meet.z0 - base) : Math.abs(groundAt(site, [mid[0] + dir[0] * (LANDING + RAMP_MAX), mid[1] + dir[1] * (LANDING + RAMP_MAX)]) - base);
    entry = { side: a.entrance, ramp_m: meet ? Math.round((meet.t - LANDING) * 10) / 10 : null, rise: Math.round(rise * 100) / 100, up: meet ? meet.z0 > base : null, rests: meet ? Math.max(0, Math.ceil(rise / REST_RISE) - 1) : null, ok: !!meet };
  }
  const half = Math.max(ENTRY_W / 2, T.res * 0.75);
  for (let r = r0; r <= r1; r++) for (let k = c0; k <= c1; k++) {
    const i = r * T.w + k, z0 = T.z[i]; if (z0 == null) continue;
    const x = T.x0 + (k + 0.5) * T.res - c[0], y = T.y1 - (r + 0.5) * T.res - c[1];
    /* off: how far out from the wall; the fall to PAD_M, then the slope to the ground */
    const du = Math.max(0, Math.abs(x * u[0] + y * u[1]) - L / 2), dv = Math.max(0, Math.abs(-x * u[1] + y * u[0]) - a.width / 2), off = Math.hypot(du, dv);
    const zp = base - FALL * Math.min(off, PAD_M), dist = Math.max(0, off - PAD_M);
    let z = batterZ(z0, zp, dist, SLOPE);
    /* in the entrance's way: level with the floor on the landing, then the ramp till it meets the ground */
    if (face) {
      const al = x * u[0] + y * u[1], ac = x * nv[0] + y * nv[1], t = (face.fu ? face.fu * al : face.fn * ac) - face.off0, lat = face.fu ? ac : al;
      if (t > 0 && Math.abs(lat) <= half) z = t <= LANDING ? base : z0 > base ? Math.min(z0, base + (t - LANDING) / RAMP) : Math.max(z0, base - (t - LANDING) / RAMP);
    }
    const other = keep?.get(i);
    if (other && other.id !== a.id) {
      if (off <= PAD_M) { const step = z - z0, was = meets.get(other.id); if (!was || Math.abs(step) > Math.abs(was.step)) meets.set(other.id, { id: other.id, name: other.name, step }); }
      continue;
    }
    if (write && keep && off <= PAD_M) keep.set(i, { id: a.id, name: a.name });
    if (Math.abs(z - z0) < 0.005) continue;
    /* outside the lot (U3566 e): the neighbour's ground, and the street's, stays as it is: a wall at the line */
    if (lot && off > 0 && !lot.has(i)) { if (Math.abs(z - z0) > Math.abs(lotStep)) lotStep = z - z0; continue; }
    /* a path in the after (U3566 d): its ground stays, and the slope stops at its edge: a wall there */
    const path = off > 0 && guard?.get(i);
    if (path) { const was = onto.get(path.id); if (!was || Math.abs(z - z0) > Math.abs(was.step)) onto.set(path.id, { id: path.id, name: path.name, step: z - z0 }); continue; }
    if (write) T.z[i] = z;
    moved.set(i, z - z0); reach = Math.max(reach, off);
    const dz = z0 - z, side = Math.abs(x) > Math.abs(y) ? (x > 0 ? "Ø" : "V") : (y > 0 ? "N" : "S");
    if (dz > 0) { cut += dz * cell; sides[side].cut = Math.max(sides[side].cut, dz); } else { fill -= dz * cell; sides[side].fill = Math.max(sides[side].fill, -dz); }
  }
  const r2 = v => Math.round(v * 100) / 100, max = k => Math.max(...Object.values(sides).map(s => s[k]));
  for (const s of Object.values(sides)) { s.cut = r2(s.cut); s.fill = r2(s.fill); }
  const deep = Object.entries(sides).filter(([, s]) => s.cut > WALL_M).sort((p, q) => q[1].cut - p[1].cut)[0];
  if (!write) return { cut, fill };
  const met = [...meets.values()].map(m => ({ ...m, step: r2(m.step) })), walls = [...onto.values()].map(m => ({ ...m, step: r2(m.step) }));
  const hit = rootsHit(T, site.trees, moved), trees = hit?.count || 0, deepest = hit?.deepest || 0;   // their roots are cut or buried
  return { kote: r2(base), reach_m: r2(reach), ...(entry ? { entrance: entry } : {}), ...(met.length ? { meets: met } : {}), ...(walls.length ? { paths: walls } : {}), ...(Math.abs(lotStep) >= 0.05 ? { lot_wall: r2(lotStep) } : {}), ...(trees ? { trees: { count: trees, deepest: r2(deepest) } } : {}), cut_m3: Math.round(cut), fill_m3: Math.round(fill), max_cut: r2(max("cut")), max_fill: r2(max("fill")), sides, ...(deep ? { wall: deep[0] } : {}) };
}

/* a pad's work in words, for the pane and for Anton (look): «graves ut 1,2 m mot nord, fylles opp 0,8 m mot sør» */
const SIDE_NO = { N: "nord", "Ø": "øst", S: "sør", V: "vest" }, m1 = v => String(Math.round(v * 10) / 10).replace(".", ",");
export function groundText(g) {
  if (!g) return "";
  const most = k => Object.entries(g.sides).filter(([, s]) => s[k] >= 0.2).sort((p, q) => q[1][k] - p[1][k])[0];
  const c = most("cut"), f = most("fill"), bits = [];
  if (c) bits.push(`graves ut ${m1(c[1].cut)} m mot ${SIDE_NO[c[0]]}`); if (f) bits.push(`fylles opp ${m1(f[1].fill)} m mot ${SIDE_NO[f[0]]}`);
  return `Tomta planeres på kote +${m1(g.kote)} ved veggen${g.balanced ? ", der det som graves ut fyller resten" : ""}, med fall 1:50 bort fra bygget de første ${PAD_M} m og skråning 1:${SLOPE} derfra til terrenget${bits.length ? ": " + bits.join(", ") : ""}. Utgraving ${g.cut_m3.toLocaleString("nb-NO")} m³, fylling ${g.fill_m3.toLocaleString("nb-NO")} m³.`
    + (g.wall ? ` Skjæringen mot ${SIDE_NO[g.wall]} er ${m1(g.sides[g.wall].cut)} m dyp: en støttemur der tar mindre plass enn skråningen.` : "") + entranceText(g.entrance) + meetText(g.meets)
    + (g.lot_wall ? ` Skråningen når tomtegrensen: terrenget utenfor er naboens eller gatens og blir som det er, så en mur på ${m1(Math.abs(g.lot_wall))} m ved grensen tar opp forskjellen.` : "")
    + (g.paths || []).map(w => ` Skråningen når ${w.name}: stien beholder sin høyde, og en mur på ${m1(Math.abs(w.step))} m langs den tar opp forskjellen.`).join("")
    + (g.trees ? ` ${g.trees.count === 1 ? "Ett tre står" : `${g.trees.count} trær står`} der bakken senkes eller heves mer enn ${ROOT_M * 100} cm (opptil ${m1(g.trees.deepest)} m): ${g.trees.count === 1 ? "det" : "de"} må felles, eller rotsonen sikres.` : "");
}
/* U3566 (e), pbl. § 29-4: how far a new building stands from the lot's line (0 when it is over it), the near side */
const LOT_MIN = 4;
function lotDistance(site, a) {
  const ring = site.lot?.ring; if (!(ring?.length > 2)) return null;
  const d = [a.to[0] - a.from[0], a.to[1] - a.from[1]], L = Math.hypot(...d) || 1, u = [d[0] / L, d[1] / L], n = [-u[1], u[0]], c = [(a.from[0] + a.to[0]) / 2, (a.from[1] + a.to[1]) / 2], h = a.width / 2;
  const corner = (s, t) => [c[0] + u[0] * s * L / 2 + n[0] * t * h, c[1] + u[1] * s * L / 2 + n[1] * t * h], cs = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
  const pts = []; for (let i = 0; i < 4; i++) { const p = cs[i], q = cs[(i + 1) % 4], m = Math.max(1, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / 0.5)); for (let j = 0; j < m; j++) pts.push([p[0] + (q[0] - p[0]) * j / m, p[1] + (q[1] - p[1]) * j / m]); }
  if (pts.some(p => !inRing(p, ring))) return { m: 0, outside: true };
  let best = Infinity;
  for (const p of pts) for (let j = 0; j < ring.length; j++) best = Math.min(best, segDist(p, ring[j], ring[(j + 1) % ring.length]));
  const m = Math.round(best * 10) / 10;
  return { m, ...(m < LOT_MIN ? { near: true } : {}) };
}
const lotOf = (site, e) => e.on == null && !e.bim?.plan ? lotDistance(site, e) : null;
/* the near-the-line words, for the card and Anton */
export function lotText(l) {
  if (!l) return "";
  if (l.outside) return "Bygget står over tomtegrensen.";
  return l.near ? `${String(l.m).replace(".", ",")} m fra tomtegrensen: nærmere enn ${LOT_MIN} m (pbl. § 29-4), som krever naboens samtykke eller dispensasjon.` : "";
}
/* the cells under the after's paths, each with its path: a pad's slope leaves them as they lie */
function pathCells(site) {
  const T = site.terrain, out = new Map(); if (!T?.z) return out;
  for (const l of site.landscape || []) {
    if (l.kind !== "path" || !(l.line?.length > 1)) continue;
    const w = (l.width || 2) / 2 + T.res / 2, name = l.name || "stien", xs = l.line.map(p => p[0]), ys = l.line.map(p => p[1]);
    const c0 = Math.max(0, Math.floor((Math.min(...xs) - w - T.x0) / T.res)), c1 = Math.min(T.w - 1, Math.ceil((Math.max(...xs) + w - T.x0) / T.res));
    const r0 = Math.max(0, Math.floor((T.y1 - Math.max(...ys) - w) / T.res)), r1 = Math.min(T.h - 1, Math.ceil((T.y1 - Math.min(...ys) + w) / T.res));
    for (let r = r0; r <= r1; r++) for (let k = c0; k <= c1; k++) {
      const p = [T.x0 + (k + 0.5) * T.res, T.y1 - (r + 0.5) * T.res];
      if (l.line.some((q, j) => j > 0 && segDist(p, l.line[j - 1], q) <= w)) out.set(r * T.w + k, { id: l.id, name });
    }
  }
  return out;
}
/* U3566 (d): the ways there are today (roads, pavements, car parks: the server has them, gater.mjs) that a new
   building's slopes reach onto, from how far its pad reaches (reach_m): for try_change's fit */
export function padFit(site, ways = []) {
  const out = [];
  for (const a of site.added || []) {
    if (a.kind !== "volume" || !a.ground?.reach_m) continue;
    const d = [a.to[0] - a.from[0], a.to[1] - a.from[1]], L = Math.hypot(...d) || 1, u = [d[0] / L, d[1] / L], c = [(a.from[0] + a.to[0]) / 2, (a.from[1] + a.to[1]) / 2], R = a.ground.reach_m, hits = new Map();
    for (let s = -L / 2 - R; s <= L / 2 + R; s += 1) for (let t = -a.width / 2 - R; t <= a.width / 2 + R; t += 1) {
      const off = Math.hypot(Math.max(0, Math.abs(s) - L / 2), Math.max(0, Math.abs(t) - a.width / 2)); if (off <= 0 || off > R) continue;
      const p = [c[0] + u[0] * s - u[1] * t, c[1] + u[1] * s + u[0] * t];
      for (const w of ways) if (w.ring?.length > 2 && inRing(p, w.ring)) hits.set(w.name, (hits.get(w.name) || 0) + 1);
    }
    if (hits.size) out.push({ id: a.id, name: a.name, slopes_onto: [...hits].map(([w, n]) => ({ way: w, m2: n })).sort((x, y) => y.m2 - x.m2), say: `Skråningene rundt ${a.name} når ${[...hits.keys()].join(", ")}: flytt bygget, eller sett en mur der.` });
  }
  return out;
}
/* where its pad meets another's: the step between them, or that they run together */
function meetText(ms) {
  return (ms || []).map(m => Math.abs(m.step) < 0.1 ? ` Platået møter platået til ${m.name} og flyter sammen med det.` : ` Platået møter platået til ${m.name}, som ligger ${m1(Math.abs(m.step))} m ${m.step > 0 ? "lavere" : "høyere"}: en mur eller trapp mellom dem${Math.abs(m.step) > 0.6 ? ", eller samme kote for begge" : ""}.`).join("");
}
/* the step-free entrance in words (TEK17 § 8-6) */
export function entranceText(n) {
  if (!n) return "";
  const s = SIDE_NO[n.side];
  if (!n.ok) return ` Inngangen mot ${s} ligger ${m1(n.rise)} m fra terrenget: en rampe 1:${RAMP} blir lengre enn ${RAMP_MAX} m, så den trenger heis, en annen inngang, eller bygget en annen kote.`;
  if (n.ramp_m < 0.5) return ` Trinnfri inngang mot ${s}: terrenget ligger i nivå med gulvet.`;
  return ` Trinnfri inngang mot ${s}: repos ${String(LANDING).replace(".", ",")} m i nivå med gulvet, så rampe 1:${RAMP} ${n.up ? "opp" : "ned"} til terrenget, ${m1(n.ramp_m)} m lang (${m1(n.rise)} m${n.rests ? `, ${n.rests} hvilerepos` : ""}).`;
}

const profArea = p => Math.abs(ringArea(p));
const round1 = v => Math.round(v * 10) / 10;

/* the after's changes laid over the model (copies, made by applyEdits): what is taken away goes, what is built is added */
export function applyDesign(site, floors, edits) {
  applyLandscape(site, edits);
  applyRoads(site, edits);
  applyGrading(site, edits);   // U3616: the ground set to a level, water at its own, before the buildings' pads
  const gone = new Set(), added = [], vols = new Map();   // vols: the new buildings, by id, as their edits leave them
  for (const e of edits) {
    if ((e.kind === "demolish" || e.kind === "reshape") && GROUND_ID.test(e.building ?? e.id)) continue;   // landscape.js's
    if ((e.kind === "demolish" || e.kind === "restore") && ROAD_ID.test(e.building)) continue;   // roads.js's
    if (e.kind === "demolish" && vols.has(e.building)) vols.delete(e.building);
    else if (e.kind === "demolish") for (const id of targets(site, e.building)) gone.add(id);
    else if (e.kind === "restore") for (const id of targets(site, e.building)) gone.delete(id);
    else if (e.kind === "reshape") { const v = vols.get(e.id); if (v) { const { kind, id, why, ...set } = e; Object.assign(v, set); if (set.storeys != null && set.height == null) v.height = Math.round(set.storeys * STOREY_M * 100) / 100; } }
    else if (e.kind === "balconies") {
      const skipped = new Map(), faces = new Map(), parts = balconyParts(site, e, gone, skipped, faces), slabs = parts.filter(p => p.role === "slab");
      /* U3614: each facade used: which way it faces, how long, how many on each storey */
      const used = [...faces.values()].filter(f => Object.keys(f.per_storey).length).map(f => { const ks = Object.values(f.per_storey); return { bearing: f.bearing, length_m: round1(f.length_m), storeys: ks.length, per_storey: Math.min(...ks) === Math.max(...ks) ? ks[0] : `${Math.min(...ks)}–${Math.max(...ks)}`, count: ks.reduce((a, b) => a + b, 0) }; });
      const facadeSay = used.map(f => `fasaden mot ${f.bearing}° (${String(f.length_m).replace(".", ",")} m): ${f.per_storey} per etasje på ${f.storeys} etasjer, ${f.count} i alt`).join("; ");
      const axes = axesOf(slabs);   // the window bays used: one axis a bay, on every storey
      added.push({ id: `balkonger-${added.length + 1}`, kind: "balconies", name: `Balkonger mot ${used.length ? used.map(f => `${f.bearing}°`).join(" og ") : e.face != null ? `${e.face}°` : SIDE_WORD[e.side]}, ${site.wings.find(w => w.id === e.wing).name}`, wing: e.wing, parts,
        count: slabs.length, facades: used, facade_say: `Balkonger på ${facadeSay}.`, ...(e.windows ? { per_window: true, window_bays: axes, window_say: `Én balkong per vindu: ${axes} vindusakser (hver ${String(BAY).replace(".", ",")} m) på fasaden mot ${used.map(f => `${f.bearing}°`).join(" og ")}, ${slabs.length} balkonger i alt.` } : {}), ...(skipped.size ? { skipped: [...skipped].map(([by, count]) => ({ by, count })), say: `${[...skipped.values()].reduce((a, b) => a + b, 0)} balkonger er ikke satt opp fordi de ville stått inne i ${[...skipped.keys()].join(" og ")}, som står foran fasaden under taket sitt.` } : {}), footprint_m2: round1(slabs.reduce((a, p) => a + e.depth * Math.hypot(p.axis[1][0] - p.axis[0][0], p.axis[1][1] - p.axis[0][1]), 0)), volume_m3: null, why: e.why });
    } else if (e.kind === "volume") vols.set(e.id ?? `volum-${vols.size + 1}`, { ...e });
  }
  /* every foot first, on the ground as it was, then the pads into the after's own copy of the grid */
  const feet = [...vols].map(([id, e]) => [id, e, volumeParts(site, e), e.on == null && !e.bim?.plan ? baseOf(site, { ...e, base_kote: undefined }) : null]);
  if (site.terrain?.z && feet.some(([, e]) => e.on == null)) site.terrain = { ...site.terrain, z: site.terrain.z.slice() };
  const keep = new Map(), guard = pathCells(site), lot = feet.some(([, e]) => e.on == null) ? lotCells(site) : null;
  for (const [id, e, { parts, base }, free] of feet) {
    /* free: where it would stand of itself, on the ground as it was before any pad */
    const L = Math.hypot(e.to[0] - e.from[0], e.to[1] - e.from[1]), ground = free != null && Math.abs(base - free) <= PAD_FAR ? padGround(site, e, base, true, keep, guard, lot) : null, near = lotOf(site, e);
    if (ground && e.base_kote == null && e.shape !== "bim") ground.balanced = true;
    added.push({ id, kind: "volume", name: e.name, shape: e.shape, material: e.material, from: e.from, to: e.to, width: e.width, height: e.height, base_kote: round1(base), top_kote: round1(base + e.height), parts,
      footprint_m2: round1(L * e.width), volume_m3: e.shape === "bim" ? null : Math.round(e.shape === "pyramid" ? L * e.width * e.height / 3 : parts.reduce((s, p) => s + profArea(p.profile), 0) * L), ...(e.bim ? { bim: e.bim } : {}), ...(ground ? { ground } : {}), ...(e.on ? { on: e.on } : {}), ...(e.storeys ? { storeys: e.storeys } : {}), ...(e.entrance ? { entrance: e.entrance } : {}), ...(near ? { lot: near } : {}), ...(e.use ? { use: e.use } : {}), ...(e.built ? { built: e.built } : {}), ...(e.note ? { note: e.note } : {}), why: e.why });
  }
  /* a meeting is said on both: the one laid first learns of the one that met it */
  for (const a of added) for (const m of a.ground?.meets || []) {
    const b = added.find(x => x.id === m.id); if (!b?.ground) continue;
    (b.ground.meets ??= []).push({ id: a.id, name: a.name, step: -m.step });
  }
  if (!gone.size && !added.length) return;
  const rings = site.buildings.filter(b => gone.has(b.id)).map(b => b.ring), wings = new Set(site.buildings.filter(b => gone.has(b.id) && b.wing).map(b => b.wing));
  site.demolished = site.buildings.filter(b => gone.has(b.id)).map(b => ({ id: b.id, name: b.name || `Bygning ${b.id} på tomta`, wing: b.wing ?? null, own: !!b.own, footprint_m2: b.area_m2, gross_volume_m3: grossVolume(b) }));
  site.buildings = site.buildings.filter(b => !gone.has(b.id));
  /* a wing with nothing left of it is gone from the after altogether (Morten 2026-10-25 20:12Z: «we want deleted
     buildings removed»): its entry (so its storeys, kotes and name), its facades and its own plans go too; what it
     was stays in site.demolished, and the edit in the list, to undo */
  const whole = new Set([...wings].filter(w => !site.buildings.some(b => b.wing === w)));
  site.wings_gone = (site.wings || []).filter(w => whole.has(w.id));
  site.wings = (site.wings || []).filter(w => !whole.has(w.id));
  site.facades = (site.facades || []).filter(f => !whole.has(f.building));
  for (const f of floors) {   // the drawn plans' walls and rooms inside what is gone go with it
    f.walls = f.walls.filter(r => !rings.some(g => inRing(r[0], g)));
    f.rooms = (f.rooms || []).filter(r => !rings.some(g => inRing(r.at, g)));
  }
  for (let i = floors.length - 1; i >= 0; i--) if (whole.has(floors[i].wing) || gone.size && !floors[i].walls.length && !floors[i].rooms.length) floors.splice(i, 1);
  site.added = added;
}

/* a building's gross volume from its blocks (outline × height from the ground to each block's roof), m³ */
export function grossVolume(b) {
  const A = p => Math.abs(p.reduce((a, q, i) => { const r = p[(i + 1) % p.length]; return a + q[0] * r[1] - r[0] * q[1]; }, 0)) / 2;
  if (b.blocks?.length) return Math.round(b.blocks.reduce((a, k) => a + A(k.p) * (k.top - (b.lift ?? b.base)), 0));
  return b.top != null ? Math.round(A(b.ring) * (b.top - b.base)) : null;
}
