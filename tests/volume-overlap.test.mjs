/* U3837: new volumes that share space are flagged (plan and height), join makes the overlap on purpose, cut takes one out of the other.
   node --test tests/volume-overlap.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkEdit, applyEdits } from "../public/edits.js";
import { checkFit, volumeOverlaps } from "../public/design.js";
import { needsExpand, expandChange } from "../editkit.mjs";

const site = JSON.parse(readFileSync(new URL("../public/data/site.json", import.meta.url)));
const floors = JSON.parse(readFileSync(new URL("../public/data/floors.json", import.meta.url))).floors;
const klubb = { kind: "volume", id: "nklubb", name: "Nattklubb", shape: "box", material: "concrete", from: [-10, -80], to: [14, -80], width: 10, height: 8, base_kote: 20 };
const hus = { kind: "volume", id: "ndrivhus", name: "Drivhus", shape: "box", material: "glass", from: [10, -84], to: [24, -84], width: 8, height: 4, base_kote: 20 };
const build = (...es) => { let edits = []; for (const e of es) { const m = applyEdits(site, floors, edits); edits = [...edits, ...(e.kind === "volume" || e.kind === "reshape" || e.kind === "demolish" ? [checkEdit(m.site, m.floors, e)] : [])]; } return { edits, m: applyEdits(site, floors, edits) }; };

test("two volumes that share space are flagged with m², height and m³; check_fit says so", () => {
  const { m } = build(klubb, hus), o = volumeOverlaps(m.site);
  assert.equal(o.length, 1);
  assert.equal(o[0].m2, 20);   // x 10..14 (4 m), y -85..-80 (5 m: the club starts at -85, the greenhouse ends at -80)
  assert.equal(o[0].height_m, 4); assert.ok(o[0].volume_m3 > 0);
  assert.match(o[0].say, /Nattklubb.*Drivhus.*overlapper/);
  const f = checkFit(m.site); assert.equal(f.ok, false); assert.equal(f.volume_overlaps.length, 1); assert.match(f.say, /Nattklubb/);
});
test("the same two, one stacked on the other (touching in height), are not flagged", () => {
  const { m } = build(klubb, { ...hus, base_kote: 28 });
  assert.deepEqual(volumeOverlaps(m.site), []);
});
test("join makes them one set with the overlap on purpose: no longer flagged", () => {
  const { edits } = build(klubb, hus);
  assert.ok(needsExpand({ kind: "join", ids: ["nklubb", "ndrivhus"] }, edits));
  const ex = expandChange({ kind: "join", ids: ["nklubb", "ndrivhus"], name: "Kasino" }, edits, applyEdits(site, floors, edits).site);
  assert.equal(ex.length, 2); assert.ok(ex.every(x => x.kind === "reshape" && x.group === "Kasino" && x.allow_overlap === true));
  const m0 = applyEdits(site, floors, edits); const checked = ex.map(x => checkEdit(m0.site, m0.floors, x));
  const m = applyEdits(site, floors, [...edits, ...checked]);
  assert.deepEqual(volumeOverlaps(m.site), []);
  assert.throws(() => expandChange({ kind: "join", ids: ["nklubb"] }, edits, m.site), /to eller flere/);
});
test("cut takes the drivhus out of the club: what is left no longer overlaps and the cutter stays", () => {
  const { edits, m } = build(klubb, hus);
  const ex = expandChange({ kind: "cut", id: "nklubb", by: "ndrivhus" }, edits, m.site);
  assert.ok(ex.some(x => x.kind === "reshape" && x.id === "nklubb"));
  const m0 = applyEdits(site, floors, edits); let cur = edits;
  for (const x of ex) { const mm = applyEdits(site, floors, cur); cur = [...cur, checkEdit(mm.site, mm.floors, x)]; }
  const after = applyEdits(site, floors, cur);
  assert.deepEqual(volumeOverlaps(after.site), []);
  const club = after.site.added.filter(a => /^Nattklubb/.test(a.name)), vol = club.reduce((t, a) => t + a.footprint_m2 * a.height, 0);
  assert.equal(Math.round(vol), 24 * 10 * 8 - 4 * 5 * 4, "the club's volume minus the part the greenhouse took");
  assert.ok(after.site.added.some(a => a.id === "ndrivhus"));
});
test("cut with nothing shared, or a cutter that is not there, is refused", () => {
  const far = { ...hus, from: [60, -84], to: [74, -84] }, { edits, m } = build(klubb, far);
  assert.throws(() => expandChange({ kind: "cut", id: "nklubb", by: "ndrivhus" }, edits, m.site), /overlapper ikke/);
  assert.throws(() => expandChange({ kind: "cut", id: "nklubb", by: "ingen" }, edits, m.site), /Fant ikke/);
});
