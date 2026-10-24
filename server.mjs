/* Sykehustomta's server: the web page and its data. No dependencies.

  PORT=8090 node server.mjs

Open to everyone for looking and trying; saving (to come) needs a login. */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, normalize, join } from "node:path";

const PUB = new URL("./public/", import.meta.url).pathname, PORT = +process.env.PORT || 8090;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".txt": "text/plain; charset=utf-8" };

createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname), file = normalize(join(PUB, path.endsWith("/") ? path + "index.html" : path));
    if (!file.startsWith(PUB) || req.method !== "GET" && req.method !== "HEAD") throw new Error("not served");
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream", "cache-control": "no-cache" }).end(req.method === "HEAD" ? undefined : body);
  } catch { res.writeHead(404, { "content-type": "text/plain" }).end("Ikke funnet"); }
}).listen(PORT, () => console.log(`Sykehustomta on http://localhost:${PORT}`));
