/* U6011: the testperson login is read-only: try_change as testperson is refused, a look works.   node --test tests/readonly-login.test.mjs */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
const secret = "proxy-secret-for-tests-0123456789", PORT = 8000 + Math.floor(Math.random() * 900);
const srv = spawn(process.execPath, [new URL("../server.mjs", import.meta.url).pathname], { env: { ...process.env, PORT: String(PORT), SYKEHUS_PROXY_SECRET: secret, DOCS: "" }, stdio: ["ignore", "pipe", "inherit"] });
await new Promise(ok => srv.stdout.on("data", d => String(d).includes("Sykehustomta on") && ok()));
after(() => srv.kill());
let n = 0;
const call = async (name, args, user) => { const r = await fetch(`http://localhost:${PORT}/mcp`, { method: "POST", headers: { "content-type": "application/json", "x-edge-auth": secret, "remote-user": user }, body: JSON.stringify({ jsonrpc: "2.0", id: ++n, method: "tools/call", params: { name, arguments: args } }) }); const c = (await r.json()).result; return { isError: !!c?.isError, text: c?.content?.[0]?.text }; };
const edit = { edits: [{ kind: "demolish", building: "Østfløy" }], include_screenshot: false };
test("testperson: try_change is refused, a look is allowed", async () => {
  const r = await call("try_change", edit, "testperson"); assert.equal(r.isError, true); assert.match(r.text, /kan bare se/);
  assert.equal((await call("about_site", {}, "testperson")).isError, false);
  assert.equal((await call("try_change", edit, "lars")).isError, false, "another login still changes");
});
