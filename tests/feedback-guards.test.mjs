/* U3937: two guards on the feedback surfaces. (1) a report about a version names, links and pictures it only for a person who may see it;
   (2) a question that needs a person (ask_point) with no page open is not lost: it lands as a «question» row in the report store and in the asker's own Ønsker.
   node --test tests/feedback-guards.test.mjs */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { stubDoor, BEARER } from "./stub-door.mjs";

const door = await stubDoor(), filed = door.filed, dir = mkdtempSync(join(tmpdir(), "fbguard-")), secret = "proxy-secret-for-tests-0123456789", PORT = 9000 + Math.floor(Math.random() * 900);
const srv = spawn(process.execPath, [new URL("../server.mjs", import.meta.url).pathname], { env: { ...process.env, PORT: String(PORT), SYKEHUS_VERSIONS_DIR: dir, SYKEHUS_PROXY_SECRET: secret, SYKEHUS_ADMIN_TOKEN: "admin-token-for-tests-0123456789", SYKEHUS_ASSISTANT_URL: door.url, SYKEHUS_ASSISTANT_TOKEN: BEARER, SYKEHUS_COOKIE_SECRET: "cookie-secret-for-tests-0123456789012345", DOCS: "" }, stdio: ["ignore", "pipe", "inherit"] });
await new Promise(ok => srv.stdout.on("data", d => String(d).includes("Sykehustomta on") && ok()));
after(() => { srv.kill(); door.close(); });
const O = `http://localhost:${PORT}`, as = p => ({ "remote-user": p, "x-edge-auth": secret });
const call = async (name, args, h) => (await (await fetch(O + "/mcp", { method: "POST", headers: { "content-type": "application/json", ...h }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) })).json()).result;

test("a report about lars's private version, sent by kari, carries no id, link or picture of it", async () => {
  const v = (await call("new_version", { title: "Privat" }, as("lars"))).structuredContent;
  const seen = (await call("list_versions", {}, as("kari"))).structuredContent.versions.map(x => x.id);
  assert.ok(!seen.includes(v.version), "the version is private to lars: kari does not see it");
  const r = (await call("send_wish", { text: "Noe om denne versjonen", version_id: v.version, view_name: "plan" }, as("kari"))).structuredContent;
  assert.equal(r.sent, true); assert.equal(r.picture, false, "no picture of what kari may not see");
  const row = filed.at(-1); assert.equal(row.design_id, undefined, "the report does not name the private version"); assert.ok(!JSON.stringify(row).includes(v.version), JSON.stringify(row));
  const own = (await call("send_wish", { text: "Noe om min versjon", version_id: v.version, view_name: "plan" }, as("lars"))).structuredContent; assert.equal(own.sent, true);
  assert.equal(filed.at(-1).design_id, v.version, "its owner's report still names it");
});

test("a question raised with no page open lands as a question row in the store and under the asker's Ønsker", async () => {
  const r = (await call("ask_point", { question: "Hvor skal trappen ned til?" }, as("lars"))).structuredContent;
  assert.equal(r.asked, false); assert.ok(r.kept_as, "kept: " + JSON.stringify(r));
  const row = filed.at(-1); assert.equal(row.kind, "question"); assert.equal(row.person, "lars"); assert.match(row.text, /Hvor skal trappen ned til\?/);
  console.log("ROW:", JSON.stringify({ id: row.id, kind: row.kind, person: row.person, text: row.text }));
  const mine = await (await fetch(O + "/api/onsker", { headers: as("lars") })).json();
  assert.ok(mine.wishes.some(w => w.id === r.kept_as && /Hvor skal trappen/.test(w.text)), "listed for lars");
  assert.ok(!(await (await fetch(O + "/api/onsker", { headers: as("kari") })).json()).wishes.some(w => w.id === r.kept_as), "not for kari");
});
