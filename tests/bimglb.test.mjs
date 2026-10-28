/* U3656: the 3D page draws the high block from public/data/hoyblokka.glb (tools/glb.py, made from the IFC's own geometry).
   The reader reads that layout, the file is the model (windows as glass, the storeys' height), and the wings it names are
   the IFC's envelope wings. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BIM, BIM_EXTRA, readGlb } from "../public/bimglb.js";
import { gzipSync } from "node:zlib";
import { MATERIALS, CLASS_MAT } from "../public/renderkit/materials.js";
import { parseIfc } from "../ifcfilter.mjs";

const site = JSON.parse(readFileSync(new URL("../public/data/site.json", import.meta.url), "utf8"));
const read = f => readFileSync(new URL("../" + f, import.meta.url));
const buf = f => { const b = read(f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };

test("the wings the page draws from a model are the wings the IFC builds as an envelope", () => {
  const py = read("tools/ifc.py").toString("utf8"), m = /^ENVELOPE = \(([^)]*)\)/m.exec(py);
  assert.ok(m, "tools/ifc.py names ENVELOPE (the guard reads that line; teach it if the line moved)");
  assert.deepEqual([...m[1].matchAll(/"([^"]+)"/g)].map(x => x[1]).sort(), Object.keys(BIM).sort());
  for (const f of Object.values(BIM)) assert.ok(read("public/" + f).length > 1000, f);
});

test("the high block's file: concrete and glass, in the wing's own heights, every index inside its positions", () => {
  const parts = readGlb(buf("public/" + BIM.sentralblokka)), by = Object.fromEntries(parts.map(p => [p.material, p]));
  assert.deepEqual(Object.keys(by).sort(), ["concrete", "steel", "window_glass"]);
  const b = site.buildings.find(x => x.wing === "sentralblokka");
  for (const p of parts) {
    assert.equal(p.indices.length % 3, 0);
    assert.equal(p.indices.reduce((m, i) => Math.max(m, i), 0) < p.positions.length / 3, true, "an index past the positions");
  }
  const ys = [...by.concrete.positions].filter((_, i) => i % 3 === 1), lo = Math.min(...ys), hi = Math.max(...ys);
  assert.ok(Math.abs(lo - b.base) < 1.5 && Math.abs(hi - Math.max(b.top, ...b.blocks.map(k => k.top))) < 0.5, `heights ${lo}..${hi} against the wing's ${b.base}..${b.top}`);
  assert.ok(by.window_glass.indices.length / 3 > 2750 * 8, "a window is a box: at least the 2750 windows of the IFC");
});

test("the reader refuses a file that is not a GLB 2", () => {
  assert.throws(() => readGlb(new Uint8Array(40).buffer), /not a GLB/);
});

/* the windows the IFC file holds for the wing (down the aggregates and the containment, as tests/envelope.test.mjs reads them),
   so the file and the page's model cannot drift: regenerate hoyblokka.glb (tools/glb.py) when tools/ifc.py or bays.js change */
function ifcCount(wingName, type = "IFCWINDOW") {
  const p = parseIfc(readFileSync(new URL("../public/data/sykehus.ifc", import.meta.url), "utf8")), ids = t => [...t.matchAll(/#(\d+)/g)].map(m => +m[1]), kids = new Map();
  for (const [, e] of p.ents) {
    let m, up, ks;
    if (e.type === "IFCRELAGGREGATES" && (m = /^'[^']*',\$,\$,\$,#(\d+),\(([^)]*)\)/.exec(e.args))) [up, ks] = [+m[1], ids(m[2])];
    if (e.type === "IFCRELCONTAINEDINSPATIALSTRUCTURE" && (m = /^'[^']*',\$,\$,\$,\(([^)]*)\),#(\d+)$/.exec(e.args))) [up, ks] = [+m[2], ids(m[1])];
    if (up) kids.set(up, [...(kids.get(up) || []), ...ks]);
  }
  const down = id => (kids.get(id) || []).flatMap(k => [k, ...down(k)]);
  const b = [...p.ents].find(([, e]) => e.type === "IFCBUILDING" && e.args.includes(`'${wingName}'`));
  assert.ok(b, `the IFC has no building ${wingName}`);
  return down(b[0]).filter(k => p.ents.get(k)?.type === type).length;
}
test("the GLB holds as many windows as the IFC file does for the wing (they cannot drift)", () => {
  const parts = readGlb(buf("public/" + BIM.sentralblokka)), glass = parts.find(p => p.material === "window_glass"), n = ifcCount("Sentralblokka");
  assert.ok(n > 1000, `IFC windows: ${n}`);
  assert.equal(parts.windows, n, "the count tools/glb.py wrote, against the IFC file's");
  assert.equal(glass.indices.length / 3, n * 12, "a window is a box of 12 triangles: the glass in the file is the count it says");
});
test("the file is small: quantised, and under 1 MB the way the server sends it (gzip)", () => {
  const f = read("public/" + BIM.sentralblokka);
  assert.ok(f.length < 1.8e6, `raw ${f.length}`);
  assert.ok(gzipSync(f).length < 1e6, `gzipped ${gzipSync(f).length}`);
});

test("every material in the file is a key of renderkit's materials.js (the one library), and the page takes no colour of its own", () => {
  for (const p of readGlb(buf("public/" + BIM.sentralblokka))) assert.ok(MATERIALS[p.material], `GLB material ${p.material}`);
  assert.ok(!/\bC\.pane\b/.test(read("public/viewer.js").toString()), "a local glass colour in viewer.js");
});

test("U3656: no IfcOpeningElement in the GLB (its volume would fill the hole it cuts), and a frame ring a window", () => {
  assert.match(read("tools/glb.py").toString(), /^SKIP = \([^)]*"IfcOpeningElement"/m, "tools/glb.py skips the openings");
  const parts = readGlb(buf("public/" + BIM.sentralblokka)), by = Object.fromEntries(parts.map(p => [p.material, p]));
  assert.ok(by.concrete.indices.length / 3 < 85000, `concrete triangles ${by.concrete.indices.length / 3}: with the openings written as boxes it was 103132`);
  assert.equal(by.steel.indices.length / 3, parts.windows * 16, "a frame: 8 triangles on each of a window's two faces");
});

test("U3656: greenhouse glass stays see-through, the windows of a facade wear their own glazing (the vendored library)", () => {
  assert.equal(MATERIALS.glass.look.transparent, true); assert.ok(MATERIALS.glass.look.opacity < 0.6);
  assert.equal(CLASS_MAT.IfcWindow, "window_glass"); assert.equal(CLASS_MAT.IfcPlate, "glass");
  assert.notEqual(MATERIALS.window_glass.look.transparent, true);
});

test("the built-in balconies are a file of their own: 13 slabs and 13 railings, a box of 12 triangles each, so a person's balconies can replace them", () => {
  const parts = readGlb(buf("public/" + BIM_EXTRA.sentralblokka)), by = Object.fromEntries(parts.map(p => [p.material, p]));
  assert.deepEqual(Object.keys(by).sort(), ["concrete", "steel"]);
  assert.equal(by.concrete.indices.length / 3, 13 * 12); assert.equal(by.steel.indices.length / 3, 13 * 12);
  const main = readGlb(buf("public/" + BIM.sentralblokka)), ys = [...by.concrete.positions].filter((_, i) => i % 3 === 1);
  assert.ok(Math.min(...ys) > 19.9 && Math.max(...ys) <= 65.7, "from the 2nd storey's floor to the 14th");
  assert.equal(ifcCount("Sentralblokka", "IFCRAILING"), 13); assert.ok(main.find(p => p.material === "steel"));
});
