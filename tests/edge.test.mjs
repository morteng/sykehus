/* U3981, U3964: who the server believes, from the edge. One header name for the proof (X-Edge-Auth; X-Sykehus-Proxy-Auth counts the
   same until the rollout ends), and a signed assertion from a calling service: a wrong aud or an old exp is refused (401), a good one names
   the person. node --test tests/edge.test.mjs */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createHash, createPrivateKey, createPublicKey } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { signAssertion } from "../vendor/edgekit/edge.js";

const secret = "proxy-secret-for-tests-0123456789", seed = Buffer.from(Array.from({ length: 32 }, (_, i) => 90 + i));
const PKCS8 = Buffer.from("302e020100300506032b657004220420", "hex");
const priv = seed.toString("base64url");
const pub = createPublicKey(createPrivateKey({ key: Buffer.concat([PKCS8, seed]), format: "der", type: "pkcs8" })).export({ format: "der", type: "spki" }).subarray(-32).toString("base64url");
const dir = mkdtempSync(join(tmpdir(), "sykehus-edge-")), PORT = 9000 + Math.floor(Math.random() * 900);
const srv = spawn(process.execPath, [new URL("../server.mjs", import.meta.url).pathname], { env: { ...process.env, PORT: String(PORT), SYKEHUS_VERSIONS_DIR: dir, SYKEHUS_PROXY_SECRET: secret, SYKEHUS_ASSERTION_PUBKEY: pub, DOCS: "" }, stdio: ["ignore", "pipe", "inherit"] });
await new Promise(ok => srv.stdout.on("data", d => String(d).includes("Sykehustomta on") && ok()));
after(() => srv.kill());
const O = `http://localhost:${PORT}`, meg = async h => { const r = await fetch(O + "/api/meg", { headers: h }); return [r.status, (await r.json()).person ?? null]; };
const token = (o = {}) => signAssertion(priv, { sub: "okter", aud: "sykehus", ...o });

test("the proof makes Remote-User a login; without it, or with the wrong one, it is no one", async () => {
  assert.deepEqual(await meg({ "x-edge-auth": secret, "remote-user": "okter" }), [200, "okter"]);
  assert.deepEqual(await meg({ "x-sykehus-proxy-auth": secret, "remote-user": "okter" }), [200, "okter"], "the old header still counts during the rollout");
  assert.deepEqual(await meg({ "remote-user": "okter" }), [200, null]);
  assert.deepEqual(await meg({ "x-edge-auth": "not-the-secret", "remote-user": "okter" }), [200, null]);
  assert.deepEqual(await meg({ "x-edge-auth": secret }), [200, null], "the proof alone is no one");
  assert.equal((await fetch(O + "/api/onsker", { headers: { "remote-user": "okter" } })).status, 401, "a request straight to the container, signed in by name only, is refused");
});
test("a good assertion names the person; the login in Remote-User does not override it", async () => {
  assert.deepEqual(await meg({ "x-edge-auth": secret, "x-edge-assertion": token(), "remote-user": "someone-else" }), [200, "okter"]);
});
test("a wrong aud, an old exp, a bad signature or a missing proof is not an assertion", async () => {
  const h = t => ({ "x-edge-auth": secret, "x-edge-assertion": t, "remote-user": "okter" });
  for (const [why, t] of [["wrong aud", token({ aud: "laser" })], ["old exp", token({ now: Math.floor(Date.now() / 1000) - 600 })], ["bad signature", token().replace(/.(.{6})$/, (m, tail) => (m[0] === "A" ? "B" : "A") + tail)], ["not a token", "abc"]]) {
    const r = await fetch(O + "/api/meg", { headers: h(t) });
    assert.equal(r.status, 401, why); assert.equal((await r.json()).error, "assertion refused", why);
  }
  assert.deepEqual(await meg({ "x-edge-assertion": token() }), [200, null], "no proof, no person (and nothing to refuse: it is a request from no one)");
});

test("vendor/edgekit is the kits edge kit at the locked sha, byte for byte (take a new sha, never edit the copy)", () => {
  const ROOT = new URL("../", import.meta.url), lock = JSON.parse(readFileSync(new URL("edgekit.lock.json", ROOT), "utf8"));
  const blob = buf => createHash("sha1").update(`blob ${buf.length}\0`).update(buf).digest("hex");
  assert.equal(lock.kit, "edge"); assert.match(lock.kits, /^[0-9a-f]{40}$/);
  for (const [name, want] of Object.entries(lock.files)) assert.equal(blob(readFileSync(new URL(`${lock.dest}/${name}`, ROOT))), want, name);
});
