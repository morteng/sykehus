/* The high block's south-west end (210°), as the wishes of 2026-10-28 describe it (wRkafPSR5DS, w6_3xCgLV3U, wrAHKl9gB-e, wxp5aF4qJLt):
   the middle part steps in side to side, nothing on that end has a window, and a balcony runs between the side parts on storeys 2 to 14.
   tools/sb-sw.py writes it into site.json; tools/ifc.py and tools/glb.py make sykehus.ifc and hoyblokka.glb from that. The same
   model must come through a version that tears everything else down. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseIfc, withoutBuildings, stepText } from "../ifcfilter.mjs";
import { applyEdits } from "../public/edits.js";
import { readGlb } from "../public/bimglb.js";

const read = f => readFileSync(new URL("../" + f, import.meta.url));
const site = JSON.parse(read("public/data/site.json")), floors = JSON.parse(read("public/data/floors.json")).floors;
const sb = site.buildings.find(b => b.id === "sentralblokka");
const base = parseIfc(read("public/data/sykehus.ifc").toString("utf8"));
const BACK = [-29.46, -35.83, -39.64, -29.47];

/* site metres from the end's own axes: t along the end from its SE corner, s out from the side parts' face (negative = in) */
const O = [-23.74, -41.77], D = [-0.848, 0.53], N = [-0.53, -0.848];
const ts = ([x, y]) => [(x - O[0]) * D[0] + (y - O[1]) * D[1], (x - O[0]) * N[0] + (y - O[1]) * N[1]];

test("the middle part is recessed: no box stands out between the side parts, one back face joins them 2 m in", () => {
  const near = ([x, y]) => { const [t, s] = ts([x, y]); return t > 10.5 && t < 17.5 && s > -1.5; };
  assert.equal(sb.ring.filter(near).length, 0, "an outline corner where the box stood");
  assert.equal(sb.blocks.filter(k => k.p.every(near)).length, 0, "the box's roof block");
  assert.equal(sb.walls.filter(w => near([w[0], w[1]]) && near([w[2], w[3]])).length, 0, "a wall of the box");
  const back = sb.walls.filter(w => w.slice(0, 4).every((v, i) => Math.abs(v - BACK[i]) < 0.01));
  assert.equal(back.length, 1);
  assert.deepEqual(ts(BACK.slice(0, 2)).map(Math.round), [8, -2]); assert.deepEqual(ts(BACK.slice(2)).map(Math.round), [20, -2]);
});

test("every blind wall is a wall of the building, and the whole south-west end is among them", () => {
  const key = w => w.slice(0, 4).join(",");
  assert.ok(sb.blind.length >= 10, `${sb.blind.length} blind walls`);
  for (const w of sb.blind) assert.ok(sb.walls.some(x => key(x) === key(w)), `blind wall ${key(w)} is not a wall`);
  /* the end's own faces: the side parts' and the recess's back face */
  for (const w of [[-23.74, -41.77, -30.52, -37.53], [-40.7, -31.17, -46.64, -27.46], BACK]) assert.ok(sb.blind.some(x => key(x) === key(w)), `the end face ${key(w)}`);
});

/* every window of the GLB is a box: its glass centre, found as one connected piece */
function windowCentres() {
  const b = read("public/data/hoyblokka.glb"), parts = readGlb(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)), g = parts.find(p => p.material === "window_glass");
  const par = new Map(), f = x => { while (par.get(x) !== x) { par.set(x, par.get(par.get(x))); x = par.get(x); } return x; };
  for (const k of new Set(g.indices)) par.set(k, k);
  for (let i = 0; i < g.indices.length; i += 3) { par.set(f(g.indices[i]), f(g.indices[i + 1])); par.set(f(g.indices[i]), f(g.indices[i + 2])); }
  const by = new Map(); for (const k of new Set(g.indices)) { const r = f(k); (by.get(r) || by.set(r, []).get(r)).push(k); }
  return [...by.values()].map(ks => { const c = [0, 0, 0]; for (const k of ks) for (let d = 0; d < 3; d++) c[d] += g.positions[k * 3 + d] / ks.length; return [c[0], -c[2], c[1]]; });   // east, north, kote
}
test("the model has no window on the south-west end, and still has them on the other sides", () => {
  const w = windowCentres(), end = w.filter(c => { const [t, s] = ts(c); return t > 1 && t < 26.5 && s > -5.5 && s < 1; });
  assert.equal(end.length, 0, `${end.length} windows on the south-west end`);
  const sideSE = w.filter(c => { const [t, s] = ts(c); return t < 0.6 && t > -0.9 && s < -10; }), sideNW = w.filter(c => { const [t, s] = ts(c); return t > 26 && s < -10; });
  assert.ok(sideSE.length > 200 && sideNW.length > 200, `long faces: ${sideSE.length} and ${sideNW.length} windows`);
  assert.ok(w.filter(c => ts(c)[1] < -90).length > 200, "the north-east end keeps its windows");
});

