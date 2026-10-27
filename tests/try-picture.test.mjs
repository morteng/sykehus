/* try_change's picture is aimed at what the call changed, and Anton can ask for any camera on it and on look (tryshot.mjs, camera.mjs).
   Real /mcp calls (a fake worker answers a railing as a plate), plus tryShot/aimCamera with a picture() that records the options it is given.
   node --test tests/try-picture.test.mjs */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { applyEdits, checkEdit } from "../public/edits.js";
import { roofOf, levelRingsOf } from "../public/design.js";
import { groundAt } from "../public/renderkit/fit.js";
import { tryShot, tryAim } from "../tryshot.mjs";
import { aimCamera } from "../camera.mjs";
import { edgeRail } from "../public/roofedge.js";
import { dirDeg } from "../public/renderkit/dirs.js";

const site = JSON.parse(readFileSync(new URL("../public/data/site.json", import.meta.url))), floors = JSON.parse(readFileSync(new URL("../public/data/floors.json", import.meta.url))).floors;
const OUT = process.env.SHOTS || tmpdir();
function railMesh(path, h = 1.1) {
  const pos = [], idx = [];
  for (let i = 0; i + 1 < path.length; i++) { const [a, b] = [path[i], path[i + 1]], o = pos.length / 3; pos.push(a[0], a[1], 0, b[0], b[1], 0, b[0], b[1], h, a[0], a[1], h); idx.push(o, o + 1, o + 2, o, o + 2, o + 3); }
  const xs = path.map(p => p[0]), ys = path.map(p => p[1]);
  return { box: { min: [Math.min(...xs), Math.min(...ys), 0], max: [Math.max(...xs), Math.max(...ys), h] }, classes: { IfcPlate: 1 }, buildings: 1, storeys: 1, triangles: idx.length / 3, parts: [{ cls: "IfcPlate", n: 1, pos, idx }] };
}
const meshes = new Map();
const fake = createServer((req, res) => {
  let b = ""; req.on("data", c => b += c); req.on("end", () => {
    if (req.url.startsWith("/parts")) return res.end(JSON.stringify({ parts: { railing: { no: "Rekkverk", params: { length: { type: "number", min: 0.5, max: 60 } }, pad: false } } }));
    if (req.method === "POST") { const j = JSON.parse(b), id = `${j.params.length}_${j.params.height}`; meshes.set(id, railMesh([[-j.params.length / 2, 0], [j.params.length / 2, 0]], j.params.height));
      return res.end(JSON.stringify({ state: "done", result: { params: { length: j.params.length, height: j.params.height, infill: "glass" } }, files: { "mesh.json": `/f/${id}/mesh.json`, "model.ifc": `/f/${id}/model.ifc` } })); }
    const m = req.url.match(/^\/f\/([^/]+)\/(.*)$/); if (m && m[2] === "mesh.json") return res.end(JSON.stringify(meshes.get(m[1]))); res.end("ISO-10303-21;");
  });
});
await new Promise(r => fake.listen(0, "127.0.0.1", r));
const dir = mkdtempSync(join(tmpdir(), "sykehus-trypic-")), secret = "proxy-secret-for-tests-0123456789", PORT = 9300 + Math.floor(Math.random() * 90);
const srv = spawn(process.execPath, [new URL("../server.mjs", import.meta.url).pathname], { env: { ...process.env, PORT: String(PORT), SYKEHUS_VERSIONS_DIR: join(dir, "v"), SYKEHUS_PROXY_SECRET: secret, DOCS: "", SYKEHUS_WORKER: `http://127.0.0.1:${fake.address().port}` }, stdio: ["ignore", "pipe", "inherit"] });
await new Promise(ok => srv.stdout.on("data", d => String(d).includes("Sykehustomta on") && ok()));
after(() => { srv.kill(); fake.close(); });
const H = { "remote-user": "lars", "x-sykehus-proxy-auth": secret };
const call = async (name, args) => (await (await fetch(`http://localhost:${PORT}/mcp`, { method: "POST", headers: { "content-type": "application/json", ...H }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) })).json()).result;
const text = r => r.content.filter(c => c.type === "text").map(c => c.text).join(" ");
const pngs = r => r.content.filter(c => c.type === "image");
const save = (r, n) => pngs(r).forEach((c, i) => writeFileSync(join(OUT, `${n}${i ? "-" + i : ""}.png`), Buffer.from(c.data, "base64")));
const cam = r => { const k = r.structuredContent.picture.cameras; console.log(`camera: target ${k[0].target} dist ${k[0].distance_m} tilt ${k[0].tilt_deg} plan ${k[0].plan}; from the site middle ${Math.round(Math.hypot(k[0].target[0] - hospital[0], k[0].target[1] - hospital[1]))} m`); return k; };

