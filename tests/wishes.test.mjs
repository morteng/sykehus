/* Wishes and feedback (wishes.mjs, send_wish, U3978): only the signed in send them; each is filed in gulden-ai's one report store through the door
   (here a stub door that keeps what it is sent), and each sees their own back. node --test tests/wishes.test.mjs */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { stubDoor, BEARER } from "./stub-door.mjs";

const door = await stubDoor(), filed = door.filed;
const dir = mkdtempSync(join(tmpdir(), "sykehus-wishes-")), secret = "proxy-secret-for-tests-0123456789", admin = "admin-token-for-tests-0123456789";
const PORT = 9000 + Math.floor(Math.random() * 900);
const srv = spawn(process.execPath, [new URL("../server.mjs", import.meta.url).pathname], { env: { ...process.env, PORT: String(PORT), SYKEHUS_VERSIONS_DIR: dir, SYKEHUS_PROXY_SECRET: secret, SYKEHUS_ADMIN_TOKEN: admin, SYKEHUS_ASSISTANT_URL: door.url, SYKEHUS_ASSISTANT_TOKEN: BEARER, SYKEHUS_COOKIE_SECRET: "cookie-secret-for-tests-0123456789012345", DOCS: "" }, stdio: ["ignore", "pipe", "inherit"] });
await new Promise(ok => srv.stdout.on("data", d => String(d).includes("Sykehustomta on") && ok()));
after(() => { srv.kill(); door.close(); });
const O = `http://localhost:${PORT}`, as = p => ({ "remote-user": p, "x-sykehus-proxy-auth": secret });
const wish = (args, h = {}) => fetch(O + "/mcp", { method: "POST", headers: { "content-type": "application/json", ...h }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "send_wish", arguments: args } }) });
const list = async h => (await fetch(O + "/api/onsker", { headers: h })).json();

test("a wish needs a login", async () => {
  assert.equal((await wish({ text: "Snitt gjennom drivhuset" })).status, 401);
  assert.equal((await fetch(O + "/api/onsker", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "Hei" }) })).status, 401);
  assert.equal((await fetch(O + "/api/onsker")).status, 401);
  assert.equal((await fetch(O + "/api/onsker", { headers: { "x-sykehus-proxy-auth": secret } })).status, 401, "the proxy secret alone is no one");
  assert.equal(filed.length, 0, "nothing reached the store");
});

test("filed in the one store, listed for its owner only, with the developer's status and answer read back", async () => {
  const r = (await (await wish({ text: "Jeg vil kunne tegne et snitt gjennom drivhuset", tried: "Ingen snitt-verktøy for nye volum" }, as("lars"))).json()).result.structuredContent;
  assert.equal(r.sent, true); assert.equal(r.receipt, "Sendt. Morten ser det."); assert.equal(r.wish, "rp-1");
  assert.equal((await fetch(O + "/api/onsker", { method: "POST", headers: { "content-type": "application/json", ...as("lars") }, body: JSON.stringify({ text: "Fargevalg på glasset" }) })).status, 201);
  assert.equal(filed.length, 2); assert.equal(filed[0].person, "lars"); assert.equal(filed[0].kind, "idea");
  assert.match(filed[0].text, /snitt gjennom drivhuset\n\nPrøvd: Ingen snitt-verktøy/);
  const mine = await list(as("lars"));
  assert.equal(mine.wishes.length, 2); assert.equal(mine.wishes[1].status, "ny"); assert.equal(mine.admin, undefined);
  assert.equal((await list(as("kari"))).wishes.length, 0, "another person cannot read them");
  assert.equal((await fetch(O + `/api/onsker/${r.wish}`, { method: "POST", headers: { "content-type": "application/json", ...as("morten") }, body: JSON.stringify({ status: "laget" }) })).status, 405, "no answer is written here any more: reports_update moves it in the store");
  filed[0].status = "sett"; filed[0].note = "Kommer";   // what a developer does in the store
  const w = (await list(as("lars"))).wishes.find(x => x.id === r.wish); assert.equal(w.status, "sett"); assert.equal(w.note, "Kommer");
});