import { checkEdit } from "../public/edits.js";
const named = (p, type, name) => [...p.ents.values()].filter(e => e.type === type && stepText(/^'[^']*',[^,]*,'((?:[^']|'')*)'/.exec(e.args)?.[1] || "") === name);
const SLABS = (m, face) => m.site.added.flatMap(a => a.parts).filter(p => p.role === "slab" && p.face === face);
const onBack = p => p.axis.every(q => { const [t, s] = ts(q); return t > 7.9 && t < 20.1 && Math.abs(s + 2) < 0.15; });   // the recess back face: 2 m in, between the side parts
test("the base model has no balcony (the real building has none there), and no balcony part at the SW end", () => {
  assert.equal(sb.balconies, undefined);
  assert.equal(named(base, "IFCSLAB", "Balkongdekke").length, 0); assert.equal([...base.ents.values()].filter(e => e.type === "IFCRAILING").length, 0);
  assert.equal(applyEdits(site, floors, []).site.added?.length ?? 0, 0, "a version with no balconies edit has no added part");
});

test("a balconies edit on face 210 (wish wxp5aF4qJLt) stands on the recess back wall, storeys 2 to 14, though the walls are blind", () => {
  const e = checkEdit(site, floors, { kind: "balconies", wing: "Sentralblokka", face: 210, from_storey: "2", to_storey: "14" });
  const m = applyEdits(site, floors, [e]), slabs = SLABS(m, 210), back = slabs.filter(onBack);
  assert.ok(back.length > 0, `slabs ${slabs.length}, on the back wall ${back.length}`);
  const kotes = [...new Set(back.map(p => Math.round(p.profile[2][1] * 100) / 100))].sort((a, b) => a - b);
  assert.equal(kotes.length, 13, "storeys 2 to 14: " + kotes.join(" ")); assert.equal(kotes[0], 20.28); assert.equal(kotes.at(-1), 65.64);
  assert.equal(back.length, 65, "5 balconies of 1.9 m (gap 0.6) on the 12 m back wall, on each of 13 storeys"); assert.equal(slabs.length, 143, "all the face-210 walls with a balcony every 2.5 m");
  const t0 = back.map(p => ts(p.axis[0])[0]).sort((a, b) => a - b); assert.ok(Math.abs(t0[0] - 8.05) < 0.1 && Math.abs(Math.max(...back.map(p => ts(p.axis[1])[0])) - 19.95) < 0.1, "first slab from t 8.05, last to t 19.95 m");
  const rails = m.site.added.flatMap(a => a.parts).filter(p => p.role === "railing");
  assert.ok(rails.length >= back.length, "a railing for each slab");
  /* what stands in the middle: every slab centre between the side parts' ends, t 8 to 20 m */
  for (const p of back) { const t = (ts(p.axis[0])[0] + ts(p.axis[1])[0]) / 2; assert.ok(t > 8 && t < 20, `slab centre t=${t}`); }
  globalThis.__sbsw = { all: slabs.length, back: back.length, per_storey: back.length / 13 };
});

test("a version that tears everything else down keeps the corrected block, and a balconies edit still lands there", () => {
  const m = applyEdits(site, floors, [{ kind: "demolish", building: "alle" }, { kind: "restore", building: "Sentralblokka" }]);
  assert.deepEqual([...new Set(m.site.buildings.filter(b => b.own).map(b => b.wing))], ["sentralblokka"], "only the high block is left of the hospital");
  const k = m.site.buildings.find(b => b.id === "sentralblokka");
  assert.deepEqual(k.blind, sb.blind); assert.equal(k.walls.length, sb.walls.length);
  const left = new Set(m.site.buildings.map(b => b.wing).filter(Boolean)), gone = site.wings.filter(w => !left.has(w.id) && site.buildings.some(b => b.wing === w.id)).map(w => w.name);
  assert.ok(gone.length >= 10 && !gone.includes("Sentralblokka"), gone.join(", "));
  const after = parseIfc(withoutBuildings(base, gone).text);
  assert.equal([...after.ents.values()].filter(e => e.type === "IFCBUILDING").length, 1);
  assert.equal([...after.ents.values()].filter(e => e.type === "IFCWINDOW").length, windowCentres().length, "the high block's windows, all of them and no others");
  const e = checkEdit(m.site, m.floors, { kind: "balconies", wing: "Sentralblokka", face: 210, from_storey: "2", to_storey: "14" });
  assert.ok(SLABS(applyEdits(site, floors, [{ kind: "demolish", building: "alle" }, { kind: "restore", building: "Sentralblokka" }, e]), 210).filter(onBack).length > 0);
});

import { facadeNames, faceAlias } from "../public/design.js";
test("«sørsiden» of Sentralblokka is face 210, and the other sides have their names from their bearings; other wings are as they were", () => {
  assert.deepEqual(facadeNames(site, "sentralblokka").map(f => [f.bearing, f.name]).sort((a, b) => a[0] - b[0]),
    [[30, "nordsiden"], [120, "østsiden"], [210, "sørsiden"], [300, "vestsiden"]]);
  for (const w of ["sørsiden", "Sørsiden", "sør", "SØR", " sorsiden "]) assert.equal(faceAlias(site, "sentralblokka", w), 210, w);
  assert.equal(faceAlias(site, "sentralblokka", "nord"), 30); assert.equal(faceAlias(site, "sentralblokka", "øst"), 120); assert.equal(faceAlias(site, "sentralblokka", 210), 210);
  for (const [w, b] of [["nordsiden", 30], ["Nord", 30], ["østsiden", 120], ["ØST", 120], ["ost", 120], ["vestsiden", 300], ["vest", 300], ["VESTSIDEN", 300]]) assert.equal(faceAlias(site, "sentralblokka", w), b, w);
  assert.equal(faceAlias(site, "ostfloy", "sørsiden"), "sørsiden", "another wing keeps the word, and checkEdit refuses it as before");
  assert.deepEqual(facadeNames(site, "ostfloy"), []);
  const num = checkEdit(site, floors, { kind: "balconies", wing: "Sentralblokka", face: 210 }), named = checkEdit(site, floors, { kind: "balconies", wing: "Sentralblokka", face: "sørsiden" });
  assert.deepEqual(named, num, "the same edit stored");
  assert.equal(checkEdit(site, floors, { kind: "balconies", wing: "Sentralblokka", face: "sør" }).face, 210);
  assert.throws(() => checkEdit(site, floors, { kind: "balconies", wing: "ostfloy", face: "sørsiden" }));
});

test("part: «midten» limits a balconies edit to the recessed middle back wall of the sørsiden: 5 a storey on 13 storeys, none on the side parts", () => {
  const e = checkEdit(site, floors, { kind: "balconies", wing: "Sentralblokka", part: "midten", from_storey: "2", to_storey: "14" });
  assert.equal(e.part, "midten"); assert.equal(e.face, 210);
  const slabs = SLABS(applyEdits(site, floors, [e]), 210);
  assert.equal(slabs.length, 65); assert.equal(slabs.filter(onBack).length, 65, "every slab on the back wall, none on a side part");
  assert.deepEqual(checkEdit(site, floors, { kind: "balconies", wing: "Sentralblokka", part: "midtpartiet", from_storey: "2", to_storey: "14" }), e);
  assert.throws(() => checkEdit(site, floors, { kind: "balconies", wing: "ostfloy", part: "midten" }), /ingen del/);
  assert.throws(() => checkEdit(site, floors, { kind: "balconies", wing: "Sentralblokka", part: "midten", face: 120 }), /sørsiden/);
});

test("along: [t0, t1] limits a balconies edit to metres along the facade from its left end seen from outside", () => {
  const all = SLABS(applyEdits(site, floors, [checkEdit(site, floors, { kind: "balconies", wing: "Sentralblokka", face: 210, from_storey: "2", to_storey: "14" })]), 210);
  const e = checkEdit(site, floors, { kind: "balconies", wing: "Sentralblokka", face: 210, from_storey: "2", to_storey: "14", along: [0, 12] });
  assert.deepEqual(e.along, [0, 12]);
  const some = SLABS(applyEdits(site, floors, [e]), 210);
  assert.ok(some.length > 0 && some.length < all.length, `${some.length} of ${all.length}`);
  assert.equal(some.length % 13, 0, "the same on each storey");
  assert.throws(() => checkEdit(site, floors, { kind: "balconies", wing: "Sentralblokka", face: 210, along: [5, 2] }), /along er/);
  assert.throws(() => checkEdit(site, floors, { kind: "balconies", wing: "Sentralblokka", face: 210, along: [40, 50] }), /ingen fasade/);
});
