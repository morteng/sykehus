/* What the server keeps over a restart (persist.mjs), through the real handlers.   node --test tests/persist.test.mjs
   a) the pin of a turn in flight and the page's open map survive a new assistant over the same dir
   b) a drawing is served by a new instance (bytes), and still 404s for another person
   c) a turn listed in running.json at start gives the restart line in that person's history */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { createVersions } from "../versions.mjs";
import { createAssistant } from "../assistant.mjs";

const readJson = async r => { let b = ""; for await (const c of r) b += c; return JSON.parse(b); };
const listen = h => new Promise(ok => { const s = createServer(h); s.listen(0, () => ok(s)); });
const JPEG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";
let release = null, history = [];
const gate = new Promise(ok => { release = ok; });
const door = await listen((req, res) => { let s = ""; req.on("data", c => s += c); req.on("end", async () => {
  if (req.url.endsWith("/chat")) { res.writeHead(200, { "content-type": "application/x-ndjson" }); if (JSON.parse(s).message === "HOLD") await gate; return res.end(JSON.stringify({ type: "done" }) + "\n"); }
  if (req.url.includes("/history")) return res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ items: history }));
  res.writeHead(200, { "content-type": "application/json" }).end("{}"); }); });
const servers = [door];
after(() => { release(); for (const s of servers) { s.closeAllConnections?.(); s.close(); } });

const dir = mkdtempSync(join(tmpdir(), "sykehus-persist-"));
const versions = createVersions(dir);
let who = "lars";
const login = { base: `http://localhost:${door.address().port}`, anton: true, bearer: "x", personOf: () => ({ person: who, device: "d1" }) };
async function boot(extra = {}) {
  const pages = { open: new Map(), show: () => false };
  const anton = createAssistant({ SECURITY: {}, readJson, login, versions, pages, dataDir: dir, ...extra });
  const srv = await listen((q, r) => anton.route(q, r, new URL(q.url, "http://x").pathname).then(ok => ok || r.writeHead(404).end())); servers.push(srv);
  return { pages, anton, A: `http://localhost:${srv.address().port}` };
}
const post = (A, body) => fetch(A + "/api/anton", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

test("a) the pin and the open map survive a new assistant over the same dir", async () => {
  const v = versions.create("lars", "Prøve"), one = await boot();
  const r = await post(one.A, { text: "HOLD", version: v.id, selection: { items: [{ kind: "wing", id: "SB", label: "Sørfløy" }] } });
  assert.equal(r.status, 202); const { id } = await r.json();
  for (let i = 0; i < 100 && !one.pages.turn?.get("lars"); i++) await new Promise(ok => setTimeout(ok, 20));
  assert.equal(one.pages.turn.get("lars").id, id, "the turn is pinned before the restart");
  one.anton.flush();
  const two = await boot();
  const pin = two.pages.turn.get("lars");
  assert.equal(pin?.id, id, "the pin comes back"); assert.equal(pin.version, v.id); assert.equal(pin.picked, "SB");
  assert.equal(two.pages.open.get("lars"), v.id, "pages.open comes back"); assert.equal(two.pages.picked.get("lars"), "SB", "pages.picked comes back");
});

test("b) a drawing is served by a new instance, and still 404s for another person", async () => {
  release();
  const one = await boot();
  const r = await post(one.A, { text: "se her", drawing: { image: JPEG, strokes: [], camera: {}, mode: "3d", size: [10, 10] } });
  assert.equal(r.status, 202); const { id } = await r.json();
  assert.ok(readdirSync(join(dir, "_state/tegning")).includes(id + ".jpg"), "the picture is a file");
  const two = await boot();
  const pic = await fetch(two.A + "/api/anton/tegning/" + id);
  assert.equal(pic.status, 200); assert.equal(pic.headers.get("content-type"), "image/jpeg");
  assert.equal(Buffer.from(await pic.arrayBuffer()).toString("base64"), JPEG.slice(23), "the bytes are the drawn picture");
  history = [{ type: "message", from: "lars", text: "se her" }];
  assert.equal((await (await fetch(two.A + "/api/anton/historikk")).json()).items[0].image, `api/anton/tegning/${id}`, "the history line gets its picture");
  who = "anna"; assert.equal((await fetch(two.A + "/api/anton/tegning/" + id)).status, 404, "another person gets 404"); who = "lars";
});

test("c) a turn listed in running.json at start gives the restart line in the history", async () => {
  const d2 = mkdtempSync(join(tmpdir(), "sykehus-persist-run-")); mkdirSync(join(d2, "_state"));
  writeFileSync(join(d2, "_state/running.json"), JSON.stringify({ running: { lars: { id: "t-cut", text: "Riv fløyen", at: new Date().toISOString() } }, notes: {} }));
  history = [{ type: "message", from: "lars", text: "Riv fløyen" }, { type: "message", from: "lars", text: "senere" }];
  const one = await boot({ dataDir: d2 });
  const items = (await (await fetch(one.A + "/api/anton/historikk")).json()).items;
  assert.deepEqual(items.map(i => i.type === "error" ? i.code : i.text), ["Riv fløyen", "restart", "senere"], "the line stands after the message it answers");
  const two = await boot({ dataDir: d2 });   // a second restart: the line is still there, and no turn is run again
  assert.equal((await (await fetch(two.A + "/api/anton/historikk")).json()).items.filter(i => i.code === "restart").length, 1);
});
