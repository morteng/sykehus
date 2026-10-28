/* «Fasade» (public/fasade.js): the elevation's numbers are the model's, a changed number changes the drawing and the draft edits,
   and a stroke's screen point and its metres are one another's inverse.   node --test tests/fasade.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { facadeDrawing, sidesOf, editsFor, readRef, tryEdits, strokeToSite, strokeWords, toSvg } from "../public/fasade.js";
import { wingOf, checkEdit, applyEdits } from "../public/edits.js";
import { measureParts } from "../public/roof.js";
import { facadesOf } from "../public/design.js";
import { rowsOf, windowsOn, kindOf, WINDOWS } from "../public/bays.js";

const site = JSON.parse(readFileSync(new URL("../public/data/site.json", import.meta.url), "utf8"));
const draw = (s, o) => facadeDrawing(s, { focus: "sentralblokka", ...o }, wingOf);
const dim = (d, id) => d.dims.find(x => x.id === id);

test("the four sides have the names, south first, and each facade is as wide as the model says", () => {
  assert.deepEqual(sidesOf(site, "sentralblokka", wingOf).map(s => `${s.name} ${s.bearing}`), ["Sørsiden 210", "Østsiden 120", "Vestsiden 300", "Nordsiden 30"]);
  const A = measureParts(site, "sentralblokka", undefined, wingOf).a;
  const south = draw(site, { side: "Sørsiden" }), east = draw(site, { side: "Østsiden" });
  assert.ok(Math.abs(south.width_m - facadesOf(site, "sentralblokka").find(f => f.bearing === 210).length_m) < 8, "south = the short end");
  assert.ok(Math.abs(south.width_m - A.width_m) < 1.5, `south ${south.width_m} vs measureParts width ${A.width_m}`);
  assert.ok(Math.abs(east.width_m - A.length_m) < 1.5, `east ${east.width_m} vs measureParts length ${A.length_m}`);
  assert.equal(dim(south, "bredde").value, south.width_m);
  assert.match(dim(south, "bredde").text, /^\d+,\d\d m$/);
});

test("the storey lines are the wing's levels, with their kote", () => {
  const d = draw(site, { side: "Sørsiden" }), w = site.wings.find(x => x.id === "sentralblokka");
  for (const l of w.levels) assert.equal(dim(d, `kote:${l.name}`).value, l.kote);
  assert.equal(dim(d, "kote:2. etasje").text, "+20,28");
});

test("the windows are the bay rule's: a window count a side that matches the rule worked by hand", () => {
  const b = site.buildings.find(x => x.id === "sentralblokka"), kind = kindOf(b), rule = b.window_rule;
  const d = draw(site, { side: "Østsiden" });
  assert.ok(d.windows > 300, `windows ${d.windows}`);
  assert.equal(d.windows % WINDOWS[kind].length, 0, "windows come in the bay's pairs");
  const sample = d.sample; assert.ok(sample.z0 >= rule.from_kote, "none below window_rule.from_kote (the open ground storey)");
  const dd = dim(d, "vindu:bredde"); assert.equal(dd.value, Math.round((sample.x1 - sample.x0) * 100) / 100);
  assert.ok(WINDOWS.tower.some(g => Math.abs(g[2] - g[0] - dd.value) < 0.006), "the window is one of bays.js's tower panes");
});

test("a number with no edit kind is read only; a storey's kote is a level edit that checkEdit takes", () => {
  const d = draw(site, { side: "Sørsiden" });
  assert.equal(dim(d, "bredde").ref, null); assert.equal(dim(d, "vindu:høyde").ref, null);
  const ref = dim(d, "kote:3. etasje").ref; assert.deepEqual(ref, { kind: "level", wing: "sentralblokka", storey: "3. etasje" });
  const e = editsFor(site, ref, 24.5); assert.deepEqual(e, [{ kind: "level", wing: "sentralblokka", storey: "3. etasje", kote: 24.5, why: "endret på fasadetegningen" }]);
  assert.doesNotThrow(() => checkEdit(site, [], e[0]));
});

test("changing a number changes the drawing and the draft the same way", () => {
  const ref = { kind: "level", wing: "sentralblokka", storey: "3. etasje" }, edits = editsFor(site, ref, 24.5);
  const m = tryEdits(site, [], [], edits), after = draw(m.site, { side: "Sørsiden" });
  assert.equal(dim(after, "kote:3. etasje").value, 24.5); assert.equal(dim(after, "kote:3. etasje").text, "+24,50");
  assert.equal(dim(after, "høyde:2. etasje-3. etasje").value, 4.22);   // 24.5 - 20.28
  assert.equal(readRef(m.site, ref), 24.5);
  assert.equal(readRef(site, ref), 24.24, "the data is not touched");
  assert.equal(applyEdits(site, [], edits).site.wings[0].levels.find(l => l.name === "3. etasje").kote, 24.5);
  assert.throws(() => tryEdits(site, [], [], [{ ...edits[0], kote: 500 }]), /kote/i, "a refusal says why");
});

test("a new building's length, width and height are one reshape each, and show in the elevation", () => {
  const vol = { kind: "volume", id: "tilbygg", name: "Tilbygg", shape: "box", from: [10, 60], to: [30, 60], width: 6, height: 9, base_kote: 14.8, why: "test" };
  const withVol = tryEdits(site, [], [vol], []);   // not a change the person made here: the base
  const dr = draw(withVol.site, { side: "Nordsiden" });
  const id = (withVol.site.added || []).find(a => a.name === "Tilbygg")?.id; assert.ok(id, "the volume is in the model");
  const hRef = { kind: "volume", id, field: "height" }, h = readRef(withVol.site, hRef);
  const next = tryEdits(site, [], [vol], editsFor(withVol.site, hRef, h + 2));
  assert.equal(readRef(next.site, hRef), h + 2);
  const lRef = { kind: "volume", id, field: "length" }, e = editsFor(withVol.site, lRef, 24)[0];
  assert.equal(Math.hypot(e.to[0] - e.from[0], e.to[1] - e.from[1]).toFixed(2), "24.00");
  assert.equal(readRef(tryEdits(site, [], [vol], [e]).site, lRef), 24);
  void dr;
});

test("the pen: a point on the screen, in metres, and back; strokes go to the server as site metres", () => {
  const d = draw(site, { side: "Sørsiden" });
  for (const [t, z] of [[0, 20], [13.4, 45.2], [d.width_m, 70]]) { const [x, y] = d.toPx(t, z), [t2, z2] = d.toM(x, y); assert.ok(Math.abs(t - t2) < 1e-9 && Math.abs(z - z2) < 1e-9); }
  const w = d.world(5, 30), w2 = d.world(6, 30);
  assert.equal(w[2], 30); assert.ok(Math.abs(Math.hypot(w2[0] - w[0], w2[1] - w[1]) - 1) < 0.02, "one metre along the facade is one metre on the site");
  const s = strokeToSite({ colour: "#c8102e", pts: Array.from({ length: 100 }, (_, i) => [i / 10, 30]) }, d.world, "rød");
  assert.equal(s.colour, "rød"); assert.ok(s.points.length <= 41 && s.points.every(p => p.length === 3));
  assert.match(strokeWords([{ colour: "#c8102e", pts: [[1, 30], [4, 32]] }], d.face), /Strek 1 \(rød\): fra 1,00 m fra venstre, kote \+30,00/);
});

test("the SVG says what is drawn", () => {
  const svg = toSvg(draw(site, { side: "Sørsiden" }));
  assert.match(svg, /SENTRALBLOKKA · SØRSIDEN/); assert.match(svg, /\+20,28/); assert.ok(svg.startsWith("<svg"));
});

/* ---- the balconies: separate items; remove one, move one, put them back (the balconies edit, set + rev + exact) ---- */
import { initialLayout, layoutEdits, layoutFromEdits } from "../public/fasade.js";
import { replacesBuiltIn } from "../public/design.js";
const south = () => draw(site, { side: "Sørsiden" });
const slabsOf = d => d.items.map(i => `${i.storey}|${i.x0.toFixed(1)}|${i.x1.toFixed(1)}`).sort();
test("the built-in balconies are items, one a storey, and the model's replacesBuiltIn is false until an edit replaces them", () => {
  const d = south(); assert.equal(replacesBuiltIn(site), false);
  assert.equal(d.items.length, 13); assert.ok(d.items.every(i => i.built && i.kind === "balkong" && i.x1 - i.x0 > 8));
  assert.equal(initialLayout(d).length, 13);
});
test("«Fjern alle»: the remove edit takes the built-in set away in the model and the drawing", () => {
  const d = south(), [rm] = layoutEdits(d.face, "sentralblokka", [], 1);
  assert.doesNotThrow(() => checkEdit(site, [], rm));
  const m = tryEdits(site, [], [], [rm]); assert.equal(replacesBuiltIn(m.site), true);
  assert.equal(draw(m.site, { side: "Sørsiden" }).items.length, 0);
});
test("remove one, move one: the edits lay the same slabs the layout says, and «Tilbakestill» is no edit at all", () => {
  const d = south(), L = initialLayout(d), moved = L.slice(1).map((it, i) => i === 0 ? { ...it, storey: L[0].storey, t0: it.t0 + 0.4, t1: it.t1 - 0.4 } : it);   // the first removed, the second moved down to its place and made 0,8 m narrower
  const edits = layoutEdits(d.face, "sentralblokka", moved, 2);
  const m = tryEdits(site, [], [], edits), after = draw(m.site, { side: "Sørsiden" });
  assert.equal(after.items.length, 12, "one fewer");
  const want = moved.map(it => `${it.storey}|${it.t0.toFixed(1)}|${it.t1.toFixed(1)}`).sort(), got = slabsOf(after).map(s => s.replace(/^(.*)\|(.*)\|(.*)$/, "$1|$2|$3"));
  assert.equal(got.length, want.length);
  for (const w of want) { const [s, a, b] = w.split("|"); assert.ok(got.some(g => { const [gs, ga, gb] = g.split("|"); return gs === s && Math.abs(ga - a) < 0.35 && Math.abs(gb - b) < 0.35; }), `slab ${w} in the model`); }
  assert.deepEqual(layoutFromEdits(edits, d.face).length, 12, "the draft's own layout is read back");
  assert.equal(draw(tryEdits(site, [], [], []).site, { side: "Sørsiden" }).items.length, 13, "restored: no edit, the built-in set again");
  /* a layout laid again replaces the one before (newest rev), it does not add to it */
  const again = tryEdits(site, [], [], [...edits, ...layoutEdits(d.face, "sentralblokka", L.slice(0, 3), 3)]);
  assert.equal(draw(again.site, { side: "Sørsiden" }).items.length, 3);
});

