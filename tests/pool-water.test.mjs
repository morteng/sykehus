/* A roof pool in one call, and an honest answer when a try_change is refused (Anton 2026-10-27, wishes wwcsO0VGFGG and woZyiZ-udd3, version Badeland):
   pool_basin takes bottom (glass | concrete, the worker's) and water (the server adds a volume of water inside the basin), a part stands on a roof by
   at {wing, roof: true}, reshape takes material, and a fully refused try_change leads with its reason, counts applied and rejected, says saved: false
   and is an error for the caller (agentkit's replay guard keeps only calls that worked, so a retry of a refused one is not taken for a repeat).
   Driven through the MCP call with a worker that answers as gulden-worker's service.py does.  node --test tests/pool-water.test.mjs */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const SPEC = { no: "Basseng (konstruksjon)", say: "pool", engine: "ifcopenshell", classes: ["IfcSlab"], params: {
  length: { type: "number", min: 2, max: 50, default: 8 }, width: { type: "number", min: 1.5, max: 25, default: 4 }, depth: { type: "number", min: 0.3, max: 4, default: 1.4 },
  wall: { type: "number", min: 0.15, max: 0.5, default: 0.25 }, floor: { type: "number", min: 0.15, max: 0.5, default: 0.25 }, coping: { type: "number", min: 0, max: 1.5, default: 0.3 },
  freeboard: { type: "number", min: 0, max: 0.5, default: 0.15 }, bottom: { type: "string", enum: ["concrete", "glass"], default: "concrete" } } };
const jobs = [], meshes = new Map();
const fake = createServer((req, res) => {
  let b = ""; req.on("data", c => b += c); req.on("end", () => {
    if (req.url.startsWith("/parts")) return res.end(JSON.stringify({ parts: { pool_basin: SPEC } }));
    if (req.method === "POST") {
      const j = JSON.parse(b); jobs.push(j);
      const bad = Object.keys(j.params).find(k => !(k in SPEC.params)); if (bad) { res.statusCode = 422; return res.end(JSON.stringify({ state: "failed", errors: [{ code: "bad_params", message: `${bad}: not a setting` }] })); }
      const p = Object.fromEntries(Object.entries(SPEC.params).map(([k, v]) => [k, j.params[k] ?? v.default])), o = p.wall + p.coping, id = `${p.length}_${p.width}_${p.depth}_${p.bottom}`;
      meshes.set(id, { box: { min: [-o, -p.width / 2 - o, -p.depth - p.floor], max: [p.length + o, p.width / 2 + o, 0] }, classes: { IfcSlab: 1 }, buildings: 1, storeys: 1, triangles: 2,
        parts: [{ cls: "IfcSlab", n: 1, pos: [-o, -p.width / 2 - o, -p.depth, p.length + o, -p.width / 2 - o, -p.depth, p.length + o, p.width / 2 + o, -p.depth], idx: [0, 1, 2] }] });
      return res.end(JSON.stringify({ state: "done", result: { params: p }, files: { "mesh.json": `/f/${id}/mesh.json`, "model.ifc": `/f/${id}/model.ifc` } }));
    }
    const m = req.url.match(/^\/f\/([^/]+)\/(.*)$/); if (m && m[2] === "mesh.json") return res.end(JSON.stringify(meshes.get(m[1]))); res.end("ISO-10303-21;");
  });
});
await new Promise(r => fake.listen(0, "127.0.0.1", r));
const dir = mkdtempSync(join(tmpdir(), "sykehus-pool-")), secret = "proxy-secret-for-tests-0123456789", PORT = 9800 + Math.floor(Math.random() * 90);
const srv = spawn(process.execPath, [new URL("../server.mjs", import.meta.url).pathname], { env: { ...process.env, PORT: String(PORT), SYKEHUS_VERSIONS_DIR: join(dir, "v"), SYKEHUS_PROXY_SECRET: secret, DOCS: "", SYKEHUS_WORKER: `http://127.0.0.1:${fake.address().port}` }, stdio: ["ignore", "pipe", "inherit"] });
await new Promise(ok => srv.stdout.on("data", d => String(d).includes("Sykehustomta on") && ok()));
after(() => { srv.kill(); fake.close(); });
const H = { "remote-user": "lars", "x-sykehus-proxy-auth": secret };
const call = async (name, args) => (await (await fetch(`http://localhost:${PORT}/mcp`, { method: "POST", headers: { "content-type": "application/json", ...H }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) })).json()).result;
const text = r => r.content.filter(c => c.type === "text").map(c => c.text).join(" ");
const stored = async id => (await (await fetch(`http://localhost:${PORT}/api/versjon/${id}`, { headers: H })).json()).edits;
const POOL = { kind: "part", part: "pool_basin", name: "Takbasseng", at: { wing: "sentralblokka", roof: true }, params: { length: 8, width: 4, bottom: "glass", water: true }, why: "test" };
let V, poolId, waterId;

