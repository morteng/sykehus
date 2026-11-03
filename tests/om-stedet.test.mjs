import test from "node:test"; import assert from "node:assert/strict";
import { reportOf } from "../sitefacts.mjs";
test("reportOf: hazards, heritage and invasive plants as plain rows with their source; empty groups say so", () => {
  const r = reportOf({ place: "Dronninggata 28, Drammen", hazards: [{ level: "moderate", text: "Høy radon", source: "NGU" }], heritage_within_50m: [{ name: "Sykehus", protection: "Kommunalt listeført", distance_m: 5 }],
    invasive_plants_within_500m: [{ no: "kanadagullris", latin: "Solidago canadensis", risk: "SE", nearest_m: 144 }], zoning: "Ikke hentet" });
  assert.deepEqual(r.sections.map(s => s.id), ["hazards", "heritage", "invasive"]);
  assert.equal(r.sections[0].rows[0].how, "NGU"); assert.match(r.sections[1].rows[0].line, /Sykehus.*5 m unna/); assert.match(r.sections[2].rows[0].line, /kanadagullris.*144 m/);
  const e = reportOf({}); assert.ok(e.sections.every(s => s.rows.length === 0 && s.empty));
});
