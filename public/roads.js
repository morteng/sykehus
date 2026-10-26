/* A road section taken away from the after (U3543, Morten 2026-10-25 19:26Z «same with road sections»; yes 2026-10-26
   09:47Z), as a building is torn down (U3542): { kind: "demolish", building: "vei-osm-24365596", name? }, the way's id in
   the streets hagekart fetches (OSM's way id, or NVDB's object id for a measured carriageway). The streets are fetched
   anew each day (gater.mjs); a removal names the way by that id, so it is kept over every fetch, and a way the source no
   longer has is simply not drawn. A restore with the same id, or the edit taken out (Angre), puts it back.

   Pure: no DOM, no three.js; the page (streets.js, app.js) and the server (design.js) share it. */
export const ROAD_ID = /^vei-(osm|nvdb)-\d+$/;

/* the edit, checked: the id by its shape (the server does not hold the streets the page drew), the name the page saw */
export function checkRoadEdit(e, str) {
  const id = String(e.building ?? "").trim();
  if (!ROAD_ID.test(id)) throw new Error(`«${id}» er ikke en veistrekning (vei-osm-… eller vei-nvdb-…)`);
  const out = { kind: e.kind, building: id };
  if (e.name != null && String(e.name).trim()) out.name = str(String(e.name).trim(), 80, "Navnet");
  if (e.why != null) out.why = str(e.why, 300, "Begrunnelsen");
  return out;
}

/* the after's removed road sections, in the order they went: site.roads_removed [{ id, name }] */
export function applyRoads(site, edits) {
  const gone = new Map();
  for (const e of edits) {
    if (!ROAD_ID.test(String(e.building ?? ""))) continue;
    if (e.kind === "demolish") gone.set(e.building, { id: e.building, name: e.name || null });
    else if (e.kind === "restore") gone.delete(e.building);
  }
  if (gone.size) site.roads_removed = [...gone.values()];
}

/* what a way is, in plain words (gater.mjs says the same to Anton) */
export const wayKind = p => p.kind === "parking" ? "parkeringsplass" : p.kind === "road" ? (p.type === "adkomst" ? "adkomstvei" : "kjørevei")
  : p.type === "gangsykkel" ? "gang- og sykkelvei" : p.raise ? "fortau" : p.cross ? "gangfelt" : p.width <= 1.2 ? "sti" : "gangvei";

/* the streets as renderkit's streetsFrom made them (sts), each way given its id and name from the answer it came
   from, and each NVDB marking the way it lies on (on), so the page can hide a removed way and what is painted on it.
   streetsFrom keeps a feature's coordinates (and an NVDB feature's geometry) as they came, so they find it again. */
export function tagStreets(osm, nv, sts, toUtm) {
  const byCoords = new Map(), byGeo = new Map();
  for (const f of osm?.features || []) if (f.geometry && f.properties?.osm != null) byCoords.set(f.geometry.coordinates, { id: `vei-osm-${f.properties.osm}`, name: f.properties.name || null, f });
  for (const f of nv?.features || []) if (f.geometry && f.properties?.nvdb != null) { byCoords.set(f.geometry.coordinates, { id: `vei-nvdb-${f.properties.nvdb}`, name: null, f }); byGeo.set(f.geometry, f); }
  /* a measured carriageway (NVDB) takes the name of the OSM street it replaced: the one most of its points lie on */
  const named = (osm?.features || []).filter(f => f.properties?.name && f.properties.highway && f.geometry?.type === "LineString").map(f => ({ name: f.properties.name, l: f.geometry.coordinates.map(toUtm) }));
  const near = (q, l) => l.some(r => Math.hypot(r[0] - q[0], r[1] - q[1]) < 12);
  const ways = [];
  for (const p of sts) {
    if (!["road", "path", "parking"].includes(p.kind)) continue;
    const t = byCoords.get(p.ring || p.pts); if (!t) continue;
    p.id = t.id;
    let name = t.name;
    if (!name && p.src === "nvdb") { const pts = p.pts.map(toUtm); name = named.map(n => ({ n, k: pts.filter(q => near(q, n.l)).length })).sort((a, b) => b.k - a.k).find(x => x.k > pts.length / 2)?.n.name || null; }
    p.name = name; ways.push(p);
  }
  /* the markings and kerbs NVDB paints on a carriageway: the way under their first point */
  const roads = ways.filter(p => p.kind === "road" && p.pts).map(p => ({ id: p.id, l: p.pts.map(toUtm), hw: (p.width || 5) / 2 + 1.5 }));
  const segD = ([x, y], l) => { let m = 1e9; for (let i = 0; i + 1 < l.length; i++) { const [ax, ay] = l[i], [bx, by] = l[i + 1], dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1))); m = Math.min(m, Math.hypot(x - ax - t * dx, y - ay - t * dy)); } return m; };
  for (const p of sts) if (p.kind === "nvdb" && p.t !== "holdeplass") {
    const g = p.geo, first = g.type === "Point" ? g.coordinates : g.type === "LineString" ? g.coordinates[Math.floor(g.coordinates.length / 2)] : g.type === "Polygon" ? g.coordinates[0][0] : null;
    if (!first) continue;
    const q = toUtm(first), best = roads.map(r => ({ r, d: segD(q, r.l) })).filter(x => x.d < x.r.hw).sort((a, b) => a.d - b.d)[0];
    if (best) p.on = best.r.id;
  }
  return ways;
}
