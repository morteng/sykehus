/* The brush against the real streets round the site (U3655, Morten 2026-10-26: «i could paint grass over roads and walkways»):
   the fixture is what sykehus.gulden.no/gater/api/streets and /nvdb answered for the site box on 2026-10-26.
   node --test tests/paint-streets.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { siteGrid } from "../public/utm.js";
import { streetsFrom } from "../public/renderkit/streets.js";
import { wayRingsOf } from "../public/roads.js";
import { pointInRing } from "../public/renderkit/paths2d.js";
import { applyEdits, checkEdit } from "../public/edits.js";
import { nearWays, paintPlan } from "../public/paint-edit.js";

const site = JSON.parse(readFileSync(new URL("../public/data/site.json", import.meta.url), "utf8"));
const fx = JSON.parse(readFileSync(new URL("./fixtures/dronninggata-streets.json", import.meta.url), "utf8"));
const grid = siteGrid(site.origin), toUtm = p => grid.fromLngLat(p);
const ways = wayRingsOf(streetsFrom(fx.osm, fx.nvdb, toUtm), toUtm);
const road = w => /kjørevei|adkomstvei/.test(w.name), way = w => !/parkering/.test(w.name);

/* a stroke made the way the page makes it: the edit with `around` from the ways near it */
const edit = (line, r = 3) => { const e = { kind: "paint", surface: "grass", line, r }; return checkEdit(site, [], { ...e, around: nearWays(ways.map(w => w.ring), e) }); };
const painted = e => applyEdits(site, [], [e]).site.landscape || [];
const covered = (land, q) => land.some(g => pointInRing(q, g.ring) && !(g.holes || []).some(h => pointInRing(q, h)));
/* points well inside a way's ring (0.6 m or more from its edge: the brush is pulled to an edge within 0.8 m) */
const deep = (q, w) => pointInRing(q, w.ring) && [[.6, 0], [-.6, 0], [0, .6], [0, -.6]].every(([dx, dy]) => pointInRing([q[0] + dx, q[1] + dy], w.ring));

test("the fixture is the streets of the site: roads, footways and car parks", () => {
  assert.ok(ways.length > 150, `${ways.length} ways`);
  assert.ok(ways.some(road) && ways.some(w => /gangvei|fortau|gang- og sykkelvei/.test(w.name)));
});

test("a stroke across a road and a footway leaves both unpainted", () => {
  const line = [[-212, -134], [-188, -134]], e = edit(line), land = painted(e);
  const crossed = ways.filter(w => way(w) && Array.from({ length: 25 }, (_, i) => [-212 + i, -134]).some(q => deep(q, w)));
  assert.ok(crossed.some(road) && crossed.some(w => !road(w)), `the control: the stroke crosses a road and a footway (${crossed.map(w => w.name).join("; ")})`);
  assert.ok(e.around.length >= crossed.length, "the ways across the stroke go with the edit");
  assert.ok(land.length > 0, "something is painted on the free ground");
  for (let x = -212; x <= -188; x += 0.5) for (const y of [-137, -135, -134, -133, -131]) for (const w of crossed) if (deep([x, y], w)) assert.ok(!covered(land, [x, y]), `grass on ${w.name} at ${x},${y}`);
});

test("without the street rings the same stroke paints over them (the control that the test sees the fault)", () => {
  const e = checkEdit(site, [], { kind: "paint", surface: "grass", line: [[-212, -134], [-188, -134]], r: 3 }), land = painted(e);
  const w = ways.find(w => way(w) && Array.from({ length: 25 }, (_, i) => [-212 + i, -134]).some(q => deep(q, w)));
  assert.ok(Array.from({ length: 49 }, (_, i) => [-212 + i * 0.5, -134]).some(q => deep(q, w) && covered(land, q)), "painted over a way when none were given");
});

test("a long road with its corners far from the stroke still stops it (nearWays reads the ring's box)", () => {
  const long = [[-300, -139], [300, -139], [300, -129], [-300, -129]];
  assert.equal(nearWays([long], { line: [[0, -134], [3, -134]], r: 2 }).length, 1);
});

test("the plot line is not a wall: a stroke across it paints both sides", () => {
  const lot = site.lot.ring, line = [[-132, 94], [-108, 94]], e = edit(line), land = painted(e);
  const sides = Array.from({ length: 25 }, (_, i) => [-132 + i, 94]), inLot = sides.filter(q => pointInRing(q, lot)), outLot = sides.filter(q => !pointInRing(q, lot));
  assert.ok(inLot.length > 4 && outLot.length > 4, "the control: the stroke crosses the plot line");
  assert.ok(inLot.filter(q => covered(land, q)).length > inLot.length * 0.6, "painted inside the plot");
  assert.ok(outLot.filter(q => covered(land, q)).length > outLot.length * 0.6, "painted outside the plot");
});

test("the ghost is the result: the rings the page draws cover the same ground as the painted surface", () => {
  const e = edit([[-212, -134], [-188, -134]]), plan = paintPlan([], e, site), land = painted(e);
  let agree = 0, n = 0;
  for (let x = -214; x <= -186; x += 1) for (let y = -138; y <= -130; y += 1) { const a = plan.polys.some(p => pointInRing([x, y], p.ring)), b = covered(land, [x, y]); n++; if (a === b) agree++; }
  assert.ok(agree / n > 0.93, `ghost and result agree on ${agree} of ${n} points`);
});

test("the ways as the page keeps them ({ id, name, ring }, from roads.js wayRingsOf) reach the edit: the page once passed them and none matched", () => {
  const e = { kind: "paint", surface: "grass", line: [[-212, -134], [-188, -134]], r: 3 };
  assert.ok(nearWays(ways, e).length >= 2, "the ways objects, as wayRingsOf gives them");
  assert.deepEqual(nearWays(ways, e), nearWays(ways.map(w => w.ring), e), "the same as their bare rings");
});
