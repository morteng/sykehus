/* Roads, paths, pavements, fences and walls around a place: OSM (hagekart's server-cached /api/streets) and NVDB (/api/nvdb), turned
   into the path objects a plan uses and streets3d.js draws. No three.js, no DOM (fetch only for the load* calls). Moved from hagekart
   public/streets.js (U3530), where it had moved out of scene.js so detection can use them as known geometry before the 3D view exists.
   The app brings its projection: toUtm([lon, lat]) -> [x, y] metres and toLngLat back (hagekart and sykehus: EPSG:25833). A box is
   [south, west, north, east] in degrees. base is where hagekart's API is: "" = the same origin (hagekart itself), else e.g.
   "https://hagekart.gulden.no" (both routes send open CORS). */
import { pathRing } from "./paths2d.js";

/* OSM roads, paths, pavements, fences and walls around the lot (server-cached) turned into the same path objects the plan uses, so the
   3D model draws them with the same cross-sections (kerbs, pavements, centre lines). Widths come from the tags, else from the class:
   N100 for streets (boliggate 5,5 m, samleveg 6,5 m, one-way 4 m), footway 2 m, cycleway 3 m. The pavement beside a street is usually
   its own footway way in OSM (sidewalk=separate), so streets get no pavement of their own unless the sidewalk tag says so. */
const SURF = { asphalt: "asphalt", paved: "asphalt", concrete: "slabs", paving_stones: "slabs", "concrete:plates": "slabs", sett: "cobble", cobblestone: "cobble", unhewn_cobblestone: "cobble", gravel: "gravel", fine_gravel: "gravel", compacted: "gravel", ground: "gravel", dirt: "gravel", sand: "sand", grass: "gravel" };
export function streetToPath(f) {
  if (f.geometry.type === "Point") { const t = f.properties, k = t.highway === "street_lamp" ? "lamp" : t.highway === "bus_stop" ? "busstop" : t.barrier === "bollard" ? "bollard" : t.amenity === "bench" ? "bench" : null; return k ? { kind: "poi", type: k, pt: f.geometry.coordinates, shelter: t.shelter === "yes", backrest: t.backrest !== "no" } : null; }
  if (f.properties.railway === "tram") return { kind: "tram", pts: f.geometry.coordinates, src: "osm" };
  /* A car park (amenity=parking, a closed way): a paved area, kerbed only where OSM says so. Underground, multi-storey and rooftop ones are not ground. */
  if (f.properties.amenity === "parking") {
    const t = f.properties, c = f.geometry.coordinates, a = c[0], b = c[c.length - 1];
    if (f.geometry.type !== "LineString" || c.length < 4 || a[0] !== b[0] || a[1] !== b[1] || /^(underground|multi-storey|rooftop)$/.test(t.parking || "") || +t.layer < 0) return null;
    return { kind: "parking", ring: c, surface: SURF[t.surface] || "asphalt", kerb: !!t.kerb && !/^(no|none|flush)$/.test(t.kerb), st: "exists", src: "osm" };
  }
  const t = f.properties, pts = f.geometry.coordinates, w = parseFloat(t.width), hw = t.highway;
  if (t.tunnel && t.tunnel !== "no" || +t.layer < 0 || t.area === "yes") return null;
  if (t.barrier) {
    if (t.barrier === "gate" || t.barrier === "hedge") return null;   // a hedge is a plant (contextFrom), not a fence
    const h = parseFloat(t.height), wall = t.barrier !== "fence", wood = /wood/.test(t.fence_type || t.material || ""), metal = /metal|steel|iron/.test(t.fence_type || t.material || "");
    return { kind: "fence", type: wall ? "mur" : wood ? "skjerm" : metal ? "smijern" : "nett", h: Number.isFinite(h) ? Math.min(Math.max(h, 0.4), 3) : wall ? (t.barrier === "retaining_wall" ? 1.0 : 0.9) : undefined, pts, width: 0.1, st: "exists", src: "osm" };
  }
  if (!hw || /^(steps|proposed|construction|corridor|elevator|platform|bus_stop|raceway|track)$/.test(hw)) return null;
  const surface = SURF[t.surface] || null, sw = t["sidewalk:both"] === "yes" || t.sidewalk === "both" ? "both" : t["sidewalk:left"] === "yes" || t.sidewalk === "left" ? "left" : t["sidewalk:right"] === "yes" || t.sidewalk === "right" ? "right" : "none", one = t.oneway === "yes";
  const road = (type, wd, more = {}) => ({ kind: "road", type, pts, width: Number.isFinite(w) ? w : wd, surface: surface || "asphalt", walk: sw, st: "exists", src: "osm", ...more });
  if (/^(residential|unclassified)$/.test(hw)) return road("boliggate", one ? 4 : 5.5, { line: !one, kerb: true });
  if (/^(tertiary|secondary|primary|trunk|tertiary_link|secondary_link|primary_link)$/.test(hw)) return road("boliggate", 6.5, { line: true, kerb: true, kerbH: 0.12, walkW: 2.5 });
  if (hw === "living_street") return road("boliggate", 4.5, { line: false, kerb: false, surface: surface || "cobble" });
  if (hw === "service") return road("adkomst", 3.5, { kerb: false, surface: surface || (t.service === "driveway" ? "gravel" : "asphalt"), walk: "none" });
  if (hw === "pedestrian") return { kind: "path", pts, width: Number.isFinite(w) ? w : 4, surface: surface || "slabs", kerb: false, walk: "none", st: "exists", src: "osm" };
  if (hw === "cycleway") return { kind: "path", type: "gangsykkel", pts, width: Number.isFinite(w) ? w : 3, surface: surface || "asphalt", st: "exists", src: "osm" };
  if (hw === "footway" || hw === "path" || hw === "bridleway") {
    const side = t.footway === "sidewalk", cross = t.footway === "crossing";
    return { kind: "path", pts, width: Number.isFinite(w) ? w : side ? 2 : cross ? 3 : hw === "path" ? 1.2 : 2, surface: surface || (hw === "path" ? "gravel" : side || cross ? "asphalt" : "slabs"), kerb: false, raise: side ? 0.13 : undefined, walk: "none", cross, zebra: cross && /^(zebra|marked|uncontrolled|traffic_signals)$/.test(t.crossing || ""), st: "exists", src: "osm" };
  }
  return null;
}
const api = base => base ? `${base.replace(/\/$/, "")}/api/` : "api/", boxQ = bbox => bbox.map(v => v.toFixed(6)).join(",");
let stFor = "", rawP = null;
/* The OSM and NVDB answers for a box, fetched once per box (the last one is memoised): streets and context are both read from them. */
export function loadRaw(bbox, base = "") {
  const q = boxQ(bbox), k = `${base}|${q}`;
  if (stFor === k && rawP) return rawP;
  stFor = k;
  const get = u => fetch(u).then(r => r.ok ? r.json() : { features: [] }).catch(() => ({ features: [] }));
  return rawP = Promise.all([get(`${api(base)}streets?bbox=${q}`), get(`${api(base)}nvdb?bbox=${q}`)]);
}
export function loadStreets(bbox, { toUtm, base = "" }) { return loadRaw(bbox, base).then(([osm, nv]) => streetsFrom(osm, nv, toUtm)); }
/* What OSM says about the ground besides its roads, for detection (hagekart detect.js): churchyards, hedges and tree rows around the lot. */
export function loadContext(bbox, { base = "" } = {}) { return loadRaw(bbox, base).then(([osm]) => contextFrom(osm)); }
/* Pure: OSM features (api/streets) -> { cemeteries: lng/lat rings, hedges: lng/lat lines, treeRows: lng/lat lines }. A churchyard is a
   closed way tagged amenity=grave_yard or landuse=cemetery; hedges are barrier=hedge, tree rows natural=tree_row. */
