/* T1 measure (read back what was placed; «Mål» in numbers) and T2 (parts that meet on one roof). Fixture: the roof test's wing on a 30° grid, kote 10 and 14
   blocks 20 × 10 m; then the real Sentralblokka through the MCP call itself.   node --test tests/measure.test.mjs */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { checkEdit, applyEdits, wingOf } from "../public/edits.js";
import { measureParts, checkFit, roofOf } from "../public/design.js";
import { distance3, horizontal } from "../public/renderkit/measure.js";

const TH = 30 * Math.PI / 180, c = Math.cos(TH), s = Math.sin(TH);
const X = (u, v) => [Math.round((u * c - v * s) * 100) / 100 + 0, Math.round((u * s + v * c) * 100) / 100 + 0];
const rect = (u0, v0, u1, v1, top) => ({ p: [X(u0, v0), X(u1, v0), X(u1, v1), X(u0, v1)], top });
const bld = { id: "tw", wing: "tw", own: true, base: 2, top: 14, ring: [X(0, 0), X(40, 0), X(40, 10), X(0, 10)], area_m2: 400, grid_deg: 30, blocks: [rect(0, 0, 20, 10, 10), rect(20, 0, 40, 10, 14)] };
const site = { buildings: [bld], wings: [{ id: "tw", name: "Testfløy", levels: [] }], added: [] };
const vol = (name, u0, u1, v, W, extra = {}) => ({ kind: "volume", name, shape: "box", height: 4, from: X(u0, v), to: X(u1, v), width: W, on: "tw", align: "free", ...extra });
const put = (st, ...es) => applyEdits(st, [], es.reduce((l, e) => [...l, checkEdit(applyEdits(st, [], l).site, [], e)], [])).site;

test("T1 read-back of a placed part: corners, axis, length, width, foot and top kote, m², what it stands on", () => {
  const st = put(site, vol("Glasstak", 2, 14, 5, 6));
  const r = measureParts(st, "Glasstak", undefined, wingOf);
  assert.equal(r.a.axis_bearing_deg, 60); assert.equal(r.a.length_m, 12); assert.equal(r.a.width_m, 6);
  assert.equal(r.a.foot_kote, 10); assert.equal(r.a.top_kote, 14); assert.equal(r.a.area_m2, 72); assert.equal(r.a.stands_on, "taket til Testfløy");
  assert.equal(r.a.corners.length, 4);
  for (const k of r.a.corners) assert.ok(Math.abs(Math.hypot(k[0] - (X(2, 5)[0] + X(14, 5)[0]) / 2, k[1] - (X(2, 5)[1] + X(14, 5)[1]) / 2) - Math.hypot(6, 3)) < 0.03, "each corner is 6.7 m from the middle");
  assert.match(r.say, /12 × 6 m, akse 60°, fot kote 10, topp kote 14, 72 m², står på taket til Testfløy/);
});

test("T1 two things: the numbers are «Mål»'s own (distance3, horizontal), angle, offset, parallel and overhang to 0.05 m", () => {
  const st = put(site, vol("Glasstak", 30, 42, 5, 6));
  const r = measureParts(st, "Glasstak", "Testfløy", wingOf);
  assert.equal(r.angle_deg, 0); assert.equal(r.parallel, true); assert.ok(Math.abs(r.offset_m) < 0.05, 'on the roof axis: ' + r.offset_m);
  assert.ok(Math.abs(r.overhang_m - 2) < 0.05, "12 m from u 30 to 42 on a roof that ends at 40: 2 m out, got " + r.overhang_m);
  assert.ok(r.outside_m2 > 11 && r.outside_m2 < 13, "2 m × 6 m out: " + r.outside_m2);
  const a = r.a, b = r.b, pa = [(X(30, 5)[0] + X(42, 5)[0]) / 2, (X(30, 5)[1] + X(42, 5)[1]) / 2, 14];
  const mid = [r.b.corners.reduce((t, p) => t + p[0], 0) / 4, r.b.corners.reduce((t, p) => t + p[1], 0) / 4];
  assert.ok(Math.abs(r.horizontal_m - horizontal(pa, mid)) < 0.02, `${r.horizontal_m} vs ${horizontal(pa, mid)}`);
  assert.ok(Math.abs(r.distance_m - distance3(pa, [...mid, 14])) < 0.02 && Math.abs(r.dh_m) < 0.05, `dh ${r.dh_m}`);
  assert.match(r.say, /stikker 2 m .* ut over takkanten til Testfløy/); assert.match(r.say, /parallelt/);
  const off = measureParts(put(site, vol("Sidelengs", 2, 14, 7, 4)), "Sidelengs", "Testfløy", wingOf);
  assert.ok(Math.abs(off.offset_m - 2) < 0.05 && off.offset_side === "venstre", JSON.stringify([off.offset_m, off.offset_side]));
  assert.equal(measureParts(site, [0, 0, 5], [3, 4, 5], wingOf).distance_m, 5);
  assert.equal(measureParts(site, [0, 0, 0], [3, 4, 12], wingOf).distance_m, 13);
});

