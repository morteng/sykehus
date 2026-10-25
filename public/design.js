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
        wood or brick.

   What they make (applyDesign): site.added, each { id, kind, name, parts, footprint_m2, volume_m3 }, and
   site.demolished. A part is a profile [across, kote] extruded along an axis [[east, north], [east, north]]: across
   is metres to the left of the axis as one walks along it, so a box, a gable, a slope and a balcony slab are all one
   kind of thing, which the viewer draws and the IFC writes the same way. */

export const SIDES = { N: [0, 1], "Ø": [1, 0], S: [0, -1], V: [-1, 0] };
export const MATERIALS = ["glass", "concrete", "steel", "wood", "brick"];
export const SHAPES = ["box", "gable", "triangle", "lean_to"];
const num = (v, lo, hi, what, dflt) => {
  if (v == null) { if (dflt === undefined) throw new Error(`${what} mangler`); return dflt; }
  const x = +v; if (!Number.isFinite(x) || x < lo || x > hi) throw new Error(`${what} må være et tall mellom ${lo} og ${hi}`); return Math.round(x * 100) / 100;
};
const pt = (v, what) => {
  if (!Array.isArray(v) || v.length !== 2) throw new Error(`${what} er [øst, nord] i meter fra tomtas origo`);
  const [x, y] = v.map(Number); if (![x, y].every(Number.isFinite) || Math.abs(x) > 500 || Math.abs(y) > 500) throw new Error(`${what} må ligge innen 500 m fra tomtas origo`);
  return [Math.round(x * 100) / 100, Math.round(y * 100) / 100];
};
const inRing = ([x, y], r) => { let o = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [a, b] = r[i], [e, f] = r[j]; if ((b > y) !== (f > y) && x < (e - a) * (y - b) / (f - b) + a) o = !o; } return o; };

/* the buildings a demolish names: a wing's pieces, one building, or all the hospital's */
export function targets(site, key) {
  const k = String(key ?? "").toLowerCase().trim();
  if (k === "alle" || k === "all") return site.buildings.filter(b => b.own).map(b => b.id);
  const w = (site.wings || []).find(x => x.id === k || x.name.toLowerCase() === k || (x.aliases || []).some(a => a.toLowerCase() === k));
  if (w) return site.buildings.filter(b => b.wing === w.id).map(b => b.id);
  const b = site.buildings.find(x => String(x.id).toLowerCase() === k);
  if (b) return [b.id];
  throw new Error(`Fant ikke «${key}». Bruk en fløy (${(site.wings || []).map(x => x.name).join(", ")}), en bygnings id eller «alle»`);
}

/* one of the after's changes, checked: its tidy form, or an error that says what is wrong (in Norwegian, for the agent to pass on) */
export function checkDesign(site, e, str) {
  const why = e.why == null ? undefined : str(e.why, 300, "Begrunnelsen"), w_ = why ? { why } : {};
  switch (e.kind) {
    case "demolish": case "restore": targets(site, e.building); return { kind: e.kind, building: String(e.building).trim(), ...w_ };
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
      const out = { kind: "volume", name: str(String(e.name ?? (material === "glass" ? "Drivhus" : "Nybygg")), 80, "Navnet"), shape, from, to,
        width: num(e.width, 1, 120, "Bredden"), height: num(e.height, 1, 80, "Høyden"), material, ...w_ };
      if (shape === "gable" || shape === "lean_to") { out.wall_height = num(e.wall_height, 0, out.height, "Vegghøyden (wall_height)", shape === "gable" ? Math.round(out.height * 50) / 100 : 0); }
      if (shape === "lean_to") { out.high_side = e.high_side == null ? "left" : String(e.high_side); if (!["left", "right"].includes(out.high_side)) throw new Error("high_side er left eller right (sett fra from mot to)"); }
      if (e.base_kote != null) out.base_kote = num(e.base_kote, 0, 120, "Koten for foten (base_kote)");
      return out;
    }
  }
  return null;
}

