/* U3619: each wall, roof and surface names its material: a wing's walls (edit wing / facade_material, «tegl på sørfasaden»), a pool's edge
   (surface / reshape coping_material, «kanten i betong»); the words people say resolve to the library's keys; the IFC names both as IfcMaterial.
   node --test tests/material-slot.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyEdits, checkEdit } from "../public/edits.js";
import { materialKey } from "../public/renderkit/materials.js";
import { parseIfc, withoutBuildings } from "../ifcfilter.mjs";
import { withAdded } from "../ifcadd.mjs";

const site0 = JSON.parse(readFileSync(new URL("../public/data/site.json", import.meta.url)));
const after = edits => applyEdits(site0, [], edits).site;
const check = (edits, e) => checkEdit(after(edits), [], e);
const sq = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const wing = site0.wings[0];

test("the words people use resolve to the library's keys", () => {
  assert.equal(materialKey("tegl"), "brick"); assert.equal(materialKey("Betong"), "concrete"); assert.equal(materialKey("wood"), "wood");
  assert.equal(materialKey("stål"), "steel"); assert.equal(materialKey("belegningsstein"), "paving"); assert.equal(materialKey("gull"), null);
});

test("a wing's walls: tegl is brick, kept on the wing; glass and unknown words are refused; \"\" takes it away", () => {
  const e = check([], { kind: "wing", wing: wing.id, field: "facade_material", value: "tegl", why: "ønske" });
  assert.equal(e.value, "brick");
  assert.equal(after([e]).wings[0].facade_material, "brick");
  assert.throws(() => check([], { ...e, value: "glass" }), /Fasadematerialet er ett av/);
  assert.throws(() => check([], { ...e, value: "gull" }), /Fasadematerialet er ett av/);
  assert.equal(check([], { ...e, value: "" }).value, "");
});

const pool = { kind: "surface", surface: "water", pool: true, ring: sq(60, 16, 10, 4), name: "Basseng", coping_material: "betong" };

test("a pool's edge: coping_material on the surface and by reshape; a word that is no edge is refused", () => {
  const e = check([], pool);
  assert.equal(e.coping_material, "concrete");
  const s = after([e]); assert.equal(s.landscape[0].coping_material, "concrete");
  const r = check([e], { kind: "reshape", id: "flate-1", coping_material: "tre" });
  assert.equal(after([e, r]).landscape[0].coping_material, "wood");
  assert.throws(() => check([], { ...pool, coping_material: "water" }), /Kantens materiale/);
});

test("the IFC names both materials: the brick wing and the concrete pool edge", () => {
  const base = parseIfc(readFileSync(new URL("../public/data/sykehus.ifc", import.meta.url), "utf8"));
  const m = after([check([], { kind: "wing", wing: wing.id, field: "facade_material", value: "tegl", why: "ønske" }), check([], pool)]);
  const { text } = withAdded(withoutBuildings(base, []).text, base, m, site0);
  assert.match(text, /=IFCMATERIAL\('Concrete'/, "concrete named");
  assert.match(text, /=IFCMATERIAL\('Brick'|=IFCMATERIAL\('Tegl'/i, "brick named");
  assert.match(text, /'Basseng \(kant\)'/);
});
