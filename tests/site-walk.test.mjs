/* Photos land on the thing the camera points at (U3824): the compass, the wing and side a view line meets, the form's button,
   and hagekart's pose.js/anchor.js taken as they are (the lock). Run: node --test tests/site-walk.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cameraHeading, aimAt, aimFromFix, pointedAt } from "../public/sitewalk.js";
import { siteGrid } from "../public/utm.js";
import { startSitePhotos } from "../public/sitephotos.js";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { projectPoint, camAxes } from "../public/hagekart/pose.js";
import { planPose } from "../public/hagekart/anchor.js";

const site = { origin: [230311, 6633185], buildings: [
  { id: "a", wing: "midtfloy", ring: [[10, -5], [30, -5], [30, 5], [10, 5], [10, -5]] },
  { id: "osm", ring: [[40, -5], [50, -5], [50, 5], [40, 5], [40, -5]] }] };

test("the compass: iOS heading as it is; an absolute alpha 0 flat is north, no absolute heading is none", () => {
  assert.equal(cameraHeading({ webkitCompassHeading: 123 }), 123);
  assert.equal(cameraHeading({ absolute: false, alpha: 0, beta: 90, gamma: 0 }), null);
  assert.ok(Math.abs(cameraHeading({ absolute: true, alpha: 0, beta: 90, gamma: 0 })) < 1e-6 || Math.abs(cameraHeading({ absolute: true, alpha: 0, beta: 90, gamma: 0 }) - 360) < 1e-6);
});
test("looking east at a wing from the west lands on that wing's west side; a wing the line misses, or a building that is no wing, is not met", () => {
  assert.deepEqual(aimAt(site, [0, 0], 90), { wing: "midtfloy", side: "vest", dist: 10 });
  assert.deepEqual(aimAt(site, [20, -20], 0)?.side, "sør");
  assert.deepEqual(aimAt(site, [60, 0], 270), { wing: "midtfloy", side: "øst", dist: 30 });   // the OSM building in between is no wing: looked past
  assert.equal(aimAt(site, [0, 0], 0), null);
  assert.equal(aimAt(site, [0, 0], null), null);
  assert.equal(aimAt(site, [20, 0], 90), null, "standing inside looks past it");
});
test("a GPS fix goes through the site's grid", () => {
  const g = siteGrid(site.origin), fix = g.toLngLat([0, 0]);
  assert.equal(aimFromFix(site, fix, 90).wing, "midtfloy");
});
test("pointedAt says why it cannot: no position, no compass, nothing in view", async () => {
  const g = siteGrid(site.origin), fix = g.toLngLat([0, 0]);
  const geo = { getCurrentPosition: (ok) => ok({ coords: { longitude: fix[0], latitude: fix[1] } }) }, face = h => f => f({ webkitCompassHeading: h });
  assert.deepEqual(await pointedAt(site, { geo: null }), { why: "no-position" });
  assert.deepEqual(await pointedAt(site, { geo, onOrientation: f => f({}), timeout: 50 }), { why: "no-compass" });
  assert.deepEqual(await pointedAt(site, { geo, onOrientation: face(0) }), { why: "nothing" });
  assert.equal((await pointedAt(site, { geo, onOrientation: face(90) })).side, "vest");
});
test("the form's button sets wing and side from what the camera points at, and says in words when it cannot", async () => {
  const els = {}, el = (v = "") => ({ value: v, options: [{ value: "midtfloy", textContent: "Midtfløy" }], hidden: true, disabled: false, textContent: "", classList: { add() {}, remove() {} }, files: [] });
  for (const k of ["#phForm", "#phFile", "#phWing", "#phSide", "#phNote", "#phYear", "#phGo", "#phList", "#phSay", "#phHere"]) els[k] = el();
  const root = { querySelector: s => els[s] ?? null };
  startSitePhotos({ root, fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({}) }), site, aim: async () => ({ wing: "midtfloy", side: "vest", dist: 10 }) });
  await new Promise(r => setTimeout(r, 5));   // the list load answers first
  assert.equal(els["#phHere"].hidden, false);
  await els["#phHere"].onclick();
  assert.deepEqual([els["#phWing"].value, els["#phSide"].value, els["#phSay"].textContent], ["midtfloy", "vest", "Kameraet peker på Midtfløy."]);
  startSitePhotos({ root, fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({}) }), site, aim: async () => ({ why: "no-compass" }) });
  await new Promise(r => setTimeout(r, 5));
  await els["#phHere"].onclick();
  assert.match(els["#phSay"].textContent, /kompasset/);
});
test("pose.js and anchor.js are hagekart's, byte for byte (the lock)", () => {
  assert.match(execFileSync("node", [fileURLToPath(new URL("../tools/take-hagekart.mjs", import.meta.url)), "--check"], { encoding: "utf8" }), /^ok: 8 files at /);
  assert.equal(typeof projectPoint, "function"); assert.equal(typeof camAxes, "function"); assert.equal(typeof planPose, "function");
});
