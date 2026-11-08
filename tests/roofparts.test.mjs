/* U3836: railing, stair, balcony and greenhouse parts stand on a wing's roof; a greenhouse over 12 × 30 m is laid as several.
   Fixture as roof-garden.test.mjs (a wing on a grid turned 30°, a 40 × 10 m roof in two levels).
   node --test tests/roofparts.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { partFoot, bigGreenhouses } from "../roofparts.mjs";
import { roofOf } from "../public/design.js";

const TH = 30 * Math.PI / 180, c = Math.cos(TH), s = Math.sin(TH);
const X = (u, v) => [Math.round((u * c - v * s) * 100) / 100, Math.round((u * s + v * c) * 100) / 100];
const rect = (u0, v0, u1, v1, top) => ({ p: [X(u0, v0), X(u1, v0), X(u1, v1), X(u0, v1)], top });
const bld = { id: "tw", wing: "tw", own: true, base: 2, top: 14, ring: [X(0, 0), X(40, 0), X(40, 10), X(0, 10)], area_m2: 400, grid_deg: 30, blocks: [rect(0, 0, 40, 10, 14)] };
const site = { buildings: [bld], wings: [{ id: "tw", name: "Testfløy", levels: [] }], added: [], trees: [] };
const wingOf = (st, k) => st.wings.find(w => w.id === k || w.name === k);
const SPEC = { greenhouse: { params: { form: { default: "polygon" }, length: { default: 4 }, width: { default: 3 }, radius: { default: 2 } } } };
const mk = { site, wingOf, listParts: async () => SPEC };

test("a part's footprint on a roof: railing, stair, balcony, greenhouse", () => {
  assert.deepEqual(partFoot("railing", { length: 6 }), { L: 6, W: 0.1 });
  assert.deepEqual(partFoot("balcony", { width: 3, depth: 1.5 }), { L: 3, W: 1.5 });
  const st = partFoot("stair", { height: 2.8, width: 1.2, max_riser: 0.18 });
  assert.equal(st.W, 1.2); assert.ok(st.L > 3 && st.L < 6, String(st.L));
  assert.deepEqual(partFoot("greenhouse", { form: "gable", length: 10, width: 5 }), { L: 10, W: 5 });
  assert.deepEqual(partFoot("greenhouse", { radius: 3 }, SPEC.greenhouse.params), { L: 6, W: 6 });
});

test("a greenhouse 36 × 8 m on the roof 36 m long becomes two of 18 m", async () => {
  const roof = roofOf(site, "tw"); assert.ok(roof, "the fixture has a roof");
  const out = await bigGreenhouses([{ kind: "part", part: "greenhouse", name: "Drivhus", at: { wing: "tw", roof: true, u: 2, v: 0 }, params: { form: "gable", length: 36, width: 8 } }], mk);
  assert.equal(out.length, 2, JSON.stringify(out.map(o => o.__bad || o.name)));
  for (const o of out) { assert.equal(o.on, "tw"); assert.equal(o.group, "Drivhus"); assert.equal(o.params.length, 18); assert.equal(o.params.width, 8); assert.equal(o.at, undefined); }
  const d = e => Math.hypot(e.to[0] - e.from[0], e.to[1] - e.from[1]);
  assert.ok(Math.abs(d(out[0]) - 18) < 0.05); assert.ok(Math.abs(out[0].to[0] - out[1].from[0]) < 0.05 && Math.abs(out[0].to[1] - out[1].from[1]) < 0.05, "the two meet end to end");
  const wide = await bigGreenhouses([{ kind: "part", part: "greenhouse", at: { wing: "tw", roof: true, u: 2, v: 0 }, params: { form: "gable", length: 10, width: 10 } }], mk);
  assert.equal(wide.length, 1, "within 12 × 30 it is left alone"); assert.ok(wide[0].at, "untouched");
});

test("a greenhouse wider than 12 m is laid side by side; a dome or a refusal is not split", async () => {
  const out = await bigGreenhouses([{ kind: "part", part: "greenhouse", at: { wing: "tw", roof: true, u: 2, v: 0 }, params: { form: "gable", length: 20, width: 9.5 } }], mk);
  assert.equal(out.length, 1);
  const two = await bigGreenhouses([{ kind: "part", part: "greenhouse", at: { wing: "tw", roof: true, u: 2, v: 0 }, params: { form: "gable", length: 20, width: 12.2 } }], mk);
  assert.equal(two.length, 2); assert.ok(two.every(t => t.params.width === 6.1));
  const dome = await bigGreenhouses([{ kind: "part", part: "greenhouse", at: { wing: "tw", roof: true }, params: { form: "geodesic", radius: 8 } }], mk);
  assert.equal(dome.length, 1);
  const bad = await bigGreenhouses([{ kind: "part", part: "greenhouse", at: { wing: "nope", roof: true }, params: { form: "gable", length: 40, width: 4 } }], mk);
  assert.match(bad[0].__bad, /Fant ikke fløyen/);
});