test("a pool basin on a roof, glass bottom, filled: one call, two stored changes; the worker got bottom and not water", async () => {
  const r = await call("try_change", { edits: [POOL], include_screenshot: false }); assert.ok(!r.isError, text(r));
  const sc = r.structuredContent; V = sc.version;
  assert.equal(sc.applied, 2); assert.equal(sc.rejected_n, 0); assert.deepEqual(sc.rejected, []); assert.equal(sc.saved, true); assert.equal(sc.changes, 2);
  const j = jobs.at(-1); assert.equal(j.part, "pool_basin"); assert.equal(j.params.bottom, "glass"); assert.equal(j.params.water, undefined, "water is the server's, not the worker's");
  assert.equal(j.params.length, 8);
  const ed = await stored(V); assert.equal(ed.length, 2);
  const [pool, water] = ed; poolId = pool.id; waterId = water.id;
  assert.equal(pool.shape, "bim"); assert.equal(pool.bim.part, "pool_basin"); assert.equal(pool.on, "sentralblokka"); assert.equal(pool.bim.params.bottom, "glass");
  assert.equal(water.material, "water"); assert.equal(water.shape, "box"); assert.equal(water.on, "sentralblokka"); assert.equal(water.width, 4); assert.match(pool.id, /^nbasseng/); assert.equal(water.id, `${pool.id}vann`, "named from its basin, so it can be reshaped");
  assert.equal(water.height, 1.25, "the basin's depth 1.4 less its freeboard 0.15");
  assert.equal(water.drop_m, 1.4, "its foot is the floor's top, a depth under the roof the coping lies on");
  assert.ok(Math.abs(Math.hypot(water.to[0] - water.from[0], water.to[1] - water.from[1]) - 8) < 0.02, "8 m inside the basin");
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], m1 = mid(pool.from, pool.to), m2 = mid(water.from, water.to);
  assert.ok(Math.hypot(m1[0] - m2[0], m1[1] - m2[1]) < 0.02, "in the middle of the basin");
  assert.match(JSON.stringify(sc.added), /Takbasseng \(vann\)/);
});

test("water as a number is that many m deep; false is an empty basin", async () => {
  const r = await call("try_change", { edits: [{ ...POOL, name: "Basseng B", at: { wing: "sentralblokka", roof: true, u: 5, v: 5 }, params: { length: 6, width: 3, water: 0.6 } }], include_screenshot: false }); assert.ok(!r.isError, text(r));
  assert.equal(r.structuredContent.applied, 2); const ed = await stored(V); assert.equal(ed.at(-1).height, 0.6); assert.equal(jobs.at(-1).params.bottom, undefined, "bottom left out: the worker's default");
  const e = await call("try_change", { edits: [{ ...POOL, name: "Basseng C", at: { wing: "sentralblokka", roof: true, u: 20, v: 5 }, params: { length: 6, width: 3, water: false } }], include_screenshot: false });
  assert.equal(e.structuredContent.applied, 1); assert.equal((await stored(V)).length, 5);
});

