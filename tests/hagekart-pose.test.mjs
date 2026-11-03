/* U3824: hagekart's pose.js and anchor.js (fix a photo from known roof lines; line up on a spot), taken by lock, run here.
   node --test tests/hagekart-pose.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { projectPoint, projectSegment, solvePose6 } from "../public/hagekart/pose.js";
import { steadyFor, lineUpVerdict, dirWord } from "../public/hagekart/anchor.js";

const cam = { x: 0, y: 0, z: 1.5, heading: 0, pitch: 0, roll: 0, hfov: 65, w: 1200, h: 1600 };

test("a point straight ahead lands in the middle of the photo; behind the camera it is not seen", () => {
  const [u, v, d] = projectPoint(cam, [0, 10, 1.5]);
  assert.ok(Math.abs(u - 600) < 1e-6 && Math.abs(v - 800) < 1e-6 && Math.abs(d - 10) < 1e-6);
  assert.equal(projectPoint(cam, [0, -10, 1.5]), null);
  const seg = projectSegment(cam, [-3, 10, 1.5], [3, 10, 1.5]); assert.ok(seg.a[0] < 600 && seg.b[0] > 600);
});

test("the six-number fix: a camera a few metres and degrees off is pulled back by taps on known roof corners", () => {
  const truth = { ...cam, x: 1, y: -1, heading: 4 }, P = [[-4, 12, 1.5], [5, 14, 1.5], [-3, 15, 6], [6, 11, 5], [0, 18, 8]];
  const ties = P.map(p => ({ P: p, uv: projectPoint(truth, p).slice(0, 2) }));
  const r = solvePose6(cam, { ties });
  const pose = r.pose || r; assert.ok(Math.hypot(pose.x - truth.x, pose.y - truth.y) < Math.hypot(cam.x - truth.x, cam.y - truth.y), "closer than the sensors");
  assert.ok(Math.abs(pose.heading - truth.heading) < Math.abs(cam.heading - truth.heading));
});

test("lining up: held still, then the verdict; the compass word", () => {
  assert.equal(steadyFor([{ t: 0, heading: 10, pitch: 0 }, { t: 500, heading: 10.5, pitch: 0 }, { t: 1000, heading: 10, pitch: 0 }], 1000), 1000);
  const utm = p => [p[0] * 1e5, p[1] * 1e5], spot = { spot: [10, 60], heading: 0, pitch: 0 };
  assert.equal(lineUpVerdict(spot, { lng: 10, lat: 60, heading: 0, pitch: 0, steadyMs: 900 }, { utm }).ready, true);
  assert.equal(lineUpVerdict(spot, { lng: 10, lat: 60.001, pitch: 0, steadyMs: 900 }, { utm }).near, false);
  assert.equal(dirWord(90), "øst");
});
