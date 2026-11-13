/* export_ifc (U3531): the model as IFC for FreeCAD, tried in the FreeCAD worker (a stub that answers as its import step does).
   Run: node --test tests/export-ifc.test.mjs */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createHash } from "node:crypto";

const PORT = 19000 + Math.floor(Math.random() * 900), BASE = `http://localhost:${PORT}`;
let srv, worker, id = 0, mode = "ok"; const jobs = [], blobs = new Map();
before(async () => {
  worker = createServer((req, res) => { const b = []; req.on("data", c => b.push(c)); req.on("end", () => {
    const body = Buffer.concat(b);
    if (req.url === "/blobs") { const sha = createHash("sha256").update(body).digest("hex"); blobs.set(sha, body); return res.end(JSON.stringify({ sha256: sha, bytes: body.length })); }
    if (req.url.startsWith("/files/")) return res.end(JSON.stringify({ parts: 412, unit: "m" }));
    jobs.push(JSON.parse(body));
    res.end(JSON.stringify(mode === "ok" ? { state: "done", files: { "import.json": "/files/import.json" } } : { state: "failed", errors: [{ code: "import_error", message: "FreeCAD could not read model.ifc" }] }));
  }); });
  await new Promise(r => worker.listen(0, "127.0.0.1", r));
  srv = spawn(process.execPath, [new URL("../server.mjs", import.meta.url).pathname], { env: { ...process.env, PORT: String(PORT), SYKEHUS_WORKER: `http://127.0.0.1:${worker.address().port}` }, stdio: ["ignore", "pipe", "inherit"] });
  await new Promise((ok, no) => { srv.stdout.on("data", d => String(d).includes("Sykehustomta on") && ok()); srv.on("exit", c => no(new Error("server exited " + c))); });
});
after(() => { srv?.kill(); worker?.close(); });
const call = async (name, args = {}) => {
  const r = await (await fetch(`${BASE}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method: "tools/call", params: { name, arguments: args } }) })).json();
  if (r.error) throw new Error(r.error.message); return { ...r.result, data: r.result.structuredContent };
};

test("the shared model goes to FreeCAD as an IFC and the answer says FreeCAD opened it", async () => {
  const r = await call("export_ifc");
  assert.ok(!r.isError, JSON.stringify(r));
  assert.equal(r.data.check.opened, true); assert.equal(r.data.check.parts, 412);
  assert.match(r.data.ifc, /\/api\/ifc\?for=freecad$/); assert.ok(r.data.bytes > 10000);
  assert.deepEqual(jobs.at(-1).then, ["import"]);
  const sent = blobs.get(jobs.at(-1).inputs["model.ifc"]).toString("utf8");
  assert.match(sent, /^ISO-10303-21/); assert.match(sent, /FILE_SCHEMA\s*\(\s*\(\s*'IFC/i);
  assert.match(r.data.say, /åpnet og lest: 412 deler/);
});

test("a draft's link carries the draft and for=freecad", async () => {
  const d = (await call("try_change", { edits: [{ kind: "volume", id: "ntakhage", name: "Takhage", shape: "box", from: [30, -90], to: [40, -90], width: 6, height: 3, material: "wood", why: "test" }], include_screenshot: false })).data.draft;
  const r = await call("export_ifc", { draft: d });
  assert.ok(r.data.ifc.endsWith(`/api/ifc?utkast=${d}&for=freecad`), r.data.ifc);
});

test("when FreeCAD refuses the file the answer says so and does not claim it opens", async () => {
  mode = "fail";
  const r = await call("export_ifc");
  assert.equal(r.data.check.opened, false); assert.match(r.data.say, /ikke vist å åpne: FreeCAD could not read/);
});
