/* U3635: propose_sketch shows a plan before anything is built: nothing is saved, the page is told (sketch event with the
   frame in metres), the picture is kept for that person only. node --test tests/sketch.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.SYKEHUS_VERSIONS_DIR = mkdtempSync(join(tmpdir(), "sk-"));
import { createMcp } from "../mcp.mjs";

const site = JSON.parse(readFileSync(new URL("../public/data/site.json", import.meta.url))), floors = JSON.parse(readFileSync(new URL("../public/data/floors.json", import.meta.url))).floors;
const auth = { userOf: req => req.who ?? null };
test("propose_sketch draws the proposal, saves nothing, tells the page, and the picture is that person's only", async () => {
  const mcp = createMcp({ site, floors, docs: null, docUrl: f => f, SECURITY: {}, readJson: async () => ({}), auth, pages: { open: new Map(), show: () => false } }), events = [];
  mcp.setNotifier((person, event, data) => events.push({ person, event, data }));
  const tool = mcp.TOOLS.find(t => t.name === "propose_sketch");
  assert.ok(tool && /LARGE or UNCLEAR/.test(tool.description) && /Do NOT use it for a small clear edit/.test(tool.description), "says when to use it and when not");
  await assert.rejects(tool.run({ title: "x", edits: [{ kind: "volume" }] }, { who: null }), /logget inn/);
  const r = await tool.run({ title: "Drivhus på plenen", numbers: [{ label: "Sider", value: "3" }], edits: [{ kind: "volume", name: "Drivhus", shape: "box", from: [-46, -62], to: [-16, -62], width: 14, height: 4, material: "glass" }] }, { who: "testperson" });
  assert.equal(r._result.content[0].type, "image"); assert.equal(r._result.structuredContent.drawn, 1);
  const e = events.at(-1); assert.equal(e.person, "testperson"); assert.equal(e.event, "sketch");
  assert.deepEqual(e.data.numbers, [{ label: "Sider", value: "3" }]); assert.deepEqual(e.data.size, [1024, 640]); assert.ok(e.data.frame.k > 0 && e.data.frame.centre.length === 2);
  const get = (id, person) => { const out = {}; mcp.handleSketch({}, { writeHead: c => { out.code = c; }, end: b => { out.body = b; } }, `${id}.png`, person); return out; };
  const id = e.data.url.replace(/^api\/skisse\//, "").replace(/\.png$/, "");
  assert.equal(get(id, "testperson").code, 200); assert.equal(get(id, "testperson").body.subarray(1, 4).toString(), "PNG", "a PNG picture");
  assert.equal(get(id, "an-other").code, 404, "another person gets nothing"); assert.equal(get(id, null).code, 404);
  assert.match(e.data.legend, /^Nytt: .*Drivhus/, "a legend says what is new");
  const list = (person) => { const o = {}; mcp.handleSketches({}, { writeHead: c => { o.code = c; }, end: b => { o.body = JSON.parse(b); } }, person); return o; };
  assert.equal(list("testperson").body.sketches.at(-1).id, id, "a reload shows it again, from disk"); assert.equal(list("an-other").body.sketches.length, 0); assert.equal(list(null).code, 401);
  const bad = await tool.run({ title: "x", edits: [{ kind: "volume" }, { kind: "volume", name: "Hus", shape: "box", from: [-46, -62], to: [-16, -62], width: 14, height: 4 }] }, { who: "testperson" });
  assert.equal(bad._result.structuredContent.not_drawn.length, 1, "what could not be drawn is said, the rest is shown");
  await assert.rejects(tool.run({ title: "x", edits: [{ kind: "volume" }] }, { who: "testperson" }), /Ingen av endringene/);
});
