/* Constructions (U3570): a «bim» volume in design.js, and bim.mjs's prepare against a worker that answers as the real
   one does (worker/service.py), so no Python is needed here.
   node --test tests/bim.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkEdit, applyEdits } from "../public/edits.js";
import { bimPlace } from "../public/design.js";

const site = JSON.parse(readFileSync(new URL("../public/data/site.json", import.meta.url)));
const floors = JSON.parse(readFileSync(new URL("../public/data/floors.json", import.meta.url))).floors;
const add = (edits, e) => { const m = applyEdits(site, floors, edits); edits.push(checkEdit(m.site, m.floors, e)); return edits; };
const BOX = { min: [-15, -15, 0], max: [15, 15, 18] }, SHA = "a".repeat(64);
const pyramid = { kind: "volume", id: "nDrivhus", name: "Drivhus", use: "drivhus", shape: "bim", material: "glass", from: [-10, -80], to: [10, -80],
  bim: { script: "import ifcopenshell\n", params: { base: 30, top: 18, module: 3 }, sha: SHA, box: BOX, classes: { IfcMember: 40, IfcPlate: 16 } } };

test("a construction takes its length, width and height from its box, centred where it was put", () => {
  const m = applyEdits(site, floors, add([], pyramid)), a = m.site.added[0];
  assert.equal(a.shape, "bim"); assert.equal(a.width, 30); assert.equal(a.height, 18);
  assert.deepEqual([a.from, a.to], [[-15, -80], [15, -80]]);
  assert.equal(a.footprint_m2, 900); assert.equal(a.volume_m3, null);
  assert.equal(a.bim.sha, SHA); assert.equal(a.use, "drivhus");
});

test("a construction not yet run, or with a bad parameter, is refused", () => {
  assert.throws(() => add([], { ...pyramid, bim: { ...pyramid.bim, sha: "x" } }), /ikke bygget/);
  assert.throws(() => add([], { ...pyramid, bim: { ...pyramid.bim, params: { "a-b": 1 } } }), /Parameteren/);
  assert.throws(() => add([], { ...pyramid, bim: { ...pyramid.bim, box: null } }), /ingen form/);
});

test("its size changes only by its parameters; a move keeps its size", () => {
  const ed = add([], pyramid);
  assert.throws(() => add(ed.slice(), { kind: "reshape", id: "nDrivhus", width: 40 }), /parametrene/);
  assert.throws(() => add(ed.slice(), { kind: "reshape", id: "nDrivhus", params: { base: 20 } }), /./);
  const moved = applyEdits(site, floors, add(ed.slice(), { kind: "reshape", id: "nDrivhus", from: [0, -100], to: [0, -90] })).site.added[0];
  assert.equal(Math.hypot(moved.to[0] - moved.from[0], moved.to[1] - moved.from[1]), 30, "turned north, still its box's length");
  const box2 = { min: [-10, -10, 0], max: [10, 10, 12] };
  const re = applyEdits(site, floors, add(ed.slice(), { kind: "reshape", id: "nDrivhus", bim: { ...pyramid.bim, params: { base: 20, top: 12, module: 3 }, sha: "b".repeat(64), box: box2 } })).site.added[0];
  assert.equal(re.width, 20); assert.equal(re.height, 12); assert.deepEqual([re.from, re.to], [[-10, -80], [10, -80]]);
});

test("bimPlace: the box's middle to the middle of from → to, x along it, the foot at base", () => {
  const at = bimPlace({ from: [0, 0], to: [0, 10], bim: { box: { min: [-5, -2, 3], max: [5, 2, 9] } } }, 100);
  assert.deepEqual(at([0, 0, 3]).map(v => Math.round(v * 1000) / 1000), [0, 5, 100]);
  assert.deepEqual(at([5, 0, 9]).map(v => Math.round(v * 1000) / 1000), [0, 10, 106], "x runs north when from → to does");
});

/* a worker as worker/service.py answers: a job done with mesh.json and model.ifc, or failed with a code */
function fakeWorker(answer) {
  const seen = [];
  const srv = createServer((req, res) => {
    let b = ""; req.on("data", c => b += c); req.on("end", () => {
      if (req.method === "POST") { seen.push(JSON.parse(b)); return res.end(JSON.stringify(answer(seen.at(-1)))); }
      if (req.url.endsWith("/mesh.json")) return res.end(JSON.stringify({ box: BOX, classes: { IfcMember: 4, IfcPlate: 4 }, buildings: 1, storeys: 1, triangles: 2,
        parts: [{ cls: "IfcPlate", n: 1, pos: [-15, -15, 0, 15, -15, 0, 0, 0, 18], idx: [0, 1, 2] }] }));
      res.end("ISO-10303-21;");
    });
  });
  return new Promise(r => srv.listen(0, "127.0.0.1", () => r({ url: `http://127.0.0.1:${srv.address().port}`, seen, close: () => srv.close() })));
}

