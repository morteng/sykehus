/* A constructed part (the Pariserhjul, a pool, a glass roof) goes at once on «Riv», and an unchanged one is not drawn again */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { planAdded } from "../public/added-cache.js";
import { applyEdits } from "../public/edits.js";

const src = f => readFileSync(new URL(f, import.meta.url), "utf8");

test("setGone hides the new buildings' groups too, by id (a construction's sub-meshes are the group's children)", () => {
  const v = src("../public/viewer.js"), body = v.slice(v.indexOf("function setGone(ids)"), v.indexOf("const followers"));
  assert.match(body, /for \(const \[id, g\] of addedGroups\) g\.visible = !goneIds\.has\(id\)/);
  /* and the picked one is let go when it is gone, as a building is */
  assert.match(body, /selected && goneIds\.has\(selected\)\) select\(null\)/);
});

test("the unchanged constructions keep their groups; only the changed and the new are drawn, the gone dropped", () => {
  const a = { id: "nhjul", shape: "bim", bim: { sha: "s1" } }, b = { id: "npool", shape: "bim", bim: { sha: "s2" } };
  const first = planAdded(new Map(), [a, b]);
  assert.deepEqual([first.draw, first.keep, first.drop], [["nhjul", "npool"], [], []]);
  const del = planAdded(first.keys, [b]);                        // the wheel is torn down
  assert.deepEqual([del.draw, del.keep, del.drop], [[], ["npool"], ["nhjul"]]);
  const mv = planAdded(first.keys, [a, { ...b, from: [1, 2] }]);  // the pool moved
  assert.deepEqual([mv.draw, mv.keep, mv.drop], [["npool"], ["nhjul"], ["npool"]]);
  const same = planAdded(first.keys, [a, b]);
  assert.deepEqual([same.draw, same.drop], [[], []]);
});

test("demolishing a constructed volume takes it out of the after and leaves the others as they were", () => {
  const site = { buildings: [], wings: [], facades: [], terrain: null }, vol = id => ({ kind: "volume", id, name: id, shape: "box", from: [0, 0], to: [10, 0], width: 5, height: 3, base_kote: 1, material: "concrete" });
  const m = applyEdits(site, [], [vol("nhjul"), vol("npool"), { kind: "demolish", building: "nhjul", why: "x" }]);
  assert.deepEqual(m.site.added.map(x => x.id), ["npool"]);
  const k0 = planAdded(new Map(), applyEdits(site, [], [vol("nhjul"), vol("npool")]).site.added).keys;
  const p = planAdded(k0, m.site.added);
  assert.deepEqual([p.draw, p.keep, p.drop], [[], ["npool"], ["nhjul"]]);   // no rebuild of the one that stayed
});

test("applyEdits's walls and rooms inside a torn-down ring: the box test changes no answer", () => {
  const ring = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const site = { buildings: [{ id: "b1", ring, wing: null, area_m2: 100 }, { id: "b2", ring: [[50, 50], [60, 50], [60, 60], [50, 60]], wing: null }], wings: [], facades: [] };
  const floors = [{ id: "f", name: "1", walls: [[[5, 5], [6, 6]], [[20, 20], [21, 21]]], rooms: [{ at: [5, 5] }, { at: [30, 30] }] }];
  const m = applyEdits(site, floors, [{ kind: "demolish", building: "b1", why: "x" }]);
  assert.deepEqual(m.floors[0].walls, [[[20, 20], [21, 21]]]);
  assert.deepEqual(m.floors[0].rooms, [{ at: [30, 30] }]);
});

test("the page's own change skips the fit and the rules only Anton reads", () => {
  const m = src("../mcp.mjs");
  assert.match(m, /include_screenshot: false, fromPage: true/);
  assert.match(m, /const fit0 = quiet \? \[\] : fitOf\(m\.site\)/);
  assert.match(m, /const fit = quiet \? \[\] : /);
});
