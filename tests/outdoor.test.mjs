import { test } from "node:test";
import assert from "node:assert/strict";
import { daylightAt, evForLux, outdoorAt } from "../public/outdoor.js";
import { SCENES } from "../public/renderkit/scenes.js";

test("daylight grows with the sun and reddens near the horizon", () => {
  const a = daylightAt(-6), b = daylightAt(5), c = daylightAt(40), d = daylightAt(90);
  assert.ok(a.lux < b.lux && b.lux < c.lux && c.lux < d.lux);
  assert.ok(b.K < c.K);
  assert.equal(Math.round(c.lux), 60000);
  assert.equal(daylightAt(-30).lux, a.lux);
});
test("EV100 of the preset's own lux is within a stop of the preset's EV", () => {
  assert.ok(Math.abs(evForLux(SCENES.outdoor.illuminance_lux) - SCENES.outdoor.ev100) < 1);
});
test("outdoorAt: Drammen midsummer noon is bright, midwinter midnight is dark", () => {
  const noon = outdoorAt(new Date("2026-06-21T10:00:00Z"), 59.74, 10.2), night = outdoorAt(new Date("2026-12-21T23:00:00Z"), 59.74, 10.2);
  assert.ok(noon.sun.elevation > 40 && noon.illuminance_lux > 50000);
  assert.ok(night.sun.elevation < 0 && night.illuminance_lux < 10 && night.ev100 < noon.ev100);
  assert.equal(noon.id, "outdoor"); assert.equal(noon.hdri, SCENES.outdoor.hdri);
});
