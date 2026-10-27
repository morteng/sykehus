/* The worker's cold `import ifcopenshell` sometimes dies with the script error «KeyboardInterrupt» (the sandbox, not the script):
   bim.mjs asks again once, after a pause; any other answer is not asked again. A stubbed fetch, no worker.
   node --test tests/worker-retry.test.mjs */
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.SYKEHUS_VERSIONS_DIR = mkdtempSync(join(tmpdir(), "sykehus-retry-"));
process.env.SYKEHUS_WORKER = "http://worker.test";
const { runBim, checkIfc, RETRY } = await import("../bim.mjs");

const realFetch = globalThis.fetch; let posts;
const reply = (j, ok = true) => ({ ok, json: async () => j, arrayBuffer: async () => new ArrayBuffer(0) });
const fail = message => reply({ state: "failed", errors: [{ code: "script_error", message }], log: "" });
const stub = answers => { posts = 0; globalThis.fetch = async (url, init) => {
  if (String(url).includes("/blobs")) return reply({ sha256: "b".repeat(64) });
  if (!String(url).includes("/jobs")) throw new Error("unexpected " + url);
  return answers[Math.min(posts++, answers.length - 1)](init); }; };
beforeEach(() => { RETRY.ms = 5; });
afterEach(() => { globalThis.fetch = realFetch; });
const run = tag => runBim(`print(${tag})`, { a: 1 });
const okCheck = reply({ state: "done", ifccheck: { issues: [] } });

test("KeyboardInterrupt first, a good answer second: the second answer is used", async () => {
  stub([() => fail("KeyboardInterrupt"), () => okCheck]);
  const r = await checkIfc({ "model.ifc": Buffer.from("x") }, {});
  assert.deepEqual(r, { issues: [] }); assert.equal(posts, 2);
});
test("KeyboardInterrupt twice: the first error, after two asks only", async () => {
  stub([() => fail("KeyboardInterrupt")]);
  await assert.rejects(run("twice"), /Skriptet feilet.*KeyboardInterrupt/); assert.equal(posts, 2);
});
test("another script error is asked once; text that only contains the word is not the hiccup", async () => {
  stub([() => fail("NameError: x")]); await assert.rejects(run("other"), /NameError/); assert.equal(posts, 1);
  stub([() => fail("KeyboardInterrupt: more")]); await assert.rejects(run("longer"), /KeyboardInterrupt: more/); assert.equal(posts, 1);
});
test("the pause is taken before the second ask", async () => {
  RETRY.ms = 150; stub([() => fail("KeyboardInterrupt"), () => okCheck]);
  const t = Date.now(); await checkIfc({ "model.ifc": Buffer.from("x") }, {}); assert.ok(Date.now() - t >= 140);
});
