/* The streets around the site for the page (public/streets.js, U3530), fetched here from hagekart's open /api/streets
   and /api/nvdb: the page's Content-Security-Policy (set at the edge) lets it fetch from its own origin only. Served
   at /gater/api/streets and /gater/api/nvdb, outside /api (the edge's login gate is there), for the site's own box
   only (siteBox), so this is not a way to ask hagekart for anything else. Kept a day; a failed fetch keeps the last. */
import { siteBox, siteGrid } from "./public/utm.js";
import { streetsFrom } from "./public/renderkit/streets.js";
import { pathRing } from "./public/renderkit/paths2d.js";

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
  const NAME = p => p.kind === "parking" ? "parkeringsplass" : p.kind === "road" ? (p.type === "adkomst" ? "adkomstvei" : "kjørevei")
    : p.type === "gangsykkel" ? "gang- og sykkelvei" : p.raise ? "fortau" : p.cross ? "gangfelt" : p.width <= 1.2 ? "sti" : "gangvei";
  function wayRings(osm, nv) {
    return streetsFrom(osm, nv, toUtm).filter(p => ["path", "road", "parking"].includes(p.kind)).map(p => {
      const ring = p.ring ? p.ring.map(toUtm) : pathRing(p.pts.map(toUtm), p.width || 2);
      return { name: `${NAME(p)}${p.ring ? "" : `, ${String(Math.round((p.width || 2) * 10) / 10).replace(".", ",")} m bred`} (${p.src === "nvdb" ? "NVDB" : "OSM"})`, ring };
    }).filter(w => w.ring.length > 2);
  }
  return {
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