test("T1 a part 3° off the building: angle 3.0, not parallel; a wrong id is refused with a sentence", () => {
  const st = put(site, { ...vol("Skjev", 2, 14, 5, 6), to: [X(2, 5)[0] + 12 * Math.sin(57 * Math.PI / 180), X(2, 5)[1] + 12 * Math.cos(57 * Math.PI / 180)] });
  const r = measureParts(st, "Skjev", "Testfløy", wingOf);
  assert.equal(r.angle_deg, 3); assert.equal(r.parallel, false); assert.match(r.say, /skjev 3° .*ikke parallelt/);
  assert.throws(() => measureParts(st, "Palmehagen", "Testfløy", wingOf), /Fant ikke «Palmehagen».*en fløy, et nytt bygg \(id eller navn: [^)]*\) eller et punkt/);
  assert.throws(() => measureParts(st, [1, 2], undefined, wingOf), /gi b også/);
  assert.throws(() => measureParts(st, [1], [2, 3], wingOf), /Et punkt er \[øst, nord\]/);
});

test("T2 two parts meeting on one roof: refused with both names and the m²; allow_overlap keeps it and checkFit lists it", () => {
  const A = vol("Glasstak A", 2, 14, 5, 8), B = vol("Glasstak B", 5.5, 15.5, 5, 7.2);   // u 5.5..14 = 8.5 m deep, 7.2 m wide: 61.2 m²
  const st = put(site, A);
  assert.throws(() => checkEdit(st, [], B), /Glasstak B overlapper «Glasstak A» \(61,2 m²\) på taket til Testfløy.*allow_overlap: true/);
  assert.throws(() => checkEdit(st, [], { ...B, align: undefined }), /overlapper|stikker|ingen/, "the aligned one is checked too");
  const ok = checkEdit(st, [], { ...B, allow_overlap: true }); assert.equal(ok.allow_overlap, true);
  const both = put(site, A, { ...B, allow_overlap: true });
  assert.equal(both.added.find(x => x.name === "Glasstak B").allow_overlap, true);
  const f = checkFit(both);
  assert.deepEqual(f.collisions.map(x => [x.a, x.b, x.m2, x.kept]), [["Glasstak A", "Glasstak B", 61.2, true]]);
  assert.equal(f.ok, false); assert.match(f.say, /«Glasstak A» og «Glasstak B» overlapper 61,2 m² på taket til Testfløy/);
  const clear = checkFit(st, { id: "tw", name: "Testfløy" }); assert.equal(clear.ok, true); assert.match(clear.say, /Ingen kollisjoner på taket til Testfløy: 1 del sjekket/);
  assert.match(checkFit(site).say, /ingen nye deler/);
  /* a reshape that moves it into the other is refused the same way; one that only says allow_overlap is not */
  const apart = put(site, A, vol("Glasstak C", 15, 19, 5, 4));
  assert.throws(() => checkEdit(apart, [], { kind: "reshape", id: apart.added[1].id, from: X(10, 5), to: X(18, 5), width: 4, align: "free" }), /Glasstak C overlapper «Glasstak A»/);
  assert.equal(checkEdit(apart, [], { kind: "reshape", id: apart.added[1].id, allow_overlap: true }).allow_overlap, true);
});

test("T2 parts that do not meet in height, or lie side by side, are not a collision", () => {
  const st = put(site, vol("Lav", 2, 14, 5, 8), vol("Ved siden", 15, 19, 5, 8));
  assert.equal(checkFit(st).ok, true);
  const hi = put(site, vol("Lav", 2, 14, 5, 8, { height: 4 }), vol("Høy", 24, 36, 5, 8));   // kote 10 and kote 14 levels, far apart
  assert.equal(checkFit(hi).collisions.length, 0);
});

