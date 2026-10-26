/* What the after builds, in its IFC (U3556, ifcadd.mjs): new buildings with their storeys and body, balconies on their
   wing, a renamed wing under its new name, on the real before's file; nothing points at what is not in it.
   node --test tests/ifcadd.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkEdit, applyEdits } from "../public/edits.js";
import { parseIfc, withoutBuildings, stepText } from "../ifcfilter.mjs";
import { withAdded, gid, stepStr, balconySizes } from "../ifcadd.mjs";
import { readPart } from "../partmerge.mjs";

const site = JSON.parse(readFileSync(new URL("../public/data/site.json", import.meta.url)));
const floors = JSON.parse(readFileSync(new URL("../public/data/floors.json", import.meta.url))).floors;
const base = parseIfc(readFileSync(new URL("../public/data/sykehus.ifc", import.meta.url), "utf8"));
const add = (edits, e) => { const m = applyEdits(site, floors, edits); edits.push(checkEdit(m.site, m.floors, e)); return edits; };
const ifcOf = edits => { const m = applyEdits(site, floors, edits), left = new Set(m.site.buildings.map(b => b.wing).filter(Boolean));
  const gone = site.wings.filter(w => !left.has(w.id) && site.buildings.some(b => b.wing === w.id)).map(w => w.name);
  /* the worker's balcony part, as it answers (tests/fixtures/balcony-part.ifc, one run of gulden-worker's parts/balcony.py), for every size asked */
  const part = readPart(readFileSync(new URL("./fixtures/balcony-part.ifc", import.meta.url), "utf8")), parts = new Map([...balconySizes(m.site).keys()].map(k => [k, part]));
  return withAdded(withoutBuildings(base, gone).text, base, m.site, site, parts); };
