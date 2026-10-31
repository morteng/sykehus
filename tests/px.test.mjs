// U3992: a person's own picture goes through the scaler signed; only the person who may open it passes /px-may; the source is for the scaler only.
// The signer is the kit's (public/kit/picture-signed.js, held to the kit's vectors); this tests what the app builds with it and who may pass.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createPx, ORIGIN } from "../px.mjs";

const KEY = "000102030405060708090a0b0c0d0e0f", SALT = "a0a1a2a3a4a5a6a7a8a9aaabacadaeaf";
const res = () => { const r = { code: null, headers: null, body: null, writeHead(c, h) { r.code = c; r.headers = h; return r; }, end(b) { r.body = b ?? null; return r; } }; return r; };
const req = (h = {}, who = null) => ({ headers: h, who });
const sources = { foto: { may: (who, id) => who === "ola" && id === "p1", bytes: id => id === "p1" ? { type: "image/jpeg", bytes: Buffer.from("JPEGBYTES") } : null } };
const px = createPx({ personOf: r => r.who ? { person: r.who } : null, sources, key: KEY, salt: SALT, clock: () => 1893000000 });
const addr = async () => (await px.url("foto", "p1", "123", 300));

test("the address is signed, bucketed, expires a day or more away and names the app's own source", async () => {
  const a = await addr();
  assert.match(a, /^\/px\/[A-Za-z0-9_-]{43}\/rs:fit:320:0\/exp:\d{10}\/plain\/http:\/\/sykehus-mcp:8090\/internal\/px-src\/foto\/p1\/123$/);
  assert.ok(+/exp:(\d+)/.exec(a)[1] - 1893000000 >= 86400);
  assert.equal(ORIGIN, "http://sykehus-mcp:8090");
  assert.equal(await px.url("foto", "p1/..", "1", 300), null, "a part the address cannot carry");
  assert.equal(await createPx({ sources }).url("foto", "p1", "1", 300), null, "no key: no address, the route answers the file as it is");
});

test("a redirect carries the signed address and is private to the browser; no width or no key answers nothing", async () => {
  const r = res(); assert.equal(await px.redirect(req(), r, "foto", "p1", "123", new URL("http://x/api/bilder/p1?w=300")), true);
  assert.equal(r.code, 302); assert.equal(r.headers.location, await addr()); assert.match(r.headers["cache-control"], /^private/);
  const r2 = res(); assert.equal(await px.redirect(req(), r2, "foto", "p1", "123", new URL("http://x/api/bilder/p1")), false); assert.equal(r2.code, null);
});

test("/px-may: logged out is 401 text, another person 404 text, the owner 200 and empty; an address the app does not make is 404", async () => {
  const uri = { "x-forwarded-uri": await addr() };
  let r = res(); await px.route(req(uri), r, "/px-may"); assert.equal(r.code, 401); assert.equal(r.body, "Not signed in.");
  r = res(); await px.route(req(uri, "kari"), r, "/px-may"); assert.equal(r.code, 404); assert.equal(r.body, "Not found.");
  r = res(); await px.route(req(uri, "ola"), r, "/px-may"); assert.equal(r.code, 200); assert.equal(r.body, null);
  r = res(); await px.route(req({ "x-forwarded-uri": "/px/SIG/rs:fit:320:0/exp:1893456000/plain/http://sykehus-mcp:8090/internal/px-src/evil/p1/1" }, "ola"), r, "/px-may"); assert.equal(r.code, 404);
});

test("/internal/px-src: the bytes for the scaler; a request through the edge (forwarding header, cookie, proxy secret) is not found", async () => {
  let r = res(); assert.equal(await px.route(req(), r, "/internal/px-src/foto/p1/123"), true);
  assert.equal(r.code, 200); assert.equal(r.headers["content-type"], "image/jpeg"); assert.equal(String(r.body), "JPEGBYTES");
  for (const h of [{ "x-forwarded-for": "1.2.3.4" }, { cookie: "a=b" }, { "x-sykehus-proxy-auth": "s" }, { "remote-user": "ola" }]) { r = res(); await px.route(req(h), r, "/internal/px-src/foto/p1/123"); assert.equal(r.code, 404, JSON.stringify(h)); }
  r = res(); await px.route(req(), r, "/internal/px-src/foto/nope/1"); assert.equal(r.code, 404);
  assert.equal(await px.route(req(), res(), "/api/other"), false);
});