export function contextFrom(osm) {
  const out = { cemeteries: [], hedges: [], treeRows: [] };
  for (const f of osm?.features || []) {
    if (f.geometry?.type !== "LineString") continue;
    const t = f.properties || {}, c = f.geometry.coordinates;
    if (t.amenity === "grave_yard" || t.landuse === "cemetery") { const a = c[0], b = c[c.length - 1]; if (c.length > 3 && a[0] === b[0] && a[1] === b[1]) out.cemeteries.push(c); }
    else if (t.barrier === "hedge" && c.length > 1) out.hedges.push(c);
    else if (t.natural === "tree_row" && c.length > 1) out.treeRows.push(c);
  }
  return out;
}
/* NVDB (Statens vegvesen) is the authority on the public road: crossings and markings come from it when it has any, OSM fills the rest */
export function streetsFrom(osm, nv, toUtm) {
  const marks = nv.features.filter(f => f.properties.t === "linje" || f.properties.t === "gangfelt");
  const hasZebra = nv.features.some(f => f.properties.t === "gangfelt"), hasLines = nv.features.some(f => f.properties.t === "linje");
  let paths = osm.features.map(streetToPath).filter(Boolean);
  if (hasZebra) paths = paths.filter(p => !p.cross);
  const stops = nv.features.filter(f => f.properties.t === "holdeplass").map(f => toUtm(f.geometry.type === "Point" ? f.geometry.coordinates : f.geometry.coordinates[0]));
  if (stops.length) paths = paths.filter(p => !(p.kind === "poi" && p.type === "busstop" && stops.some(q => { const u = toUtm(p.pt); return Math.hypot(u[0] - q[0], u[1] - q[1]) < 20; })));
  /* measured carriageway (NVDB 838: width per stretch, from laser and 360° photos) replaces OSM's guessed streets wherever it exists, and the
     real kerb line (NVDB 9) replaces the kerbs we would have added */
  const dekke = nv.features.filter(f => f.properties.t === "dekke" && f.geometry.type === "LineString" && +f.properties.Dekkebredde > 2);
  const hasKerb = nv.features.some(f => f.properties.t === "kantstein");
  if (dekke.length) {
    const dl = dekke.map(f => f.geometry.coordinates.map(toUtm));
    const near = pts => pts.map(toUtm).filter(q => dl.some(l => l.some(r => Math.hypot(r[0] - q[0], r[1] - q[1]) < 12))).length > pts.length / 2;
    paths = paths.filter(p => !(p.kind === "road" && near(p.pts)));
    paths.push(...dekke.map(f => ({ kind: "road", type: "boliggate", pts: f.geometry.coordinates, width: +f.properties.Dekkebredde, surface: "asphalt", kerb: false, walk: "none", line: false, st: "exists", src: "nvdb" })));
  }
  if (hasKerb) paths = paths.map(p => p.kind === "road" ? { ...p, kerb: false, walk: "none" } : p);
  if (hasLines) paths = paths.map(p => p.kind === "road" ? { ...p, line: false } : p);
  /* Belysningspunkt (87) is the authority on lamps: where a lamp hangs on a wire across the street (Plassering) it is drawn so; mast length and
     height over the road come from Lysmast (181) and Lysarmatur (88) at the same point. OSM lamps are dropped where NVDB has any. */
  const lamps = nv.features.filter(f => f.properties.t === "lys" && f.geometry.type === "Point" && f.properties.Plassering !== "På skiltpunkt");
  if (lamps.length) {
    const at = t => nv.features.filter(f => f.properties.t === t && f.geometry.type === "Point").map(f => ({ u: toUtm(f.geometry.coordinates), p: f.properties }));
    const arm = at("lysarmatur"), mast = at("lysmast"), find = (L, u) => L.find(r => Math.hypot(r.u[0] - u[0], r.u[1] - u[1]) < 1.5)?.p;
    paths = paths.filter(p => !(p.kind === "poi" && p.type === "lamp"));
    paths.push(...lamps.map(f => { const u = toUtm(f.geometry.coordinates), a = find(arm, u), m = find(mast, u), hang = f.properties.Plassering === "Henger i vaier";
      return { kind: "poi", type: "lamp", pt: f.geometry.coordinates, hang, h: (a && +a["Høyde over veg"]) || (m && +m["Mastelengde, synlig"]) || undefined, arm: m ? m.Utligger !== "Nei" : undefined, src: "nvdb" }; }));
  }
  return [...paths, ...nv.features.filter(f => /^(gangfelt|linje|tverr|fartsdemper|holdeplass|kantstein|trafikkoy|nedsenka)$/.test(f.properties.t)).map(f => ({ kind: "nvdb", t: f.properties.t, props: f.properties, geo: f.geometry, src: "nvdb" }))];
}

