/* File intake B4 (U4357): Sykehus takes a Dokumenter file by the same road Fab does. Dokumenter is the store and
   document:<id> the handle; the door (gulden-ai) resolves the handle among the files the asker may read, asks upload_url
   here for a link, PUTs the stored bytes to /up/<token> on this server's inside address, and swaps the token into the
   call (fetch_model, add_site_photo take upload_token). The bytes never enter the model's text.

   The token is the capability, as Fab's: one use, ten minutes, bound to the person who asked, at most 100 MB, kept in
   memory only (a restart drops it). /up reads no identity header. What came is read by what the importers check (the
   first bytes, never the name or the Content-Type), and is never executed. */
import { randomBytes } from "node:crypto";

export const MAX_UPLOAD = 100 << 20, TTL_MS = 10 * 60 * 1000, PER_PERSON = 5, ALL = 20;
const TOKEN = /^[A-Za-z0-9_-]{32}$/;
const err = (message, code) => Object.assign(new Error(message), { tool: true, code });

export function createIntake({ SECURITY = {}, readBytes, now = () => Date.now() } = {}) {
  const links = new Map();   // token -> { person, name, at, bytes }
  const sweep = () => { for (const [t, l] of links) if (now() - l.at > TTL_MS) links.delete(t); };
  const staged = () => [...links.values()].reduce((n, l) => n + (l.bytes?.length || 0), 0);

  function link(person, name, path = "/up/") {
    if (!person) throw err("Å legge inn en fil krever innlogging.", "signed_out");
    sweep();
    if ([...links.values()].filter(l => l.person === person).length >= PER_PERSON) throw err("For mange filer venter: bruk de du har, eller vent noen minutter.", "limit");
    if (links.size >= ALL) throw err("Mange filer venter akkurat nå: prøv igjen om litt.", "limit");
    const token = randomBytes(24).toString("base64url");
    links.set(token, { person, name: String(name || "fil").replace(/[\p{C}\/\\"<>]/gu, "_").slice(0, 120) || "fil", at: now(), bytes: null });
    return { upload_token: token, upload_url: `${path}${token}`, method: "PUT", max_bytes: MAX_UPLOAD, expires_in_s: TTL_MS / 1000,
      next: "PUT the file body to upload_url, then pass upload_token to fetch_model (a model) or add_site_photo (a picture of the building)." };
  }
  /* the file a token holds, once: { bytes, name }; another person's token is the same as none */
  function take(token, person) {
    sweep();
    const t = String(token || ""), l = TOKEN.test(t) ? links.get(t) : null;
    if (!l || !person || l.person !== person) throw err("Fant ikke den opplastede fila (lenken er brukt, gått ut eller ikke din). Be om en ny.", "unknown");
    if (!l.bytes) throw err("Ingen fil er lagt i lenken ennå.", "empty");
    links.delete(t); return { bytes: l.bytes, name: l.name };
  }
  const json = (res, code, body) => { res.writeHead(code, { ...SECURITY, "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(body)); return true; };
  /* PUT /up/<token>: the capability is the token */
  async function route(req, res, path) {
    if (!path.startsWith("/up/")) return false;
    if (req.method !== "PUT") return json(res, 405, { error: "PUT" });
    sweep();
    const t = path.slice(4), l = TOKEN.test(t) ? links.get(t) : null;
    if (!l) return json(res, 404, { error: "Ukjent eller utgått lenke." });
    if (l.bytes) return json(res, 409, { error: "Lenken er brukt." });
    let b;
    try { b = await readBytes(req, MAX_UPLOAD); } catch (e) { return json(res, e.big ? 413 : 400, { error: e.big ? "Fila er større enn 100 MB." : "Fikk ikke lest fila." }); }
    if (!b.length) return json(res, 400, { error: "Fila er tom." });
    if (staged() + b.length > 2 * MAX_UPLOAD) return json(res, 503, { error: "Mange filer venter: prøv igjen om litt." });
    if (!links.has(t)) return json(res, 404, { error: "Ukjent eller utgått lenke." });
    l.bytes = b; return json(res, 200, { ok: true, bytes: b.length });
  }
  return { link, take, route, pending: () => links.size };
}

/* the tools: upload_url, and add_site_photo (fetch_model takes upload_token in mcp.mjs, beside its url) */
export function intakeTools({ intake, userOf, hostOf, sitePhotos, wingOrErr, S, WING, toolErr }) {
  const photoErr = e => { throw e.photo ? toolErr(e.message) : e; };
  return [
    { name: "upload_url", title: "Lenke for å legge inn en fil", ro: true, schema: S({ name: { type: "string", description: "The file's name, with its ending" } }),
      description: "A one-use link for a file from the person's Dokumenter (document:<id>). The door calls this and PUTs the bytes itself when a tool is given file=; you need it only if you are told to.",
      run: async (a, req) => { const who = userOf(req); const l = intake.link(who, a.name); return { ...l, upload_url: hostOf(req) + l.upload_url }; } },
    { name: "add_site_photo", title: "Legg til et bilde av bygget", write: true,
      schema: S({ upload_token: { type: "string", description: "From upload_url (the door fills it from file=document:<id>)" }, wing: { ...WING, description: "The wing it shows" }, side: { type: "string", enum: ["nord", "øst", "sør", "vest", "ukjent"] }, note: { type: "string" }, year: { type: "integer", description: "When it was taken" } }, ["wing"]),
      description: "Adds a picture the person has in Dokumenter to their own photos of the building (JPEG, PNG, WebP; at most 8 MB). Needs the wing. They are the person's own, and read off a photo, never measured.",
      run: async (a, req) => {
        const who = userOf(req); if (!who) throw toolErr("Bildene hører til en innlogget person."); if (!sitePhotos) throw toolErr("Bilder tas ikke imot på denne serveren.");
        if (!a.upload_token) throw toolErr("Gi file (document:<id>) fra Dokumenter, eller upload_token fra upload_url.");
        const w = wingOrErr(a.wing), f = intake.take(a.upload_token, who);
        try { return { added: sitePhotos.add(who, f.bytes, { wing: w.id, side: a.side, note: a.note, year: a.year }) }; } catch (e) { photoErr(e); } } },
  ];
}
