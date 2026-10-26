/* U3637: the base model's IFC (public/data/sykehus.ifc, tools/ifc.py): the high block drawn as a model, the other
   wings as simple blocks marked to be demolished. Read from the IFC text, as the file crosses out. */
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

test("every other wing: simple blocks only, each carrying Status DEMOLISH, with a volume", () => {
  const others = buildings.filter(b => b !== high); assert.equal(others.length, 12);
  const status = new Map();   // element id -> its Pset_*Common's Status
  for (const [, e] of ents) if (e.type === "IFCRELDEFINESBYPROPERTIES") {
    const ps = p.ents.get(+/#(\d+)$/.exec(e.args)[1]), props = ids(ps.args.replace(/^.*?,\(/, "(")).map(i => p.ents.get(i));
    if (/^'[^']*',\$,'Pset_BuildingElementProxyCommon'/.test(ps.args) && props.some(x => /^'Status',\$,IFCLABEL\('DEMOLISH'\)/.test(x.args)))
      for (const i of ids(e.args.replace(/^'[^']*',\$,\$,\$,/, "").replace(/,#\d+$/, ""))) status.set(i, "DEMOLISH");
  }
  const qtoOn = new Set(); for (const [, e] of ents) if (e.type === "IFCRELDEFINESBYPROPERTIES" && /Qto_BuildingElementProxyQuantities/.test(p.ents.get(+/#(\d+)$/.exec(e.args)[1]).args)) ids(e.args.replace(/^'[^']*',\$,\$,\$,/, "").replace(/,#\d+$/, "")).forEach(i => qtoOn.add(i));
  for (const b of others) {
    const blocks = [...p.ents].filter(([id, e]) => e.type === "IFCBUILDINGELEMENTPROXY" && b.all.includes(e));
    assert.ok(blocks.length >= 1, `${b.name}: a block`);
    assert.equal(b.all.filter(e => /^IFC(WALL|SLAB|WINDOW|SPACE|COLUMN)$/.test(e.type)).length, 0, `${b.name}: nothing but blocks`);
    for (const [id] of blocks) { assert.equal(status.get(id), "DEMOLISH", `${b.name}: status`); assert.ok(qtoOn.has(id), `${b.name}: volume`); }
  }
});
