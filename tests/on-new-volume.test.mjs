/* a roof part (a spire) stands on a new building by its id: on = «volum-1». node --test tests/on-new-volume.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkEdit, applyEdits } from "../public/edits.js";

const site = JSON.parse(readFileSync(new URL("../public/data/site.json", import.meta.url)));
const floors = JSON.parse(readFileSync(new URL("../public/data/floors.json", import.meta.url))).floors;
const add = (edits, e) => { const m = applyEdits(site, floors, edits); edits.push(checkEdit(m.site, m.floors, e)); return edits; };
const tower = { kind: "volume", id: "ntarn", name: "Tårn", shape: "box", material: "concrete", from: [-10, -80], to: [10, -80], width: 10, height: 12, base_kote: 20 };
const spire = { kind: "volume", id: "nspir", name: "Spir", shape: "pyramid", material: "steel", from: [-2, -80], to: [2, -80], width: 4, height: 6, on: "ntarn" };

test("a spire stands on a new building by its id, at the building's top", () => {
  const edits = add(add([], tower), spire), m = applyEdits(site, floors, edits), s = m.site.added.find(a => a.id === "nspir");
  assert.equal(edits[1].on, "ntarn");
  assert.equal(s.on, "ntarn");
  assert.equal(s.base_kote, 32, "20 + 12: the tower's top");
  assert.equal(s.top_kote, 38);
});
test("an on that is neither a wing nor a new volume is refused with both lists", () => {
  const edits = add([], tower), m = applyEdits(site, floors, edits);
  assert.throws(() => checkEdit(m.site, m.floors, { ...spire, on: "ingen" }), /id-en til et nytt volum \(ntarn\)/);
});
test("a reshape may move a spire onto a new building too", () => {
  const edits = add(add([], tower), { ...spire, on: undefined, from: [30, -80], to: [34, -80], base_kote: 20 }), m = applyEdits(site, floors, edits);
  edits.push(checkEdit(m.site, m.floors, { kind: "reshape", id: "nspir", on: "ntarn", from: [-2, -80], to: [2, -80] }));
  assert.equal(applyEdits(site, floors, edits).site.added.find(a => a.id === "nspir").base_kote, 32);
});

/* the catapult part's «bredde NaN»: a box with a side that is not a number is refused with the box, not turned into a volume of width NaN */
import { bimBody } from "../public/design.js";
test("bimBody gives numbers for a whole box and refuses a box with NaN", () => {
  const b = bimBody([0, 0], [10, 0], { min: [0, -2, 0], max: [10, 3, 4] });
  assert.deepEqual([b.width, b.height], [5, 4]);
  assert.throws(() => bimBody([0, 0], [10, 0], { min: [0, NaN, 0], max: [10, 3, 4] }), /Delens mål er ikke tall/);
  assert.throws(() => bimBody([0, 0], [10, 0], { min: [0, 0, 0] }), /Delens mål er ikke tall/);
});
