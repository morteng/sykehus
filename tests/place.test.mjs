/* U3783: a part placed from a wing's real facade (at), through try_change as Anton calls it */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const dir = mkdtempSync(join(tmpdir(), "sykehus-place-")), secret = "proxy-secret-for-tests-0123456789", PORT = 9100 + Math.floor(Math.random() * 800);
const O = `http://localhost:${PORT}`;
const srv = spawn(process.execPath, [new URL("../server.mjs", import.meta.url).pathname], { env: { ...process.env, PORT: String(PORT), SYKEHUS_VERSIONS_DIR: join(dir, "v"), SYKEHUS_PROXY_SECRET: secret }, stdio: ["ignore", "pipe", "inherit"] });
await new Promise(ok => srv.stdout.on("data", d => String(d).includes("Sykehustomta on") && ok()));
after(() => srv.kill());
const call = async (name, args) => (await (await fetch(O + "/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) })).json()).result;
const put = at => call("try_change", { edits: [{ kind: "volume", name: "Drivhus", shape: "gable", at, length: 6, width: 4, height: 3, material: "glass", why: "test" }], include_screenshot: false });

test("sør of Sentralblokka (turned: the long face is 120°, the end 210°) asks which, in plain Norwegian", async () => {
  const r = await put({ wing: "Sentralblokka", side: "sør", gap_m: 4 });
  const bad = r.structuredContent?.rejected?.[0]?.error ?? r.content.map(c => c.text).join(" ");
  assert.match(bad, /står skjevt|ingen fasade/);
});

test("by bearing: the part is parallel to the facade, centred, gap_m off it, and the answer names facade and gap", async () => {
  const about = (await call("about_wing", { wing: "Sentralblokka" })).structuredContent;
  const f = about.facade_bearings.sort((a, b) => b.length_m - a.length_m)[0];
  const r = (await put({ wing: "Sentralblokka", side: f.bearing, gap_m: 4.9 })).structuredContent;
  const e = r.edits?.[0] ?? r.ok?.[0] ?? r.changes?.[0]; const placed = JSON.stringify(r);
  assert.match(placed, /4,9 m fra Sentralblokkas \S*fasade/);
  const b = (f.bearing * Math.PI) / 180, n = [Math.sin(b), Math.cos(b)];
  const added = (await call("show_draft", { target: r.draft })).structuredContent;
  const v = JSON.stringify(added).match(/"from":\[([-\d.]+),([-\d.]+)\],"to":\[([-\d.]+),([-\d.]+)\]/);
  assert.ok(v, "the stored edit has from and to");
  const [x0, y0, x1, y1] = v.slice(1).map(Number), L = Math.hypot(x1 - x0, y1 - y0);
  assert.ok(Math.abs(L - 6) < 0.05, `length ${L}`);
  assert.ok(Math.abs((x1 - x0) * n[0] + (y1 - y0) * n[1]) < 0.3, "parallel to the facade (the line is across the normal; the facade bearing is to 5°)");
  /* the near edge is gap_m off the longest wall facing that way */
  const site = JSON.parse(readFileSync(new URL("../public/data/site.json", import.meta.url)));
  /* the near edge's middle is gap_m from the wing's nearest wall (the clearance from the outermost one) */
  const mx = (x0 + x1) / 2 - n[0] * 2, my = (y0 + y1) / 2 - n[1] * 2;   // the middle line, 2 m (width / 2) back to the near edge
  const seg = (q) => { const [ax, ay, bx, by] = q, dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((mx - ax) * dx + (my - ay) * dy) / (dx * dx + dy * dy))); return Math.hypot(mx - ax - t * dx, my - ay - t * dy); };
  const dist = Math.min(...site.buildings.filter(x => x.wing === "sentralblokka").flatMap(x => x.walls).map(seg));
  assert.ok(Math.abs(dist - 4.9) < 0.5, `gap ${dist}`);
  assert.equal(JSON.stringify(added).includes('"at"'), false, "stored as from and to, not at");
});

test("a bad side gives a plain Norwegian error", async () => {
  const r = await put({ wing: "Sentralblokka", side: "oppover", gap_m: 4 });
  const bad = JSON.stringify(r);
  assert.match(bad, /er ikke en retning/);
});
