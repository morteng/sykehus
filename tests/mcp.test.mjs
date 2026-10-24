/* The connector end to end: server.mjs on a free port, every tool called as a chat app calls it, a draft tried and
   read back as the page reads it. DOCS=<docs.sqlite> also tests the document tools.   Run: node --test */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const PORT = 18000 + Math.floor(Math.random() * 1000), BASE = `http://localhost:${PORT}`;
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
const call = async (name, args = {}) => { const r = await rpc("tools/call", { name, arguments: args }); return { ...r, data: r.structuredContent }; };

test("initialize and the tool list", async () => {
  const i = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
  assert.equal(i.serverInfo.name, "sykehus"); assert.match(i.instructions, /wings/);
  const names = (await rpc("tools/list")).tools.map(t => t.name);
  for (const n of ["about_site", "about_wing", "storeys", "floor_plan", "openings", "try_change", "show_draft", "undo_change", "show_building", "search_documents"]) assert.ok(names.includes(n), n);
});
test("the site, a wing, the storeys", async () => {
  const s = (await call("about_site")).data;
  assert.ok(s.wings.length >= 10); assert.ok(s.drawn_storeys.some(d => d.storey === "5. etasje"));
  const w = (await call("about_wing", { wing: "SB" })).data;
  assert.equal(w.id, "sentralblokka"); assert.equal(w.levels.length, 14); assert.ok(w.sources.length);
  const st = (await call("storeys", { wing: "Østfløy" })).data;
  assert.ok(st.storeys.find(x => x.storey === "3. etasje").wings[0].kote === 23.54);
  assert.equal((await call("about_wing", { wing: "nowhere" })).isError, true);
});
test("rooms of a storey across wings, and openings", async () => {
  const f = (await call("floor_plan", { storey: "5" })).data;
  assert.equal(f.storey, "5. etasje"); assert.ok(f.rooms.some(r => r.area_m2)); assert.ok(f.rooms.some(r => r.area_measured_m2));
  const ops = (await call("floor_plan", { storey: "5", name_contains: "operasjon" })).data;
  assert.ok(ops.rooms.length >= 2 && ops.rooms.every(r => /operasjon/i.test(r.name)));
  const o = (await call("openings", { wing: "ostfloy" })).data;
  assert.ok(o.facades.find(x => x.id === "ostfloy-nord").openings.length > 40);
});
test("a draft: tried, read back by the page, undone; the shared model is unchanged", async () => {
  const t = (await call("try_change", { edits: [
    { kind: "level", wing: "midtfloy", storey: "2", kote: 20.31, why: "test: snitt B-B" },
    { kind: "wing", wing: "vestfloy", field: "built", value: "1967–70", why: "test" },
    { kind: "room", storey: "5. etasje", room: "Operasjonstue 2", set: { use: "dagkirurgi" }, why: "test" },
    { kind: "note", text: "Her kan en ny trapp stå", wing: "midtfloy" },
    { kind: "level", wing: "midtfloy", storey: "3", kote: 999, why: "bad" },
  ] })).data;
  assert.equal(t.added.length, 4); assert.equal(t.rejected.length, 1); assert.equal(t.saved, false); assert.match(t.link, /\?utkast=/);
  const page = await (await fetch(`${BASE}/api/utkast/${t.draft}`)).json();
  assert.equal(page.edits.length, 4);
  const w = (await call("about_wing", { wing: "midtfloy", draft: t.draft })).data;
  assert.equal(w.levels.find(l => l.storey === "2. etasje").kote, 20.31); assert.equal(w.notes.length, 1);
  assert.equal((await call("about_wing", { wing: "midtfloy" })).data.levels.find(l => l.storey === "2. etasje").kote, 20.24);   // not saved
  const r = (await call("floor_plan", { storey: "5", name_contains: "operasjonstue 2", draft: t.draft })).data;
  assert.ok(r.rooms.some(x => x.use === "dagkirurgi"));
  const u = (await call("undo_change", { draft: t.draft, n: 1 })).data;
  assert.equal(u.changes_in_draft, 3);
  assert.equal((await fetch(`${BASE}/api/utkast/nope`)).status, 404);
});
test("show_building gives the app its view", async () => {
  const r = await rpc("tools/call", { name: "show_building", arguments: { storey: "6", wing: "Østre nordfløy", mode: "plan" } });
  assert.equal(r.structuredContent.view.storey, "6. etasje"); assert.equal(r.structuredContent.view.mode, "plan");
  const sec = await rpc("tools/call", { name: "show_building", arguments: { wing: "Sentralblokka", mode: "lengdesnitt" } });
  assert.equal(sec.structuredContent.view.mode, "section"); assert.equal(sec.structuredContent.view.section, "lengde");
  assert.equal((await rpc("tools/call", { name: "show_building", arguments: { mode: "tverrsnitt" } })).isError, true);   // a section needs a wing
  const res = await rpc("resources/read", { uri: "ui://sykehus/bygget" });
  assert.match(res.contents[0].text, /mcp-app\.js/);
});
test("documents, when the store is loaded", { skip: !process.env.DOCS }, async () => {
  const s = (await call("search_documents", { query: "operasjonsmodul" })).data;
  assert.ok(s.documents.length);
});
test("2026-07-28: stateless requests, routing headers, version errors, cacheable lists", async () => {
  const meta = { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": {} };
  const post = (body, headers = {}) => fetch(`${BASE}/mcp`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }).then(async r => ({ status: r.status, j: await r.json() }));
  const d = await post({ jsonrpc: "2.0", id: 1, method: "server/discover", params: { _meta: meta } });
  assert.ok(d.j.result.supportedVersions.includes("2026-07-28")); assert.ok(d.j.result.capabilities.extensions["io.modelcontextprotocol/ui"]);
  const c = await post({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "storeys", arguments: {}, _meta: meta } }, { "mcp-method": "tools/call", "mcp-name": "storeys" });
  assert.equal(c.j.result.resultType, "complete"); assert.equal(c.j.result._meta["io.modelcontextprotocol/serverInfo"].name, "sykehus");
  const l = await post({ jsonrpc: "2.0", id: 3, method: "tools/list", params: { _meta: meta } });
  assert.ok(l.j.result.ttlMs > 0 && l.j.result.cacheScope === "public");
  const ui = l.j.result.tools.find(t => t.name === "show_building")._meta;
  assert.equal(ui.ui.resourceUri, "ui://sykehus/bygget"); assert.equal(ui["ui/resourceUri"], undefined);   // only the current key
  const bad = await post({ jsonrpc: "2.0", id: 4, method: "tools/list", params: { _meta: { "io.modelcontextprotocol/protocolVersion": "2099-01-01" } } });
  assert.equal(bad.j.error.code, -32022);
  const mism = await post({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "storeys", arguments: {} } }, { "mcp-name": "about_site" });
  assert.equal(mism.status, 400); assert.equal(mism.j.error.code, -32020);
});
