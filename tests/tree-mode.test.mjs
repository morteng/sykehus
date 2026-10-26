/* U3676 (Morten 2026-10-26 16:54Z «a switch to change between trees off/trees simple/trees full»): the button cycles full, simple, off; the viewer draws each; the choice is kept per browser. Run: node --test tests/tree-mode.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TREE_MODES, nextTree, treeTitle } from "../public/treemode.js";
const read = f => readFileSync(new URL(`../public/${f}`, import.meta.url), "utf8");
test("the button cycles full, enkel, av and back, and says what it will do", () => {
  assert.deepEqual(TREE_MODES, ["full", "simple", "off"]); assert.equal(nextTree("full"), "simple"); assert.equal(nextTree("simple"), "off"); assert.equal(nextTree("off"), "full"); assert.equal(nextTree("junk"), "full");
  assert.equal(treeTitle("full"), "Trær: full. Trykk for enkel"); assert.equal(treeTitle("off"), "Trær: av. Trykk for full");
});
test("the viewer draws nothing when off, the plain solids when simple, EZ-Tree's models when full; the default is the tier's; a switch draws again in place", () => {
  const v = read("viewer.js");
  assert.match(v, /let treeMode = \["off", "simple", "full"\]\.includes\(treeMode0\) \? treeMode0 : Q\.ez \? "full" : "simple"/, "default: full where the tier carries it, simple where not");
  assert.match(v, /if \(!trees\.length \|\| treeMode === "off"\) return;/); assert.match(v, /if \(treeMode === "simple"\) \{/, "the cheap shapes");
  assert.match(v, /treeMode\(m\) \{ if \(m && m !== treeMode && \["off", "simple", "full"\]\.includes\(m\)\) \{ treeMode = m; setTrees\(treeList\); \} return treeMode; \}/);
  assert.match(v, /Q\.leaves \|\| 0\.35/, "full on a low tier still has leaves");
});
test("one list holds the OSM trees, the planted trees and the bushes, so one switch covers all (landscape.js puts every planting in site.trees)", () => {
  assert.match(read("landscape.js"), /site\.trees = trees;/); assert.match(read("landscape.js"), /shrub: \{ ht: 2\.5/);
});
test("the choice is kept per browser in a try/catch, and read before the viewer is made; the button is in the tool column and stays in photo mode", () => {
  const a = read("app.js"), h = read("index.html"), c = read("sykehus.css");
  assert.match(a, /localStorage\.getItem\(TREES\); \} catch \{ return null; \}/); assert.match(a, /localStorage\.setItem\(TREES, v\); \} catch/); assert.match(a, /createViewer\(\{\n  treeMode: treeStore\.get\(\),/);
  assert.match(h, /id="mtree" data-mode="full"/); assert.ok(h.indexOf('id="sunBtn"') < h.indexOf('id="mtree"') && h.indexOf('id="mtree"') < h.indexOf('<div class="sun-pop"'));
  assert.match(c, /:not\(#sunBtn\):not\(#mtree\)/);
});
