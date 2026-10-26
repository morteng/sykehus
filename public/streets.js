/* The streets around the site, as hagekart draws them (U3530): roads with their kerbs and markings, pavements, paths,
   fences, walls, car parks, lamps and benches, from OSM and NVDB through hagekart's open /api/streets and /api/nvdb
   (fetched by this server, gater.mjs),
   drawn by renderkit's streets3d.js (taken by renderkit.lock.json). Fetched after the model shows; anything that goes
   wrong leaves the site without streets.

   The frame streets3d.js draws on, here in site metres: L([x, y]) → [x, -y] (three's x and z), ground(x, y) the
   terrain under it (between the grid's points, as the terrain's mesh lies), cellAt(x, y) ≥ 0 on the terrain's grid,
   toUtm([lon, lat]) → [east, north] on the site (utm.js), streetCtx what streets3d.js needs to know about the
   streets together. The loop that cuts each street to the grid is hagekart's (public/garden3d.js at e636f49). */
import * as THREE from "./vendor/three.module.js";
import { loadRaw, streetsFrom } from "./renderkit/streets.js";
import { pathRing } from "./renderkit/paths2d.js";
import { tagStreets, wayKind } from "./roads.js";
import { createStreetMeshes, streetContext } from "./renderkit/streets3d.js";
import { siteGrid, siteBox } from "./utm.js?v=20261025b";

/* through this server (gater.mjs): the page's Content-Security-Policy lets it fetch from its own origin only */
export const STREETS_API = "/gater";

export async function addStreets({ viewer, site, api = STREETS_API }) {
  const T = site.terrain, low = Math.min(...T.z.filter(v => v != null)), grid = siteGrid(site.origin);
  const z = (c, r) => T.z[Math.max(0, Math.min(T.h - 1, r)) * T.w + Math.max(0, Math.min(T.w - 1, c))] ?? low;
  const F = {
    L: ([x, y]) => [x, -y],
    ground(x, y) {   // the terrain's mesh has its points at the cells' middles, 5 cm down
      const u = (x - T.x0) / T.res - 0.5, v = (T.y1 - y) / T.res - 0.5, c = Math.floor(u), r = Math.floor(v), s = u - c, t = v - r;
      return (z(c, r) * (1 - s) + z(c + 1, r) * s) * (1 - t) + (z(c, r + 1) * (1 - s) + z(c + 1, r + 1) * s) * t - low - 0.05;
    },
    cellAt(x, y) { const c = Math.floor((x - T.x0) / T.res), r = Math.floor((T.y1 - y) / T.res); return c < 0 || r < 0 || c >= T.w || r >= T.h ? -1 : r * T.w + c; },
    toUtm: q => grid.fromLngLat(q),
  };
  /* each way with its id and name (roads.js), so one can be picked and taken away (U3543) */
  const [osm, nv] = await loadRaw(siteBox(site), api), sts = streetsFrom(osm, nv, F.toUtm), ways = tagStreets(osm, nv, sts, F.toUtm);
  if (!sts.length) return null;
  F.streetCtx = streetContext(F, sts);
  F.streetCtx.trunks = (site.trees || []).filter(t => t[2] >= 4).map(([x, y, h]) => ({ x, y, r: Math.min(0.6, 0.12 + 0.02 * h) }));
  const M = createStreetMeshes({ PATHLIFT: 0.08 });   // a little over hagekart's 4,5 cm: this terrain is a 2 m grid, not a garden's
  const g = new THREE.Group(); g.name = "streets";
  /* a way's meshes in a group of its own (its id, what it is, its outline on the site), the markings on it in another */
  const byId = new Map(), marks = new Map();
  const holder = (map, id) => { let h = map.get(id); if (!h) { h = new THREE.Group(); map.set(id, h); g.add(h); } return h; };
  const put = (o, id = null, on = null) => { if (!o) return; o.traverse(m => { if (m.isMesh) m.receiveShadow = true; }); (id ? holder(byId, id) : on ? holder(marks, on) : g).add(o); };
  const cut = pts => { const runs = []; let cur = []; for (const q of pts) { const [x, y] = F.toUtm(q); if (F.cellAt(x, y) >= 0) cur.push(q); else { if (cur.length > 1) runs.push(cur); cur = []; } } if (cur.length > 1) runs.push(cur); return runs; };
  for (const st of sts.filter(q => q.kind === "poi")) put(M.furnitureMesh(F, st));
  for (const st of sts.filter(q => q.kind === "nvdb")) {
    if (st.t === "holdeplass") { put(M.furnitureMesh(F, { type: "busstop", pt: st.geo.type === "Point" ? st.geo.coordinates : st.geo.coordinates[0], shelter: false })); continue; }
    put(M.nvdbMesh(F, st), null, st.on);
  }
  for (const st of sts.filter(q => q.kind === "parking")) put(M.pathMesh(F, st), st.id);
  for (const st of sts.filter(q => q.kind !== "poi" && q.kind !== "nvdb" && q.kind !== "parking")) for (const run of cut(st.pts)) put(M.pathMesh(F, { ...st, pts: run }), st.id);
  /* what the page tells of a way: its name, what it is, how long and wide, its outline on the site */
  const len = l => l.reduce((a, p, i) => i ? a + Math.hypot(p[0] - l[i - 1][0], p[1] - l[i - 1][1]) : 0, 0);
  for (const w of ways) {
    const h = byId.get(w.id); if (!h) continue;
    const line = w.pts ? w.pts.map(F.toUtm).filter(([x, y]) => F.cellAt(x, y) >= 0) : null, ring = w.ring ? w.ring.map(F.toUtm) : line?.length > 1 ? pathRing(line, w.width || 2) : null;
    if (!ring?.length) continue;
    h.userData = { id: w.id, ring, lift: 0.1, road: { id: w.id, name: w.name, what: wayKind(w), width: w.ring ? null : w.width, length_m: line ? Math.round(len(line) * 10) / 10 : null, ring, line, src: w.src } };
    h.traverse(o => { o.userData.id = w.id; });
  }
  viewer.add(g);
  viewer.setRoads?.(new Map([...byId].filter(([, h]) => h.userData.road)));
  return {
    group: g,
    /* the after's removed road sections (site.roads_removed): hidden, with what is painted on them */
    setRemoved(ids) { const off = new Set(ids); for (const [id, h] of byId) h.visible = !off.has(id); for (const [id, h] of marks) h.visible = !off.has(id); viewer.redraw(); },
  };
}
