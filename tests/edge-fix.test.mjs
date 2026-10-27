/* Three fixes found on Sentralblokka's roof edge (2026-10-27):
   1. edge_rail: a piece along a step between two levels belongs to the HIGHER level's edge (it was put on the lower level, nkant20 on 66,41), and try_change answers
      with one compact entry, not one full entry and one fit row per piece.
   2. draw_plan with a roof focus (at) leaves the balconies out; balconies: true draws them.
   3. era «før» on look and try_change is the target's state before its LAST edit, and the camera line says when there is no edit to go back over.
   node --test tests/edge-fix.test.mjs */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { checkEdit } from "../public/edits.js";
import { roofHold } from "../public/design.js";
import { edgeRail, compactRail } from "../public/roofedge.js";
import { planDrawing, isBalcony } from "../public/drawing.js";
import { wingOf } from "../public/edits.js";
import { footOfMesh } from "../bim.mjs";

const site = JSON.parse(readFileSync(new URL("../public/data/site.json", import.meta.url)));
const W = site.wings.find(w => w.id === "sentralblokka");
const SHA = "a".repeat(64);
const mesh = (L, h = 1.1) => ({ box: { min: [-L / 2, 0, 0], max: [L / 2, 0, h] }, classes: { IfcPlate: 1 }, buildings: 1, storeys: 1, triangles: 2, parts: [{ cls: "IfcPlate", n: 1, pos: [-L / 2, 0, 0, L / 2, 0, 0, L / 2, 0, h, -L / 2, 0, h], idx: [0, 1, 2, 0, 2, 3] }] });
/* a railing piece as the page holds it: a plate of its length, between its from and to, on the wing */
const held = p => { const m = mesh(p.params.length), foot = footOfMesh(m);
  return roofHold(site, checkEdit(site, [], { kind: "volume", id: p.id, name: p.id, shape: "bim", material: "glass", from: p.from, to: p.to, on: "sentralblokka", align: "free", allow_overlap: true, bim: { script: "x=1\n", params: {}, sha: SHA, box: m.box, ...(foot ? { foot } : {}) } })); };

test("edge_rail: every piece along a level's edge stands on that level; nkant20, on the 69,91 edge, was put on 66,41 (overhang 0,04) and is on 69,91 now", () => {
  for (const level of [73.16, 69.91, 66.41]) {
    const r = edgeRail(site, W, { level, height_m: 1.1 }), wrong = r.parts.filter(p => held(p).kote !== level).map(p => `${p.id}@${held(p).kote}`);
    assert.deepEqual(wrong, [], `level ${level}: pieces on another level`);
  }
  const r = edgeRail(site, W, { level: 69.91, height_m: 1.1 }), p = r.parts.find(x => x.id === "nkant20"), h = held(p);
  assert.equal(h.kote, 69.91, "nkant20's level");
  assert.deepEqual(h.levels.map(l => l.kote).sort(), [66.41, 69.91], "it does stand over both levels' cells: the step");
  assert.ok(Math.abs(h.overhang_m - 0.35) < 0.03, "its overhang against the 69,91 edge it follows: " + h.overhang_m);
});

test("a rectangle is still held at the level under most of it (the rule is for shapes)", () => {
  const h = roofHold(site, checkEdit(site, [], { kind: "volume", id: "kasse", name: "Kasse", shape: "box", from: [-5, 17], to: [-3, 19], width: 2, height: 3, on: "sentralblokka", align: "free", allow_overlap: true }));
  assert.ok(h.kote === h.levels[0].kote, JSON.stringify(h.levels));
});