/* Ponds, lakes and rivers in a box (server /api/water: OSM, clipped to the box), as hagekart doc.water entries. */
let waFor = "", waP = null;
export function loadWater(bbox, { base = "" } = {}) {
  const q = boxQ(bbox), k = `${base}|${q}`;
  if (waFor === k && waP) return waP;
  waFor = k;
  return waP = fetch(`${api(base)}water?bbox=${q}`).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
    .then(j => j.features.map(f => ({ kind: f.properties.kind === "pond" ? "lake" : f.properties.kind, ring: f.geometry.coordinates[0], holes: f.geometry.coordinates.slice(1), src: "osm", osm: f.properties.osm, name: f.properties.name })))
    .catch(e => { waP = null; waFor = ""; throw e; });
}

/* The streets as the flat map draws them: carriageways, footways and car parks as surfaces, a kerb line where the road has one (and where NVDB
   measured one), fences and walls as lines, crossings and centre lines as white marks. colorOf(surface) is the plan's own surface colour. */
export function roadFeatures(list, colorOf, toUtm, toLngLat) {
  const out = [], f = (t, geometry, props = {}) => out.push({ type: "Feature", properties: { t, ...props }, geometry });
  for (const p of list || []) {
    if (p.kind === "nvdb") {
      if (p.t === "kantstein" && p.geo) f("kerb", p.geo);
      else if ((p.t === "gangfelt" || p.t === "linje") && p.geo) f("mark", p.geo);
      continue;
    }
    if (p.kind === "parking") { if (p.ring?.length > 3) f("parking", { type: "Polygon", coordinates: [p.ring] }, { c: colorOf(p.surface), kerb: !!p.kerb }); continue; }
    if (!p.pts || p.pts.length < 2) continue;
    if (p.kind === "fence") { f(p.type === "mur" ? "wall" : "fence", { type: "LineString", coordinates: p.pts }); continue; }
    if (p.kind === "tram") { f("tram", { type: "LineString", coordinates: p.pts }); continue; }
    if (p.kind !== "road" && p.kind !== "path") continue;
    const r = pathRing(p.pts.map(toUtm), p.width || 2, 0.7); if (r.length < 4) continue;
    f(p.kind, { type: "Polygon", coordinates: [r.map(toLngLat)] }, { c: colorOf(p.surface), kerb: !!p.kerb || p.raise > 0 });
  }
  return { type: "FeatureCollection", features: out };
}
