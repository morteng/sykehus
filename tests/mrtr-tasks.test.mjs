/* U3932: input_required (MRTR) for an ambiguous call, and a task handle steered mid-flight.   Run: node --test tests/mrtr-tasks.test.mjs */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const PORT = 19000 + Math.floor(Math.random() * 1000), BASE = `http://localhost:${PORT}`;
let srv, id = 0;
before(async () => {
  srv = spawn(process.execPath, [new URL("../server.mjs", import.meta.url).pathname], { env: { ...process.env, PORT: String(PORT) }, stdio: ["ignore", "pipe", "inherit"] });
  await new Promise((ok, no) => { srv.stdout.on("data", d => String(d).includes("Sykehustomta on") && ok()); srv.on("exit", c => no(new Error("server exited " + c))); });
});
after(() => srv?.kill());
const rpc = async (method, params) => {
  const r = await fetch(`${BASE}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) });
  const j = await r.json(); if (j.error) throw new Error(j.error.message); return j.result;
};

test("a call without a wing returns input_required, and completes on the retry with inputResponses", async () => {
  const q = await rpc("tools/call", { name: "about_wing", arguments: {} });
  assert.equal(q.resultType, "input_required");
  const req = q.inputRequests.wing;
  assert.equal(req.method, "elicitation/create"); assert.equal(req.params.message, "Hvilken fløy?");
  assert.ok(req.params.requestedSchema.properties.wing.enum.includes("sentralblokka"));
  const done = await rpc("tools/call", { name: "about_wing", arguments: {}, inputResponses: { wing: { action: "accept", content: { wing: "sentralblokka" } } } });
  assert.equal(done.resultType, "complete"); assert.equal(done.structuredContent.id, "sentralblokka");
  const bad = await rpc("tools/call", { name: "openings", arguments: { wing: "nowhere" } });
  assert.equal(bad.resultType, "input_required"); assert.match(bad.inputRequests.wing.params.message, /nowhere/);
  const ok = await rpc("tools/call", { name: "openings", arguments: { wing: "nowhere" }, inputResponses: { wing: { action: "accept", content: { wing: "ostfloy" } } } });
  assert.equal(ok.structuredContent.wing, "Østfløy");
});

test("a make_shots task is polled and steered mid-flight, and its result is fetched", async () => {
  const t = await rpc("tools/call", { name: "try_change", arguments: { edits: [{ kind: "demolish", building: "Vestfløy" }] } });
  const draft = t.structuredContent.draft;
  const h = await rpc("tools/call", { name: "make_shots", arguments: { draft }, task: {} });
  assert.equal(h.resultType, "task"); const taskId = h.task.taskId;
  assert.ok(["working", "completed"].includes((await rpc("tasks/get", { taskId })).status));
  await rpc("tasks/update", { taskId, inputResponses: { steer: { stop: true } } });
  let s; for (let i = 0; i < 120; i++) { s = await rpc("tasks/get", { taskId }); if (s.status !== "working") break; await new Promise(r => setTimeout(r, 500)); }
  assert.equal(s.status, "completed");
  const r = await rpc("tasks/result", { taskId });
  assert.ok(r.structuredContent.shots.length >= 1);
  assert.ok(r.content.some(c => c.type === "text" && /Stoppet etter/.test(c.text)), "stopped by the steering: " + JSON.stringify(r.content.map(c => c.text || c.type)));
  assert.equal(r.content.filter(c => c.type === "image").length < r.structuredContent.shots.length, true);
  await assert.rejects(() => rpc("tasks/get", { taskId: "tnone" }), /Unknown task/);
});
