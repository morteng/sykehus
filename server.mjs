/* Sykehustomta's server: the web page and its data, the connector for chat apps (MCP) and the tried changes. No
   dependencies (Node 22 or newer: node:sqlite reads the document store).

  PORT=8090 DOCS=<docs.sqlite> node server.mjs

  GET  /...               public/ as it is
  POST /mcp               the connector (mcp.mjs)
  GET  /api/utkast/<id>   a draft's changes, for the page's ?utkast=<id>
  GET  /api/versjon/<id>  a saved version (versions.mjs), for the page's ?versjon=<id>
  GET  /api/versjoner     the saved versions, newest first

  POST /api/logg-inn, GET /api/meg, POST /api/logg-ut   signing in here with a 4-digit code (login.mjs)
  /api/anton/*            Anton, the assistant, for a person signed in here (assistant.mjs)
  /api/onsker             wishes for what it cannot do yet (wishes.mjs)
  /api/gjengi             «Gjengi»: a view made a realistic picture by an image model, within the month's cap (gjengi.mjs)

  GET  /api/bruk          calls a day per login and per (hashed) address, for pm's report (the box only)
  /.well-known/oauth-*, /oauth/*   the sign-in for chat apps (auth.mjs)

Open to everyone for looking and trying; keeping a version needs a login (auth.mjs: gulden.no in front with
SYKEHUS_PROXY_SECRET, a personal token, or OAuth), and SYKEHUS_VERSIONS_DIR set to where they are kept. Without DOCS the document tools say the
store is not loaded and the rest works. The data files are read once at start: restart after a deploy. */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { readFileSync, existsSync } from "node:fs";
import { extname, normalize, join } from "node:path";
import { createMcp } from "./mcp.mjs";
import { createVersions } from "./versions.mjs";
import { createAuth } from "./auth.mjs";
import { createLogin } from "./login.mjs";
import { createAssistant } from "./assistant.mjs";
import { createStreets } from "./gater.mjs";
import { createWishes } from "./wishes.mjs";
import { importFile, MAX_IMPORT } from "./bim.mjs";
import { createRenderings } from "./gjengi.mjs";

const PUB = new URL("./public/", import.meta.url).pathname, PORT = +process.env.PORT || 8090;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".txt": "text/plain; charset=utf-8", ".ifc": "application/p21" };
const SECURITY = { "x-content-type-options": "nosniff", "referrer-policy": "strict-origin-when-cross-origin" };
/* the chat app runs in the host's sandboxed frame, on another origin: its module script, the viewer's imports, the
   data and the textures are fetched cross-origin. All of it is public and read-only, so any origin may read it. */
const OPEN = { "access-control-allow-origin": "*" };
const RELEASE = "https://github.com/morteng/sykehus/releases/download/dokumenter-2026-10-24/";

const site = JSON.parse(readFileSync(join(PUB, "data/site.json"), "utf8"));
const floors = existsSync(join(PUB, "data/floors.json")) ? JSON.parse(readFileSync(join(PUB, "data/floors.json"), "utf8")).floors : [];
let docs = null;
if (process.env.DOCS) {
  const { DatabaseSync } = await import("node:sqlite");
  docs = new DatabaseSync(process.env.DOCS, { readOnly: true });
}
function readJson(req, max) {
  return new Promise((ok, no) => {
    let n = 0; const parts = [];
    req.on("data", c => { n += c.length; if (n > max) { no(new Error("too large")); req.destroy(); } else parts.push(c); });
    req.on("end", () => { try { ok(JSON.parse(Buffer.concat(parts).toString("utf8"))); } catch (e) { no(e); } });
    req.on("error", no);
  });
}
/* the bytes of an upload, refused past max */
function readBytes(req, max) {
  return new Promise((ok, no) => {
    if (+req.headers["content-length"] > max) return no(Object.assign(new Error("too large"), { big: true }));
    let n = 0; const parts = [];
    req.on("data", c => { n += c.length; if (n > max) { no(Object.assign(new Error("too large"), { big: true })); req.destroy(); } else parts.push(c); });
    req.on("end", () => ok(Buffer.concat(parts)));
    req.on("error", no);
  });
}
/* POST /api/import?filename=: a file brought in (U3571), signed in, at most 100 MB, one at a time per person; kept by
   its sha (bim.mjs importFile: IFC, STEP, glTF, OBJ, STL), then placed with the edit kind import */
