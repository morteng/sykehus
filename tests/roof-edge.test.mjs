/* A railing round a roof edge (Anton's wish 2026-10-27, «høyt glassgjerde rundt takkanten» on Sentralblokka): the footprint of a construction is its own shape,
   each roof level has its edge as numbers, edge_rail lays the straight railing part along it at the level's kote, measure reads the deviation.
   The real Sentralblokka (public/data/site.json); the worker is a fake that answers a railing as a thin plate of the length asked.
   node --test tests/roof-edge.test.mjs */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { checkEdit, applyEdits, wingOf } from "../public/edits.js";
import { roofOf, roofHold, roofSay, measureParts, checkFit, levelRingsOf } from "../public/design.js";
import { offsetRing, edgeRail } from "../public/roofedge.js";
import { footOfMesh } from "../bim.mjs";

const site = JSON.parse(readFileSync(new URL("../public/data/site.json", import.meta.url)));
const W = site.wings.find(w => w.id === "sentralblokka");
const SHA = n => String(n).padStart(64, "a").slice(-64);

/* a thin vertical plate along each leg of a path, as a mesh in site metres (the construction's own frame = the site's: its box's middle is where from -> to is middled) */
function railMesh(path, h = 1.1) {
  const pos = [], idx = [];
  for (let i = 0; i + 1 < path.length; i++) { const [a, b] = [path[i], path[i + 1]], o = pos.length / 3; pos.push(a[0], a[1], 0, b[0], b[1], 0, b[0], b[1], h, a[0], a[1], h); idx.push(o, o + 1, o + 2, o, o + 2, o + 3); }
  const xs = path.map(p => p[0]), ys = path.map(p => p[1]);
  return { box: { min: [Math.min(...xs), Math.min(...ys), 0], max: [Math.max(...xs), Math.max(...ys), h] }, classes: { IfcPlate: 1 }, buildings: 1, storeys: 1, triangles: idx.length / 3, parts: [{ cls: "IfcPlate", n: 1, pos, idx }] };
}
/* the construction as the page holds it, standing as it was drawn (free), on Sentralblokka */
function railEdit(id, path, extra = {}) {
  const m = railMesh(path), foot = footOfMesh(m), mid = [(m.box.min[0] + m.box.max[0]) / 2, (m.box.min[1] + m.box.max[1]) / 2];
  return { kind: "volume", id, name: "Rekkverk " + id, shape: "bim", material: "glass", from: [mid[0] - 1, mid[1]], to: [mid[0] + 1, mid[1]], on: "sentralblokka", align: "free", allow_overlap: true,
    bim: { script: "x = 1\n", params: {}, sha: SHA(id.length + path.length), box: m.box, ...(foot ? { foot } : {}) }, ...extra };
}
const closed = r => [...r, r[0]];
const mainRing = k => levelRingsOf(site, "sentralblokka", k).filter(g => !g.hole).sort((a, b) => b.area_m2 - a.area_m2)[0];

test("edges per level: three kotes, each with its rings, edge lengths and the way they face", () => {
  const r = roofOf(site, "sentralblokka");
  assert.deepEqual(r.edges.map(e => e.kote), [73.16, 69.91, 66.41]);
  for (const e of r.edges) for (const g of e.rings) { assert.equal(g.lengths_m.length, g.ring.length); assert.equal(g.facing_deg.length, g.ring.length); }
  const big = r.edges.find(e => e.kote === 69.91).rings[0];
  assert.ok(big.ring.length >= 8, "the 69,91 level's outer edge");
  assert.ok(r.edges.find(e => e.kote === 69.91).rings.some(g => g.hole && g.wall_edges?.length > 0), "round the 73,16 block it has edges against the higher level: a hole with wall_edges");
  const perim = big.lengths_m.reduce((a, b) => a + b, 0); assert.ok(perim > 150 && perim < 400, "its perimeter: " + perim);
  assert.match(r.edges_note, /edge_rail/);
});

test("a loop railing laid along the 69,91 level's edge is not an overhang: the box was 44 m out, the shape is on the edge", () => {
  const g = mainRing(69.91), loop = closed(offsetRing(g.ring, 0.15)), e = railEdit("nloop", loop);
  const c = checkEdit(site, [], e), h = roofHold(site, c);
  assert.equal(h.kote, 69.91); assert.ok(h.overhang_m < 0.4, "the loop is on its level's edge: " + JSON.stringify(h.over));
  const box = roofHold(site, { ...c, bim: { ...c.bim, foot: undefined } });   // the same construction tested as its box (what it was)
  assert.ok(box.overhang_m > 10, "the old test, the bounding rectangle: " + box.overhang_m);
  const st = applyEdits(site, [], [checkEdit(site, [], e)]).site;
  assert.equal(checkFit(st).overhangs.length, 0, checkFit(st).say);
});

