/* U3630: amounts and a rough price from the model, against Før. node --test tests/amounts.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadAmounts, amountsOf, compareAmounts } from "../amounts.mjs";
import { applyEdits, checkEdit } from "../public/edits.js";

const site0 = JSON.parse(readFileSync(new URL("../public/data/site.json", import.meta.url))), floors = JSON.parse(readFileSync(new URL("../public/data/floors.json", import.meta.url))).floors;
const table = loadAmounts(), sq = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const after = edits => applyEdits(site0, floors, edits.map(e => checkEdit(site0, floors, e))).site;
const file = o => { const f = join(mkdtempSync(join(tmpdir(), "amounts-")), "a.json"); writeFileSync(f, JSON.stringify(o)); return f; };

test("the shipped table loads, every price has a source", () => {
  assert.ok(table.prices.length >= 6); for (const p of table.prices) assert.ok(p.source.length > 10 && p.nok_low <= p.nok_high);
});
test("a price with no source, or an unknown amount, is refused", () => {
  const p = { item: "x", quantity: "concrete_m3", unit: "kr/m³", nok_low: 1, nok_high: 2 }, a = table.assumptions;
  assert.throws(() => loadAmounts(file({ assumptions: a, prices: [p] })), /no source/);
  assert.throws(() => loadAmounts(file({ assumptions: a, prices: [{ ...p, source: "s", quantity: "gold" }] })), /quantity/);
});
test("Før has no amounts of its own: a concrete box 20×10×6 m (two storeys) is slabs and walls, and the whole of it is the difference", () => {
  const s = after([{ kind: "volume", name: "Hall", shape: "box", from: [-46, -62], to: [-26, -62], width: 10, height: 6, material: "concrete" }]);
  const c = compareAmounts(amountsOf(s, table), amountsOf(site0, table), table);
  const row = k => c.rows.find(r => r.key === k);
  // 2 storeys: slab 200 m² × 0.25 = 50 twice, walls 60 m × 6 m × 0.2 = 72
  assert.equal(row("concrete_m3").now, 172); assert.equal(row("concrete_m3").before, 0); assert.equal(row("concrete_m3").diff, 172);
  assert.equal(row("concrete_m3").nok_low, 172 * 4000); assert.equal(row("concrete_m3").nok_high, 172 * 7000);
  assert.equal(row("concrete_t").now, 412.8);
  assert.match(c.say, /Betong 172 m³ \(\+172 mot Før\)/); assert.match(c.say, /antatt/); assert.equal(c.table.file, "rules/amounts.json");
  assert.ok(c.difference_nok.nok_low > 0 && c.difference_nok.nok_high > c.difference_nok.nok_low);
});
test("a glass house counts m² of glass (walls and roof); the difference of two afters can be negative", () => {
  const e = { kind: "volume", name: "Drivhus", shape: "box", from: [-46, -62], to: [-36, -62], width: 5, height: 3, material: "glass" };
  const g = amountsOf(after([e]), table), none = amountsOf(site0, table);
  assert.equal(g.q.glass_m2, 30 * 3 + 50);
  const back = compareAmounts(none, g, table, { of: "A", against: "B" });
  assert.equal(back.rows.find(r => r.key === "glass_m2").diff, -140); assert.ok(back.difference_nok.nok_low < 0 && back.difference_nok.nok_low <= back.difference_nok.nok_high);
});
test("a pool: concrete for the basin, water, and the earth dug in tonnes", () => {
  const s = after([{ kind: "surface", surface: "water", pool: true, ring: sq(60, 16, 10, 4), name: "Basseng" }]), a = amountsOf(s, table);
  assert.ok(a.q.concrete_m3 > 15, `concrete ${a.q.concrete_m3}`); assert.ok(a.q.water_m3 > 30);
  assert.ok(a.q.cut_m3 > 40 && a.q.earth_t === Math.round(a.q.cut_m3 * 1.8 * 10) / 10 || Math.abs(a.q.earth_t - a.q.cut_m3 * 1.8) < 0.2, `${a.q.cut_m3} m³, ${a.q.earth_t} t`);
});
test("a ground edit's cut and fill are in the amounts; a part of no known rule is said unmeasured, not zero", () => {
  const s = after([{ kind: "ground", ring: sq(60, 28, 14, 10), name: "Terrasse" }]), a = amountsOf(s, table);
  assert.ok(a.q.cut_m3 > 20 && a.q.fill_m3 > 0 && a.parts.cut_m3[0].name === "Terrasse");
  const u = amountsOf({ added: [{ kind: "volume", name: "Trapp", shape: "bim", bim: { part: "stair" } }] }, table);
  assert.equal(u.unmeasured.length, 1); assert.match(u.unmeasured[0].why, /stair/);
});
