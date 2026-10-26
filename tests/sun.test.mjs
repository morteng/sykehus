/* U3651: show_building's sun: the view the tool sends carries it, a saved view keeps it, a bad one is refused in words */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { sunOf, sunIn, sunDate, sunFromDay, sunDay, sunLabel, SUN_DEFAULT } from "../public/sunpick.js";

const dir = mkdtempSync(join(tmpdir(), "sykehus-sun-")), secret = "proxy-secret-for-tests-0123456789", PORT = 9100 + Math.floor(Math.random() * 800);
const O = `http://localhost:${PORT}`, lars = { "remote-user": "lars", "x-sykehus-proxy-auth": secret };
const srv = spawn(process.execPath, [new URL("../server.mjs", import.meta.url).pathname], { env: { ...process.env, PORT: String(PORT), SYKEHUS_VERSIONS_DIR: join(dir, "v"), SYKEHUS_PROXY_SECRET: secret, DOCS: "" }, stdio: ["ignore", "pipe", "inherit"] });
await new Promise(ok => srv.stdout.on("data", d => String(d).includes("Sykehustomta on") && ok()));
after(() => srv.kill());
const rpc = async (method, params) => (await (await fetch(O + "/mcp", { method: "POST", headers: { "content-type": "application/json", ...lars }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })).json()).result;
const call = (name, args) => rpc("tools/call", { name, arguments: args });
const text = r => r.content.filter(c => c.type === "text").map(c => c.text).join(" ");

test("sunOf: an object or an Oslo-time ISO string; a date that is not one is refused in words", () => {
  assert.deepEqual(sunOf({ month: 12, day: 21, hour: 15 }), { sunM: 12, sunD: 21, sunH: 15 });
  assert.deepEqual(sunOf("2026-12-21T15:30:00+01:00"), { sunM: 12, sunD: 21, sunH: 15.5 });
  assert.deepEqual(sunOf({ month: 6, day: 21 }), SUN_DEFAULT);
  assert.throws(() => sunOf({ month: 13, day: 1, hour: 1 }), /finnes ikke/); assert.throws(() => sunOf("i morgen"), /Sola kan ikke leses/);
  const winter = sunDate({ sunM: 12, sunD: 21, sunH: 15 }, 2026); assert.equal(winter.toISOString(), "2026-12-21T14:00:00.000Z", "15 in Oslo is 14 UTC in winter");
  assert.equal(sunDate(SUN_DEFAULT, 2026).toISOString(), "2026-06-21T12:00:00.000Z", "14 in Oslo is 12 UTC in summer");
  assert.deepEqual(sunFromDay(sunDay({ sunM: 12, sunD: 21 }), 15), { sunM: 12, sunD: 21, sunH: 15 }); assert.equal(sunLabel({ sunM: 12, sunD: 21, sunH: 15.5 }), "21. desember kl. 15:30");
  assert.equal(sunIn({ sunM: 1, sunD: 2 }), null);
});

test("show_building: the view in the event carries the sun, a saved view keeps it, the tool says how to ask", async () => {
  const tool = (await rpc("tools/list")).tools.find(t => t.name === "show_building");
  assert.match(tool.description, /21\. desember kl\. 15/); assert.match(tool.description, /sommerkveld/); assert.ok(tool.inputSchema.properties.sun);
  await call("try_change", { edits: [{ kind: "demolish", building: "Midtfløy", why: "test" }], include_screenshot: false });
  const a = await call("show_building", { mode: "3d", sun: { month: 12, day: 21, hour: 15 }, save_as: "Vinterkveld" });
  assert.ok(!a.isError, text(a)); assert.deepEqual([a.structuredContent.view.sunM, a.structuredContent.view.sunD, a.structuredContent.view.sunH], [12, 21, 15]);
  const b = await call("show_building", { saved_view: "vinterkveld" });
  assert.deepEqual([b.structuredContent.view.sunM, b.structuredContent.view.sunD, b.structuredContent.view.sunH], [12, 21, 15], "the saved view opens with its light");
  const c = await call("show_building", { mode: "plan" }); assert.equal(c.structuredContent.view.sunM, undefined, "no sun asked, none sent: the page keeps its light");
  const bad = await call("show_building", { sun: { month: 2, day: 40, hour: 1 } }); assert.equal(bad.isError, true); assert.match(text(bad), /finnes ikke/);
});
