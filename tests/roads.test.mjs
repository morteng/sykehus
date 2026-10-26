/* a road section taken away like a building (U3543, Morten 2026-10-26 09:47Z «yes to all questions»): the edit, the
   after, and the ways tagged with the ids a removal names, through renderkit's own streetsFrom */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyEdits, checkEdit } from "../public/edits.js";
import { streetsFrom } from "../public/renderkit/streets.js";
import { tagStreets } from "../public/roads.js";

const site0 = JSON.parse(readFileSync(new URL("../public/data/site.json", import.meta.url))), floors0 = [];
const after = edits => applyEdits(site0, floors0, edits).site;
const check = (edits, e) => checkEdit(after(edits), floors0, e);

test("demolish a road section: kept by its id and name, nothing of the hospital torn down; restore puts it back", () => {
  const e = check([], { kind: "demolish", building: "vei-osm-24365596", name: "Welhavens gate", why: "fjernet på siden" });
  assert.deepEqual(e, { kind: "demolish", building: "vei-osm-24365596", name: "Welhavens gate", why: "fjernet på siden" });
  const s = after([e]);
  assert.deepEqual(s.roads_removed, [{ id: "vei-osm-24365596", name: "Welhavens gate" }]);
  assert.ok(!s.demolished?.length, "no building is torn down");
  assert.equal(s.buildings.length, site0.buildings.length);
  const r = check([e], { kind: "restore", building: "vei-osm-24365596" });
  assert.equal(after([e, r]).roads_removed, undefined);
  assert.equal(after([]).roads_removed, undefined, "Angre: the edit taken out, the road is back");
  const two = after([e, check([e], { kind: "demolish", building: "vei-nvdb-940340722" })]);
  assert.deepEqual(two.roads_removed.map(x => x.id), ["vei-osm-24365596", "vei-nvdb-940340722"]);
  assert.throws(() => check([], { kind: "demolish", building: "vei-osm-12x" }), /Fant ikke/);   // not of the form: a building's name then, and there is none
  assert.throws(() => check([], { kind: "demolish", building: "vei-osm-1", name: "x".repeat(81) }), /Navnet/);
});

test("a building's demolish beside a road's: each goes its own way", () => {
  const s = after([{ kind: "demolish", building: "vei-osm-1" }, { kind: "demolish", building: "Østfløy" }]);
  assert.equal(s.roads_removed.length, 1);
  assert.ok(s.demolished.length >= 1 && s.demolished.every(d => !/^vei-/.test(d.id)));
});

/* a small answer of the shape hagekart's /api/streets and /api/nvdb give (osm and nvdb ids on each feature) */
const L = (x, y) => [10.197 + x * 1e-4, 59.7488 + y * 1e-4];
const osm = { features: [
  { properties: { osm: 101, highway: "unclassified", name: "Welhavens gate" }, geometry: { type: "LineString", coordinates: [L(0, 0), L(5, 0)] } },
  { properties: { osm: 102, highway: "footway", footway: "sidewalk" }, geometry: { type: "LineString", coordinates: [L(0, 1), L(5, 1)] } },
  { properties: { osm: 103, amenity: "parking" }, geometry: { type: "LineString", coordinates: [L(0, 3), L(2, 3), L(2, 4), L(0, 4), L(0, 3)] } },
  { properties: { osm: 104, highway: "street_lamp" }, geometry: { type: "Point", coordinates: L(1, 2) } },
  { properties: { osm: 105, highway: "residential", name: "Konggata" }, geometry: { type: "LineString", coordinates: [L(0, 10), L(5, 10)] } },
] };
const nv = { features: [
  { properties: { nvdb: 901, t: "dekke", Dekkebredde: 7 }, geometry: { type: "LineString", coordinates: [L(0, 10), L(2.5, 10), L(5, 10)] } },
  { properties: { nvdb: 902, t: "linje" }, geometry: { type: "LineString", coordinates: [L(1, 10), L(4, 10)] } },
] };
const toUtm = ([lon, lat]) => [(lon - 10.197) * 56000, (lat - 59.7488) * 111000];

test("every way renderkit makes gets the id of the feature it came from; markings know the way under them", () => {
  const sts = streetsFrom(osm, nv, toUtm), ways = tagStreets(osm, nv, sts, toUtm);
  const all = sts.filter(p => ["road", "path", "parking"].includes(p.kind));
  assert.ok(all.length >= 4);
  assert.ok(all.every(p => /^vei-(osm|nvdb)-\d+$/.test(p.id)), "a way left without an id cannot be removed: renderkit no longer keeps a feature's coordinates?");
  assert.deepEqual(ways.map(w => w.id).sort(), ["vei-nvdb-901", "vei-osm-101", "vei-osm-102", "vei-osm-103"]);   // Konggata (105) is NVDB's measured one now
  assert.equal(ways.find(w => w.id === "vei-osm-101").name, "Welhavens gate");
  assert.equal(ways.find(w => w.id === "vei-nvdb-901").name, "Konggata", "the measured carriageway takes the street's name");
  assert.equal(sts.find(p => p.kind === "nvdb" && p.t === "linje").on, "vei-nvdb-901");
});
