/* U3878: a drag shows the kit's type-in box and hands typed numbers back to the editor that is dragging. The page (app.js)
   gives both editors (the volume's build and the ground knobs) the same neighbours, the same live callback and the same
   busy callback; each editor answers typed() and setSnaps(). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const kit = n => readFileSync(new URL(`../public/renderkit/${n}`, import.meta.url), "utf8");

test("both editors get the same neighbours, the live numbers and the busy hook", () => {
  for (const [name, call] of [["build", /createBuild\(\{[\s\S]*?\n  onCommit/], ["shape", /createShape\(\{[\s\S]*?\n  onCommit/]]) {
    const m = app.match(call)?.[0]; assert.ok(m, `${name}: the call is in app.js`);
    assert.match(m, /others: nearbyRings/, `${name} sees the near outlines`);
    assert.match(m, new RegExp(`onLive: \\(k, v, p\\) => dragType\\.live\\(\\{ name: "${name}"`), `${name} reports live numbers`);
    assert.match(m, /dragType\.busy\(on\)/, `${name} closes the box when the drag ends`);
  }
});

test("the editors the kit gives answer typed() and setSnaps(), and a typed drag is its own «by»", () => {
  for (const f of ["build.js", "shape.js"]) { const s = kit(f); assert.match(s, /\btyped\b/); assert.match(s, /setSnaps/); assert.match(s, /"typed"/); }
  assert.match(app, /typed: "med tall"/);
});