test("reshape takes material, water and glass too, and a water volume may be 0.3 m", async () => {
  const r = await call("try_change", { edits: [{ kind: "reshape", id: waterId, material: "glass", height: 0.3, why: "test" }], include_screenshot: false }); assert.ok(!r.isError, text(r));
  assert.equal(r.structuredContent.applied, 1); const w = (await stored(V)).at(-1); assert.equal(w.material, "glass"); assert.equal(w.height, 0.3);
  const back = await call("try_change", { edits: [{ kind: "reshape", id: waterId, material: "water" }], include_screenshot: false }); assert.equal((await stored(V)).at(-1).material, "water");
  const bad = await call("try_change", { edits: [{ kind: "reshape", id: waterId, material: "lava" }], include_screenshot: false }); assert.equal(bad.isError, true); assert.match(text(bad), /material er (\w+, ){5}water/);
  const prm = await call("try_change", { edits: [{ kind: "reshape", id: poolId, params: { bottom: "concrete" } }], include_screenshot: false }); assert.ok(!prm.isError, text(prm));
  assert.equal(jobs.at(-1).params.bottom, "concrete"); assert.equal(jobs.at(-1).params.length, 8, "the other settings stay");
});

test("a fully refused try_change: the reason first, counts, saved false, nothing stored, an error for the caller", async () => {
  const before = (await stored(V)).length;
  const ring = [[0, 0], [10, 0], [10, 10], [0, 10]], bad = { kind: "surface", surface: "water", on: "sentralblokka", ring, why: "test" };
  const r = await call("try_change", { edits: [bad] }); // with the picture on: a refusal draws none
  assert.equal(r.isError, true);
  const t = text(r); assert.match(t.split("\n")[0], /^Avvist, ingenting er lagret: Vann legges ikke på et tak som flate/);
  const sc = r.structuredContent;
  assert.equal(sc.applied, 0); assert.equal(sc.rejected_n, 1); assert.equal(sc.saved, false); assert.deepEqual(sc.added, []); assert.equal(sc.changes, before); assert.equal(sc.version, V);
  assert.match(sc.rejected[0].error, /Vann legges ikke på et tak/); assert.equal(sc.rejected[0].index, 0);
  assert.match(sc.rejected[0].try, /volum med material water ved at \{wing, roof: true, u, v\}.*pool_basin/, "the nearest way that works");
  assert.match(sc.rejected[0].error, /material: water, at: \{wing, roof: true, u, v\}/);
  for (const k of ["after", "fit", "checks", "picture"]) assert.equal(sc[k], undefined, `${k} is cut from a refusal`);
  assert.ok(JSON.stringify(sc).length < 1500, `the refusal is ${JSON.stringify(sc).length} chars`); assert.equal(r.content.some(c => c.type === "image"), false);
  assert.equal((await stored(V)).length, before, "the version is as it was");
  const again = await call("try_change", { edits: [bad] });   // the identical retry is answered again, as a refusal, and is an error again
  assert.equal(again.isError, true); assert.match(text(again), /^Avvist, ingenting er lagret/); assert.equal(again.structuredContent.applied, 0);
});

test("a retry of a refused call goes in once the cause is gone; sent twice after that it is «finnes allerede», not applied twice", async () => {
  const bad = { kind: "volume", name: "Vann på taket", shape: "box", material: "water", height: 0.5, at: { wing: "sentralblokka", roof: true, u: 40, v: 5 }, length: 6, width: 3, why: "test", id: "nvt1" };
  const n0 = (await stored(V)).length;
  const first = await call("try_change", { edits: [{ ...bad, height: 0.01 }], include_screenshot: false }); assert.equal(first.isError, true); assert.equal(first.structuredContent.applied, 0);
  const ok = await call("try_change", { edits: [bad], include_screenshot: false }); assert.ok(!ok.isError, text(ok)); assert.equal(ok.structuredContent.applied, 1); assert.equal((await stored(V)).length, n0 + 1);
  const dup = await call("try_change", { edits: [bad], include_screenshot: false }); assert.equal(dup.isError, true); assert.match(text(dup), /Finnes allerede som endring nr\. \d+|overlapper/); assert.equal((await stored(V)).length, n0 + 1);
});

