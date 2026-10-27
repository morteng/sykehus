/* What Anton sees through look (lookglue.mjs; Morten 2026-10-27 «the pictures anton takes for itself don't really show what it wants
   to look at»): the roof garden is drawn at its kote, the roof levels each in a colour, the distance and pitch follow the focus, the
   scale bar has numbers, the caption says what is in frame. node --test tests/look-glue.test.mjs */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { inflateSync } from "node:zlib";
import { applyEdits, checkEdit } from "../public/edits.js";
import { roofOf } from "../public/roof.js";
import { render, aimAt, VIEWS } from "../public/renderkit/look.js";
import { withGarden, roofLevels, frame, annotate } from "../lookglue.mjs";

const site = JSON.parse(readFileSync(new URL("../public/data/site.json", import.meta.url))), floors = JSON.parse(readFileSync(new URL("../public/data/floors.json", import.meta.url))).floors;
const R = roofOf(site, "sentralblokka"), big = R.blocks.find(b => b.kote === 69.91 && b.length_m > 90), c = big.corners;
const lerp = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t], at = (u, v) => lerp(lerp(c[0], c[1], u), lerp(c[3], c[2], u), v), r2 = p => p.map(x => +x.toFixed(2));
const GARDEN = [{ kind: "surface", surface: "grass", on: "sentralblokka", kote: 69.91, ring: [at(.1, .2), at(.45, .2), at(.45, .8), at(.1, .8)].map(r2), name: "Takhage" },
  { kind: "path", on: "sentralblokka", kote: 69.91, line: [at(.1, .5), at(.45, .5)].map(r2), width: 1.5, surface: "paving" },
  { kind: "trees", species: "Betula pubescens", points: [at(.2, .35), at(.3, .65)].map(r2), on: "sentralblokka", kote: 69.91, height: 5, crown: 3 },
  { kind: "volume", name: "Paviljong", shape: "box", at: { wing: "sentralblokka", roof: true, kote: 73.16 }, length: 12, width: 5, height: 3.2, material: "glass", id: "npavi1" }];
const PLACED = [...GARDEN.slice(0, 3), { kind: "volume", name: "Paviljong", shape: "box", on: "sentralblokka", from: [-10.95, 5.12], to: [-4.59, 15.3], width: 5, height: 3.2, material: "glass", id: "npavi1" }];   // where try_change's `at` puts it
const made = (() => { const ed = []; for (const e of PLACED) { const m = applyEdits(site, floors, ed); ed.push(checkEdit(m.site, m.floors, e)); } return applyEdits(site, floors, ed).site; })();
const iso = (x, y) => ({ ...VIEWS.isometrisk, x, y });

test("a roof garden is drawn at its own kote: the lawn over the level, the trees on it and out of the ground's list", () => {
  assert.equal(made.trees.filter(t => t[7] != null).length, 2, "the model has two trees on the roof");
  const g = withGarden(made), lawn = g.added.find(a => a.id.startsWith("_lag-flate")), zs = lawn.parts[0].tris.flat().map(p => p[2]);
  assert.ok(zs.every(z => z > 69.91 + 0.12 && z < 69.91 + 0.6), `the lawn's height ${zs[0]}: over the level slab (+0.12), not under it, not on the terrain`);
  assert.ok(!g.trees.some(t => t[7] != null), "a roof's tree is not also drawn at the ground under it");
  const cones = g.added.find(a => a.id === "_lag-trær").parts[0].tris.flat().map(p => p[2]);
  assert.ok(Math.min(...cones) > 69.91 && Math.max(...cones) > 74.9 && Math.max(...cones) < 75, `cones stand on kote 69,91, 5 m tall: ${Math.min(...cones)}..${Math.max(...cones)}`);
  assert.equal(g.roof_trees, 2); assert.equal(withGarden(site), site, "no garden: the site itself");
});

test("roofLevels: every level of the wing has its colour, each piece is a slab at the wing's own kote", () => {
  const L = roofLevels(site, "sentralblokka");
  assert.deepEqual(L.levels.map(l => l.kote), [73.16, 69.91, 66.41]);
  assert.equal(new Set(L.levels.map(l => l.mat)).size, 3, "three colours");
  assert.equal(L.entry.parts.length, R.blocks.length);
  L.entry.parts.forEach((p, i) => { const k = R.blocks[i].kote; assert.ok(p.profile.every(([s, z]) => z >= k && z < k + 0.2), `slab ${i} at kote ${k}`); assert.ok(p.profile.some(([s]) => s > 0.9) && p.profile.every(([s]) => s >= 0), "on the left of its axis, with a width"); });
  assert.equal(roofLevels(site, "finnes-ikke"), null);
});

