/* A volume of water fills a basin (Anton 2026-10-27: «verktøyet har ingen vanndel for takbasseng»). node --test tests/water-volume.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyEdits, checkEdit } from "../public/edits.js";
import { roofOf } from "../public/roof.js";
import { withGarden } from "../lookglue.mjs";

const site = JSON.parse(readFileSync(new URL("../public/data/site.json", import.meta.url))), floors = JSON.parse(readFileSync(new URL("../public/data/floors.json", import.meta.url))).floors;
const R = roofOf(site, "sentralblokka"), big = R.blocks.find(b => b.kote === 69.91 && b.length_m > 90), c = big.corners;
const lerp = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t], at = (u, v) => lerp(lerp(c[0], c[1], u), lerp(c[3], c[2], u), v), r2 = p => p.map(x => +x.toFixed(2));
const vol = (o) => ({ kind: "volume", shape: "box", on: "sentralblokka", from: r2(at(0.2, 0.5)), to: r2(at(0.3, 0.5)), width: 6, base_kote: 69.91, ...o });
const make = list => { const ed = []; for (const e of list) { const m = applyEdits(site, floors, ed); ed.push(checkEdit(m.site, m.floors, e)); } return applyEdits(site, floors, ed); };

test("a volume of water is accepted and added with material water", () => {
  const m = make([vol({ name: "Vann", id: "nvann1", height: 1, material: "water" })]), a = m.site.added.find(x => x.id === "nvann1");
  assert.equal(a.material, "water"); assert.ok(a.parts.every(p => p.mat === "water"));
});
test("water in a concrete basin on the same roof needs no allow_overlap", () => {
  const m = make([vol({ name: "Basseng", id: "nbass1", height: 1.2, material: "concrete" }), vol({ name: "Vann", id: "nvann2", height: 0.8, material: "water", width: 4 })]);
  assert.deepEqual(m.site.added.map(x => x.id), ["nbass1", "nvann2"]);
});
test("a glass bottom, 10 cm, under the water is accepted", () => {
  const m = make([vol({ name: "Bunn", id: "nbunn1", height: 0.1, material: "glass" }), vol({ name: "Vann", id: "nvann4", height: 1, material: "water", base_kote: 70.01 })]);
  assert.deepEqual(m.site.added.map(x => x.material), ["glass", "water"]);
});
test("water is still two water volumes that meet = refused; water clearly off the roof is refused", () => {
  assert.throws(() => make([vol({ id: "nw1", name: "A", height: 1, material: "water" }), vol({ id: "nw2", name: "B", height: 1, material: "water" })]), /overlapper/);
  assert.throws(() => make([vol({ name: "Ute", height: 1, material: "water", from: [300, 300], to: [308, 300], align: "free" })]), /står ikke på taket/);
});
test("a bad material lists the allowed ones, water too", () => {
  assert.throws(() => make([vol({ name: "X", height: 1, material: "lava" })]), /material er glass, concrete, steel, wood, brick, water|material er .*water/);
});
test("the picture's palette has no water: withGarden draws the water volume in glass", () => {
  const m = make([vol({ name: "Vann", id: "nvann3", height: 1, material: "water" })]), g = withGarden(m.site).added.find(x => x.id === "nvann3");
  assert.equal(g.material, "water"); assert.ok(g.parts.every(p => p.mat === "glass"));
});
