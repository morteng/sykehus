/* U3557: Anton sees his own work. try_change hands back a picture of the model after it and how each new building
   sits (fit); look gives a picture from any side; the page's own changes get no picture. The new shapes: pyramid,
   terraces, and a volume on a wing's roof. */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { applyEdits, checkEdit } from "../public/edits.js";
import { fitOf } from "../public/design.js";
import { aimAt } from "../public/renderkit/look.js";

const dir = mkdtempSync(join(tmpdir(), "sykehus-look-")), secret = "proxy-secret-for-tests-0123456789", PORT = 9100 + Math.floor(Math.random() * 800);
const O = `http://localhost:${PORT}`, lars = { "remote-user": "lars", "x-sykehus-proxy-auth": secret };
const srv = spawn(process.execPath, [new URL("../server.mjs", import.meta.url).pathname], { env: { ...process.env, PORT: String(PORT), SYKEHUS_VERSIONS_DIR: join(dir, "v"), SYKEHUS_PROXY_SECRET: secret, DOCS: "" }, stdio: ["ignore", "pipe", "inherit"] });
await new Promise(ok => srv.stdout.on("data", d => String(d).includes("Sykehustomta on") && ok()));
after(() => srv.kill());
const call = async (name, args, h = {}) => (await (await fetch(O + "/mcp", { method: "POST", headers: { "content-type": "application/json", ...h }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) })).json()).result;
const isPng = c => c.type === "image" && c.mimeType === "image/png" && Buffer.from(c.data, "base64").subarray(1, 4).toString() === "PNG";

const site = JSON.parse(readFileSync(new URL("../public/data/site.json", import.meta.url))), floors = JSON.parse(readFileSync(new URL("../public/data/floors.json", import.meta.url))).floors;
const sb = aimAt(site, "Sentralblokka").target;
const pyramid = { kind: "volume", id: "npyr01", name: "Drivhus", shape: "pyramid", from: [sb[0] - 8, sb[1] - 60], to: [sb[0] + 8, sb[1] - 60], width: 16, height: 9, material: "glass" };

test("try_change: the picture after it, and fit for each new building", async () => {
  const r = await call("try_change", { edits: [pyramid] });
  assert.ok(r.content.some(isPng), "a PNG comes back");
  const out = r.structuredContent; assert.equal(out.added.length, 1);
  const f = out.fit.find(x => x.id === "npyr01"); assert.match(f.stands_on, /^på bakken/); assert.ok(Array.isArray(f.overlaps) && f.nearest.length);
  assert.equal(out.after.built[0].volume_m3, Math.round(16 * 16 * 9 / 3));
  const quiet = await call("try_change", { edits: [{ ...pyramid, id: "npyr02" }], include_screenshot: false });
  assert.ok(!quiet.content.some(c => c.type === "image"));
});

test("look: a picture from a side, aimed at a building; an unknown one is an error", async () => {
  const r = await call("look", { view_name: "S", focus: "Sentralblokka", width: 480, height: 320 });
  assert.ok(isPng(r.content[0])); assert.match(r.content[1].text, /sett fra sør.*Sentralblokka i oransje/);
  assert.equal((await call("look", { focus: "Ingenting" })).isError, true);
});

test("the page's own change gets no picture", async () => {
  const r = await fetch(O + "/api/endring", { method: "POST", headers: { "content-type": "application/json", ...lars }, body: JSON.stringify({ edits: [{ kind: "demolish", building: "Østfløy" }] }) });
  assert.equal(r.status, 200); const j = await r.json(); assert.ok(!j._result && !j.content);
});

test("shapes: terraces step back, a volume on a roof stands on it, a floating one says so", () => {
  const ost = aimAt(site, "Østfløy").target, edits = [];
  for (const e of [{ kind: "volume", id: "nter01", name: "Terrasser", shape: "terraces", steps: 4, step_depth: 4, from: [30, -90], to: [60, -70], width: 20, height: 12.8, material: "concrete" },
    { kind: "volume", id: "ntak01", name: "Takhage", shape: "box", on: "Østfløy", from: [ost[0] - 5, ost[1]], to: [ost[0] + 5, ost[1]], width: 6, height: 3 },
    { kind: "volume", id: "nsvev1", name: "Svever", shape: "box", from: [sb[0] - 5, sb[1] - 80], to: [sb[0] + 5, sb[1] - 80], width: 6, height: 3, base_kote: 90 }]) {
    const m = applyEdits(site, floors, edits); edits.push(checkEdit(m.site, m.floors, e));
  }
  const m = applyEdits(site, floors, edits), t = m.site.added.find(a => a.id === "nter01");
  assert.equal(t.parts.length, 4); assert.deepEqual(t.parts.map(p => Math.round(Math.abs(p.profile[1][0] - p.profile[0][0]))), [20, 16, 12, 8]);
  const fit = fitOf(m.site);
  assert.match(fit.find(x => x.id === "ntak01").stands_on, /^på taket til Østfløy/);
  assert.ok(!fit.find(x => x.id === "ntak01").overlaps.some(o => o.with === "Østfløy"));
  assert.match(fit.find(x => x.id === "nsvev1").stands_on, /svever/);
  assert.throws(() => checkEdit(site, floors, { kind: "volume", shape: "box", on: "Østfløy", from: [-300, -300], to: [-290, -300], width: 4, height: 3 }), /står ikke på taket/);
  assert.throws(() => checkEdit(site, floors, { kind: "volume", shape: "terraces", steps: 5, step_depth: 5, from: [0, 0], to: [10, 0], width: 12, height: 10 }), /øverste uten bredde/);
});
