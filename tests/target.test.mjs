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
  assert.match(r.rejected[0].error, /balconies mangler wing \(/);   // side or face (U3615): neither required alone assert.match(r.rejected[1].error, /volume mangler from, to, width/);
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

test("show_building: a facade with no wing shows the largest standing wing and says so; building is the wing too (pm 21:32Z)", async () => {
  const r = await call("show_building", { mode: "fasade", from_direction: "S" }, {}); assert.ok(!r.isError, text(r));
  assert.match(text(r), /^Viser .+; si fra om du mente en annen fløy/); assert.equal(r.structuredContent.view.side, "S"); assert.ok(r.structuredContent.view.wing);
  const b = await call("show_building", { mode: "fasade", building: "Sentralblokka", from_direction: "S" }, {}); assert.ok(!b.isError); assert.doesNotMatch(text(b), /^Viser/); assert.equal(b.structuredContent.view.wing, "sentralblokka");
  const s = await call("show_building", { mode: "tverrsnitt" }, {}); assert.ok(!s.isError, text(s)); assert.match(text(s), /^Viser/);
});

test("try_change: reshape of a building that is not there says what reshape is for and how a pool is made (21:22Z)", async () => {
  const r = (await call("try_change", { target: D, edits: [{ kind: "reshape", id: "basseng", from: [0, 0] }], include_screenshot: false }, {})).structuredContent;
  assert.match(r.rejected[0].error, /reshape endrer et nytt bygg.*kind surface \(surface: "water"/);
});

test("saved views (U3562): the page saves, renames and removes; Anton saves with save_as and goes back with saved_view; show_draft lists them", async () => {
  const post = (b, h = lars) => fetch(O + "/api/endring", { method: "POST", headers: { "content-type": "application/json", ...h }, body: JSON.stringify(b) }).then(async r => ({ status: r.status, j: await r.json() }));
  const st = { x: 10, y: -20, h: 15, yaw: 0.4, pitch: 0.6, dist: 300, mode: "3d", junk: "x" };
  const a = await post({ view: "add", name: " Fra  sør ", state: st }); assert.equal(a.status, 200, JSON.stringify(a.j));
  const w = a.j.views.find(v => v.id === a.j.saved); assert.equal(w.name, "Fra sør"); assert.equal(w.by, "person"); assert.equal(w.state.junk, undefined);
  assert.equal((await post({ view: "add", name: "Fra sør", state: { ...st, yaw: 1 } })).j.views.length, 1, "the same name moves it");
  assert.equal((await post({ view: "add", name: "x", state: { ...st, pitch: 9 } })).status, 400);
  assert.equal((await post({ view: "add", version: V, name: "y", state: st }, {})).status, 400, "not the owner");
  const s = (await call("show_building", { mode: "fasade", wing: "Sentralblokka", from_direction: "S", save_as: "Sørfasaden" })); assert.ok(!s.isError, text(s));
  assert.match(text(s), /^Lagret som «Sørfasaden» i versjonen v/);
  const list = (await call("show_draft", {})).structuredContent.saved_views; assert.deepEqual(list.map(v => [v.name, v.by]), [["Fra sør", "person"], ["Sørfasaden", "anton"]]);
  const g = await call("show_building", { saved_view: "sørfasaden" }); assert.ok(!g.isError); assert.match(text(g), /^Den lagrede visningen «Sørfasaden»/);
  assert.deepEqual([g.structuredContent.view.section, g.structuredContent.view.side], ["fasade", "S"]);
  const bad = await call("show_building", { saved_view: "Fra nord" }); assert.equal(bad.isError, true); assert.match(text(bad), /Ingen lagret visning «Fra nord»; de lagrede: «Fra sør», «Sørfasaden»/);
  const r = await post({ view: "rename", id: w.id, name: "Fra Strømsø" }); assert.equal(r.j.views[0].name, "Fra Strømsø");
  assert.equal((await post({ view: "remove", id: w.id })).j.views.length, 1);
  const v = await (await fetch(`${O}/api/versjon/${(await call("show_draft", {})).structuredContent.version}`, { headers: lars })).json(); assert.deepEqual(v.views.map(x => x.name), ["Sørfasaden"]);
  const d = await call("show_building", { target: D, save_as: "Utkastets" }, {}); assert.ok(!d.isError, text(d)); assert.equal((await (await fetch(`${O}/api/utkast/${D}`)).json()).views[0].name, "Utkastets");
});

test("show_building: «NØ» as the log had it (pm 21:41Z ×3), and every other way to write north-east", async () => {
  for (const d of ["NØ", "nø", "NO̸", "nordøst", "Nordøst", "NE", "north-east", "45", "45°", 45]) {
    const r = await call("show_building", { from_direction: d, distance_m: 260, tilt_deg: 65 }, {}); assert.ok(!r.isError, `${JSON.stringify(d)}: ${text(r)}`);
    assert.match(text(r), /sett fra nordøst, 65° over bakken \(fugleperspektiv\), 260 m unna/, JSON.stringify(d));
  }
  for (const [d, w] of [["SØ", "sørøst"], ["sørvest", "sørvest"], ["W", "vest"], ["Ø", "øst"]]) assert.match(text(await call("show_building", { from_direction: d }, {})), new RegExp(`sett fra ${w}`));
  assert.equal((await call("show_building", { from_direction: "opp" }, {})).isError, true);
});

test("try_change and look draw a picture with balconies in the after (22:09Z: «look: Cannot read properties of undefined (reading '0')»)", async () => {
  const r = await call("try_change", { target: D, edits: [{ kind: "balconies", wing: "Sentralblokka", face: 210, why: "test" }, { kind: "volume", name: "Paviljong", shape: "box", from: [-60, -80], to: [-45, -80], width: 8, height: 4, why: "test" }] }, {});
  assert.ok(!r.isError, text(r)); assert.ok(r.content.some(c => c.type === "image"), "the picture is there");
  const l = await call("look", { target: D, focus: "Sentralblokka", from_direction: "S" }, {}); assert.ok(!l.isError, text(l)); assert.equal(l.content[0].type, "image");
});

test("pm 11:35Z: balconies on a facade that has some replace them, and the result says so; another facade's stay", async () => {
  /* U3690: a bare facade ask is now one balcony per window axis, so a second ask for the same is «already there»; the replacing ask differs by its bay */
  const one = (await call("try_change", { edits: [{ kind: "balconies", wing: "Sentralblokka", face: 120, why: "test" }], include_screenshot: false }, {})).structuredContent, T = one.draft;
  await call("try_change", { target: T, edits: [{ kind: "balconies", wing: "Sentralblokka", face: 300, why: "test" }], include_screenshot: false }, {});
  const two = (await call("try_change", { target: T, edits: [{ kind: "balconies", wing: "Sentralblokka", face: 120, bay: 2.4, gap: 0.6, why: "test" }], include_screenshot: false }, {})).structuredContent;
  assert.match(two.added[0].replaced, /^Erstattet de eldre balkongene på fasaden mot 120° \(endring nr\. 1\); bare de nye står\.$/);
  assert.equal(two.changes_in_draft, 2, "the 300° ones stay, the 120° ones are the new");
  const left = two.after.built.filter(a => a.kind === "balconies").map(a => a.name).sort();
  assert.deepEqual(left, ["Balkonger mot 120°, Sentralblokka", "Balkonger mot 300°, Sentralblokka"]);
});
