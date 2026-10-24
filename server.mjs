/* Sykehustomta's server: the web page and its data, the connector for chat apps (MCP) and the tried changes. No
   dependencies (Node 22 or newer: node:sqlite reads the document store).

  PORT=8090 DOCS=<docs.sqlite> node server.mjs

  GET  /...               public/ as it is
  POST /mcp               the connector (mcp.mjs)
  GET  /api/utkast/<id>   a draft's changes, for the page's ?utkast=<id>

Open to everyone for looking and trying; saving (to come) needs a login. Without DOCS the document tools say the
store is not loaded and the rest works. The data files are read once at start: restart after a deploy. */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { readFileSync, existsSync } from "node:fs";
import { extname, normalize, join } from "node:path";
import { createMcp } from "./mcp.mjs";

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
const sections = existsSync(join(PUB, "data/sections.json")) ? JSON.parse(readFileSync(join(PUB, "data/sections.json"), "utf8")).sections : [];
const mcp = createMcp({ site, floors, sections, docs, docUrl: f => RELEASE + f, SECURITY, readJson });

createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (path === "/mcp") return await mcp.handleMcp(req, res);
    if (path.startsWith("/api/utkast/")) return mcp.handleDraft(req, res, path.slice("/api/utkast/".length));
    const file = normalize(join(PUB, path.endsWith("/") ? path + "index.html" : path));
    if (!file.startsWith(PUB) || req.method !== "GET" && req.method !== "HEAD") throw new Error("not served");
    const body = await readFile(file);
    res.writeHead(200, { ...SECURITY, ...OPEN, "content-type": TYPES[extname(file)] || "application/octet-stream", "cache-control": "no-cache" }).end(req.method === "HEAD" ? undefined : body);
  } catch { if (!res.headersSent) res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Ikke funnet"); }
}).listen(PORT, () => console.log(`Sykehustomta on http://localhost:${PORT}${docs ? "" : " (no document store: set DOCS)"}`));
