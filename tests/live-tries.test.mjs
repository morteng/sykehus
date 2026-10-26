/* U3670: each try Anton makes shows as a ghost and as a thumbnail on its chat row; the version card is said only after a real edit. Run: node --test tests/live-tries.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ghostIds, announces, matcher, isTry } from "../public/livetries.js";

test("the ghost is the new parts of this turn: an undone try is gone from the set, a part that was there before is never ghosted", () => {
  const start = new Set(["nA", "nB"]);
  assert.deepEqual(ghostIds(start, ["nA", "nB", "nC"]), ["nC"]); assert.deepEqual(ghostIds(start, ["nA", "nB", "nC", "nD"]), ["nC", "nD"]);
  assert.deepEqual(ghostIds(start, ["nA", "nB", "nD"]), ["nD"], "nC was undone"); assert.deepEqual(ghostIds(start, ["nA"]), [], "nothing new, a part torn down is not a ghost"); assert.deepEqual(ghostIds(start, undefined), []);
});
test("«Anton har tegnet i …» is said only after a real edit (Trappetest, 16:45Z: it stood above the first message of an empty version)", () => {
  assert.equal(announces({ version: "vAbcdefgh", title: "Trappetest", changes: 0 }), false); assert.equal(announces({ changes: 1 }), true); assert.equal(announces({ changes: "3" }), true); assert.equal(announces(null), false); assert.equal(announces({}), false);
});
test("a try's row and its picture meet in either order, oldest first, and are cleared at the end of the turn", () => {
  const got = []; const m = matcher((el, t) => got.push([el, t.n]));
  m.thumb({ n: 1 }); m.row("rowA"); m.row("rowB"); m.thumb({ n: 2 }); m.thumb({ n: 3 }); m.row("rowC");
  assert.deepEqual(got, [["rowA", 1], ["rowB", 2], ["rowC", 3]]); assert.deepEqual(m.waiting, { rows: 0, thumbs: 0 });
  m.row("rowD"); m.thumb({ n: 9 }); m.row("rowE"); assert.equal(got.length, 4); assert.deepEqual(m.waiting, { rows: 1, thumbs: 0 }); m.reset(); assert.deepEqual(m.waiting, { rows: 0, thumbs: 0 });
});
test("the try tool is told from its key, with or without a prefix, and no other tool", () => {
  for (const k of ["try_change", "sykehus.try_change", "mcp__sykehus__try_change", "sykehus/try_change", "sykehus:try_change"]) assert.equal(isTry(k), true, k);
  for (const k of ["undo_change", "try_changes", "retry_change", "show_building", "", undefined]) assert.equal(isTry(k), false, String(k));
});
test("the page wires it: a save of the open version during a turn is drawn at once, the ghost goes at the end, and the version card waits for a real edit", () => {
  const a = readFileSync(new URL("../public/anton.js", import.meta.url), "utf8"), p = readFileSync(new URL("../public/app.js", import.meta.url), "utf8"), v = readFileSync(new URL("../public/viewer.js", import.meta.url), "utf8");
  assert.match(a, /if \(running\) \{ if \(tries\) liveTry\(\); else redraw = true; \}/); assert.match(a, /else if \(announces\(s\) && !told\.has\(s\.version\)\)/);
  assert.match(a, /tries\?\.end\(\)/); assert.match(a, /tries\?\.back\(t\.pose\)/, "a tap flies back"); assert.match(a, /if \(isTry\(t\.key\)\) tryRows\.row\(el\)/);
  assert.match(p, /fixed\(d\.edits\) !== base\) return null/, "a change that needs the page again waits for the end of the turn"); assert.match(p, /viewer\.ghost\(g\)/); assert.match(p, /viewer\.look\(\{ x: \(n\.from\[0\] \+ n\.to\[0\]\) \/ 2/); assert.match(p, /end\(\) \{ tryStart = null; viewer\.ghost\(null\)/);
  assert.match(v, /ghost\(ids\) \{/); assert.match(v, /thumb\(w = 168\)/); assert.match(v, /applyGhost\(\);\n/, "re-applied when the parts are drawn again");
});