/* ---- the gizmo (public/gizmo.js): the window rule, the snaps, a drag as the same edit a typed number makes ---- */
import { pickAt, marquee, choose, snapMove, snapPoint, handlesOf, handleAt, resizeRect, layoutItemOf, typedItem, distribute, arrayOf, selectAll } from "../public/gizmo.js";
const it = (id, x0, x1, z0, z1, extra = {}) => ({ id, kind: "balkong", x0, x1, z0, z1, ...extra });
const row = [it("a", 0, 3, 20.08, 20.28), it("b", 4, 7, 20.08, 20.28), it("c", 8, 11, 20.08, 20.28), it("d", 0, 3, 24.04, 24.24)];
test("window select: left to right takes what is wholly inside, right to left what it crosses; shift adds, and takes away when all are in", () => {
  assert.deepEqual(marquee(row, [-1, 19], [6, 21]).keys, ["a"], "inside: only a is wholly in");
  assert.deepEqual(marquee(row, [6, 21], [-1, 19]).keys, ["a", "b"], "crossing: b is touched");
  const l2r = marquee(row, [-1, 19], [8.5, 21]); assert.equal(l2r.dashed, false); assert.deepEqual(l2r.keys, ["a", "b"]);
  const r2l = marquee(row, [8.5, 21], [-1, 19]); assert.equal(r2l.dashed, true); assert.deepEqual(r2l.keys, ["a", "b", "c"], "crossing takes c too");
  assert.deepEqual(choose(["a"], ["b"], true), ["a", "b"]); assert.deepEqual(choose(["a", "b"], ["b"], true), ["a"]); assert.deepEqual(choose(["a"], ["c"], false), ["c"]);
  assert.equal(pickAt(row, [1, 20.2]).id, "a"); assert.equal(pickAt(row, [50, 50]), null);
  assert.deepEqual(selectAll(row.map((r, i) => ({ ...r, storey: i < 3 ? "2. etasje" : "3. etasje" })), "balkong", { storey: "2. etasje" }), ["a", "b", "c"]);
});
test("snaps: the storey line, a neighbour's edge, equal spacing, the grid, and none with Alt", () => {
  const lv = [20.28, 24.24], s = snapMove({ x0: 12.1, x1: 15.1, z0: 20.2, z1: 20.4 }, { levels: lv, others: row });
  assert.equal(s.rect.z1, 20.28); assert.ok(s.snaps.some(x => x.axis === "z" && x.word === "etasjeskille"));
  const eq = snapMove({ x0: 11.92, x1: 14.92, z0: 20.08, z1: 20.28 }, { levels: lv, others: row.slice(0, 3) });
  assert.equal(eq.rect.x0, 12, "gaps are 1 m: the next one goes 1 m from c"); assert.match(eq.snaps.find(x => x.axis === "x").word, /^lik avstand 1 m/);
  const al = snapMove({ x0: 4.15, x1: 7.15, z0: 24.1, z1: 24.3 }, { levels: lv, others: row });
  assert.equal(al.rect.x0, 4, "in line with b's edge"); assert.equal(al.snaps.find(x => x.axis === "x").word, "i flukt med");
  const g = snapMove({ x0: 30.03, x1: 33.03, z0: 30.04, z1: 30.24 }, { levels: lv, others: row }); assert.equal(g.rect.x0, 30); assert.equal(g.snaps.at(-1).word, "rutenett 0,1 m");
  assert.equal(snapMove({ x0: 30.03, x1: 33.03, z0: 30.04, z1: 30.24 }, { off: true }).rect.x0, 30.03);
  const p = snapPoint([3.1, 20.1], { others: row, levels: lv }); assert.deepEqual(p.p, [3, 20.28], "Fab's endpoint: a's top corner, which is also on the storey line");
});
test("handles are 44 px for a finger and 24 for a mouse; a drag of a handle is a resize", () => {
  const r = { x0: 0, x1: 3, z0: 20.08, z1: 20.28 }, t = handlesOf(r, 10, true), m = handlesOf(r, 10, false);
  assert.equal(t.length, 8); assert.equal(t[0].size, 44); assert.equal(m[0].size, 24); assert.equal(handleAt(t, [3.2, 20.28]).handle, "ne");
  assert.equal(handleAt(t, [9, 9]), null);
  assert.deepEqual(resizeRect(r, "e", [5, 22]), { x0: 0, x1: 5, z0: 20.08, z1: 20.28 }); assert.equal(resizeRect(r, "e", [-4, 0]).x1, 0.3, "never under 0,3 m");
});
test("a drag becomes the same edit a typed number makes", () => {
  const d = south(), L = initialLayout(d), b = L[2], levels = d.levels;
  const typed = typedItem(b, "bredde", "5,5"), r0 = d.items.find(i => i.id === b.id);
  const dragged = layoutItemOf(b, resizeRect(r0, "e", [b.t0 + 5.5, r0.z1]), levels);
  assert.deepEqual({ t0: dragged.t0, t1: dragged.t1, storey: dragged.storey }, { t0: typed.t0, t1: typed.t1, storey: typed.storey });
  assert.deepEqual(layoutEdits(d.face, "sentralblokka", [dragged], 7), layoutEdits(d.face, "sentralblokka", [typed], 7), "the same edits go to the draft");
  const mv = layoutItemOf(b, snapMove({ x0: r0.x0, x1: r0.x1, z0: levels[3].kote - 0.2 + 0.03, z1: levels[3].kote + 0.03 }, { levels: levels.map(l => l.kote) }).rect, levels);
  assert.equal(mv.storey, levels[3].name, "dropped on a storey line it belongs to that storey");
  assert.equal(typedItem(b, "bredde", "250 cm").t1 - b.t0, 2.5); assert.equal(typedItem(b, "dybde", "9"), null);
});
test("distribute and array", () => {
  const d3 = distribute([it("a", 0, 2, 0, 1), it("b", 3, 5, 0, 1), it("c", 12, 14, 0, 1)]);
  assert.deepEqual(d3.map(x => x.x0), [0, 6, 12]); const gaps = [d3[1].x0 - d3[0].x1, d3[2].x0 - d3[1].x1]; assert.ok(Math.abs(gaps[0] - gaps[1]) < 0.011);
  assert.deepEqual(arrayOf(it("a", 0, 3, 20.08, 20.28), 4, 3.2).map(r => r.x0), [6.2, 12.4, 18.6, 24.8]);
});