const importing = new Set();
async function handleImport(req, res) {
  const json = (n, o) => res.writeHead(n, { ...SECURITY, "content-type": "application/json; charset=utf-8" }).end(JSON.stringify(o));
  if (req.method !== "POST") return json(405, { error: "POST only" });
  const who = login.personOf(req)?.person;
  if (!who) return json(401, { error: "Logg inn for å hente inn filer." });
  if (importing.has(who)) return json(429, { error: "Én fil om gangen: vent til den forrige er lest." });
  importing.add(who);
  try {
    const bytes = await readBytes(req, MAX_IMPORT);
    const q = new URL(req.url, "http://x").searchParams;
    return json(200, await importFile(bytes, { filename: q.get("filename"), unit: q.get("unit"), up: q.get("up"), by: who }));
  } catch (e) { return json(e.big ? 413 : e.tool ? 400 : 500, { error: e.big ? "Fila er større enn 100 MB." : e.tool ? e.message : "Noe gikk galt." }); }
  finally { importing.delete(who); }
}
const sections = existsSync(join(PUB, "data/sections.json")) ? JSON.parse(readFileSync(join(PUB, "data/sections.json"), "utf8")).sections : [];
const auth = createAuth({ SECURITY, readJson });
const versions = createVersions(), login = createLogin({ SECURITY, readJson, proxyUser: auth.proxyUser });
const wishes = createWishes({ SECURITY, readJson, personOf: login.personOf });
/* the person's open pages, as Anton's tools need them: the version the pill has open (assistant.mjs sets it with each
   turn) and a way to move those pages to a view (show_building); one object, filled in by both */
const pages = { open: new Map(), show: () => false };
const mcp = createMcp({ site, floors, sections, docs, docUrl: f => RELEASE + f, SECURITY, readJson, versions, auth, wishes, pages, ways: ms => streets.ways(ms), places: ms => streets.places(ms) });
const anton = createAssistant({ SECURITY, readJson, login, versions, pages });
mcp.setNotifier((person, event, data) => anton.publish(person, event, data));   // a sketch Anton shows reaches the person's page (U3635)
const streets = createStreets({ site, SECURITY });
const gjengi = createRenderings({ SECURITY, readJson, login, versions });   // «Gjengi» (U3526): needs SYKEHUS_VERSIONS_DIR

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://x"), path = decodeURIComponent(url.pathname);
    if (path === "/mcp") return await mcp.handleMcp(req, res);
    if (path === "/mcp/server-card") return mcp.handleCard(req, res);
    if (await auth.route(req, res, url) || await streets.route(req, res, path, url)) return;
    if (await login.route(req, res, path) || await anton.route(req, res, path) || await wishes?.route(req, res, path)) return;
    // the cookie lets its owner see their own private versions
    if (path.startsWith("/api/versjon") || path === "/api/endring" || path === "/api/ifc") req.webUser = login.personOf(req)?.person ?? null;
    if (path === "/api/endring") return mcp.handleChange(req, res);
    if (path === "/api/ifc") return mcp.handleIfc(req, res);
    if (path === "/api/import") return await handleImport(req, res);
    if (await gjengi?.route(req, res, path, url)) return;
    if (path === "/api/skisser") return mcp.handleSketches(req, res, login.personOf(req)?.person);
    if (path.startsWith("/api/skisse/")) return mcp.handleSketch(req, res, path.slice("/api/skisse/".length), login.personOf(req)?.person);   // a plan Anton showed (U3635)
    if (path.startsWith("/api/bim/")) return mcp.handleBim(req, res, path.slice("/api/bim/".length));   // a construction's files (U3570), by sha
    if (path.startsWith("/api/utkast/")) return mcp.handleDraft(req, res, path.slice("/api/utkast/".length));
    if (path.startsWith("/api/versjon/")) return mcp.handleVersion(req, res, path.slice("/api/versjon/".length));
    if (path === "/api/versjoner") return mcp.handleVersions(req, res);
    if (path === "/inn") return res.writeHead(308, { ...SECURITY, location: "/inn/" }).end();   // the fragment (the sign-in link's token) goes along
    /* the Gulden mark where browsers look for it without a link */
    const ICON = { "/favicon.ico": "/icons/icon-192.png", "/apple-touch-icon.png": "/icons/apple-touch-icon-180.png", "/apple-touch-icon-precomposed.png": "/icons/apple-touch-icon-180.png" }[path];
    const file = normalize(join(PUB, ICON || (path.endsWith("/") ? path + "index.html" : path)));
    if (!file.startsWith(PUB) || req.method !== "GET" && req.method !== "HEAD") throw new Error("not served");
    const body = await readFile(file);
    res.writeHead(200, { ...SECURITY, ...OPEN, "content-type": TYPES[extname(file)] || "application/octet-stream", "cache-control": "no-cache" }).end(req.method === "HEAD" ? undefined : body);
  } catch { if (!res.headersSent) res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Ikke funnet"); }
}).listen(PORT, () => console.log(`Sykehustomta on http://localhost:${PORT}${docs ? "" : " (no document store: set DOCS)"}`));
