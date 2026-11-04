/* U3870: shadow and view toward the neighbours.   node --test tests/shadow.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { shadowView } from "../shadow.mjs";

const sq = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]];
const site = (added, extra = {}) => ({ buildings: [{ id: "nabo", type: "apartments", ring: sq(-5, 10, 10, 8), base: 0, top: 7, levels: 2 }, { id: "far", type: "yes", ring: sq(500, 500, 10, 10), base: 0, top: 6 }], added, ...extra });
const tower = { kind: "volume", name: "Tårn", from: [-10, 0], to: [10, 0], width: 6, base_kote: 0, top_kote: 20 };

test("no new volume: nothing to compute", () => { assert.equal(shadowView(site([])).counted, 0); });

test("a tall volume south of a neighbour takes its winter sun; a far building is left out", () => {
  const r = shadowView(site([tower]));
  assert.equal(r.counted, 1); const n = r.neighbours[0]; assert.equal(n.id, "nabo");
  const dec = n.sun.find(s => s.day === "21. desember"), jun = n.sun.find(s => s.day === "21. juni");
  assert.ok(dec.sun_hours_before > 0 && dec.hours_lost > 0 && dec.sun_hours_after < dec.sun_hours_before, JSON.stringify(dec));
  assert.ok(jun.hours_lost >= 0 && jun.sun_hours_before >= dec.sun_hours_before);
  assert.equal(n.distance_m, 6.7); assert.ok(n.up_deg > 60 && n.span_deg > 50, JSON.stringify(n));
  assert.match(r.say, /Mest tapt sol/);
});

test("north of the neighbour the volume takes no sun; a demolished building stops shading", () => {
  const north = { ...tower, from: [-10, 30], to: [10, 30] };
  const r = shadowView(site([north]));
  assert.ok(r.neighbours[0].sun.filter(s => s.day !== "21. juni").every(s => s.hours_lost === 0), JSON.stringify(r.neighbours[0].sun));   // midsummer sun still reaches a north wall in the evening and morning
  const s2 = site([north]); s2.buildings.push({ id: "mur", ring: sq(-20, 5, 40, 2), base: 0, top: 30 }); const a = shadowView(s2), b = shadowView({ ...s2, demolished: [{ id: "mur" }] });
  const d = x => x.neighbours.find(n => n.id === "nabo").sun[2].sun_hours_after; assert.ok(d(b) > d(a));
});
