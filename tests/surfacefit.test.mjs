/* Finding 6 (2026-10-25): a pool laid over a footpath, and the result said nothing. try_change's fit now says what a
   new surface covers, the ways there are today among it; here hagekart's /api/streets and /api/nvdb are a stub with
   one footway across the site, so the test does not go out on the net. */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { siteGrid } from "../public/utm.js";

const site = JSON.parse(readFileSync(new URL("../public/data/site.json", import.meta.url), "utf8")), g = siteGrid(site.origin);
const way = [[-120, -60], [-120, -100]].map(g.toLngLat);   // a footway, 2 m wide, running north–south at east -120
const stub = createServer((req, res) => {
  const body = req.url.startsWith("/api/streets") ? { type: "FeatureCollection", features: [{ type: "Feature", properties: { highway: "footway" }, geometry: { type: "LineString", coordinates: way } }] } : { type: "FeatureCollection", features: [] };
  res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body));
}).listen(0);
const SP = stub.address().port, PORT = 19000 + Math.floor(Math.random() * 800);
const srv = spawn(process.execPath, [new URL("../server.mjs", import.meta.url).pathname], { env: { ...process.env, PORT: String(PORT), SYKEHUS_STREETS_URL: `http://127.0.0.1:${SP}`, DOCS: "" }, stdio: ["ignore", "pipe", "inherit"] });
await new Promise(ok => srv.stdout.on("data", d => String(d).includes("Sykehustomta on") && ok()));
after(() => { srv.kill(); stub.close(); });
const call = async (name, args) => (await (await fetch(`http://localhost:${PORT}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) })).json()).result.structuredContent;

test("try_change: a pool over the footway says it covers it, by m²; one beside it says nothing", async () => {
  const over = await call("try_change", { edits: [{ kind: "surface", ring: [[-130, -85], [-110, -85], [-110, -75], [-130, -75]], surface: "water", name: "Basseng" }], include_screenshot: false });
  const f = over.fit.find(x => x.name === "Basseng"); assert.equal(f.area_m2, 200);
  const o = f.overlaps.find(x => /^gangvei, 2 m bred \(OSM\)$/.test(x.with)); assert.ok(o && Math.abs(o.m2 - 20) <= 3, JSON.stringify(f.overlaps));
  const beside = await call("try_change", { edits: [{ kind: "surface", ring: [[-150, -85], [-135, -85], [-135, -75], [-150, -75]], surface: "grass", name: "Plen" }], include_screenshot: false });
  assert.deepEqual(beside.fit.find(x => x.name === "Plen").overlaps.filter(x => /OSM/.test(x.with)), []);
});
