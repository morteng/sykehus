/* T4: a garden on a roof. Landscape edits (surface, path, trees, paint, fell) take on (a wing) and kote (its roof level).
   Fixture: as roof.test.mjs, a wing on a grid turned 30°, two roof blocks side by side (kote 10 and kote 14, each 20 × 10 m).
   node --test tests/roof-garden.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkEdit, applyEdits } from "../public/edits.js";

const TH = 30 * Math.PI / 180, c = Math.cos(TH), s = Math.sin(TH);
const X = (u, v) => [Math.round((u * c - v * s) * 100) / 100 + 0, Math.round((u * s + v * c) * 100) / 100 + 0];   // grid -> site
const rect = (u0, v0, u1, v1, top) => ({ p: [X(u0, v0), X(u1, v0), X(u1, v1), X(u0, v1)], top });
const box = (u0, v0, u1, v1) => [X(u0, v0), X(u1, v0), X(u1, v1), X(u0, v1)];
const bld = { id: "tw", wing: "tw", own: true, base: 2, top: 14, ring: box(0, 0, 40, 10), area_m2: 400, grid_deg: 30, blocks: [rect(0, 0, 20, 10, 10), rect(20, 0, 40, 10, 14)] };
const site = { buildings: [bld], wings: [{ id: "tw", name: "Testfløy", levels: [] }], added: [], trees: [] };
const after = edits => applyEdits(site, [], edits.map(e => checkEdit(site, [], e))).site;   // as try_change keeps them: checked first, so on and kote are resolved
const inU = (p, lo, hi) => { const u = p[0] * c + p[1] * s; return u >= lo - 0.01 && u <= hi + 0.01; };   // a site point's u on the grid

test("a lawn on the roof stands at the chosen level; with no level, at the level under most of it", () => {
  const a = after([{ kind: "surface", surface: "grass", on: "tw", kote: 10, ring: box(4, 2, 16, 8) }]).landscape[0];
  assert.equal(a.kote, 10); assert.equal(a.on, "tw"); assert.ok(Math.abs(a.area_m2 - 72) < 0.3, String(a.area_m2)); assert.equal(a.soil_depth_m, 0.2);
  const b = after([{ kind: "surface", surface: "grass", on: "Testfløy", ring: box(24, 2, 36, 8) }]).landscape[0];
  assert.equal(b.kote, 14, "no kote: the level that holds it");
  assert.equal(after([{ kind: "surface", surface: "grass", on: "tw", ring: box(4, 2, 19, 8) }]).landscape[0].kote, 10);
  assert.throws(() => checkEdit(site, [], { kind: "surface", surface: "grass", on: "tw", kote: 12, ring: box(4, 2, 16, 8) }), /ikke tak på kote 12; takene ligger på 14, 10/);
  assert.throws(() => checkEdit(site, [], { kind: "surface", surface: "grass", on: "tw", kote: 14, ring: box(4, 2, 16, 8) }), /ligger ikke på taket|stikker/, "a ring on the 10 level is not on the 14 level");
});

test("a surface hanging past the roof edge is refused with the metres; inside it is kept", () => {
  assert.throws(() => checkEdit(site, [], { kind: "surface", surface: "grass", on: "tw", kote: 10, ring: box(5, 2, 23, 8) }), e => {
    const m = /stikker 3 m \((\d+),?(\d*) m²\) ut over takkanten til Testfløy på kote 10/.exec(e.message);
    return m && Math.abs(+`${m[1]}.${m[2] || 0}` - 18) < 1.5;   // 3 m × 6 m
  });
  assert.throws(() => checkEdit(site, [], { kind: "surface", surface: "grass", on: "tw", kote: 10, ring: box(5, -1.5, 15, 8) }), /stikker 1,5\d? m|stikker 1,49 m/);
  assert.equal(checkEdit(site, [], { kind: "surface", surface: "grass", on: "tw", kote: 10, ring: box(5, 0, 20, 10) }).kote, 10, "up to the edge is on the roof");
});

test("a path and water on a roof", () => {
  const p = after([{ kind: "path", on: "tw", kote: 14, line: [X(22, 5), X(38, 5)], width: 2, surface: "paving" }]).landscape[0];
  assert.equal(p.kote, 14); assert.equal(p.kind, "path"); assert.equal(p.soil_depth_m, 0.1);
  assert.throws(() => checkEdit(site, [], { kind: "path", on: "tw", kote: 14, line: [X(22, 5), X(44, 5)], width: 2 }), /stikker 4(,0\d)? m/);
  assert.throws(() => checkEdit(site, [], { kind: "surface", surface: "water", on: "tw", ring: box(4, 2, 16, 8) }), /Vann legges ikke på et tak.*material water.*pool_basin/);
  assert.throws(() => checkEdit(site, [], { kind: "path", kote: 14, line: [X(22, 5), X(38, 5)] }), /kote gjelder en sti på et tak/);
});

test("trees on a roof stand at its kote, say the soil depth, and are felled only by a roof fell", () => {
  const s1 = after([{ kind: "trees", species: "Betula pendula", on: "tw", kote: 14, points: [X(25, 5), X(30, 5), X(35, 5)], height: 6, crown: 3 }]);
  assert.equal(s1.trees.length, 3);
  for (const t of s1.trees) { assert.equal(t[7], 14); assert.equal(t[8], "tw"); }
  assert.equal(s1.plantings[0].soil_depth_m, 0.9); assert.equal(s1.plantings[0].kote, 14);
  assert.equal(after([{ kind: "trees", species: "Betula pendula", on: "tw", points: [X(25, 5)], height: 2.5 }]).plantings[0].soil_depth_m, 0.5);
  assert.throws(() => checkEdit(site, [], { kind: "trees", species: "Betula pendula", on: "tw", kote: 14, points: [X(25, 5), X(41.5, 5)] }), /1 av 2 punkter|stikker 1,5 m/);
  const ring = box(22, 0, 38, 10);
  const g = after([{ kind: "trees", species: "Betula pendula", on: "tw", kote: 14, points: [X(25, 5)] }, { kind: "fell", ring }]);
  assert.equal(g.trees.length, 1, "a ground fell leaves the roof's tree"); assert.equal(g.felled, 0);
  const r = after([{ kind: "trees", species: "Betula pendula", on: "tw", kote: 14, points: [X(25, 5)] }, { kind: "fell", ring, on: "tw" }]);
  assert.equal(r.trees.length, 0); assert.equal(r.felled, 1); assert.equal(r.plantings[0].count, 0);
});

test("a brush stroke past the edge is cut at it, says by how many m², and lies at the roof kote", () => {
  const sx = after([{ kind: "paint", surface: "grass", on: "tw", kote: 10, r: 2, line: [X(5, 5), X(30, 5)] }]);
  const l = sx.landscape[0];
  assert.equal(l.kote, 10); assert.equal(l.on, "tw");
  assert.ok(l.ring.every(p => inU(p, 0, 20.3)), "no corner (the brush's grid is 0.25 m) past the 10 level's edge (u 0..20): " + JSON.stringify(l.ring.map(p => p[0] * c + p[1] * s)));
  const cut = sx.painted[0].clipped_m2;
  assert.ok(cut > 35 && cut < 60, "10 m of a 4 m wide stroke: " + cut);
  assert.ok(sx.roof_say[0].includes("m² ut over takkanten på kote 10"), sx.roof_say[0]);
  const inside = after([{ kind: "paint", surface: "grass", on: "tw", kote: 10, r: 2, line: [X(6, 5), X(14, 5)] }]);
  assert.equal(inside.painted[0].clipped_m2, undefined); assert.equal(inside.roof_say, undefined);
  assert.throws(() => checkEdit(site, [], { kind: "paint", surface: "grass", on: "tw", kote: 10, line: [X(30, 5)] }), /ligger ikke på taket/);
});

test("ground and roof are two layers: paint on one never joins, takes from or is blocked by the other", () => {
  const ground = [{ kind: "paint", surface: "grass", r: 2, line: [X(5, 30), X(15, 30)] }];
  const g0 = after(ground).landscape[0];
  const both = after([...ground, { kind: "paint", surface: "grass", on: "tw", kote: 10, r: 2, line: [X(5, 5), X(15, 5)] }, { kind: "surface", surface: "planting", on: "tw", kote: 10, ring: box(2, 1, 6, 3) }]);
  assert.equal(both.landscape.length, 3);
  const g1 = both.landscape.find(x => !x.on);
  assert.deepEqual(g1.ring, g0.ring, "the ground lawn is the one it was"); assert.equal(g1.area_m2, g0.area_m2);
  assert.equal(both.landscape.filter(x => x.on).length, 2, "the roof lawn and the roof bed stay two");
  const up = after([{ kind: "paint", surface: "grass", on: "tw", kote: 10, r: 2, line: [X(5, 5), X(15, 5)] }, ...ground]);
  assert.deepEqual(up.landscape.find(x => !x.on).ring, g0.ring, "the roof's lawn does not block or join the ground's brush");
});

test("ground landscape is unchanged: no on, no kote, trees keep seven items", () => {
  const real = JSON.parse(readFileSync(new URL("../public/data/site.json", import.meta.url), "utf8"));
  const s2 = applyEdits(real, [], [
    { kind: "surface", ring: [[-40, -70], [20, -70], [20, -50], [-40, -50]], surface: "grass" },
    { kind: "path", line: [[-40, -60], [0, -60]], width: 3, surface: "gravel" },
    { kind: "trees", species: "lind", points: [[-30, -72]] },
  ]).site;
  for (const g of s2.landscape) { assert.equal(g.on, undefined); assert.equal(g.kote, undefined); assert.equal(g.soil_depth_m, undefined); }
  assert.equal(s2.trees.at(-1).length, 7); assert.equal(s2.plantings[0].on, undefined);
  assert.throws(() => checkEdit(real, [], { kind: "trees", species: "lind", kote: 12, points: [[0, 0]] }), /kote gjelder trær på et tak/);
});

test("a greenhouse on the same roof covers the lawn, the path and the tree: they read back inside it, at its foot kote", () => {
  const edits = [
    { kind: "surface", surface: "grass", on: "tw", kote: 14, ring: box(26, 2, 34, 8), name: "Plen" },
    { kind: "path", on: "tw", kote: 14, line: [X(24, 5), X(36, 5)], width: 1.5, surface: "paving" },
    { kind: "trees", species: "Betula pendula", on: "tw", kote: 14, points: [X(30, 5)], height: 4, crown: 3 },
    { kind: "volume", name: "Drivhus", shape: "box", height: 4, from: X(23, 5), to: X(37, 5), width: 9, on: "tw", align: "free" },
  ];
  const s3 = after(edits), v = s3.added[0];
  assert.equal(v.base_kote, 14);
  for (const g of [...s3.landscape, ...s3.plantings]) { assert.equal(g.kote, v.base_kote); assert.deepEqual(g.under, [{ id: v.id, name: "Drivhus", all: true }], g.id); }
  const out = after([edits[0], { ...edits[3], from: X(12, 5), to: X(18, 5), width: 6 }]);   // a volume on the other level does not cover it
  assert.equal(out.landscape[0].under, undefined);
});

test("a roof path over the same plan spot does not block the ground's brush, nor does a ground lawn join the roof's", async () => {
  const { applyPaint, paintPlan } = await import("../public/paint-edit.js");
  const open = { buildings: [] }, line = [[0, 0], [10, 0]], stroke = { kind: "paint", surface: "grass", mode: "add", line, r: 2 };
  const roofPath = { id: "sti-1", kind: "path", surface: "paving", ring: [[-1, -1], [11, -1], [11, 1], [-1, 1]], on: "tw", kote: 10 };
  const free = paintPlan([], stroke, open).m2, over = paintPlan([roofPath], stroke, open).m2;
  assert.ok(free > 35, "a 10 × 4 m stroke: " + free); assert.equal(over, free, "the roof's path blocks none of it");
  const roofLawn = { id: "flate-1", kind: "surface", surface: "grass", ring: [[0, -2], [10, -2], [10, 2], [0, 2]], area_m2: 40, on: "tw", kote: 10 };
  const r = applyPaint([roofLawn], stroke, open, new Set(), () => "flate-2");
  assert.equal(r.land.length, 2, "a ground lawn on the same spot is a second surface, not the roof's grown");
  assert.deepEqual(r.land.find(x => x.id === "flate-1"), roofLawn); assert.equal(r.land.find(x => x.id === "flate-2").on, undefined);
});