test("the kit's feedback dialog files with its kind, page and tab; 10 an hour; a bad picture is refused", async () => {
  const post = (b, p = "lars") => fetch(O + "/api/feedback", { method: "POST", headers: { "content-type": "application/json", ...as(p) }, body: JSON.stringify(b) });
  const before = filed.length, r = await post({ kind: "bug", text: "Knappen virker ikke", page: "/", tab: "bygg", version: "vJ5tP1j6g" });
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json())); assert.equal((await r.json()).id, "rp-" + (before + 1));
  const f = filed.at(-1); assert.deepEqual([f.kind, f.person, f.tab, f.page, f.design_id], ["bug", "lars", "bygg", "/", "vJ5tP1j6g"]);
  assert.equal((await post({ kind: "rant", text: "x" })).status, 400);
  assert.deepEqual(await (await post({ kind: "bug", text: "Bildet er galt", screenshot: "data:image/png;base64,AAAA" })).json(), { code: "bad_image" });
  assert.equal((await fetch(O + "/api/feedback", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status, 401);
  for (let i = 0; i < 8; i++) assert.equal((await post({ kind: "idea", text: "Ide nummer " + i }, "kari")).status, 200);
  assert.equal((await post({ kind: "idea", text: "Ide nummer ni" }, "kari")).status, 200);
  const lim = await post({ kind: "idea", text: "Ide nummer ti" }, "kari"); assert.equal(lim.status, 200);
  const over = await post({ kind: "idea", text: "Ide nummer elleve" }, "kari"); assert.equal(over.status, 429); assert.equal((await over.json()).code, "limit");
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
  const ref = filed.at(-1).attachment_ref, pic = `/api/onsker/${ref}.png`; assert.match(ref, /^w[A-Za-z0-9_-]{10}$/, "the report names the picture it carries");
  const png = await fetch(O + pic, { headers: as("lars") }), buf = Buffer.from(await png.arrayBuffer());
  assert.equal(png.status, 200); assert.equal(png.headers.get("content-type"), "image/png"); assert.equal(buf.subarray(0, 8).toString("hex"), "89504e470d0a1a0a"); assert.ok(buf.length > 5000, `a picture, ${buf.length} bytes`);
  assert.equal((await fetch(O + pic, { headers: as("kari") })).status, 404, "another person's wish picture is not served");
  assert.equal((await fetch(O + pic, { headers: { authorization: `Bearer ${admin}` } })).status, 200, "pm reads it with the admin token");
  const none = (await call("send_wish", { text: "Bare et ønske uten bilde", picture: false }, as("lars"))).structuredContent;
  assert.equal(none.picture, false); assert.equal(none.receipt, "Sendt. Morten ser det.");
});

/* S3: the real reason a picture is missing, and one retry as a small plan view. A stubbed renderer (no real look runs). */
test("send_wish: a look that times out is told as it was, after one retry with a smaller plan view", async () => {
  const { createMcp } = await import("../mcp.mjs"), { createVersions } = await import("../versions.mjs"), { createWishes } = await import("../wishes.mjs");
  const { readFileSync } = await import("node:fs");
  const site = JSON.parse(readFileSync(new URL("../public/data/site.json", import.meta.url), "utf8")), d2 = mkdtempSync(join(tmpdir(), "sykehus-wishpic-"));
  const versions = createVersions(d2), seen = [];
  const mk = render => createMcp({ site, floors: [], docs: null, docUrl: f => f, SECURITY: {}, readJson: async () => ({}), versions, wishes: createWishes({ dir: d2, login: { base: "http://door.test", bearer: "x" }, fetchImpl: async () => new Response(JSON.stringify({ id: "rp-9" }), { status: 200 }) }), auth: { userOf: r => r.headers["remote-user"] || null, count() {} }, pages: { open: new Map(), show: () => false }, render });
  const lars = { headers: { "remote-user": "lars", host: "localhost" } }, v = versions.create("lars", "Prøve");
  const send = (m, args) => m.TOOLS.find(t => t.name === "send_wish").run({ text: "Et ønske", version_id: v.id, ...args }, lars);
  const slow = mk(async (s, o) => { seen.push({ plan: !!o.plan, width: o.width }); throw new Error("Bildet tok for lang tid."); });
  const r = await send(slow, {});
  assert.equal(r.sent, true); assert.equal(r.picture, false);
  assert.equal(seen.length, 2, "tried twice, no more"); assert.deepEqual(seen[1], { plan: true, width: 640 }, "the second is a plan at a smaller size");
  assert.match(r.note, /Bildet tok for lang tid/); assert.doesNotMatch(r.note, /ingen åpen versjon/);
  /* a grey RGB PNG of the size asked, filter 0, as the kit's own (lookglue.decode reads that) */
  const { deflateSync, crc32 } = await import("node:zlib"), grey = (W, H) => { const raw = Buffer.alloc((W * 3 + 1) * H, 200); for (let y = 0; y < H; y++) raw[y * (W * 3 + 1)] = 0;
    const ch = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]), c = Buffer.alloc(4); c.writeUInt32BE(crc32(td) >>> 0); return Buffer.concat([l, td, c]); };
    const ih = Buffer.alloc(13); ih.writeUInt32BE(W, 0); ih.writeUInt32BE(H, 4); ih[8] = 8; ih[9] = 2;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ch("IHDR", ih), ch("IDAT", deflateSync(raw)), ch("IEND", Buffer.alloc(0))]); };
  let k = 0;
  const flaky = mk(async (s, o) => { if (k++ === 0) throw new Error("Bildet tok for lang tid."); return grey(o.width, o.height); });
  const ok = await send(flaky, {}); assert.equal(ok.picture, true); assert.equal(ok.note, undefined, "the retry made it");
});

test("U3978: sykehus keeps no inbox of its own: the report goes to the store through the door, and nothing here answers a wish", async () => {
  const { readFileSync } = await import("node:fs"), src = readFileSync(new URL("../wishes.mjs", import.meta.url), "utf8");
  assert.match(src, /door\.call\("\/feedback"/, "the guard did not find the door call: it proves nothing");
  assert.doesNotMatch(src, /readdirSync\(home\)|\.status = b\.status|SYKEHUS_WISH_WEBHOOK/, "a wish store of its own came back");
  assert.deepEqual(readdirSync(join(dir, "_wishes")).filter(f => f.endsWith(".json")).every(f => /^w[A-Za-z0-9_-]{10}\.json$/.test(f)), true, "only a picture's owner file lives here");
});
