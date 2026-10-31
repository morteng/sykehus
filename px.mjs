/* A person's own picture through the stack's scaler (U3992; the path is gulden-no U3991, runbooks/pictures.md). The page asks an app route for
   `<picture>?w=<bucket>`; the route decides who may see it as it always did and answers a redirect to a SIGNED scaler address, made here with
   the kit's signed() (public/kit/picture-signed.js: one signer for every Node app). The scaler checks the signature and the expiry; Caddy's
   @pxs asks /px-may before it lets the address through; the scaler then fetches the bytes from /internal/px-src/, which only it reaches.

     GET /px-may                                   Caddy's forward_auth: 200 only for a person who may open the picture the address names
     GET /internal/px-src/<kind>/<a>/<b>[/<key>]   the bytes, for the scaler only (a request that came through the edge is not found)

   kind    a, b                  who may open it                                              source of the bytes
   foto    photo id, size        the person who added it                                      sitephotos.mjs
   bilde   version, render id    the Prospekt's viewers (shared, key in the 4th part, owner)   gjengi.mjs
   modell  version, still id     the same                                                      mcp.mjs stills (PNG; the scaler cuts and encodes)
   forslag version, stamp        whoever may see the version (key in the 4th part)             mcp.mjs card picture
   gjengi  picture id, ext       the person who made it, or the version's owner or any viewer of a public one   gjengi.mjs
   skisse  sketch id, p          the person Anton drew it for                                  mcp.mjs sketches

   No key (SYKEHUS_PX_KEY / SYKEHUS_PX_SALT, hex, the app's pair in the scaler's lists): no redirect, the route answers the file as it is. */
import { signed, pxExp } from "./public/kit/picture-signed.js";

export const ORIGIN = "http://sykehus-mcp:8090";
const PART = /^[A-Za-z0-9_-]{1,64}$/, KINDS = ["foto", "bilde", "modell", "forslag", "gjengi", "skisse"];
const SRC = new RegExp(`/internal/px-src/(${KINDS.join("|")})/([A-Za-z0-9_-]{1,64})/([A-Za-z0-9_-]{1,64})(?:/([A-Za-z0-9_-]{1,64}))?$`);

export function createPx({ SECURITY = {}, personOf = () => null, sources = {}, key = process.env.SYKEHUS_PX_KEY || "", salt = process.env.SYKEHUS_PX_SALT || "", clock = () => Date.now() / 1000 } = {}) {
  const enabled = !!key && !!salt;
  /* the signed scaler address of one picture at width w, or null (no key, a part the address cannot carry, a width of 0) */
  async function url(kind, a, b, w, nokkel = null) {
    if (!enabled || !KINDS.includes(kind) || !(w > 0) || ![a, b].every(p => PART.test(String(p))) || (nokkel != null && !PART.test(String(nokkel)))) return null;
    try { return await signed(`/internal/px-src/${kind}/${a}/${b}${nokkel ? `/${nokkel}` : ""}`, w, ORIGIN, key, salt, pxExp(clock())); } catch { return null; }
  }
  /* answer GET <route>?w=: a redirect to the signed address, true; false when the route should answer the file as it is */
  async function redirect(req, res, kind, a, b, url0, nokkel = null) {
    const w = +(url0.searchParams.get("w") ?? 0);
    const to = Number.isFinite(w) && w > 0 ? await url(kind, a, b, w, nokkel) : null;
    if (!to) return false;
    res.writeHead(302, { ...SECURITY, location: to, "cache-control": "private, max-age=3600", vary: "cookie" }); res.end();
    return true;
  }
  const text = (res, code, body) => res.writeHead(code, { ...SECURITY, "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }).end(body);
  async function route(req, res, path) {
    if (path === "/px-may") {
      const m = SRC.exec((req.headers["x-forwarded-uri"] || "").split("?")[0]), who = personOf(req)?.person ?? null;
      let ok = false; if (m) { try { ok = !!(await sources[m[1]]?.may(who, m[2], m[3], m[4] ?? null)); } catch { ok = false; } }
      if (ok) return res.writeHead(200, { "cache-control": "no-store" }).end(), true;
      return text(res, who ? 404 : 401, who ? "Not found." : "Not signed in."), true;
    }
    const m = path.startsWith("/internal/px-src/") ? SRC.exec(path) : null;
    if (!path.startsWith("/internal/px-src/")) return false;
    /* the scaler fetches with no person; anything that came through the edge (forwarding headers, a cookie) is not the scaler */
    if (!m || req.headers["x-forwarded-for"] || req.headers.cookie || req.headers["x-sykehus-proxy-auth"] || req.headers["remote-user"]) return text(res, 404, "Not found"), true;
    let got = null; try { got = await sources[m[1]]?.bytes(m[2], m[3], m[4] ?? null); } catch (e) { console.error("px-src:", m[1], e.message); }
    if (!got) return text(res, 404, "Not found"), true;
    res.writeHead(200, { ...SECURITY, "content-type": got.type, "content-length": got.bytes.length, "cache-control": "no-store" }).end(got.bytes);
    return true;
  }
  return { enabled, url, redirect, route };
}
