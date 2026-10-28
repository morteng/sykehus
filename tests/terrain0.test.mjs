/* S4: applyDesign leaves the ground as it was before the buildings' own pads as site.terrain0 (not enumerable, the same
   shared grid, never a copy), so bim.mjs's prepare looks a construction's foot up in the plateau, not in a pad under a tower.
   node --test tests/terrain0.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkEdit, applyEdits } from "../public/edits.js";

const site0 = JSON.parse(readFileSync(new URL("../public/data/site.json", import.meta.url)));
const floors = JSON.parse(readFileSync(new URL("../public/data/floors.json", import.meta.url))).floors;
/* Borg: a plateau at 15.5 and a tower whose own pad is cut to 13 */
const terrain = { ...site0.terrain, z: new Array(site0.terrain.z.length).fill(15.5) }, site = { ...site0, terrain };
const add = (edits, e) => { const m = applyEdits(site, floors, edits); edits.push(checkEdit(m.site, m.floors, e)); return edits; };
const tower = { kind: "volume", id: "tarn", name: "Tårn", shape: "box", material: "concrete", from: [-10, -80], to: [10, -80], width: 10, height: 30, base_kote: 13 };

test("the grid before the pads is kept, shared, and invisible to a copy or a save", () => {
  const edits = add([], tower), m = applyEdits(site, floors, edits);
  assert.ok(m.site.terrain.z.some(z => z < 15.5), "the tower's pad is in the after's grid");
  assert.ok(m.site.terrain0.z.every(z => z === 15.5), "terrain0 is the plateau as it was");
  assert.equal(m.site.terrain0, terrain, "the same object as the model's grid: no copy");
  assert.equal(Object.keys(m.site).includes("terrain0"), false, "not enumerable: a spread leaves it");
  assert.equal(JSON.stringify(m.site).includes("terrain0"), false);
  assert.equal(JSON.stringify(edits).includes("terrain0"), false, "nothing of it in the edits that are saved");
  const m2 = applyEdits(m.site, floors, []);
  assert.equal(m2.site.terrain0, undefined, "the next applyEdits does not carry it");
  assert.equal(applyEdits(site, floors, []).site.terrain0, undefined, "no pads, no terrain0");
});

/* end to end: applyEdits -> prepare with a stub worker. Needs bim.mjs to read terrain0 (builder fixb, 6f004e1) */
const reads = readFileSync(new URL("../bim.mjs", import.meta.url), "utf8").includes("terrain0");
test("a later construction gets the plateau's ground, 15.5 end to end", { skip: !reads && "bim.mjs does not read terrain0 yet (fixb 6f004e1)" }, async () => {
  const BOX = { min: [-15, -15, 0], max: [15, 15, 18] }, seen = [];
  const srv = createServer((req, res) => { let b = ""; req.on("data", c => b += c); req.on("end", () => {
    if (req.method === "POST") { seen.push(JSON.parse(b)); return res.end(JSON.stringify({ state: "done", result: { ok: 1 }, files: { "mesh.json": "/jobs/x/files/mesh.json", "model.ifc": "/jobs/x/files/model.ifc" } })); }
    if (req.url.endsWith("/mesh.json")) return res.end(JSON.stringify({ box: BOX, classes: { IfcPlate: 4 }, buildings: 1, storeys: 1, triangles: 2, parts: [{ cls: "IfcPlate", n: 1, pos: [-15, -15, 0, 15, -15, 0, 0, 0, 18], idx: [0, 1, 2] }] }));
    res.end("ISO-10303-21;"); }); });
  await new Promise(ok => srv.listen(0, "127.0.0.1", ok));
  process.env.SYKEHUS_VERSIONS_DIR = mkdtempSync(join(tmpdir(), "terrain0-")); process.env.SYKEHUS_WORKER = `http://127.0.0.1:${srv.address().port}`;
  try {
    const { prepare } = await import("../bim.mjs"), m = applyEdits(site, floors, add([], tower));
    const c = await prepare({ kind: "construction", name: "Hall", from: [-10, -80], to: [10, -80], script: "print('hall')", params: {} }, m.site);
    assert.equal(c.bim.params.ground, 15.5, "the ground before the tower's pad, not the 13 of the pad");
    assert.equal(seen.at(-1).params.ground, 15.5, "and that is what the worker was given");
  } finally { srv.close(); }
});
