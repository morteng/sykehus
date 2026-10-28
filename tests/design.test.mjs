/* The after (public/design.js) on the real data: demolish all but one wing, balconies on it, a greenhouse.
   node --test tests/design.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkEdit, applyEdits } from "../public/edits.js";
import { ringFrame } from "../public/renderkit/frame.js";
import { inRing } from "../public/renderkit/fit.js";
import { buildingWords, BALCONY_DEPTH, groundAt, groundText, padFit, lotText, windowBays, balconyFaces } from "../public/design.js";

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

test("balconies on the south end (face 210°: «S» alone is asked, U3615), in bays", () => {
  const m = applyEdits(site, floors, add([], { kind: "balconies", wing: "Sentralblokka", face: 210, bay: 3.6, gap: 1.2 }));
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

test("a part that stands on the ground (a stair) digs no pad as a house does (U3690)", () => {
  const bim = nopad => ({ part: "stair", params: {}, sha: "a".repeat(64), box: { min: [0, 0, 0], max: [4, 1.2, 3] }, ...(nopad ? { nopad: true } : {}) });
  const v = nopad => ({ kind: "volume", id: "nSt1", name: "Trapp", shape: "bim", from: [-5, -62], to: [-1, -62], width: 1.2, height: 3, bim: bim(nopad) });
  const dig = nopad => applyEdits(site, floors, add([], v(nopad))).site.added.find(x => x.name === "Trapp");
  assert.ok(dig(false).ground, "without the flag it is treated as a house: a pad");
  assert.equal(dig(true).ground, undefined, "with it, no pad, no cut and fill");
  assert.equal(dig(true).bim.nopad, true, "the flag stays on the part");
});
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
  /* where the ground falls faster than 1:20 the ramp never meets it: said so (base_kote fixed: the balanced foot moved 0.1 m with the eased skirt and that put this ramp just inside its 80 m) */
  const steep = applyEdits(site, floors, add([], { ...v, id: "nBratt", from: [50, 40], to: [70, 40], base_kote: 21.5 })).site.added[0];
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
  const e = { kind: "balconies", wing: "sentralblokka", side: "Ø", depth: 1.5, railing: "glass", from_storey: "2. etasje", bay: 4, gap: 0.6 };   // as vHKH-fbTh has it (made before U3615)
  const b = applyEdits(site, floors, [e]).site.added[0], at = k => b.parts.filter(p => p.role === "slab" && p.profile[3][1] === k).length;
  assert.deepEqual([at(20.28), at(24.24), at(28.01)], [10, 10, 21], "storeys 2 and 3 lose the bays over the side wing; storey 4 is over its roof");
  assert.deepEqual(b.skipped, [{ by: "Sentralblokka, sidebygg", count: 22 }]);
  assert.match(b.say, /^22 balkonger er ikke satt opp fordi de ville stått inne i Sentralblokka, sidebygg/);
  const torn = applyEdits(site, floors, [{ kind: "demolish", building: "sentralblokka-sidebygg" }, e]).site.added[0];
  assert.equal(torn.skipped, undefined, "with the side wing torn down, every bay is made");
});

test("U3624: one balcony per window: centred on the window bays the facade is drawn with, 2.5 m apart, and counted", async () => {
  const { windowsOn, BAY, WINDOWS } = await import("../public/bays.js");
  /* a wall along x from the origin's line: the bays start where x is a multiple of 2.5, the tower's pair of windows at 1.16–2.49 in each */
  assert.deepEqual(windowsOn("tower", [0, 0, 10, 0]), [[1.16, 2.49], [3.66, 4.99], [6.16, 7.49], [8.66, 9.99]]);
  assert.deepEqual(windowsOn("tower", [1, 0, 11, 0]), [[0.16, 1.49], [2.66, 3.99], [5.16, 6.49], [7.66, 8.99]], "counted from the line's origin, not the wall's end");
  assert.equal(BAY, 2.5); assert.equal(WINDOWS.tower.length, 2);
  const e = checkEdit(site, floors, { kind: "balconies", wing: "sentralblokka", face: 120, windows: true, depth: 1.5, from_storey: "5" });
  const a = applyEdits(site, floors, [e]).site.added[0], slabs = a.parts.filter(p => p.role === "slab");
  const w = Math.hypot(slabs[0].axis[1][0] - slabs[0].axis[0][0], slabs[0].axis[1][1] - slabs[0].axis[0][1]);
  assert.ok(Math.abs(w - (2.49 - 1.16 + 0.6)) < 0.01, `as wide as the windows and 0,3 m each side (${w})`);
  const c = q => [(q.axis[0][0] + q.axis[1][0]) / 2, (q.axis[0][1] + q.axis[1][1]) / 2];
  assert.ok(Math.abs(Math.hypot(c(slabs[1])[0] - c(slabs[0])[0], c(slabs[1])[1] - c(slabs[0])[1]) - BAY) < 0.01, "the next one a bay along");
  assert.equal(a.window_bays, 38); assert.match(a.window_say, /^Én balkong per vindu: 38 vindusakser \(hver 2,5 m\) på fasaden mot 120°, 380 balkonger i alt\.$/);
  assert.equal(a.name, "Balkonger mot 120°, Sentralblokka", "named by the face it is on, not a compass side");
  /* pm 11:35Z: about_wing's count per facade is the one the edit uses (per compass side, Ø summed two faces: 63) */
  assert.equal(windowBays(site, "sentralblokka").find(f => f.face === 120).bays, 38);
  assert.deepEqual(balconyFaces(site, e), [120]);
  assert.throws(() => checkEdit(site, floors, { kind: "balconies", wing: "sentralblokka", face: 120, windows: true, bay: 3 }), /høyst 2,4 m/);
});

