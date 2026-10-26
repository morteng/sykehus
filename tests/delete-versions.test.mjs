/* U3654: a person deletes their own saved versions into a 30-day trash, and brings them back; only the owner; purged
   after 30 days. Through the real server (the connector's tools and the page's /api/endring), and versions.mjs on its own
   with an injected clock for the purge.   node --test tests/delete-versions.test.mjs */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createVersions, TRASH_DAYS } from "../versions.mjs";

const dir = mkdtempSync(join(tmpdir(), "sykehus-delver-")), vdir = join(dir, "v"), DAY = 864e5;
const tok = "test-token-morten-0123456789", secret = "proxy-secret-for-tests-0123456789", PORT = 8000 + Math.floor(Math.random() * 900);
writeFileSync(join(dir, "tokens.json"), JSON.stringify({ [createHash("sha256").update(tok).digest("hex")]: "morten" }));
/* a version deleted 31 days ago is on disk before the server starts: the start purges it */
mkdirSync(vdir, { recursive: true });
const old = { id: "vOLDOLD01", owner: "lars", title: "Gammel", edits: [], sharing: "privat", key: "k", own: "o", created: "2026-01-01T00:00:00.000Z", updated: "2026-01-01T00:00:00.000Z", deleted: new Date(Date.now() - 31 * DAY).toISOString() };
const fresh = { ...old, id: "vFRESH001", title: "Nylig slettet", deleted: new Date(Date.now() - 29 * DAY).toISOString() };
for (const v of [old, fresh]) writeFileSync(join(vdir, v.id + ".json"), JSON.stringify(v));
const srv = spawn(process.execPath, [new URL("../server.mjs", import.meta.url).pathname], { env: { ...process.env, PORT: String(PORT), SYKEHUS_VERSIONS_DIR: vdir, SYKEHUS_TOKENS: join(dir, "tokens.json"), SYKEHUS_PROXY_SECRET: secret, DOCS: "" }, stdio: ["ignore", "pipe", "inherit"] });
await new Promise(ok => srv.stdout.on("data", d => String(d).includes("Sykehustomta on") && ok()));
after(() => srv.kill());
const O = `http://localhost:${PORT}`;
let n = 0;
async function call(name, args, headers) {
  const r = await fetch(O + "/mcp", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ jsonrpc: "2.0", id: ++n, method: "tools/call", params: { name, arguments: args } }) });
  const c = (await r.json()).result; return { error: c.isError ? c.content[0].text : null, out: c.structuredContent };
}
const page = (body, h) => fetch(O + "/api/endring", { method: "POST", headers: { "content-type": "application/json", ...h }, body: JSON.stringify(body) }).then(async r => ({ status: r.status, j: await r.json() }));
const morten = { authorization: `Bearer ${tok}` }, lars = { "remote-user": "lars", "x-sykehus-proxy-auth": secret };
const mine = async h => (await call("list_versions", { owner: "me" }, h)).out.versions.map(v => v.title);
const apiGet = (id, h = lars) => fetch(`${O}/api/versjon/${id}`, { headers: h });

test("the owner deletes by name: the list, the link and the page's list all lose it", async () => {
  const a = (await call("new_version", { title: "Drivhus" }, lars)).out, b = (await call("new_version", { title: "Rive alt" }, lars)).out;
  assert.deepEqual((await mine(lars)).sort(), ["Drivhus", "Rive alt"]);
  const d = await call("delete_version", { versions: ["drivhus"] }, lars);
  assert.equal(d.error, null); assert.deepEqual(d.out.deleted.map(x => x.version), [a.version]);
  assert.ok(Date.parse(d.out.deleted[0].restorable_until) - Date.now() > 29 * DAY, "30 days to bring it back");
  assert.deepEqual(await mine(lars), ["Rive alt"], "gone from the list");
  assert.equal((await apiGet(a.version)).status, 404, "and its link answers as if it were not there");
  assert.equal((await apiGet(b.version)).status, 200);
  const l = await (await fetch(O + "/api/versjoner", { headers: lars })).json(); assert.ok(!JSON.stringify(l).includes(a.version));
  assert.equal((await call("try_change", { target: a.version, edits: [{ kind: "demolish", building: "Østfløy" }] }, lars)).error?.includes("Fant ingen"), true, "a deleted version takes no changes");
});

