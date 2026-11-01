/* U3996: show_building asked for a still (still: true, picture: true) keeps the picture for that person only, tells the pill
   (pages.still) and does NOT move the page; without still the page moves as before; the still is not a plan card after a reload.
   node --test tests/still.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.SYKEHUS_VERSIONS_DIR = mkdtempSync(join(tmpdir(), "still-"));
import { createMcp } from "../mcp.mjs";

const site = JSON.parse(readFileSync(new URL("../public/data/site.json", import.meta.url))), floors = JSON.parse(readFileSync(new URL("../public/data/floors.json", import.meta.url))).floors;
const auth = { userOf: req => req.who ?? null };
const rig = () => { const calls = [], pages = { open: new Map(), show: v => (calls.push(["show", v]), true), still: (p, s) => (calls.push(["still", p, s]), true) };
  const mcp = createMcp({ site, floors, docs: null, docUrl: f => f, SECURITY: {}, readJson: async () => ({}), auth, pages }); return { mcp, calls, tool: mcp.TOOLS.find(t => t.name === "show_building") }; };
const get = (mcp, id, person) => { const o = {}; mcp.handleSketch({}, { writeHead: c => { o.code = c; }, end: b => { o.body = b; } }, `${id}.png`, person); return o; };

test("a still goes to the pill as a picture of this person's, and the page does not move", async () => {
  const { mcp, calls, tool } = rig();
  assert.ok(tool.schema.properties.still, "the schema takes still");
  const r = await tool.run({ wing: "Sentralblokka", from_direction: "S", picture: true, still: true }, { who: "testperson", headers: { host: "localhost:1" } });
  assert.equal(calls.length, 1); assert.equal(calls[0][0], "still"); assert.equal(calls[0][1], "testperson");
  const s = calls[0][2], id = /^api\/skisse\/([A-Za-z0-9_-]{8})\.png$/.exec(s.still)?.[1];
  assert.ok(id, "the address is the sketch route's, which the scaler path serves");
  assert.match(s.view.wing, /^sentralblokka$/i, "the view the button opens");
  assert.equal(get(mcp, id, "testperson").body.subarray(1, 4).toString(), "PNG"); assert.equal(get(mcp, id, "an-other").code, 404);
  assert.match(r._result.content.at(-1).text, /on a phone.*has not moved yet/);
  const o = {}; mcp.handleSketches({}, { writeHead: c => { o.code = c; }, end: b => { o.body = JSON.parse(b); } }, "testperson");
  assert.equal(o.body.sketches.length, 0, "a still is not a plan card after a reload");
});

test("without still the page moves; a still with no picture (a section) moves it too", async () => {
  const { calls, tool } = rig();
  await tool.run({ wing: "Sentralblokka", picture: true }, { who: "testperson", headers: { host: "localhost:1" } }); assert.equal(calls.at(-1)[0], "show");
  await tool.run({ wing: "Sentralblokka", mode: "tverrsnitt", picture: true, still: true }, { who: "testperson", headers: { host: "localhost:1" } }); assert.equal(calls.at(-1)[0], "show", "no picture was drawn: nothing to show first");
});

test("the pill draws the kit's still on a \"still\" event and moves the page only from the button", () => {
  const src = readFileSync(new URL("../public/anton.js", import.meta.url), "utf8");
  assert.match(src, /import \{ createStill \} from "\.\/kit\/still\.js"/); assert.match(src, /on\("still",/);
  assert.match(src, /createStill\(\{ src: `\$\{s\.still\}\?w=640`/, "the picture is asked for cut by the scaler");
  assert.match(src, /live: \(\) => \{[^}]*goShow\(s\.view/, "the button moves the page");
});
