/* T6: area and cost summary. node --test tests/area.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCosts, summarize } from "../area.mjs";
import { checkEdit, applyEdits } from "../public/edits.js";

const site = JSON.parse(readFileSync(new URL("../public/data/site.json", import.meta.url)));
const floors = JSON.parse(readFileSync(new URL("../public/data/floors.json", import.meta.url))).floors;
const costsFile = o => { const f = join(mkdtempSync(join(tmpdir(), "costs-")), "costs.json"); writeFileSync(f, JSON.stringify(o)); return f; };

test("one 3-storey 20x10 box is 600 m² BTA (through the real edit pipeline)", () => {
  const e = checkEdit(site, floors, { kind: "volume", name: "Boks", shape: "box", from: [-46, -62], to: [-26, -62], width: 10, storeys: 3 });
  const m = applyEdits(site, floors, [e]), s = summarize(m.site, loadCosts());
  assert.equal(s.new_volumes.length, 1); assert.equal(s.new_volumes[0].bta_m2, 600); assert.equal(s.totals.bta_m2, 600);
  assert.equal(s.totals.bra_m2, null, "no sourced factor, no BRA");
  assert.equal(s.cost.nok_low, null); assert.match(s.cost.note, /ikke målt/);
});

test("a price with no source is refused at load; a sourced one is priced and marked antatt", () => {
  const base = { item: "Nybygg", quantity: "bta_m2", unit: "kr/m²", nok_low: 10, nok_high: 20 };
  assert.throws(() => loadCosts(costsFile({ prices: [base] })), /no source/);
  assert.throws(() => loadCosts(costsFile({ prices: [{ ...base, source: "  " }] })), /no source/);
  const s = summarize({ added: [{ kind: "volume", name: "B", storeys: 3, footprint_m2: 200 }] }, loadCosts(costsFile({ prices: [{ ...base, source: "test fixture" }] })));
  assert.equal(s.cost.nok_low, 6000); assert.equal(s.cost.nok_high, 12000); assert.equal(s.cost.lines[0].antatt, true); assert.equal(s.cost.lines[0].source, "test fixture");
});

test("demolished, surfaces and earthwork are summed", () => {
  const s = summarize({ demolished: [{ footprint_m2: 100, gross_volume_m3: 900.4 }, { footprint_m2: 50.5, gross_volume_m3: 300 }], landscape: [{ surface: "grass", area_m2: 10 }, { surface: "grass", area_m2: 5 }, { surface: "paving", area_m2: 2 }], earthwork: { cut_m3: 7, fill_m3: 3, net_m3: 4 } });
  assert.deepEqual(s.demolished, { count: 2, footprint_m2: 150.5, gross_volume_m3: 1200 });
  assert.deepEqual(s.ground, { surfaces: { grass: 15, paving: 2 }, total_m2: 17 }); assert.equal(s.earthwork.net_m3, 4);
});
