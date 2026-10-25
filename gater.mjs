/* The streets around the site for the page (public/streets.js, U3530), fetched here from hagekart's open /api/streets
   and /api/nvdb: the page's Content-Security-Policy (set at the edge) lets it fetch from its own origin only. Served
   at /gater/api/streets and /gater/api/nvdb, outside /api (the edge's login gate is there), for the site's own box
   only (siteBox), so this is not a way to ask hagekart for anything else. Kept a day; a failed fetch keeps the last. */
import { siteBox } from "./public/utm.js";

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
  return {
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
