/* T5: a plan and a section with dimensions. The dimension text IS measure's number (one copy), the section through Sentralblokka
   names the three roof kotes, and the two tools hand back a PNG and the words.   node --test tests/drawing.test.mjs */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { checkEdit, applyEdits, wingOf } from "../public/edits.js";
import { measureParts, roofOf } from "../public/design.js";
import { planDrawing, sectionDrawing } from "../public/drawing.js";
import { rasterize } from "../drawing-png.mjs";

const TH = 30 * Math.PI / 180, c = Math.cos(TH), s = Math.sin(TH);
const X = (u, v) => [Math.round((u * c - v * s) * 100) / 100 + 0, Math.round((u * s + v * c) * 100) / 100 + 0];
const rect = (u0, v0, u1, v1, top) => ({ p: [X(u0, v0), X(u1, v0), X(u1, v1), X(u0, v1)], top });
const bld = { id: "tw", wing: "tw", own: true, base: 2, top: 14, ring: [X(0, 0), X(40, 0), X(40, 10), X(0, 10)], area_m2: 400, grid_deg: 30, blocks: [rect(0, 0, 20, 10, 10), rect(20, 0, 40, 10, 14)] };
const site = { buildings: [bld], wings: [{ id: "tw", name: "Testfløy", levels: [{ name: "1. etasje", kote: 2.5 }, { name: "2. etasje", kote: 6 }] }], added: [] };
const vol = (name, u0, u1, v, W, extra = {}) => ({ kind: "volume", name, shape: "box", height: 4, from: X(u0, v), to: X(u1, v), width: W, on: "tw", align: "free", ...extra });
const put = (st, ...es) => applyEdits(st, [], es.reduce((l, e) => [...l, checkEdit(applyEdits(st, [], l).site, [], e)], [])).site;
const com = v => String(v).replace(".", ",");
const texts = d => d.prims.filter(p => p.t === "text").map(p => p.s);
const isPng = b => b.subarray(1, 4).toString() === "PNG";

test("plan of a wing: its length and width are measure's numbers, the roof's kotes are labelled", () => {
  const d = planDrawing(site, { focus: "Testfløy" }, wingOf), m = measureParts(site, "tw", undefined, wingOf).a;
  const len = d.dims.find(x => x.kind === "length"), wid = d.dims.find(x => x.kind === "width");
  assert.equal(len.value, m.length_m); assert.equal(wid.value, m.width_m); assert.equal(len.text, `${com(m.length_m)} m`);
  assert.ok(texts(d).includes(len.text) && texts(d).includes(wid.text), "the text is on the drawing");
  assert.ok(texts(d).includes(`AKSE ${com(m.axis_bearing_deg)}°`), "the axis says its bearing: " + texts(d));
  assert.deepEqual(d.kotes, roofOf(site, "tw").levels.map(l => l.kote)); assert.deepEqual(d.kotes, [14, 10]);
  assert.ok(texts(d).includes("+14,00") && texts(d).includes("+10,00") && texts(d).includes("N"));
  assert.match(d.say, /nord opp.*kote 14, 10 \(høyeste først\)/);
  assert.ok(isPng(rasterize(d.prims, d.W, d.H)));
});

test("plan of a new part on the roof: its dimensions are about_part's (length, width, axis), skewed or not", () => {
  const st = put(site, { ...vol("Skjev", 2, 14, 5, 6), to: [X(2, 5)[0] + 12 * Math.sin(57 * Math.PI / 180), X(2, 5)[1] + 12 * Math.cos(57 * Math.PI / 180)] });
  const d = planDrawing(st, { focus: "Skjev" }, wingOf), m = measureParts(st, "Skjev", undefined, wingOf).a;
  assert.equal(d.dims.find(x => x.kind === "length").value, m.length_m); assert.equal(d.dims.find(x => x.kind === "width").value, m.width_m);
  assert.ok(texts(d).includes(`AKSE ${com(m.axis_bearing_deg)}°`)); assert.equal(m.axis_bearing_deg, 57);
  assert.ok(texts(d).includes("Skjev") && texts(d).includes(`+${m.top_kote.toFixed(2).replace(".", ",")}`));
  assert.ok(d.say.includes(measureParts(st, "Skjev", undefined, wingOf).say), "the words are measure's own");
});

test("a scale that does not fit is refused with the one that does; one that fits is used", () => {
  assert.throws(() => planDrawing(site, { focus: "Testfløy", scale: 10 }, wingOf), /Det får ikke plass i 1:10; det minste målet som passer i bildet er 1:\d+/);
  const d = planDrawing(site, { focus: "Testfløy", scale: 500 }, wingOf); assert.equal(d.scale, 500); assert.match(d.say, /1:500/);
  assert.throws(() => planDrawing(site, { focus: "Testfløy", scale: 5 }, wingOf), /målestokken som tall/);
  assert.throws(() => planDrawing(site, { focus: "Palmehagen" }, wingOf), /Fant ikke «Palmehagen»: en fløy eller et nytt bygg/);
});