test("compactRail: pieces become one entry with count, length, levels with their kote and max overhang, and a short id list", () => {
  const ids = new Set(Array.from({ length: 40 }, (_, i) => `nk${i + 1}`)), ok = [{ kind: "volume", id: "other", name: "Annet" }, ...[...ids].map(id => ({ kind: "volume", id, name: "Takrekkverk", params: { length: 10 }, ...(id === "nk1" ? { placed: "Rekkverk langs kanten" } : {}) }))];
  const fit = [...ids].map((id, i) => ({ id, roof: { kote: i < 30 ? 69.91 : 66.41, overhang_m: i === 7 ? 0.35 : 0 } })), r = compactRail(ok, [...fit, { id: "other", name: "x" }], ids);
  assert.equal(r.added.length, 2); assert.equal(r.fit.length, 1);
  const s = r.added.find(x => x.kind === "edge_rail");
  assert.equal(s.pieces, 40); assert.equal(s.total_m, 400);
  assert.deepEqual(s.levels, [{ kote: 69.91, pieces: 30, max_overhang_m: 0.35 }, { kote: 66.41, pieces: 10, max_overhang_m: 0 }]);
  assert.match(s.ids, /nk1, nk2, nk3 … nk39, nk40 \(40 deler, nk1 til nk40\)/); assert.equal(s.placed, "Rekkverk langs kanten");
  assert.ok(JSON.stringify(r).length < 700, "compact: " + JSON.stringify(r).length);
});

/* 2: the plan */
const bal = (i, extra = {}) => ({ kind: "volume", id: `bk${i}`, name: `Balkong ${i}`, shape: "bim", from: [-20 + i * 3, -10], to: [-18 + i * 3, -10], width: 1.5, height: 1, base_kote: 30, top_kote: 31, on: "sentralblokka", bim: { part: "balcony" }, ...extra });
const other = { kind: "volume", id: "skur", name: "Skur", shape: "box", from: [0, 20], to: [4, 20], width: 3, height: 3, base_kote: 69.91, top_kote: 72.91, on: "sentralblokka" };
const withB = { ...site, added: [other, bal(1), bal(2, { bim: undefined, role: "slab" }), bal(3, { bim: undefined, name: "Balkong 3" })] };

test("draw_plan: with at the balconies are left out; balconies: true draws them; without at they stay (as before)", () => {
  assert.deepEqual(withB.added.map(isBalcony), [false, true, true, true]);
  const at = roofOfPoint(), whole = planDrawing(withB, { focus: "Sentralblokka" }, wingOf);
  const roofy = planDrawing(withB, { focus: "Sentralblokka", at, scale: 200 }, wingOf), shown = planDrawing(withB, { focus: "Sentralblokka", at, scale: 200, balconies: true }, wingOf), hid = planDrawing(withB, { focus: "Sentralblokka", balconies: false }, wingOf);
  assert.equal(whole.parts, 4); assert.equal(roofy.parts, 1); assert.equal(shown.parts, 4); assert.equal(hid.parts, 1);
  assert.equal(roofy.hidden, 3); assert.equal(shown.hidden, 0);
  assert.equal(shown.prims.length - roofy.prims.length, 9, "each part is a polygon and two labels");
  assert.match(roofy.say, /3 balkongdeler er utelatt/); assert.doesNotMatch(shown.say, /utelatt så/);
});
function roofOfPoint() { const g = W && site.buildings.find(b => b.wing === "sentralblokka"); return g.ring[0]; }

/* the chain through the MCP call; the worker answers a railing as a plate of the length asked */
const meshes = new Map();
const fake = createServer((req, res) => {
  let b = ""; req.on("data", c => b += c); req.on("end", () => {
    if (req.url.startsWith("/parts")) return res.end(JSON.stringify({ parts: { railing: { no: "Rekkverk", params: { length: { type: "number", min: 0.5, max: 60 } }, pad: false } } }));
    if (req.method === "POST") { const j = JSON.parse(b), id = `${j.params.length}_${j.params.height}`; meshes.set(id, mesh(j.params.length, j.params.height));
      return res.end(JSON.stringify({ state: "done", result: { params: { length: j.params.length, height: j.params.height, infill: j.params.infill || "glass" } }, files: { "mesh.json": `/f/${id}/mesh.json`, "model.ifc": `/f/${id}/model.ifc` } })); }
    const m = req.url.match(/^\/f\/([^/]+)\/(.*)$/); if (m && m[2] === "mesh.json") return res.end(JSON.stringify(meshes.get(m[1]))); res.end("ISO-10303-21;");
  });
});
await new Promise(r => fake.listen(0, "127.0.0.1", r));
const dir = mkdtempSync(join(tmpdir(), "sykehus-edgefix-")), secret = "proxy-secret-for-tests-0123456789", PORT = 9700 + Math.floor(Math.random() * 90);
const srv = spawn(process.execPath, [new URL("../server.mjs", import.meta.url).pathname], { env: { ...process.env, PORT: String(PORT), SYKEHUS_VERSIONS_DIR: join(dir, "v"), SYKEHUS_PROXY_SECRET: secret, DOCS: "", SYKEHUS_WORKER: `http://127.0.0.1:${fake.address().port}` }, stdio: ["ignore", "pipe", "inherit"] });
await new Promise(ok => srv.stdout.on("data", d => String(d).includes("Sykehustomta on") && ok()));
after(() => { srv.kill(); fake.close(); });
const H = { "remote-user": "lars", "x-sykehus-proxy-auth": secret };
const call = async (name, args) => (await (await fetch(`http://localhost:${PORT}/mcp`, { method: "POST", headers: { "content-type": "application/json", ...H }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) })).json()).result;
const text = r => r.content.filter(c => c.type === "text").map(c => c.text).join(" ");
const png = r => r.content.filter(c => c.type === "image").map(c => c.data);

