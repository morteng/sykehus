/* A few good shots of a version (U3527, shots.mjs): what they are, in what order, each one a view the page keeps.
   node --test tests/shots.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkEdit, applyEdits } from "../public/edits.js";
import { planShots, nearestPlace } from "../shots.mjs";
import { VIEW_SPEC } from "../public/saved.js";
import { addView } from "../public/renderkit/views.js";

const site = JSON.parse(readFileSync(new URL("../public/data/site.json", import.meta.url)));
const floors = JSON.parse(readFileSync(new URL("../public/data/floors.json", import.meta.url))).floors;
const add = (edits, e) => { const m = applyEdits(site, floors, edits); edits.push(checkEdit(m.site, m.floors, e)); return edits; };
/* a street 80 m south of the new building, and a path nearer that is not a road */
const PLACES = [{ name: "Dronninggata", road: true, pts: [[-60, -142], [-31, -142], [0, -142]] }, { name: "Stien", road: false, pts: [[-31, -100]] }];

test("a new building and a torn-down wing: overview, the building from the street at eye level, before and after, plan", () => {
  const ed = add(add([], { kind: "volume", id: "nKontor", name: "Kontorbygg", shape: "box", from: [-46, -62], to: [-16, -62], width: 14, height: 12.8, storeys: 4 }), { kind: "demolish", building: "Østfløy" });
  const shots = planShots(applyEdits(site, floors, ed).site, site, PLACES);
  assert.deepEqual(shots.map(s => s.name), ["1 Oversikt", "2 Kontorbygg fra Dronninggata", "3 Før: Østfløy", "4 Etter: Østfløy revet", "5 Plan"]);
  const eye = shots[1].state;
  assert.equal(eye.cam, "eye"); assert.equal(eye.x, -31); assert.equal(eye.y, -62);
  assert.ok(Math.abs(eye.dist - 80) < 0.1, `${eye.dist} m: to the street, not the nearer path`);
  assert.ok(Math.abs(eye.yaw) < 1e-3, "standing south of it: yaw 0");
  assert.match(shots[1].state.caption, /Kontorbygg, 4 etasjer, 420 m² grunnflate, slik en som står i Dronninggata ser det: øyehøyde 1,7 m, 80 m unna, mot nord\./);
  assert.equal(shots[2].state.era, "før"); assert.equal(shots[3].state.era, "etter");
  assert.deepEqual({ ...shots[2].state, era: 0, caption: 0 }, { ...shots[3].state, era: 0, caption: 0 }, "the pair from the same place");
  assert.equal(shots[4].state.mode, "plan");
  assert.match(shots[0].state.caption, /Kontorbygg \(nytt\), Østfløy \(revet\)/);
  let l = []; for (const s of shots) l = addView(l, { name: s.name, state: s.state, by: "anton" }, VIEW_SPEC);
  assert.equal(l.length, 5); assert.ok(l.every(v => v.state.series === true && v.state.caption));
});

test("two new buildings and nothing torn down: each from the street; no named place near: from the first side with a clear view", () => {
  const ed = add(add([], { kind: "volume", id: "nKontor", name: "Kontorbygg", shape: "box", from: [-46, -62], to: [-16, -62], width: 14, height: 12.8, storeys: 4 }),
    { kind: "volume", id: "nSkur", name: "Skur", shape: "box", from: [150, 100], to: [156, 100], width: 4, height: 3 });
  const shots = planShots(applyEdits(site, floors, ed).site, site, PLACES);
  assert.deepEqual(shots.map(s => s.name), ["1 Oversikt", "2 Kontorbygg fra Dronninggata", "3 Skur fra sørvest", "4 Plan"]);
  assert.match(shots[2].state.caption, /70 m sørvest for det/);
});

test("nothing changed: the site from the air and the plan", () => {
  const shots = planShots(applyEdits(site, floors, []).site, site, []);
  assert.deepEqual(shots.map(s => s.name), ["1 Oversikt", "2 Plan"]); assert.match(shots[0].state.caption, /endrer ingen bygg/);
});

test("the nearest place: roads before paths, not inside a standing building, 30–260 m off", () => {
  assert.equal(nearestPlace(PLACES, [-31, -62]).name, "Dronninggata");
  assert.equal(nearestPlace([{ name: "Inne", road: true, pts: [[0, 0]] }], [0, 10]), null, "too near");
  assert.equal(nearestPlace([{ name: "Gate", road: true, pts: [[0, 50]] }], [0, 0], [[[-5, 45], [5, 45], [5, 55], [-5, 55]]]), null, "inside a building");
});
