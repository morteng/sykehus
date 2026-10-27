/* Anton's roof wish wf7adYkR8-m (2026-10-27) on Sentralblokka's real data: place by the roof's own axes (u, v), overhang on purpose,
   and the wish's items 2, 3 and 5 as tests on the real code.
   node --test tests/roof-uv.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkEdit, applyEdits } from "../public/edits.js";
import { roofOf, roofHold, placeOnRoof, overhangOf, baseOf, alignDelta, alignSay } from "../public/design.js";

const site = JSON.parse(readFileSync(new URL("../public/data/site.json", import.meta.url)));
const w = site.wings.find(x => x.id === "sentralblokka");
const R = roofOf(site, "sentralblokka"), L = k => R.levels.find(l => l.kote === k);
const near = (a, b, tol = 0.02) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);
const vol = o => ({ kind: "volume", name: "Pool", shape: "box", height: 2, on: "sentralblokka", ...o });

test("about_wing roof.levels[].axes: origin, bearings, length and width per level, the same frame placeOnRoof uses", () => {
  const a = L(69.91).axes;
  assert.deepEqual(a.origin, [-23.74, -41.77]);   // the corner where the 97 m axis starts, on its left edge (bounding_rect.corners[0])
  assert.equal(a.origin_is, "sørhjørnet"); assert.equal(a.u_bearing_deg, 32); assert.equal(a.v_bearing_deg, 302);
  assert.equal(L(69.91).bounding_rect.length_m, 97); assert.equal(L(69.91).bounding_rect.width_m, 28);   // the u and v ranges
  assert.deepEqual(L(73.16).axes.origin, [-23.63, -26.5]); assert.equal(L(73.16).bounding_rect.width_m, 11.01);
  assert.ok(JSON.stringify(R).length < 11000, "answer size " + JSON.stringify(R).length);
});

test("at { u, v } lands where a hand computation from the axes says (corner nearest the origin, u along, v to the left)", () => {
  const a = L(69.91).axes, th = a.u_bearing_deg * Math.PI / 180, uu = [Math.sin(th), Math.cos(th)], vv = [-uu[1], uu[0]];
  const p = placeOnRoof(site, w, { wing: "sentralblokka", roof: true, kote: 69.91, u: 10, v: 4 }, 40, 6);
  const q = (u, v) => [a.origin[0] + uu[0] * u + vv[0] * v, a.origin[1] + uu[1] * u + vv[1] * v];   // the footprint's centre line: v = 4 + 6/2
  near(p.from[0], q(10, 7)[0]); near(p.from[1], q(10, 7)[1]); near(p.to[0], q(50, 7)[0]); near(p.to[1], q(50, 7)[1]);
  assert.equal(p.kote, 69.91);
  const same = placeOnRoof(site, w, { wing: "sentralblokka", roof: true, kote: 69.91, along: 10, gap_m: 4 }, 40, 6);
  assert.deepEqual(same.from, p.from); assert.deepEqual(same.to, p.to);   // one copy: u, v are along, gap_m
  assert.throws(() => placeOnRoof(site, w, { wing: "sentralblokka", roof: true, u: 1, along: 2 }, 10, 5), /u er det samme som along/);
  const ok = checkEdit(site, [], vol({ from: p.from, to: p.to, width: 6, overhang_m: 0 }));
  assert.ok(roofHold(site, { ...ok, on: "sentralblokka" }).overhang_m < 0.25 && ok.from[0] === p.from[0]);
});

test("overhang_m: refused beyond it, no shrinking, nothing turned or moved; without it today's align and shrink", () => {
  const p = placeOnRoof(site, w, { wing: "sentralblokka", roof: true, kote: 69.91, u: 40, v: -3 }, 20, 8, true);   // 3 m past the left edge
  const e = vol({ from: p.from, to: p.to, width: 8 });
  assert.throws(() => checkEdit(site, [], { ...e, overhang_m: 1 }), /mer enn de 1 m som overhang_m tillater/);
  const ok = checkEdit(site, [], { ...e, overhang_m: 3.5 });
  assert.deepEqual([ok.from, ok.to, ok.width], [p.from, p.to, 8], "as given");
  const h = roofHold(site, { ...ok }); near(h.overhang_m, 3, 0.05);
  assert.throws(() => placeOnRoof(site, w, { wing: "sentralblokka", roof: true, u: 40, v: -3 }, 20, 8), /negativt bare med overhang_m/);
  const auto = checkEdit(site, [], e);   // no overhang_m: pulled inside as before
  assert.ok(roofHold(site, auto).overhang_m < 0.3 && alignDelta(site, e, auto).moved_m > 2);
  const big = checkEdit(site, [], vol({ from: p.from, to: p.to, width: 8, shape: "box" , name: "Lang" }));
  assert.ok(Math.hypot(big.to[0] - big.from[0], big.to[1] - big.from[1]) <= 20.01);
  assert.throws(() => checkEdit(site, [], { ...e, overhang_m: 3.5, align: "building" }), /overhang_m og align building/);
});

test("overhang_m: the answer's on_roof numbers per level, measured on the real shape", () => {
  // a 30 m pool on the 97 x 28 m level 69.91 at u 80..110: the roof ends at u 97, so 13 m past the end
  const a = L(69.91).axes, th = a.u_bearing_deg * Math.PI / 180, uu = [Math.sin(th), Math.cos(th)], vv = [-uu[1], uu[0]];
  const at = (u, v) => [a.origin[0] + uu[0] * u + vv[0] * v, a.origin[1] + uu[1] * u + vv[1] * v];
  const e = vol({ from: at(80, 14), to: at(110, 14), width: 6, overhang_m: 14 });
  assert.throws(() => checkEdit(site, [], { ...e, overhang_m: 10 }), /mer enn de 10 m som overhang_m tillater/);
  const c = checkEdit(site, [], e), o = overhangOf(site, c, "Sentralblokka");
  assert.equal(o.allowed_m, 14); assert.equal(o.kote, 73.16, "the foot: the level that holds most of it");
  assert.ok(o.overhang_m > 12.9 && o.overhang_m < 13.1, "whole roof: " + o.overhang_m);
  const l69 = o.levels.find(l => l.kote === 69.91), l73 = o.levels.find(l => l.kote === 73.16);
  assert.ok(l69.overhang_m > 12.9 && l69.overhang_m < 13.1, JSON.stringify(l69));   // against the 69.91 edge
  assert.ok(l73.overhang_m > 16.9 && l73.overhang_m < 17.2, JSON.stringify(l73));   // against the smaller 73.16 level's own edge
  assert.match(o.say, /fremspring 13 m av 14 m tillatt/); assert.match(o.say, /kote 69,91: stikker 13 m/); assert.match(o.say, /kote 73,16: stikker 17,03 m/);
});

test("wish 2: one roof, one kote: the pool and the others on the 73.16 level get the same foot, and a split footprint takes the level holding most", () => {
  const a = L(73.16).axes, th = a.u_bearing_deg * Math.PI / 180, uu = [Math.sin(th), Math.cos(th)], vv = [-uu[1], uu[0]];
  const at = (u, v) => [a.origin[0] + uu[0] * u + vv[0] * v, a.origin[1] + uu[1] * u + vv[1] * v];
  const mk = (id, u0, u1) => checkEdit(site, [], vol({ id, from: at(u0, 5.5), to: at(u1, 5.5), width: 6, align: "free" }));
  const m = applyEdits(site, [], [mk("na1111", 5, 25), mk("nb2222", 40, 60)]);
  assert.deepEqual(m.site.added.map(x => baseOf(m.site, x)), [73.16, 73.16]);
  const split = { ...vol({ from: at(30, 0), to: at(50, 0), width: 14, align: "free" }) };   // centred on the roof's left edge: half on 73.16, half off it
  const h = roofHold(site, split); assert.equal(baseOf(site, split), h.kote); assert.ok(h.levels.length >= 1);
});

test("wish 3: align building (no overhang_m) turns and moves a box without being asked: reproduced, and said in on_roof; free does neither", () => {
  const a = L(69.91).axes, th = (a.u_bearing_deg + 6) * Math.PI / 180, uu = [Math.sin(th), Math.cos(th)];   // 6° off the axis, near the edge
  const mid = [a.origin[0] + Math.sin(a.u_bearing_deg * Math.PI / 180) * 20 - Math.cos(a.u_bearing_deg * Math.PI / 180) * 3, a.origin[1] + Math.cos(a.u_bearing_deg * Math.PI / 180) * 20 + Math.sin(a.u_bearing_deg * Math.PI / 180) * 3];   // 3 m from the left edge
  const e = vol({ from: [mid[0] - uu[0] * 10, mid[1] - uu[1] * 10], to: [mid[0] + uu[0] * 10, mid[1] + uu[1] * 10], width: 8 });
  const c = checkEdit(site, [], e), d = alignDelta(site, e, c);
  assert.ok(Math.abs(d.turned_deg) > 1, "turned " + d.turned_deg);   // real: an unrequested turn, which on_roof says
  assert.match(alignSay(d), /snudd/);
  const f = checkEdit(site, [], { ...e, align: "free" });
  const same = (x, y) => x.flat().every((v, i) => Math.abs(v - y.flat()[i]) < 0.011);
  assert.ok(same([f.from, f.to], [e.from, e.to]), "free keeps it");
  assert.throws(() => checkEdit(site, [], { ...e, overhang_m: 0 }), /stikker 2,02 m/, "overhang_m 0 refuses what sticks out, it does not move it");
  const o = checkEdit(site, [], { ...e, overhang_m: 2.5 });
  assert.ok(same([o.from, o.to], [e.from, e.to]), "overhang_m keeps it too");
});

test("wish 5: reshape with on and align free keeps the roof kote (not 15.5, not the ground)", () => {
  const a = L(73.16).axes, th = a.u_bearing_deg * Math.PI / 180, uu = [Math.sin(th), Math.cos(th)], vv = [-uu[1], uu[0]];
  const at = (u, v) => [a.origin[0] + uu[0] * u + vv[0] * v, a.origin[1] + uu[1] * u + vv[1] * v];
  const ed = [checkEdit(site, [], vol({ id: "nglas1", from: at(10, 5.5), to: at(30, 5.5), width: 6, align: "free" }))];
  const m0 = applyEdits(site, [], ed); assert.equal(baseOf(m0.site, m0.site.added[0]), 73.16);
  ed.push(checkEdit(m0.site, [], { kind: "reshape", id: "nglas1", from: at(10, 5.5), to: at(70, 5.5), width: 9, on: "sentralblokka", align: "free", overhang_m: 3 }));
  const m = applyEdits(site, [], ed), v = m.site.added[0];
  assert.equal(v.on, "sentralblokka"); assert.equal(baseOf(m.site, v), 73.16, "on the roof kote after the reshape"); assert.equal(v.base_kote, 73.2, "the card keeps one decimal by design (roof-edge.test): this is the wish's 73,2 vs 73,16; the geometry uses baseOf = 73.16"); assert.equal(v.overhang_m, 3);
  ed.push(checkEdit(m.site, [], { kind: "reshape", id: "nglas1", name: "Nytt navn" }));
  const m2 = applyEdits(site, [], ed); assert.equal(baseOf(m2.site, m2.site.added[0]), 73.16);
});
