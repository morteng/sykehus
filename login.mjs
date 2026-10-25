/* Signing in on sykehus.gulden.no itself, for Anton's pill: Morten makes a 4-digit code in gulden-ai (Settings ›
   People) and reads it to the person on the phone; they type it here. This server hands the digits and a device label
   to gulden-ai's internal door, which checks them (10 minutes, once, 5 wrong tries void it) and answers with the person
   and a device id, or a refusal. This server then keeps its own signed cookie on that machine for 90 days.

     POST /api/logg-inn  {code, device}   → {person} and the cookie, or 400/401/429 with {error}
     GET  /api/meg                        → {person} or {person: null}; {anton: true} when the assistant is wired
     POST /api/logg-ut                    → clears the cookie

   The cookie, "sykehus", is <base64url {p: person, d: device id, e: expiry seconds}>.<HMAC-SHA256> with
   SYKEHUS_COOKIE_SECRET; HttpOnly, Secure (but on localhost), SameSite=Lax. It counts on the page's own /api routes
   only, never on /mcp, so another site cannot make a browser change versions through it.

   Someone signed in on gulden.no needs no code: the edge's forward_auth passes their login on as Remote-User with the
   proxy secret (auth.mjs proxyUser), and that counts here too, as the device "gulden.no" (the cookie wins when both).

   Env: SYKEHUS_COOKIE_SECRET (32+ characters), SYKEHUS_ASSISTANT_URL (gulden-ai's internal base URL),
   SYKEHUS_ASSISTANT_TOKEN (the bearer for it), SYKEHUS_CODE_PATH (default /internal/sykehus/code; the exact route comes
   from gulden-ai's builder). */
import { createHmac, timingSafeEqual } from "node:crypto";

const NAME = "sykehus", TTL = 90 * 86400;
const LOGIN = /^[A-Za-z0-9._@-]{1,64}$/;

export function createLogin({ SECURITY, readJson, proxyUser = () => null, fetchImpl = fetch }) {
  const secret = process.env.SYKEHUS_COOKIE_SECRET || "";
  const base = (process.env.SYKEHUS_ASSISTANT_URL || "").replace(/\/+$/, ""), bearer = process.env.SYKEHUS_ASSISTANT_TOKEN || "";
  const codePath = process.env.SYKEHUS_CODE_PATH || "/internal/sykehus/code";
  const anton = !!base && !!bearer, ready = secret.length >= 32 && anton;   // ready: codes can be typed here; anton: the pill
  const send = (res, code, body, headers = {}) => { res.writeHead(code, { ...SECURITY, "content-type": "application/json", "cache-control": "no-store", ...headers }); res.end(JSON.stringify(body)); };
  const mac = s => createHmac("sha256", secret).update(s).digest("base64url");
  const local = req => /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host || "");
  const cookie = (req, value, age) => `${NAME}=${value}; Path=/; Max-Age=${age}; HttpOnly; SameSite=Lax${local(req) ? "" : "; Secure"}`;

  /* who this browser is: {person, device} from a good, unexpired cookie, else null */
  function personOf(req) {
    return cookieOf(req) ?? (p => p ? { person: p, device: "gulden.no", via: "gulden.no" } : null)(proxyUser(req));
  }
  function cookieOf(req) {
    if (!secret) return null;
    const m = new RegExp(`(?:^|;\\s*)${NAME}=([A-Za-z0-9_-]+)\\.([A-Za-z0-9_-]+)`).exec(req.headers.cookie || "");
    if (!m) return null;
    const want = Buffer.from(mac(m[1])), got = Buffer.from(m[2]);
    if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
    try { const c = JSON.parse(Buffer.from(m[1], "base64url").toString("utf8")); return c.e > Date.now() / 1000 && LOGIN.test(c.p) && typeof c.d === "string" ? { person: c.p, device: c.d } : null; } catch { return null; }
  }
  const signed = c => { const b = Buffer.from(JSON.stringify(c)).toString("base64url"); return `${b}.${mac(b)}`; };
  const forget = (req, res) => res.setHeader("set-cookie", cookie(req, "", 0));

  // tries per address: 10 an hour, on top of gulden-ai's own 5 per code
  const tries = new Map();
  const ipOf = req => String(req.headers["x-forwarded-for"] || "").split(",").map(s => s.trim()).filter(Boolean).at(-1) || req.socket?.remoteAddress || "?";
  function tooMany(req) {
    const k = ipOf(req), now = Date.now(), t = tries.get(k);
    if (!t || now - t.at > 3600e3) { tries.set(k, { at: now, n: 1 }); return false; }
    return ++t.n > 10;
  }

  async function signIn(req, res) {
    if (req.headers.origin && !/^https?:\/\//.test(req.headers.origin) || req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return send(res, 403, { error: "Feil opphav" });
    if (!ready) return send(res, 503, { error: "Innlogging er ikke satt opp ennå." });
    if (tooMany(req)) return send(res, 429, { error: "For mange forsøk. Vent en time, eller ring Morten." });
    let b; try { b = await readJson(req, 2000); } catch { return send(res, 400, { error: "Skriv de fire sifrene." }); }
    const code = String(b?.code ?? "").replace(/\s+/g, ""), device = String(b?.device ?? "").slice(0, 80) || "nettleser";
    if (!/^\d{4}$/.test(code)) return send(res, 400, { error: "Koden er fire sifre." });
    let r, j = {};
    try {
      r = await fetchImpl(base + codePath, { method: "POST", headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" }, body: JSON.stringify({ code, device, app: "sykehus" }), signal: AbortSignal.timeout(10000) });
      j = await r.json().catch(() => ({}));
    } catch (e) { console.error("logg-inn:", e.message); return send(res, 503, { error: "Fikk ikke kontakt. Prøv igjen om litt." }); }
    if (!r.ok || !LOGIN.test(String(j.person || "")) || typeof j.device_id !== "string" || !j.device_id) return send(res, 401, { error: "Koden stemmer ikke, eller den er for gammel. Be om en ny." });
    res.setHeader("set-cookie", cookie(req, signed({ p: j.person, d: j.device_id.slice(0, 80), e: Math.floor(Date.now() / 1000) + TTL }), TTL));
    return send(res, 200, { person: j.person, name: typeof j.name === "string" ? j.name.slice(0, 80) : null });
  }

  /* true when the request was ours */
  async function route(req, res, path) {
    if (path === "/api/logg-inn" && req.method === "POST") { await signIn(req, res); return true; }
    if (path === "/api/meg" && req.method === "GET") { const p = personOf(req); send(res, 200, { person: p?.person ?? null, via: p?.via ?? (p ? "kode" : null), login: ready, anton }); return true; }
    if (path === "/api/logg-ut" && req.method === "POST") { forget(req, res); send(res, 200, { person: null }); return true; }
    return false;
  }
  return { personOf, forget, route, ready, anton, base, bearer };
}
