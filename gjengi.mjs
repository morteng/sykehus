/* «Gjengi» (U3526, Morten 2026-10-25 17:26Z: «img2img "renderings" through image model at the end of the proces, we can
   store his favorites, make them downloadable»): a view of a version or a draft, as the page draws it, made into a
   realistic picture by an image model on OpenRouter (chat/completions with modalities, the picture back as a data URL,
   as gulden-ai's image.py calls it). Signed in only: it costs money.

   The household's spend cap (Morten 2026-10-26 09:47Z «yes to all questions»; pm's default $20 a month) is kept HERE,
   before the call: what this calendar month (UTC) has cost, plus what is being made now, plus this picture's estimate,
   must stay within SYKEHUS_RENDER_CAP_USD. What a picture cost is OpenRouter's own usage.cost, recorded as it came.

   Pictures only go to providers that promise not to keep them (zdr, data_collection deny, no fallbacks), as gulden-ai
   sends for every picture.

   GET  /api/gjengi?versjon=&nokkel= | ?utkast=   the work's pictures (favourites first), the estimate, the month so far
   POST /api/gjengi                               { image: data URL (JPEG/PNG), wish?, versjon?, nokkel?, utkast?, shown_usd }
   POST /api/gjengi/<id>/favoritt                  { on }   by the one who made it, or the version's owner
   GET  /api/gjengi/<id>.<ext>[?last-ned]          the picture, full size; ?last-ned as a download

   Kept in <dir>/index.json (every picture, its cost and its work; written whole and renamed) and <dir>/<id>.<ext>. */
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { lightLine } from "./public/renderkit/sunpick.js";
import { SIZES, DEFAULT_SIZE, VIEWPOINTS, LOOKS, shotOf, promptLine } from "./public/photo-set.js";

const URL_ = "https://openrouter.ai/api/v1/chat/completions";
const ROUTING = { zdr: true, data_collection: "deny", allow_fallbacks: false };
const ASPECTS = [["1:1", 1], ["4:5", 4 / 5], ["4:3", 4 / 3], ["3:2", 3 / 2], ["16:9", 16 / 9], ["21:9", 21 / 9], ["3:4", 3 / 4], ["2:3", 2 / 3], ["9:16", 9 / 16]];
const ID = /^[a-z0-9]{16}$/, MAX_IN = 6 * 1024 * 1024;
/* The view is the only geometry the model gets (U3526: the first prompt let it invent hills and houses behind the site) */
const PROMPT = "This image is a view of a 3D model of a site in Bragernes, Drammen, Norway. It is the only geometry: make it a photorealistic architectural rendering of exactly this view. "
  + "Keep every building, road and terrain line exactly; change only materials, light, people and planting. "
  + "Same camera, same framing, every outline and edge in the same place. Add no building, house, hill, mountain, wall, road or other structure, and remove none. "
  + "Where the model ends, keep the background as plain sky or the same flat ground that is there; do not invent a landscape, a skyline or a town behind it. "
  + "Materials: the existing hospital wings in concrete, brick and render; new buildings in the material their colour suggests; asphalt, kerbs, grass. "
  + "Planting: trees and shrubs only where the model has trees or green areas. People: a few small pedestrians on the paths and pavements. "
  + "No text or labels.";   // the light is said apart, from the view's sun (lightLine)
/* a photo spot (U3665): where a picture was taken from and with what, kept beside the picture so it can be taken again; only numbers and short
   ids come in, whatever the page sent */