test("prepare: a construction runs in the worker, stands where the page draws it, and runs again on a parameter change or a move", async () => {
  process.env.SYKEHUS_VERSIONS_DIR = mkdtempSync(join(tmpdir(), "bim-"));
  const w = await fakeWorker(() => ({ state: "done", result: { ok: 1 }, files: { "mesh.json": "/jobs/x/files/mesh.json", "model.ifc": "/jobs/x/files/model.ifc" } }));
  process.env.SYKEHUS_WORKER = w.url;
  try {
    const { prepare, slim, withMeshes } = await import("../bim.mjs");
    const e = { kind: "construction", name: "Drivhus", use: "drivhus", from: [-10, -80], to: [10, -80], script: "print(1)", params: { base: 30, module: 3 } };
    const p = await prepare(e, site), { _ran, ...v } = p;
    assert.equal(v.kind, "volume"); assert.equal(v.shape, "bim"); assert.equal(v.material, "glass");
    assert.ok(Number.isFinite(v.bim.params.ground), "the ground under it goes in as a parameter");
    assert.ok(w.seen.length <= 2, "once, and once more when its own footprint stands lower than the guess"); assert.deepEqual(w.seen[0].then, ["mesh", "glb"]);
    assert.ok(_ran.warning, "the fake's foot is at z 0, not at ground: said"); assert.equal(_ran.foot_kote, v.bim.params.ground);
    const n0 = w.seen.length;
    await prepare(e, site); assert.equal(w.seen.length, n0, "the same script and parameters: the kept result");
    assert.equal(slim(v).bim.script, undefined); assert.equal(slim(v).bim.script_chars, 8);
    const ed = add([], v), m = applyEdits(site, floors, ed);
    assert.equal(m.site.added[0].base_kote, Math.round(v.bim.params.ground * 10) / 10, "the IFC's foot is the page's foot (pm 00:58Z)");
    const r = await prepare({ kind: "reshape", id: v.id ?? m.site.added[0].id, params: { module: 2 } }, m.site);
    assert.equal(w.seen.length, n0 + 1); assert.equal(r.bim.params.module, 2); assert.equal(r.bim.params.base, 30); assert.equal(r.params, undefined);
    const mv = await prepare({ kind: "reshape", id: m.site.added[0].id, from: [-10, -40], to: [10, -40] }, m.site);
    assert.ok(mv.bim, "a move runs it again where it now stands"); assert.equal(mv.bim.params.module, 3);
    const n1 = w.seen.length;
    const kept = await prepare({ ...v, bim: { ...v.bim, sha: "f".repeat(64), box: { min: [0, 0, 0], max: [1, 1, 1] } } }, site);
    assert.equal(kept.bim.sha, v.bim.sha, "a kept construction's sha and box are the server's, not what was sent"); assert.deepEqual(kept.bim.box, BOX); assert.equal(w.seen.length, n1);
    const look = withMeshes(m.site).added[0];
    assert.equal(look.parts.length, 1); assert.equal(look.parts[0].mat, "glass"); assert.equal(look.parts[0].tris.length, 1);
  } finally { w.close(); }
});

test("prepare: the worker's failure in plain words, with the script's line", async () => {
  const w = await fakeWorker(() => ({ state: "failed", errors: [{ code: "script_error", line: 7, message: "NameError: name 'math' is not defined" }], log: "Traceback …\nNameError: name 'math' is not defined" }));
  process.env.SYKEHUS_WORKER = w.url;
  try {
    const { prepare } = await import("../bim.mjs");
    await assert.rejects(prepare({ kind: "construction", name: "X", from: [0, -80], to: [10, -80], script: "boom()", params: {} }, site), /linje 7: NameError/);
  } finally { w.close(); }
});
