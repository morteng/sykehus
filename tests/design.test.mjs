/* The after (public/design.js) on the real data: demolish all but one wing, balconies on it, a greenhouse.
   node --test tests/design.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkEdit, applyEdits } from "../public/edits.js";
import { groundAt, groundText, padFit, lotText } from "../public/design.js";

const site = JSON.parse(readFileSync(new URL("../public/data/site.json", import.meta.url)));
const floors = JSON.parse(readFileSync(new URL("../public/data/floors.json", import.meta.url))).floors;
const add = (edits, e) => { const m = applyEdits(site, floors, edits); edits.push(checkEdit(m.site, m.floors, e)); return edits; };

test("demolish alle and keep Sentralblokka", () => {
  const ed = add(add([], { kind: "demolish", building: "alle" }), { kind: "restore", building: "Sentralblokka" });
  const m = applyEdits(site, floors, ed);
  assert.deepEqual(m.site.buildings.filter(b => b.own).map(b => b.wing), ["sentralblokka"]);
  assert.ok(m.site.demolished.length > 10 && m.site.demolished.every(d => d.name));
  assert.equal(site.buildings.filter(b => b.own).length, m.site.demolished.length + 1, "the before is left as it was");
  assert.ok(m.floors.reduce((a, f) => a + f.rooms.length, 0) < floors.reduce((a, f) => a + f.rooms.length, 0), "the rooms in what is gone go with it");
});

test("balconies on the south facades, in bays", () => {
  const m = applyEdits(site, floors, add([], { kind: "balconies", wing: "Sentralblokka", side: "S", bay: 3.6, gap: 1.2 }));
  const b = m.site.added[0];
  assert.equal(b.kind, "balconies"); assert.ok(b.count > 10);
  for (const p of b.parts.filter(p => p.role === "slab")) assert.ok(Math.abs(Math.hypot(p.axis[1][0] - p.axis[0][0], p.axis[1][1] - p.axis[0][1]) - 3.6) < 0.01);
});

test("a triangular greenhouse: its volume is half width × height × length", () => {
  const m = applyEdits(site, floors, add([], { kind: "volume", name: "Drivhus", shape: "triangle", from: [-46, -62], to: [27, -62], width: 24, height: 18 }));
  const v = m.site.added[0];
  assert.equal(v.material, "glass"); assert.equal(v.volume_m3, Math.round(0.5 * 24 * 18 * 73)); assert.equal(v.top_kote - v.base_kote, 18);
});

test("wrong input is refused with a reason", () => {
  assert.throws(() => add([], { kind: "balconies", wing: "Sentralblokka", side: "Q" }), /side/);
  assert.throws(() => add([], { kind: "demolish", building: "Slottet" }), /Fant ikke/);
  assert.throws(() => add([], { kind: "volume", from: [0, 0], to: [0, 0.2], width: 5, height: 5 }), /mellom 1 og 250/);
});

test("a new building from the page (U3556): storeys, facts, reshaped, and torn down by its id", () => {
  const vol = { kind: "volume", id: "nAbc123", name: "Nybygg", shape: "box", from: [-40, -70], to: [-10, -70], width: 12, storeys: 4, material: "concrete", use: "Boliger" };
  const c = checkEdit(site, floors, vol); assert.equal(c.height, 12.8); assert.equal(c.storeys, 4);
  let m = applyEdits(site, floors, [c]); const a = m.site.added.find(x => x.id === "nAbc123");
  assert.equal(a.use, "Boliger"); assert.equal(a.footprint_m2, 360); assert.equal(Math.round((a.top_kote - a.base_kote) * 10) / 10, 12.8);
  assert.equal(checkEdit(m.site, m.floors, { ...vol }).id, "nAbc1232");   // its id taken: a free one, not a refusal (pm 23:31Z)
  assert.equal(checkEdit(site, floors, { ...vol, id: "takhage1" }).id, "ntakhage1");
  const r = checkEdit(m.site, m.floors, { kind: "reshape", id: "nAbc123", name: "Bolighuset", storeys: 6, from: [-40, -60], to: [-10, -60] });
  m = applyEdits(site, floors, [c, r]); const b = m.site.added.find(x => x.id === "nAbc123");
  assert.equal(b.name, "Bolighuset"); assert.equal(Math.round((b.top_kote - b.base_kote) * 10) / 10, 19.2); assert.deepEqual(b.from, [-40, -60]);
  assert.throws(() => checkEdit(m.site, m.floors, { kind: "reshape", id: "nNope0000", name: "x" }), /Fant ikke/);
  const d = checkEdit(m.site, m.floors, { kind: "demolish", building: "nAbc123" });
  m = applyEdits(site, floors, [c, r, d]); assert.equal((m.site.added || []).length, 0);
  const w = checkEdit(site, floors, { kind: "wing", wing: "Østfløy", field: "use", value: "Kontorer", why: "endret på siden" });
  assert.equal(applyEdits(site, floors, [w]).site.wings.find(x => x.id === "ostfloy").use, "Kontorer");
});

test("a room by its place (at): one of several with the same name, or one with no code (pm 21:22Z)", () => {
  const six = floors.filter(f => f.name === "6. etasje").flatMap(f => f.rooms || []), same = six.filter(r => r.name.toLowerCase() === "behandling" && r.at);
  assert.ok(same.length > 1);
  assert.throws(() => checkEdit(site, floors, { kind: "room", storey: "6", room: "BEHANDLING", set: { name: "Atelier" } }), /bruk romkoden, eller at: \[øst, nord\]/);
  const one = same[1], e = checkEdit(site, floors, { kind: "room", storey: "6", room: "BEHANDLING", at: [one.at[0] + 1, one.at[1] - 1], set: { name: "Atelier" } });
  assert.deepEqual(e.at, one.at);
  const m = applyEdits(site, floors, [e]), after = m.floors.filter(f => f.name === "6. etasje").flatMap(f => f.rooms || []);
  assert.equal(after.filter(r => r.name === "Atelier").length, 1); assert.equal(after.filter(r => r.name.toLowerCase() === "behandling" && r.at).length, same.length - 1);
  assert.throws(() => checkEdit(site, floors, { kind: "room", storey: "6", at: [400, 400], set: { name: "x" } }), /innen 6 m/);
});

test("a new building gets a pad (U3566): level at its foot, slopes 1:2, cut and fill, gone with it", () => {
  const v = { kind: "volume", id: "nPad1", name: "Drivhus", shape: "box", from: [-5, -62], to: [5, -62], width: 10, height: 4 };
  const c = add([], v), m = applyEdits(site, floors, c), a = m.site.added.find(x => x.id === "nPad1"), g = a.ground;
  assert.ok(g && g.cut_m3 + g.fill_m3 > 0, "some ground is moved");
  assert.equal(g.kote, Math.round(a.base_kote * 100) / 100);
  assert.notEqual(m.site.terrain.z, site.terrain.z, "the after has its own grid");
  const at = p => groundAt(m.site, p);
  for (const p of [[-5, -62], [5, -62], [0, -67.5], [0, -56.5]]) assert.ok(Math.abs(at(p) - a.base_kote) < 0.6, `level on the pad at ${p}`);
  /* the slope: never steeper than 1:2 from the pad's edge, and the ground far off as it was */
  assert.equal(groundAt(m.site, [80, 80]), groundAt(site, [80, 80]));
  const before = site.terrain.z.slice();
  const moved = applyEdits(site, floors, [...c, checkEdit(m.site, m.floors, { kind: "reshape", id: "nPad1", from: [-25, -62], to: [-15, -62] })]);
  assert.ok(Math.abs(groundAt(moved.site, [0, -62]) - groundAt(site, [0, -62])) < 0.01, "moved: the old pad is gone");
  const undone = applyEdits(site, floors, []);
  assert.equal(undone.site.terrain.z, site.terrain.z, "undone: the before's grid");
  assert.deepEqual(site.terrain.z, before, "the before is never written");
  assert.match(groundText(g), /planeres på kote/);
});

