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

/* a file brought in (U3571): the bytes to the worker's /blobs, a steps-only job meshes it, kept by its sha */
test("importIfc and prepare: an uploaded IFC is read once, kept by its sha, and stands like a construction", async () => {
  const { createHash } = await import("node:crypto");
  const ifc = Buffer.from("ISO-10303-21;\nHEADER;\nFILE_SCHEMA(('IFC4'));\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n"), sha = createHash("sha256").update(ifc).digest("hex");
  const seen = [], MESH = { box: { min: [1000, 2000, 5], max: [1006, 2003, 8.5] }, unit: { length: "millimetre", to_m: 0.001 }, classes: { IfcWindow: 1 }, buildings: 0, storeys: 0, triangles: 1,
    parts: [{ cls: "IfcWindow", n: 1, pos: [1000, 2000, 5, 1006, 2000, 5, 1003, 2003, 8.5], idx: [0, 1, 2] }] };
  const srv = createServer((req, res) => { const b = []; req.on("data", c => b.push(c)); req.on("end", () => {
    const body = Buffer.concat(b); seen.push([req.method, req.url.split("?")[0]]);
    if (req.url === "/blobs") return res.end(JSON.stringify({ sha256: createHash("sha256").update(body).digest("hex"), bytes: body.length }));
    if (req.url.startsWith("/jobs?")) { const j = JSON.parse(body); seen.push(j); return res.end(JSON.stringify({ state: "done", files: { "mesh.json": "/jobs/y/files/mesh.json" } })); }
    res.end(JSON.stringify(MESH));
  }); });
  await new Promise(r => srv.listen(0, "127.0.0.1", r));
  process.env.SYKEHUS_WORKER = `http://127.0.0.1:${srv.address().port}`;
  try {
    const { importIfc, prepare, slim } = await import("../bim.mjs");
    await assert.rejects(importIfc(Buffer.from("solid x\nendsolid\n")), /ikke en IFC-fil/);
    const r = await importIfc(ifc, { filename: "Vindu «A».ifc", by: "p1" });
    assert.equal(r.file, sha); assert.deepEqual(r.size_m, [6, 3, 3.5]); assert.equal(r.unit.length, "millimetre"); assert.equal(r.filename, "Vindu «A».ifc");
    const job = seen.find(x => x.inputs); assert.deepEqual(job, { inputs: { "model.ifc": sha }, then: ["mesh"] });
    const n0 = seen.length; await importIfc(ifc); assert.equal(seen.length, n0, "the same bytes: kept, not read again");
    await assert.rejects(prepare({ kind: "import", file: sha, from: [0, -80], to: [6, -80] }, site), /lisensen/);
    const p = await prepare({ kind: "import", file: sha, from: [0, -80], to: [6, -80], licence: "Fri bruk fra produsenten", source: "https://example.com/vindu" }, site), { _ran, ...v } = p;
    assert.equal(v.kind, "volume"); assert.equal(v.shape, "bim"); assert.equal(v.material, "glass"); assert.equal(v.name, "Vindu «A»");
    assert.equal(v.bim.file, sha); assert.equal(v.bim.sha, sha); assert.equal(v.bim.licence, "Fri bruk fra produsenten"); assert.equal(slim(v), v);
    const ed = add([], v), m = applyEdits(site, floors, ed), a = m.site.added[0];
    assert.equal(a.width, 3); assert.equal(a.height, 3.5); assert.equal(Math.hypot(a.to[0] - a.from[0], a.to[1] - a.from[1]), 6);
    assert.equal(a.bim.source, "https://example.com/vindu");
    const mv = await prepare({ kind: "reshape", id: a.id, from: [0, -60], to: [6, -60] }, m.site);
    assert.equal(mv.bim, undefined, "a move keeps the file as it is"); assert.equal(seen.length, n0);
    await assert.rejects(prepare({ kind: "reshape", id: a.id, params: { x: 1 } }, m.site), /ingen parametre/);
    const kept = await prepare({ ...v, bim: { ...v.bim, box: { min: [0, 0, 0], max: [1, 1, 1] } } }, site);
    assert.deepEqual(kept.bim.box, MESH.box, "a kept import's box is the file's, not what was sent");
    await assert.rejects(prepare({ kind: "import", file: "c".repeat(64), from: [0, -80], to: [6, -80], licence: "x" }, site), /finnes ikke/);
  } finally { srv.close(); }
});
