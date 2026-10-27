/* «Vis offentlig i Prosjekter» (Morten 2026-10-27): the owner sets a project offentlig, lenke or privat through the page's route
   (POST /api/endring { share, sharing }); only the owner may; the public ones are listed to a signed-out visitor.
   node --test tests/share-public.test.mjs */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { shareActs, publicBox, sharingFor, SHARE_TOAST, PUBLIC_TIP } from "../public/sharing.js";

const dir = mkdtempSync(join(tmpdir(), "sykehus-pub-")), secret = "proxy-secret-for-tests-0123456789", PORT = 9100 + Math.floor(Math.random() * 800);
const O = `http://localhost:${PORT}`, as = who => ({ "remote-user": who, "x-sykehus-proxy-auth": secret });
const srv = spawn(process.execPath, [new URL("../server.mjs", import.meta.url).pathname], { env: { ...process.env, PORT: String(PORT), SYKEHUS_VERSIONS_DIR: join(dir, "v"), SYKEHUS_PROXY_SECRET: secret, DOCS: "" }, stdio: ["ignore", "pipe", "inherit"] });
await new Promise(ok => srv.stdout.on("data", d => String(d).includes("Sykehustomta on") && ok()));
after(() => srv.kill());
let n = 0;
const call = async (name, args, h) => { const c = (await (await fetch(O + "/mcp", { method: "POST", headers: { "content-type": "application/json", ...h }, body: JSON.stringify({ jsonrpc: "2.0", id: ++n, method: "tools/call", params: { name, arguments: args } }) })).json()).result; return c.structuredContent; };
const page = (body, h) => fetch(O + "/api/endring", { method: "POST", headers: { "content-type": "application/json", ...h }, body: JSON.stringify(body) }).then(async r => ({ status: r.status, j: await r.json() }));
const listed = async h => (await (await fetch(O + "/api/versjoner", { headers: h })).json()).versions.map(v => v.version);
const lars = as("lars"), kari = as("kari");

test("only the owner sets offentlig; another person is refused and nothing changes", async () => {
  const v = (await call("new_version", { title: "Drivhus" }, lars)).version;
  const r = await page({ share: v, sharing: "offentlig" }, kari);
  assert.equal(r.status, 400); assert.match(r.j.error, /No version|lars sin/, "a private one is not even visible to her");
  assert.equal((await page({ share: v, sharing: "offentlig" }, {})).status, 400, "signed out is refused too");
  assert.ok(!(await listed()).includes(v), "still not in the anonymous list");
  assert.equal((await page({ share: v, sharing: "offentlig" }, lars)).j.sharing, "offentlig");
  const take = await page({ share: v, sharing: "lenke" }, kari);   // she sees it now, and still may not change it
  assert.equal(take.status, 400); assert.match(take.j.error, /lars sin/); assert.ok((await listed()).includes(v), "still public");
  assert.equal((await page({ unshare: v }, kari)).status, 400, "nor take it private");
  await page({ unshare: v }, lars);
  assert.equal((await call("list_versions", { owner: "me" }, lars)).versions.find(x => x.version === v).sharing, "privat");
});

test("offentlig lists it for a signed-out visitor, who opens it without a key; lenke takes it off the list but the key still opens it", async () => {
  const v = (await call("new_version", { title: "Til alle" }, lars)).version;
  const on = await page({ share: v, sharing: "offentlig" }, lars);
  assert.equal(on.status, 200); assert.equal(on.j.sharing, "offentlig"); assert.ok(!on.j.link.includes("nokkel"), "the link of a public one has no key");
  assert.ok((await listed()).includes(v), "anonymous list has it");
  assert.equal((await fetch(`${O}/api/versjon/${v}`)).status, 200, "opens without a key");
  assert.ok((await listed(kari)).includes(v), "another signed-in person sees it too");
  const off = await page({ share: v, sharing: "lenke" }, lars);
  assert.equal(off.j.sharing, "lenke"); assert.match(off.j.link, /nokkel=/);
  assert.ok(!(await listed()).includes(v), "gone from the anonymous list");
  assert.equal((await fetch(`${O}/api/versjon/${v}`)).status, 404, "no key, no version");
  assert.equal((await fetch(`${off.j.link.replace(/^.*\?versjon=/, `${O}/api/versjon/`).replace("&nokkel=", "?nokkel=")}`)).status, 200, "with the key it opens");
  assert.ok((await listed(lars)).includes(v), "the owner still lists it");
});

