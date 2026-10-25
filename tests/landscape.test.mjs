/* The after's ground (landscape.js through edits.js): surfaces, paths, trees from hagekart's list, felling.
   node --test tests/landscape.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyEdits, checkEdit } from "../public/edits.js";

const site = JSON.parse(readFileSync(new URL("../public/data/site.json", import.meta.url), "utf8"));
const after = edits => applyEdits(site, [], edits).site;

test("a lawn, a gravel path and a row of lime trees", () => {
  const s = after([
    { kind: "surface", ring: [[-40, -70], [20, -70], [20, -50], [-40, -50]], surface: "grass", name: "Parken" },
    { kind: "path", line: [[-40, -60], [0, -60], [20, -40]], width: 3, surface: "gravel" },
    { kind: "trees", species: "lind", line: [[-40, -72], [20, -72]], spacing: 10 },
  ]);
  assert.equal(s.landscape.length, 2);
  assert.equal(s.landscape[0].area_m2, 1200);
  assert.ok(Math.abs(s.landscape[1].length_m - (40 + Math.hypot(20, 20))) < 0.2);
  assert.equal(s.landscape[1].ring.length, 6);
  const lind = s.trees.filter(t => t[5] === "lind");
  assert.equal(lind.length, 7); assert.equal(lind[0][2], 25); assert.equal(lind[0][3], 7);   // hagekart: 25 m high, 14 m spread
  assert.deepEqual(s.planted, [{ species: "lind", name: s.planted[0].name, latin: "Tilia cordata", count: 7 }]);
  assert.equal(site.trees.length, site.trees.filter(t => !t[5]).length, "the before keeps its trees");
});

test("banned species are refused, unknown Latin names get a default size, nonsense is refused", () => {
  assert.throws(() => checkEdit(site, [], { kind: "trees", species: "rynkerose", points: [[0, 0]] }), /forbudt/);
  assert.throws(() => checkEdit(site, [], { kind: "trees", species: "Rosa rugosa", points: [[0, 0]] }), /forbudt/);
  assert.throws(() => checkEdit(site, [], { kind: "trees", species: "noe rart!", points: [[0, 0]] }), /Kjenner ikke/);
  const s = after([{ kind: "trees", species: "Ginkgo biloba", points: [[5, 5]] }]);
  assert.equal(s.trees.at(-1)[2], 12);
  assert.throws(() => checkEdit(site, [], { kind: "surface", ring: [[0, 0], [1, 0]], surface: "grass" }), /3 til/);
});

test("felling takes today's trees inside the ring", () => {
  const n = site.trees.length, [x, y] = site.trees[0];
  const s = after([{ kind: "fell", ring: [[x - 1, y - 1], [x + 1, y - 1], [x + 1, y + 1], [x - 1, y + 1]] }]);
  assert.ok(s.felled >= 1); assert.equal(s.trees.length, n - s.felled);
});
