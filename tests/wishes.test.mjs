/* Wishes (wishes.mjs, send_wish): only the signed in send them, each sees their own, the admin sees all.
   node --test tests/wishes.test.mjs */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const dir = mkdtempSync(join(tmpdir(), "sykehus-wishes-")), secret = "proxy-secret-for-tests-0123456789", admin = "admin-token-for-tests-0123456789";
const PORT = 9000 + Math.floor(Math.random() * 900);
const srv = spawn(process.execPath, [new URL("../server.mjs", import.meta.url).pathname], { env: { ...process.env, PORT: String(PORT), SYKEHUS_VERSIONS_DIR: dir, SYKEHUS_PROXY_SECRET: secret, SYKEHUS_ADMIN_TOKEN: admin, DOCS: "" }, stdio: ["ignore", "pipe", "inherit"] });
await new Promise(ok => srv.stdout.on("data", d => String(d).includes("Sykehustomta on") && ok()));
after(() => srv.kill());
const O = `http://localhost:${PORT}`, as = p => ({ "remote-user": p, "x-sykehus-proxy-auth": secret });
const wish = (args, h = {}) => fetch(O + "/mcp", { method: "POST", headers: { "content-type": "application/json", ...h }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "send_wish", arguments: args } }) });
const list = async h => (await fetch(O + "/api/onsker", { headers: h })).json();

test("a wish needs a login", async () => {
  assert.equal((await wish({ text: "Snitt gjennom drivhuset" })).status, 401);
  assert.equal((await fetch(O + "/api/onsker", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "Hei" }) })).status, 401);
  assert.equal((await fetch(O + "/api/onsker")).status, 401);
  assert.equal((await fetch(O + "/api/onsker", { headers: { "x-sykehus-proxy-auth": secret } })).status, 401, "the proxy secret alone is no one");
});

test("kept on disk, listed for its owner only; Morten sees all and answers", async () => {
  const r = (await (await wish({ text: "Jeg vil kunne tegne et snitt gjennom drivhuset", tried: "Ingen snitt-verktøy for nye volum" }, as("lars"))).json()).result.structuredContent;
  assert.equal(r.sent, true); assert.equal(r.receipt, "Sendt. Morten ser det.");
  assert.equal((await fetch(O + "/api/onsker", { method: "POST", headers: { "content-type": "application/json", ...as("lars") }, body: JSON.stringify({ text: "Fargevalg på glasset" }) })).status, 201);
  assert.equal(readdirSync(join(dir, "_wishes")).filter(f => f.endsWith(".json")).length, 2);
  const mine = await list(as("lars"));
  assert.equal(mine.wishes.length, 2); assert.equal(mine.admin, false); assert.equal(mine.wishes[1].status, "ny");
  assert.equal((await list(as("kari"))).wishes.length, 0, "another person cannot read them");
  assert.equal((await fetch(O + `/api/onsker/${r.wish}`, { method: "POST", headers: { "content-type": "application/json", ...as("lars") }, body: JSON.stringify({ status: "laget" }) })).status, 403);
  const all = await list(as("morten")); assert.equal(all.admin, true); assert.equal(all.wishes.length, 2);
  assert.equal((await list({ authorization: `Bearer ${admin}` })).wishes.length, 2, "pm reads with the admin token");
  await fetch(O + `/api/onsker/${r.wish}`, { method: "POST", headers: { "content-type": "application/json", ...as("morten") }, body: JSON.stringify({ status: "sett", note: "Kommer" }) });
  const w = (await list(as("lars"))).wishes.find(x => x.id === r.wish); assert.equal(w.status, "sett"); assert.equal(w.note, "Kommer");
});

test("the usage counts: not for the proxy secret, which the edge adds to every page request", async () => {
  assert.equal((await fetch(O + "/api/bruk", { headers: { "x-sykehus-proxy-auth": secret, "x-forwarded-for": "203.0.113.9" } })).status, 403);
  assert.equal((await fetch(O + "/api/bruk", { headers: { authorization: `Bearer ${admin}`, "x-forwarded-for": "203.0.113.9" } })).status, 200);
});

test("U3832: a wish about a version carries a picture of it: kept, served to its person and Morten, not to another", async () => {
  const call = async (name, args, h) => (await (await fetch(O + "/mcp", { method: "POST", headers: { "content-type": "application/json", ...h }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) })).json()).result;
  const v = (await call("new_version", { title: "Casino" }, as("lars"))).structuredContent;
  const t = (await call("try_change", { version: v.version, include_screenshot: false, edits: [{ kind: "volume", id: "ndrivhus", name: "Drivhus", shape: "gable", material: "glass", on: "Sentralblokka", from: [4, 6], to: [20, 30], width: 6, height: 4 }] }, as("lars"))).structuredContent;
  assert.equal(t.rejected.length, 0, JSON.stringify(t.rejected));
  const r = (await call("send_wish", { text: "Drivhuset står skjevt på taket", version_id: v.version, view_name: "plan" }, as("lars"))).structuredContent;
  assert.equal(r.sent, true); assert.equal(r.picture, true, JSON.stringify(r)); assert.equal(r.receipt, "Sendt, med bilde. Morten ser det.");
  const w = (await list(as("lars"))).wishes.find(x => x.id === r.wish); assert.equal(w.picture, `/api/onsker/${r.wish}.png`);
  const png = await fetch(O + w.picture, { headers: as("lars") }), buf = Buffer.from(await png.arrayBuffer());
  assert.equal(png.status, 200); assert.equal(png.headers.get("content-type"), "image/png"); assert.equal(buf.subarray(0, 8).toString("hex"), "89504e470d0a1a0a"); assert.ok(buf.length > 5000, `a picture, ${buf.length} bytes`);
  assert.equal((await fetch(O + w.picture, { headers: as("kari") })).status, 404, "another person's wish picture is not served");
  assert.equal((await fetch(O + w.picture, { headers: { authorization: `Bearer ${admin}` } })).status, 200, "pm reads it with the admin token");
  const none = (await call("send_wish", { text: "Bare et ønske uten bilde", picture: false }, as("lars"))).structuredContent;
  assert.equal(none.picture, false); assert.equal(none.receipt, "Sendt. Morten ser det.");
});
