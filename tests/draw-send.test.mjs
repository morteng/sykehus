/* Two faults of 2026-10-27, through the real handlers.   node --test tests/draw-send.test.mjs
   A) a drawing sent to Anton: the door gets it, the chat line and the history carry the picture (served from this server: the page's
      policy lets pictures come from its own origin only), a bad one is refused with the words the window shows.
   B) a change that names an id the version no longer has reaches Anton as a refusal with the text, never as «Internal error». */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { createMcp } from "../mcp.mjs";
import { createVersions } from "../versions.mjs";
import { createAssistant } from "../assistant.mjs";
import { applyDesign } from "../public/design.js";

const PUB = new URL("../public/", import.meta.url).pathname, site = JSON.parse(readFileSync(join(PUB, "data/site.json"), "utf8"));
const readJson = async r => { let b = ""; for await (const c of r) b += c; return JSON.parse(b); };
const versions = createVersions(mkdtempSync(join(tmpdir(), "sykehus-draw-")));
const pages = { open: new Map(), show: () => false };
const mcp = createMcp({ site, floors: [], docs: null, docUrl: f => f, SECURITY: {}, readJson, versions, auth: { userOf: r => r.headers["remote-user"] || null, count() {} }, pages });
const listen = h => new Promise(ok => { const s = createServer(h); s.listen(0, () => ok(s)); });
const mcpSrv = await listen((q, r) => mcp.handleMcp(q, r));
const rpc = async (name, args) => (await (await fetch(`http://localhost:${mcpSrv.address().port}/mcp`, { method: "POST", headers: { "content-type": "application/json", "remote-user": "lars" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) })).json());

/* a real, small JPEG (a 1x1 pixel) as the page's canvas.toDataURL gives it */
const JPEG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";
const seenByDoor = [];
const door = await listen((req, res) => { let s = ""; req.on("data", c => s += c); req.on("end", () => {
  const b = s ? JSON.parse(s) : {}; seenByDoor.push({ url: req.url, b });
  if (req.url.endsWith("/chat")) return res.writeHead(200, { "content-type": "application/x-ndjson" }).end(JSON.stringify({ type: "done" }) + "\n");
  if (req.url.includes("/history")) return res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ items: [{ type: "message", from: "lars", text: "Flytt den hit" }, { type: "message", from: "assistant", text: "Ja." }, { type: "message", from: "lars", text: "bare tekst" }] }));
  res.writeHead(200, { "content-type": "application/json" }).end("{}"); }); });
const login = { base: `http://localhost:${door.address().port}`, anton: true, bearer: "x", personOf: () => ({ person: "lars", device: "d1" }) };
const anton = createAssistant({ SECURITY: {}, readJson, login, versions, pages });
const antonSrv = await listen((q, r) => anton.route(q, r, new URL(q.url, "http://x").pathname).then(ok => ok || r.writeHead(404).end()));
const A = `http://localhost:${antonSrv.address().port}`;
after(() => { for (const s of [mcpSrv, door, antonSrv]) { s.closeAllConnections?.(); s.close(); } });

