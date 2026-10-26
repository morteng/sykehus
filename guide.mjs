/* The guide's «seen», kept on the person (U3658, Morten 14:24Z: closed with the × once, it does not open by itself again,
   also on another device). The browser keeps the same in a cookie (public/tour.js); a signed-in person's is kept here too.
     GET  /api/guide   {seenIn, dismissed}: the version of the full tour seen (0: none) and whether it was closed with the ×
     POST /api/guide   {seenIn?, dismissed?}  raises seenIn, sets dismissed (never takes either back)
   One JSON file a person in SYKEHUS_VERSIONS_DIR/_guide/, written whole and renamed. */
import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const NAME = /^[A-Za-z0-9._@-]{1,64}$/;

export function createGuide({ dir = process.env.SYKEHUS_VERSIONS_DIR, SECURITY = {}, readJson, personOf = () => null } = {}) {
  if (!dir) return null;
  const home = join(dir, "_guide"); mkdirSync(home, { recursive: true });
  const send = (res, code, body) => { res.writeHead(code, { ...SECURITY, "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(body)); };
  const file = p => join(home, p + ".json");
  const get = p => { try { const j = JSON.parse(readFileSync(file(p), "utf8")); return { seenIn: Math.max(0, parseInt(j.seenIn, 10) || 0), dismissed: !!j.dismissed }; } catch { return { seenIn: 0, dismissed: false }; } };
  function put(p, { seenIn, dismissed }) {
    const was = get(p), now = { seenIn: Math.max(was.seenIn, Math.min(1000, parseInt(seenIn, 10) || 0)), dismissed: was.dismissed || dismissed === true };
    const f = file(p), t = f + ".tmp"; writeFileSync(t, JSON.stringify(now)); renameSync(t, f); return now;
  }
  async function route(req, res, path) {
    if (path !== "/api/guide") return false;
    const me = personOf(req)?.person ?? null;
    if (!me || !NAME.test(me)) { send(res, 401, { error: "signed_out" }); return true; }
    if (req.method === "GET") { send(res, 200, get(me)); return true; }
    if (req.method !== "POST") { send(res, 405, { error: "GET eller POST" }); return true; }
    if (req.headers.origin && (() => { try { return new URL(req.headers.origin).host !== req.headers.host; } catch { return true; } })()) { send(res, 403, { error: "Feil opphav" }); return true; }
    let b; try { b = await readJson(req, 2000); } catch { send(res, 400, { error: "Uleselig" }); return true; }
    send(res, 200, put(me, b || {})); return true;
  }
  return { route, get, put };
}