test("a railing run 1 m outside the edge reports 1 m and the side; the message names the edge and the level", () => {
  const g = mainRing(69.91), n = g.ring.length;
  const i = g.edges.map((e, k) => ({ k, L: e.length_m, w: e.wall })).filter(x => !x.w).sort((a, b) => b.L - a.L)[0].k, a = g.ring[i], b = g.ring[(i + 1) % n], d = [b[0] - a[0], b[1] - a[1]], L = Math.hypot(...d), u = [d[0] / L, d[1] / L], out = [u[1], -u[0]];
  const at = (t, o) => [a[0] + u[0] * t * L + out[0] * o, a[1] + u[1] * t * L + out[1] * o];
  /* the run 1 m outside the middle of that edge, with a leg at each end back over the roof so some of it stands on it */
  const path = [at(0.3, -3), at(0.3, 1), at(0.7, 1), at(0.7, -3)], e = railEdit("nut", path);
  const c = checkEdit(site, [], e), h = roofHold(site, c);
  assert.equal(h.kote, 69.91); assert.ok(Math.abs(h.overhang_m - 1) < 0.1, "1 m out: " + h.overhang_m);
  const side = Math.abs(out[0]) > Math.abs(out[1]) ? (out[0] > 0 ? "øst" : "vest") : (out[1] > 0 ? "nord" : "sør");
  assert.equal(h.over[0].side, side);
  const say = roofSay(site, c).say;
  assert.match(say, new RegExp(`stikker 1,0\\d m .* ut over takkanten til Sentralblokka \\(${side} 1,0\\d m; målt mot taknivået kote 69,91\\)`));
  /* measure: the run alone against that level's edge: 1 m everywhere */
  const run = railEdit("nrun", [at(0.35, 1), at(0.65, 1)]), st = { ...site, added: [{ ...run, base_kote: 69.91, top_kote: 71.01, width: 1, height: 1.1 }] };
  const r = measureParts(st, "nrun", "Sentralblokka@69.91", wingOf);
  assert.ok(Math.abs(r.deviation.min_m - 1) < 0.05 && Math.abs(r.deviation.max_m - 1) < 0.05, JSON.stringify(r.deviation));
  assert.equal(r.deviation.max_side, side); assert.ok(Math.abs(r.deviation.outside_m - 1) < 0.05 && r.deviation.inside_m === 0);
  assert.match(r.say, /avviket fra Rekkverk nrun til kanten av taknivået kote 69,91 på Sentralblokka: minst 0,9\d m, størst 1,0\d m/);
  assert.throws(() => measureParts(st, "nrun", "Sentralblokka@12.5", wingOf), /ikke tak på kote 12.5; takene ligger på 73.16, 69.91, 66.41/);
});

test("edge_rail: pieces of at most 60 m along the level's edge, corners closed, a refusal for a level the wing has not", () => {
  const r = edgeRail(site, W, { level: 69.91, height_m: 1.2 });
  assert.ok(r.parts.length >= 10 && r.parts.every(p => p.params.length <= 60 && p.params.length >= 1 && p.params.height === 1.2 && p.align === "free" && p.on === "sentralblokka" && p.part === "railing"));
  assert.equal(new Set(r.parts.map(p => p.id)).size, r.parts.length); assert.match(r.parts[0].name, /^Takrekkverk 1\/\d+$/);
  const joined = r.parts.slice(1).filter((p, i) => Math.hypot(p.from[0] - r.parts[i].to[0], p.from[1] - r.parts[i].to[1]) < 0.02).length;
  assert.ok(joined >= r.parts.length * 0.6, `a piece starts where the last ends: ${joined} of ${r.parts.length - 1}`);
  assert.match(r.say, /kanter mot et høyere tak er utelatt/);
  const all = edgeRail(site, W, { level: 69.91, edges: "all" }); assert.ok(all.total_m > r.total_m);
  assert.throws(() => edgeRail(site, W, { level: 12.5 }), /ikke tak på kote 12,5; takene ligger på 73,16, 69,91, 66,41/);
  assert.throws(() => edgeRail(site, W, { level: 69.91, height_m: 3 }), /0,8 til 1,5/);
  const long = edgeRail(site, W, { level: 69.91, maxLen: 20 }); assert.ok(long.parts.every(p => p.params.length <= 20) && long.parts.length > r.parts.length);
});