const num = (v, lo, hi) => Number.isFinite(+v) && v !== null && v !== "" ? Math.min(hi, Math.max(lo, +v)) : null;
export function spotOf(b) {
  if (!b || typeof b !== "object" || !b.pose) return null;
  const p = b.pose, pose = { x: num(p.x, -1e5, 1e5), y: num(p.y, -1e5, 1e5), h: num(p.h, -1e4, 1e4), yaw: num(p.yaw, -1e3, 1e3), pitch: num(p.pitch, -4, 4), dist: num(p.dist, 0, 1e5), eye: !!p.eye };
  if ([pose.x, pose.y, pose.h, pose.yaw, pose.pitch, pose.dist].some(v => v == null)) return null;
  const inR = (v, lo, hi) => Number.isFinite(+v) && v !== null && +v >= lo && +v <= hi, sun = b.sun && inR(b.sun.sunM, 1, 12) && inR(b.sun.sunD, 1, 31) && inR(b.sun.sunH, 0, 24) ? { sunM: num(b.sun.sunM, 1, 12), sunD: num(b.sun.sunD, 1, 31), sunH: num(b.sun.sunH, 0, 24) } : null;
  return { pose, mm: num(b.mm, 10, 200), fov: num(b.fov, 1, 170), aspect: ASPECTS.some(([k]) => k === b.aspect) ? b.aspect : null, look: LOOKS[b.look] ? b.look : null, viewpoint: VIEWPOINTS[b.viewpoint] ? b.viewpoint : null,
    sun, eyeh: num(b.eyeh, 0.3, 50), lens: typeof b.lens === "string" ? b.lens.slice(0, 12) : null, version: typeof b.version === "string" ? b.version.slice(0, 16) : null, n: num(b.n, 0, 1e5) };
}
const WISH = " The person also asks for this; it may change only materials, light, people and planting, never the geometry: ";

