/* U3671: ask_point, Anton's way to ask for a place. Against a real server (a stand-in for gulden-ai's door, no model): with a page's stream open
   the tool puts an «ask_point» show event on it with the question and the framing point; with none open it says so, and a wrong wing is refused.
   node --test tests/ask-point.test.mjs */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { spawn } from "node:child_process";

const seen = [];
const door = createServer((q, r) => { let b = ""; q.on("data", c => b += c); q.on("end", () => { if (q.url.includes("/chat")) seen.push(JSON.parse(b)); r.writeHead(200, { "content-type": "application/json" }).end(q.url.includes("/history") ? JSON.stringify({ items: [{ role: "user", text: "Her: nålen står på planen.\n(Nål: x=1, y=2 meter på tomta, som try_change tar dem.)" }] }) : "{}"); }); });
await new Promise(ok => door.listen(0, ok));
const dir = mkdtempSync(join(tmpdir(), "ask-")), secret = "proxy-secret-for-tests-0123456789", PORT = 8000 + Math.floor(Math.random() * 900), O = `http://localhost:${PORT}`;
const srv = spawn(process.execPath, [new URL("../server.mjs", import.meta.url).pathname], { env: { ...process.env, PORT: String(PORT), SYKEHUS_VERSIONS_DIR: join(dir, "v"), SYKEHUS_PROXY_SECRET: secret, SYKEHUS_COOKIE_SECRET: "cookie-secret-for-tests-0123456789abcdef", SYKEHUS_ASSISTANT_URL: `http://127.0.0.1:${door.address().port}`, SYKEHUS_ASSISTANT_TOKEN: "door-token-0123456789" }, stdio: ["ignore", "pipe", "inherit"] });
await new Promise(ok => srv.stdout.on("data", d => String(d).includes("Sykehustomta on") && ok()));
const ac = new AbortController();
after(() => { ac.abort(); srv.kill(); door.close(); });
const H = { "remote-user": "lars", "x-sykehus-proxy-auth": secret };
const rpc = async (method, params) => (await (await fetch(O + "/mcp", { method: "POST", headers: { "content-type": "application/json", ...H }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })).json()).result;
const text = r => r.content.filter(c => c.type === "text").map(c => c.text).join(" ");

test("no page open: the tool says so and Anton is told to ask in text", async () => {
  const tools = (await rpc("tools/list")).tools, t = tools.find(x => x.name === "ask_point");
  assert.ok(t); assert.match(t.description, /instead of asking in plain text/); assert.deepEqual(t.inputSchema.required, ["question"]);
  const r = await rpc("tools/call", { name: "ask_point", arguments: { question: "Hvor går gangveien?" } });
  assert.ok(!r.isError, text(r)); assert.equal(r.structuredContent.asked, false); assert.match(r.structuredContent.said, /vanlig tekst/);
});

test("a page's stream gets the question and the point to frame; a wing frames on its centre; a wrong wing is refused", async () => {
  const got = []; const res = await fetch(O + "/api/anton/strom", { headers: H, signal: ac.signal });
  const rd = res.body.getReader(), dec = new TextDecoder(); let buf = "";
  (async () => { for (;;) { const { value, done } = await rd.read().catch(() => ({ done: true })); if (done) return; buf += dec.decode(value); } })();
  const sites = await rpc("tools/call", { name: "about_site", arguments: {} }), wing = sites.structuredContent.wings[0];
  const a = await rpc("tools/call", { name: "ask_point", arguments: { question: "Hvor skal trappen ned til?", x: 12.34, y: -56.78 } });
  assert.equal(a.structuredContent.asked, true); assert.deepEqual([a.structuredContent.x, a.structuredContent.y], [12.3, -56.8]);
  const b = await rpc("tools/call", { name: "ask_point", arguments: { question: "Hvilken side?", wing: wing.name } });
  assert.equal(b.structuredContent.asked, true); assert.ok(Number.isFinite(b.structuredContent.x) && Number.isFinite(b.structuredContent.y));
  const c = await rpc("tools/call", { name: "ask_point", arguments: { question: "Hvor?", wing: "Finnes ikke" } }); assert.equal(c.isError, true);
  await new Promise(ok => setTimeout(ok, 300));
  const shows = [...buf.matchAll(/event: show\ndata: (.*)\n/g)].map(m => JSON.parse(m[1])).filter(v => v.ask_point);
  assert.equal(shows.length, 2); assert.equal(shows[0].ask_point.question, "Hvor skal trappen ned til?"); assert.deepEqual([shows[0].ask_point.x, shows[0].ask_point.y], [12.3, -56.8]);
});

