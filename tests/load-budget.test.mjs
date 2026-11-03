import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PART_CAP, DRAW_BUDGET, MERGE_ABOVE, room, merges, drawCost, partsOf, balconiesOf } from "../public/load-budget.js";
import { QUALITY } from "../public/quality.js";

/* U3644: a 400-balcony draft (slab, railing, two ends, and a glass railing's outline lines) measured as the objects the page draws */
const balcony = () => [{ mat: "concrete", role: "slab" }, { mat: "glass", role: "railing" }, { mat: "glass", role: "railing" }, { mat: "glass", role: "railing" }];
const draft = n => [{ kind: "balconies", count: n, parts: Array.from({ length: n }, balcony).flat() }];

test("a 400-balcony draft is under the cap and costs the low tier few objects, the other tiers many", () => {
  const added = draft(400);
  assert.equal(partsOf(added), 1600); assert.equal(balconiesOf(added), 400);
  assert.ok(partsOf(added) <= PART_CAP);
  assert.ok(merges(QUALITY.low, 1), "the low tier always merges");
  assert.ok(!merges(QUALITY.high, 100) && merges(QUALITY.high, MERGE_ABOVE + 1), "the others merge above the limit");
  const merged = drawCost(added[0].parts, true), loose = drawCost(added[0].parts, false);
  console.log(`400 balconies: ${partsOf(added)} parts → ${loose} objects loose, ${merged} merged (budget ${DRAW_BUDGET})`);
  assert.ok(merged <= DRAW_BUDGET && loose > 100 * merged);
});

test("the cap: room is what is left of PART_CAP, never negative", () => {
  assert.equal(room(0, 100), 100);
  assert.equal(room(PART_CAP - 10, 100), 10);
  assert.equal(room(PART_CAP + 5, 100), 0);
});

test("the tiers: only the low one merges and has no pictures", () => {
  assert.equal(QUALITY.low.merge, true); assert.equal(QUALITY.low.pbr, false);
  assert.ok(!QUALITY.mid.merge && !QUALITY.high.merge);
});

test("the viewer draws a big group merged, and design.js stops a draft at the cap", () => {
  const v = readFileSync(new URL("../public/viewer.js", import.meta.url), "utf8"), d = readFileSync(new URL("../public/design.js", import.meta.url), "utf8");
  assert.ok(v.includes("merges(Q, list.length)") && v.includes("drawMerged("));
  assert.ok(d.includes("room(partsOf(added), all.length)") && d.includes("made > PART_CAP"));
});