/* the real thing, through the MCP call */
const dir = mkdtempSync(join(tmpdir(), "sykehus-measure-")), secret = "proxy-secret-for-tests-0123456789", PORT = 9900 + Math.floor(Math.random() * 90);
const srv = spawn(process.execPath, [new URL("../server.mjs", import.meta.url).pathname], { env: { ...process.env, PORT: String(PORT), SYKEHUS_VERSIONS_DIR: join(dir, "v"), SYKEHUS_PROXY_SECRET: secret, DOCS: "" }, stdio: ["ignore", "pipe", "inherit"] });
await new Promise(ok => srv.stdout.on("data", d => String(d).includes("Sykehustomta on") && ok()));
after(() => srv.kill());
const H = { "remote-user": "lars", "x-sykehus-proxy-auth": secret };
const call = async (name, args) => (await (await fetch(`http://localhost:${PORT}/mcp`, { method: "POST", headers: { "content-type": "application/json", ...H }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) })).json()).result;
const text = r => r.content.filter(c => c.type === "text").map(c => c.text).join(" ");

test("Sentralblokka through the MCP call: Palmehagen 3° off the roof axis, inside the edge; a second on top of it is refused; allow_overlap lists it", async () => {
  const real = JSON.parse(readFileSync(new URL("../public/data/site.json", import.meta.url))), big = roofOf(real, "sentralblokka").levels.find(l => l.kote === 69.91).bounding_rect;
  const m = [0, 1].map(k => big.corners.reduce((t, p) => t + p[k], 0) / 4), br = 35 * Math.PI / 180, u = [Math.sin(br), Math.cos(br)];
  const ed = (name, d, extra = {}) => ({ kind: "volume", name, shape: "box", height: 3, width: 6, on: "sentralblokka", align: "free", from: [m[0] + d * 3 - u[0] * 20, m[1] + d * 3 - u[1] * 20], to: [m[0] + d * 3 + u[0] * 20, m[1] + d * 3 + u[1] * 20], ...extra });
  const t = await call("try_change", { edits: [ed("Palmehagen", 0)], include_screenshot: false }); assert.ok(!t.isError, text(t));
  const draft = t.structuredContent.draft;
  const r = await call("measure", { a: "Palmehagen", b: "Sentralblokka", target: draft }); assert.ok(!r.isError, text(r));
  const d = r.structuredContent; assert.equal(d.angle_deg, 3); assert.equal(d.parallel, false); assert.equal(d.overhang_m, 0); assert.ok(d.offset_m < 0.05, "centred on the axis: " + d.offset_m);
  assert.match(d.say, /skjev 3° .*ikke parallelt.*ligger innenfor takkanten til Sentralblokka/);
  const back = (await call("measure", { a: "Palmehagen", target: draft })).structuredContent; assert.equal(back.a.foot_kote, 73.2, "the level that holds most of it (73,16), as the card stores it"); assert.equal(back.a.length_m, 40);
  const bad = await call("measure", { a: "Palmehagen", b: "Atlantis", target: draft }); assert.equal(bad.isError, true); assert.match(text(bad), /Fant ikke «Atlantis»/);
  const two = await call("try_change", { edits: [ed("Bassenget", 0.5)], target: draft, include_screenshot: false }).then(x => x.structuredContent);
  assert.equal(two.added.length, 0); assert.match(two.rejected[0].error, /Bassenget overlapper «Palmehagen» \(\d+,?\d* m²\) på taket til Sentralblokka/);
  const kept = (await call("try_change", { edits: [ed("Bassenget", 0.5, { allow_overlap: true })], target: draft, include_screenshot: false })).structuredContent;
  assert.equal(kept.added.length, 1); assert.ok(kept.fit.find(f => f.name === "Bassenget").roof.overlap[0].with === "Palmehagen", JSON.stringify(kept.fit));
  const q = (await call("check_fit", { wing: "Sentralblokka", target: draft })).structuredContent;
  assert.equal(q.ok, false); assert.equal(q.collisions.length, 1); assert.deepEqual([q.collisions[0].a, q.collisions[0].b].sort(), ["Bassenget", "Palmehagen"]); assert.match(q.say, /overlapper \d+,?\d* m² på taket til Sentralblokka/);
});

test("tool text stays inside the plan's budget: a non-try_change tool at most 2900 chars (name, title, description, inputSchema)", async () => {
  const list = (await (await fetch(`http://localhost:${PORT}/mcp`, { method: "POST", headers: { "content-type": "application/json", ...H }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) })).json()).result.tools;
  for (const n of ["measure", "check_fit"]) { const t = list.find(x => x.name === n), len = JSON.stringify({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema }).length; assert.ok(len <= 2900, `${n}: ${len}`); console.log(n, len, "chars"); assert.ok(t.outputSchema); }
});
