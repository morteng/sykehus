/* check_model: the after's IFC (as GET /api/ifc makes it) goes to the worker's ifccheck step, and the answer comes back in
   words. The worker is a stub that answers as gulden-worker's steps/ifccheck.py does. Run: node --test tests/check-model.test.mjs */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createHash } from "node:crypto";

const PORT = 19000 + Math.floor(Math.random() * 900), BASE = `http://localhost:${PORT}`;
let srv, worker, id = 0; const blobs = new Map(), jobs = [];
const WALL = { global_id: "0abc", name: "Vegg 7", class: "IfcWall", reason: "Name: The attribute value \"None\" is empty" };
const ANSWER = {
  ids: { what: "ids", ok: false, failed: 1, specifications: [{ name: "IfcWall: name, material, predefined type", applicable: 12, passed: 11, failed: 1, failures: [WALL] }, { name: "IfcBuildingStorey: Elevation", applicable: 3, passed: 3, failed: 0, failures: [] }] },
  clash: { what: "clash", a: "all", b: "all", tolerance_mm: 2, count: 1, clashes: [{ a: { name: "Vegg 1", class: "IfcWall", global_id: "g1" }, b: { name: "Dekke", class: "IfcSlab", global_id: "g2" }, depth_m: 0.2 }] },
  diff: { what: "diff", added: 1, removed: 0, changed: 2, added_first: [{ name: "Takhage", class: "IfcBuildingElementProxy", global_id: "g3" }], removed_first: [], changed_first: [{ name: "Vegg 1", class: "IfcWall", global_id: "g1", change: "geometry_changed" }] },
};
before(async () => {
  worker = createServer((req, res) => { const b = []; req.on("data", c => b.push(c)); req.on("end", () => {
    const body = Buffer.concat(b);
    if (req.url === "/blobs") { const sha = createHash("sha256").update(body).digest("hex"); blobs.set(sha, body); return res.end(JSON.stringify({ sha256: sha, bytes: body.length })); }
    const j = JSON.parse(body); jobs.push(j);
    res.end(JSON.stringify({ state: "done", ifccheck: ANSWER[j.ifccheck.what] }));
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
const draft = async () => (await call("try_change", { edits: [{ kind: "volume", id: "ntakhage", name: "Takhage", shape: "box", from: [30, -90], to: [40, -90], width: 6, height: 3, material: "wood", why: "test: takhage" }], include_screenshot: false })).data.draft;

test("check_model is a read tool with a described schema and an output schema", async () => {
  const r = await (await fetch(`${BASE}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) })).json();
  const t = r.result.tools.find(x => x.name === "check_model");
  assert.equal(t.annotations.readOnlyHint, true); assert.deepEqual(t.inputSchema.properties.what.enum, ["standard", "clashes", "changes"]);
  assert.ok(t.inputSchema.properties.target && t.inputSchema.required.includes("what")); assert.ok(t.outputSchema.properties.say && t.outputSchema.properties.specifications);
  assert.ok(t.description.length < 900);
});

test("standard: the draft's IFC reaches the worker, the answer names the failing wall and what to do", async () => {
  const d = await draft(), n = jobs.length;
  const r = await call("check_model", { what: "standard", draft: d });
  assert.ok(!r.isError, JSON.stringify(r.content));
  const j = jobs[n]; assert.deepEqual(j.then, ["ifccheck"]); assert.deepEqual(j.ifccheck, { what: "ids", file: "model.ifc" });
  const ifc = blobs.get(j.inputs["model.ifc"]).toString("utf8");
  assert.match(ifc, /^ISO-10303-21;/); assert.match(ifc, /Takhage/, "the draft's new building is in the file the worker was sent");
  assert.equal(r.data.ok, false); assert.equal(r.data.specifications[0].failures[0].global_id, "0abc");
  assert.match(r.data.say, /1 av 2 krav har brudd\. IfcWall: name, material, predefined type: 1 av 12/); assert.match(r.data.todo, /Rett opp/);
});

test("clashes: classes and tolerance are sent on, the pairs come back by name with depth", async () => {
  const n = jobs.length, r = await call("check_model", { what: "clashes", a: "IfcWall", b: "IfcSlab", tolerance_mm: 5 });
  assert.deepEqual(jobs[n].ifccheck, { what: "clash", file: "model.ifc", a: "IfcWall", b: "IfcSlab", tolerance_mm: 5 });
  assert.equal(r.data.count, 1); assert.match(r.data.say, /1 par står inne i hverandre \(over 2 mm\)\. Dypest: Vegg 1 \(IfcWall\) mot Dekke \(IfcSlab\), 200 mm/);
  assert.match(r.data.of, /før-modellen/, "no target and nobody signed in: the shared before");
});

test("changes: the draft against the shared before, both files sent", async () => {
  const d = await draft(), n = jobs.length, r = await call("check_model", { what: "changes", draft: d });
  const j = jobs[n]; assert.deepEqual(j.ifccheck, { what: "diff", file: "model.ifc", other: "other.ifc" }); assert.equal(Object.keys(j.inputs).length, 2);
  assert.notEqual(j.inputs["model.ifc"], j.inputs["other.ifc"]); assert.match(blobs.get(j.inputs["model.ifc"]).toString("utf8"), /Takhage/); assert.doesNotMatch(blobs.get(j.inputs["other.ifc"]).toString("utf8"), /Takhage/);
  assert.match(r.data.say, /1 lagt til, 0 tatt bort, 2 endret\. Nye: Takhage \(IfcBuildingElementProxy\)\./);
  assert.equal((await call("check_model", { what: "changes", draft: d, against: "ikke-en-id" })).isError, true);
  assert.equal((await call("check_model", { what: "nonsense" })).isError, true);
});

test("the worker down: the answer says so in plain words and gives no result", async () => {
  worker.close(); worker.closeAllConnections?.();
  const r = await call("check_model", { what: "standard" });
  assert.equal(r.isError, true); assert.match(r.content[0].text, /Modellkontrollen kan ikke kjøre nå: arbeideren svarer ikke/);
  assert.equal(r.data, undefined);
});
