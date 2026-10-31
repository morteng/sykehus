/* Site photos: real photos of the building as it stands now, brought in by a person (the model's «before» is partly wrong).
   They are the person's own and are not part of the shared model; Anton reads them with list_site_photos and look_at_site_photo.

   One image file and one small JSON beside it, in SYKEHUS_VERSIONS_DIR/_bilder/, named by a random id (never the person's
   filename, which can carry a name or a place):  { id, person, at, wing, side, note, year, ext, bytes }

     GET    /api/bilder               your own, newest first ({photos, sides, wings})
     POST   /api/bilder?fløy=&side=&note=&år=   the image bytes (JPEG, PNG or WebP, at most 8 MB, by its first bytes)
     GET    /api/bilder/<id>          the image, its person's only
     DELETE /api/bilder/<id>          your own */
import { readFileSync, writeFileSync, renameSync, readdirSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { UPLOAD_CAPS, capWords } from "./public/kit/upload-caps.js";   // the one table of upload caps (U3992)

export const MAX_BYTES = UPLOAD_CAPS.sitePhoto, PER_PERSON = 60;
export const SIDES = ["nord", "øst", "sør", "vest", "ukjent"];
const ID = /^p[A-Za-z0-9_-]{10}$/;
/* what the first bytes say it is; the browser's claim and the filename are not read */
export function kindOf(b) {
  if (b.length > 12 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: "jpg", type: "image/jpeg" };
  if (b.length > 12 && b.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) return { ext: "png", type: "image/png" };
  if (b.length > 12 && b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") return { ext: "webp", type: "image/webp" };
  return null;
}
const fail = (code, message) => Object.assign(new Error(message), { code, photo: true });

export function createSitePhotos({ dir = process.env.SYKEHUS_VERSIONS_DIR, wings = [], SECURITY = {}, personOf = () => null, readBytes, px = null } = {}) {
  if (!dir) return null;
  const home = join(dir, "_bilder"); mkdirSync(home, { recursive: true });
  const all = new Map();
  for (const f of readdirSync(home)) { if (!f.endsWith(".json")) continue; try { const p = JSON.parse(readFileSync(join(home, f), "utf8")); if (ID.test(p.id)) all.set(p.id, p); } catch (e) { console.error("sitephotos: skipping", f, e.message); } }
  const wingOf = s => { const t = String(s ?? "").trim().toLowerCase(); return wings.find(w => w.id === t || String(w.name).toLowerCase() === t) ?? null; };
  const out = p => ({ id: p.id, at: p.at, wing: p.wing, wing_name: wingOf(p.wing)?.name ?? p.wing, side: p.side, note: p.note || null, year: p.year ?? null, bytes: p.bytes });

  function add(person, bytes, { wing, side, note, year }) {
    if (!person) throw fail("signed_out", "Logg inn for å legge til bilder.");
    const kind = bytes?.length ? kindOf(bytes) : null;
    if (!kind) throw fail("bad_image", "Bildet må være JPEG, PNG eller WebP.");
    if (bytes.length > MAX_BYTES) throw fail("too_big", `Bildet er over ${capWords("sitePhoto")}.`);
    const w = wingOf(wing); if (!w) throw fail("bad_wing", "Velg hvilken fløy bildet viser.");
    const s = SIDES.includes(side) ? side : "ukjent";
    const y = year == null || year === "" ? null : Math.trunc(+year); if (y != null && !(y >= 1800 && y <= 2100)) throw fail("bad_year", "Året må være mellom 1800 og 2100.");
    if ([...all.values()].filter(p => p.person === person).length >= PER_PERSON) throw fail("limit", `Høyst ${PER_PERSON} bilder: slett noen først.`);
    const p = { id: "p" + randomBytes(8).toString("base64url").slice(0, 10), person, at: new Date().toISOString(), wing: w.id, side: s, note: String(note ?? "").trim().slice(0, 300), year: y, ext: kind.ext, bytes: bytes.length };
    writeFileSync(join(home, `${p.id}.${p.ext}`), bytes);   // the image first, so a kept record always has its file
    const j = join(home, p.id + ".json"), t = j + ".tmp"; writeFileSync(t, JSON.stringify(p)); renameSync(t, j); all.set(p.id, p);
    return out(p);
  }
  const mine = person => person ? [...all.values()].filter(p => p.person === person).sort((a, b) => b.at.localeCompare(a.at)).map(out) : [];
  /* the bytes of the person's own photo, or null: another person's id is the same as none */
  function read(person, id) {
    const p = person && ID.test(String(id)) ? all.get(String(id)) : null; if (!p || p.person !== person) return null;
    try { return { ...out(p), data: readFileSync(join(home, `${p.id}.${p.ext}`)), type: { jpg: "image/jpeg", png: "image/png", webp: "image/webp" }[p.ext] }; } catch { return null; }
  }
  /* the bytes of a photo for the scaler (px.mjs), whoever it belongs to; the person is checked by /px-may */
  const fileOf = id => { const p = ID.test(String(id)) ? all.get(String(id)) : null; if (!p) return null; try { return { person: p.person, type: { jpg: "image/jpeg", png: "image/png", webp: "image/webp" }[p.ext], bytes: readFileSync(join(home, `${p.id}.${p.ext}`)) }; } catch { return null; } };
  function remove(person, id) {
    const p = person && ID.test(String(id)) ? all.get(String(id)) : null; if (!p || p.person !== person) return false;
    all.delete(p.id); for (const f of [`${p.id}.${p.ext}`, `${p.id}.json`]) try { unlinkSync(join(home, f)); } catch { }
    return true;
  }

  const json = (res, code, body) => { res.writeHead(code, { ...SECURITY, "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(body)); };
  const sameOrigin = req => { if (!req.headers.origin) return true; try { return new URL(req.headers.origin).host === req.headers.host; } catch { return false; } };
  async function route(req, res, path, url) {
    if (path !== "/api/bilder" && !path.startsWith("/api/bilder/")) return false;
    const me = personOf(req)?.person ?? null;
    if (!me) { json(res, 401, { error: "Logg inn for å se bildene dine." }); return true; }
    if (path === "/api/bilder" && req.method === "GET") { json(res, 200, { photos: mine(me), sides: SIDES, wings: wings.map(w => ({ id: w.id, name: w.name })), max_bytes: MAX_BYTES }); return true; }
    if (path === "/api/bilder" && req.method === "POST") {
      if (!sameOrigin(req)) { json(res, 403, { error: "Feil opphav" }); return true; }
      try {
        const q = url.searchParams, b = await readBytes(req, MAX_BYTES + 1).catch(e => { throw e.big ? fail("too_big", `Bildet er over ${capWords("sitePhoto")}.`) : e; });
        json(res, 201, add(me, b, { wing: q.get("fløy"), side: q.get("side"), note: q.get("note"), year: q.get("år") }));
      } catch (e) { json(res, e.photo ? (e.code === "too_big" ? 413 : 400) : 500, { error: e.photo ? e.message : "Noe gikk galt.", code: e.code }); }
      return true;
    }
    const id = path.slice("/api/bilder/".length);
    if (req.method === "GET") {
      const p = read(me, id); if (!p) { json(res, 404, { error: "Fant ikke bildet." }); return true; }
      if (px && await px.redirect(req, res, "foto", p.id, String(p.bytes), url)) return true;   // U3992: through the scaler, signed
      res.writeHead(200, { ...SECURITY, "content-type": p.type, "content-length": p.data.length, "cache-control": "private, max-age=3600" }); res.end(p.data); return true;
    }
    if (req.method === "DELETE") {
      if (!sameOrigin(req)) { json(res, 403, { error: "Feil opphav" }); return true; }
      if (!remove(me, id)) json(res, 404, { error: "Fant ikke bildet." }); else json(res, 200, { deleted: id }); return true;
    }
    json(res, 405, { error: "GET, POST eller DELETE" }); return true;
  }
  return { add, mine, read, fileOf, remove, route };
}
