/* File intake B4 (U4357): a Dokumenter file reaches Sykehus the way it reaches Fab: upload_url, PUT /up/<token>, then the token in
   fetch_model (a model, a dropped GLB) or add_site_photo (a picture). One use, ten minutes, the asker's only.
   node --test tests/intake.test.mjs */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { createIntake, TTL_MS } from "../intake.mjs";

const readBytes = req => new Promise(ok => { const p = []; req.on("data", c => p.push(c)); req.on("end", () => ok(Buffer.concat(p))); });

test("a link takes one file, once, for the person who asked, for ten minutes", () => {
  let t = 1000; const i = createIntake({ now: () => t });
  assert.throws(() => i.link(null, "a.glb"), /innlogging/);
  const l = i.link("lars", "Benk «1».glb");
  assert.match(l.upload_token, /^[A-Za-z0-9_-]{32}$/); assert.equal(l.upload_url, `/up/${l.upload_token}`); assert.equal(l.method, "PUT");
  assert.throws(() => i.take(l.upload_token, "lars"), /ennå/, "nothing put yet");
  const l2 = i.link("lars", "x.glb"); assert.notEqual(l2.upload_token, l.upload_token);
  t += TTL_MS + 1; assert.throws(() => i.take(l.upload_token, "lars"), /Fant ikke/, "expired");
  assert.equal(i.pending(), 0, "and swept");
  for (let n = 0; n < 5; n++) i.link("mia", "f");
  assert.throws(() => i.link("mia", "f"), /For mange/); i.link("lars", "f");
});

/* the real server, a stub worker that reads a GLB */
const GLB = Buffer.concat([Buffer.from("glTF"), Buffer.alloc(60, 7)]), PNG = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.alloc(64, 2)]);
const MESH = { box: { min: [0, 0, 0], max: [2, 1, 1] }, unit: { length: "metre", to_m: 1 }, classes: { IfcBuildingElementProxy: 1 }, buildings: 0, storeys: 0, triangles: 1, parts: [{ cls: "IfcBuildingElementProxy", n: 1, pos: [0, 0, 0, 2, 0, 0, 1, 1, 1], idx: [0, 1, 2] }] };
const seen = [];
const worker = createServer(async (req, res) => {
  const body = await readBytes(req);
  if (req.url === "/blobs") { seen.push(["blob", body.length]); return res.end(JSON.stringify({ sha256: createHash("sha256").update(body).digest("hex"), bytes: body.length })); }
  if (req.url.startsWith("/jobs?")) { const j = JSON.parse(body); seen.push(["job", Object.keys(j.inputs)[0], j.then]); return res.end(JSON.stringify({ state: "done", files: { "mesh.json": "/f/mesh.json", "model.ifc": "/f/model.ifc", "model.glb": "/f/model.glb", "import.json": "/f/import.json" } })); }
  if (req.url.endsWith("import.json")) return res.end(JSON.stringify({ format: "glb", unit: "metre", unit_from: "file", up: "y", parts: 1 }));
  if (req.url.endsWith("model.ifc")) return res.end("ISO-10303-21;"); if (req.url.endsWith("model.glb")) return res.end("glTF");
  res.end(JSON.stringify(MESH));
});
await new Promise(ok => worker.listen(0, "127.0.0.1", ok));
const dir = mkdtempSync(join(tmpdir(), "sykehus-intake-")), secret = "proxy-secret-for-tests-0123456789", PORT = 9600 + Math.floor(Math.random() * 90), O = `http://localhost:${PORT}`;
const as = p => ({ "remote-user": p, "x-edge-auth": secret });
const sv = spawn(process.execPath, [new URL("../server.mjs", import.meta.url).pathname], { env: { ...process.env, PORT: String(PORT), SYKEHUS_VERSIONS_DIR: join(dir, "v"), SYKEHUS_PROXY_SECRET: secret, SYKEHUS_WORKER: `http://127.0.0.1:${worker.address().port}`, DOCS: "" }, stdio: ["ignore", "pipe", "inherit"] });
await new Promise(ok => sv.stdout.on("data", d => String(d).includes("Sykehustomta on") && ok()));
after(() => { sv.kill(); worker.close(); });
const rpc = async (name, args, who = "lars") => (await (await fetch(O + "/mcp", { method: "POST", headers: { "content-type": "application/json", ...as(who) }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) })).json()).result;
const link = async (name, who) => { const r = await rpc("upload_url", { name }, who); return r.structuredContent; };
const put = (l, body) => fetch(l.upload_url.replace(/^https?:\/\/[^/]+/, O), { method: "PUT", headers: { "content-type": "application/octet-stream" }, body });

test("a dropped GLB: upload_url, PUT, fetch_model with the token reads it in as an upload is", async () => {
  const l = await link("Benk.glb"); assert.match(l.upload_url, /\/up\/[A-Za-z0-9_-]{32}$/);
  assert.equal((await fetch(O + "/up/" + "x".repeat(32), { method: "PUT", body: GLB })).status, 404, "an unknown token");
  assert.equal((await put(l, GLB)).status, 200); assert.equal((await put(l, GLB)).status, 409, "once");
  const r = await rpc("fetch_model", { upload_token: l.upload_token, licence: "egen" }, "mia");
  assert.equal(r.isError, true, "another person's token is none"); assert.match(r.content[0].text, /Fant ikke/);
  const ok = await rpc("fetch_model", { upload_token: l.upload_token, licence: "CC0" });
  assert.equal(ok.isError, undefined, JSON.stringify(ok.content)); assert.equal(ok.structuredContent.file, createHash("sha256").update(GLB).digest("hex"));
  assert.equal(ok.structuredContent.filename, "Benk.glb"); assert.equal(ok.structuredContent.licence, "CC0"); assert.equal(ok.structuredContent.source, "Dokumenter");
  assert.deepEqual(seen.find(x => x[0] === "job"), ["job", "Benk.glb", ["import", "mesh"]]);
  assert.equal((await rpc("fetch_model", { upload_token: l.upload_token })).isError, true, "the link is spent");
});
test("a picture from Dokumenter becomes one of the person's own photos of the building; a model file is not one", async () => {
  const l = await link("fasade.png"); await put(l, PNG);
  const a = await rpc("add_site_photo", { upload_token: l.upload_token, wing: "Sentralblokka", side: "sør", year: 1962 });
  assert.equal(a.isError, undefined, JSON.stringify(a.content)); assert.equal(a.structuredContent.added.wing, "sentralblokka");
  assert.equal((await rpc("list_site_photos", {})).structuredContent.count, 1); assert.equal((await rpc("list_site_photos", {}, "mia")).structuredContent.count, 0);
  const g = await link("x.glb"); await put(g, GLB);
  const bad = await rpc("add_site_photo", { upload_token: g.upload_token, wing: "Sentralblokka" }); assert.equal(bad.isError, true); assert.match(bad.content[0].text, /JPEG, PNG eller WebP/);
  const out = await (await fetch(O + "/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "upload_url", arguments: { name: "a" } } }) })).text();
  assert.match(out, /innlogging/, "signed out: no link");
});
test("a fetch_model with neither url nor token says what to give", async () => {
  const r = await rpc("fetch_model", {}); assert.equal(r.isError, true); assert.match(r.content[0].text, /url fra find_models, eller file/);
});