test("some in, some refused: not an error, saved true, the counts say both", async () => {
  const n0 = (await stored(V)).length;
  const r = await call("try_change", { edits: [{ kind: "note", text: "en merknad", wing: "midtfloy" }, { kind: "banan" }], include_screenshot: false });
  assert.ok(!r.isError); const sc = r.structuredContent; assert.equal(sc.applied, 1); assert.equal(sc.rejected_n, 1); assert.equal(sc.saved, true); assert.equal(sc.rejected[0].index, 1); assert.equal((await stored(V)).length, n0 + 1);
});

test("a missing capability names the nearest way: material on a surface; a part without a place", async () => {
  const r = await call("try_change", { edits: [{ kind: "surface", surface: "grass", material: "water", ring: [[0, 0], [10, 0], [10, 10]] }, { kind: "part", part: "pool_basin" }], include_screenshot: false });
  assert.equal(r.isError, true); const [a, b] = r.structuredContent.rejected;
  assert.match(a.try, /surface \(grass, gravel, paving, water/); assert.match(b.error, /part mangler from og to \(eller at: \{wing, roof: true, u, v\}/);
});

test("find_tool: the roof pool, the glass bottom and the water fill are found, with the one-call way", async () => {
  for (const intent of ["water in roof pool", "glass bottom", "fill pool with water", "takbasseng med glassbunn og vann"]) {
    const m = (await call("find_tool", { intent })).structuredContent.matches, part = m.find(x => x.id === "part"), vol = m.find(x => x.id === "volume");
    assert.ok(part, `${intent}: ${m.map(x => x.id)}`); assert.match(part.note, /pool_basin.*roof: true.*bottom: glass \| concrete, water: true/); assert.equal(part.example_edit.params.bottom, "glass"); assert.ok(vol, `${intent}: no volume`);
  }
  const t = (await call("find_tool", { topic: "roof:pool" })).structuredContent.text; assert.match(t, /material water/); assert.match(t, /bottom/);
  assert.match((await call("find_tool", { kind: "reshape" })).structuredContent.note, /material: glass, concrete, steel, wood, brick eller water/);
  const lp = (await call("list_parts", {})).structuredContent.parts.find(p => p.part === "pool_basin"); assert.ok(lp.settings.water && lp.settings.bottom);
});

test("a pool basin in the ground with water: the water's foot is the floor's top and the ground is not levelled to it", async () => {
  const r = await call("try_change", { edits: [{ kind: "part", part: "pool_basin", name: "Hagebasseng", from: [-60, 70], to: [-50, 70], params: { length: 8, width: 4, water: true }, why: "test" }], include_screenshot: false }); assert.ok(!r.isError, text(r));
  assert.equal(r.structuredContent.applied, 2); const ed = await stored(V), w = ed.at(-1), g = jobs.at(-1).ground;
  assert.equal(w.material, "water"); assert.equal(w.base_kote, Math.round((g - 1.4) * 100) / 100); assert.equal(w.on, undefined);
  const { applyEdits } = await import("../public/edits.js"), { readFileSync } = await import("node:fs");
  const site = JSON.parse(readFileSync(new URL("../public/data/site.json", import.meta.url))), floors = JSON.parse(readFileSync(new URL("../public/data/floors.json", import.meta.url))).floors;
  const a = applyEdits(site, floors, [ed.at(-2), w]).site.added.find(x => x.material === "water"); assert.equal(a.ground, undefined, "no pad round the water: the basin is dug, the ground stays");
  assert.equal(a.base_kote, Math.round((g - 1.4) * 10) / 10);
});
