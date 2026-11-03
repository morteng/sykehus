/* U3937: two guards on the feedback surfaces themselves.
   1) a report respects the auth of the data it describes: send_wish naming another person's private version is refused and files nothing.
   2) a question that needs a person never dead-ends: ask_point with no page open files a «question» report (shown in the asker's Ønsker).
   node --test tests/feedback-guards.test.mjs */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { stubDoor, BEARER } from "./stub-door.mjs";

const door = await stubDoor(), filed = door.filed;
const dir = mkdtempSync(join(tmpdir(), "sykehus-fg-")), secret = "proxy-secret-for-tests-0123456789", PORT = 9000 + Math.floor(Math.random() * 900);
const srv = spawn(process.execPath, [new URL("../server.mjs", import.meta.url).pathname], { env: { ...process.env, PORT: String(PORT), SYKEHUS_VERSIONS_DIR: dir, SYKEHUS_PROXY_SECRET: secret, SYKEHUS_ASSISTANT_URL: door.url, SYKEHUS_ASSISTANT_TOKEN: BEARER, SYKEHUS_COOKIE_SECRET: "cookie-secret-for-tests-0123456789012345", DOCS: "" }, stdio: ["ignore", "pipe", "inherit"] });
await new Promise(ok => srv.stdout.on("data", d => String(d).includes("Sykehustomta on") && ok()));
after(() => { srv.kill(); door.close(); });
const O = `http://localhost:${PORT}`, as = p => ({ "remote-user": p, "x-edge-auth": secret });
const call = async (name, args, h) => (await (await fetch(O + "/mcp", { method: "POST", headers: { "content-type": "application/json", ...h }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) })).json()).result;

test("guard 1: a wish about lars's private version is refused for kari and files nothing; lars's own goes through", async () => {
  const v = (await call("new_version", { title: "Lars sin hemmelige" }, as("lars"))).structuredContent;
  const k = await call("send_wish", { text: "Noe med den versjonen", version_id: v.version, picture: false }, as("kari"));
  assert.equal(k.isError, true); assert.equal(filed.length, 0, "nothing reached the store");
  assert.ok(!JSON.stringify(k).includes("hemmelige"), "the title does not leak");
  const none = await call("send_wish", { text: "Noe med den versjonen", version_id: "vfinnesikke1", picture: false }, as("kari"));
  assert.equal(none.isError, true, "an unknown id is refused the same way");
  const l = await call("send_wish", { text: "Noe med min versjon", version_id: v.version, picture: false }, as("lars"));
  assert.ok(!l.isError); assert.equal(filed.length, 1); assert.equal(filed[0].design_id, v.version);
});

test("guard 2: ask_point with no page open lands as a question row for the asker, and only theirs", async () => {
  const r = await call("ask_point", { question: "Hvor skal trappen ned til?", x: 0.2, y: 29.2 }, as("lars"));
  assert.ok(!r.isError); assert.equal(r.structuredContent.asked, false); assert.ok(r.structuredContent.kept_as);
  const row = filed.find(f => f.kind === "question"); assert.ok(row); console.log("ROW:", JSON.stringify({ id: r.structuredContent.kept_as, kind: row.kind, person: row.person, text: row.text }));
  assert.match(row.text, /Hvor skal trappen ned til\?/);
  const mine = async p => (await (await fetch(O + "/api/onsker", { headers: as(p) })).json()).wishes;
  assert.ok((await mine("lars")).some(w => w.id === r.structuredContent.kept_as));
  assert.ok(!(await mine("kari")).some(w => w.id === r.structuredContent.kept_as));
});
