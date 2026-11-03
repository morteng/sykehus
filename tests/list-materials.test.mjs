/* U3618: the material list Anton can read (list_materials) is renderkit's one list; every picture it names is served and credited.
   node --test tests/list-materials.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { MATERIALS } from "../public/renderkit/materials.js";
import { FAMILY } from "../toolguide.mjs";

const src = readFileSync(new URL("../mcp.mjs", import.meta.url), "utf8"), credits = readFileSync(new URL("../docs/tex-credits.txt", import.meta.url), "utf8");

test("every texture set of the library is a file in renderkit and is credited", () => {
  for (const [k, m] of Object.entries(MATERIALS)) if (m.texture) {
    for (const n of ["Color", "NormalGL", "Roughness"]) assert.ok(existsSync(new URL(`../public/renderkit/${m.texture.set}_${n}.jpg`, import.meta.url)), `${k}: ${m.texture.set}_${n}`);
    assert.ok(credits.includes(m.texture.set), `${m.texture.set} is not in docs/tex-credits.txt`);
  }
});

test("the nine named materials are all there, with Norwegian names for Anton", () => {
  for (const k of ["concrete", "brick", "wood", "tile" in MATERIALS ? "tile" : "paving", "gravel", "grass", "water", "glass", "steel"]) assert.ok(MATERIALS[k]?.no, k);
  assert.equal(MATERIALS.concrete.no, "Betong"); assert.equal(MATERIALS.brick.no, "Tegl");
});

test("list_materials is a tool in the Deler group, built from the one list", () => {
  assert.equal(FAMILY.list_materials, "Deler");
  assert.match(src, /name: "list_materials"[\s\S]*Object\.entries\(MATERIALS\)/);
});