/* U3566 (f): on a slope the foot goes where what is dug out fills the rest, not on the lowest ground */
test("a new building's foot balances its pad's cut and fill; a kote asked is kept", () => {
  const v = { kind: "volume", id: "nBal", name: "Hus", shape: "box", from: [50, 40], to: [70, 40], width: 12, height: 6 };
  const a = applyEdits(site, floors, add([], v)).site.added[0], g = a.ground;
  assert.ok(Math.abs(g.cut_m3 - g.fill_m3) <= 0.2 * Math.max(g.cut_m3, g.fill_m3), `balanced: ${g.cut_m3} out, ${g.fill_m3} in`);
  const low = Math.min(...[[50, 34], [70, 34], [50, 46], [70, 46], [60, 40]].map(p => groundAt(site, p)));
  assert.ok(a.base_kote > low + 0.5, "over the lowest ground");
  assert.equal(g.balanced, true); assert.match(groundText(g), /det som graves ut fyller resten/);
  const l = applyEdits(site, floors, add([], { ...v, base_kote: Math.round(low * 10) / 10 })).site.added[0];
  assert.equal(l.base_kote, Math.round(low * 10) / 10, "a kote asked is the kote"); assert.ok(l.ground.cut_m3 > 3 * g.cut_m3, `on the lowest it digs: ${l.ground.cut_m3} m³`);
});