/* the ground under a point, from the site's terrain grid (as the viewer reads it) */
export function groundAt(site, [x, y]) {
  const T = site.terrain; if (!T) return 0;
  const c = Math.floor((x - T.x0) / T.res), r = Math.floor((T.y1 - y) / T.res);
  const z = c >= 0 && r >= 0 && c < T.w && r < T.h ? T.z[r * T.w + c] : null;
  return z ?? Math.min(...T.z.filter(v => v != null));
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
function volumeParts(site, e) {
  const { from, to, width: W, height: H } = e, h = W / 2, d = [to[0] - from[0], to[1] - from[1]], L = Math.hypot(...d), n = [-d[1] / L, d[0] / L];
  const corners = [-h, h].flatMap(s => [from, to].map(p => [p[0] + n[0] * s, p[1] + n[1] * s]));
  const z = e.base_kote ?? Math.min(...corners.map(c => groundAt(site, c)), groundAt(site, [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2]));
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
  const gone = new Set(), added = [];
  for (const e of edits) {
    if (e.kind === "demolish") for (const id of targets(site, e.building)) gone.add(id);
    else if (e.kind === "restore") for (const id of targets(site, e.building)) gone.delete(id);
    else if (e.kind === "balconies") {
      const parts = balconyParts(site, e), slabs = parts.filter(p => p.role === "slab");
      added.push({ id: `balkonger-${added.length + 1}`, kind: "balconies", name: `Balkonger mot ${e.side}, ${site.wings.find(w => w.id === e.wing).name}`, wing: e.wing, parts,
        count: slabs.length, footprint_m2: round1(slabs.reduce((a, p) => a + e.depth * Math.hypot(p.axis[1][0] - p.axis[0][0], p.axis[1][1] - p.axis[0][1]), 0)), volume_m3: null, why: e.why });
    } else if (e.kind === "volume") {
      const { parts, base } = volumeParts(site, e), L = Math.hypot(e.to[0] - e.from[0], e.to[1] - e.from[1]);
      added.push({ id: `volum-${added.length + 1}`, kind: "volume", name: e.name, shape: e.shape, material: e.material, base_kote: round1(base), top_kote: round1(base + e.height), parts,
        footprint_m2: round1(L * e.width), volume_m3: Math.round(profArea(parts[0].profile) * L), why: e.why });
    }
  }
  if (!gone.size && !added.length) return;
  const rings = site.buildings.filter(b => gone.has(b.id)).map(b => b.ring), wings = new Set(site.buildings.filter(b => gone.has(b.id) && b.wing).map(b => b.wing));
  site.demolished = site.buildings.filter(b => gone.has(b.id)).map(b => ({ id: b.id, name: b.name || `Bygning ${b.id} på tomta`, wing: b.wing ?? null, footprint_m2: b.area_m2, gross_volume_m3: grossVolume(b) }));
  site.buildings = site.buildings.filter(b => !gone.has(b.id));
  site.facades = (site.facades || []).filter(f => !wings.has(f.building) || site.buildings.some(b => b.wing === f.building));
  for (const f of floors) {   // the drawn plans' walls and rooms inside what is gone go with it
    f.walls = f.walls.filter(r => !rings.some(g => inRing(r[0], g)));
    f.rooms = (f.rooms || []).filter(r => !rings.some(g => inRing(r.at, g)));
  }
  site.added = added;
}

/* a building's gross volume from its blocks (outline × height from the ground to each block's roof), m³ */
export function grossVolume(b) {
  const A = p => Math.abs(p.reduce((a, q, i) => { const r = p[(i + 1) % p.length]; return a + q[0] * r[1] - r[0] * q[1]; }, 0)) / 2;
  if (b.blocks?.length) return Math.round(b.blocks.reduce((a, k) => a + A(k.p) * (k.top - (b.lift ?? b.base)), 0));
  return b.top != null ? Math.round(A(b.ring) * (b.top - b.base)) : null;
}
