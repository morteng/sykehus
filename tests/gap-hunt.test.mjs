/* U4272: a bad argument to a read tool is a plain Norwegian tool error, not a silent empty answer. */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const PORT = 19000 + Math.floor(Math.random() * 1000), BASE = `http://localhost:${PORT}`;
let srv;
before(async () => {
  srv = spawn(process.execPath, [new URL("../server.mjs", import.meta.url).pathname], { env: { ...process.env, PORT: String(PORT) }, stdio: ["ignore", "pipe", "inherit"] });
  await new Promise((ok, no) => { srv.stdout.on("data", d => String(d).includes("Sykehustomta on") && ok()); srv.on("exit", c => no(new Error("server exited " + c))); });
});
after(() => srv?.kill());
const call = async (name, args) => {
  const r = await fetch(`${BASE}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) });
  return (await r.json()).result;
};

test("list_versions: a non-string owner is a Norwegian tool error", async () => {
  for (const owner of [5, true, { a: 1 }, ["x"]]) {
    const r = await call("list_versions", { owner });
    assert.equal(r.isError, true, JSON.stringify(owner));
    assert.match(r.content[0].text, /owner må være tekst/);
  }
  assert.notEqual((await call("list_versions", {})).isError, true);
});
