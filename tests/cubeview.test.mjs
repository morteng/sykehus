/* The view cube's Topp: north up, so the cube's top face and its label are upright. node --test tests/cubeview.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cubeMatrix, dirToView, dirName } from "../public/renderkit/viewcube.js";
import { cubeView } from "../public/cubeview.js";

/* the world direction that points up the screen, read back from the matrix the cube is drawn with (row 1 is [-u0, u2, u1]) */
const screenUp = (yaw, pitch) => { const m = cubeMatrix(yaw, pitch); return [-m[1][0], m[1][2], m[1][1]]; };

test("Topp from a camera turned 30°: the kit keeps the 30° (north is 30° off screen-up); the app goes to yaw 0, north up", () => {
  const d = [0, 0, 1], v0 = dirToView(d, 0.52);
  assert.equal(v0.yaw, 0.52, "the kit's own answer keeps the camera's yaw");
  const kept = screenUp(v0.yaw, v0.pitch); assert.ok(Math.abs(kept[0] + Math.sin(0.52)) < 1e-9 && Math.abs(kept[1] - Math.cos(0.52)) < 1e-9, "sideways: up the screen is " + kept);
  const v = cubeView(v0, { name: dirName(d) }), up = screenUp(v.yaw, v.pitch);
  assert.equal(v.yaw, 0); assert.ok(Math.abs(v.pitch - Math.PI / 2) < 1e-9);
  assert.ok(Math.abs(up[0]) < 1e-9 && Math.abs(up[1] - 1) < 1e-9, "north (0, 1) is up the screen: " + up);
});

test("the other faces and corners keep the kit's view", () => {
  for (const d of [[0, -1, 0], [1, 0, 0], [1, -1, 1]]) { const v0 = dirToView(d, 0.3); assert.deepEqual(cubeView(v0, { name: dirName(d) }), v0); }
});
