/* U3835: the page's plan and section with measures: the picture and the numbers come from drawing.js (one copy).  node --test tests/mal-view.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { draw } from "../public/mal-view.js";
import { wingOf } from "../public/edits.js";

const site = JSON.parse(readFileSync(new URL("../public/data/site.json", import.meta.url)));

test("a plan and both sections draw as SVG with the measures listed", () => {
  for (const kind of ["plan", "across", "along"]) {
    const r = draw(site, "sentralblokka", kind, wingOf);
    assert.ok(!r.error, r.error); assert.match(r.svg, /^<svg[\s\S]*<\/svg>$/); assert.ok(r.rows.length > 0, kind); assert.ok(r.say.length > 0);
  }
});
test("an unknown wing gives a sentence, not a throw", () => {
  const r = draw(site, "finnesikke", "plan", wingOf); assert.ok(r.error && !r.svg);
});
