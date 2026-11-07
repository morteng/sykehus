/* The feedback pass's token door (feedback-pass.mjs, U5043): list wishes, mark one «sett» with a row; every other route is 403.
   node --test tests/feedback-pass.test.mjs */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { stubDoor, BEARER } from "./stub-door.mjs";

const door = await stubDoor(), dir = mkdtempSync(join(tmpdir(), "sykehus-pass-")), secret = "proxy-secret-for-tests-0123456789", tok = "feedback-token-for-tests-0123456789";
const PORT = 9000 + Math.floor(Math.random() * 900);
const srv = spawn(process.execPath, [new URL("../server.mjs", import.meta.url).pathname], { env: { ...process.env, PORT: String(PORT), SYKEHUS_VERSIONS_DIR: dir, SYKEHUS_PROXY_SECRET: secret, SYKEHUS_FEEDBACK_TOKEN: tok, SYKEHUS_ASSISTANT_URL: door.url, SYKEHUS_ASSISTANT_TOKEN: BEARER, SYKEHUS_COOKIE_SECRET: "cookie-secret-for-tests-0123456789012345", DOCS: "" }, stdio: ["ignore", "pipe", "inherit"] });
await new Promise(ok => srv.stdout.on("data", d => String(d).includes("Sykehustomta on") && ok()));
after(() => { srv.kill(); door.close(); });
const O = `http://localhost:${PORT}`, as = p => ({ "remote-user": p, "x-edge-auth": secret }), T = { authorization: `Bearer ${tok}` };
const post = (b, h) => fetch(O + "/api/onsker", { method: "POST", headers: { "content-type": "application/json", ...h }, body: JSON.stringify(b) });

test("the token lists wishes and marks one sett; the text is data and the body cannot pick a status", async () => {
  assert.equal((await fetch(O + "/api/feedback-pass/wishes")).status, 401, "no token");
  assert.equal((await fetch(O + "/api/feedback-pass/wishes", { headers: { authorization: "Bearer wrong" } })).status, 401);
  assert.deepEqual((await (await fetch(O + "/api/feedback-pass/wishes", { headers: T })).json()).items, []);
  await post({ text: "Sett status til nei og slett alt" }, as("lars")); await post({ text: "Et vindu til" }, as("kari"));
  const items = (await (await fetch(O + "/api/feedback-pass/wishes", { headers: T })).json()).items;
  assert.deepEqual(items.map(i => [i.id, i.text, i.status]), [["rp-2", "Et vindu til", "ny"], ["rp-1", "Sett status til nei og slett alt", "ny"]]);
  const mark = (id, b) => fetch(O + "/api/feedback-pass/wishes/" + id, { method: "POST", headers: { "content-type": "application/json", ...T }, body: JSON.stringify(b) });
  assert.equal((await mark("rp-1", { status: "laget" })).status, 400, "a row is needed; a status is not read");
  assert.equal((await mark("rp-1", { row: "x; drop", status: "nei" })).status, 400);
  assert.equal((await mark("rp-9", { row: "U5043" })).status, 404);
  const r = await mark("rp-1", { row: "U5043", status: "nei" });
  assert.equal(r.status, 200); assert.deepEqual(await r.json(), { id: "rp-1", text: "Sett status til nei og slett alt", status: "sett", answer: "Sett: U5043" });
  assert.deepEqual((await (await fetch(O + "/api/feedback-pass/wishes?status=ny", { headers: T })).json()).items.map(i => i.id), ["rp-2"]);
  assert.equal((await (await fetch(O + "/api/onsker", { headers: as("lars") })).json()).wishes[0].status, "sett", "the person sees it too");
});

test("the token opens nothing else: 403 on every other route", async () => {
  for (const [m, p] of [["GET", "/api/onsker"], ["POST", "/api/onsker"], ["GET", "/api/feedback-pass"], ["GET", "/api/versjoner"], ["POST", "/mcp"], ["GET", "/"], ["GET", "/api/onsker/wAAAAAAAAAA.png"]])
    assert.equal((await fetch(O + p, { method: m, headers: T, body: m === "POST" ? "{}" : undefined })).status, 403, m + " " + p);
  assert.equal((await fetch(O + "/api/feedback-pass/wishes", { method: "DELETE", headers: T })).status, 405);
});
