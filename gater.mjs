/* The streets around the site for the page (public/streets.js, U3530), fetched here from hagekart's open /api/streets
   and /api/nvdb: the page's Content-Security-Policy (set at the edge) lets it fetch from its own origin only. Served
   at /gater/api/streets and /gater/api/nvdb, outside /api (the edge's login gate is there), for the site's own box
   only (siteBox), so this is not a way to ask hagekart for anything else. Kept a day; a failed fetch keeps the last. */
import { siteBox, siteGrid } from "./public/utm.js";
import { streetsFrom } from "./public/renderkit/streets.js";
import { tagStreets, wayRingsOf } from "./public/roads.js";

const DAY = 864e5;
export function createStreets({ site, SECURITY = {}, upstream = process.env.SYKEHUS_STREETS_URL || "https://hagekart.gulden.no", fetchImpl = fetch } = {}) {
  const box = siteBox(site).map(v => v.toFixed(6)).join(","), kept = new Map();
  async function get(kind) {
    const k = kept.get(kind);
    if (k && Date.now() - k.at < DAY) return k.body;
    try {
      const r = await fetchImpl(`${upstream.replace(/\/$/, "")}/api/${kind}?bbox=${box}`, { signal: AbortSignal.timeout(60000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const body = Buffer.from(await r.arrayBuffer()); JSON.parse(body.toString("utf8"));
      kept.set(kind, { at: Date.now(), body }); return body;
    } catch (e) { console.warn(`gater ${kind}:`, e.message); return k?.body ?? null; }
  }
  /* the ways there are today as rings on the site, for the fit of a new surface (finding 6: a pool laid over a
     footpath): footpaths, cycleways, pavements, roads and car parks, from the same answers the page draws. Waits at most
     ms for them (a change is not held up by hagekart); the last made are kept */
  const grid = siteGrid(site.origin), toUtm = q => grid.fromLngLat(q);
  let ways = null, waysOf = null;
  /* each with its id (roads.js tagStreets), so a version's removed road sections are left out (U3543) */
  function wayRings(osm, nv) {
    const sts = streetsFrom(osm, nv, toUtm); tagStreets(osm, nv, sts, toUtm);
    return wayRingsOf(sts, toUtm);
  }
  /* U3527: the named streets and places around (OpenStreetMap's name), each as its points on the site, roads marked:
     where a shot «fra Dronninggata» stands. From the same answer the page draws; the last made are kept */
  let places = null, placesOf = null;
  function namedPlaces(osm) {
    const by = new Map();
    for (const f of osm.features || []) {
      const n = f.properties?.name, g = f.geometry; if (!n || !g) continue;
      const lines = g.type === "LineString" ? [g.coordinates] : g.type === "Polygon" ? [g.coordinates[0]] : g.type === "MultiLineString" ? g.coordinates : [];
      const o = by.get(n) || by.set(n, { name: n, pts: [], road: false }).get(n);
      if (f.properties.highway && !/^(footway|path|steps|cycleway|service)$/.test(f.properties.highway)) o.road = true;
      for (const l of lines) for (let i = 0; i + 1 < l.length; i++) {
        const a = toUtm(l[i]), b = toUtm(l[i + 1]), k = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 5));
        for (let j = 0; j < k; j++) o.pts.push([a[0] + (b[0] - a[0]) * j / k, a[1] + (b[1] - a[1]) * j / k]);
      }
    }
    return [...by.values()].filter(o => o.pts.length);
  }
  return {
    async places(ms = 3000) {
      const made = get("streets").then(a => {
        if (!a) return places || []; if (placesOf === a) return places;
        try { places = namedPlaces(JSON.parse(a.toString("utf8"))); placesOf = a; } catch (e) { console.warn("gater places:", e.message); }
        return places || [];
      });
      return Promise.race([made, new Promise(ok => setTimeout(() => ok(places || []), ms).unref?.())]);
    },
    async ways(ms = 3000) {
      const made = Promise.all([get("streets"), get("nvdb")]).then(([a, b]) => {
        if (!a || !b) return ways || []; if (waysOf === a) return ways;
        try { ways = wayRings(JSON.parse(a.toString("utf8")), JSON.parse(b.toString("utf8"))); waysOf = a; } catch (e) { console.warn("gater ways:", e.message); }
        return ways || [];
      });
      return Promise.race([made, new Promise(ok => setTimeout(() => ok(ways || []), ms).unref?.())]);
    },
    async route(req, res, path, url) {
      const m = /^\/gater\/api\/(streets|nvdb)$/.exec(path); if (!m) return false;
      if (req.method !== "GET" || url.searchParams.get("bbox") !== box) { res.writeHead(400, { ...SECURITY, "content-type": "text/plain; charset=utf-8" }).end("Bare tomtas eget område"); return true; }
      const body = await get(m[1]);
      if (!body) { res.writeHead(502, { ...SECURITY, "content-type": "text/plain; charset=utf-8" }).end("Gatene kom ikke"); return true; }
      res.writeHead(200, { ...SECURITY, "content-type": "application/json", "cache-control": "public, max-age=3600" }).end(body);
      return true;
    },
  };
}
