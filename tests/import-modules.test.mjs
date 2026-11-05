/* Every public module that has no DOM at load must import under node: a missing export in a taken kit file (U4522) dies at start.
   node --test tests/import-modules.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";

for (const f of ["drawing.js", "renderkit/sheet.js"]) {
  test(`${f} imports`, async () => { assert.ok(await import(`../public/${f}`)); });
}
