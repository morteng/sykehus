/* U3785: a message that names another version makes Anton read it or say which version he works in. node --test tests/version-named.test.mjs */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { spawn } from "node:child_process";

const dir = mkdtempSync(join(tmpdir(), "sykehus-named-")), secret = "proxy-secret-for-tests-0123456789", bearer = "door-token-0123456789", seen = [];
const door = createServer((req, res) => { let s = ""; req.on("data", c => s += c); req.on("end", () => {
  if (req.url === "/internal/sykehus/chat") { seen.push(JSON.parse(s)); return res.writeHead(200, { "content-type": "application/x-ndjson" }).end(JSON.stringify({ type: "done" }) + "\n"); }
  res.writeHead(200, { "content-type": "application/json" }).end("{}"); }); });
await new Promise(ok => door.listen(0, ok));
const PORT = 9000 + Math.floor(Math.random() * 900), O = `http://localhost:${PORT}`, lars = { "remote-user": "lars", "x-edge-auth": secret, "content-type": "application/json" };
const srv = spawn(process.execPath, [new URL("../server.mjs", import.meta.url).pathname], { env: { ...process.env, PORT: String(PORT), SYKEHUS_VERSIONS_DIR: join(dir, "v"), SYKEHUS_PROXY_SECRET: secret, DOCS: "",
  SYKEHUS_COOKIE_SECRET: "cookie-secret-for-tests-0123456789abcdef", SYKEHUS_ASSISTANT_URL: `http://127.0.0.1:${door.address().port}`, SYKEHUS_ASSISTANT_TOKEN: bearer }, stdio: ["ignore", "pipe", "inherit"] });
await new Promise(ok => srv.stdout.on("data", d => String(d).includes("Sykehustomta on") && ok()));
after(() => { srv.kill(); door.close(); });
const post = (p, b) => fetch(O + p, { method: "POST", headers: lars, body: JSON.stringify(b) }).then(async r => ({ status: r.status, j: await r.json() }));
const turn = async (text, version) => { const n = seen.length; const r = await post("/api/anton", { text, version }); assert.equal(r.status, 202); for (let i = 0; i < 50 && seen.length === n; i++) await new Promise(ok => setTimeout(ok, 100)); await new Promise(ok => setTimeout(ok, 200)); return seen.at(-1); };

test("the same message on the same open draft: the door gets the named version's id and the sentence to say", async () => {
  const open = (await post("/api/endring", { fresh: true, title: "Nytt forslag" })).j.version, named = (await post("/api/endring", { fresh: true, title: "Mitt etter" })).j.version;
  const text = "Lag en trapp ned fra terrassen på Sentralblokka til hagen, i versjonen «Mitt etter».";
  const b = await turn(text, open);
  assert.ok(b.message.startsWith(text));
  assert.match(b.message, new RegExp(`«Mitt etter» \\(${named}\\)`)); assert.match(b.message, new RegExp(`«Nytt forslag» \\(${open}\\)`));
  assert.ok(b.message.includes(`show_draft target=${named}`)); assert.ok(b.message.includes("Jeg jobber i «Nytt forslag», ikke «Mitt etter»"));
  assert.equal(b.version.id, open);
});

test("no other version named: the message goes as typed", async () => {
  const open = (await post("/api/endring", { fresh: true, title: "Åpen" })).j.version;
  assert.equal((await turn("Lag en trapp i «Åpen».", open)).message, "Lag en trapp i «Åpen».");
  assert.equal((await turn("Lag en trapp.", open)).message, "Lag en trapp.");
});