/* U3566 (a): the ground falls away from the wall 1:50 for 3 m, so water runs off the house */
test("the ground by a new building falls 1:50 away from its wall for the first 3 m", () => {
  const v = { kind: "volume", id: "nFall", name: "Hus", shape: "box", from: [-10, -62], to: [10, -62], width: 12, height: 6 };
  const m = applyEdits(site, floors, add([], v)), a = m.site.added[0], T = m.site.terrain, base = a.ground.kote;
  let n = 0;
  for (let r = 0; r < T.h; r++) for (let k = 0; k < T.w; k++) {
    const x = T.x0 + (k + 0.5) * T.res, y = T.y1 - (r + 0.5) * T.res, off = Math.hypot(Math.max(0, Math.abs(x) - 10), Math.max(0, Math.abs(y + 62) - 6));
    if (off > 0 && off <= 3) { n++; assert.ok(Math.abs(groundAt(m.site, [x, y]) - (base - off / 50)) < 0.011, `at ${off.toFixed(2)} m out: ${groundAt(m.site, [x, y])} for ${base - off / 50}`); }
  }
  assert.ok(n > 20, `${n} cells in the fall`);
  assert.match(groundText(a.ground), /fall 1:50 bort fra bygget/);
});

/* U3566 (b): a step-free entrance: level with the floor by the door, then a ramp 1:20 to the ground */
test("a step-free entrance: a landing level with the floor, a ramp of 1:20 to the ground, said in words", () => {
  const v = { kind: "volume", id: "nInn", name: "Hus", shape: "box", from: [-15, -62], to: [5, -62], width: 12, height: 6, entrance: "sør" };
  const c = add([], v), m = applyEdits(site, floors, c), a = m.site.added[0], n = a.ground.entrance;
  assert.equal(a.entrance, "S"); assert.equal(n.side, "S");
  assert.equal(n.ok, true); assert.ok(Math.abs(n.ramp_m - n.rise * 20) <= 0.5, `${n.ramp_m} m for ${n.rise} m`);
  assert.ok(n.ramp_m > 5, `a ramp: ${n.ramp_m} m`);
  assert.ok(Math.abs(groundAt(m.site, [-5, -68.8]) - a.ground.kote) < 0.011, "the landing by the door is the floor's kote");
  assert.match(groundText(a.ground), /Trinnfri inngang mot sør/);
  assert.throws(() => add([], { ...v, entrance: "opp" }), /N, Ø, S eller V/);
  /* where the ground falls faster than 1:20 the ramp never meets it: said so */
  const steep = applyEdits(site, floors, add([], { ...v, id: "nBratt", from: [50, 40], to: [70, 40] })).site.added[0];
  assert.equal(steep.ground.entrance.ok, false); assert.match(groundText(steep.ground), /trenger heis, en annen inngang/);
  const off = applyEdits(site, floors, [...c, checkEdit(m.site, m.floors, { kind: "reshape", id: a.id, entrance: null })]).site.added[0];
  assert.equal(off.entrance, undefined); assert.equal(off.ground.entrance, undefined);
});

/* U3566 (c): two pads that meet: the first one's footprint and fall stay as it left them; the step is said on both */
test("pads that meet: the one laid first is kept, and both say the step between them", () => {
  const A = { kind: "volume", id: "nHusA", name: "Hus A", shape: "box", from: [50, 40], to: [70, 40], width: 12, height: 6 };
  const B = { kind: "volume", id: "nHusB", name: "Hus B", shape: "box", from: [50, 25], to: [70, 25], width: 12, height: 6 };
  const ed = add(add([], A), B), m = applyEdits(site, floors, ed), a = m.site.added.find(x => x.name === "Hus A"), b = m.site.added.find(x => x.name === "Hus B");
  const alone = applyEdits(site, floors, add([], A)).site;
  for (const p of [[60, 40], [55, 37], [65, 35]]) assert.equal(groundAt(m.site, p), groundAt(alone, p), `under and by Hus A as it left it at ${p}`);
  assert.ok(Math.abs(a.base_kote - b.base_kote) > 0.3, "on a slope they stand at koter apart");
  assert.equal(b.ground.meets?.[0]?.id, a.id); assert.equal(a.ground.meets?.[0]?.id, b.id, "said on both");
  assert.ok(Math.abs(a.ground.meets[0].step + b.ground.meets[0].step) < 0.011, "the same step, seen from each");
  assert.match(groundText(b.ground), /Platået møter platået til Hus A/);
});