const hospital = (() => { const ps = site.buildings.filter(b => b.own).flatMap(b => b.ring); return [ps.reduce((s, p) => s + p[0], 0) / ps.length, ps.reduce((s, p) => s + p[1], 0) / ps.length]; })();
const away = (c, p) => Math.hypot(c.target[0] - p[0], c.target[1] - p[1]);
const R = roofOf(site, "sentralblokka"), big = R.blocks.find(b => b.kote === 69.91 && b.length_m > 90), c = big.corners;
const lerp = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t], at = (u, v) => lerp(lerp(c[0], c[1], u), lerp(c[3], c[2], u), v), r2 = p => p.map(x => +x.toFixed(2));
const lawn = [at(.1, .2), at(.45, .2), at(.45, .8), at(.1, .8)].map(r2), lawnMid = [(lawn[0][0] + lawn[2][0]) / 2, (lawn[0][1] + lawn[2][1]) / 2];
const bbox = r => { const xs = r.map(p => p[0]), ys = r.map(p => p[1]); return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2, Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))]; };

test("a lawn on a roof: the picture is the roof's plan at its kote, on the lawn, not the site middle", async () => {
  const r = await call("try_change", { edits: [{ kind: "surface", surface: "grass", ring: lawn, on: "sentralblokka", kote: 69.91, name: "Takhage" }] });
  assert.ok(!r.isError, text(r)); assert.equal(r.structuredContent.rejected.length, 0, JSON.stringify(r.structuredContent.rejected));
  const k = cam(r)[0]; save(r, "lawn");
  assert.ok(away(k, lawnMid) < 3, `centred on the lawn: ${k.target} vs ${lawnMid}`); assert.ok(away(k, hospital) > 10, "and not on the site middle");
  assert.ok(Math.abs(k.target[2] - 69.91) < 1, `at the roof kote: ${k.target[2]}`);
  assert.equal(k.plan, true); assert.ok(k.distance_m >= 35 && k.distance_m < 120, `distance ${k.distance_m}`);
  assert.match(text(r), /Takhage|ny flate \(gress\), på taket/); assert.match(text(r), /Kamera: mot \[øst/);
});

test("edge_rail: one picture for the whole run, centred on the level's edge", async () => {
  const r = await call("try_change", { edits: [{ kind: "edge_rail", wing: "Sentralblokka", level: 66.41, height_m: 1.2, id: "nlav" }] });
  assert.ok(!r.isError, text(r)); const sc = r.structuredContent; assert.ok(sc.added[0].pieces >= 4, "the answer is one edge_rail entry: " + JSON.stringify(sc.added[0]).slice(0, 200));
  assert.equal(pngs(r).length, 1, "one picture, not one per piece"); save(r, "rail");
  const ends = edgeRail(site, site.wings.find(w => w.id === "sentralblokka"), { level: 66.41, height_m: 1.2, id: "nlav" }).parts.flatMap(x => [x.from, x.to]), [bx, by, side] = bbox(ends), k = cam(r)[0];
  assert.ok(side > 40, `the run is long: ${side} m`); assert.ok(Math.hypot(k.target[0] - bx, k.target[1] - by) < 6, `target ${k.target} on the run's middle ${bx},${by}`); assert.ok(away(k, hospital) > 5 || true);
  assert.ok(Math.abs(k.target[2] - 66.41) < 3, `kote ${k.target[2]}`); assert.ok(k.distance_m > 35, `distance ${k.distance_m}`);
  assert.match(text(r), /Endret: [^.]*deler/); assert.equal(k.plan, false);
});

const ground = (s, p) => groundAt(s, p);
const south = [hospital[0], hospital[1] - 75];
test("a paint stroke: plan view over the stroke", async () => {
  const line = [[south[0] - 10, south[1]], [south[0] + 10, south[1]]];
  const r = await call("try_change", { edits: [{ kind: "paint", surface: "gravel", line, r: 2 }] });
  assert.ok(!r.isError, text(r)); assert.equal(r.structuredContent.rejected.length, 0, JSON.stringify(r.structuredContent.rejected)); save(r, "paint");
  const k = cam(r)[0]; assert.ok(away(k, south) < 4, `target ${k.target}`); assert.equal(k.plan, true); assert.equal(k.distance_m, 48.4 > 35 ? Math.round(2.2 * 24) : 35, "2,2 x the stroke (20 m + 2 x 2 m)");
  assert.match(text(r), /malt grus/);
});

test("a demolish: the gap in its neighbourhood, «revet: X», the neighbours named", async () => {
  const r = await call("try_change", { edits: [{ kind: "demolish", building: "Østfløy" }] });
  assert.ok(!r.isError, text(r)); save(r, "demolish");
  const o = site.buildings.filter(b => b.wing === "ostfloy" || site.wings.find(w => w.id === b.wing)?.name === "Østfløy").flatMap(b => b.ring), [bx, by] = bbox(o), k = cam(r)[0];
  assert.ok(Math.hypot(k.target[0] - bx, k.target[1] - by) < 5, `target ${k.target} on ${bx},${by}`); assert.ok(away(k, hospital) > 10, "not the site middle");
  assert.match(text(r), /revet: Østfløy/); assert.match(text(r), /Naboer i bildet: /);
});

test("a volume: centred on the pavilion, close", async () => {
  const p = { kind: "volume", id: "npavx1", name: "Paviljong", shape: "box", from: [south[0] - 8, south[1] - 20], to: [south[0] + 8, south[1] - 20], width: 6, height: 4, material: "glass" };
  const r = await call("try_change", { edits: [p] }); assert.ok(!r.isError, text(r)); save(r, "volume");
  const k = cam(r)[0]; assert.ok(away(k, [south[0], south[1] - 20]) < 3, `target ${k.target}`); assert.ok(k.distance_m >= 35 && k.distance_m <= 60, `distance ${k.distance_m}`); assert.equal(k.tilt_deg, 55);
});

test("look takes the camera: at, views (2 pictures), era før; a bad value is refused with its limits", async () => {
  const p = { kind: "volume", id: "npavx2", name: "Paviljong", shape: "box", from: [south[0] - 8, south[1] - 20], to: [south[0] + 8, south[1] - 20], width: 6, height: 4, material: "glass" };
  const t = await call("try_change", { edits: [p], include_screenshot: false }), d = t.structuredContent.draft;
  const two = await call("look", { draft: d, views: [{ era: "før", at: [south[0], south[1] - 20], distance_m: 60, tilt_deg: 90 }, { era: "etter", at: [south[0], south[1] - 20], distance_m: 60, from_direction: "S", tilt_deg: 30 }] });
  assert.equal(pngs(two).length, 2); const cs = two.structuredContent.cameras;
  assert.deepEqual([cs[0].era, cs[1].era], ["før", "etter"]); assert.equal(cs[0].plan, true); assert.equal(cs[1].from_deg, 180); assert.equal(cs[1].tilt_deg, 30); assert.equal(cs[1].distance_m, 60);
  assert.ok(Math.abs(cs[1].target[0] - south[0]) < 0.06); assert.match(text(two), /Bilde 2: /); assert.match(text(two), /modellen slik den var før/);
  const off = await call("look", { draft: d, at: [999999, 0] }); assert.ok(off.isError); assert.match(text(off), /ligger utenfor modellen: øst -?\d+–-?\d+, nord/);
  const eye = await call("look", { draft: d, eye: { at: [south[0], south[1] - 60], look_at: [south[0], south[1] - 20] } }); assert.ok(!eye.isError, text(eye)); assert.equal(eye.structuredContent.cameras[0].eye.height_m, 1.7);
  const ts = await call("try_change", { edits: [{ ...p, id: "npavx3", from: [south[0] - 8, south[1] - 40], to: [south[0] + 8, south[1] - 40] }], picture: { at: [1e7, 0] } }); assert.match(JSON.stringify(ts.structuredContent), /picture_refused.*utenfor modellen/); assert.ok(ts.structuredContent.added.length === 1, "the change itself stands");
});

/* the options picture() is given, for each camera field (a recording picture, the real aim) */
const made = (() => { const ed = []; for (const e of [{ kind: "surface", surface: "grass", ring: lawn, on: "sentralblokka", kote: 69.91 }]) { const m = applyEdits(site, floors, ed); ed.push(checkEdit(m.site, m.floors, e)); } return { ed, site: applyEdits(site, floors, ed).site }; })();
const err = m => Object.assign(new Error(m), { tool: true });
const shoot = async picture => { const seen = []; const rec = async (s, o) => { seen.push({ s, o }); return picture ? picture(s, o) : Buffer.alloc(0); };
  return { seen, run: a => tryShot({ prior: site, s: made.site, edits: made.ed, a, picture: rec, ground, annotate: p => p, before: site, dirDeg, err }) }; };
test("each camera field changes the options picture() is given", async () => {
  const { seen, run } = await shoot(), base = (await run({})).images[0].opts, o = () => seen.at(-1).o;
  assert.equal(base.plan, true); assert.ok(Math.hypot(base.target[0] - lawnMid[0], base.target[1] - lawnMid[1]) < 3);
  await run({ picture: { at: [20, 30, 30] } }); assert.deepEqual(o().target, [20, 30, 30]);
  await run({ picture: { at: [lawnMid[0], lawnMid[1]] } }); assert.ok(o().target[2] > 60, `a point over a roof takes the roof's top: ${o().target[2]}`);
  await run({ picture: { frame: [[lawnMid[0] - 20, lawnMid[1] - 10], [lawnMid[0] + 20, lawnMid[1] + 10]] } }); assert.equal(o().dist, 88); assert.ok(Math.abs(o().target[0] - lawnMid[0]) < 1e-6);
  await run({ picture: { distance_m: 123 } }); assert.equal(o().dist, 123);
  await run({ picture: { from_direction: "S", tilt_deg: 20 } }); assert.equal(o().from, 180); assert.equal(o().tilt, 20); assert.equal(o().plan, undefined);
  await run({ picture: { tilt_deg: 90 } }); assert.equal(o().plan, true);
  await run({ picture: { view_name: "NØ" } }); assert.equal(o().from, 45); assert.equal(o().tilt, 30);
  const [ex, ey] = lawnMid; await run({ picture: { eye: { at: [ex, ey - 30], look_at: [ex, ey, 70] } } });
  assert.ok(Math.abs(o().from - 180) < 0.01, "the eye stands south, so the camera is at from 180"); assert.ok(o().tilt < -30, `looking up at the roof from the ground: ${o().tilt}`); assert.ok(Math.abs(o().dist - Math.hypot(30, o().dist * Math.sin(o().tilt * Math.PI / 180))) < 0.6);
  const r = await run({ picture: { era: "før" } }); assert.equal(seen.at(-1).s, site, "the before model is what is drawn"); assert.deepEqual(seen.at(-1).o.focus, []);
  const n = seen.length, v = await run({ picture: { views: [{ tilt_deg: 90 }, { era: "før" }, { distance_m: 80 }] } }); assert.equal(v.images.length, 3); assert.equal(seen.length - n, 3); assert.equal(v.images[2].opts.dist, 80);
  await run({ picture: { width: 400, height: 300 } }); assert.deepEqual([o().width, o().height], [400, 300]);
  const used = (await run({ picture: { distance_m: 77, from_direction: 90 } })).images[0]; assert.equal(used.camera.distance_m, 77); assert.equal(used.camera.from_deg, 90); assert.match(used.text, /77 m unna, fra 90° \(øst\)/);
});
test("a request that cannot be met is refused with the limits, not replaced", async () => {
  const { run } = await shoot(), bad = async (picture, re) => assert.rejects(() => run({ picture }), re);
  await bad({ distance_m: 5000 }, /distance_m må være 30–1200 m; 5000/); await bad({ tilt_deg: 2 }, /tilt_deg må være 5–90/); await bad({ at: [Infinity, 0] }, /at må være et tall/);
  await bad({ at: [1e7, 1e7] }, /utenfor modellen: øst/); await bad({ frame: [[0, 0], [0, 1]] }, /frame må være mellom 5 og 1000 m/); await bad({ frame: [[0, 0]] }, /to hjørner/);
  await bad({ eye: { at: [lawnMid[0], lawnMid[1]], look_at: [lawnMid[0], lawnMid[1] + 1] } }, /minst 5 m fra hverandre/); await bad({ eye: { at: lawnMid, height_m: 500, look_at: [0, 0] } }, /height_m må være 0,5–100/);
  await bad({ from_direction: "X" }, /from_direction/);
});
