// Copied from hagekart fix/osm-building-relations e76a538 (osm-buildings.mjs), 2026-10-24. Keep in step until it moves to a shared module.
/* OSM buildings as polygons for /api/buildings. Pure, so tests can load it without the server (server.mjs listens when imported).
   Ways tagged building are outlines; multipolygon relations tagged building (large or complex buildings, a hospital, a school)
   are outlines too, their member ways joined into rings. building:part ways (Simple 3D Buildings) come as buildings of their own,
   with part: true, and the outline they stand on lists them in cut (lng/lat rings): the 3D leaves the laser readings under a part
   out of the outline's roof, so a 55 m tower over a two-storey wing is a tower, not one tall roof over both.
   Every feature is one ring (coordinates[0]), as the page reads them: a relation's courtyards are joined to its outer ring by a
   zero-width bridge through the building (a keyhole), so the courtyard is outside it for inRing, rasterize and the area. */
import { joinRings } from "./osm-rings.mjs";

const inRingLL = ([x, y], ring) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
const centre = ring => { const n = ring.length - 1; let x = 0, y = 0; for (let i = 0; i < n; i++) { x += ring[i][0]; y += ring[i][1]; } return [x / n, y / n]; };
const props = (t, osm) => ({ osm, building: t.building || "yes", levels: +t["building:levels"] || null, roofShape: t["roof:shape"] || null, height: parseFloat(t.height) || null });

/* Holes into the outer ring, as earcut does: from each hole's easternmost corner (easternmost hole first) straight east to the
   nearest edge of the ring so far, in along that bridge, round the hole and back out. */
const signed = r => { let s = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]); return s; };
export function keyhole(outer, holes) {
  let ring = outer.slice(0, -1);
  const turn = Math.sign(signed(ring));
  for (const hole of holes.slice().sort((a, b) => Math.max(...b.map(p => p[0])) - Math.max(...a.map(p => p[0])))) {
    let h = hole.slice(0, -1);
    if (Math.sign(signed(h)) === turn) h = h.reverse();         // a hole runs the other way round, so the shoelace area takes it off
    const m = h.reduce((k, p, i) => (p[0] > h[k][0] ? i : k), 0), [mx, my] = h[m];
    let best = Infinity, at = -1;
    for (let i = 0; i < ring.length; i++) {
      const [ax, ay] = ring[i], [bx, by] = ring[(i + 1) % ring.length];
      if ((ay > my) === (by > my)) continue;
      const x = ax + (bx - ax) * (my - ay) / (by - ay);
      if (x > mx && x < best) { best = x; at = i; }
    }
    if (at < 0) continue;                                         // not inside after all: leave it out
    const p = [best, my], round = [...h.slice(m), ...h.slice(0, m), h[m]];
    ring = [...ring.slice(0, at + 1), p, ...round, p, ...ring.slice(at + 1)];
  }
  return [...ring, ring[0]];
}

export function buildingFeatures(elements) {
  const ll = g => (g || []).filter(Boolean).map(p => [p.lon, p.lat]), outlines = [], parts = [];
  for (const el of elements) {
    const t = el.tags || {};
    if (el.type === "way" && el.geometry?.length > 3) {
      const ring = ll(el.geometry);
      if (t.building) outlines.push({ ring, p: props(t, el.id) });
      else if (t["building:part"] && t["building:part"] !== "no") parts.push({ ring, p: props(t, el.id) });
    } else if (el.type === "relation" && t.building && t.type === "multipolygon") {
      const m = el.members || [], inners = joinRings(m.filter(x => x.role === "inner").map(x => ll(x.geometry)));
      joinRings(m.filter(x => x.role === "outer" || x.role === "").map(x => ll(x.geometry))).forEach((ring, k) =>
        outlines.push({ ring: keyhole(ring, inners.filter(h => inRingLL(h[0], ring))), p: props(t, "r" + el.id + (k ? "-" + k : "")) }));
    }
  }
  /* a part belongs to the outline with most of its corners (at least half), or its centre; one with none (its building outside the box) is left out */
  const out = outlines.map(o => ({ type: "Feature", properties: { ...o.p }, geometry: { type: "Polygon", coordinates: [o.ring] } }));
  for (const pt of parts) {
    const c = centre(pt.ring), score = o => pt.ring.slice(0, -1).filter(p => inRingLL(p, o.ring)).length + (inRingLL(c, o.ring) ? pt.ring.length : 0);
    let k = -1, best = (pt.ring.length - 1) / 2 - 1e-9;
    outlines.forEach((o, i) => { const s = score(o); if (s > best) { best = s; k = i; } });
    if (k < 0) continue;
    const host = out[k].properties;
    (host.cut ||= []).push(pt.ring);
    out.push({ type: "Feature", properties: { ...pt.p, building: host.building, part: true }, geometry: { type: "Polygon", coordinates: [pt.ring] } });
  }
  return { type: "FeatureCollection", features: out };
}
