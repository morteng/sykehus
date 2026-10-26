/* U3616: the ground as a builder moves it: an area planed to a level with a batter or a wall, a pool dug as a basin with
   its water flat, a pond at its lowest edge; the cut and fill said; undone by taking the edit out; in the IFC */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyEdits, checkEdit } from "../public/edits.js";
import { gradingText, basinText } from "../public/grading.js";
import { groundAt } from "../public/renderkit/fit.js";
import { parseIfc, withoutBuildings } from "../ifcfilter.mjs";
import { withAdded } from "../ifcadd.mjs";

const site0 = JSON.parse(readFileSync(new URL("../public/data/site.json", import.meta.url)));
const after = edits => applyEdits(site0, [], edits).site;
const check = (edits, e) => checkEdit(after(edits), [], e);
const sq = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
/* the slope east of the lot's middle: 17.4 at x 60, 21.8 at x 72 (y 16) */
const terrace = { kind: "ground", ring: sq(60, 28, 14, 10), name: "Terrasse" };
const pool = { kind: "surface", surface: "water", pool: true, ring: sq(60, 16, 10, 4), name: "Basseng" };

test("a terrace on the slope: level at the kote where cut and fill meet, a 1:2 batter, the m³ said", () => {
  const s = after([check([], terrace)]), g = s.grading[0];
  assert.equal(g.id, "terreng-1"); assert.equal(g.balanced, true);
  assert.ok(Math.abs(g.cut_m3 - g.fill_m3) <= 0.15 * g.cut_m3 + 5, `balanced: ${g.cut_m3} / ${g.fill_m3}`);
  assert.ok(g.cut_m3 > 20 && g.reach_m > 1, `${g.cut_m3} m³, reach ${g.reach_m}`);
  for (const p of [[63, 31], [70, 35]]) assert.equal(groundAt(s, p), g.kote, `level at ${p}`);
  assert.notEqual(groundAt(s, [63, 31]), groundAt(site0, [63, 31]), "the before's ground is not the after's");
  assert.equal(site0.terrain.z, JSON.parse(readFileSync(new URL("../public/data/site.json", import.meta.url))).terrain.z.length && site0.terrain.z, "the before's grid is the same array");
  assert.match(gradingText(g), /^Terrasse: planeres på kote \+\d+,\d .*skråning 1:2 .*Utgraving \d+ m³, fylling \d+ m³/);
});

test("a kote, a fall and a wall: the ground outside stays, the wall's height is said", () => {
  const e = check([], { ...terrace, kote: 19, fall: 50, fall_toward: "V", edge: "wall" }), s = after([e]), g = s.grading[0];
  assert.deepEqual([g.kote, g.fall, g.fall_toward, g.edge, g.balanced], [19, 50, "V", "wall", false]);
  assert.ok(g.wall_m > 1, `a wall ${g.wall_m} m`); assert.equal(g.reach_m, 0);
  assert.equal(groundAt(s, [80, 33]), groundAt(site0, [80, 33]), "outside as it was");
  assert.ok(Math.abs(groundAt(s, [71, 33]) - groundAt(s, [61, 33]) - 10 / 50) < 1e-6, "falls 1:50 to the west: 10 m east is 20 cm higher");
  assert.match(gradingText(g), /fall 1:50 mot vest; en støttemur/);
  assert.throws(() => check([], { ...terrace, edge: "fence" }), /edge er batter/);
  assert.throws(() => check([], { ...terrace, ring: sq(0, 0, 1, 1) }), /mellom 4 og 20 000 m²/);
});

test("a pool on the slope: water flat at its own level under the coping, the basin dug, the surround level", () => {
  const s = after([check([], pool)]), w = s.landscape[0], b = w.basin;
  assert.equal(w.level, Math.round((b.kote - 0.15) * 100) / 100); assert.equal(b.bottom, Math.round((b.kote - 1.4) * 100) / 100);
  assert.equal(b.hole_m3, 56, "10 × 4 × 1.4"); assert.ok(b.cut_m3 > b.hole_m3 && b.fill_m3 > 0);
  const near = (a, b, what) => assert.ok(Math.abs(a - b) < 1e-6, `${what}: ${a} ≠ ${b}`);
  near(groundAt(s, [65, 18]), b.bottom, "the floor");
  assert.match(basinText(w), /Bassenget graves 1,4 m dypt .*vannet står flatt på kote/);
  const d = check([pool], { kind: "reshape", id: "flate-1", depth: 2, kote: 20 }), b2 = after([pool, d]).landscape[0].basin;
  assert.deepEqual([b2.depth, b2.kote, b2.bottom, b2.balanced], [2, 20, 18, false]);
  assert.throws(() => check([], { kind: "surface", surface: "grass", ring: sq(0, 0, 5, 5), depth: 1 }), /gjelder bare vann/);
});

test("a pond lies at the lowest ground on its edge; no pool fields needed", () => {
  const s = after([check([], { kind: "surface", surface: "water", ring: sq(60, 16, 10, 4) })]), w = s.landscape[0];
  const lowest = Math.min(...[[60, 16], [70, 16], [70, 20], [60, 20], [65, 16]].map(p => groundAt(site0, p)));
  assert.ok(w.level <= lowest + 1e-9 && w.level > lowest - 1, `${w.level} at the low edge ${lowest}`);
  assert.equal(w.basin.fill_m3, 0); assert.ok(w.basin.cut_m3 > 0);
});

test("undo: demolish terreng-1 puts the ground back; reshape moves its kote", () => {
  const e = check([], terrace), s1 = after([e, check([e], { kind: "demolish", building: "terreng-1" })]);
  assert.ok(!s1.grading); assert.equal(groundAt(s1, [63, 31]), groundAt(site0, [63, 31]));
  const s2 = after([e, check([e], { kind: "reshape", id: "terreng-1", kote: 21 })]);
  assert.equal(s2.grading[0].kote, 21); assert.equal(groundAt(s2, [63, 31]), 21);
  assert.throws(() => check([], { kind: "reshape", id: "terreng-1", kote: 21 }), /Fant ikke «terreng-1»/);
});

test("the IFC: the moved ground as TERRAIN with its m³, the pool's water on the site", () => {
  const base = parseIfc(readFileSync(new URL("../public/data/sykehus.ifc", import.meta.url), "utf8"));
  const m = after([check([], terrace), check([], pool)]), { text } = withAdded(withoutBuildings(base, []).text, base, m, site0);
  const geo = text.split("\n").filter(l => /=IFCGEOGRAPHICELEMENT\(/.test(l));
  assert.equal(geo.length, 2); assert.match(geo[0], /'Terreng etter'.*\.TERRAIN\.\);$/); assert.match(geo[1], /'Basseng',\$,'Vann'.*\.USERDEFINED\.\);$/);
  assert.match(text, /IFCPROPERTYSINGLEVALUE\('Utgraving',\$,IFCLABEL\('\d+ m\\X2\\00B3\\X0\\'\)/);
  assert.match(text, /IFCRELCONTAINEDINSPATIALSTRUCTURE\('[^']+',\$,\$,\$,\(#\d+,#\d+\),#14\);/, "contained in the site (#14)");
  assert.equal(withAdded(withoutBuildings(base, []).text, base, after([]), site0).text, withoutBuildings(base, []).text, "nothing moved, nothing added");
});
