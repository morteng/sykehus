/* U3920: the sykehus module answers under bygg.gulden.no/sykehus as well as at its own root. The prefix is taken off, the OAuth
   metadata and the sign-in names carry it, /mcp answers under it, and the bare /sykehus goes to /sykehus/.
   node --test tests/bygg-mount.test.mjs */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const dir = mkdtempSync(join(tmpdir(), "sykehus-mount-")), PORT = 9000 + Math.floor(Math.random() * 900);
const srv = spawn(process.execPath, [new URL("../server.mjs", import.meta.url).pathname], { env: { ...process.env, PORT: String(PORT), SYKEHUS_VERSIONS_DIR: dir, PUBLIC_ORIGIN: "https://bygg.example" }, stdio: ["ignore", "pipe", "inherit"] });
await new Promise(ok => srv.stdout.on("data", d => String(d).includes("Sykehustomta on") && ok()));
after(() => srv.kill());
const O = `http://localhost:${PORT}`;

test("the page and the data answer under /sykehus and at the root", async () => {
  for (const p of ["/", "/sykehus/", "/sykehus/data/site.json"]) assert.equal((await fetch(O + p)).status, 200, p);
  assert.equal((await fetch(O + "/sykehus/api/meg")).status, 200);
});

test("bare /sykehus is forwarded to /sykehus/ (query kept)", async () => {
  const r = await fetch(O + "/sykehus?v=abc", { redirect: "manual" });
  assert.equal(r.status, 308); assert.equal(r.headers.get("location"), "/sykehus/?v=abc");
});

test("OAuth metadata under the mount names the mount; at the root it does not", async () => {
  const m = await (await fetch(O + "/sykehus/.well-known/oauth-authorization-server")).json();
  assert.equal(m.issuer, "https://bygg.example/sykehus"); assert.equal(m.token_endpoint, "https://bygg.example/sykehus/oauth/token");
  const r = await (await fetch(O + "/.well-known/oauth-authorization-server")).json();
  assert.equal(r.issuer, "https://bygg.example");
  const pr = await (await fetch(O + "/sykehus/.well-known/oauth-protected-resource/mcp")).json();
  assert.equal(pr.resource, "https://bygg.example/sykehus/mcp");
});

test("the connector answers a JSON-RPC POST under /sykehus/mcp", async () => {
  const r = await fetch(O + "/sykehus/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
  assert.equal(r.status, 200); assert.ok(JSON.parse(await r.text()).result.tools.length > 10);
});

test("the path-inserted well-known form (RFC 9728/8414) names the mount (U4234)", async () => {
  const pr = await (await fetch(O + "/.well-known/oauth-protected-resource/sykehus/mcp")).json();
  assert.equal(pr.resource, "https://bygg.example/sykehus/mcp");
  const as = await (await fetch(O + "/.well-known/oauth-authorization-server/sykehus")).json();
  assert.equal(as.issuer, "https://bygg.example/sykehus");
});