test("section across the fixture wing: both roof levels, the heights between, the runs add up", () => {
  const d = sectionDrawing(put(site, vol("Glasstak", 24, 36, 5, 6)), { focus: "tw", along: true }, wingOf);
  assert.deepEqual(d.crossed, [14, 10]); assert.deepEqual(d.levels, [14, 10]);
  const h = d.dims.filter(x => x.kind === "height").map(x => [x.from, x.to, x.value]);
  assert.deepEqual(h, [[2, 10, 8], [10, 14, 4], [14, 18, 4]]);
  assert.ok(d.dims.find(x => x.kind === "length" && Math.abs(x.value - 40) < 0.05), JSON.stringify(d.dims));
  const runs = d.dims.filter(x => x.kind === "run"); assert.deepEqual(runs.map(r => [r.kote, r.value]), [[10, 20], [14, 20]]); assert.ok(Math.abs(runs.reduce((t, r) => t + r.value, 0) - 40) < 0.1);
  for (const t of ["+14,00", "+10,00", "+2,00 FOT", "1. ETASJE +2,50"]) assert.ok(texts(d).some(x => x.toUpperCase() === t || x === t), t + " in " + texts(d));
  assert.match(d.say, /kote 14, 10 \(høyeste først\); snittet går gjennom 14, 10\./); assert.match(d.say, /Foten ligger på kote 2\./);
  assert.match(d.say, /14 til 18 er 4 m|10 til 14 er 4 m/);
  assert.throws(() => sectionDrawing(site, { focus: "tw", across: true, along: true }, wingOf), /across eller along, ikke begge/);
  assert.throws(() => sectionDrawing(site, { focus: "tw", line: [[0, 0]] }, wingOf), /line er to punkter/);
});

test("section through a new part on the roof: its foot and top kote are on the drawing", () => {
  const st = put(site, vol("Glasstak", 24, 36, 5, 6));
  const d = sectionDrawing(st, { focus: "Glasstak", across: true }, wingOf);
  assert.match(d.say, /Nytt i snittet: Glasstak \(kote 14 til 18\)/); assert.ok(texts(d).includes("Glasstak") && texts(d).includes("+18,00"));
  assert.ok(isPng(rasterize(d.prims, d.W, d.H)));
});

test("section through Sentralblokka (the real model): the three roof kotes 66,41 / 69,91 / 73,16, in the drawing and in words", () => {
  const real = JSON.parse(readFileSync(new URL("../public/data/site.json", import.meta.url)));
  const d = sectionDrawing(real, { focus: "Sentralblokka" }, wingOf), want = [73.16, 69.91, 66.41];
  assert.deepEqual(d.levels, want); assert.deepEqual(d.crossed, want, "the cut it picks goes through all three");
  for (const k of want) { assert.ok(d.say.includes(com(k)), "words: " + k); assert.ok(texts(d).includes("+" + com(k.toFixed(2))), "drawing: " + k); }
  assert.deepEqual(d.dims.filter(x => x.kind === "height").map(x => x.value), [51.62, 3.5, 3.25]);
  const base = roofOf(real, "sentralblokka"); assert.deepEqual(base.levels.map(l => l.kote), want, "the same levels about_wing gives");
  assert.ok(texts(d).some(x => /14\. ETASJE/i.test(x)), "the storeys' kote are there");
  assert.ok(isPng(rasterize(d.prims, d.W, d.H)));
});

/* the tools themselves, through the MCP call */
const dir = mkdtempSync(join(tmpdir(), "sykehus-draw-")), secret = "proxy-secret-for-tests-0123456789", PORT = 9100 + Math.floor(Math.random() * 800);
const O = `http://localhost:${PORT}`;
const srv = spawn(process.execPath, [new URL("../server.mjs", import.meta.url).pathname], { env: { ...process.env, PORT: String(PORT), SYKEHUS_VERSIONS_DIR: join(dir, "v"), SYKEHUS_PROXY_SECRET: secret, DOCS: "" }, stdio: ["ignore", "pipe", "inherit"] });
await new Promise(ok => srv.stdout.on("data", d => String(d).includes("Sykehustomta on") && ok()));
after(() => srv.kill());
const rpc = async (method, params) => (await (await fetch(O + "/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })).json()).result;
const call = (name, args) => rpc("tools/call", { name, arguments: args });

test("draw_section through the MCP call: a PNG and the kotes in words; draw_plan the same; a wrong wing is refused", async () => {
  const r = await call("draw_section", { wing: "Sentralblokka" }), img = r.content.find(x => x.type === "image");
  assert.equal(img.mimeType, "image/png"); assert.ok(isPng(Buffer.from(img.data, "base64")));
  const t = r.content.find(x => x.type === "text").text; for (const k of ["73,16", "69,91", "66,41"]) assert.ok(t.includes(k), k);
  assert.deepEqual(r.structuredContent.crossed, [73.16, 69.91, 66.41]);
  const p = await call("draw_plan", { focus: "Sentralblokka", scale: 1000 });
  assert.ok(p.content.some(x => x.type === "image")); assert.equal(p.structuredContent.scale, "1:1000");
  const m = await call("measure", { a: "Sentralblokka" });
  assert.equal(p.structuredContent.dimensions.find(x => x.kind === "length").value_m, m.structuredContent.a.length_m);
  assert.equal(p.structuredContent.dimensions.find(x => x.kind === "width").value_m, m.structuredContent.a.width_m);
  const bad = await call("draw_section", { wing: "Ingenting" }); assert.equal(bad.isError, true); assert.match(bad.content[0].text, /Fant ikke «Ingenting»/);
  const none = await call("draw_section", {}); assert.equal(none.isError, true); assert.match(none.content[0].text, /Si hvilken fløy/);
});

test("tool text stays small: each of the two tools is under 800 tokens (plan section 2)", async () => {
  for (const t of (await rpc("tools/list")).tools.filter(x => /^draw_/.test(x.name))) assert.ok(JSON.stringify(t).length / 3.6 <= 800, `${t.name}: ${Math.round(JSON.stringify(t).length / 3.6)} tokens`);
});
