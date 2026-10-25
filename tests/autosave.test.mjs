/* U3555: everything kept as it is made. A draft survives a restart of the server; signed in, a change goes into the
   person's one working version; a draft made signed out moves into it; «Ny kopi» makes the next one worked on; «Del»
   opens it to those with the link. */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const dir = mkdtempSync(join(tmpdir(), "sykehus-autosave-")), secret = "proxy-secret-for-tests-0123456789", PORT = 9100 + Math.floor(Math.random() * 800);
const O = `http://localhost:${PORT}`, lars = { "remote-user": "lars", "x-sykehus-proxy-auth": secret };
let srv;
async function start() {
  srv = spawn(process.execPath, [new URL("../server.mjs", import.meta.url).pathname], { env: { ...process.env, PORT: String(PORT), SYKEHUS_VERSIONS_DIR: join(dir, "v"), SYKEHUS_PROXY_SECRET: secret, DOCS: "" }, stdio: ["ignore", "pipe", "inherit"] });
  await new Promise(ok => srv.stdout.on("data", d => String(d).includes("Sykehustomta on") && ok()));
}
const stop = () => new Promise(ok => { srv.once("exit", ok); srv.kill(); });
after(() => srv?.kill());
const post = (body, h = {}) => fetch(O + "/api/endring", { method: "POST", headers: { "content-type": "application/json", ...h }, body: JSON.stringify(body) }).then(async r => ({ status: r.status, j: await r.json() }));
const riv = b => ({ edits: [{ kind: "demolish", building: b }] });

await start();
let draft;
test("a draft made signed out is still there after a restart, with its changes and undo", async () => {
  const a = await post(riv("Østfløy")); assert.equal(a.status, 200); draft = a.j.draft;
  await post({ ...riv("Vestfløy"), draft });
  await stop(); await start();
  const d = await (await fetch(`${O}/api/utkast/${draft}`)).json();
  assert.deepEqual(d.edits.map(e => e.building), ["Østfløy", "Vestfløy"]);
  assert.equal((await post({ undo: 2, draft })).status, 200);
  await stop(); await start();
  assert.equal((await (await fetch(`${O}/api/utkast/${draft}`)).json()).edits.length, 1);
});

let work;
test("signed in, a change with nowhere named goes into the person's one working version, private", async () => {
  const a = await post(riv("Midtfløy"), lars); assert.equal(a.status, 200); work = a.j.version; assert.ok(work); assert.ok(a.j.nokkel);
  const b = await post(riv("MR-bygget"), lars); assert.equal(b.j.version, work);
  const list = (await (await fetch(O + "/api/versjoner", { headers: lars })).json()).versions;
  assert.equal(list.filter(v => v.mine && v.work).length, 1); assert.equal(list[0].sharing, "privat");
  assert.equal((await fetch(`${O}/api/versjon/${work}`)).status, 404);   // not for others
});

test("signing in moves the draft into it; the draft is gone", async () => {
  assert.equal((await post({ adopt: draft })).status, 400);   // only signed in
  const a = await post({ adopt: draft }, lars); assert.equal(a.status, 200); assert.equal(a.j.version, work); assert.equal(a.j.adopted, 1);
  const v = await (await fetch(`${O}/api/versjon/${work}`, { headers: lars })).json();
  assert.deepEqual(v.edits.map(e => e.building), ["Midtfløy", "MR-bygget", "Østfløy"]);
  assert.equal((await fetch(`${O}/api/utkast/${draft}`)).status, 404);
});

test("«Ny kopi» is the next one worked on; «Del» opens it to the link, signed out too", async () => {
  const c = await post({ copy: work }, lars); assert.equal(c.status, 200); assert.notEqual(c.j.version, work);
  const d = await post(riv("Sentralblokka"), lars); assert.equal(d.j.version, c.j.version);
  assert.equal((await (await fetch(`${O}/api/versjon/${work}`, { headers: lars })).json()).edits.length, 3);
  assert.equal((await post({ share: work })).status, 400);
  const s = await post({ share: c.j.version }, lars); assert.equal(s.j.sharing, "lenke");
  const k = new URL(s.j.link).searchParams.get("nokkel");
  assert.equal((await fetch(`${O}/api/versjon/${c.j.version}?nokkel=${k}`)).status, 200);
});
