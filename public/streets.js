/* The streets around the site, as hagekart draws them (U3530): roads with their kerbs and markings, pavements, paths,
   fences, walls, car parks, lamps and benches, from OSM and NVDB through hagekart's open /api/streets and /api/nvdb,
   drawn by renderkit's streets3d.js (taken by renderkit.lock.json). Fetched after the model shows; anything that goes
   wrong leaves the site without streets.

   The frame streets3d.js draws on, here in site metres: L([x, y]) → [x, -y] (three's x and z), ground(x, y) the
   terrain under it (between the grid's points, as the terrain's mesh lies), cellAt(x, y) ≥ 0 on the terrain's grid,
   toUtm([lon, lat]) → [east, north] on the site (utm.js), streetCtx what streets3d.js needs to know about the
   streets together. The loop that cuts each street to the grid is hagekart's (public/garden3d.js at e636f49). */
import * as THREE from "./vendor/three.module.js";
import { loadStreets } from "./renderkit/streets.js";
import { createStreetMeshes, streetContext } from "./renderkit/streets3d.js";
import { siteGrid } from "./utm.js";

export const STREETS_API = "https://hagekart.gulden.no";

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
  const corners = [[T.x0, T.y1], [T.x0 + T.w * T.res, T.y1], [T.x0, T.y1 - T.h * T.res], [T.x0 + T.w * T.res, T.y1 - T.h * T.res]].map(grid.toLngLat);
  const bbox = [Math.min(...corners.map(p => p[1])), Math.min(...corners.map(p => p[0])), Math.max(...corners.map(p => p[1])), Math.max(...corners.map(p => p[0]))];
  const sts = await loadStreets(bbox, { toUtm: F.toUtm, base: api });
  if (!sts.length) return null;
  F.streetCtx = streetContext(F, sts);
  F.streetCtx.trunks = (site.trees || []).filter(t => t[2] >= 4).map(([x, y, h]) => ({ x, y, r: Math.min(0.6, 0.12 + 0.02 * h) }));
  const M = createStreetMeshes({ PATHLIFT: 0.08 });   // a little over hagekart's 4,5 cm: this terrain is a 2 m grid, not a garden's
  const g = new THREE.Group(); g.name = "streets";
  const put = o => { if (!o) return; o.traverse(m => { if (m.isMesh) m.receiveShadow = true; }); g.add(o); };
  const cut = pts => { const runs = []; let cur = []; for (const q of pts) { const [x, y] = F.toUtm(q); if (F.cellAt(x, y) >= 0) cur.push(q); else { if (cur.length > 1) runs.push(cur); cur = []; } } if (cur.length > 1) runs.push(cur); return runs; };
  for (const st of sts.filter(q => q.kind === "poi")) put(M.furnitureMesh(F, st));
  for (const st of sts.filter(q => q.kind === "nvdb")) {
    if (st.t === "holdeplass") { put(M.furnitureMesh(F, { type: "busstop", pt: st.geo.type === "Point" ? st.geo.coordinates : st.geo.coordinates[0], shelter: false })); continue; }
    put(M.nvdbMesh(F, st));
  }
  for (const st of sts.filter(q => q.kind === "parking")) put(M.pathMesh(F, st));
  for (const st of sts.filter(q => q.kind !== "poi" && q.kind !== "nvdb" && q.kind !== "parking")) for (const run of cut(st.pts)) put(M.pathMesh(F, { ...st, pts: run }));
  viewer.add(g);
  return g;
}
