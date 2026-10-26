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
import { fitOf, surfaceFit, groundAt, inRing } from "./renderkit/fit.js";   // renderkit (U3559): one copy for every app
export { fitOf, surfaceFit, groundAt };

export const SIDES = { N: [0, 1], "Ø": [1, 0], S: [0, -1], V: [-1, 0] };
export const MATERIALS = ["glass", "concrete", "steel", "wood", "brick"];
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
function bimBody(from, to, box) {
  const L = Math.max(1, box.max[0] - box.min[0]), c = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2], d = Math.hypot(to[0] - from[0], to[1] - from[1]) || 1, u = [(to[0] - from[0]) / d, (to[1] - from[1]) / d], r = v => Math.round(v * 100) / 100;
  return { from: [r(c[0] - u[0] * L / 2), r(c[1] - u[1] * L / 2)], to: [r(c[0] + u[0] * L / 2), r(c[1] + u[1] * L / 2)], width: r(Math.max(1, box.max[1] - box.min[1])), height: r(Math.max(1, box.max[2] - box.min[2])) };
}
/* the facts a new building's card shows, checked (volume and reshape alike) */
function facts(e, str, out) {
  if (e.use != null) out.use = str(String(e.use), 80, "Bruken");
  if (e.built != null) out.built = str(String(e.built), 40, "Byggeåret");
  if (e.note != null) out.note = str(String(e.note), 600, "Merknaden");
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
      const f = out.from || a.from, t = out.to || a.to, L = Math.hypot(t[0] - f[0], t[1] - f[1]); if (L < 1 || L > 250) throw new Error("Lengden må være mellom 1 og 250 m");
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
      const side = String(e.side ?? "").toUpperCase().replace("O", "Ø"); if (!SIDES[side]) throw new Error("side er N, Ø, S eller V: fasaden balkongene vender mot");
      const names = (w.levels || []).map(l => l.name), storey = (s, what) => { if (s == null) return undefined; const n = /^\d+$/.test(String(s).trim()) ? `${String(s).trim()}. etasje` : String(s).trim(); if (!names.includes(n)) throw new Error(`${what}: ${w.name} har ikke «${n}» (har ${names.join(", ")})`); return n; };
      const out = { kind: "balconies", wing: w.id, side, depth: num(e.depth, 0.8, 4, "Dybden", 1.8), railing: e.railing == null ? "glass" : String(e.railing), ...w_ };
      if (!["glass", "steel", "concrete"].includes(out.railing)) throw new Error("railing er glass, steel eller concrete");
      const f = storey(e.from_storey, "from_storey"), t = storey(e.to_storey, "to_storey"); if (f) out.from_storey = f; if (t) out.to_storey = t;
      if (e.bay != null) { out.bay = num(e.bay, 1.5, 20, "Bredden på hver balkong (bay)"); out.gap = num(e.gap, 0, 10, "Mellomrommet (gap)", 0.6); }
      if (!balconyParts(site, out).length) throw new Error(`${w.name} har ingen fasade mot ${side} der balkongene kan stå (eller ingen etasjer i det valgte spennet)`);
      return out;
    }
    case "volume": {
      const shape = String(e.shape ?? "box"); if (!SHAPES.includes(shape)) throw new Error(`shape er ${SHAPES.join(", ")}`);
      const material = String(e.material ?? "glass"); if (!MATERIALS.includes(material)) throw new Error(`material er ${MATERIALS.join(", ")}`);
      const from = pt(e.from, "from"), to = pt(e.to, "to"), L = Math.hypot(to[0] - from[0], to[1] - from[1]);
      if (L < 1 || L > 250) throw new Error("Fra from til to må være mellom 1 og 250 m");
      const out = facts(e, str, { kind: "volume", ...(e.id != null ? { id: String(e.id) } : {}), name: str(String(e.name ?? (material === "glass" ? "Drivhus" : "Nybygg")), 80, "Navnet"), shape, from, to, material });
      if (out.id) out.id = freeId(out.id, site);
      if (shape === "bim") { out.bim = bimOf(e.bim); Object.assign(out, bimBody(from, to, out.bim.box), w_); return out; }
      out.width = num(e.width, 1, 120, "Bredden"); out.height = num(e.height ?? (out.storeys ? out.storeys * STOREY_M : undefined), 1, 80, "Høyden"); Object.assign(out, w_);
      if (shape === "gable" || shape === "lean_to") { out.wall_height = num(e.wall_height, 0, out.height, "Vegghøyden (wall_height)", shape === "gable" ? Math.round(out.height * 50) / 100 : 0); }
      if (shape === "lean_to") { out.high_side = e.high_side == null ? "left" : String(e.high_side); if (!["left", "right"].includes(out.high_side)) throw new Error("high_side er left eller right (sett fra from mot to)"); }
      if (shape === "terraces") {
        out.steps = num(e.steps, 2, 10, "Trinnene (steps)", 3); if (!Number.isInteger(out.steps)) throw new Error("steps er et helt tall fra 2 til 10");
        out.step_depth = num(e.step_depth, 0.5, 20, "Dybden på hvert trinn (step_depth)", 3);
        if (out.step_depth * (out.steps - 1) >= out.width) throw new Error(`Med ${out.steps} trinn på ${out.step_depth} m blir det øverste uten bredde: gjør bredden større enn ${out.step_depth * (out.steps - 1)} m, eller trinnene grunnere`);
        out.high_side = e.high_side == null ? "left" : String(e.high_side); if (!["left", "right"].includes(out.high_side)) throw new Error("high_side er left eller right (sett fra from mot to): den siden trinnene er i flukt med");
      }
      if (e.on != null) {
        const k = String(e.on).toLowerCase().trim(), w = (site.wings || []).find(x => x.id === k || x.name.toLowerCase() === k);
        if (!w) throw new Error(`on er en fløy som står (${(site.wings || []).map(x => x.name).join(", ")})`);
        out.on = w.id; if (roofUnder(site, out) == null) throw new Error(`Midten av ${out.name} står ikke på taket til ${w.name}: flytt from og to så midten er innenfor fløyen`);
      } else if (e.base_kote != null) out.base_kote = num(e.base_kote, 0, 120, "Koten for foten (base_kote)");
      return out;
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

/* balconies: every outline wall of the wing that faces the side, at each storey it stands over */
function balconyParts(site, e) {
  const w = site.wings.find(x => x.id === e.wing), bs = site.buildings.filter(b => b.wing === e.wing);
  const lv = (w.levels || []).slice().sort((a, b) => a.kote - b.kote), ground = Math.min(...bs.map(b => b.base));
  const i0 = e.from_storey ? lv.findIndex(l => l.name === e.from_storey) : lv.findIndex(l => l.kote > ground + 2);
  const i1 = e.to_storey ? lv.findIndex(l => l.name === e.to_storey) : lv.length - 1;
  const kotes = lv.slice(Math.max(0, i0), i1 + 1).map(l => l.kote), [sx, sy] = SIDES[e.side], parts = [];
  for (const b of bs) {
    const rings = (b.blocks || []).map(k => k.p); if (!rings.length) rings.push(b.ring);
    for (const [x0, y0, x1, y1, lo, hi] of b.walls || []) {
      const L = Math.hypot(x1 - x0, y1 - y0); if (L < 3) continue;
      const d = [(x1 - x0) / L, (y1 - y0) / L]; let n = [-d[1], d[0]];
      const mid = [(x0 + x1) / 2 + n[0] * 0.5, (y0 + y1) / 2 + n[1] * 0.5];
      if (rings.some(r => inRing(mid, r))) n = [-n[0], -n[1]];   // n points out
      if (n[0] * sx + n[1] * sy < 0.7) continue;
      // the axis runs so that its left is out
      const [a, bb] = -d[1] === n[0] && d[0] === n[1] ? [[x0, y0], [x1, y1]] : [[x1, y1], [x0, y0]];
      const dd = [(bb[0] - a[0]) / L, (bb[1] - a[1]) / L], runs = [];
      if (e.bay) { const k = Math.floor((L + e.gap) / (e.bay + e.gap)); const used = k * e.bay + (k - 1) * e.gap; for (let j = 0; j < k; j++) { const t0 = (L - used) / 2 + j * (e.bay + e.gap); runs.push([t0, t0 + e.bay]); } }
      else runs.push([0.1, L - 0.1]);
      const lo_ = lo ?? b.base;
      for (const z of kotes) {
        if (z < lo_ + 1 || z > hi - 1) continue;
        for (const [t0, t1] of runs) {
          const p = t => [a[0] + dd[0] * t, a[1] + dd[1] * t], ax = [p(t0), p(t1)];
          parts.push({ axis: ax, profile: [[0, z - 0.2], [e.depth, z - 0.2], [e.depth, z], [0, z]], mat: "concrete", role: "slab" });
          const rail = e.railing === "concrete" ? 0.12 : 0.04;
          parts.push({ axis: ax, profile: [[e.depth - rail, z], [e.depth, z], [e.depth, z + 1.1], [e.depth - rail, z + 1.1]], mat: e.railing, role: "railing" });
          for (const q of ax) {   // the railing's ends, from the wall out
            const o = [q[0] + n[0] * e.depth, q[1] + n[1] * e.depth];
            parts.push({ axis: [q, o], profile: [[-rail / 2, z], [rail / 2, z], [rail / 2, z + 1.1], [-rail / 2, z + 1.1]], mat: e.railing, role: "railing" });
          }
        }
      }
    }
  }
  return parts;
}

/* a volume's one part: its cross-section over the middle line */
/* a new building's foot: on the roof it stands on, at its base_kote, else the lowest ground under its corners and middle
   (the page's build tools stand the ghost there too, U3569) */
export function baseOf(site, e) {
  const { from, to, width: W } = e, h = W / 2, d = [to[0] - from[0], to[1] - from[1]], L = Math.hypot(...d), n = [-d[1] / L, d[0] / L];
  const corners = [-h, h].flatMap(s => [from, to].map(p => [p[0] + n[0] * s, p[1] + n[1] * s]));
  return (e.on ? roofUnder(site, e) : null) ?? e.base_kote ?? Math.min(...corners.map(c => groundAt(site, c)), groundAt(site, [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2]));
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

const profArea = p => Math.abs(p.reduce((a, q, i) => { const r = p[(i + 1) % p.length]; return a + q[0] * r[1] - r[0] * q[1]; }, 0)) / 2;
const round1 = v => Math.round(v * 10) / 10;

/* the after's changes laid over the model (copies, made by applyEdits): what is taken away goes, what is built is added */
export function applyDesign(site, floors, edits) {
  applyLandscape(site, edits);
  const gone = new Set(), added = [], vols = new Map();   // vols: the new buildings, by id, as their edits leave them
  for (const e of edits) {
    if ((e.kind === "demolish" || e.kind === "reshape") && GROUND_ID.test(e.building ?? e.id)) continue;   // landscape.js's
    if (e.kind === "demolish" && vols.has(e.building)) vols.delete(e.building);
    else if (e.kind === "demolish") for (const id of targets(site, e.building)) gone.add(id);
    else if (e.kind === "restore") for (const id of targets(site, e.building)) gone.delete(id);
    else if (e.kind === "reshape") { const v = vols.get(e.id); if (v) { const { kind, id, why, ...set } = e; Object.assign(v, set); if (set.storeys != null && set.height == null) v.height = Math.round(set.storeys * STOREY_M * 100) / 100; } }
    else if (e.kind === "balconies") {
      const parts = balconyParts(site, e), slabs = parts.filter(p => p.role === "slab");
      added.push({ id: `balkonger-${added.length + 1}`, kind: "balconies", name: `Balkonger mot ${e.side}, ${site.wings.find(w => w.id === e.wing).name}`, wing: e.wing, parts,
        count: slabs.length, footprint_m2: round1(slabs.reduce((a, p) => a + e.depth * Math.hypot(p.axis[1][0] - p.axis[0][0], p.axis[1][1] - p.axis[0][1]), 0)), volume_m3: null, why: e.why });
    } else if (e.kind === "volume") vols.set(e.id ?? `volum-${vols.size + 1}`, { ...e });
  }
  for (const [id, e] of vols) {
    const { parts, base } = volumeParts(site, e), L = Math.hypot(e.to[0] - e.from[0], e.to[1] - e.from[1]);
    added.push({ id, kind: "volume", name: e.name, shape: e.shape, material: e.material, from: e.from, to: e.to, width: e.width, height: e.height, base_kote: round1(base), top_kote: round1(base + e.height), parts,
      footprint_m2: round1(L * e.width), volume_m3: e.shape === "bim" ? null : Math.round(e.shape === "pyramid" ? L * e.width * e.height / 3 : parts.reduce((s, p) => s + profArea(p.profile), 0) * L), ...(e.bim ? { bim: e.bim } : {}), ...(e.on ? { on: e.on } : {}), ...(e.storeys ? { storeys: e.storeys } : {}), ...(e.use ? { use: e.use } : {}), ...(e.built ? { built: e.built } : {}), ...(e.note ? { note: e.note } : {}), why: e.why });
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