test("the plan shows each level in its colour where the roof piece is (a render of the kit, read at a pixel)", () => {
  const f = aimAt(site, "Sentralblokka"), fr = frame(site, { focus: "Sentralblokka", view_name: "plan" }, f, { ...VIEWS.plan });
  const png = render(fr.site, { plan: true, target: fr.target, dist: fr.dist, focus: fr.focus, accent: fr.accent, width: 512, height: 320 });
  const k = 320 / (2 * fr.dist * Math.tan(19 * Math.PI / 180)), top = R.blocks.filter(b => b.kote === 73.16).sort((a, b) => b.length_m * b.width_m - a.length_m * a.width_m)[0];
  const ctr = top.corners.reduce((s, p) => [s[0] + p[0] / 4, s[1] + p[1] / 4], [0, 0]), X = Math.round(256 + (ctr[0] - fr.target[0]) * k), Y = Math.round(160 - (ctr[1] - fr.target[1]) * k);
  const out = annotate(png, { plan: true, dist: fr.dist, target: fr.target, levels: fr.levels, width: 512, height: 320 });
  const read = buf => { const W = buf.readUInt32BE(16); let off = 8; const d = []; while (off < buf.length) { const len = buf.readUInt32BE(off); if (buf.toString("ascii", off + 4, off + 8) === "IDAT") d.push(buf.subarray(off + 8, off + 8 + len)); off += 12 + len; } const raw = inflateSync(Buffer.concat(d)); return (x, y) => [...raw.subarray(y * (W * 3 + 1) + 1 + x * 3, y * (W * 3 + 1) + 4 + x * 3)]; };
  const at1 = read(png)(X, Y), red = fr.levels.levels[0].rgb;
  assert.ok(Math.abs(at1[0] - red[0] * 0.895) < 16 && at1[1] < 80 && at1[2] < 80, `the 73,16 piece at (${X},${Y}) is the red level, got ${at1}`);
  const legend = read(out)(20, 20); assert.deepEqual(legend, red, "the legend's first swatch is the same red");
  /* a labelled scale bar: dark pixels in the rows under the bar where the kit's bar has none */
  const a = read(png), b = read(out); let drawn = 0;
  for (let y = 320 - 13; y < 320 - 4; y++) for (let x = 14; x < 140; x++) if (a(x, y).some((v, i) => Math.abs(v - b(x, y)[i]) > 40)) drawn++;
  assert.ok(drawn > 20, `the numbers 0, 25, 50 m are drawn under the kit's bar (${drawn} pixels changed)`);
});

test("frame: a wing is seen whole from above, a part close, an explicit number wins", () => {
  const wing = aimAt(site, "Sentralblokka"), a = frame(site, { focus: "Sentralblokka" }, wing, { ...VIEWS.isometrisk });
  assert.equal(a.tilt, 50); assert.ok(a.dist < 200 && a.dist > 150, `the wing's default distance ${a.dist} (was 250)`); assert.equal(a.levels.levels.length, 3);
  assert.equal(a.target[2], 73.16 - 4, "aimed at the roof, not at 40 % of the height");
  const side = frame(site, { focus: "Sentralblokka", view_name: "S" }, wing, { ...VIEWS.S }); assert.equal(side.tilt, 12, "a named side keeps its pitch"); assert.ok(side.focus.includes("sentralblokka"), "from the side the wing itself is picked out");
  assert.equal(frame(site, { focus: "Sentralblokka", distance_m: 77, tilt_deg: 20 }, wing, { ...VIEWS.isometrisk, tilt: 20 }).dist, 77);
  const pav = aimAt(made, "npavi1"), p = frame(made, { focus: "npavi1" }, pav, { ...VIEWS.isometrisk });
  assert.ok(p.dist <= 40, `a part: close, ${p.dist} m`); assert.equal(p.accent, true); assert.deepEqual(p.focus, ["npavi1"]);
  assert.equal(frame(made, { view_name: "plan" }, null, { ...VIEWS.plan }).accent, true, "with something new, the new is picked out and the old toned down");
  assert.equal(frame(site, {}, null, { ...VIEWS.isometrisk }).accent, false, "the site as it is: no accent");
});

/* the tool: the caption says what is in the frame, and the garden is in the picture */
const dir = mkdtempSync(join(tmpdir(), "sykehus-lookglue-")), secret = "proxy-secret-for-tests-0123456789", PORT = 9100 + Math.floor(Math.random() * 800), O = `http://localhost:${PORT}`;
const srv = spawn(process.execPath, [new URL("../server.mjs", import.meta.url).pathname], { env: { ...process.env, PORT: String(PORT), SYKEHUS_VERSIONS_DIR: join(dir, "v"), SYKEHUS_PROXY_SECRET: secret, DOCS: "" }, stdio: ["ignore", "pipe", "inherit"] });
await new Promise(ok => srv.stdout.on("data", d => String(d).includes("Sykehustomta on") && ok()));
after(() => srv.kill());
const call = async (name, args) => (await (await fetch(O + "/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) })).json()).result;

test("look: the caption names the roof levels, the new part with its place and the garden, in plan with a scale", async () => {
  const d = (await call("try_change", { edits: GARDEN, include_screenshot: false })).structuredContent.draft;
  const r = await call("look", { draft: d, focus: "Sentralblokka", view_name: "plan", width: 640, height: 400 }), t = r.content[1].text;
  assert.equal(r.content[0].mimeType, "image/png");
  assert.match(t, /plan, rett ovenfra.*154 m unna.*målestokken nederst til venstre er 50 m/);
  assert.match(t, /kote 73,16 rødt \(552 m²\), kote 69,91 blågrønt \(1998 m²\), kote 66,41 brunt/);
  assert.match(t, /Paviljong \(på taket til Sentralblokka, kote 73,2–76,4, innenfor takkanten\)/);
  assert.match(t, /Takhage \(gress, kote 69,91, [\d,]+ m²\); sti-2 \(sti, kote 69,91.*2 trær/);
  const o = await call("look", { draft: d, focus: "npavi1" }); assert.match(o.content[1].text, /\d+ m unna, midt i bildet Paviljong/); assert.match(o.content[1].text, /sterk oransje mot dempede gamle bygg/);
});
