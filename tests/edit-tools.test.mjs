/* Anton's editing tools (wish wI1HCE_s0yC): move, turn and resize by id, copy, groups, castle parts, the short list and a preview that saves nothing.
   The server end to end, as a chat app calls it.   node --test tests/edit-tools.test.mjs */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { applyEdits } from "../public/edits.js";
import { volumesOf, expandChange, needsExpand, CASTLE } from "../editkit.mjs";

const PORT = 19000 + Math.floor(Math.random() * 900), BASE = `http://localhost:${PORT}`;
let srv, id = 0;
before(async () => {
  srv = spawn(process.execPath, [new URL("../server.mjs", import.meta.url).pathname], { env: { ...process.env, PORT: String(PORT) }, stdio: ["ignore", "pipe", "inherit"] });
  await new Promise((ok, no) => { srv.stdout.on("data", d => String(d).includes("Sykehustomta on") && ok()); srv.on("exit", c => no(new Error("server exited " + c))); });
});
after(() => srv?.kill());
const call = async (name, args = {}) => {
  const r = await (await fetch(`${BASE}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method: "tools/call", params: { name, arguments: args } }) })).json();
  return { ...r.result, data: r.result?.structuredContent };
};
const site = JSON.parse(readFileSync(new URL("../public/data/site.json", import.meta.url))), floors = JSON.parse(readFileSync(new URL("../public/data/floors.json", import.meta.url))).floors;
const house = (idn, x, extra = {}) => ({ kind: "volume", id: idn, name: `Hus ${idn}`, shape: "box", from: [x, -70], to: [x + 8, -70], width: 6, height: 4, ...extra });
const mk = async (edits, draft) => (await call("try_change", { edits, include_screenshot: false, ...(draft ? { draft } : {}) })).data;
const built = async draft => (await call("show_draft", { draft })).data.after.built;
const near = (a, b, e = 0.02) => Math.abs(a - b) <= e;

test("reshape shift moves a building by its id; the id, the size and the place follow", async () => {
  const t = await mk([house("nhus1", -60)]);
  const r = await mk([{ kind: "reshape", id: "nhus1", shift: [5, 3] }], t.draft);
  assert.equal(r.applied, 1, JSON.stringify(r.rejected));
  const b = (await built(t.draft)).find(x => x.id === "nhus1");
  assert.deepEqual([b.from, b.to], [[-55, -67], [-47, -67]]);
});

test("reshape length keeps the middle; turn 90 degrees turns about the middle, counter-clockwise from above", async () => {
  const t = await mk([house("nhus2", -60)]);   // middle (-56, -70), length 8
  await mk([{ kind: "reshape", id: "nhus2", length: 12 }], t.draft);
  let b = (await built(t.draft)).find(x => x.id === "nhus2");
  assert.deepEqual([b.from, b.to], [[-62, -70], [-50, -70]]);
  await mk([{ kind: "reshape", id: "nhus2", turn: 90 }], t.draft);
  b = (await built(t.draft)).find(x => x.id === "nhus2");
  assert.ok(near(b.from[0], -56) && near(b.from[1], -76) && near(b.to[0], -56) && near(b.to[1], -64), JSON.stringify([b.from, b.to]));   // east axis turned to north: from is south of the middle now
});

test("clone: a new id, the same shape, offset; count makes a row", async () => {
  const t = await mk([house("nhus3", -60, { material: "brick", height: 7 })]);
  const r = await mk([{ kind: "clone", id: "nhus3", offset: [0, 10], count: 3, name: "Rekke" }], t.draft);
  assert.equal(r.applied, 3, JSON.stringify(r.rejected));
  const all = await built(t.draft), rows = all.filter(x => x.name === "Rekke");
  assert.equal(rows.length, 3); assert.equal(new Set(all.map(x => x.id)).size, 4, "every copy has its own id");
  assert.deepEqual(rows.map(x => x.from[1]).sort((a, b) => a - b), [-60, -50, -40]);
  for (const x of rows) { assert.equal(x.material, "brick"); assert.equal(x.height, 7); assert.equal(x.width, 6); }
});

test("group: members move and turn together by the group's name, and a group is copied as one", async () => {
  const t = await mk([house("ngruppea", -60), house("ngruppeb", -40)]);
  const g = await mk([{ kind: "group", name: "Rad", ids: ["ngruppea", "ngruppeb"] }], t.draft);
  assert.equal(g.applied, 2, JSON.stringify(g.rejected));
  assert.deepEqual((await built(t.draft)).map(x => x.group), ["Rad", "Rad"]);
  await mk([{ kind: "reshape", id: "Rad", shift: [0, 20] }], t.draft);
  assert.deepEqual((await built(t.draft)).map(x => x.from[1]), [-50, -50]);
  await mk([{ kind: "reshape", id: "Rad", turn: 180 }], t.draft);   // about the group's middle (-46, -50): the first one's middle (-56) goes to -36, the second's (-36) to -56
  const mids = (await built(t.draft)).map(x => (x.from[0] + x.to[0]) / 2);
  assert.ok(near(mids[0], -36) && near(mids[1], -56), mids.join());
  const c = await mk([{ kind: "clone", id: "Rad", offset: [0, 30] }], t.draft);
  assert.equal(c.applied, 2, JSON.stringify(c.rejected));
  const all = await built(t.draft); assert.equal(all.length, 4); assert.deepEqual([...new Set(all.map(x => x.group))].sort(), ["Rad", "Rad (kopi 1)"]);
  const bad = await mk([{ kind: "reshape", id: "Rad", length: 5 }], t.draft); assert.match(bad.reason || JSON.stringify(bad.rejected), /length gjelder ett bygg/);
});

test("a move of an id that does not exist is refused with the ids there are", async () => {
  const t = await mk([house("nhus4", -60)]), r = await mk([{ kind: "reshape", id: "nope", shift: [1, 1] }], t.draft);
  assert.equal(r.applied, 0); assert.match(JSON.stringify(r.rejected), /Fant ikke «nope».*nhus4/);
});

test("list_parts has the castle parts, and each makes volumes in one group on a stacked foot", async () => {
  const lp = (await call("list_parts")).data.parts.map(p => p.part);
  for (const n of ["castle_tower", "castle_wall", "castle_gatehouse"]) assert.ok(lp.includes(n), n);
  const t = await mk([{ kind: "part", part: "castle_tower", name: "Tårn A", from: [-60, -70], to: [-54, -70], params: { height: 12, spire_height: 5 } }]);
  assert.equal(t.applied, 2, JSON.stringify(t.rejected));
  const [body, spire] = await built(t.draft);
  assert.equal(body.group, "Tårn A"); assert.equal(spire.group, "Tårn A"); assert.equal(spire.shape, "pyramid");
  assert.ok(near(spire.base_kote, body.base_kote + 12, 0.11), `spire foot ${spire.base_kote} on ${body.base_kote} + 12`);
  assert.equal(spire.height, 5);
  /* the group moves as one */
  await mk([{ kind: "reshape", id: "Tårn A", shift: [10, 0] }], t.draft);
  const moved = await built(t.draft); assert.deepEqual(moved.map(x => x.from[0]), [-50, -50]);
  const wall = await mk([{ kind: "part", part: "castle_wall", from: [-40, -70], to: [-16, -70], params: { merlons: 6 } }]);
  assert.equal(wall.applied, 7, JSON.stringify(wall.rejected));   // the wall and six battlements
  const gate = await mk([{ kind: "part", part: "castle_gatehouse", from: [-10, -70], to: [4, -70], params: { passage_width: 4 } }]);
  assert.equal(gate.applied, 3, JSON.stringify(gate.rejected));
  const gb = await built(gate.draft); assert.ok(near(gb[2].base_kote, gb[0].base_kote + 4, 0.11) && gb[2].height === 6, "the lintel stands over the passage");
  const bad = await mk([{ kind: "part", part: "castle_tower", from: [-60, -70], to: [-54, -70], params: { colour: 3 } }]);
  assert.match(bad.reason, /tar ikke colour/);
});

test("a stacked part keeps its foot in the unit: expandChange gives the same edits the server stores", () => {
  const e = { kind: "part", part: "castle_tower", from: [-60, -70], to: [-54, -70] };
  assert.ok(needsExpand(e) && !needsExpand({ kind: "part", part: "stair" }) && !needsExpand({ kind: "reshape", id: "x", height: 3 }));
  const xs = expandChange(e, [], applyEdits(site, floors, []).site);
  assert.deepEqual(xs.map(x => x.shape), ["box", "pyramid"]); assert.equal(Object.keys(CASTLE).length, 3);
  assert.equal(volumesOf([house("a", 0), { kind: "reshape", id: "a", height: 9 }, house("b", 20), { kind: "demolish", building: "b" }]).get("a").height, 9);
});

test("show_draft brief: one short line per new building with id, group, place and size", async () => {
  const t = await mk([house("nhus5", -60, { material: "brick" }), house("nhus6", -40)]);
  await mk([{ kind: "group", name: "Par", ids: ["nhus5", "nhus6"] }], t.draft);
  const b = (await call("show_draft", { draft: t.draft, brief: true })).data;
  assert.equal(b.total, 2); assert.equal(b.built.length, 2); assert.deepEqual(b.groups, { Par: ["nhus5", "nhus6"] });
  assert.match(b.built[0], /^nhus5 «Hus nhus5» box brick, gruppe «Par»: midt \(-56, -70\), 8×6×4 m, fot /);
  assert.ok(JSON.stringify(b).length < 1500, "small enough for a chat turn");
  assert.equal(b.changes, undefined, "no change list, no after");
});

test("preview: everything runs and is checked, nothing is saved", async () => {
  const t = await mk([house("nhus7", -60)]);
  const p = (await call("try_change", { edits: [house("nhus8", -40), { kind: "reshape", id: "nhus7", shift: [0, 9] }], draft: t.draft, preview: true, include_screenshot: false })).data;
  assert.equal(p.preview, true); assert.equal(p.saved, false); assert.equal(p.applied, 2, JSON.stringify(p.rejected)); assert.match(p.note, /ingenting er lagret/);
  assert.equal((await built(t.draft)).length, 1, "the draft still has one building");
  assert.deepEqual((await built(t.draft))[0].from, [-60, -70], "and it did not move");
  const bad = (await call("try_change", { edits: [{ kind: "reshape", id: "nope", height: 3 }], draft: t.draft, preview: true, include_screenshot: false })).data;
  assert.equal(bad.applied, 0, "a preview is refused as the real call is");
  const fresh = (await call("try_change", { edits: [house("nhus9", -60)], preview: true, include_screenshot: false })).data;
  assert.equal(fresh.applied, 1); assert.equal(fresh.draft, undefined, "a preview with no draft makes none");
});
