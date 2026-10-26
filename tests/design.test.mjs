/* The after (public/design.js) on the real data: demolish all but one wing, balconies on it, a greenhouse.
   node --test tests/design.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkEdit, applyEdits } from "../public/edits.js";
import { groundAt, groundText } from "../public/design.js";

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
  assert.equal(a.use, "Boliger"); assert.equal(a.footprint_m2, 360); assert.equal(Math.round((a.top_kote - a.base_kote) * 10) / 10, 12.8);
  assert.equal(checkEdit(m.site, m.floors, { ...vol }).id, "nAbc1232");   // its id taken: a free one, not a refusal (pm 23:31Z)
  assert.equal(checkEdit(site, floors, { ...vol, id: "takhage1" }).id, "ntakhage1");
  const r = checkEdit(m.site, m.floors, { kind: "reshape", id: "nAbc123", name: "Bolighuset", storeys: 6, from: [-40, -60], to: [-10, -60] });
  m = applyEdits(site, floors, [c, r]); const b = m.site.added.find(x => x.id === "nAbc123");
  assert.equal(b.name, "Bolighuset"); assert.equal(Math.round((b.top_kote - b.base_kote) * 10) / 10, 19.2); assert.deepEqual(b.from, [-40, -60]);
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

test("a new building gets a pad (U3566): level at its foot, slopes 1:2, cut and fill, gone with it", () => {
  const v = { kind: "volume", id: "nPad1", name: "Drivhus", shape: "box", from: [-5, -62], to: [5, -62], width: 10, height: 4 };
  const c = add([], v), m = applyEdits(site, floors, c), a = m.site.added.find(x => x.id === "nPad1"), g = a.ground;
  assert.ok(g && g.cut_m3 + g.fill_m3 > 0, "some ground is moved");
  assert.equal(g.kote, Math.round(a.base_kote * 100) / 100);
  assert.notEqual(m.site.terrain.z, site.terrain.z, "the after has its own grid");
  const at = p => groundAt(m.site, p);
  for (const p of [[-5, -62], [5, -62], [0, -67.5], [0, -56.5]]) assert.ok(Math.abs(at(p) - a.base_kote) < 0.6, `level on the pad at ${p}`);
  /* the slope: never steeper than 1:2 from the pad's edge, and the ground far off as it was */
  assert.equal(groundAt(m.site, [80, 80]), groundAt(site, [80, 80]));
  const before = site.terrain.z.slice();
  const moved = applyEdits(site, floors, [...c, checkEdit(m.site, m.floors, { kind: "reshape", id: "nPad1", from: [-25, -62], to: [-15, -62] })]);
  assert.ok(Math.abs(groundAt(moved.site, [0, -62]) - groundAt(site, [0, -62])) < 0.01, "moved: the old pad is gone");
  const undone = applyEdits(site, floors, []);
  assert.equal(undone.site.terrain.z, site.terrain.z, "undone: the before's grid");
  assert.deepEqual(site.terrain.z, before, "the before is never written");
  assert.match(groundText(g), /planeres på kote/);
});

/* U3566 (f): on a slope the foot goes where what is dug out fills the rest, not on the lowest ground */
test("a new building's foot balances its pad's cut and fill; a kote asked is kept", () => {
  const v = { kind: "volume", id: "nBal", name: "Hus", shape: "box", from: [50, 40], to: [70, 40], width: 12, height: 6 };
  const a = applyEdits(site, floors, add([], v)).site.added[0], g = a.ground;
  assert.ok(Math.abs(g.cut_m3 - g.fill_m3) <= 0.2 * Math.max(g.cut_m3, g.fill_m3), `balanced: ${g.cut_m3} out, ${g.fill_m3} in`);
  const low = Math.min(...[[50, 34], [70, 34], [50, 46], [70, 46], [60, 40]].map(p => groundAt(site, p)));
  assert.ok(a.base_kote > low + 0.5, "over the lowest ground");
  assert.equal(g.balanced, true); assert.match(groundText(g), /det som graves ut fyller resten/);
  const l = applyEdits(site, floors, add([], { ...v, base_kote: Math.round(low * 10) / 10 })).site.added[0];
  assert.equal(l.base_kote, Math.round(low * 10) / 10, "a kote asked is the kote"); assert.ok(l.ground.cut_m3 > 3 * g.cut_m3, `on the lowest it digs: ${l.ground.cut_m3} m³`);
});
