/* the style → lens and shape table of the Gjengi tab: every style has a row, every row names a real lens and shape, and what the person set by hand is left alone.
   Run: node --test tests/look-frame.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { LOOK_FRAME, LOOK_NO, framePatch } from "../public/gjengi-no.js";
import { LOOKS } from "../public/photo-set.js";
import { LENSES, ASPECTS } from "../public/renderkit/photoframe.js";

test("every style has a lens and a shape that exist, and the table has no style the page does not know", () => {
  assert.deepEqual(Object.keys(LOOK_FRAME).sort(), Object.keys(LOOKS).sort()); assert.deepEqual(Object.keys(LOOK_FRAME).sort(), Object.keys(LOOK_NO).sort());
  for (const [id, f] of Object.entries(LOOK_FRAME)) { assert.ok(LENSES[f.lens], `${id}: lens ${f.lens}`); assert.ok(ASPECTS.includes(f.aspect), `${id}: shape ${f.aspect}`); }
});
test("the asked-for defaults: Arkitektfoto 24 3:2, Blåtime 35 16:9, Konkurransebilde 50 16:9, Drone the drone lens 16:9, Hvit modell 50 4:5, Skisse 50 3:2", () => {
  assert.deepEqual(LOOK_FRAME, { arkitektfoto: { lens: "24", aspect: "3:2" }, "blåtime": { lens: "35", aspect: "16:9" }, konkurransebilde: { lens: "50", aspect: "16:9" }, drone: { lens: "drone", aspect: "16:9" }, hvitmodell: { lens: "50", aspect: "4:5" }, skisse: { lens: "50", aspect: "3:2" } });
});
test("picking a style sets both; a lens or shape the person set by hand stays; an unknown style changes nothing", () => {
  assert.deepEqual(framePatch("blåtime"), { lens: "35", aspect: "16:9" });
  assert.deepEqual(framePatch("blåtime", { lens: true }), { aspect: "16:9" });
  assert.deepEqual(framePatch("blåtime", { aspect: true }), { lens: "35" });
  assert.deepEqual(framePatch("blåtime", { lens: true, aspect: true }), {});
  assert.deepEqual(framePatch("nope"), {});
});
