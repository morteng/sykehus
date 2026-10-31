/* Feedback and wishes: what a person wants from Sykehustomta, or a fault they met, sent to Morten (ruling 2026-10-25 17:15Z; U3978: one inbox).
   From the connector (send_wish, after the agent asked «Skal jeg sende dette som et ønske?»), the page's «Ønsker» or the kit's feedback dialog.

   The report goes to gulden-ai's report store, the same inbox Fab's feedback goes to (door.mjs: POST /internal/sykehus/feedback, component
   «sykehus»; Morten and pm read and move them with reports_list and reports_update). This server keeps only the picture a person attached,
   so the report can name it: SYKEHUS_VERSIONS_DIR/_wishes/<ref>.png with <ref>.json {person}; the report's body ends «Attachment: <ref>».

     GET  /api/onsker          your own reports, newest first ({wishes, you}); status ny | sett | laget | nei (the store's open, in_progress, done,
                               wontfix) and the developer's answer as note
     GET  /api/onsker/<ref>.png  the picture kept with a report, its person's or an admin's (SYKEHUS_ADMINS, default "morten", or the admin token)
     POST /api/onsker          {text, tried?, version?}  a new wish, from the page
     POST /api/feedback        {kind, text, page?, tab?, version?, screenshot?}  the kit's feedback dialog; 10 an hour a person */
import { UPLOAD_CAPS } from "./public/kit/upload-caps.js";   // the one table of upload caps (U3992)
import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createDoor, codeOf } from "./door.mjs";

export const STATUS = ["ny", "sett", "laget", "nei"];
const PER_DAY = 20, REF = /^w[A-Za-z0-9_-]{10}$/, VERSION = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/, KINDS = ["bug", "idea", "question", "other"];
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };

export function createWishes({ dir = process.env.SYKEHUS_VERSIONS_DIR, SECURITY = {}, readJson, personOf = () => null, login, fetchImpl = fetch } = {}) {
  if (!dir) return null;
  const home = join(dir, "_wishes"); mkdirSync(home, { recursive: true });
  const door = login ? createDoor({ login, fetchImpl }) : null, sent = new Map(), hour = new Map(), PNG = Buffer.from("89504e470d0a1a0a", "hex");
  const admins = new Set((process.env.SYKEHUS_ADMINS ?? "morten").split(",").map(s => s.trim()).filter(Boolean));
  const isAdmin = p => !!p && admins.has(p);
  const owner = ref => { try { return JSON.parse(readFileSync(join(home, ref + ".json"), "utf8")).person ?? null; } catch { return null; } };
  const keepPicture = (person, png) => {
    const ref = "w" + randomBytes(8).toString("base64url").slice(0, 10), p = join(home, ref + ".json");
    writeFileSync(join(home, ref + ".png"), png); writeFileSync(p + ".tmp", JSON.stringify({ person, at: new Date().toISOString() })); renameSync(p + ".tmp", p);
    return ref;
  };

  /* one report to the store; kind: bug | idea | question | other. Returns {id, status, picture}; throws an Error with a sentence for the person */
  async function file(person, { kind = "idea", text, tried, version, link, page, tab, png = null }) {
    if (!door?.ready) throw new Error("Ønsker tas ikke imot på denne serveren.");
    const t = String(text ?? "").trim(); if (t.length < 3) throw new Error("Skriv hva du ønsker deg.");
    const extra = [tried && `Prøvd: ${String(tried).trim().slice(0, 2000)}`, link && `Lenke: ${String(link).slice(0, 300)}`].filter(Boolean).join("\n");
    const body = extra ? `${t}\n\n${extra}` : t;
    if (body.length > 4000) throw new Error("Høyst 4000 tegn.");
    const ref = png ? keepPicture(person, png) : null, v = version && VERSION.test(String(version)) ? String(version) : null;
    const [st, j] = await door.call("/feedback", { person, kind: KINDS.includes(kind) ? kind : "other", text: body, ...(v ? { design_id: v } : {}), ...(tab ? { tab: String(tab).slice(0, 40) } : {}), ...(page ? { page: String(page).slice(0, 200) } : {}), ...(ref ? { attachment_ref: ref } : {}), at: new Date().toISOString() });
    if (st !== 200 || !j.id) { const e = new Error("Fikk ikke sendt. Prøv igjen."); e.status = st; e.code = codeOf(j, "unavailable"); throw e; }
    return { id: String(j.id), status: "ny", picture: !!ref };
  }
  /* a wish (send_wish, the page): 20 a day a person */
  async function add(person, o) {
    const day = new Date().toISOString().slice(0, 10), k = person + day, n = (sent.get(k) || 0) + 1;
    if (n > PER_DAY) throw new Error(`Høyst ${PER_DAY} ønsker om dagen.`);
    const w = await file(person, o); sent.set(k, n); for (const key of sent.keys()) if (!key.endsWith(day)) sent.delete(key);
    return w;
  }
  /* a person's own reports, newest first, from the store */
  async function mine(person) {
    if (!door?.ready) return [];
    const [st, j] = await door.call("/reports", null, { person });
    if (st !== 200) throw new Error("Fikk ikke hentet det du har sendt. Prøv igjen.");
    return (j.items || []).map(r => ({ id: r.id, at: r.at, text: r.text, status: STATUS.includes(r.status) ? r.status : "ny", note: r.note || null, version: r.ref || null }));
  }

  const send = (res, code, body) => { res.writeHead(code, { ...SECURITY, "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(body)); };
  /* pm's own read, with its token (not the proxy secret: the edge adds that to every page request) */
  const token = req => { const t = process.env.SYKEHUS_ADMIN_TOKEN, m = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || ""); return !!t && t.length >= 24 && !!m && same(m[1], t); };
  const sameOrigin = req => !req.headers.origin || (() => { try { return new URL(req.headers.origin).host === req.headers.host; } catch { return false; } })();
  /* POST /api/feedback (U3660): the kit's feedback dialog. 10 an hour a person; a picture is a PNG of at most the wish cap. */
  async function feedback(person, b) {
    const kind = KINDS.includes(b?.kind) ? b.kind : null, text = String(b?.text ?? "").trim();
    if (!kind || !text) return [400, { code: "bad_request" }];
    if (text.length > 4000) return [413, { code: "too_long" }];
    let png = null;
    if (b.screenshot != null) {
      const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(b.screenshot)); png = m ? Buffer.from(m[1], "base64") : null;
      if (!png || png.length > UPLOAD_CAPS.wishPng || !png.subarray(0, 8).equals(PNG)) return [png && png.length > UPLOAD_CAPS.wishPng ? 413 : 400, { code: "bad_image" }];
    }
    const now = Date.now(), q = (hour.get(person) || []).filter(t => now - t < 3600e3);
    if (q.length >= 10) return [429, { code: "limit", retry_at: new Date(q[0] + 3600e3 + 1000).toISOString() }];
    try { const w = await file(person, { kind, text, version: b.version, page: b.page, tab: b.tab, png }); q.push(now); hour.set(person, q); return [200, { id: w.id }]; }
    catch (e) { return [e.status === 429 ? 429 : e.status >= 500 || e.status === undefined ? 503 : 400, { code: e.code || "unavailable", error: e.message }]; }
  }
  async function route(req, res, path) {
    if (path === "/api/feedback") {
      if (req.method !== "POST") { send(res, 405, { error: "POST" }); return true; }
      if (!sameOrigin(req)) { send(res, 403, { error: "Feil opphav" }); return true; }
      const me = personOf(req)?.person ?? null; if (!me) { send(res, 401, { error: "signed_out" }); return true; }
      let b; try { b = await readJson(req, 2_000_000); } catch { send(res, 400, { code: "bad_request" }); return true; }
      const [code, out] = await feedback(me, b); send(res, code, out);
      return true;
    }
    if (path !== "/api/onsker" && !path.startsWith("/api/onsker/")) return false;
    const me = personOf(req)?.person ?? null, admin = token(req) || isAdmin(me);
    if (req.method === "GET" && path === "/api/onsker") {
      if (!me) send(res, 401, { error: "Logg inn for å se ønskene dine." });
      else try { send(res, 200, { wishes: await mine(me), you: me }); } catch (e) { send(res, 503, { error: e.message }); }
      return true;
    }
    const pic = req.method === "GET" && /^\/api\/onsker\/(w[A-Za-z0-9_-]{10})\.png$/.exec(path);
    if (pic) {
      const who = REF.test(pic[1]) ? owner(pic[1]) : null;
      if (!who || !(admin || (me && who === me))) { send(res, 404, { error: "Fant ikke bildet." }); return true; }
      try { const png = readFileSync(join(home, pic[1] + ".png")); res.writeHead(200, { ...SECURITY, "content-type": "image/png", "cache-control": "private, max-age=3600" }); res.end(png); } catch { send(res, 404, { error: "Fant ikke bildet." }); }
      return true;
    }
    if (req.method !== "POST" || path !== "/api/onsker") { send(res, 405, { error: "GET eller POST" }); return true; }
    if (!sameOrigin(req)) { send(res, 403, { error: "Feil opphav" }); return true; }
    let b; try { b = await readJson(req, 20000); } catch { send(res, 400, { error: "Uleselig" }); return true; }
    if (!me) { send(res, 401, { error: "Logg inn for å sende et ønske." }); return true; }
    try { send(res, 201, await add(me, { text: b?.text, tried: b?.tried, version: b?.version })); } catch (e) { send(res, 400, { error: e.message }); }
    return true;
  }
  return { add, mine, isAdmin, route, adminToken: token };
}
