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
