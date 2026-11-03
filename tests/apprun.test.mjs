/* U3930: the app runner on bygg (app_run, app_state, app_docs). A stub FreeCAD worker runs the real job script (tools/apprun_job.py)
   under python3 in a temp folder, so the folder rule is tested where it lives. Needs python3. FreeCAD itself is not here: a
   script that makes a file with plain Python stands for the app work; app_state is answered by the stub.
   Run: node --test tests/apprun.test.mjs */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = 19900 + Math.floor(Math.random() * 90), O = `http://localhost:${PORT}`, secret = "proxy-secret-for-tests-0123456789";
const dir = mkdtempSync(join(tmpdir(), "sykehus-apprun-")), outside = join(dir, "utenfor.txt");
const as = n => ({ "remote-user": n, "x-edge-auth": secret });
const JOB = new URL("../tools/apprun_job.py", import.meta.url).pathname;
let srv, worker, id = 0; const blobs = new Map(), made = new Map();

before(async () => {
  worker = createServer((req, res) => { const b = []; req.on("data", c => b.push(c)); req.on("end", () => {
    const body = Buffer.concat(b);
    if (req.url === "/blobs") { const sha = createHash("sha256").update(body).digest("hex"); blobs.set(sha, body); return res.end(JSON.stringify({ sha256: sha })); }
    if (req.url.startsWith("/files/")) return res.end(made.get(req.url.slice(7)));
    const job = JSON.parse(body), w = mkdtempSync(join(tmpdir(), "job-"));
    for (const [n, sha] of Object.entries(job.inputs)) writeFileSync(join(w, n), blobs.get(sha));
    writeFileSync(join(w, "params.json"), JSON.stringify(job.params)); writeFileSync(join(w, "job.py"), job.script);
    if (job.params.ask.state) return res.end(JSON.stringify({ state: "done", result: { done: { documents: [{ file: "a.FCStd", name: "a", objects: [{ name: "Box", label: "Bjelke", type: "Part::Box", state: [], touched: false, failed: false }, { name: "Cut", label: "Hull", type: "Part::Cut", state: ["Invalid"], touched: true, failed: true }] }], open_errors: [] } } }));
    const r = spawnSync("python3", [join(w, "job.py")], { cwd: w, encoding: "utf8" }), last = r.stdout.trim().split("\n").pop();
    const files = {}; for (const n of readdirSync(w)) if (!["job.py", "params.json"].includes(n) && !n.startsWith(".") && !n.startsWith("in__") && !/\.(py)$/.test(n) || n === "bjelke.txt") { made.set(`${w.slice(-6)}-${n}`, readFileSync(join(w, n))); files[n] = `/files/${w.slice(-6)}-${n}`; }
    res.end(JSON.stringify({ state: "done", result: JSON.parse(last), files }));
  }); });
  await new Promise(r => worker.listen(0, "127.0.0.1", r));
  srv = spawn(process.execPath, [new URL("../server.mjs", import.meta.url).pathname], { env: { ...process.env, PORT: String(PORT), SYKEHUS_VERSIONS_DIR: join(dir, "v"), SYKEHUS_PROXY_SECRET: secret, SYKEHUS_COOKIE_SECRET: "cookie-secret-for-tests-0123456789", SYKEHUS_WORKER_FREECAD: `http://127.0.0.1:${worker.address().port}` }, stdio: ["ignore", "pipe", "inherit"] });
  await new Promise((ok, no) => { srv.stdout.on("data", d => String(d).includes("Sykehustomta on") && ok()); srv.on("exit", c => no(new Error("server exited " + c))); });
});
after(() => { srv?.kill(); worker?.close(); rmSync(dir, { recursive: true, force: true }); });
const call = async (name, args = {}, who = "ola") => {
  const r = await (await fetch(`${O}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...as(who) }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method: "tools/call", params: { name, arguments: args } }) })).json();
  if (r.error) throw new Error(r.error.message); return { ...r.result, data: r.result.structuredContent };
};
const mine = async () => (await call("new_version", { title: "Fagverk" })).data.version;

test("the runner is a short named list with a manual", async () => {
  const d = (await call("app_docs", { app: "freecad" })).data;
  assert.deepEqual(d.apps, ["freecad"]); assert.match(d.example, /FreeCAD\.newDocument/); assert.ok(d.rules.some(r => /refused/.test(r)));
  const bad = await call("app_docs", { app: "bash" }); assert.ok(bad.isError); assert.match(bad.content[0].text, /app må være/);
});

test("without confirm nothing runs", async () => {
  const v = await mine(), r = await call("app_run", { version: v, app: "freecad", script: "print(1)" });
  assert.ok(r.isError); assert.match(r.content[0].text, /confirm: true/); assert.match(r.content[0].text, /Ingenting ble kjørt/);
});

test("a real task: a file made in the version's folder, the receipt in plain words, the audit row with the whole script", async () => {
  const v = await mine(), script = "v = 6.0 * 0.2 * 0.4\nopen('bjelke.txt', 'w').write('volum m3: %.3f' % v)\nprint('ferdig')";
  const r = await call("app_run", { version: v, app: "freecad", script, confirm: true });
  assert.ok(!r.isError, JSON.stringify(r)); assert.equal(r.data.ok, true); assert.deepEqual(r.data.files, ["bjelke.txt"]);
  assert.match(r.data.receipt, /Kjørte skriptet i freecad på «Fagverk»\. Filer i versjonens mappe: bjelke\.txt/);
  assert.equal(readFileSync(join(dir, "v", "_apps", v, "bjelke.txt"), "utf8"), "volum m3: 0.480");
  assert.match(r.data.feedback.output_tail, /ferdig/);
  const rows = readFileSync(join(dir, "v", "_apps", "apps.log"), "utf8").trim().split("\n").map(JSON.parse), row = rows.at(-1);
  assert.equal(row.script, script); assert.equal(row.by, "ola"); assert.equal(row.exit, 0); assert.deepEqual(row.changed, ["bjelke.txt"]);
});

test("a write outside the version's folder is refused, and nothing is written there", async () => {
  const v = await mine(), r = await call("app_run", { version: v, app: "freecad", script: `open(${JSON.stringify(outside)}, "w").write("x")`, confirm: true });
  assert.equal(r.data.ok, false); assert.equal(r.data.feedback.exit_code, 2); assert.equal(r.data.feedback.error_kind, "write outside the folder");
  assert.match(r.data.feedback.error, /only write files in its own folder/); assert.equal(r.data.feedback.failed_line.n, 1);
  assert.equal(existsSync(outside), false);
  assert.match(r.data.receipt, /stoppet av sperren i linje 1/); assert.match(r.data.receipt, /Bare prøvd/);
  assert.match(r.data.feedback.suggestion, /relativt filnavn/);
});

test("the network and other programs are refused too", async () => {
  const v = await mine();
  const a = await call("app_run", { version: v, app: "freecad", script: "import socket\nsocket.socket().connect(('127.0.0.1', 9))", confirm: true });
  assert.equal(a.data.feedback.exit_code, 2); assert.match(a.data.feedback.error, /network/);
  const b = await call("app_run", { version: v, app: "freecad", script: "import os\nos.system('echo hei')", confirm: true });
  assert.equal(b.data.feedback.exit_code, 2); assert.match(b.data.feedback.error, /programs/);
});

test("one correction loop: a wrong name is reported with its line and a suggestion, the fixed script runs", async () => {
  const v = await mine(), bad = await call("app_run", { version: v, app: "freecad", script: "x = 1\ny = Bx(1, 2, 3)", confirm: true });
  assert.equal(bad.data.ok, false); assert.equal(bad.data.feedback.error_kind, "unknown name"); assert.equal(bad.data.feedback.failed_line.n, 2);
  assert.match(bad.data.feedback.suggestion, /Bx er ikke et navn FreeCAD kjenner/); assert.ok(bad.data.feedback.traceback_tail.length);
  assert.match(bad.data.receipt, /Bare prøvd, ikke gjort ferdig/);
  const good = await call("app_run", { version: v, app: "freecad", script: "x = 1\ny = max(1, 2, 3)\nopen('ut.txt', 'w').write(str(y))", confirm: true });
  assert.equal(good.data.ok, true); assert.deepEqual(good.data.files, ["ut.txt"]);
  const syn = await call("app_run", { version: v, app: "freecad", script: "def f(:\n  pass", confirm: true });
  assert.equal(syn.data.feedback.exit_code, 3); assert.equal(syn.data.feedback.error_kind, "syntax"); assert.match(syn.data.feedback.suggestion, /ikke gyldig Python/);
});

test("only the owner runs in a version, and an app outside the list is refused", async () => {
  const v = await mine();
  const other = await call("app_run", { version: v, app: "freecad", script: "print(1)", confirm: true }, "kari"); assert.ok(other.isError); assert.match(other.content[0].text, /Fant ingen versjon/);
  const bad = await call("app_run", { version: v, app: "bash", script: "ls", confirm: true }); assert.ok(bad.isError);
});

test("app_state says what is in the work: the objects and what failed", async () => {
  const v = await mine(), r = await call("app_state", { version: v, app: "freecad" });
  assert.ok(!r.isError, JSON.stringify(r)); assert.deepEqual(r.data.failed, ["Hull"]); assert.equal(r.data.documents[0].objects.length, 2);
});

test("the job script itself, run directly: a link out of the folder is refused, so is a delete outside", () => {
  const w = mkdtempSync(join(tmpdir(), "job-direct-")), tgt = mkdtempSync(join(tmpdir(), "job-target-")); writeFileSync(join(tgt, "keep.txt"), "x");
  const go = src => { writeFileSync(join(w, "params.json"), JSON.stringify({ ask: { run: { src } } })); return JSON.parse(spawnSync("python3", [JOB], { cwd: w, encoding: "utf8" }).stdout.trim().split("\n").pop()).done; };
  assert.equal(go(`import os\nos.symlink(${JSON.stringify(tgt)}, 'ut')`).exit, 2);
  assert.equal(go(`import os\nos.remove(${JSON.stringify(join(tgt, "keep.txt"))})`).exit, 2); assert.ok(existsSync(join(tgt, "keep.txt")));
  assert.equal(go("open('inni.txt', 'w').write('ok')").ok, true);
});
