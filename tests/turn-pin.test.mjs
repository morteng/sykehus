/* The turn's pinned page (Morten: «while Anton works, the user should be free to move around without that affecting what
   Anton sees or does»). The real MCP handler and the real assistant, with a stand-in door whose «Anton» calls the tools
   in the middle of a turn. Run: node --test tests/turn-pin.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { after } from "node:test";
import { createMcp } from "../mcp.mjs";
import { createVersions } from "../versions.mjs";
import { createAssistant } from "../assistant.mjs";

const PUB = new URL("../public/", import.meta.url).pathname, site = JSON.parse(readFileSync(join(PUB, "data/site.json"), "utf8"));
const versions = createVersions(mkdtempSync(join(tmpdir(), "sykehus-pin-")));
const pages = { open: new Map(), show: () => false };
const mcp = createMcp({ site, floors: [], docs: null, docUrl: f => f, SECURITY: {}, readJson: async r => { let b = ""; for await (const c of r) b += c; return JSON.parse(b); }, versions, auth: { userOf: r => r.headers["remote-user"] || null, count() {} }, pages });
const lars = { headers: { "remote-user": "lars", host: "localhost" } };
const tool = (name, args) => mcp.TOOLS.find(t => t.name === name).run(args, lars);
const mcpSrv = createServer((q, r) => mcp.handleMcp(q, r)); await new Promise(ok => mcpSrv.listen(0, ok));
const mcpCall = async (name, args) => (await (await fetch(`http://localhost:${mcpSrv.address().port}/mcp`, { method: "POST", headers: { "content-type": "application/json", "remote-user": "lars" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) })).json()).result;
const riv = b => ({ kind: "demolish", building: b, why: "test" });
const A = versions.create("lars", "A"), B = versions.create("lars", "B");
versions.get(A.id).work = true; versions.save(A);

/* a door that holds each chat call open until the test lets it go */
const held = [];
const door = createServer((req, res) => { let s = ""; req.on("data", c => s += c); req.on("end", async () => {
  if (req.url.endsWith("/chat")) { res.writeHead(200, { "content-type": "application/x-ndjson" }); await new Promise(ok => held.push(ok)); return res.end(JSON.stringify({ type: "done" }) + "\n"); }
  res.writeHead(200, { "content-type": "application/json" }).end("{}"); }); });
const until = async f => { for (let i = 0; i < 200 && !f(); i++) await new Promise(ok => setTimeout(ok, 10)); assert.ok(f(), "timed out"); };
await new Promise(ok => door.listen(0, ok));
const login = { base: `http://localhost:${door.address().port}`, anton: true, bearer: "x", personOf: () => ({ person: "lars", device: "d1" }) };
const anton = createAssistant({ SECURITY: {}, readJson: async r => { let b = ""; for await (const c of r) b += c; return JSON.parse(b); }, login, versions, pages });
const post = (body, path = "/api/anton") => new Promise(ok => { const chunks = [JSON.stringify(body)]; const req = { method: "POST", headers: { host: "x" }, [Symbol.asyncIterator]: async function* () { yield Buffer.from(chunks[0]); } };
  anton.route(req, { writeHead() {}, end: b => ok(JSON.parse(b)), write() {} }, path); });
const idOf = r => r.structuredContent?.version;
const turnOn = async version => { const n = held.length, r = await post({ text: "hei", version }); assert.ok(r.id, JSON.stringify(r)); await until(() => held.length > n && pages.turn.get("lars")?.id === r.id); return r.id; };
const endTurn = async () => { while (pages.turn.get("lars")) { held.splice(0).forEach(f => f()); await new Promise(ok => setTimeout(ok, 30)); } };

test("a turn pinned to A: the user opens B, and Anton's target-less read and try_change still go to A", async () => {
  await turnOn(A.id);
  pages.open.set("lars", B.id);   // the user navigates
  assert.equal(idOf(await mcpCall("show_draft", {})), A.id, "a read");
  const r = await mcpCall("try_change", { edits: [riv("Østfløy")], include_screenshot: false });
  assert.equal(r.structuredContent.version, A.id); assert.equal(versions.get(A.id).edits.length, 1); assert.equal(versions.get(B.id).edits.length, 0);
  assert.equal(r.structuredContent.changed_meanwhile, undefined, "nothing changed under him");
  assert.equal(pages.turn.get("lars").version, A.id);
  await endTurn();
});