test("U3614/U3615: «sør» on the turned Sentralblokka is refused with both faces named; face picks one, and the result says each facade used", () => {
  assert.throws(() => checkEdit(site, floors, { kind: "balconies", wing: "sentralblokka", side: "S" }),
    /^Error: Sentralblokka står skjevt: mot sør vender fasaden mot 210° \(30° fra sør, 34 m lang\) og fasaden mot 120° \(60° fra sør, 165 m lang\)\. Si hvilken med face: 210 eller 120/);
  const e = checkEdit(site, floors, { kind: "balconies", wing: "sentralblokka", face: 210, from_storey: "2", to_storey: "14", depth: 1.5, bay: 4 });
  assert.equal(e.side, "S"); assert.equal(e.face, 210);
  const a = applyEdits(site, floors, [e]).site.added[0];
  assert.deepEqual(a.facades.map(f => [f.bearing, f.length_m, f.storeys, f.count]), [[210, 34, 13, 50]]);
  assert.equal(a.facade_say, "Balkonger på fasaden mot 210° (34 m): 2–4 per etasje på 13 etasjer, 50 i alt.");
  assert.throws(() => checkEdit(site, floors, { kind: "balconies", wing: "sentralblokka", face: 170 }), /ingen fasade som vender 170°\. Fasadene vender 120° \(165 m\), 300° \(154 m\), 30° \(44 m\), 210° \(34 m\)/);
});

test("a whole facade asked with no width is one balcony per window axis, not one slab along all of it (U3690, pm 13:06Z)", () => {
  const a = applyEdits(site, floors, add([], { kind: "balconies", wing: "Sentralblokka", face: 120 })).site.added[0], slabs = a.parts.filter(p => p.role === "slab");
  assert.ok(slabs.length > 100, `one a window axis on every storey: ${slabs.length}`);
  assert.ok(Math.max(...slabs.map(p => Math.hypot(p.axis[1][0] - p.axis[0][0], p.axis[1][1] - p.axis[0][1]))) < 3.5, "none is a long strip");
  const wide = applyEdits(site, floors, add([], { kind: "balconies", wing: "Sentralblokka", face: 120, bay: 6, gap: 1 })).site.added[0].parts.filter(p => p.role === "slab");
  assert.ok(Math.hypot(wide[0].axis[1][0] - wide[0].axis[0][0], wide[0].axis[1][1] - wide[0].axis[0][1]) > 5.9, "a width asked is kept");
});

test("balconies come out 1.5 m deep unless a depth is asked (U3780: the area plan allows 1.5 m of projection)", () => {
  const depth = e => checkEdit(site, floors, { kind: "balconies", wing: "Sentralblokka", face: 120, ...e });
  assert.equal(BALCONY_DEPTH, 1.5);
  const a = depth({}); assert.equal(a.depth, 1.5, "the edit as stored");
  assert.equal(depth({ depth: 2.2 }).depth, 2.2, "a depth asked is kept");
});

/* U3831 (Morten 2026-10-26: «drivhuset står skjevt på taket»): a volume on a roof is set along the building's own axis
   and kept inside the roof edge; align free keeps what was asked; reshape align building puts a skew one right */
