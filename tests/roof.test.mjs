/* A wing's roof as numbers, and the one rule for a foot on it (Anton's reports wf7adYkR8-m, wQzG2uEEDjw, 2026-10-27).
   Fixture: a wing on a grid turned 30°, two roof blocks side by side (kote 10 and kote 14, each 20 × 10 m).
   node --test tests/roof.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkEdit, applyEdits } from "../public/edits.js";
import { roofOf, roofHold, roofSay, placeOnRoof, baseOf, alignDelta, alignSay } from "../public/design.js";

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

const BIM = { script: "x", sha: "a".repeat(64), params: {}, box: { min: [0, 0, 0], max: [60, 8, 5] } };   // a construction 60 × 8 m: its size is its script's, never shrunk

test("overhang: a construction that cannot fit the roof is refused with the metres (not placed with «taket er for lite»); overhang_m allows it", () => {
  const e = { kind: "volume", name: "Glasstak", shape: "bim", bim: BIM, material: "glass", from: X(10, 5), to: X(70, 5), width: 8, height: 5, on: "tw" };
  assert.throws(() => checkEdit(site, [], e), /stikker 30 m \(240 m²\) ut over takkanten til Testfløy/);
  assert.throws(() => checkEdit(site, [], { ...e, overhang_m: 1 }), /mer enn de 1 m som overhang_m tillater/);
  const ok = checkEdit(site, [], { ...e, overhang_m: 35 });
  assert.equal(ok.overhang_m, 35);
  const say = roofSay(site, ok); assert.ok(say.overhang_m === 30); assert.match(say.say, /stikker .* m .*ut over takkanten/);
  assert.throws(() => checkEdit(site, [], { ...vol(200, 200, 10, 5), on: "tw" }), /ingen del av grunnflaten ligger på taket/);
});

test("a box on the roof is moved inside by align building, and the answer's numbers say how far (m) and how much it was turned (deg)", () => {
  const raw = { ...vol(36, 5, 10, 6), on: "tw", from: X(30, 5), to: X(46, 5) };   // 6 m past the edge, 1° off
  const ok = checkEdit(site, [], raw);
  assert.ok(roofHold(site, { ...ok, on: "tw" }).overhang_m < 0.3, "inside after the align");
  const d = alignDelta(site, { ...raw, on: "tw" }, ok);
  assert.ok(d.moved_m > 6 && d.moved_m < 6.5 && !d.shrunk && d.fits, JSON.stringify(d));
  assert.match(alignSay(d), /flyttet 6,34 m inn på taket/);
  const big = checkEdit(site, [], { ...vol(20, 5, 60, 6), on: "tw" });   // 60 m on a 40 m roof: made shorter, and the amounts said
  const d2 = alignDelta(site, { ...vol(20, 5, 60, 6), on: "tw" }, big); assert.ok(d2.shrunk && d2.length_was === 60 && d2.length_now < 41);
  assert.match(alignSay(d2), /lengde 60 til 19,79 m, bredde 6 til 6 m/);
});

test("align free with on keeps the roof kote even when the middle is off the roof (the old rule fell to the ground, kote 2)", () => {
  const ed = [checkEdit(site, [], { ...vol(10, 5, 8, 4, { id: "n3abcd" }), on: "tw", align: "free" })];
  const m0 = applyEdits(site, [], ed); assert.equal(baseOf(m0.site, m0.site.added[0]), 10);
  ed.push(checkEdit(m0.site, [], { kind: "reshape", id: "n3abcd", from: X(33, 5), to: X(55, 5), width: 4, align: "free" }));   // middle at u = 44: off the roof; 7 m of it on kote 14
  const m = applyEdits(site, [], ed), v = m.site.added[0];
  assert.deepEqual(v.from, X(33, 5)); assert.equal(v.base_kote, 14, "kote 14, not the ground 2"); assert.equal(v.align, "free");
  assert.ok(roofSay(m.site, v).overhang_m > 10, "and the overhang is said");
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
