/* The after (public/design.js) on the real data: demolish all but one wing, balconies on it, a greenhouse.
   node --test tests/design.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkEdit, applyEdits } from "../public/edits.js";

const site = JSON.parse(readFileSync(new URL("../public/data/site.json", import.meta.url)));
const floors = JSON.parse(readFileSync(new URL("../public/data/floors.json", import.meta.url))).floors;
const add = (edits, e) => { const m = applyEdits(site, floors, edits); edits.push(checkEdit(m.site, m.floors, e)); return edits; };

test("demolish alle and keep Sentralblokka", () => {
  const ed = add(add([], { kind: "demolish", building: "alle" }), { kind: "restore", building: "Sentralblokka" });
  const m = applyEdits(site, floors, ed);
  assert.deepEqual(m.site.buildings.filter(b => b.own).map(b => b.wing), ["sentralblokka"]);
  assert.ok(m.site.demolished.length > 10 && m.site.demolished.every(d => d.name));
  assert.equal(site.buildings.filter(b => b.own).length, m.site.demolished.length + 1, "the before is left as it was");
  assert.ok(m.floors.reduce((a, f) => a + f.rooms.length, 0) < floors.reduce((a, f) => a + f.rooms.length, 0), "the rooms in what is gone go with it");
});

test("balconies on the south facades, in bays", () => {
  const m = applyEdits(site, floors, add([], { kind: "balconies", wing: "Sentralblokka", side: "S", bay: 3.6, gap: 1.2 }));
  const b = m.site.added[0];
  assert.equal(b.kind, "balconies"); assert.ok(b.count > 10);
  for (const p of b.parts.filter(p => p.role === "slab")) assert.ok(Math.abs(Math.hypot(p.axis[1][0] - p.axis[0][0], p.axis[1][1] - p.axis[0][1]) - 3.6) < 0.01);
});

test("a triangular greenhouse: its volume is half width × height × length", () => {
  const m = applyEdits(site, floors, add([], { kind: "volume", name: "Drivhus", shape: "triangle", from: [-46, -62], to: [27, -62], width: 24, height: 18 }));
  const v = m.site.added[0];
  assert.equal(v.material, "glass"); assert.equal(v.volume_m3, Math.round(0.5 * 24 * 18 * 73)); assert.equal(v.top_kote - v.base_kote, 18);
});

test("wrong input is refused with a reason", () => {
  assert.throws(() => add([], { kind: "balconies", wing: "Sentralblokka", side: "Q" }), /side/);
  assert.throws(() => add([], { kind: "demolish", building: "Slottet" }), /Fant ikke/);
  assert.throws(() => add([], { kind: "volume", from: [0, 0], to: [0, 0.2], width: 5, height: 5 }), /mellom 1 og 250/);
});