const hoy = site.buildings.find(b => b.wing === "sentralblokka").blocks.find(k => k.top === 69.91).p;   // the long slab of Høyblokka's roof
const rf = ringFrame(hoy), corners = v => { const d = [v.to[0] - v.from[0], v.to[1] - v.from[1]], L = Math.hypot(...d), n = [-d[1] / L, d[0] / L], h = v.width / 2; return [v.from, v.to].flatMap(q => [h, -h].map(s => [q[0] + n[0] * s, q[1] + n[1] * s])); };
const skew = (deg, along, across = 0) => { const a = (rf.angle + deg) * Math.PI / 180, u = [Math.cos(a), Math.sin(a)], c = [rf.c[0] + rf.u[0] * along + rf.v[0] * across, rf.c[1] + rf.u[1] * along + rf.v[1] * across]; return { from: c.map((x, i) => x - u[i] * 12), to: c.map((x, i) => x + u[i] * 12) }; };
const glass = (extra = {}) => ({ kind: "volume", name: "Drivhus", shape: "gable", material: "glass", width: 6, height: 4, on: "Sentralblokka", ...skew(5, 44, 1), ...extra });

test("U3831: a greenhouse 5° off and sticking out at one end of the roof is set along the building's axis and inside the roof", () => {
  const raw = glass(), out = [corners({ ...raw })].flat();
  assert.ok(out.some(p => !inRing(p, hoy)), "the control: as asked, it sticks out past the roof edge");
  const c = checkEdit(site, floors, raw), dir = Math.atan2(c.to[1] - c.from[1], c.to[0] - c.from[0]) * 180 / Math.PI;
  assert.ok(Math.abs(((dir - rf.angle) % 180 + 180) % 180) < 0.1 || Math.abs(((dir - rf.angle) % 180 + 180) % 180 - 180) < 0.1, `along the axis ${rf.angle.toFixed(2)}, got ${dir.toFixed(2)}`);
  for (const p of corners(c)) assert.ok(inRing(p, hoy), `corner ${p} on the roof`);
  assert.equal(c.width, 6); assert.equal(Math.round(Math.hypot(c.to[0] - c.from[0], c.to[1] - c.from[1])), 24);
  assert.equal(c.align, undefined, "nothing odd is kept on the edit");
});

test("U3831: a greenhouse wider than the roof is made narrower, one that is fine is left where it is", () => {
  const w = checkEdit(site, floors, glass({ width: 30 })); assert.ok(w.width < 30 && w.width > 5, `width ${w.width}, made narrower than the 30 asked`);
  const ok = skew(0, 0, 0), c = checkEdit(site, floors, glass({ ...ok })), mid = v => [(v.from[0] + v.to[0]) / 2, (v.from[1] + v.to[1]) / 2];
  assert.ok(Math.hypot(...mid(c).map((x, i) => x - mid(ok)[i])) < 0.02, "a placement already along the axis and inside is not moved");
});

test("U3831: align free keeps from and to as they are", () => {
  const raw = glass({ align: "free" }), c = checkEdit(site, floors, raw);
  assert.deepEqual([c.from, c.to], [raw.from.map(v => Math.round(v * 100) / 100), raw.to.map(v => Math.round(v * 100) / 100)]); assert.equal(c.align, "free");
  assert.throws(() => checkEdit(site, floors, { ...glass(), on: undefined, base_kote: 20, align: "building" }), /gjelder et bygg på et tak/);
});

test("U3831: reshape align building turns a skew greenhouse that stands free along the building, and a move keeps it so", () => {
  const ed = add(add([], glass({ id: "ndrivhus", align: "free" })), { kind: "reshape", id: "ndrivhus", align: "building" });
  const v = applyEdits(site, floors, ed).site.added.find(x => x.id === "ndrivhus");
  for (const p of corners(v)) assert.ok(inRing(p, hoy), `corner ${p} on the roof`);
  const dir = Math.atan2(v.to[1] - v.from[1], v.to[0] - v.from[0]) * 180 / Math.PI;
  assert.ok(Math.abs((((dir - rf.angle) % 180) + 180) % 180) < 0.1 || Math.abs((((dir - rf.angle) % 180) + 180) % 180 - 180) < 0.1);
  const moved = add(ed, { kind: "reshape", id: "ndrivhus", from: [rf.c[0] + 1, rf.c[1] - 12], to: [rf.c[0] + 3, rf.c[1] + 12] });   // a move by guess is set right again
  const w = applyEdits(site, floors, moved).site.added.find(x => x.id === "ndrivhus");
  for (const p of corners(w)) assert.ok(inRing(p, hoy));
});

