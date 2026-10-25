/* One target for every tool (Morten 2026-10-25 21:08Z «make sure to use best practices»; 21:05Z Anton put a version
   id in draft and two of Morten's changes were lost). Every tool that reads or changes the after, driven through the
   MCP call itself with a version id, a draft id, no id and a wrong id; the old names draft and version still work. */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const dir = mkdtempSync(join(tmpdir(), "sykehus-target-")), secret = "proxy-secret-for-tests-0123456789", PORT = 9100 + Math.floor(Math.random() * 800);
const O = `http://localhost:${PORT}`, lars = { "remote-user": "lars", "x-sykehus-proxy-auth": secret };
const srv = spawn(process.execPath, [new URL("../server.mjs", import.meta.url).pathname], { env: { ...process.env, PORT: String(PORT), SYKEHUS_VERSIONS_DIR: join(dir, "v"), SYKEHUS_PROXY_SECRET: secret, DOCS: "" }, stdio: ["ignore", "pipe", "inherit"] });
await new Promise(ok => srv.stdout.on("data", d => String(d).includes("Sykehustomta on") && ok()));
after(() => srv.kill());
const call = async (name, args, h = lars) => (await (await fetch(O + "/mcp", { method: "POST", headers: { "content-type": "application/json", ...h }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) })).json()).result;
const text = r => r.content.filter(c => c.type === "text").map(c => c.text).join(" ");
const riv = b => ({ kind: "demolish", building: b, why: "test" });

/* the person's work (made by their first change with no target) and a draft (made signed out) */
const w = (await call("try_change", { edits: [riv("Østfløy"), riv("Midtfløy"), riv("Vestfløy")], include_screenshot: false })).structuredContent;
const d = (await call("try_change", { edits: [riv("MR-bygget"), riv("Midtfløy")], include_screenshot: false }, {})).structuredContent;
const V = w.version, D = d.draft;

const READS = { about_site: {}, about_wing: { wing: "Sentralblokka" }, storeys: {}, floor_plan: { storey: "6" }, show_draft: {}, look: { width: 320, height: 240 }, show_building: {} };

test("setup: the work is a version, the draft a draft", () => { assert.match(V, /^v.{8}$/); assert.match(D, /^[A-Za-z0-9_-]{8}$/); });

for (const [name, args] of Object.entries(READS)) test(`${name}: a version id, a draft id, none, and a wrong one`, async () => {
  for (const t of [V, D, undefined]) { const r = await call(name, { ...args, ...(t ? { target: t } : {}) }); assert.ok(!r.isError, `${name} ${t}: ${text(r)}`); }
  const old = await call(name, { ...args, draft: V }); assert.ok(!old.isError, "a version id in the old draft field");
  const bad = await call(name, { ...args, target: "vZZZZZZZZ" }); assert.equal(bad.isError, true); assert.match(text(bad), new RegExp(`Fant ingen versjon «vZZZZZZZZ».*Utelat target.*${V}`));
  const gone = await call(name, { ...args, target: "nope1234" }); assert.equal(gone.isError, true); assert.match(text(gone), /Fant ikke utkastet «nope1234».*begynner med v/);
});

test("show_draft with none named shows the version the person has open", async () => {
  assert.equal((await call("show_draft", {})).structuredContent.version, V);
});

test("try_change: a version id in draft goes into that version, saved (the 21:05Z case)", async () => {
  const r = (await call("try_change", { draft: V, edits: [riv("Sentralblokka")], include_screenshot: false })).structuredContent;
  assert.equal(r.version, V); assert.equal(r.saved, true); assert.equal(r.changes, 4); assert.ok(r.link.includes(V));
  const t = (await call("try_change", { target: D, edits: [riv("Østfløy")], include_screenshot: false }, {})).structuredContent;
  assert.equal(t.draft, D); assert.equal(t.changes_in_draft, 3);
  const none = (await call("try_change", { edits: [{ kind: "restore", building: "Sentralblokka" }], include_screenshot: false })).structuredContent;
  assert.equal(none.version, V, "none named: the open version");
  const bad = await call("try_change", { target: "vZZZZZZZZ", edits: [riv("Østfløy")] }); assert.equal(bad.isError, true); assert.match(text(bad), /Utelat target/);
  assert.equal((await call("try_change", { target: V, edits: [riv("Østfløy")] }, {})).isError, true, "a private version is not for others");
});

test("try_change names a missing field, per kind", async () => {
  const r = (await call("try_change", { edits: [{ kind: "balconies", why: "x" }, { kind: "volume", shape: "box", why: "x" }, { kind: "taket" }, { kind: "demolish", building: "Østfløy", side: "N" }], include_screenshot: false })).structuredContent;
  assert.equal(r.added.length, 0);
  assert.match(r.rejected[0].error, /balconies mangler wing, side/); assert.match(r.rejected[1].error, /volume mangler from, to, width/);
  assert.match(r.rejected[2].error, /kind «taket» finnes ikke/); assert.match(r.rejected[3].error, /demolish tar ikke side/);
});

test("undo_change: a version id, a draft id, none (the open version), and a wrong one", async () => {
  assert.ok(!(await call("undo_change", { target: V, n: 1 })).isError);
  assert.ok(!(await call("undo_change", { target: D, n: 1 }, {})).isError);
  const none = (await call("undo_change", { n: 1 })).structuredContent; assert.equal(none.version, V);
  assert.match(text(await call("undo_change", { target: "nope1234", n: 1 })), /Fant ikke utkastet/);
});

test("set_sharing and rename_version: a version id, none (the open version), a draft is refused", async () => {
  assert.equal((await call("set_sharing", { target: V, sharing: "lenke" })).structuredContent.sharing, "lenke");
  assert.equal((await call("rename_version", { title: "Bare tårnet" })).structuredContent.title, "Bare tårnet");
  assert.equal((await call("rename_version", { version: V, title: "Tårnet" })).structuredContent.title, "Tårnet", "the old name");
  const r = await call("set_sharing", { target: D, sharing: "lenke" }); assert.equal(r.isError, true); assert.match(text(r), new RegExp(`er et utkast.*new_version \\(from: "${D}"\\)`));
});

test("try_change: a change already there is not added again, and says so (21:23Z: 56 changes and no pool)", async () => {
  const before = (await call("show_draft", {})).structuredContent.changes.length;
  const r = (await call("try_change", { edits: [riv("Østfløy"), riv("Østfløy"), { kind: "surface", ring: [[-70, -75], [-55, -75], [-55, -68], [-70, -68]], surface: "water", name: "Basseng" }], include_screenshot: false })).structuredContent;
  assert.equal(r.added.length, 2, "the first Østfløy if it was not there, and the pool"); assert.match(r.rejected[0].error, /Finnes allerede som endring nr\. \d+/);
  assert.equal(r.changes, before + 2);
});
