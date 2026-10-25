/* a pool, a lawn or a path picked and changed or taken away like a building (U3569, Morten 2026-10-25 22:41Z) */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyEdits, checkEdit } from "../public/edits.js";

const site0 = JSON.parse(readFileSync(new URL("../public/data/site.json", import.meta.url))), floors0 = [];
const pool = { kind: "surface", ring: [[0, 0], [10, 0], [10, 5], [0, 5]], surface: "water", name: "Basseng" };
const lawn = { kind: "surface", ring: [[20, 0], [30, 0], [30, 10], [20, 10]], surface: "grass" };
const path = { kind: "path", line: [[0, 20], [20, 20]], width: 2, surface: "gravel" };
const after = edits => applyEdits(site0, floors0, edits).site;
const check = (edits, e) => checkEdit(after(edits), floors0, e);

test("a surface or a path by its id: reshape sets what it is laid with, its name, a path's width", () => {
  const e = check([pool, lawn, path], { kind: "reshape", id: "flate-2", surface: "paving", name: "Plassen" });
  assert.deepEqual({ ...e, why: undefined }, { kind: "reshape", id: "flate-2", surface: "paving", name: "Plassen", why: undefined });
  const s = after([pool, lawn, path, e, check([pool, lawn, path], { kind: "reshape", id: "sti-3", width: 4 })]);
  const g = Object.fromEntries(s.landscape.map(x => [x.id, x]));
  assert.equal(g["flate-2"].surface, "paving"); assert.equal(g["flate-2"].name, "Plassen");
  assert.equal(g["sti-3"].width, 4); assert.equal(g["sti-3"].area_m2, 80);
  assert.throws(() => check([pool], { kind: "reshape", id: "flate-1", surface: "lava" }), /surface er/);
  assert.throws(() => check([pool], { kind: "reshape", id: "sti-1", width: 3 }), /Fant ikke «sti-1» på bakken/);
});

test("demolish by its id takes it away, and the others keep their ids", () => {
  const d = check([pool, lawn, path], { kind: "demolish", building: "flate-1" });
  const s = after([pool, lawn, path, d]);
  assert.deepEqual(s.landscape.map(x => x.id), ["flate-2", "sti-3"]);
  assert.ok(!s.demolished?.length, "nothing of the hospital is torn down");
  const s2 = after([pool, lawn, path, d, { kind: "surface", ring: [[40, 0], [45, 0], [45, 5]], surface: "gravel" }]);
  assert.deepEqual(s2.landscape.map(x => x.id), ["flate-2", "sti-3", "flate-4"]);
});

test("a planting has an id: reshape sets its height and crown, demolish takes its trees away", () => {
  const birch = { kind: "trees", species: "Betula pendula", points: [[0, 30], [8, 30], [16, 30]], height: 10, crown: 6 };
  const s0 = after([pool, birch]);
  assert.deepEqual(s0.plantings.map(g => [g.id, g.count]), [["tre-1", 3]]);
  assert.equal(s0.trees.filter(t => t[6] === "tre-1").length, 3);
  const r = check([pool, birch], { kind: "reshape", id: "tre-1", height: 14, crown: 8 });
  const s1 = after([pool, birch, r]);
  assert.ok(s1.trees.filter(t => t[6] === "tre-1").every(t => t[2] === 14 && t[3] === 4));
  const s2 = after([pool, birch, check([pool, birch], { kind: "demolish", building: "tre-1" })]);
  assert.equal(s2.trees.filter(t => t[6]).length, 0); assert.deepEqual(s2.plantings, []); assert.equal(s2.landscape[0].id, "flate-1");
  assert.equal(after([birch, pool]).landscape[0].id, "flate-1", "a planting does not take a surface's number");
});
