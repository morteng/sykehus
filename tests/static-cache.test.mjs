/* U3903: a versioned static file (?v=) is cached a year, immutable; an unversioned one is revalidated.
   node --test tests/static-cache.test.mjs */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const PORT = 9000 + Math.floor(Math.random() * 900), O = `http://localhost:${PORT}`;
const srv = spawn(process.execPath, [new URL("../server.mjs", import.meta.url).pathname], { env: { ...process.env, PORT: String(PORT) }, stdio: ["ignore", "pipe", "inherit"] });
await new Promise(ok => srv.stdout.on("data", d => String(d).includes("Sykehustomta on") && ok()));
after(() => srv.kill());
const get = p => fetch(O + p);

test("app.js with ?v= is immutable for a year", async () => {
  const r = await get("/app.js?v=abc"); assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "public, max-age=31536000, immutable");
});
test("app.js without ?v= is revalidated", async () => {
  const r = await get("/app.js"); assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "no-cache");
});
