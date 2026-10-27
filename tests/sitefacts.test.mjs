/* U3673: the plot's hazards and heritage, from Hagekart's site_report (stubbed here). node --test tests/sitefacts.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSiteFacts, LIMITS } from "../sitefacts.mjs";
import { createMcp } from "../mcp.mjs";
import { readFileSync } from "node:fs";

const REPORT = { place: "Dronninggata 28, 3019 Drammen", hardiness_zone: "H3", elevation_m: 24, frost: { x: 1 },
  hazards: [{ level: "moderate", text: "I aktsomhetsområde for kvikkleireskred: store gravearbeider eller fyllinger bør vurderes av geotekniker.", source: "NVE Aktsomhetskart for kvikkleireskred" }, { level: "veryHigh", text: "Radon: svært høy aktsomhet. Mål radon i boligen.", source: "NGU" }],
  heritage_within_50m: [{ name: "Sykehus, Dronninggata 28.", protection: "Kommunalt listeført", distance_m: 5, url: "https://kulturminnesok.no/ra/lokalitet/344914" }],
  invasive_plants_within_500m: [{ no: "kanadagullris", latin: "Solidago canadensis", risk: "SE", finds: 9, nearest_m: 144 }] };
const stub = (calls, answer = () => ({ ok: true, status: 200, json: async () => ({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: JSON.stringify(REPORT) }] } }) })) =>
  async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return answer(); };

test("it asks Hagekart's site_report for the plot's address once a day, and gives hazards, heritage and invasives with their sources and limits", async () => {
  const calls = []; let t = 1e12; const facts = createSiteFacts({ fetchImpl: stub(calls), url: "http://hagekart.test/mcp", now: () => t });
  const a = await facts();
  assert.equal(calls.length, 1); assert.equal(calls[0].url, "http://hagekart.test/mcp");
  assert.deepEqual(calls[0].body.params, { name: "site_report", arguments: { address: "Dronninggata 28, Drammen" } }); assert.equal(calls[0].body.method, "tools/call");
  assert.equal(a.hazards.length, 2); assert.match(a.hazards[0].text, /kvikkleire/); assert.equal(a.heritage_within_50m[0].distance_m, 5); assert.equal(a.invasive_plants_within_500m[0].latin, "Solidago canadensis");
  assert.equal(a.hardiness_zone, undefined, "garden facts (zone, frost) are not the plot's building facts");
  assert.match(a.zoning, /Ikke hentet for Drammen/); assert.match(a.sources, /NVE.*NGU.*Riksantikvaren/); assert.equal(a.limits, LIMITS); assert.match(a.limits, /Name these limits early/);
  t += 3600e3; await facts(); assert.equal(calls.length, 1, "kept a day");
  t += 25 * 3600e3; await facts(); assert.equal(calls.length, 2, "asked again after a day");
});
test("when Hagekart does not answer, the old answer stands; with none, the tool says so in a sentence", async () => {
  const calls = []; let t = 1e12, down = false;
  const facts = createSiteFacts({ fetchImpl: stub(calls, () => down ? ({ ok: false, status: 502, json: async () => ({}) }) : ({ ok: true, status: 200, json: async () => ({ result: { content: [{ type: "text", text: JSON.stringify(REPORT) }] } }) })), now: () => t });
  down = true; await assert.rejects(facts(), /Fikk ikke tomtefakta fra Hagekart: Hagekart svarte 502/);
  down = false; await facts(); t += 30 * 3600e3; down = true; const old = await facts(); assert.equal(old.hazards.length, 2, "the older answer");
});
test("the tool is on the connector, read only, takes nothing, and the instructions name the limits early", async () => {
  const mcp = createMcp({ site: JSON.parse(readFileSync(new URL("../public/data/site.json", import.meta.url))), floors: JSON.parse(readFileSync(new URL("../public/data/floors.json", import.meta.url))).floors,
    docs: null, docUrl: f => f, SECURITY: {}, readJson: async () => ({}), auth: { userOf: () => null }, pages: { open: new Map(), show: () => false } });
  const t = mcp.TOOLS.find(x => x.name === "site_facts"); assert.ok(t && t.ro && !t.tgt && t.schema.required.length === 0);
  assert.match(t.description, /name the limits early/);
  assert.match(readFileSync(new URL("../mcp.mjs", import.meta.url), "utf8"), /site_facts gives [^"]*name these limits early when a change touches them/);
});