export function createRenderings({ SECURITY = {}, readJson, login, versions, drafts = () => null, dir = process.env.SYKEHUS_RENDER_DIR || (process.env.SYKEHUS_VERSIONS_DIR && join(process.env.SYKEHUS_VERSIONS_DIR, "gjengi")),
  key = process.env.SYKEHUS_OPENROUTER_API_KEY || "", model = process.env.SYKEHUS_RENDER_MODEL || "google/gemini-3.1-flash-image", cap = +(process.env.SYKEHUS_RENDER_CAP_USD || 20),
  size = process.env.SYKEHUS_RENDER_SIZE || DEFAULT_SIZE, fetchImpl = fetch, now = () => new Date() } = {}) {
  if (!dir) return null;
  mkdirSync(dir, { recursive: true });
  const idx = join(dir, "index.json");
  let all = existsSync(idx) ? JSON.parse(readFileSync(idx, "utf8")) : [];
  const save = () => { writeFileSync(idx + ".tmp", JSON.stringify(all)); renameSync(idx + ".tmp", idx); };
  const pending = new Map();   // who → the estimate being made now (one at a time each)

  /* this month (UTC) so far, and what is on its way */
  const month = () => now().toISOString().slice(0, 7);
  const spent = () => all.filter(r => r.at.startsWith(month())).reduce((a, r) => a + (r.cost_usd || 0), 0);
  const onWay = () => [...pending.values()].reduce((a, v) => a + v, 0);
  /* what the next picture costs, before it is made: the dearest of the last five this model made (OpenRouter's own
     figures), else its listed price for a picture of about 1 300 tokens out and in; rounded up to the cent */
  let listed = null, listedAt = 0;
  async function listPrice(sz) {   // the model's listed price for a picture of this size; the pricing read once a day
    if (listed == null || Date.now() - listedAt >= 864e5) {
      try {
        const j = await (await fetchImpl("https://openrouter.ai/api/v1/models?output_modalities=image", { signal: AbortSignal.timeout(10000) })).json();
        listed = (j.data || []).find(m => m.id === model)?.pricing || {}; listedAt = Date.now();
      } catch { listed ??= null; }
    }
    if (!listed) return 0.1 * SIZES[sz].tokens / SIZES["1K"].tokens;
    const p = listed; return SIZES[sz].tokens * (+p.image_output || +p.completion || 0) + 1300 * (+p.image || +p.prompt || 0) + 300 * (+p.prompt || 0);
  }
  async function estimate(sz = size) {
    sz = SIZES[sz] ? sz : size;
    const last = all.filter(r => r.model === model && (r.size || "1K") === sz && r.cost_usd > 0).slice(-5).map(r => r.cost_usd);
    const e = last.length ? Math.max(...last) : await listPrice(sz);
    return Math.ceil(Math.max(e, 0.01) * 100) / 100;
  }
  const money = v => Math.round(v * 100) / 100;

  /* the work a picture belongs to, and whether this person may see it (a draft: anyone with its id) */
  function workOf(q, who) {
    if (q.versjon) { const v = versions?.get(q.versjon); if (!v || !versions.visible(v, who, q.nokkel)) return null; return { key: `versjon:${v.id}`, owner: v.owner }; }
    if (q.utkast && /^[A-Za-z0-9_-]{6,16}$/.test(q.utkast)) return { key: `utkast:${q.utkast}`, owner: null };
    return null;
  }
  const pub = (r, who = null) => ({ id: r.id, at: r.at, by: r.by, mine: !!who && r.by === who, fav: !!r.fav, spot: r.spot || null, retake_of: r.retake_of || null, stale: staleOf(r), wish: r.wish || null, cost_usd: r.cost_usd, url: `api/gjengi/${r.id}.${r.ext}`, download: `api/gjengi/${r.id}.${r.ext}?last-ned` });
  /* the model changed since the picture: the version was saved after it (a draft has no clock here: the page compares the change count in the spot) */
  const staleOf = r => { const [kind, wid] = String(r.work).split(":"), v = kind === "versjon" ? versions?.get(wid) : null; return v ? String(v.updated) > r.at : null; };
  const proposals = new Map();   // who → {ids, at}: Anton's «lag nye bilder fra disse stedene», waiting for the person to confirm on the page
  const spotsOf = who => all.filter(r => r.by === who && r.spot && !r.failed && !r.retake_of).sort((a, b) => b.at.localeCompare(a.at));
  const state = async who => ({ signed_in: !!who, on: !!key, model, estimate_usd: await estimate(), default_size: size, sizes: await Promise.all(Object.entries(SIZES).map(async ([id, z]) => ({ id, name: z.no, estimate_usd: await estimate(id) }))), retake: who && proposals.get(who) && Date.now() - proposals.get(who).t < 1800e3 ? { ids: proposals.get(who).ids } : null, month_usd: money(spent()), cap_usd: cap, left_usd: money(Math.max(0, cap - spent() - onWay())) });

  async function make(body, who) {
    const shot = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/.exec(String(body.image || ""));
    if (!shot) throw Object.assign(new Error("Bildet av visningen mangler."), { status: 400 });
    const bytes = Buffer.from(shot[2], "base64"); if (bytes.length < 1024 || bytes.length > MAX_IN) throw Object.assign(new Error("Bildet av visningen er for lite eller for stort."), { status: 400 });
    const wish = body.wish == null ? "" : String(body.wish).trim().slice(0, 300);
    const sz = SIZES[body.size] ? body.size : size, est = await estimate(sz);
    /* the cap, before anything is sent: the month, what is on its way, and this one */
    if (spent() + onWay() + est > cap + 1e-9) throw Object.assign(new Error(`Månedens grense for bilder er nådd: $${money(spent()).toFixed(2)} av $${cap.toFixed(2)} er brukt${onWay() ? `, og $${money(onWay()).toFixed(2)} er under arbeid` : ""}. Et nytt bilde koster omtrent $${est.toFixed(2)}. Grensen går tilbake den 1. neste måned.`), { status: 402 });
    if (body.shown_usd != null && est > +body.shown_usd + 0.005) throw Object.assign(new Error(`Prisen er endret: et bilde koster nå omtrent $${est.toFixed(2)}. Se over og prøv igjen.`), { status: 409, estimate_usd: est });
    /* the aspect nearest the view's (a JPEG's or PNG's size from its header) */
    const dim = shot[1] === "png" ? [bytes.readUInt32BE(16), bytes.readUInt32BE(20)] : jpegSize(bytes);
    const near = dim ? ASPECTS.map(([k, r]) => [k, Math.abs(Math.log(dim[0] / dim[1] / r))]).sort((a, b) => a[1] - b[1])[0][0] : "16:9";
    /* the camera (renderkit photo.js): the viewpoint and look the page took the picture with, said to the model in one line; the shape asked for is the picture's */
    const cam = VIEWPOINTS[body.viewpoint] ? shotOf({ viewpoint: body.viewpoint, look: body.look, lens: body.lens, eyeh: body.eyeh }) : null;
    const ar = ASPECTS.some(([k]) => k === body.aspect) ? body.aspect : cam && ASPECTS.some(([k]) => k === cam.aspect) ? cam.aspect : near;
    const google = model.startsWith("google/");
    pending.set(who, est);
    try {
      const r = await fetchImpl(URL_, { method: "POST", signal: AbortSignal.timeout(120000), headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "http-referer": "https://sykehus.gulden.no", "x-title": "Sykehustomta" },
        body: JSON.stringify({ model, modalities: google ? ["image", "text"] : ["image"], provider: ROUTING, usage: { include: true }, image_config: { aspect_ratio: ar, image_size: sz },
          messages: [{ role: "user", content: [{ type: "text", text: PROMPT + " " + lightLine(body) + (cam ? " Camera and look (these override the light and materials wording above where they differ; the geometry stays): " + promptLine(cam) : "") + (wish ? WISH + wish : "") }, { type: "image_url", image_url: { url: body.image } }] }] }) });
      const j = await r.json().catch(() => ({}));
      const cost = Number.isFinite(+j.usage?.cost) ? +j.usage.cost : null;
      const url = j.choices?.[0]?.message?.images?.[0]?.image_url?.url || "";
      const pic = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(url);
      if (!r.ok || !pic) {
        /* a refused or empty answer may still have cost something: it counts against the cap as charged */
        if (cost) { all.push({ id: newId(), at: now().toISOString(), by: who, work: null, model, cost_usd: cost, est_usd: est, failed: true }); save(); }
        console.warn(`gjengi: ${r.status} ${j.error?.message ? String(j.error.message).slice(0, 200) : pic ? "" : "no picture"}`);
        throw Object.assign(new Error("Bildemodellen svarte ikke med et bilde. Prøv igjen om litt."), { status: 502 });
      }
      const ext = pic[1] === "jpeg" ? "jpg" : pic[1], id = newId(), out = Buffer.from(pic[2], "base64");
      writeFileSync(join(dir, `${id}.${ext}`), out);
      const spot = spotOf(body.spot), prior = body.retake_of && all.find(r => r.id === body.retake_of && r.by === who && r.spot);
      const rec = { id, at: now().toISOString(), by: who, work: body.work, ...(spot ? { spot: { ...spot, aspect: spot.aspect || ar } } : {}), ...(prior ? { retake_of: prior.id } : {}), model, size: sz, ...(cam ? { viewpoint: cam.viewpoint, look: cam.look } : {}), ext, bytes: out.length, cost_usd: cost ?? est, est_usd: est, cost_said: cost != null, wish: wish || null, fav: false, provider: j.provider || null };
      all.push(rec); save();
      console.log(`gjengi ${id} ${body.work} ${who} $${(cost ?? est).toFixed(4)}${cost == null ? " (estimert)" : ""} ${j.provider || ""} ${ar} ${sz} ${cam ? cam.viewpoint + "/" + cam.look : ""} ${out.length} B`);
      return rec;
    } finally { pending.delete(who); }
  }

  const json = (res, n, o) => res.writeHead(n, { ...SECURITY, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }).end(JSON.stringify(o));
  return {
    estimate, spent, make, spotsOf, staleOf, get all() { return all; },
    /* Anton's proposal: the ids of the person's spots to take again; nothing is made until the person confirms on the page (U3665) */
    propose(who, ids) { proposals.set(who, { ids, t: Date.now() }); },
    async route(req, res, path, url) {
      if (path !== "/api/gjengi" && !path.startsWith("/api/gjengi/")) return false;
      const who = login.personOf(req)?.person ?? null, q = Object.fromEntries(url.searchParams);
      try {
        if (path === "/api/gjengi" && req.method === "GET") {
          const w = workOf(q, who), list = w ? all.filter(r => r.work === w.key).sort((a, b) => (b.fav - a.fav) || b.at.localeCompare(a.at)).map(r => pub(r, who)) : [];
          return json(res, 200, { ...(await state(who)), pictures: list });
        }
        if (path === "/api/gjengi" && req.method === "POST") {
          if (!who) return json(res, 401, { error: "Logg inn for å gjengi: hvert bilde koster penger." });
          if (!key) return json(res, 503, { error: "Gjengi er ikke slått på her." });
          if (pending.has(who)) return json(res, 429, { error: "Ett bilde om gangen: vent til det forrige er ferdig." });
          const body = await readJson(req, MAX_IN * 1.4 + 4096);
          const w = workOf({ versjon: body.versjon, nokkel: body.nokkel, utkast: body.utkast }, who);
          if (!w) return json(res, 400, { error: "Åpne forslaget du vil gjengi, eller gjør en endring først." });
          const rec = await make({ ...body, work: w.key }, who);
          proposals.delete(who); return json(res, 200, { picture: pub(rec, who), ...(await state(who)) });
        }
        if (path === "/api/gjengi/proposal" && req.method === "POST") { if (who) proposals.delete(who); return json(res, 200, { ok: true }); }
        const m = /^\/api\/gjengi\/([a-z0-9]{16})(?:\/(favoritt)|\.(jpg|png|webp))$/.exec(path);
        if (!m) return json(res, 404, { error: "Ikke funnet" });
        const r = all.find(x => x.id === m[1] && !x.failed); if (!r) return json(res, 404, { error: "Fant ikke bildet." });
        if (m[3] && req.method === "GET") {
          if (m[3] !== r.ext) return json(res, 404, { error: "Ikke funnet" });
          const body = readFileSync(join(dir, `${r.id}.${r.ext}`));
          return res.writeHead(200, { ...SECURITY, "content-type": { jpg: "image/jpeg", png: "image/png", webp: "image/webp" }[r.ext], "cache-control": "private, max-age=86400",
            ...(url.searchParams.has("last-ned") ? { "content-disposition": `attachment; filename="sykehustomta-${r.at.slice(0, 10)}-${r.id.slice(0, 6)}.${r.ext}"` } : {}) }).end(body), true;
        }
        if (m[2] && req.method === "POST") {
          const [kind, wid] = String(r.work).split(":"), v = kind === "versjon" ? versions?.get(wid) : null;
          if (!who || (r.by !== who && v?.owner !== who)) return json(res, 403, { error: "Bare den som laget bildet, eller eieren av forslaget, kan endre favorittene." });
          const b = await readJson(req, 1024); r.fav = !!b.on; save();
          return json(res, 200, { picture: pub(r, who) });
        }
        return json(res, 405, { error: "Ikke tillatt" });
      } catch (e) { return json(res, e.status || 500, { error: e.status ? e.message : "Noe gikk galt.", ...(e.estimate_usd ? { estimate_usd: e.estimate_usd } : {}) }); }
    },
  };
}
const newId = () => Array.from(randomBytes(16), b => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
/* a JPEG's width and height from its SOF marker */
function jpegSize(b) {
  for (let i = 2; i + 9 < b.length;) {
    if (b[i] !== 0xff) return null;
    const m = b[i + 1], len = b.readUInt16BE(i + 2);
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
    i += 2 + len;
  }
  return null;
}