test("about_ground: a wing and a side, a point, the terrain's kote round it, what was laid in the draft; no place at all is refused", async () => {
  const ws = (await rpc("tools/call", { name: "about_site", arguments: {} })).structuredContent.wings, wing = ws.find(w => /Sentral/i.test(w.name)) || ws[0];
  const g = await rpc("tools/call", { name: "about_ground", arguments: { wing: wing.name, side: "S" } }); assert.ok(!g.isError, text(g));
  const o = g.structuredContent; assert.match(o.place, /sør for/); assert.equal(o.radius_m, 40);
  assert.equal(o.terrain_around.length, 8); assert.ok(o.terrain_around.every(t => Number.isFinite(t.kote)), "kote from the terrain grid at each direction");
  assert.ok(Number.isFinite(o.center.kote) && o.center.kote > 0); assert.ok(o.buildings.some(b => b.wing === wing.id), "the wing itself is near its south side");
  const n = await rpc("tools/call", { name: "about_ground", arguments: { wing: wing.name, side: "N" } }); assert.ok(n.structuredContent.center.y > o.center.y, "north lies north of south");
  const p = await rpc("tools/call", { name: "about_ground", arguments: { x: o.center.x, y: o.center.y, radius_m: 20 } }); assert.deepEqual([p.structuredContent.center.x, p.structuredContent.center.y], [o.center.x, o.center.y]); assert.equal(p.structuredContent.radius_m, 20);
  /* a lawn laid in a draft is listed, covering a point inside it */
  const cx = o.center.x, cy = o.center.y, d = await rpc("tools/call", { name: "try_change", arguments: { edits: [{ kind: "surface", name: "Plen sør", surface: "grass", ring: [[cx - 6, cy - 6], [cx + 6, cy - 6], [cx + 6, cy + 6], [cx - 6, cy + 6]] }] } });
  assert.ok(!d.isError, text(d)); assert.equal(d.structuredContent.rejected.length, 0, JSON.stringify(d.structuredContent.rejected)); const draft = d.structuredContent.version || d.structuredContent.draft;
  const h = await rpc("tools/call", { name: "about_ground", arguments: { x: cx, y: cy, draft } }); assert.ok(!h.isError, text(h));
  assert.equal(h.structuredContent.ground_laid.length, 1); assert.equal(h.structuredContent.ground_laid[0].covers_the_place, true); assert.equal(h.structuredContent.ground_laid[0].surface, "grass");
  assert.equal((await rpc("tools/call", { name: "about_ground", arguments: {} })).isError, true);
});

test("a pin's point goes to Anton as a note and never to the person: not in the shown message, not in the history", async () => {
  const got = []; const res = await fetch(O + "/api/anton/strom", { headers: H, signal: ac.signal }), rd = res.body.getReader(), dec = new TextDecoder(); let buf = "";
  (async () => { for (;;) { const { value, done } = await rd.read().catch(() => ({ done: true })); if (done) return; buf += dec.decode(value); } })();
  const r = await fetch(O + "/api/anton", { method: "POST", headers: { "content-type": "application/json", ...H }, body: JSON.stringify({ text: "Her: nålen står på planen, 13 m fra Sentralblokka.", point: { x: -12.64, y: 1.6 } }) }); assert.equal(r.status, 202);
  await new Promise(ok => setTimeout(ok, 500));
  assert.equal(seen.at(-1).message, "Her: nålen står på planen, 13 m fra Sentralblokka.\n(Nål: x=-12.6, y=1.6 meter på tomta, som try_change tar dem.)", "Anton gets the figures");
  const shown = [...buf.matchAll(/event: message\ndata: (.*)\n/g)].map(m => JSON.parse(m[1]).text); assert.deepEqual(shown, ["Her: nålen står på planen, 13 m fra Sentralblokka."]); assert.ok(!/try_change|Nål:/.test(buf.split("event: message")[1] || ""), "the person's stream has no figures");
  const h = await (await fetch(O + "/api/anton/historikk", { headers: H })).json(); assert.equal(h.items[0].text, "Her: nålen står på planen.");
  await fetch(O + "/api/anton", { method: "POST", headers: { "content-type": "application/json", ...H }, body: JSON.stringify({ text: "hei", point: { x: "a", y: 1 } }) }); await new Promise(ok => setTimeout(ok, 300)); assert.equal(seen.at(-1).message, "hei", "a bad point is dropped");
});
