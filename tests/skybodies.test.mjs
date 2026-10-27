/* The moon's place and phase (skybodies.js, SunCalc's low-precision formulas) against known dates, and the rule for when a disc is drawn.
   node --test tests/skybodies.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { moonPosition, bodyFade, skyDir, moonPixels } from "../public/skybodies.js";
import { sunPosition } from "../public/renderkit/sun.js";

const LAT = 59.749, LON = 10.198;   // Drammen
const angDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

test("a known full moon (2000-01-21 04:41 UTC, the total eclipse) is 100 % lit and opposite the sun", () => {
  const t = new Date("2000-01-21T04:41:00Z"), m = moonPosition(t, LAT, LON), s = sunPosition(t, LAT, LON);
  assert.ok(m.fraction > 0.98, `fraction ${m.fraction}`);
  assert.ok(angDiff(m.azimuth, s.azimuth + 180) < 6, `azimuth ${m.azimuth} vs sun ${s.azimuth}`);
  assert.ok(Math.abs(m.elevation + s.elevation) < 7, `elevation ${m.elevation} vs sun ${s.elevation}`);
});
test("a known new moon (2000-01-06 18:14 UTC) is under 2 % lit; a known full moon in 2026 (2026-10-26 04:12 UTC) over 98 %", () => {
  assert.ok(moonPosition(new Date("2000-01-06T18:14:00Z"), LAT, LON).fraction < 0.02);
  assert.ok(moonPosition(new Date("2026-10-26T04:12:00Z"), LAT, LON).fraction > 0.98);
});
test("the quarters are near 50 % lit: first waxing, last waning", () => {
  const q = moonPosition(new Date("2000-01-14T13:34:00Z"), LAT, LON);   // first quarter
  assert.ok(Math.abs(q.fraction - 0.5) < 0.04, `fraction ${q.fraction}`); assert.equal(q.waxing, true);
  const w = moonPosition(new Date("2000-01-28T07:57:00Z"), LAT, LON);   // last quarter
  assert.ok(Math.abs(w.fraction - 0.5) < 0.04, `fraction ${w.fraction}`); assert.equal(w.waxing, false);
});
test("the lit limb faces the sun: a waxing moon in the south in the evening is lit on the side that faces the sun, to the right (the sun has set in the west)", () => {
  const m = moonPosition(new Date("2026-02-25T17:30:00Z"), LAT, LON), s = sunPosition(new Date("2026-02-25T17:30:00Z"), LAT, LON);
  assert.ok(s.elevation < 0 && m.waxing && m.elevation > 0 && s.azimuth > m.azimuth, `sun ${s.azimuth}/${s.elevation} moon ${m.azimuth}/${m.elevation}`);
  assert.ok(m.limb < -0.5 && m.limb > -Math.PI, `limb ${m.limb}`);   // clockwise from up: right of the moon, the sun's side
});
test("the moon rises and sets within a day at Drammen", () => {
  const els = []; for (let h = 0; h < 24; h++) els.push(moonPosition(new Date(Date.UTC(2026, 9, 27, h)), LAT, LON).elevation);
  assert.ok(els.some(e => e > 0) && els.some(e => e < 0));
});
test("the above-horizon rule: nothing at or under the horizon, full from 6 degrees, a ramp between", () => {
  assert.equal(bodyFade(-10), 0); assert.equal(bodyFade(0), 0); assert.equal(bodyFade(3), 0.5); assert.equal(bodyFade(6), 1); assert.equal(bodyFade(40), 1);
});
test("skyDir: east is +x, north is -z (the viewer's frame), up is +y", () => {
  const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-9);
  assert.ok(near(skyDir(90, 0), [1, 0, 0])); assert.ok(near(skyDir(0, 0), [0, 0, -1])); assert.ok(near(skyDir(0, 90), [0, 1, 0]));
});
test("the moon's picture: full is lit all over, new is nearly dark, a quarter is lit on one half only (lit limb up)", () => {
  const N = 64, lum = (px, i, j) => px[(j * N + i) * 4];
  const full = moonPixels(N, 1), nw = moonPixels(N, 0), q = moonPixels(N, 0.5);
  assert.ok(lum(full, 32, 8) > 150 && lum(full, 32, 56) > 150);
  assert.ok(lum(nw, 32, 8) < 40 && lum(nw, 32, 32) < 40);
  assert.ok(lum(q, 32, 14) > 150 && lum(q, 32, 50) < 40, "the upper half is lit, the lower is not");
  assert.equal(full[3], 0, "outside the disc is clear");
});
