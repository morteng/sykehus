/* U3886: the snow on the ground at the site today, from NVE's seNorge grid (theme "sd", snow depth in cm, which NVE's reply names in its "Unit"), the same source and
   URL shape hagekart's /api/weather reads (server.mjs NVE_THEMES). NVE's grid API has no CORS header, so the page asks here
   with its UTM33 point (utm.js) and this asks NVE. GET /api/snoe?x=&y= -> { mm, date, src } or { mm: null } when NVE has no
   cell or does not answer. Kept an hour per 100 m cell. Shape noted from hagekart's reading: {Data:[per day], NoDataValue}. */
const HOUR = 36e5;
export function createSnow({ SECURITY = {}, fetchImpl = fetch, now = Date.now, days = 4 } = {}) {
  const kept = new Map();
  const oslo = t => new Date(t).toLocaleDateString("sv-SE", { timeZone: "Europe/Oslo" });
  async function depth(x, y) {
    if (!(x > -100000 && x < 1200000 && y > 6400000 && y < 8000000)) throw Object.assign(new Error("Utenfor Norge"), { code: 400 });
    const key = `${Math.round(x / 100)},${Math.round(y / 100)}`, hit = kept.get(key);
    if (hit && now() - hit.at < HOUR) return hit.out;
    const from = oslo(now() - (days - 1) * 864e5), to = oslo(now());
    let out = { mm: null };
    try {
      const r = await fetchImpl(`https://gts.nve.no/api/GridTimeSeries/${Math.round(x)}/${Math.round(y)}/${from}/${to}/sd.json`, { signal: AbortSignal.timeout(15000) });
      if (r.ok) {
        const j = await r.json(), data = Array.isArray(j?.Data) ? j.Data : [];
        for (let i = data.length - 1; i >= 0; i--) if (typeof data[i] === "number" && data[i] !== j.NoDataValue) { out = { mm: Math.max(0, data[i]) * 10, date: oslo(now() - (data.length - 1 - i) * 864e5), src: "NVE seNorge" }; break; }
      }
    } catch { /* NVE did not answer: no snow is known, and it is not kept */ return out; }
    kept.set(key, { at: now(), out }); return out;
  }
  async function route(req, res, path, url) {
    if (path !== "/api/snoe") return false;
    try {
      const out = await depth(+url.searchParams.get("x"), +url.searchParams.get("y"));
      res.writeHead(200, { ...SECURITY, "content-type": "application/json", "cache-control": "no-cache" }).end(JSON.stringify(out));
    } catch (e) { res.writeHead(e.code || 502, { ...SECURITY, "content-type": "application/json" }).end(JSON.stringify({ error: e.message })); }
    return true;
  }
  return { depth, route };
}