test("a second message sent mid-turn does not move the running turn", async () => {
  await turnOn(A.id);
  const p = await post({ text: "neste", version: B.id }); assert.ok(p.id);   // queued; its send moves pages.open
  assert.equal(pages.open.get("lars"), B.id);
  assert.equal(idOf(await mcpCall("show_draft", {})), A.id);
  const first = pages.turn.get("lars").id; held.splice(0).forEach(f => f());   // the first turn ends, the queued one starts
  await until(() => pages.turn.get("lars")?.id !== first && held.length);
  assert.equal(pages.turn.get("lars").version, B.id, "the next turn is pinned to its own version");
  await endTurn();
});

test("the person's edit in A mid-turn is kept, Anton's change goes on top and says so", async () => {
  await turnOn(A.id);
  await mcpCall("try_change", { edits: [riv("Midtfløy")], include_screenshot: false });   // Anton's first call: the count starts here
  const mineBefore = versions.get(A.id).edits.length;
  await tool("try_change", { version: A.id, edits: [riv("Vestfløy")], include_screenshot: false, fromPage: true });   // the page's own edit
  const r = await mcpCall("try_change", { edits: [riv("MR-bygget")], include_screenshot: false });
  const s = r.structuredContent, es = versions.get(A.id).edits;
  assert.equal(es.length, mineBefore + 2); assert.ok(es.some(e => e.building === "Vestfløy"), "the person's edit stays"); assert.ok(es.some(e => e.building === "MR-bygget"));
  assert.deepEqual({ ...s.changed_meanwhile, say: undefined }, { added: 1, removed: 0, kinds: ["demolish"], say: undefined });
  assert.match(s.changed_meanwhile.say, /Personen endret forslaget mens du jobbet: 1 ny endring \(demolish\)/);
  const again = await mcpCall("try_change", { edits: [riv("Sentralblokka")], include_screenshot: false });
  assert.equal(again.structuredContent.changed_meanwhile, undefined, "told once");
  await endTurn();
});

test("Anton's own undo is not the person's change", async () => {
  await turnOn(A.id);
  const one = await mcpCall("try_change", { edits: [riv("Operasjonsmodulen")], include_screenshot: false }); assert.equal(one.structuredContent.added.length, 1, JSON.stringify(one.structuredContent.rejected));
  assert.ok(!(await mcpCall("undo_change", { n: versions.get(A.id).edits.length })).isError);
  const r = await mcpCall("try_change", { edits: [riv("Trappehus nordøst")], include_screenshot: false });
  assert.equal(r.structuredContent.added.length, 1, JSON.stringify(r.structuredContent.rejected)); assert.equal(r.structuredContent.changed_meanwhile, undefined);
  await endTurn();
});

test("after the turn a target-less call follows the user's page again; a failed turn also ends it", async () => {
  assert.equal(pages.turn.get("lars"), undefined);
  pages.open.set("lars", B.id);
  assert.equal(idOf(await mcpCall("show_draft", {})), B.id);
  assert.equal((await mcpCall("try_change", { edits: [riv("Østfløy")], include_screenshot: false })).structuredContent.version, B.id);
  const r = await post({ text: "x" }); await until(() => pages.turn.get("lars")?.id === r.id);
  door.closeAllConnections(); await until(() => !pages.turn.get("lars"));
  assert.equal(pages.turn.get("lars"), undefined, "the pin is gone when the chat call fails");
});

test("the page's refusal always has a reason", () => {
  const app = readFileSync(join(PUB, "app.js"), "utf8");
  assert.doesNotMatch(app, /"Det gikk ikke\."/);
  assert.match(app, /Tjeneren starter på nytt/);
});

after(() => { door.closeAllConnections(); door.close(); mcpSrv.close(); });
