/* heritage_records: Riksantikvaren's open OGC API round the plot, answered from stubs (no network).
   node --test tests/heritage.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHeritage, OPEN_DATA } from "../heritage.mjs";
import { createMcp } from "../mcp.mjs";

const SITE = JSON.parse(readFileSync(new URL("../public/data/site.json", import.meta.url)));
const FC = (features, n = features.length) => ({ ok: true, status: 200, json: async () => ({ type: "FeatureCollection", numberMatched: n, features }) });
const ANSWERS = {
  "kulturminner/": FC([{ id: "10658-1", geometry: null, properties: { navn: "Juve pukkverk", minnetype: "LOKENK", lokalitetsart: "Industri", vernetype: "Automatisk fredet", linkKulturminnesøk: "https://kulturminnesok.no/ra/lokalitet/10658" } }], 60),
  "fredabygninger/": FC([{ id: 3507387, geometry: { type: "Point", coordinates: [10.2012345678, 59.7398] }, properties: { navn: "Bergstien 24", vernetype: "FOR", vernedato: "2012-02-16T00:00:00Z", linkKulturminnesøk: "https://kulturminnesok.no/ra/lokalitet/148687", sefrakId: null } }]),
  "sefrakbygninger/": FC([{ id: 486935, geometry: { type: "Point", coordinates: [10.208, 59.745] }, properties: { objektnavn: "BOLIGHUS, THORNEGT. 7", askeladdenId: "345907-0", fredning: null } }], 8),
  "kulturmiljoer/": FC([{ id: "3115", geometry: { type: "Polygon", coordinates: [] }, properties: { navn: "Seebergløkken og Det engelske kvartal", vernetype: "None", linkKulturminnesok: "https://www.kulturminnesok.no/kart/?id=k38" } }]),
};
const stub = (fail = {}) => { const seen = []; return { seen, f: async (u, o) => { seen.push({ u, o }); const k = Object.keys(ANSWERS).find(k => u.includes(`/${k.replace(/\/$/, "")}/items`) || u.includes(`collections/${k}items`)); if (fail[k]) return fail[k]; return ANSWERS[k]; } }; };
const recFor = (r, id) => r.records.find(x => x.id === id);

test("one request per register, to api.ra.no, over the lot's outline grown by radius_m in the API's own CRS", async () => {
  const s = stub(), r = await createHeritage({ site: SITE, fetchImpl: s.f })({ radius_m: 100 });
  assert.equal(s.seen.length, 4);
  const xs = SITE.lot.ring.map(p => p[0] + SITE.origin[0]), ys = SITE.lot.ring.map(p => p[1] + SITE.origin[1]);
  const want = [Math.min(...xs) - 100, Math.min(...ys) - 100, Math.max(...xs) + 100, Math.max(...ys) + 100].map(Math.round);
  assert.deepEqual(r.box_utm33, want);
  for (const { u } of s.seen) { const url = new URL(u); assert.equal(url.origin, "https://api.ra.no"); assert.equal(url.searchParams.get("bbox"), want.join(",")); assert.equal(url.searchParams.get("bbox-crs"), "http://www.opengis.net/def/crs/EPSG/0/25833"); assert.equal(url.searchParams.get("f"), "json"); }
  assert.equal(new URL(s.seen.find(x => x.u.includes("/kulturminner/collections/kulturminner/")).u).searchParams.get("kommune"), "Drammen", "the register whose box does not filter alone");
  assert.equal(s.seen.filter(x => x.u.includes("kommune=")).length, 1);
});

test("each record has source, id, name, type, link; the answer says it is open data; counts show matched against returned", async () => {
  const r = await createHeritage({ site: SITE, fetchImpl: stub().f })();
  assert.equal(r.records.length, 4); assert.equal(r.open_data, OPEN_DATA); assert.match(r.open_data, /Åpne data/);
  for (const x of r.records) for (const k of ["source", "id", "name", "type", "link"]) assert.ok(x[k], `${x.id} has ${k}`);
  assert.deepEqual(recFor(r, "3507387"), { source: "Riksantikvaren: Freda bygninger", id: "3507387", name: "Bergstien 24", type: "Freda bygning", protection: "FOR (2012-02-16)", link: "https://kulturminnesok.no/ra/lokalitet/148687", lonlat: [10.201235, 59.7398] });
  assert.equal(recFor(r, "10658-1").type, "LOKENK: Industri"); assert.equal(recFor(r, "10658-1").lonlat, undefined, "no geometry: none invented");
  assert.equal(recFor(r, "486935").link, "https://askeladden.ra.no/askeladden/?kid=345907-0");
  assert.equal(recFor(r, "3115").protection, undefined, "the text None is not a protection"); assert.equal(recFor(r, "3115").link, "https://www.kulturminnesok.no/kart/?id=k38");
  assert.deepEqual(r.counts["Kulturminner"], { returned: 1, matched: 60 }); assert.deepEqual(r.counts["SEFRAK-bygninger"], { returned: 1, matched: 8 });
});

test("radius and limit are capped; kinds picks registers", async () => {
  const s = stub(), r = await createHeritage({ site: SITE, fetchImpl: s.f })({ radius_m: 99999, limit: 999, kinds: ["Freda bygninger"] });
  assert.equal(r.radius_m, 500); assert.equal(s.seen.length, 1); assert.equal(new URL(s.seen[0].u).searchParams.get("limit"), "50");
});

test("one register down is named and the rest stand; all down is a sentence, never an empty list", async () => {
  const bad = { ok: false, status: 502, json: async () => ({}) };
  const r = await createHeritage({ site: SITE, fetchImpl: stub({ "sefrakbygninger/": bad }).f })();
  assert.equal(r.records.length, 3); assert.deepEqual(r.unavailable, ["SEFRAK-bygninger: svarte 502"]); assert.equal(r.counts["SEFRAK-bygninger"], undefined);
  const none = async () => { throw new Error("nede"); };
  await assert.rejects(createHeritage({ site: SITE, fetchImpl: none })(), /Fikk ikke kulturminnene fra Riksantikvaren/);
  const odd = async () => ({ ok: true, status: 200, json: async () => ({ title: "login" }) });
  await assert.rejects(createHeritage({ site: SITE, fetchImpl: odd })(), /svarte ikke med objekter/, "an answer without features is not an empty result");
});

test("the tool is on the connector, read only, with the lot behind it", async () => {
  const mcp = createMcp({ site: SITE, floors: JSON.parse(readFileSync(new URL("../public/data/floors.json", import.meta.url))).floors, docs: null, docUrl: f => f, SECURITY: {}, readJson: async () => ({}), auth: { userOf: () => null }, pages: { open: new Map(), show: () => false } });
  const t = mcp.TOOLS.find(x => x.name === "heritage_records"); assert.ok(t && t.ro && !t.tgt && !t.write);
  assert.deepEqual(t.schema.required || [], []); assert.match(t.description, /open data/);
});
