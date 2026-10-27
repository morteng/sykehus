/* U3786: «Nytt prosjekt» keeps the person's own wish with the version, and show_draft hands it back. node --test tests/version-wish.test.mjs */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { firstTurn } from "../public/nytt-forslag.js";

const dir = mkdtempSync(join(tmpdir(), "sykehus-wish-")), secret = "proxy-secret-for-tests-0123456789", PORT = 9900 + Math.floor(Math.random() * 90);
const O = `http://localhost:${PORT}`, lars = { "remote-user": "lars", "x-sykehus-proxy-auth": secret }, other = { "remote-user": "kari", "x-sykehus-proxy-auth": secret };
const srv = spawn(process.execPath, [new URL("../server.mjs", import.meta.url).pathname], { env: { ...process.env, PORT: String(PORT), SYKEHUS_VERSIONS_DIR: join(dir, "v"), SYKEHUS_PROXY_SECRET: secret }, stdio: ["ignore", "pipe", "inherit"] });
await new Promise(ok => srv.stdout.on("data", d => String(d).includes("Sykehustomta on") && ok()));
after(() => srv.kill());
const post = (body, h) => fetch(O + "/api/endring", { method: "POST", headers: { "content-type": "application/json", ...h }, body: JSON.stringify(body) }).then(async r => ({ status: r.status, j: await r.json() }));
let id = 0;
const tool = async (name, args, h) => { const r = await fetch(O + "/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...h }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method: "tools/call", params: { name, arguments: args } }) }); const j = await r.json(); return j.result?.structuredContent ?? j; };

test("a new version made with a wish keeps the typed words only, and show_draft returns them", async () => {
  const typed = "Behold høyblokka, og lag et grønt tun mot sør.";
  const f = await post({ fresh: true, wish: `  ${typed}  ` }, lars); assert.equal(f.status, 200);
  assert.deepEqual(Object.keys(f.j.wish).sort(), ["at", "text"]); assert.equal(f.j.wish.text, typed); assert.ok(Number.isFinite(Date.parse(f.j.wish.at)));
  assert.ok(!firstTurn({ wish: typed }).includes(f.j.wish.text) === false, "the typed words are inside the template text; the stored wish is not the template");
  assert.doesNotMatch(f.j.wish.text, /Ønsket mitt|Jeg har laget/);
  const d = await tool("show_draft", { draft: f.j.version }, lars);
  assert.equal(d.wish.text, typed, "show_draft: the wish as typed"); assert.equal(d.version, f.j.version);
  const none = await post({ fresh: true }, lars); assert.equal(none.j.wish, undefined, "no wish typed, no wish kept");
  const cut = await post({ fresh: true, wish: "x".repeat(2500) }, lars); assert.equal(cut.j.wish.text.length, 2000);
  const seen = await tool("show_draft", { draft: f.j.version }, other);   // the wish has the version's own visibility: a private one opens only for its owner
  assert.equal(seen.wish, undefined); assert.doesNotMatch(JSON.stringify(seen), /grønt tun/);
});
