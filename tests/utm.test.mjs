import { test } from "node:test";
import assert from "node:assert/strict";
import { lngLatToUtm, utmToLngLat, siteGrid } from "../public/utm.js";

/* the reference values are proj4's (hagekart public/vendor/proj4.js, EPSG:25833), 2026-10-25 */
test("utm.js gives proj4's EPSG:25833 to the millimetre, and back", () => {
  for (const [q, want] of [[[10.198, 59.749], [230284.98397, 6633230.47225]], [[15, 60], [500000, 6651411.19024]], [[12, 58], [322707.88005, 6432647.77949]]]) {
    const got = lngLatToUtm(q);
    assert.ok(Math.abs(got[0] - want[0]) < 1e-3 && Math.abs(got[1] - want[1]) < 1e-3, `${q} → ${got}`);
    const back = utmToLngLat(got);
    assert.ok(Math.abs(back[0] - q[0]) < 1e-9 && Math.abs(back[1] - q[1]) < 1e-9, `${got} → ${back}`);
  }
  const g = siteGrid([230311, 6633185]), o = g.fromLngLat(g.toLngLat([12.5, -40]));
  assert.ok(Math.abs(o[0] - 12.5) < 1e-4 && Math.abs(o[1] + 40) < 1e-4);
});
