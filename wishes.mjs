/* Wishes: what a person wants from Sykehustomta that it cannot do yet, sent to Morten (ruling 2026-10-25 17:15Z).
   From the connector (send_wish, after the agent asked «Skal jeg sende dette som et ønske?») or the page's «Ønsker».

   One JSON file a wish in SYKEHUS_VERSIONS_DIR/_wishes/, written whole and renamed, as versions.mjs does:
     { id: "w…", person, at (UTC ISO), text, tried, version, link, status: "ny" | "sett" | "laget" | "nei", note? }
   A person sees their own; the admins (SYKEHUS_ADMINS, default "morten") see all and set the status; pm reads all
   with SYKEHUS_ADMIN_TOKEN. When SYKEHUS_WISH_WEBHOOK is set, each new wish is POSTed there as JSON (pm wires it to
   Morten's notices); a failed POST is logged, the wish is kept anyway.

     GET  /api/onsker          your own, or all for an admin ({wishes, admin})
     POST /api/onsker          {text, tried?, version?}  a new wish, from the page
     POST /api/onsker/<id>     {status, note?}  an admin's answer */
import { readFileSync, writeFileSync, renameSync, readdirSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";

export const STATUS = ["ny", "sett", "laget", "nei"];
const PER_DAY = 20, ID = /^w[A-Za-z0-9_-]{10}$/;
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };

export function createWishes({ dir = process.env.SYKEHUS_VERSIONS_DIR, SECURITY = {}, readJson, personOf = () => null, fetchImpl = fetch } = {}) {
  if (!dir) return null;
  const home = join(dir, "_wishes"); mkdirSync(home, { recursive: true });
  const all = new Map(), sent = new Map();
  for (const f of readdirSync(home)) { if (!f.endsWith(".json")) continue; try { const w = JSON.parse(readFileSync(join(home, f), "utf8")); if (ID.test(w.id)) all.set(w.id, w); } catch (e) { console.error("wishes: skipping", f, e.message); } }
  const write = w => { const p = join(home, w.id + ".json"), t = p + ".tmp"; writeFileSync(t, JSON.stringify(w)); renameSync(t, p); };
  const admins = new Set((process.env.SYKEHUS_ADMINS ?? "morten").split(",").map(s => s.trim()).filter(Boolean));
  const isAdmin = p => !!p && admins.has(p);
  const out = w => ({ id: w.id, person: w.person, at: w.at, text: w.text, tried: w.tried || null, version: w.version || null, link: w.link || null, status: w.status, note: w.note || null });

  function add(person, { text, tried, version, link }) {
    const t = String(text ?? "").trim(); if (t.length < 3) throw new Error("Skriv hva du ønsker deg.");
    if (t.length > 4000) throw new Error("Høyst 4000 tegn.");
    const day = new Date().toISOString().slice(0, 10), k = person + day, n = (sent.get(k) || 0) + 1;
    if (n > PER_DAY) throw new Error(`Høyst ${PER_DAY} ønsker om dagen.`);
    sent.set(k, n); for (const key of sent.keys()) if (!key.endsWith(day)) sent.delete(key);
    const w = { id: "w" + randomBytes(8).toString("base64url").slice(0, 10), person, at: new Date().toISOString(), text: t, tried: tried ? String(tried).trim().slice(0, 2000) : "",
      version: version ? String(version).slice(0, 20) : "", link: link ? String(link).slice(0, 300) : "", status: "ny" };
    write(w); all.set(w.id, w);
    const hook = process.env.SYKEHUS_WISH_WEBHOOK;
    if (hook) fetchImpl(hook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "sykehus_wish", ...out(w) }), signal: AbortSignal.timeout(5000) })
      .then(r => { if (!r.ok) console.error("wish webhook:", r.status); }, e => console.error("wish webhook:", e.message));
    return out(w);
  }
  const mine = person => [...all.values()].filter(w => w.person === person).sort((a, b) => b.at.localeCompare(a.at)).map(out);
  const every = () => [...all.values()].sort((a, b) => b.at.localeCompare(a.at)).map(out);

  const send = (res, code, body) => { res.writeHead(code, { ...SECURITY, "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(body)); };
  /* pm's own read, with its token (not the proxy secret: the edge adds that to every page request) */
  const token = req => { const t = process.env.SYKEHUS_ADMIN_TOKEN, m = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || ""); return !!t && t.length >= 24 && !!m && same(m[1], t); };
  async function route(req, res, path) {
    if (path !== "/api/onsker" && !path.startsWith("/api/onsker/")) return false;
    const me = personOf(req)?.person ?? null, admin = token(req) || isAdmin(me);
    if (req.method === "GET" && path === "/api/onsker") { if (!me && !admin) send(res, 401, { error: "Logg inn for å se ønskene dine." }); else send(res, 200, { wishes: admin ? every() : mine(me), admin, you: me }); return true; }
    if (req.method !== "POST") { send(res, 405, { error: "GET eller POST" }); return true; }
    if (req.headers.origin && (() => { try { return new URL(req.headers.origin).host !== req.headers.host; } catch { return true; } })()) { send(res, 403, { error: "Feil opphav" }); return true; }
    let b; try { b = await readJson(req, 20000); } catch { send(res, 400, { error: "Uleselig" }); return true; }
    if (path === "/api/onsker") {
      if (!me) { send(res, 401, { error: "Logg inn for å sende et ønske." }); return true; }
      try { send(res, 201, add(me, { text: b?.text, tried: b?.tried, version: b?.version })); } catch (e) { send(res, 400, { error: e.message }); }
      return true;
    }
    const w = all.get(path.slice("/api/onsker/".length));
    if (!admin) { send(res, 403, { error: "Bare Morten svarer på ønsker." }); return true; }
    if (!w) { send(res, 404, { error: "Fant ikke ønsket." }); return true; }
    if (!STATUS.includes(b?.status)) { send(res, 400, { error: `status er ${STATUS.join(", ")}` }); return true; }
    w.status = b.status; if (b.note != null) w.note = String(b.note).slice(0, 1000); write(w);
    send(res, 200, out(w)); return true;
  }
  return { add, mine, every, isAdmin, route, adminToken: token };
}
