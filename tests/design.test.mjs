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

test("a new building from the page (U3556): storeys, facts, reshaped, and torn down by its id", () => {
  const vol = { kind: "volume", id: "nAbc123", name: "Nybygg", shape: "box", from: [-40, -70], to: [-10, -70], width: 12, storeys: 4, material: "concrete", use: "Boliger" };
  const c = checkEdit(site, floors, vol); assert.equal(c.height, 12.8); assert.equal(c.storeys, 4);
  let m = applyEdits(site, floors, [c]); const a = m.site.added.find(x => x.id === "nAbc123");
  assert.equal(a.use, "Boliger"); assert.equal(a.footprint_m2, 360); assert.equal(a.top_kote - a.base_kote, 12.8);
  assert.throws(() => checkEdit(m.site, m.floors, { ...vol }), /ikke brukt før/);
  const r = checkEdit(m.site, m.floors, { kind: "reshape", id: "nAbc123", name: "Bolighuset", storeys: 6, from: [-40, -60], to: [-10, -60] });
  m = applyEdits(site, floors, [c, r]); const b = m.site.added.find(x => x.id === "nAbc123");
  assert.equal(b.name, "Bolighuset"); assert.equal(b.top_kote - b.base_kote, 19.2); assert.deepEqual(b.from, [-40, -60]);
  assert.throws(() => checkEdit(m.site, m.floors, { kind: "reshape", id: "nNope0000", name: "x" }), /Fant ikke/);
  const d = checkEdit(m.site, m.floors, { kind: "demolish", building: "nAbc123" });
  m = applyEdits(site, floors, [c, r, d]); assert.equal((m.site.added || []).length, 0);
  const w = checkEdit(site, floors, { kind: "wing", wing: "Østfløy", field: "use", value: "Kontorer", why: "endret på siden" });
  assert.equal(applyEdits(site, floors, [w]).site.wings.find(x => x.id === "ostfloy").use, "Kontorer");
});

test("a room by its place (at): one of several with the same name, or one with no code (pm 21:22Z)", () => {
  const six = floors.filter(f => f.name === "6. etasje").flatMap(f => f.rooms || []), same = six.filter(r => r.name.toLowerCase() === "behandling" && r.at);
  assert.ok(same.length > 1);
  assert.throws(() => checkEdit(site, floors, { kind: "room", storey: "6", room: "BEHANDLING", set: { name: "Atelier" } }), /bruk romkoden, eller at: \[øst, nord\]/);
  const one = same[1], e = checkEdit(site, floors, { kind: "room", storey: "6", room: "BEHANDLING", at: [one.at[0] + 1, one.at[1] - 1], set: { name: "Atelier" } });
  assert.deepEqual(e.at, one.at);
  const m = applyEdits(site, floors, [e]), after = m.floors.filter(f => f.name === "6. etasje").flatMap(f => f.rooms || []);
  assert.equal(after.filter(r => r.name === "Atelier").length, 1); assert.equal(after.filter(r => r.name.toLowerCase() === "behandling" && r.at).length, same.length - 1);
  assert.throws(() => checkEdit(site, floors, { kind: "room", storey: "6", at: [400, 400], set: { name: "x" } }), /innen 6 m/);
});