const names = (p, type) => [...p.ents.values()].filter(e => e.type === type).map(e => stepText(/^'[^']*',[^,]*,'((?:[^']|'')*)'/.exec(e.args)?.[1] || ""));

test("GlobalIds are 22 characters of IFC's alphabet, the same for the same key; text as STEP", () => {
  assert.match(gid("nDrivhus"), /^[0-3][0-9A-Za-z_$]{21}$/); assert.equal(gid("nDrivhus"), gid("nDrivhus")); assert.notEqual(gid("nDrivhus"), gid("nDrivhut"));
  assert.equal(stepStr("Østfløy's"), "'\\X2\\00D8\\X0\\stfl\\X2\\00F8\\X0\\y''s'"); assert.equal(stepText("\\X2\\00D8\\X0\\stfl\\X2\\00F8\\X0\\y"), "Østfløy");
});

test("the after's IFC: a new building with its storeys and body, a pyramid, balconies on their wing, a wing renamed, one torn down", () => {
  let ed = add([], { kind: "volume", id: "nKontor", name: "Kontorbygg", shape: "box", from: [-46, -62], to: [-16, -62], width: 14, height: 12.8, storeys: 4, use: "kontor", why: "test" });
  ed = add(ed, { kind: "volume", id: "nPyr", name: "Drivhus", shape: "pyramid", from: [20, -90], to: [32, -90], width: 10, height: 7, material: "glass" });
  ed = add(ed, { kind: "balconies", wing: "Sentralblokka", face: 210, bay: 3.6, gap: 1.2 });
  ed = add(ed, { kind: "wing", wing: "Midtfløy", field: "name", value: "Midtfløyen (bevares)", why: "test" });
  ed = add(ed, { kind: "demolish", building: "Østfløy" });
  const { text, counts } = ifcOf(ed), p = parseIfc(text);
  assert.ok(counts.buildings === 2 && counts.elements > 10, JSON.stringify(counts));
  const b = names(p, "IFCBUILDING");
  assert.ok(b.includes("Kontorbygg") && b.includes("Drivhus") && b.includes("Midtfløyen (bevares)"), b.join(", "));
  assert.ok(!b.includes("Østfløy") && !b.includes("Midtfløy"), "torn down, and renamed");
  assert.equal(b.length, 13 - 1 + 2);
  assert.deepEqual(names(p, "IFCBUILDINGSTOREY").filter(n => /^[1-4]\. etasje$/.test(n)).length >= 4, true);
  assert.ok([...p.ents.values()].some(e => e.type === "IFCTRIANGULATEDFACESET"), "the pyramid's faces");
  assert.ok(names(p, "IFCELEMENTASSEMBLY").filter(n => n === "Balkong").length > 10, "balconies");
  /* U3620: a balcony is the balcony part's shape: an assembly of a slab and a railing, with property sets and quantities */
  const asms = [...p.ents.values()].filter(e => e.type === "IFCELEMENTASSEMBLY" && /'Balkong'/.test(e.args)), kinds = t => [...p.ents.values()].filter(e => e.type === t);
  assert.ok(asms.length > 10 && asms.length === names(p, "IFCSLAB").filter(n => n === "Balkongplate").length && names(p, "IFCRAILING").filter(n => n === "Balkongrekkverk").length === asms.length, "one assembly, one slab and one railing a balcony");
  assert.ok(kinds("IFCPROPERTYSET").some(e => /'Pset_SlabCommon'/.test(e.args)) && kinds("IFCPROPERTYSET").some(e => /'Pset_RailingCommon'/.test(e.args)), "property sets");
  assert.ok(kinds("IFCELEMENTQUANTITY").some(e => /'Qto_SlabBaseQuantities'/.test(e.args)) && kinds("IFCQUANTITYAREA").some(e => /'GrossArea'/.test(e.args)) && kinds("IFCQUANTITYVOLUME").length > 10, "quantities");
  assert.ok(kinds("IFCRELAGGREGATES").some(e => e.args.split("#").length === 4 + 0 && /\(#\d+,#\d+\)/.test(e.args)), "the assembly holds slab and railing");
  assert.ok(kinds("IFCELEMENTASSEMBLYTYPE").length >= 1 && kinds("IFCELEMENTASSEMBLYTYPE").length < asms.length && kinds("IFCRELDEFINESBYTYPE").length === kinds("IFCELEMENTASSEMBLYTYPE").length, "one type a size, the balconies its occurrences");
  /* U3619: one IfcMaterial a material used, named by its FreeCAD card, each element in one */
  const mats = [...p.ents.values()].filter(e => e.type === "IFCMATERIAL" && /^'(Concrete|Glass|Steel-Generic|Wood|Brick|Soil)',/.test(e.args)).map(e => e.args);
  assert.ok(mats.includes("'Glass','Glass','glass'") && mats.includes("'Concrete','Betong','concrete'") && mats.includes("'Soil','Jord','earth'"), mats.join(" | "));
  assert.equal(counts.materials, 4, `glass (the office by default, the pyramid, the railings' panes), steel (the part's handrail and posts), concrete (the slabs) and soil (the pads moved the ground): ${JSON.stringify(counts)} ${mats.join(" | ")}`);
  const rels = [...p.ents.values()].filter(e => e.type === "IFCRELASSOCIATESMATERIAL"), inRel = new Set(rels.flatMap(e => [...e.args.match(/\(([^)]*)\)/)[1].matchAll(/#(\d+)/g)].map(m => +m[1])));
  const news = [...p.ents].filter(([, e]) => /^(IFCSLAB|IFCRAILING|IFCBUILDINGELEMENTPROXY)$/.test(e.type) && /^'[^']*',\$,'(Balkongplate|Balkongrekkverk|Kontorbygg|Drivhus)'/.test(e.args));
  assert.ok(news.length > 10 && news.every(([id]) => inRel.has(id)), "every new element is in a material");
  assert.ok([...p.ents.values()].some(e => e.type === "IFCMATERIALPROPERTIES" && /'Pset_MaterialCommon'/.test(e.args)), "MassDensity");
  assert.ok(text.includes("IFCMASSDENSITYMEASURE(2400.)") && text.includes("IFCLABEL('26042aa5-56e6-4d99-8b63-dd8b9ea5a37a')"), "the card's density and UUID");
  /* every reference points at something in the file, and no id is twice */
  const ids = new Set(); for (const l of p.lines) { const m = /^#(\d+)=/.exec(l); if (m) { assert.ok(!ids.has(m[1]), `#${m[1]} twice`); ids.add(m[1]); } }
  for (const [id, e] of p.ents) for (const r of e.args.replace(/'(?:[^']|'')*'/g, "''").matchAll(/#(\d+)/g)) assert.ok(p.ents.has(+r[1]), `#${id} points at #${r[1]}`);
  assert.ok(text.trimEnd().endsWith("END-ISO-10303-21;"));
  assert.equal(ifcOf(ed).text, text, "the same after, the same file");
});

test("a new building renamed and given more storeys (reshape): the IFC follows; torn down again, it is gone", () => {
  let ed = add([], { kind: "volume", id: "nHusEn", name: "Hus", shape: "box", from: [-46, -62], to: [-16, -62], width: 14, height: 6.4, storeys: 2 });
  ed = add(ed, { kind: "reshape", id: "nHusEn", name: "Bolighus", storeys: 5 });
  const p = parseIfc(ifcOf(ed).text);
  assert.ok(names(p, "IFCBUILDING").includes("Bolighus") && !names(p, "IFCBUILDING").includes("Hus"));
  assert.ok(names(p, "IFCBUILDINGSTOREY").includes("5. etasje"));
  assert.ok(!names(parseIfc(ifcOf(add(ed, { kind: "demolish", building: "nHusEn" })).text), "IFCBUILDING").includes("Bolighus"));
});

test("nothing built: the before's file as it was", () => {
  const t = readFileSync(new URL("../public/data/sykehus.ifc", import.meta.url), "utf8");
  assert.equal(withAdded(t, base, applyEdits(site, floors, []).site, site).text, t);
});
