/* U3637: the base model's IFC (public/data/sykehus.ifc, tools/ifc.py): the high block drawn as a model, the other
   wings as they were before (demolishing one is the person's own edit, «Riv»). Read from the IFC text, as the file crosses out. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseIfc, stepText } from "../ifcfilter.mjs";

const p = parseIfc(readFileSync(new URL("../public/data/sykehus.ifc", import.meta.url), "utf8")), ents = [...p.ents];
const ids = s => [...s.matchAll(/#(\d+)/g)].map(m => +m[1]);
const nameOf = e => stepText((/^'(?:[^']|'')*',[^,]*,'((?:[^']|'')*)'/.exec(e.args) || [])[1] || "");
/* what a building holds: down the aggregates (building > storeys) and the containment (storey > elements) */
const kidsOf = new Map();   // id -> what it aggregates or contains
for (const [, e] of ents) {
  let up = null, kids = null, m;
  if (e.type === "IFCRELAGGREGATES" && (m = /^'[^']*',\$,\$,\$,#(\d+),\(([^)]*)\)/.exec(e.args))) [up, kids] = [+m[1], ids(m[2])];
  if (e.type === "IFCRELCONTAINEDINSPATIALSTRUCTURE" && (m = /^'[^']*',\$,\$,\$,\(([^)]*)\),#(\d+)$/.exec(e.args))) [up, kids] = [+m[2], ids(m[1])];
  if (up) kidsOf.set(up, [...(kidsOf.get(up) || []), ...kids]);
}
const down = id => (kidsOf.get(id) || []).flatMap(k => [k, ...down(k)]);
const buildings = ents.filter(([, e]) => e.type === "IFCBUILDING").map(([id, e]) => ({ id, name: nameOf(e), all: down(id).map(k => p.ents.get(k)) }));
const count = (b, type) => b.all.filter(e => e.type === type).length;
const high = buildings.find(b => b.name === "Sentralblokka");

test("the high block: 14 storeys, and its envelope as walls, slabs, windows with their types", () => {
  assert.equal(count(high, "IFCBUILDINGSTOREY"), 14);
  assert.ok(count(high, "IFCWALL") >= 90, `walls: ${count(high, "IFCWALL")}`);
  assert.ok(count(high, "IFCSLAB") >= 14 && high.all.some(e => e.type === "IFCSLAB" && /'Tak'/.test(e.args)), "slabs and the roof");
  const windows = count(high, "IFCWINDOW"); assert.ok(windows > 1000, `windows: ${windows}`);
  const wtypes = ents.filter(([, e]) => e.type === "IFCWINDOWTYPE"); assert.ok(wtypes.length >= 1 && wtypes.length < 10, "one type a size, not one a window");
  const typed = ents.filter(([, e]) => e.type === "IFCRELDEFINESBYTYPE" && wtypes.some(([id]) => e.args.endsWith(`,#${id}`)));
  assert.equal(typed.reduce((n, [, e]) => n + ids(e.args.replace(/,#\d+$/, "")).length, 0), windows, "every window is an occurrence of a type");
  const mats = ents.filter(([, e]) => e.type === "IFCMATERIAL").map(([, e]) => e.args);
  assert.ok(mats.includes("'Concrete','Betong','concrete'") && mats.includes("'Glass','Glass','glass'"), mats.join(" | "));
});

test("no window of the high block stands over a storey joint: sill and head inside one storey's band", async () => {
  const { rowsOf } = await import("../public/bays.js"), site = JSON.parse(readFileSync(new URL("../public/data/site.json", import.meta.url), "utf8"));
  const wing = site.wings.find(w => w.id === "sentralblokka"), r = rowsOf("tower", wing, 14.79);
  assert.equal(r.step, 3.76, "the rule counts the wing's real storey height, not 3.5");
  const storeys = high.all.filter(e => e.type === "IFCBUILDINGSTOREY").map(e => +/,([-\d.]+)$/.exec(e.args)[1]).sort((a, b) => a - b);
  assert.deepEqual(storeys, wing.levels.map(l => l.kote), "the storeys at the wing's levels");
  const z = id => { const e = p.ents.get(id); return +/\(([-\d.]+),([-\d.]+),([-\d.]+)\)/.exec(e.args)[3]; };
  const pick = (e, t) => ids(e.args).map(i => p.ents.get(i)).find(x => x?.type === t);
  let n = 0;
  for (const w of high.all.filter(e => e.type === "IFCWINDOW")) {
    const shape = p.ents.get(ids(w.args)[1]), rep = p.ents.get(ids(shape.args)[0]), solid = p.ents.get(ids(rep.args.replace(/^#\d+,/, ""))[0]);
    const [, axis] = ids(solid.args), pt = ids(p.ents.get(axis).args)[0], sill = z(pt), head = sill + +/,([-\d.]+)$/.exec(solid.args)[1];
    const band = storeys.findIndex((k, i) => sill >= k - 1e-6 && head <= (storeys[i + 1] ?? 1e9) + 1e-6);
    assert.ok(band >= 0, `window ${sill.toFixed(2)}-${head.toFixed(2)} stands over a storey joint`); n++;
  }
  assert.ok(n > 1000, `windows read: ${n}`);
});

/* the base IFC before U3637 (origin/main 61c15f0): what each other wing holds, by class. Demolishing a wing is the person's edit. */
const BEFORE = {"Sentralblokka, sidebygg": {"IFCBUILDINGSTOREY": 1, "IFCWALL": 230, "IFCSLAB": 17, "IFCSPACE": 1}, "Kirurgisk poliklinikk": {"IFCBUILDINGSTOREY": 1, "IFCSLAB": 18, "IFCWALL": 103}, "Midtfløy": {"IFCBUILDINGSTOREY": 6, "IFCWALL": 222, "IFCSLAB": 18, "IFCSPACE": 21}, "Vestfløy": {"IFCBUILDINGSTOREY": 1, "IFCWALL": 102, "IFCSLAB": 13, "IFCSPACE": 17}, "Venstre nordfløy": {"IFCBUILDINGSTOREY": 1, "IFCWALL": 151, "IFCSLAB": 23, "IFCSPACE": 16}, "MR-bygget": {"IFCBUILDINGSTOREY": 1, "IFCWALL": 28, "IFCSLAB": 5, "IFCSPACE": 3}, "Østre nordfløy": {"IFCBUILDINGSTOREY": 5, "IFCWALL": 1186, "IFCSLAB": 145, "IFCSPACE": 44}, "Østfløy": {"IFCBUILDINGSTOREY": 5, "IFCWINDOW": 59, "IFCWALL": 1375, "IFCSLAB": 225, "IFCSPACE": 15}, "Bygg ved Dronninggata (fyrhus/tøysentral?)": {"IFCBUILDINGSTOREY": 1, "IFCSLAB": 9, "IFCWALL": 20}, "Trappehus nordøst": {"IFCBUILDINGSTOREY": 1, "IFCSLAB": 11, "IFCWALL": 32}, "Operasjonsmodulen": {"IFCBUILDINGSTOREY": 1, "IFCWALL": 356, "IFCCOLUMN": 20, "IFCWINDOW": 10, "IFCSLAB": 2}, "Bod ved Tybrings gate": {"IFCBUILDINGSTOREY": 1, "IFCWALL": 18, "IFCSLAB": 3, "IFCSPACE": 3}};

test("every other wing is as it was: the same walls, slabs, rooms, windows and storeys; nothing marked to be demolished", () => {
  const others = buildings.filter(b => b !== high); assert.equal(others.length, Object.keys(BEFORE).length);
  for (const b of others) {
    const now = {}; for (const e of b.all) now[e.type] = (now[e.type] || 0) + 1;
    assert.deepEqual(Object.entries(now).sort(), Object.entries(BEFORE[b.name]).sort(), b.name);
  }
  assert.ok(ents.length > 100000, "the control: the file was read");
  assert.equal(ents.filter(([, e]) => /DEMOLISH/.test(e.args)).length, 0, "no Status DEMOLISH in the base");
  assert.equal(ents.filter(([, e]) => e.type === "IFCBUILDINGELEMENTPROXY").length, 0, "no simple blocks");
  assert.ok(ents.some(([, e]) => /^'Status',\$,IFCLABEL\('EXISTING'\)/.test(e.args)), "Status EXISTING where a property set carries it");
});