/* the whole chain through the MCP call, with a worker that answers a railing as a plate of the length asked */
const meshes = new Map();
const fake = createServer((req, res) => {
  let b = ""; req.on("data", c => b += c); req.on("end", () => {
    if (req.url.startsWith("/parts")) return res.end(JSON.stringify({ parts: { railing: { no: "Rekkverk", params: { length: { type: "number", min: 0.5, max: 60 } }, pad: false } } }));
    if (req.method === "POST") { const j = JSON.parse(b), id = `${j.params.length}_${j.params.height}`; meshes.set(id, railMesh([[-j.params.length / 2, 0], [j.params.length / 2, 0]], j.params.height));
      return res.end(JSON.stringify({ state: "done", result: { params: { length: j.params.length, height: j.params.height, infill: j.params.infill || "glass" } }, files: { "mesh.json": `/f/${id}/mesh.json`, "model.ifc": `/f/${id}/model.ifc` } })); }
    const m = req.url.match(/^\/f\/([^/]+)\/(.*)$/); if (m && m[2] === "mesh.json") return res.end(JSON.stringify(meshes.get(m[1]))); res.end("ISO-10303-21;");
  });
});
await new Promise(r => fake.listen(0, "127.0.0.1", r));
const dir = mkdtempSync(join(tmpdir(), "sykehus-edge-")), secret = "proxy-secret-for-tests-0123456789", PORT = 9800 + Math.floor(Math.random() * 90);
const srv = spawn(process.execPath, [new URL("../server.mjs", import.meta.url).pathname], { env: { ...process.env, PORT: String(PORT), SYKEHUS_VERSIONS_DIR: join(dir, "v"), SYKEHUS_PROXY_SECRET: secret, DOCS: "", SYKEHUS_WORKER: `http://127.0.0.1:${fake.address().port}` }, stdio: ["ignore", "pipe", "inherit"] });
await new Promise(ok => srv.stdout.on("data", d => String(d).includes("Sykehustomta on") && ok()));
after(() => { srv.kill(); fake.close(); });
const H = { "remote-user": "lars", "x-sykehus-proxy-auth": secret };
const call = async (name, args) => (await (await fetch(`http://localhost:${PORT}/mcp`, { method: "POST", headers: { "content-type": "application/json", ...H }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) })).json()).result;
const text = r => r.content.filter(c => c.type === "text").map(c => c.text).join(" ");

test("edge_rail through try_change on 66,41: every piece stands at the 66,41 kote and none sticks out", async () => {
  const t = await call("try_change", { edits: [{ kind: "edge_rail", wing: "Sentralblokka", level: 66.41, height_m: 1.2, id: "nlav" }], include_screenshot: false }); assert.ok(!t.isError, text(t));
  const sc = t.structuredContent, made = sc.added.filter(x => /^nlav/.test(x.id));
  assert.ok(made.length >= 4 && sc.rejected.length === 0, JSON.stringify([made.length, sc.rejected]));
  for (const a of made) assert.equal(a.worker.foot_kote, 66.41, `${a.id}: the IFC's foot is the 66,41 level's kote`);
  const rows = sc.fit.filter(x => /^nlav/.test(x.id)); assert.equal(rows.length, made.length);
  for (const r of rows) { assert.equal(r.roof.kote, 66.41, r.id); assert.equal(r.base_kote, 66.4, `${r.id}: the card keeps one decimal`); assert.equal(r.roof.overhang_m, 0, r.id); }
  assert.match(JSON.stringify(sc), /Rekkverk langs kanten av taknivået kote 66,41 på Sentralblokka: \d+ deler/);
  const f = (await call("check_fit", { wing: "Sentralblokka", target: sc.draft })).structuredContent;
  assert.equal(f.overhangs.length, 0, f.say);
  const dev = (await call("measure", { a: made[0].id, b: "Sentralblokka@66.41", target: sc.draft })).structuredContent;
  assert.ok(dev.deviation.max_m < 0.6, "laid 0,15 m inside the edge: " + JSON.stringify(dev.deviation));
  const bad = await call("try_change", { edits: [{ kind: "edge_rail", wing: "Sentralblokka", level: 12 }], include_screenshot: false });
  assert.match(JSON.stringify(bad.structuredContent ?? bad.content), /ikke tak på kote 12/);
});

test("about_wing roof carries edges; draw_section says plainly there is no facade drawing; draw_plan zooms on a point", async () => {
  const aw = (await call("about_wing", { wing: "Sentralblokka" })).structuredContent;
  assert.deepEqual(aw.roof.edges.map(e => e.kote), [73.16, 69.91, 66.41]);
  const sec = await call("draw_section", { wing: "Sentralblokka" }); assert.match(sec.structuredContent.say, /ikke en fasadetegning: det finnes ingen tegnet fasade/);
  const c = roofOf(site, "sentralblokka").outline[0], plan = await call("draw_plan", { focus: "Sentralblokka", at: c, scale: 200 }); assert.ok(!plan.isError, text(plan));
  assert.equal(plan.structuredContent.scale, "1:200"); assert.match(plan.structuredContent.say, /sentrert på/); assert.match(plan.structuredContent.say, /Hvert taknivås kant er tegnet/);
  const whole = await call("draw_plan", { focus: "Sentralblokka", scale: 200 }); assert.equal(whole.isError, true, "without at, 1:200 does not fit the whole wing: refused as before");
});
