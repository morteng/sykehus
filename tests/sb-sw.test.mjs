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

const named = (p, type, name) => [...p.ents.values()].filter(e => e.type === type && stepText(/^'[^']*',[^,]*,'((?:[^']|'')*)'/.exec(e.args)?.[1] || "") === name);
test("balconies on storeys 2 to 14: a slab and a railing a floor, in the base model", () => {
  assert.equal(named(base, "IFCSLAB", "Balkongdekke").length, 13); assert.equal(named(base, "IFCRAILING", "Rekkverk").length, 13);
});

test("a version that tears everything else down keeps the corrected block: the balconies, the windows, nothing on the end's blind walls", () => {
  const m = applyEdits(site, floors, [{ kind: "demolish", building: "alle" }, { kind: "restore", building: "Sentralblokka" }]);
  const kept = m.site.buildings.filter(b => b.wing === "sentralblokka");
  assert.deepEqual([...new Set(m.site.buildings.filter(b => b.own).map(b => b.wing))], ["sentralblokka"], "only the high block is left of the hospital");
  const k = kept.find(b => b.id === "sentralblokka");
  assert.deepEqual(k.blind, sb.blind); assert.deepEqual(k.balconies, sb.balconies); assert.equal(k.walls.length, sb.walls.length);
  const left = new Set(m.site.buildings.map(b => b.wing).filter(Boolean)), gone = site.wings.filter(w => !left.has(w.id) && site.buildings.some(b => b.wing === w.id)).map(w => w.name);
  assert.ok(gone.length >= 10 && !gone.includes("Sentralblokka"), gone.join(", "));
  const after = parseIfc(withoutBuildings(base, gone).text);
  assert.equal(named(after, "IFCSLAB", "Balkongdekke").length, 13); assert.equal(named(after, "IFCRAILING", "Rekkverk").length, 13);
  assert.equal([...after.ents.values()].filter(e => e.type === "IFCBUILDING").length, 1);
  assert.equal([...after.ents.values()].filter(e => e.type === "IFCWINDOW").length, windowCentres().length, "the high block's windows, all of them and no others");
});
