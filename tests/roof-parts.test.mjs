/* U3836: a greenhouse (also larger than 12 x 30 m), stair or railing stands on a wing's roof by at {wing, roof: true}, sized by at.length / at.width
   or by what the part has. node --test tests/roof-parts.test.mjs */
import { spawn } from "node:child_process";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PARTS = {
  greenhouse: { no: "Drivhus", say: "gh", engine: "ifcopenshell", classes: ["IfcMember"], params: { sides: { type: "number", default: 6 }, radius: { type: "number", default: 2 } } },
  stair: { no: "Trapp", say: "st", engine: "ifcopenshell", classes: ["IfcStair"], params: { height: { type: "number", default: 2.8 }, width: { type: "number", default: 1.2 } } },
  railing: { no: "Rekkverk", say: "rl", engine: "ifcopenshell", classes: ["IfcRailing"], params: { length: { type: "number", default: 3 } } } };
const jobs = []; let last = { radius: 3 };
const fake = createServer((req, res) => {
  let b = ""; req.on("data", c => b += c); req.on("end", () => {
    if (req.url.startsWith("/parts")) return res.end(JSON.stringify({ parts: PARTS }));
    if (req.method === "POST") { const j = JSON.parse(b); jobs.push(j); last = { radius: j.params.radius ?? 3 }; return res.end(JSON.stringify({ state: "done", result: { params: j.params }, files: { "mesh.json": `/f/${j.part}/mesh.json`, "model.ifc": `/f/${j.part}/model.ifc` } })); }
    if (req.url.endsWith("mesh.json")) return res.end(JSON.stringify({ box: { min: [-last.radius, -last.radius, 0], max: [last.radius, last.radius, 2] }, classes: { IfcMember: 1 }, buildings: 1, storeys: 1, triangles: 1, parts: [{ cls: "IfcMember", n: 1, pos: [-3, -1, 0, 3, -1, 0, 3, 1, 0], idx: [0, 1, 2] }] }));
    res.end("ISO-10303-21;"); }); });
await new Promise(r => fake.listen(0, "127.0.0.1", r));
const dir = mkdtempSync(join(tmpdir(), "sykehus-roofparts-")), secret = "proxy-secret-for-tests-0123456789", PORT = 9800 + Math.floor(Math.random() * 90);
const srv = spawn(process.execPath, [new URL("../server.mjs", import.meta.url).pathname], { env: { ...process.env, PORT: String(PORT), SYKEHUS_VERSIONS_DIR: join(dir, "v"), SYKEHUS_PROXY_SECRET: secret, DOCS: "", SYKEHUS_WORKER: `http://127.0.0.1:${fake.address().port}` }, stdio: ["ignore", "pipe", "inherit"] });
await new Promise(ok => srv.stdout.on("data", d => String(d).includes("Sykehustomta on") && ok()));
after(() => { srv.kill(); fake.close(); });
const H = { "remote-user": "lars", "x-edge-auth": secret };
const call = async (name, args) => (await (await fetch(`http://localhost:${PORT}/mcp`, { method: "POST", headers: { "content-type": "application/json", ...H }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) })).json()).result;
const text = r => r.content.filter(c => c.type === "text").map(c => c.text).join(" ");
const stored = async id => (await (await fetch(`http://localhost:${PORT}/api/versjon/${id}`, { headers: H })).json()).edits;
const roofPart = (part, at, params) => call("try_change", { edits: [{ kind: "part", part, at: { wing: "sentralblokka", roof: true, ...at }, params, allow_overlap: true, why: "test" }], include_screenshot: false });

test("a greenhouse larger than 12 x 30 m stands on a roof as a part (frame kept), sized by at.length and at.width", async () => {
  const r = await roofPart("greenhouse", { length: 34, width: 14 }, { sides: 6, radius: 7 }); assert.ok(!r.isError, text(r));
  const [gh] = await stored(r.structuredContent.version);
  assert.equal(gh.shape, "bim"); assert.equal(gh.bim.part, "greenhouse"); assert.equal(gh.on, "sentralblokka");
  assert.ok(Math.abs(Math.hypot(gh.to[0] - gh.from[0], gh.to[1] - gh.from[1]) - 14) < 0.05, "the part is 2 x radius wide: radius 7 gives 14 m, past the 12 m a bare volume took");
  assert.equal(jobs.at(-1).params.length, undefined, "the worker is sent only its own settings");
});
test("a greenhouse with only a radius is as wide as its diameter on the roof; a stair and a railing stand on it too", async () => {
  let r = await roofPart("greenhouse", { u: 2 }, { radius: 3 }); assert.ok(!r.isError, text(r));
  let e = (await stored(r.structuredContent.version)).at(-1); assert.ok(Math.abs(Math.hypot(e.to[0] - e.from[0], e.to[1] - e.from[1]) - 6) < 0.05);
  r = await roofPart("stair", { u: 20 }, { height: 1.2, width: 1.2 }); assert.ok(!r.isError, text(r));
  e = (await stored(r.structuredContent.version)).at(-1); assert.equal(e.bim.part, "stair"); assert.equal(e.on, "sentralblokka");
  r = await roofPart("railing", { length: 12, u: 40 }, {}); assert.ok(!r.isError, text(r));
  e = (await stored(r.structuredContent.version)).at(-1); assert.equal(e.bim.part, "railing"); assert.equal(e.on, "sentralblokka");
});
