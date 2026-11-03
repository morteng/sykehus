/* U3820: a bed fills itself (hagekart's biome.js, taken by lock): surface planting with bed: roser | stauder | groent.
   node --test tests/bed-fill.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyLandscape, checkLandscape, bedPlants } from "../public/landscape.js";

const ring = [[0, 0], [10, 0], [10, 6], [0, 6]], str = (s, n, w) => String(s);
const inside = ([x, y]) => x > 0 && x < 10 && y > 0 && y < 6;

test("the same bed and seed lay the same plants; another seed lays others; every plant is inside the bed", () => {
  const a = bedPlants(ring, "roser", { seed: 3 }), b = bedPlants(ring, "roser", { seed: 3 }), c = bedPlants(ring, "roser", { seed: 4 });
  assert.ok(a.length > 5); assert.deepEqual(a, b); assert.notDeepEqual(a, c);
  assert.ok(a.every(q => inside([q.x, q.y])) && a.every(q => ["poppius", "gloriadei"].includes(q.pid)));
  assert.ok(bedPlants(ring, "roser", { density: 0.5 }).length < bedPlants(ring, "roser", { density: 1 }).length, "half the density, fewer plants");
});

test("a planting with bed is checked: a known type, only on a planting, not on a roof", () => {
  const site = { buildings: [] };
  assert.equal(checkLandscape(site, { kind: "surface", ring, surface: "planting", bed: "stauder" }, str).bed, "stauder");
  assert.throws(() => checkLandscape(site, { kind: "surface", ring, surface: "planting", bed: "kaktus" }, str), /bed er roser, stauder, groent/);
  assert.throws(() => checkLandscape(site, { kind: "surface", ring, surface: "grass", bed: "roser" }, str), /planting/);
});

test("applyLandscape plants the bed species by species; a surface without bed plants nothing", () => {
  const s1 = { trees: [], buildings: [] };
  applyLandscape(s1, [{ kind: "surface", ring, surface: "planting", bed: "stauder" }]);
  assert.equal(s1.landscape.length, 1); assert.ok(s1.plantings.length >= 3 && s1.plantings.every(g => g.bed === "flate-1"));
  assert.equal(s1.trees.length, s1.plantings.reduce((n, g) => n + g.count, 0));
  assert.ok(s1.trees.every(t => inside(t) && t[5] && /^tre-\d+$/.test(t[6])));
  const s2 = { trees: [], buildings: [] };
  applyLandscape(s2, [{ kind: "surface", ring, surface: "planting" }]);
  assert.equal(s2.trees.length, 0);
});
