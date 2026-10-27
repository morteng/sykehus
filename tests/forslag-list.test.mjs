/* The Forslag tab's list and its card pictures (Morten 2026-10-27): who is listed to whom, the picture route's visibility, and the
   picture cache (thumbs.mjs: one drawing for concurrent requests, two at once at most, redrawn when the version was saved again).
   node --test tests/forslag-list.test.mjs */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createThumbs, LIMIT } from "../thumbs.mjs";
import { createVersions, isPerson } from "../versions.mjs";

const dir = mkdtempSync(join(tmpdir(), "sykehus-forslag-")), secret = "proxy-secret-for-tests-0123456789", PORT = 9900 + Math.floor(Math.random() * 90);
const O = `http://localhost:${PORT}`, as = who => ({ "remote-user": who, "x-sykehus-proxy-auth": secret });
const srv = spawn(process.execPath, [new URL("../server.mjs", import.meta.url).pathname], { env: { ...process.env, PORT: String(PORT), SYKEHUS_VERSIONS_DIR: join(dir, "v"), SYKEHUS_PROXY_SECRET: secret, DOCS: "" }, stdio: ["ignore", "pipe", "inherit"] });
await new Promise(ok => srv.stdout.on("data", d => String(d).includes("Sykehustomta on") && ok()));
after(() => srv.kill());
const call = async (name, args, h) => (await (await fetch(O + "/mcp", { method: "POST", headers: { "content-type": "application/json", ...h }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) })).json()).result.structuredContent;
const make = async (who, title, sharing) => { const v = await call("new_version", { title }, as(who)); if (sharing !== "privat") await call("set_sharing", { version: v.version, sharing }, as(who)); return v.version; };
const listed = async who => (await (await fetch(O + "/api/versjoner", { headers: who ? as(who) : {} })).json()).versions;

const ids = {
  mortenPub: await make("morten", "Badeland", "offentlig"), testPub: await make("testperson", "Testens", "offentlig"),
  mortenPriv: await make("morten", "Mitt private", "privat"), farLink: await make("pappa", "Pappas lenke", "lenke"), farPub: await make("pappa", "Pappas forslag", "offentlig"),
  mortenLink: await make("morten", "Min lenke", "lenke"),
};

test("the real-person rule: fixtures, qa and tools are not people", () => {
  for (const n of ["morten", "pappa", "magnus", "lars"]) assert.equal(isPerson(n), true, n);
  for (const n of ["testperson", "Test1", "qa-a", "coretest", "anton", "admin", "system", "", null]) assert.equal(isPerson(n), false, String(n));
});

test("(a) signed out: only public versions of real people", async () => {
  assert.deepEqual((await listed(null)).map(v => v.version).sort(), [ids.mortenPub, ids.farPub].sort());
});

test("(b) signed in as morten: own of every sharing first, then the public ones of real people; never another's link-only or private, never a fixture's", async () => {
  const l = await listed("morten"), got = l.map(v => v.version);
  assert.deepEqual(got.slice(0, 3).sort(), [ids.mortenPub, ids.mortenPriv, ids.mortenLink].sort());
  assert.deepEqual(got.slice(3), [ids.farPub]);
  assert.ok(l.slice(0, 3).every(v => v.mine && v.sharing) && !l[3].mine && l[3].owner === "pappa");
  assert.ok(!got.includes(ids.farLink) && !got.includes(ids.testPub));
  assert.deepEqual((await listed("testperson")).map(v => v.version).slice(0, 1), [ids.testPub]);   // a fixture sees its own
});

test("(c) the picture: 404 for what the viewer may not see, a JPEG for what they may; the card's key opens a private one", async () => {
  const get = (id, h, q = "") => fetch(`${O}/api/versjon/${id}/bilde.jpg${q}`, { headers: h });
  assert.equal((await get(ids.mortenPriv, {})).status, 404);
  assert.equal((await get(ids.mortenPriv, as("pappa"))).status, 404);
  assert.equal((await get(ids.farLink, {})).status, 404);
  assert.equal((await get("vnotthere1", {})).status, 404);
  const own = await get(ids.mortenPriv, as("morten")); assert.equal(own.status, 200); assert.equal(own.headers.get("content-type"), "image/jpeg");
  const b = Buffer.from(await own.arrayBuffer()); assert.deepEqual([...b.subarray(0, 3)], [0xff, 0xd8, 0xff]); assert.deepEqual([...b.subarray(-2)], [0xff, 0xd9]);
  assert.equal(b.readUInt16BE(b.indexOf(Buffer.from([0xff, 0xc0])) + 5), 300);   // SOF0: height 300 (480 wide)
  const key = (await listed("morten")).find(v => v.version === ids.mortenPriv).nokkel;
  assert.equal((await get(ids.mortenPriv, {}, `?nokkel=${key}`)).status, 200);
  assert.equal((await get(ids.farPub, {})).status, 200);
  assert.ok(readdirSync(join(dir, "v", "_state", "thumbs")).includes(ids.mortenPriv + ".jpg"));
});

test("(d) concurrent requests for one version share one drawing; at most two at once; a new save draws again", async () => {
  const d = mkdtempSync(join(tmpdir(), "sykehus-thumbs-")), vs = createVersions(join(d, "v")), v = vs.create("morten", "En", []);
  let calls = 0, now = 0, peak = 0, going = 0; const release = [];
  const th = createThumbs({ dir: join(d, "v"), render: x => { calls++; going++; peak = Math.max(peak, going); return new Promise(ok => release.push(() => { going--; ok(Buffer.from("jpg-" + x.updated)); })); } });
  const ps = [th.get(v), th.get(v), th.get(v)];
  await new Promise(r => setTimeout(r, 20)); assert.equal(calls, 1);
  release.shift()(); const [a, b, c] = await Promise.all(ps); assert.ok(a === b && b === c);
  assert.equal((await th.get(v)).toString(), a.toString()); assert.equal(calls, 1);   // from disk
  const more = ["a", "b", "c", "d"].map(t => th.get({ ...v, id: "v" + t.repeat(8), updated: v.updated }));
  await new Promise(r => setTimeout(r, 20)); assert.equal(calls, 1 + LIMIT); assert.equal(going, LIMIT);
  while (release.length) { release.shift()(); await new Promise(r => setTimeout(r, 5)); }
  await Promise.all(more); assert.equal(calls, 5); assert.equal(peak, LIMIT);
  const saved = { ...v, updated: new Date(Date.parse(v.updated) + 5000).toISOString() };
  const p = th.get(saved); await new Promise(r => setTimeout(r, 20)); assert.equal(calls, 6); release.shift()(); assert.equal((await p).toString(), "jpg-" + saved.updated);
});
