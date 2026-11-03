/* A version out to FreeCAD and back (U3631, freecad.mjs, ifcbox.mjs, ifcadd.mjs for=freecad): a stair of the worker's is its own
   assembly with its type and its Id in the version; a file with that stair made wider gives one reshape with the new width, the
   part's id kept; the same file gives nothing; a stair moved gives its new from and to.
   node --test tests/freecad.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyEdits } from "../public/edits.js";
import { parseIfc } from "../ifcfilter.mjs";
import { withAdded } from "../ifcadd.mjs";
import { readPart } from "../partmerge.mjs";
import { readParts, splitArgs } from "../ifcbox.mjs";
import { reshapesFrom, partsOf } from "../freecad.mjs";

const site = JSON.parse(readFileSync(new URL("../public/data/site.json", import.meta.url)));
const floors = JSON.parse(readFileSync(new URL("../public/data/floors.json", import.meta.url))).floors;
const base = parseIfc(readFileSync(new URL("../public/data/sykehus.ifc", import.meta.url), "utf8"));
/* the worker's part as it answers (one run of gulden-worker's balcony part stands in for a stair here: the file's shape is what counts) */
const part = readPart(readFileSync(new URL("./fixtures/balcony-part.ifc", import.meta.url), "utf8"));
const after = () => { const m = applyEdits(site, floors, []);
  m.site.added = [{ kind: "volume", id: "nTrapp", name: "Trapp ned til hagen", shape: "bim", material: "concrete", from: [100, -60], to: [108, -52], base_kote: 10, top_kote: 12, width: 1.2, why: "test",
    bim: { part: "stair", params: { width: 1.2, height: 2, ground: 10 }, box: { min: [-5, -1, 10], max: [5, 1, 12] } } }];
  return m.site; };
const out = (opts = { freecad: true }) => withAdded(base.lines.join("\n"), base, after(), site, new Map([["part:nTrapp", part]]), opts);

test("for FreeCAD a part is its assembly with its type and its Id; the old export keeps the box", () => {
  const fc = out(), p = parseIfc(fc.text), kinds = t => [...p.ents.values()].filter(e => e.type === t);
  assert.equal(kinds("IFCELEMENTASSEMBLY").filter(e => /'Balkong'/.test(e.args)).length, 1, "the part's assembly");
  assert.ok(kinds("IFCELEMENTASSEMBLYTYPE").length >= 1 && kinds("IFCRELDEFINESBYTYPE").length >= 1, "with its type");
  assert.ok(kinds("IFCPROPERTYSET").some(e => /'Sykehustomta_Del'/.test(e.args)) && kinds("IFCPROPERTYSINGLEVALUE").some(e => /^'Id',\$,IFCLABEL\('nTrapp'\)/.test(e.args)), "its Id in the version");
  assert.equal(kinds("IFCPROJECT").length, 1, "one project");
  assert.ok(!kinds("IFCBUILDINGELEMENTPROXY").some(e => /Trapp ned/.test(e.args)), "no box in its place");
  const plain = parseIfc(out({}).text);
  assert.ok([...plain.ents.values()].some(e => e.type === "IFCBUILDINGELEMENTPROXY" && /Trapp ned/.test(e.args)), "the plain export is the box as before");
  assert.equal(fc.text, out().text, "the same after gives the same file");
});

test("the size of a part is read in its own frame: along, across, up", () => {
  const fc = out().text, frames = new Map(partsOf(after().added).entries().map(([id, a]) => [id, { u: a.u }]));
  const r = readParts(fc, frames), b = r.parts.get("nTrapp");
  assert.ok(b && b.n > 100, "points read");
  assert.ok(b.max[0] - b.min[0] > 1 && b.max[1] - b.min[1] > 1 && b.max[2] - b.min[2] > 0.5, JSON.stringify(b));
  const mid = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2], u = [0.7071, 0.7071], want = [104 * u[0] - 56 * u[1], 104 * -u[1] + -56 * u[0]];
  assert.ok(Math.abs(mid[0] - (104 * u[0] - 56 * u[1])) < 3 && Math.abs(mid[1] - (-104 * u[1] - 56 * u[0])) < 3, `its middle is where it stands: ${mid} (the fixture's own offset is at most 3 m)`);
  assert.deepEqual(splitArgs("'a,b',(#1,#2),$,IFCLABEL('x')"), ["'a,b'", "(#1,#2)", "$", "IFCLABEL('x')"]);
});

/* FreeCAD's save, made by hand: the slab's profile pulled out 0.2 m on one side */
const widened = text => {
  const p = parseIfc(text), E = id => p.ents.get(id), slab = [...p.ents].find(([, e]) => e.type === "IFCSLAB" && /Balkongplate/.test(e.args) && /Trapp|nTrapp|/.test(e.args));
  const rep = splitArgs(E(+/#(\d+)/.exec(splitArgs(slab[1].args)[6])[1]).args)[2], shp = +/#(\d+)/.exec(rep)[1], item = +/#(\d+)/.exec(splitArgs(E(shp).args)[3])[1];
  const prof = +/#(\d+)/.exec(splitArgs(E(item).args)[0])[1], poly = +/#(\d+)/.exec(splitArgs(E(prof).args)[2])[1], pts = [...splitArgs(E(poly).args)[0].matchAll(/#(\d+)/g)].map(m => +m[1]);
  const ys = pts.map(i => +/,(-?[\d.eE+-]+)\)/.exec(E(i).args)[1]), hi = Math.max(...ys), lines = p.lines.slice();
  for (const i of new Set(pts)) { const e = E(i), [x, y] = e.args.match(/-?[\d.eE+-]+/g).map(Number); if (y === hi) lines[e.i] = `#${i}=IFCCARTESIANPOINT((${x},${y + 0.2}));`; }
  return lines.join("\n");
};

test("a stair made wider in FreeCAD is one reshape with the new width, by its id", () => {
  const was = out().text, now = widened(was), got = reshapesFrom(was, now, after().added);
  assert.equal(got.edits.length, 1, JSON.stringify(got));
  const e = got.edits[0];
  assert.equal(e.kind, "reshape"); assert.equal(e.id, "nTrapp");
  assert.deepEqual(e.params, { width: 1.4 }, "1,2 m and 0,2 m more, only the width");
  assert.deepEqual(e.from.map(v => Math.round(v * 10) / 10), [99.9, -59.9], "it stands on the middle FreeCAD gives it: the side that was pulled out moved, the other stayed");
  assert.equal(got.changed[0].name, "Trapp ned til hagen");
  assert.match(got.changed[0].say, /bredde 1,2 → 1,4 m/);
});

test("the file as it went out gives no change; a part FreeCAD left out is said", () => {
  const was = out().text, same = reshapesFrom(was, was, after().added);
  assert.deepEqual([same.edits.length, same.same, same.missing.length], [0, 1, 0]);
  const gone = reshapesFrom(was, base.lines.join("\n"), after().added);
  assert.deepEqual([gone.edits.length, gone.missing], [0, ["Trapp ned til hagen"]]);
});

test("a stair moved in FreeCAD keeps its settings and takes new from and to", () => {
  const was = out().text, moved = was.replace("IFCCARTESIANPOINT((104.,-56.,0.))", "IFCCARTESIANPOINT((105.,-56.,0.))");
  assert.notEqual(moved, was, "the part's middle found");
  const got = reshapesFrom(was, moved, after().added);
  assert.equal(got.edits.length, 1); assert.equal(got.edits[0].params, undefined, "no setting changed"); assert.ok(got.edits[0].from && got.edits[0].to && /flyttet 1 m/.test(got.changed[0].say), got.changed[0].say);
});
