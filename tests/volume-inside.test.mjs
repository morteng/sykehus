/* U3838: a new building with storeys gets a plan per storey with walls and rooms. node --test tests/volume-inside.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkEdit, applyEdits } from "../public/edits.js";

const site = JSON.parse(readFileSync(new URL("../public/data/site.json", import.meta.url)));
const floors = JSON.parse(readFileSync(new URL("../public/data/floors.json", import.meta.url))).floors;
const mk = e => { const m = applyEdits(site, floors, []); return applyEdits(site, floors, [checkEdit(m.site, m.floors, e)]); };
const hus = { kind: "volume", id: "nhus", name: "Kasino", shape: "box", material: "concrete", from: [-10, -80], to: [14, -80], width: 10, storeys: 3, base_kote: 20 };

test("three storeys give three plans with an outer wall and rooms inside", () => {
  const m = mk(hus), mine = m.floors.filter(f => f.wing === m.site.added[0].id);
  assert.equal(m.floors.length, floors.length + 3);
  assert.deepEqual(mine.map(f => f.name), ["1. etasje", "2. etasje", "3. etasje"]);
  assert.deepEqual(mine.map(f => f.kote), [20, 23.2, 26.4]);
  assert.equal(mine[0].rooms.length, 4, "24 m long: four rooms of about 6 m");
  assert.equal(mine[0].walls.length, 4, "the outer wall and three dividers");
  assert.equal(mine[0].rooms[0].area_calc, 60);
  assert.match(mine[0].source, /Utkast/);
});
test("a building without storeys, and water, get no plans", () => {
  assert.equal(mk({ ...hus, storeys: undefined, height: 6 }).floors.length, floors.length);
  assert.equal(mk({ ...hus, material: "water", height: 0.5, storeys: undefined }).floors.length, floors.length);
});
test("taking the building down takes its plans away", () => {
  const m0 = applyEdits(site, floors, []), v = checkEdit(m0.site, m0.floors, hus), m = applyEdits(site, floors, [v]);
  const e = checkEdit(m.site, m.floors, { kind: "demolish", building: m.site.added[0].id });
  assert.equal(applyEdits(site, floors, [v, e]).floors.length, floors.length);
});