test("an invalid sharing is refused and the old share still means lenke", async () => {
  const v = (await call("new_version", { title: "Ugyldig" }, lars)).version;
  const bad = await page({ share: v, sharing: "alle" }, lars); assert.equal(bad.status, 400); assert.match(bad.j.error, /privat, lenke, offentlig/);
  assert.equal((await page({ share: v }, lars)).j.sharing, "lenke", "share: id alone is lenke");
  assert.equal((await page({ share: v }, lars)).j.sharing, "lenke", "and a second one changes nothing");
  assert.equal((await page({ share: v, sharing: "offentlig" }, lars)).j.sharing, "offentlig");
  assert.equal((await page({ share: v }, lars)).j.sharing, "offentlig", "the old call does not pull a public one back");
  assert.equal((await page({ unshare: v }, lars)).j.sharing, "privat");
  assert.ok(!(await listed()).includes(v));
});

test("a project of a test account stays out of the list although it is public", async () => {
  const t = as("test-qa"), v = (await call("new_version", { title: "Testprosjekt" }, t)).version;
  assert.equal((await page({ share: v, sharing: "offentlig" }, t)).j.sharing, "offentlig");
  assert.ok(!(await listed()).includes(v)); assert.ok(!(await listed(kari)).includes(v)); assert.ok((await listed(t)).includes(v), "its owner still sees it");
});

/* the page's pieces (public/sharing.js): who gets which control, and what a tick sends */
const act = (k, title) => `<b data-${k}="v1" title="${title}"></b>`, IC = { link: "L", lock: "K" };
test("the owner's card has «Vis offentlig»; a card of someone else has no share control; a public card shows «Bare lenke»", () => {
  const own = shareActs({ version: "v1", mine: true, sharing: "lenke" }, act, IC);
  assert.match(own, /data-vpub="v1"/); assert.ok(own.includes(PUBLIC_TIP)); assert.match(own, /data-vpriv/);
  assert.equal(shareActs({ version: "v1", sharing: "offentlig", owner: "lars" }, act, IC), "", "not the owner's: no control");
  const pub = shareActs({ version: "v1", mine: true, sharing: "offentlig" }, act, IC);
  assert.match(pub, /data-vlink="v1"/); assert.doesNotMatch(pub, /data-vpub|data-vshare/);
  assert.doesNotMatch(shareActs({ version: "v1", mine: true, sharing: "privat" }, act, IC), /data-vpriv/);
});
test("the box says its label, is checked when public, and a tick means offentlig, an untick lenke", () => {
  const off = publicBox({ version: "v1", mine: true, sharing: "lenke" }), on = publicBox({ version: "v1", mine: true, sharing: "offentlig" });
  assert.match(off, /Vis offentlig i Prosjekter/); assert.match(off, /Alle som åpner siden ser prosjektet, uten innlogging\./); assert.match(off, /Fjern haken for å gjøre det til bare lenke\./);
  assert.doesNotMatch(off, /checked/); assert.match(on, /checked/); assert.equal(publicBox({ version: "v1", sharing: "offentlig" }), "", "no box for a project that is not yours");
  assert.deepEqual([sharingFor(true), sharingFor(false)], ["offentlig", "lenke"]);
  assert.deepEqual(SHARE_TOAST, { offentlig: "Prosjektet vises nå offentlig", lenke: "Prosjektet er nå bare delt med lenke" });
});
test("the page wires the control to the same route and the cache strings moved", () => {
  const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8"), html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(app, /change\(\{ share: id, sharing: to \}\)/); assert.match(app, /data-vpub\]|\[data-vpub\]/); assert.match(app, /input\[data-pub\]/);
  assert.match(html, /app\.js\?v=2026\d+[a-z0-9]+/);
});