test("only the owner: another person's delete is refused and changes nothing; signed out needs the login", async () => {
  const v = (await call("new_version", { title: "Larsens" }, lars)).out;
  const r = await call("delete_version", { versions: [v.version] }, morten);
  assert.match(r.error, /Fant ingen versjon/); assert.ok(r.error);
  const byName = await call("delete_version", { versions: ["Larsens"] }, morten); assert.match(byName.error, /Fant ingen versjon/);
  assert.ok((await mine(lars)).includes("Larsens"), "still there");
  const pageTry = await page({ delete: [v.version] }, { "remote-user": "morten", "x-sykehus-proxy-auth": secret }); assert.equal(pageTry.status, 400);
  assert.ok((await mine(lars)).includes("Larsens"));
  const anon = await fetch(O + "/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 99, method: "tools/call", params: { name: "delete_version", arguments: { versions: [v.version] } } }) });
  assert.equal(anon.status, 401);
});

test("all or nothing: a name that matches none, or two, stops the whole delete", async () => {
  await call("new_version", { title: "Likt" }, lars); await call("new_version", { title: "Likt" }, lars); const one = (await call("new_version", { title: "Enslig" }, lars)).out;
  assert.match((await call("delete_version", { versions: ["Enslig", "Likt"] }, lars)).error, /navnet på 2 versjoner/);
  assert.match((await call("delete_version", { versions: ["Enslig", "Finnes ikke"] }, lars)).error, /Fant ingen versjon/);
  assert.ok((await mine(lars)).includes("Enslig"), "nothing was deleted");
  assert.equal((await apiGet(one.version)).status, 200);
});

test("restore brings it back with its changes; the trash shows it meanwhile; a live one cannot be restored", async () => {
  const v = (await call("new_version", { title: "Med endring" }, lars)).out;
  await call("try_change", { target: v.version, edits: [{ kind: "demolish", building: "Østfløy" }] }, lars);
  await call("delete_version", { versions: [v.version] }, lars);
  const trash = (await call("list_versions", { trash: true }, lars)).out.versions; assert.ok(trash.some(t => t.version === v.version && t.changes === 1));
  assert.ok(!(await call("list_versions", { trash: true }, morten)).out.versions.some(t => t.version === v.version), "the trash is the owner's alone");
  assert.match((await call("undelete_version", { versions: [v.version] }, morten)).error, /Fant ingen slettet versjon/);
  const back = await call("undelete_version", { versions: ["Med endring"] }, lars); assert.deepEqual(back.out.restored.map(x => x.version), [v.version]);
  assert.ok((await mine(lars)).includes("Med endring"));
  const got = await (await apiGet(v.version)).json(); assert.equal(got.edits.length, 1, "its changes came back");
  assert.match((await call("undelete_version", { versions: [v.version] }, lars)).error, /Fant ingen slettet versjon/, "it is not in the trash now");
});

test("the page's route: delete, then «Angre» restores; deleting the work version hands the mark to the newest other", async () => {
  const first = await page({ fresh: true }, lars), second = await page({ fresh: true }, lars);   // the second is the work
  assert.equal(second.status, 200);
  const del = await page({ delete: [second.j.version] }, lars);
  assert.equal(del.status, 200); assert.equal(del.j.now_open.version, first.j.version, "the page falls back to the next newest");
  const listed = (await (await fetch(O + "/api/versjoner", { headers: lars })).json()).versions;
  assert.ok(!listed.some(v => v.version === second.j.version)); assert.equal(listed.find(v => v.version === first.j.version).work, true);
  const back = await page({ undelete: [second.j.version] }, lars); assert.equal(back.status, 200); assert.ok(back.j.restored[0].nokkel);
  assert.ok((await (await fetch(O + "/api/versjoner", { headers: lars })).json()).versions.some(v => v.version === second.j.version));
  assert.equal((await page({ delete: [second.j.version] }, { })).status, 400, "signed out: refused");
});

test("the start purged the one deleted 31 days ago and kept the one deleted 29 days ago", async () => {
  assert.equal(existsSync(join(vdir, old.id + ".json")), false);
  assert.ok((await call("list_versions", { trash: true }, lars)).out.versions.some(t => t.version === fresh.id));
  assert.equal((await call("undelete_version", { versions: [old.id] }, lars)).error?.includes("Fant ingen slettet versjon"), true);
});

test("versions.mjs with an injected clock: kept for 30 days, then gone for good; restore after that fails", () => {
  let now = Date.parse("2026-10-01T10:00:00Z"); const d = mkdtempSync(join(tmpdir(), "sykehus-clock-")), vs = createVersions(d, () => now);
  const v = vs.create("lars", "Prøve"), w = vs.create("lars", "Blir"); vs.remove(v);
  assert.equal(vs.get(v.id), null); assert.equal(vs.list({ owner: "lars", viewer: "lars" }).length, 1); assert.equal(vs.trash("lars").length, 1);
  now += (TRASH_DAYS - 1) * DAY; assert.equal(vs.trash("lars").length, 1, "day 29: still there"); assert.ok(vs.getTrashed(v.id));
  now += 2 * DAY; assert.equal(vs.trash("lars").length, 0, "day 31: purged"); assert.equal(vs.getTrashed(v.id), null);
  assert.equal(existsSync(join(d, v.id + ".json")), false, "the file is gone");
  assert.ok(existsSync(join(d, w.id + ".json")), "the live one is not touched");
  assert.equal(createVersions(d, () => now).get(w.id).title, "Blir", "a restart reads the live one");
});
