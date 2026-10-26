/* The brush and the earthworks as edits (U3655): checkEdit then applyEdits, as try_change and the page's undo list use them.
   renderkit's paint and terrain do the geometry (their tests are in renderkit); this tests what crosses the edit path.
   node --test tests/paint-edit.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyEdits, checkEdit } from "../public/edits.js";
import { pointInRing } from "../public/renderkit/paths2d.js";

const site = JSON.parse(readFileSync(new URL("../public/data/site.json", import.meta.url), "utf8"));
const run = edits => applyEdits(site, [], edits.map(e => checkEdit(site, [], e))).site;
const AT = [-122, -58];   // open ground inside the lot, no building within 14 m (found with the site's own rings)
const stroke = (surface, extra = {}) => ({ kind: "paint", surface, line: [[AT[0] - 10, AT[1]], [AT[0] + 10, AT[1]]], r: 3, ...extra });

test("a paint stroke becomes a surface of its own shape, 20 m by 6 m plus the round ends", () => {
  const s = run([stroke("grass")]);
  assert.equal(s.landscape.length, 1);
  const g = s.landscape[0];
  assert.equal(g.surface, "grass"); assert.equal(g.id, "flate-1");
  assert.ok(Math.abs(g.area_m2 - (20 * 6 + Math.PI * 9)) < 6, `area ${g.area_m2}`);
  assert.equal(site.landscape, undefined, "the before keeps no landscape");
});

test("a bed painted across a lawn makes a hole in the lawn; erasing the bed gives the lawn back", () => {
  const lawn = { kind: "paint", surface: "grass", line: [[AT[0] - 10, AT[1]], [AT[0] + 10, AT[1]]], r: 6 };
  const bed = { kind: "paint", surface: "planting", line: [AT, AT], r: 2 };
  const s = run([lawn, bed]);
  const grass = s.landscape.find(g => g.surface === "grass"), plant = s.landscape.find(g => g.surface === "planting");
  assert.ok(grass.holes?.length === 1, "the lawn has the bed as a hole");
  assert.ok(plant && plant.area_m2 > 10 && plant.area_m2 < 14, `bed ${plant?.area_m2}`);
  assert.ok(grass.area_m2 < 12 * 20 + Math.PI * 36 - 10, "the lawn lost the bed's ground");
  const back = run([lawn, bed, { ...bed, mode: "erase", surface: "planting" }]);
  assert.equal(back.landscape.find(g => g.surface === "planting"), undefined, "the bed is rubbed out");
});

test("the brush does not paint inside a building", () => {
  const b = [...site.buildings].sort((x, y) => y.area_m2 - x.area_m2)[0];
  const c = b.ring.reduce((a, p) => [a[0] + p[0] / b.ring.length, a[1] + p[1] / b.ring.length], [0, 0]);
  assert.ok(pointInRing(c, b.ring), "the control: the centre of the biggest building is inside it");
  const s = run([{ kind: "paint", surface: "grass", line: [c, c], r: 4 }]);
  for (const g of s.landscape || []) assert.ok(!pointInRing(c, g.ring), "no lawn over the building");
  const after = run([{ kind: "demolish", building: b.id }, { kind: "paint", surface: "grass", line: [c, c], r: 4 }]);
  assert.ok((after.landscape || []).some(g => pointInRing(c, g.ring)), "where the building stood, the brush paints");
});

test("a way near the stroke (around) stops it and the edge is pulled to it", () => {
  const road = [[AT[0] - 30, AT[1] + 3.5], [AT[0] + 30, AT[1] + 3.5], [AT[0] + 30, AT[1] + 20], [AT[0] - 30, AT[1] + 20], [AT[0] - 30, AT[1] + 3.5]];
  const s = run([stroke("grass", { around: [road] })]);
  const g = s.landscape[0], top = Math.max(...g.ring.map(p => p[1]));
  assert.ok(Math.abs(top - (AT[1] + 3.5)) < 0.6, `the lawn ends at the road's edge, top ${top} against ${AT[1] + 3.5}`);
  assert.ok(g.ring.every(p => !pointInRing(p, road) || Math.abs(p[1] - (AT[1] + 3.5)) < 0.6), "none of it on the road");
});

test("a paint edit by an unknown surface or a bad radius is refused with the reason", () => {
  assert.throws(() => checkEdit(site, [], stroke("lava")), /surface for paint er grass, planting, paving, gravel/);
  assert.throws(() => checkEdit(site, [], stroke("grass", { r: 40 })), /radius/);
});

test("a terrain edit raises the ground and says what it dug and filled; the before's grid stays", () => {
  const T = site.terrain, i = Math.floor((T.y1 - AT[1]) / T.res) * T.w + Math.floor((AT[0] - T.x0) / T.res), z0 = T.z[i];
  const s = run([{ kind: "terrain", op: "raise", shape: { t: "circle", c: AT, r: 6 }, h: 1 }]);
  assert.ok(Math.abs(s.terrain.z[i] - z0 - 1) < 0.15, `ground ${s.terrain.z[i]} against ${z0 + 1}`);
  assert.equal(T.z[i], z0, "the before's grid is not changed");
  assert.ok(s.earthwork.fill_m3 > 80 && s.earthwork.fill_m3 < 130 && s.earthwork.cut_m3 < 1, JSON.stringify(s.earthwork));
  assert.ok(s.earthwork.tippers >= 9);
  const pond = run([{ kind: "terrain", op: "pond", shape: { t: "circle", c: AT, r: 4 }, h: 1.2 }]);
  assert.ok(pond.terrain.z[i] < z0 - 0.8 && pond.earthwork.cut_m3 > 20, "a pond digs");
});

test("a terrain edit with no height, a bad shape or an unknown op is refused", () => {
  assert.throws(() => checkEdit(site, [], { kind: "terrain", op: "raise", shape: { t: "circle", c: AT, r: 5 } }), /raise trenger h/);
  assert.throws(() => checkEdit(site, [], { kind: "terrain", op: "dance", shape: { t: "circle", c: AT, r: 5 }, h: 1 }), /op er raise/);
  assert.throws(() => checkEdit(site, [], { kind: "terrain", op: "lower", shape: { t: "hex" }, h: 1 }), /shape\.t/);
});

test("the ghost the page draws is what the edit paints: paintPlan's rings and applyEdits give the same area", async () => {
  const { paintPlan, nearWays } = await import("../public/paint-edit.js");
  const e = checkEdit(site, [], stroke("grass", { r: 2.5 }));
  const plan = paintPlan([], e, site), ghostArea = plan.polys.reduce((s, p) => s + Math.abs(p.ring.reduce((a, q, i, r) => a + q[0] * r[(i + 1) % r.length][1] - r[(i + 1) % r.length][0] * q[1], 0)) / 2, 0);
  const painted = applyEdits(site, [], [e]).site.landscape[0].area_m2;
  assert.ok(Math.abs(ghostArea - painted) < 3, `ghost ${ghostArea} against painted ${painted}`);
  const far = [[1000, 1000], [1010, 1000], [1010, 1010]], near = [[AT[0], AT[1] + 3], [AT[0] + 5, AT[1] + 3], [AT[0] + 5, AT[1] + 8]];
  assert.equal(nearWays([far, near], e).length, 1, "only the way near the stroke goes with the edit");
});

test("the page and the server read the ways through one function (roads.js wayRingsOf): a path becomes a ring of its width", async () => {
  const { wayRingsOf } = await import("../public/roads.js");
  const w = wayRingsOf([{ kind: "path", id: "x", pts: [[0, 0], [10, 0]], width: 2 }, { kind: "fence", pts: [[0, 0], [5, 5]] }], q => q);
  assert.equal(w.length, 1, "a fence is not a way");
  const ys = w[0].ring.map(p => p[1]); assert.ok(Math.abs(Math.max(...ys) - Math.min(...ys) - 2) < 0.01, "2 m wide");
});

test("the species picker finds by Norwegian or Latin name, shows a banned species with its reason, and the edit still refuses it", async () => {
  const { searchPlants } = await import("../public/plants.js");
  assert.equal(searchPlants("Lind")[0].id, "lind");
  assert.equal(searchPlants("tilia cordata")[0].id, "lind", "by the Latin name");
  const lupin = searchPlants("lupin")[0];
  assert.ok(lupin.banned && /Forbudt å plante i Norge/.test(lupin.why), JSON.stringify(lupin));
  assert.deepEqual(searchPlants("   "), []);
  assert.throws(() => checkEdit(site, [], { kind: "trees", species: lupin.id, points: [AT] }), /forbudt å plante i Norge/);
  const s = run([{ kind: "trees", species: "lind", line: [[AT[0] - 10, AT[1]], [AT[0] + 10, AT[1]]], spacing: 6 }]);
  assert.equal(s.trees.filter(t => t[5] === "lind").length, 4, "a row every 6 m along 20 m: 0, 6, 12, 18");
});

test("a tap plants one tree, a stroke a row: the page's plantAt gives the points the edit makes", async () => {
  const { plantAt } = await import("../public/mal.js");
  assert.deepEqual(plantAt([[0, 0], [0.5, 0.5]], { gap: 6 }), [[0, 0]]);
  assert.equal(plantAt([[0, 0], [20, 0]], { gap: 6 }).length, 4);
});