test("try_change edge_rail answers compactly: one edge_rail entry, no per-piece fit rows", async () => {
  const t = await call("try_change", { edits: [{ kind: "edge_rail", wing: "Sentralblokka", level: 69.91, height_m: 1.1, id: "nkant" }], include_screenshot: false }); assert.ok(!t.isError, text(t));
  const sc = t.structuredContent, s = sc.added.find(x => x.kind === "edge_rail");
  assert.ok(s && sc.added.length === 1 && sc.rejected.length === 0, JSON.stringify([sc.added.length, sc.rejected]));
  assert.ok(s.pieces >= 20 && s.total_m > 100, JSON.stringify(s));
  assert.deepEqual(s.levels.map(l => l.kote), [69.91], "every piece on the level it follows"); assert.ok(s.levels[0].max_overhang_m < 0.5, JSON.stringify(s.levels));
  assert.match(s.placed, /Rekkverk langs kanten av taknivået kote 69,91/);
  assert.equal((sc.fit || []).filter(f => /^nkant/.test(f.id)).length, 0);
  assert.ok(JSON.stringify(sc).length < 4000, "the answer is " + JSON.stringify(sc).length + " chars: " + Object.entries(sc).map(([k, v]) => k + ":" + JSON.stringify(v).length).join(" ") + " | after.built[0]=" + JSON.stringify(sc.after.built[0]) + " | check0=" + JSON.stringify(sc.checks[0]) + " n=" + sc.checks.length);
});

test("era før is the target's state before its last edit; with no edits the shared before, said in the camera line", async () => {
  const as = u => async (name, args) => (await (await fetch(`http://localhost:${PORT}/mcp`, { method: "POST", headers: { "content-type": "application/json", ...H, "remote-user": u }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) })).json()).result;
  const box = (id, e) => ({ kind: "volume", id, name: "Kasse " + id, shape: "box", from: [e, 60], to: [e + 10, 60], width: 8, height: 6, material: "wood" });
  const [two, none] = [as("kari"), as("ola")], cam = { at: [-5, 60], distance_m: 80, tilt_deg: 90, width: 400, height: 300 };
  await two("try_change", { edits: [box("kasseena", -20)], include_screenshot: false });
  assert.equal((await two("try_change", { edits: [box("kasseto", 0)], include_screenshot: false })).structuredContent.changes, 2, "kari's version has two edits");
  const early = await two("look", { ...cam, era: "før" }), late = await two("look", { ...cam, era: "etter" }), sharedBefore = await none("look", { ...cam, era: "før" });
  assert.match(text(early), /modellen slik den var før siste endring \(1 av 2 endringer er med\)/);
  assert.notDeepEqual(png(early), png(late), "not the picture with both edits");
  assert.notDeepEqual(png(early), png(sharedBefore), "and not the shared before: the first edit is drawn");
  const shared = sharedBefore, plain = await none("look", { ...cam, era: "etter" });
  assert.match(text(shared), /målet har ingen endringer ennå, så dette er den delte førmodellen/);
  assert.deepEqual(png(shared), png(plain), "no edits: the shared before is the model");
  const tc = await two("try_change", { edits: [box("kassetre", 20)], include_screenshot: true, picture: { ...cam, era: "før" } });
  assert.match(text(tc), /modellen slik den var før siste endring \(2 av 3 endringer er med\)/);
});
