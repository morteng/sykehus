/* T3 tool organization and T11 small read-backs. The budget (the list the model sees, JSON chars / 4), find_tool, a guide for
   every edit kind, a read-back named on every write, the refusal of a wrong field, redo_change and list_wishes.
   Plan: sykehus-tools-plan.md sections 0 and 2.   node --test tests/tool-organization.test.mjs */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { KINDS, READBACK, FAMILY } from "../toolguide.mjs";
import { stubDoor, BEARER } from "./stub-door.mjs";

const door = await stubDoor(), dir = mkdtempSync(join(tmpdir(), "sykehus-t3-")), secret = "proxy-secret-for-tests-0123456789", PORT = 9300 + Math.floor(Math.random() * 90);
const O = `http://localhost:${PORT}`, as = n => ({ "remote-user": n, "x-sykehus-proxy-auth": secret });
const srv = spawn(process.execPath, [new URL("../server.mjs", import.meta.url).pathname], { env: { ...process.env, PORT: String(PORT), SYKEHUS_VERSIONS_DIR: join(dir, "v"), SYKEHUS_PROXY_SECRET: secret, SYKEHUS_ASSISTANT_URL: door.url, SYKEHUS_ASSISTANT_TOKEN: BEARER, SYKEHUS_COOKIE_SECRET: "cookie-secret-for-tests-0123456789012345" }, stdio: ["ignore", "pipe", "inherit"] });
await new Promise(ok => srv.stdout.on("data", d => String(d).includes("Sykehustomta on") && ok()));
after(() => { srv.kill(); door.close(); });
let id = 0;
const rpc = async (method, params, h = {}) => { const r = await (await fetch(O + "/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...h }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) })).json(); if (r.error) throw new Error(r.error.message); return r.result; };
const call = async (name, args = {}, h = {}) => { const r = await rpc("tools/call", { name, arguments: args }, h); return { ...r, data: r.structuredContent }; };
const list = async () => (await rpc("tools/list")).tools;
/* what the model is sent of a tool: its name, title, description, input and output schema (icons and annotations are the client's) */
const seen = t => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema, outputSchema: t.outputSchema });
const tokens = o => JSON.stringify(o).length / 4;

test("the budget: the whole list 13 600 tokens (12 000 at T3; summary, draw_plan and draw_section came after, then list_site_photos, look_at_site_photo and heritage_records, then clone, group, move/turn/length on reshape and preview: 13 400, then doors on a facade, the openings kind: 13 600), try_change 4 200 (3 700 before clone and group; 3 500 at T3, 4 000 before openings), any other tool 800, the instructions 1 000", async () => {
  const tools = await list(), per = Object.fromEntries(tools.map(t => [t.name, tokens(seen(t))]));
  const total = Object.values(per).reduce((a, b) => a + b, 0);
  console.log(`budget: total ${Math.round(total)} tokens, ${tools.length} tools, try_change ${Math.round(per.try_change)}, largest other ${Object.entries(per).filter(([n]) => n !== "try_change").sort((a, b) => b[1] - a[1])[0].map(x => typeof x === "number" ? Math.round(x) : x).join(" ")}`);
  assert.ok(total <= 13600, `the list is ${Math.round(total)} tokens`);
  assert.ok(per.try_change <= 4200, `try_change is ${Math.round(per.try_change)} tokens`);
  for (const [n, v] of Object.entries(per)) if (n !== "try_change") assert.ok(v <= 800, `${n} is ${Math.round(v)} tokens`);
  const i = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
  console.log(`budget: instructions ${Math.round(tokens(i.instructions))} tokens`);
  assert.ok(tokens(i.instructions) <= 1000, `the instructions are ${Math.round(tokens(i.instructions))} tokens`);
});

test("every tool name is kept, and every title starts with its group", async () => {
  const tools = await list(), names = tools.map(t => t.name);
  for (const n of ["about_site", "about_wing", "storeys", "floor_plan", "openings", "site_facts", "about_ground", "try_change", "propose_sketch", "undo_change", "list_parts", "find_models", "fetch_model", "check_design", "check_model", "measure", "check_fit", "look", "show_building", "make_shots", "photo_spots", "retake_photos", "search_documents", "read_document", "list_documents", "show_draft", "new_version", "list_versions", "rename_version", "delete_version", "undelete_version", "set_sharing", "send_wish", "ask_point"]) assert.ok(names.includes(n), `${n} is gone`);
  for (const t of tools) { assert.ok(FAMILY[t.name], `${t.name} has no group`); assert.ok(t.title.startsWith(FAMILY[t.name] + " · "), t.title); }
});

test("every edit kind has a guide and an example that passes the fields check", async () => {
  const tc = (await list()).find(t => t.name === "try_change"), kinds = tc.inputSchema.properties.edits.items.anyOf.map(k => k.properties.kind.const);
  assert.ok(kinds.length >= 19);
  assert.deepEqual([...kinds].sort(), Object.keys(KINDS).sort(), "KINDS and the schema list the same kinds");
  for (const k of kinds) {
    const g = (await call("find_tool", { kind: k })).data;
    assert.ok(g.about && g.about.length >= 4, `${k}: no guide`); assert.ok(g.fields && typeof g.fields === "object"); assert.equal(g.example_edit.kind, k);
    assert.equal(g.example_check, "fields ok", `${k}: its example is refused: ${g.example_check}`);
    assert.ok(g.read_back_with, `${k}: no read-back`);
  }
  const v = (await call("find_tool", { kind: "volume" })).data; assert.match(JSON.stringify(v.fields), /resolved here/, "the long field text is kept in the guide");
  const c = (await call("find_tool", { kind: "construction" })).data; assert.match(c.about, /IfcOpenShell/); assert.match(c.about, /params\.json/, "the script contract is in the guide");
  assert.equal((await call("find_tool", { kind: "nope" })).isError, true);
});

test("find_tool: «hage på taket» gives surface and paint with on; the map and a topic", async () => {
  const r = (await call("find_tool", { intent: "hage på taket" })).data, ids = r.matches.map(m => m.id);
  assert.ok(ids.includes("surface") && ids.includes("paint"), ids.join());
  for (const m of r.matches.filter(m => m.id === "surface" || m.id === "paint")) assert.equal(m.example_edit.on, "sentralblokka", `${m.id} example has on`);
  assert.equal((await call("find_tool", { intent: "lag en plen på taket" })).data.matches[0].type, "kind");
  const sec = (await call("find_tool", { intent: "vis et snitt gjennom Sentralblokka" })).data.matches.map(m => m.id); assert.ok(sec.includes("show_building"), sec.join());
  const map = (await call("find_tool", {})).data; assert.ok(map.tool_families.Les.includes("about_wing")); assert.ok(map.edit_kinds_in_try_change.Landskap.includes("surface"));
  assert.match((await call("find_tool", { topic: "ui:gjengi" })).data.text, /Ta bildet/);
  assert.match((await call("find_tool", { tool: "show_building" })).data.description, /Gjengi|MCP Apps/);
});

test("the prompts: start stays, tool_map lists the groups", async () => {
  const ps = (await rpc("prompts/list")).prompts.map(p => p.name); assert.deepEqual(ps, ["start", "tool_map"]);
  const t = (await rpc("prompts/get", { name: "tool_map" })).messages[0].content.text; assert.match(t, /Landskap: .*surface/); assert.match(t, /find_tool/);
  assert.match((await rpc("prompts/get", { name: "start" })).messages[0].content.text, /oversikt/);
});

test("every write tool names its read-back in the last line of its description", async () => {
  const tools = await list(), writes = tools.filter(t => !t.annotations.readOnlyHint);
  assert.ok(writes.length >= 13, writes.map(t => t.name).join());
  for (const t of writes) { assert.ok(READBACK[t.name], `${t.name}: no read-back`); assert.match(t.description, /Read back: [^]*$/, t.name); assert.ok(t.description.includes(READBACK[t.name]), t.name); }
});

test("the server still refuses a wrong field, by the kind's own list", async () => {
  const r = (await call("try_change", { edits: [
    { kind: "surface", ring: [[100, 100], [120, 100], [120, 110]], surface: "grass", bogus: 1 },
    { kind: "surface", surface: "grass" },
    { kind: "banan" },
  ] })).data;
  assert.equal(r.added.length, 0); assert.equal(r.rejected.length, 3);
  assert.match(r.rejected[0].error, /surface tar ikke bogus \(surface tar /); assert.match(r.rejected[1].error, /surface mangler ring \(surface tar /); assert.match(r.rejected[2].error, /kind «banan» finnes ikke; kind er en av level, wing/);
});

test("T11: redo_change puts back the same change at its place; a new change ends the redo", async () => {
  const t = (await call("try_change", { edits: [{ kind: "note", text: "første", wing: "midtfloy" }, { kind: "note", text: "andre", wing: "midtfloy" }, { kind: "note", text: "tredje", wing: "midtfloy" }], include_screenshot: false })).data;
  assert.equal(t.added.length, 3);
  assert.equal((await call("redo_change", { draft: t.draft })).isError, true, "nothing to redo yet");
  const before = (await call("show_draft", { draft: t.draft })).data.changes;
  const u = (await call("undo_change", { draft: t.draft, n: 2 })).data; assert.equal(u.changes_in_draft, 2); assert.equal(u.removed.text, "andre"); assert.equal(u.can_redo, true);
  const r = (await call("redo_change", { draft: t.draft })).data; assert.equal(r.changes_in_draft, 3); assert.deepEqual(r.restored, u.removed); assert.equal(r.at_n, 2); assert.equal(r.can_redo, false);
  assert.deepEqual((await call("show_draft", { draft: t.draft })).data.changes, before, "the list is as before the undo");
  assert.equal((await call("redo_change", { draft: t.draft })).isError, true, "one redo per undo");
  await call("undo_change", { draft: t.draft, n: 3 }); await call("try_change", { draft: t.draft, edits: [{ kind: "note", text: "ny", wing: "midtfloy" }], include_screenshot: false });
  assert.equal((await call("redo_change", { draft: t.draft })).isError, true, "a new change clears the redo");
});

test("T11: show_draft gives the IFC link; list_wishes shows only the asker's", async () => {
  const t = (await call("try_change", { edits: [{ kind: "note", text: "x", wing: "midtfloy" }], include_screenshot: false })).data;
  const d = (await call("show_draft", { draft: t.draft })).data; assert.equal(d.ifc, `${O}/api/ifc?utkast=${t.draft}`);
  assert.equal((await call("list_wishes")).isError, true, "signed out: refused");
  await call("send_wish", { text: "Et snitt gjennom drivhuset", picture: false }, as("lars")); await call("send_wish", { text: "Et annet ønske fra lars", picture: false }, as("lars"));
  await call("send_wish", { text: "Kari vil ha en bro", picture: false }, as("kari"));
  const l = (await call("list_wishes", {}, as("lars"))).data; assert.equal(l.count, 2); assert.ok(l.wishes.every(w => w.status === "ny" && !/bro/.test(w.text)));
  assert.equal(l.wishes[0].text, "Et annet ønske fra lars", "newest first");
  const k = (await call("list_wishes", {}, as("kari"))).data; assert.equal(k.count, 1); assert.match(k.wishes[0].text, /bro/);
});
