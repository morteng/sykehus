import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MATERIALS } from "../public/renderkit/materials.js";
import { indexLooks } from "../public/renderkit/looklib.js";
import { materialFor } from "../public/renderkit/looks.js";
import { LOOK_IDS, KEPT_FLAT, lookIdFor, missingLooks, libraryMaterial } from "../public/lookmap.js";

/* U4471: the kit's look library (looklib.json, taken with the render kit) and the id each Sykehus material wears. */
const looks = indexLooks(JSON.parse(readFileSync(new URL("../public/renderkit/looklib.json", import.meta.url), "utf8")));
const url = n => new URL(`../public/renderkit/${n}`, import.meta.url).href;

test("every material of the site has an entry in LOOK_IDS", () => {
  for (const k of Object.keys(MATERIALS)) assert.ok(Object.hasOwn(LOOK_IDS, k), `${k} has no look id (null is an answer)`);
  for (const k of Object.keys(LOOK_IDS)) assert.ok(Object.hasOwn(MATERIALS, k), `${k} is not a material`);
});

test("the ids brick, concrete and steel ask for", () => {
  assert.equal(LOOK_IDS.brick, "brick");
  assert.equal(LOOK_IDS.concrete, "concrete");
  assert.equal(LOOK_IDS.steel, "steel-satin");
  assert.equal(LOOK_IDS.window_glass, "glass-window");
});

test("steel and glass resolve in the taken library; the ambientCG sets are the next kits row", () => {
  for (const k of ["steel", "glass", "window_glass"]) assert.equal(lookIdFor(k, looks), LOOK_IDS[k]);
  // the library holds no record for the seven ambientCG sets yet: the viewer keeps their texture {set, tile}. When the kit takes them this list shrinks (and the test is told).
  assert.deepEqual(missingLooks(looks).sort(), ["asphalt: asphalt", "brick: brick", "concrete: concrete", "grass: grass", "gravel: gravel", "paving: paving", "water: water", "wood: wood-planks"]);
  assert.equal(lookIdFor("brick", looks), null);
  assert.equal(lookIdFor("soil", looks), null);
});

test("the materials the library lacks keep a texture or a look of their own (nothing regresses)", () => {
  for (const m of missingLooks(looks).map(s => s.split(":")[0])) assert.ok(MATERIALS[m].texture || MATERIALS[m].look, `${m}: no fallback`);
});

test("materialFor(steel) takes the library record's numbers", async () => {
  const rec = looks["steel-satin"], r = await materialFor("steel-satin", { url, looks });
  assert.equal(r.face.metalness, rec.base.metalness);
  assert.equal(r.face.roughness, rec.base.roughness);
  assert.equal(r.face.color.getHexString(), rec.base.colour.slice(1));
  assert.equal(r.uv, "none");
});

test("libraryMaterial: no record, kept-flat glass and a failed fetch give null", async () => {
  assert.ok(KEPT_FLAT.has("window_glass"));
  assert.equal(await libraryMaterial("window_glass"), null);
  assert.equal(await libraryMaterial("brick"), null);   // fetch of renderkit/looklib.json fails in node: the caller keeps its texture
});

test("the viewer imports the taken files", () => {
  const v = readFileSync(new URL("../public/viewer.js", import.meta.url), "utf8");
  assert.match(v, /from "\.\/lookmap\.js"/);
  const m = readFileSync(new URL("../public/lookmap.js", import.meta.url), "utf8");
  for (const f of ["looks.js", "looklib.js"]) assert.match(m, new RegExp(`renderkit/${f.replace(".", "\\.")}`));
});