test("A: a drawing is taken, Anton's door gets it, the chat line and the history carry the picture", async () => {
  const events = []; const ac = new AbortController();
  const sse = fetch(A + "/api/anton/strom", { signal: ac.signal }).then(async r => { const dec = new TextDecoder(); let buf = ""; for await (const c of r.body) { buf += dec.decode(c, { stream: true }); let i; while ((i = buf.indexOf("\n\n")) >= 0) { const blk = buf.slice(0, i); buf = buf.slice(i + 2); const ev = /^event: (.*)$/m.exec(blk), d = /^data: (.*)$/m.exec(blk); if (ev && d) events.push({ event: ev[1], ...JSON.parse(d[1]) }); } } }).catch(() => {});
  await new Promise(ok => setTimeout(ok, 100));
  const drawing = { image: JPEG, strokes: [{ colour: "blå", points: [[10.5, 20.5, 30.1], [11, 21, 30.2]] }], camera: { x: 1 }, mode: "3d", size: [1280, 800] };
  const r = await fetch(A + "/api/anton", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "Flytt den hit", drawing }) });
  const body = await r.json(); assert.equal(r.status, 202, JSON.stringify(body));
  const { id } = body;
  for (let i = 0; i < 100 && !seenByDoor.some(x => x.url.endsWith("/chat")); i++) await new Promise(ok => setTimeout(ok, 20));
  const chat = seenByDoor.find(x => x.url.endsWith("/chat")).b;
  assert.equal(chat.drawing.image, JPEG, "Anton gets the picture in the body to gulden-ai"); assert.equal(chat.drawing.strokes[0].points.length, 2);
  const m = events.find(e => e.event === "message" && e.id === id);
  assert.equal(m.image, `api/anton/tegning/${id}`, "the chat line's picture is a same-origin address, not a data: URL");
  const pic = await fetch(A + "/" + m.image); assert.equal(pic.status, 200); assert.equal(pic.headers.get("content-type"), "image/jpeg");
  assert.equal(Buffer.from(await pic.arrayBuffer()).toString("base64"), JPEG.slice(23), "the bytes served are the drawn picture");
  const h = await (await fetch(A + "/api/anton/historikk")).json();
  assert.equal(h.items[0].image, m.image, "a reload shows the picture"); assert.equal(h.items[1].image, undefined); assert.equal(h.items[2].image, undefined);
  assert.equal((await fetch(A + "/api/anton/tegning/" + "0".repeat(8) + "-0000-0000-0000-" + "0".repeat(12))).status, 404);
  ac.abort(); await sse;
});

test("A: a picture that is not a JPEG data URL is refused with the words the window shows", async () => {
  for (const image of ["data:image/png;base64,AAAA", "https://x/y.jpg", JPEG + "!", "data:image/jpeg;base64," + "A".repeat(2.6e6)]) {
    const r = await fetch(A + "/api/anton", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "se", drawing: { image } }) });
    assert.equal(r.status, 400); assert.equal((await r.json()).error, "Tegningen kom ikke fram riktig. Prøv igjen.");
  }
});

test("B: the replay of a stored version that names a gone volume is skipped, so the page loads; a typo in a wing still refuses", async () => {
  const base = { buildings: [], wings: [{ id: "w", name: "Vestfløy" }], added: [] };
  assert.doesNotThrow(() => applyDesign({ ...base }, [], [{ kind: "demolish", building: "volum-32" }]), "a gone new building in a stored edit must not stop the replay");
  assert.throws(() => applyDesign({ ...base }, [], [{ kind: "demolish", building: "Vestflyen" }]), /Fant ikke «Vestflyen».*ingen nye bygg nå/, "a name that is no building and no new id is still refused");
  const v = versions.create("lars", "Prøve"); const rec = versions.get(v.id);
  rec.edits = [{ kind: "volume", id: "volum-7", name: "Hus", shape: "box", height: 4, from: [10, 10], to: [20, 10], width: 6 }, { kind: "demolish", building: "volum-32" }]; versions.save(rec);
  for (const [name, args] of [["try_change", { edits: [{ kind: "note", text: "x" }], target: v.id, include_screenshot: false }], ["look", { target: v.id }]]) {
    const j = await rpc(name, args);
    assert.equal(j.error, undefined, `${name}: ${JSON.stringify(j.error)}`);
    assert.doesNotMatch(JSON.stringify(j.result), /Internal error/, name);
  }
});

test("B: a real bug (a TypeError) stays «Internal error»", async () => {
  const { handleMcp } = createMcp({ site, floors: [], docs: null, docUrl: f => f, SECURITY: {}, readJson, versions: { get() { throw new TypeError("x is not a function"); }, list: () => [], visible: () => true }, auth: { userOf: r => r.headers["remote-user"] || null, count() {} }, pages });
  const s = await listen((q, r) => handleMcp(q, r));
  const j = await (await fetch(`http://localhost:${s.address().port}/mcp`, { method: "POST", headers: { "content-type": "application/json", "remote-user": "lars" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "about_wing", arguments: { wing: "SB", target: "vabcdefgh" } } }) })).json();
  s.close();
  assert.equal(j.error?.message, "Internal error", JSON.stringify(j).slice(0, 200));
});