/* U3566 (d): a slope that reaches a path, trees or a road */
test("a pad's slope stops at a path (a wall there), counts the trees it cuts or buries, and finds the roads it reaches", () => {
  const ed = add(add([], { kind: "path", line: [[45, 30], [75, 30]], width: 2, name: "Gangveien" }), { kind: "volume", id: "nHusA", name: "Hus A", shape: "box", from: [50, 40], to: [70, 40], width: 12, height: 6 });
  const m = applyEdits(site, floors, ed), a = m.site.added[0];
  assert.equal(groundAt(m.site, [60, 30]), groundAt(site, [60, 30]), "the path keeps its ground");
  assert.equal(a.ground.paths?.[0]?.name, "Gangveien"); assert.match(groundText(a.ground), /Skråningen når Gangveien: stien beholder sin høyde, og en mur på/);
  const f = padFit(m.site, [{ name: "Konggata", ring: [[40, 52], [80, 52], [80, 60], [40, 60]] }, { name: "langt unna", ring: [[300, 300], [310, 300], [310, 310]] }]);
  assert.deepEqual(f[0].slopes_onto.map(w => w.way), ["Konggata"]); assert.match(f[0].say, /når Konggata/);
  const t = applyEdits(site, floors, add([], { kind: "volume", id: "nTre", name: "T", shape: "box", from: [-10, -100], to: [10, -100], width: 12, height: 6 })).site.added[0];
  assert.ok(t.ground.trees?.count >= 1, "trees where the ground moves"); assert.match(groundText(t.ground), /må felles, eller rotsonen sikres/);
});

test("the lot line: the slope stops there and the ground outside stays (a wall), and a building nearer than 4 m is told", () => {
  const m = applyEdits(site, floors, add([], { kind: "volume", id: "nGrense", name: "Ved grensen", shape: "box", from: [-14, 121.2], to: [0.4, 114.1], width: 12, height: 6 })), a = m.site.added[0];
  assert.ok(a.lot.near && a.lot.m > 1 && a.lot.m < 4, `${a.lot.m} m`); assert.match(lotText(a.lot), /fra tomtegrensen: nærmere enn 4 m \(pbl\. § 29-4\)/);
  assert.ok(Math.abs(a.ground.lot_wall) > 0.5); assert.match(groundText(a.ground), /Skråningen når tomtegrensen/);
  const T = site.terrain, ring = site.lot.ring, inside = (p) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) if ((ring[i][1] > p[1]) !== (ring[j][1] > p[1]) && p[0] < (ring[j][0] - ring[i][0]) * (p[1] - ring[i][1]) / (ring[j][1] - ring[i][1]) + ring[i][0]) c = !c; return c; };
  let outside = 0;
  for (let r = 0; r < T.h; r++) for (let k = 0; k < T.w; k++) { const p = [T.x0 + (k + 0.5) * T.res, T.y1 - (r + 0.5) * T.res]; if (!inside(p) && m.site.terrain.z[r * T.w + k] !== T.z[r * T.w + k]) outside++; }
  assert.equal(outside, 0, "no cell outside the lot is moved");
  const far = applyEdits(site, floors, add([], { kind: "volume", id: "nMidt", name: "Midt", shape: "box", from: [-10, 20], to: [10, 20], width: 12, height: 6 })).site.added[0];
  assert.equal(lotText(far.lot), "", "well inside: nothing to say");
});

test("U3628: a balcony that would stand inside the low wing in front is not made, and the result says how many and why", () => {
  const e = { kind: "balconies", wing: "sentralblokka", side: "Ø", depth: 1.5, railing: "glass", from_storey: "2. etasje", bay: 4, gap: 0.6 };
  const b = applyEdits(site, floors, [e]).site.added[0], at = k => b.parts.filter(p => p.role === "slab" && p.profile[3][1] === k).length;
  assert.deepEqual([at(20.28), at(24.24), at(28.01)], [10, 10, 21], "storeys 2 and 3 lose the bays over the side wing; storey 4 is over its roof");
  assert.deepEqual(b.skipped, [{ by: "Sentralblokka, sidebygg", count: 22 }]);
  assert.match(b.say, /^22 balkonger er ikke satt opp fordi de ville stått inne i Sentralblokka, sidebygg/);
  const torn = applyEdits(site, floors, [{ kind: "demolish", building: "sentralblokka-sidebygg" }, e]).site.added[0];
  assert.equal(torn.skipped, undefined, "with the side wing torn down, every bay is made");
});
