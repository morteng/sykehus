/* A wing's roof as numbers, and the one rule for a foot on it (Anton's reports wf7adYkR8-m, wQzG2uEEDjw, 2026-10-27).
   Fixture: a wing on a grid turned 30°, two roof blocks side by side (kote 10 and kote 14, each 20 × 10 m).
   node --test tests/roof.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkEdit, applyEdits } from "../public/edits.js";
import { roofOf, roofHold, roofSay, placeOnRoof, baseOf } from "../public/design.js";

const TH = 30 * Math.PI / 180, c = Math.cos(TH), s = Math.sin(TH);
const X = (u, v) => [Math.round((u * c - v * s) * 100) / 100 + 0, Math.round((u * s + v * c) * 100) / 100 + 0];   // grid -> site
const rect = (u0, v0, u1, v1, top) => ({ p: [X(u0, v0), X(u1, v0), X(u1, v1), X(u0, v1)], top });
const wing = { id: "tw", name: "Testfløy", levels: [] };
const bld = { id: "tw", wing: "tw", own: true, base: 2, top: 14, ring: [X(0, 0), X(40, 0), X(40, 10), X(0, 10)], area_m2: 400, grid_deg: 30, blocks: [rect(0, 0, 20, 10, 10), rect(20, 0, 40, 10, 14)] };
const site = { buildings: [bld], wings: [wing], added: [] };
const vol = (uMid, vMid, L, W, extra = {}) => ({ kind: "volume", name: "Glasstak", shape: "box", height: 4, from: X(uMid - L / 2, vMid), to: X(uMid + L / 2, vMid), width: W, ...extra });

test("the roof as numbers: two levels, the grid, the bounding rectangle and its axis", () => {
  const r = roofOf(site, "tw");
  assert.deepEqual(r.levels.map(l => [l.kote, l.area_m2]), [[14, 200], [10, 200]]);
  assert.equal(r.grid_deg, 30); assert.equal(r.grid_bearing_deg, 60);   // u axis at 30° from east = bearing 60°
  assert.equal(r.bounding_rect.length_m, 40); assert.equal(r.bounding_rect.width_m, 10); assert.equal(r.bounding_rect.axis_bearing_deg, 60);
  assert.deepEqual(r.bounding_rect.corners[0], X(0, 0)); assert.deepEqual(r.bounding_rect.corners[2], X(40, 10));
  assert.equal(r.blocks.length, 2, "adjacent blocks of one kote stay two (different kotes)");
  assert.deepEqual(r.outline.length, 4, "the outer edge of the two blocks is the 40 × 10 rectangle");
});

test("the real Sentralblokka: three levels, none of them the building's top 70.87; 97 × 28 m on a 32° axis", () => {
  const real = JSON.parse(readFileSync(new URL("../public/data/site.json", import.meta.url)));
  const r = roofOf(real, "sentralblokka");
  assert.deepEqual(r.levels.map(l => l.kote), [73.16, 69.91, 66.41]);
  const big = r.levels.find(l => l.kote === 69.91).bounding_rect;
  assert.equal(big.length_m, 97); assert.equal(big.width_m, 28); assert.equal(big.axis_bearing_deg, 32);
  assert.ok(JSON.stringify(r).length < 8000, "small enough for an answer: " + JSON.stringify(r).length);
});

test("a volume fully on one block: that block's kote, one level, no overhang", () => {
  const h = roofHold(site, { ...vol(10, 5, 12, 6), on: "tw" });
  assert.equal(h.kote, 10); assert.equal(h.several, false); assert.equal(h.overhang_m, 0); assert.equal(h.outside_m2, 0);
  assert.equal(roofSay(site, { ...vol(10, 5, 12, 6), on: "tw" }).say, null);
});

test("a volume over two blocks: one defined kote (the level holding most), both levels named", () => {
  const e = { ...vol(24, 5, 16, 6), on: "tw" };   // u 16..32: 4 m on kote 10, 12 m on kote 14
  const h = roofHold(site, e);
  assert.equal(h.kote, 14); assert.deepEqual(h.levels.map(l => l.kote), [14, 10]); assert.ok(h.levels[0].m2 > 2.5 * h.levels[1].m2);
  assert.equal(roofHold(site, e).kote, 14, "the same on every call");
  assert.equal(baseOf(site, e), 14, "baseOf takes the same kote as roofHold");
  assert.equal(baseOf(site, { ...vol(16, 5, 16, 6), on: "tw" }), 10, "mirrored: most of it on the low block");
  const say = roofSay(site, e).say; assert.match(say, /2 takhøyder/); assert.match(say, /kote 14/); assert.match(say, /kote 10/);
});

test("overhang: a volume that sticks out is refused with the metres; overhang_m allows it; the answer says how far", () => {
  const e = vol(20, 5, 30, 6, {}); const out = { ...e, from: X(25, 5), to: X(55, 5) };   // u 25..55: 15 m past the end at u = 40
  assert.throws(() => checkEdit(site, [], { ...out, on: "tw" }), /stikker 15 m .* ut over takkanten til Testfløy/);
  assert.throws(() => checkEdit(site, [], { ...out, on: "tw", overhang_m: 10 }), /mer enn de 10 m som overhang_m tillater/);
  const ok = checkEdit(site, [], { ...out, on: "tw", overhang_m: 15 });
  assert.equal(ok.overhang_m, 15); assert.deepEqual(ok.from, out.from, "not moved or shrunk");
  const sayRoof = roofSay(site, ok); assert.equal(sayRoof.overhang_m, 15); assert.match(sayRoof.say, /stikker 15 m/);
  assert.throws(() => checkEdit(site, [], { ...vol(200, 200, 10, 5), on: "tw" }), /ingen del av grunnflaten ligger på taket/);
});

test("an exact on is not moved, turned or resized by the check or the after", () => {
  const e = { ...vol(10, 5, 12.5, 6.5, { id: "n1abcd" }), on: "Testfløy" };   // the wing by name
  const ok = checkEdit(site, [], e);
  assert.deepEqual([ok.from, ok.to, ok.width], [e.from, e.to, e.width]); assert.equal(ok.on, "tw");
  const m = applyEdits(site, [], [ok]); const v = m.site.added.find(x => x.id === "n1abcd");
  assert.deepEqual([v.from, v.to, v.width], [e.from, e.to, e.width]);
  assert.equal(v.base_kote ?? baseOf(m.site, v), 10);
});

test("reshape keeps the roof kote when it moves (and on is a field of reshape); it never falls to the ground", () => {
  const first = checkEdit(site, [], { ...vol(10, 5, 8, 4, { id: "n2abcd" }), on: "tw" });
  const ed = [first], add = e => { const m = applyEdits(site, [], ed); ed.push(checkEdit(m.site, [], e)); };
  add({ kind: "reshape", id: "n2abcd", from: X(28, 5), to: X(36, 5) });   // over to the high block
  let m = applyEdits(site, [], ed), v = m.site.added.find(x => x.id === "n2abcd");
  assert.equal(v.on, "tw"); assert.equal(baseOf(m.site, v), 14, "kote 14, not the ground (2)");
  add({ kind: "reshape", id: "n2abcd", on: "Testfløy", overhang_m: 1 });   // reshape with on alone
  m = applyEdits(site, [], ed); v = m.site.added.find(x => x.id === "n2abcd");
  assert.equal(v.overhang_m, 1); assert.equal(baseOf(m.site, v), 14);
  assert.throws(() => checkEdit(m.site, [], { kind: "reshape", id: "n2abcd", from: X(36, 5), to: X(46, 5) }), /stikker .* m .*ut over takkanten/, "moved out past the edge by a reshape: refused");
});

test("at on a roof: along the roof's axis, parallel, inside; placed says where", () => {
  const p = placeOnRoof(site, wing, { wing: "tw", roof: true, kote: 14, along: 2, gap_m: 1 }, 10, 5);   // the 14 level: u 20..40
  assert.equal(p.kote, 14); assert.equal(p.axis_bearing_deg, 60);
  assert.deepEqual(p.from, X(22, 3.5)); assert.deepEqual(p.to, X(32, 3.5));
  assert.match(p.text, /2 m fra enden og 1 m fra venstre kant/);
  const h = roofHold(site, { on: "tw", from: p.from, to: p.to, width: 5 }); assert.equal(h.kote, 14); assert.equal(h.overhang_m, 0);
  const mid = placeOnRoof(site, wing, { wing: "tw", roof: true }, 16, 6);   // the bigger level (a tie: first), centred
  assert.equal(mid.kote, 14); assert.deepEqual(mid.from, X(22, 5)); assert.deepEqual(mid.to, X(38, 5));
});
