/* The card picture is the project's newest starred Gjengi render, else a clean drawn view (Morten 2026-10-27).
   node --test tests/thumb-fav.test.mjs */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { cardOpts, drawCard } from "../thumbs.mjs";

const secret = "proxy-secret-for-tests-0123456789", as = who => ({ "remote-user": who, "x-sykehus-proxy-auth": secret });
const dir = mkdtempSync(join(tmpdir(), "sykehus-thumbfav-")), vdir = join(dir, "v");
async function boot() {
  const PORT = 9800 + Math.floor(Math.random() * 90), srv = spawn(process.execPath, [new URL("../server.mjs", import.meta.url).pathname], { env: { ...process.env, PORT: String(PORT), SYKEHUS_VERSIONS_DIR: vdir, SYKEHUS_PROXY_SECRET: secret, DOCS: "" }, stdio: ["ignore", "pipe", "inherit"] });
  await new Promise(ok => srv.stdout.on("data", d => String(d).includes("Sykehustomta on") && ok()));
  const O = `http://localhost:${PORT}`;
  const call = async (name, args, h) => (await (await fetch(O + "/mcp", { method: "POST", headers: { "content-type": "application/json", ...h }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) })).json()).result.structuredContent;
  return { O, call, stop: () => srv.kill(), pic: (id, h = {}) => fetch(`${O}/api/versjon/${id}/bilde.jpg`, { headers: h }), list: async w => (await (await fetch(O + "/api/versjoner", { headers: w ? as(w) : {} })).json()).versions };
}
const rec = (id, work, at, fav, ext) => ({ id, at, by: "morten", work, ext, bytes: 4, cost_usd: 0.1, fav, model: "m" });
const put = (recs, files) => { const g = join(vdir, "gjengi"); mkdirSync(g, { recursive: true }); writeFileSync(join(g, "index.json"), JSON.stringify(recs)); for (const [n, b] of Object.entries(files)) writeFileSync(join(g, n), b); };

let s = await boot();
const pub = (await s.call("new_version", { title: "Offentlig" }, as("morten"))).version; await s.call("set_sharing", { version: pub, sharing: "offentlig" }, as("morten"));
const priv = (await s.call("new_version", { title: "Privat" }, as("morten"))).version;
s.stop();
const old = Buffer.from("OLDPNG"), neu = Buffer.from("NEWWEBP"), no = Buffer.from("NOTFAV"), pv = Buffer.from("PRIVJPG");
const recs = [rec("aaaaaaaaaaaaaaa1", `versjon:${pub}`, "2026-10-26T10:00:00Z", true, "png"), rec("aaaaaaaaaaaaaaa2", `versjon:${pub}`, "2026-10-27T10:00:00Z", true, "webp"),
  rec("aaaaaaaaaaaaaaa3", `versjon:${pub}`, "2026-10-27T12:00:00Z", false, "png"), rec("aaaaaaaaaaaaaaa4", `versjon:${priv}`, "2026-10-27T10:00:00Z", true, "jpg")];
put(recs, { "aaaaaaaaaaaaaaa1.png": old, "aaaaaaaaaaaaaaa2.webp": neu, "aaaaaaaaaaaaaaa3.png": no, "aaaaaaaaaaaaaaa4.jpg": pv });
s = await boot(); after(() => s.stop());

test("(a) the newest favourite's bytes and content type; a non-favourite is ignored; the row carries its id as the token", async () => {
  const r = await s.pic(pub); assert.equal(r.status, 200); assert.equal(r.headers.get("content-type"), "image/webp");
  assert.deepEqual(Buffer.from(await r.arrayBuffer()), neu);
  assert.equal((await s.list("morten")).find(v => v.version === pub).thumb, "aaaaaaaaaaaaaaa2");
});

test("(d) a private project's favourite is not served to someone who may not see the project", async () => {
  assert.equal((await s.pic(priv, {})).status, 404); assert.equal((await s.pic(priv, as("pappa"))).status, 404);
  const own = await s.pic(priv, as("morten")); assert.equal(own.headers.get("content-type"), "image/jpeg"); assert.deepEqual(Buffer.from(await own.arrayBuffer()), pv);
});
test("(b) with no starred render the drawn picture is served (a PNG), token is the save time", async () => {
  put(recs.map(r => ({ ...r, fav: false })), {}); const t = await boot();
  try { const r = await t.pic(pub); assert.equal(r.status, 200); assert.equal(r.headers.get("content-type"), "image/png");
    const b = Buffer.from(await r.arrayBuffer()); assert.deepEqual([...b.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
    const row = (await t.list("morten")).find(v => v.version === pub); assert.equal(row.thumb, row.updated);
  } finally { t.stop(); }
});

test("(c) the drawn fallback is clean: no accent, no focus, whole site widened to hold the change", async () => {
  const site = { buildings: [{ own: true, ring: [[0, 0], [100, 0], [100, 60], [0, 60]] }] };
  let got; const png = await drawCard({ site, s: site, area: null, picture: async (x, o) => { got = o; return "png"; } });
  assert.equal(png, "png"); assert.equal(got.accent, false); assert.deepEqual(got.focus, []); assert.deepEqual(got.target.slice(0, 2), [50, 30]); assert.equal(got.dist, 330);
  const far = cardOpts(site, { box: { x0: 300, y0: 0, x1: 340, y1: 20 } });
  assert.equal(far.accent, false); assert.deepEqual(far.focus, []); assert.ok(far.dist > 330 && far.target[0] > 100);
});