/* U3831b (pm's Chrome read 2026-10-26 20:23Z): Sentralblokka's roof is 60 small blocks on 3 levels; a greenhouse that covers most
   of it is fitted to the whole roof (the level it stands on and the one step below), not to the one block under its middle:
   it keeps its size and is only turned and shifted */
test("U3831b: a greenhouse 80 x 18 m on the roof of many blocks keeps its size and is turned and shifted, not shrunk", async () => {
  const { fitInRing } = await import("../public/renderkit/frame.js"), { alignOnRoof, roofRoom, roofBlock } = await import("../public/design.js");
  const bld = site.buildings.find(b => b.wing === "sentralblokka"), F = ringFrame(bld.blocks.filter(k => k.top > 73).flatMap(k => k.p)) /* the tall middle of the roof */, a = (F.angle + 3) * Math.PI / 180, u = [Math.cos(a), Math.sin(a)];
  const mid = [F.c[0] + F.v[0] * 1, F.c[1] + F.v[1] * 1], set = { ...glass({ id: "ndrivhus", width: 18, on: "sentralblokka" }), from: mid.map((x, i) => x - u[i] * 40), to: mid.map((x, i) => x + u[i] * 40) };   // 80 m long, 3° off
  const one = roofBlock(site, set), room = roofRoom(site, set);
  assert.ok(room.rings.length > 20 && room.rings.length > 1, `the roof is ${room.rings.length} blocks`);
  assert.ok(room.rings.some(r => r === one.p), "the block under the middle is one of them");
  assert.equal(fitInRing(one.p, { c: mid, length: 80, width: 18 }).shrunk, true, "control: the old fit, to the one block under the middle, shrinks it");
  const f = alignOnRoof(site, set);
  assert.equal(f.shrunk, false); assert.equal(f.fits, true); assert.equal(f.width, 18); assert.ok(Math.abs(Math.hypot(f.to[0] - f.from[0], f.to[1] - f.from[1]) - 80) < 0.05, "still 80 m");
  assert.ok(Math.abs(f.turned_deg) > 1 && Math.abs(f.turned_deg) < 6, `turned ${f.turned_deg}`);
  const c = checkEdit(site, floors, set);
  assert.ok(Math.abs(Math.hypot(c.to[0] - c.from[0], c.to[1] - c.from[1]) - 80) < 0.05 && c.width === 18, "the checked edit keeps its size");
  for (const p of corners(c)) assert.ok(room.rings.some(r => inRing(p, r)), `corner ${p} on the roof`);
  const { alignSay, alignDelta } = await import("../public/design.js"), say = alignSay(alignDelta(site, set, c));
  assert.match(say, /^På taket: snudd 2,9\d° til byggets egen akse/); assert.doesNotMatch(say, /mindre/, "a cm of rounding is not said as a shrink");
});

test("U3831b: a volume set align free keeps that on the model, so a later move leaves it where it is put", () => {
  const ed = add([], glass({ id: "ndrivhus", align: "free" })), v = applyEdits(site, floors, ed).site.added.find(x => x.id === "ndrivhus");
  assert.equal(v.align, "free");
  const w = applyEdits(site, floors, add(ed, { kind: "reshape", id: "ndrivhus", height: 5 })).site.added.find(x => x.id === "ndrivhus");
  assert.deepEqual([w.from, w.to], [v.from, v.to], "a free volume is not turned by a later reshape");
});

test("U3910: a building with no name is named in words, never by its number", () => {
  const unnamed = site.buildings.filter(b => !b.name && !b.wing);
  assert.ok(unnamed.length > 0, "control: the data has unnamed buildings");
  const words = unnamed.map(b => buildingWords(b, site.buildings));
  for (const w of words) assert.doesNotMatch(w, /\d{6,}/, w);
  assert.equal(new Set(words).size, words.length, "alike buildings are told apart");
  const a = { id: "1163588204", own: true }, c = { id: "1163588205", own: true };
  assert.equal(buildingWords(a, [a]), "Bygning på tomta");
  assert.equal(buildingWords(c, [a, c]), "Bygning på tomta, nr. 2");
  assert.equal(buildingWords({ id: "9", name: "Hytta" }, []), "Hytta");
});
