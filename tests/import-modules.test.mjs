/* A public module that cannot load must never ship green (U4522, U4535). Two parts:
   1. the modules with no DOM at load import for real under node;
   2. every module app.js loads (static imports, and import("./x.js") calls, followed through the graph) is really imported:
      node links the whole graph first, so a missing export, a bad path or a syntax error fails here. A module that touches
      document/window the moment it runs is let through only when its error is a ReferenceError for such a global (linking passed).
   node --test tests/import-modules.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const PUB = resolve(import.meta.dirname, "../public");
for (const f of ["drawing.js", "renderkit/sheet.js"]) {
  test(`${f} imports`, async () => { assert.ok(await import(`../public/${f}`)); });
}

// U4533: the kit's sheet constants equal what drawing.js held locally in 49bf6a62 (values pinned, not just present).
test("sheet.js constants are the values drawing.js used before", async () => {
  const k = await import("../public/renderkit/sheet.js");
  assert.deepEqual(k.AXIS, [190, 40, 40]);
  assert.equal(k.PX_PER_M_1_1, 3779.5);
  assert.deepEqual([k.INK, k.DIMC, k.GREY, k.ORANGE], [[30, 30, 36], [0, 84, 150], [120, 120, 128], [235, 110, 20]]);
  assert.equal(k.r2(1.234), 1.23); assert.deepEqual(k.unit([3, 4]), [0.6, 0.8]);
});

const SPEC = /(?:\bfrom\s*|\bimport\s*\(?\s*)(['"])(\.{1,2}\/[^'"\n?]+)(?:\?[^'"\n]*)?\1/g;
function graph(entry) {
  const seen = new Set(), todo = [entry];
  while (todo.length) {
    const f = todo.pop(); if (seen.has(f)) continue; seen.add(f);
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(SPEC)) { const t = resolve(dirname(f), m[2]); if (t.endsWith(".js") && existsSync(t)) todo.push(t); else if (t.endsWith(".js")) assert.fail(`${f} imports ${m[2]}: no such file`); }
  }
  return [...seen];
}
const DOM = /\b(document|window|navigator|location|localStorage|sessionStorage|self|requestAnimationFrame|matchMedia|HTMLElement|addEventListener|devicePixelRatio|Worker|ResizeObserver|IntersectionObserver|MutationObserver|CSS|Image|screen|innerWidth|innerHeight|fetch|WebSocket|EventSource|Event|CustomEvent|Node|Element)\b/;

test("every module app.js loads imports for real", async () => {
  const files = graph(resolve(PUB, "app.js")).concat(graph(resolve(PUB, "anton.js")));
  assert.ok(files.length > 40, `the walk found ${files.length} modules`);
  const bad = [];
  for (const f of new Set(files)) {
    try { await import(pathToFileURL(f).href); }
    catch (e) { if (!(e instanceof ReferenceError && DOM.test(e.message))) bad.push(`${f.slice(PUB.length + 1)}: ${e.name}: ${e.message}`); }
  }
  assert.deepEqual(bad, []);
});
