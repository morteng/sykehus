/* «Gjengi» (U3526): the household's monthly cap is kept before the image model is called, what a picture cost is
   OpenRouter's own figure, favourites and the full-size download; against the route over HTTP, the model a double
   that answers as OpenRouter's chat/completions does (a data URL in message.images, usage.cost) */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRenderings } from "../gjengi.mjs";

const dir = mkdtempSync(join(tmpdir(), "sykehus-gjengi-"));
/* a real JPEG header (SOI, SOF0 1440×900), padded past the 1 KB floor */
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 900 >> 8, 900 & 255, 1440 >> 8, 1440 & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]), Buffer.alloc(2048, 7)]);
const shot = "data:image/jpeg;base64," + jpeg.toString("base64");
const calls = [];
let answer = () => ({ choices: [{ message: { images: [{ image_url: { url: "data:image/png;base64," + Buffer.alloc(5000, 9).toString("base64") } }] } }], usage: { cost: 0.0731 }, provider: "Google" });
async function fetchImpl(url, opt = {}) {
  if (String(url).includes("/models")) return { ok: true, json: async () => ({ data: [{ id: "google/gemini-3.1-flash-image", pricing: { prompt: "0.0000005", completion: "0.000003", image_output: "0.00006" } }] }) };
  assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
  const b = JSON.parse(opt.body); calls.push(b);
  return { ok: true, status: 200, json: async () => answer(b) };
}
const versions = { get: id => id === "vAbcdefgh" ? { id, owner: "lars", sharing: "privat", own: "egen" } : null, visible: (v, who, key) => v.owner === who || key === v.own };
const login = { personOf: req => req.headers["x-who"] ? { person: req.headers["x-who"] } : null };
const readJson = req => new Promise((ok, no) => { const p = []; req.on("data", c => p.push(c)); req.on("end", () => { try { ok(JSON.parse(Buffer.concat(p))); } catch (e) { no(e); } }); });
const g = createRenderings({ dir, key: "test-key", cap: 0.2, size: "1K", readJson, login, versions, fetchImpl });
const srv = createServer(async (req, res) => { const url = new URL(req.url, "http://x"); if (!(await g.route(req, res, url.pathname, url))) res.writeHead(404).end(); }).listen(0);
after(() => srv.close());
const O = `http://localhost:${srv.address().port}`;
const post = (p, body, who) => fetch(O + p, { method: "POST", headers: { "content-type": "application/json", ...(who ? { "x-who": who } : {}) }, body: JSON.stringify(body) }).then(async r => ({ status: r.status, j: await r.json() }));
const get = (p, who) => fetch(O + p, { headers: who ? { "x-who": who } : {} }).then(async r => ({ status: r.status, j: await r.json() }));

test("the price before, then one picture: OpenRouter's cost kept, zdr routing sent, the view's aspect asked for", async () => {
  const s = await get("/api/gjengi?versjon=vAbcdefgh", "lars");
  assert.equal(s.j.signed_in, true); assert.equal(s.j.cap_usd, 0.2); assert.equal(s.j.month_usd, 0);
  assert.equal(s.j.estimate_usd, 0.08, "listed: 1300 × 0.00006 + 1300 × 0.0000005 + 300 × 0.0000005 = 0.0788, up to the cent");
  assert.equal((await post("/api/gjengi", { image: shot, versjon: "vAbcdefgh" })).status, 401, "signed out: nothing is made");
  assert.equal(calls.length, 0);
  const a = await post("/api/gjengi", { image: shot, versjon: "vAbcdefgh", wish: "kveldslys", shown_usd: 0.08 }, "lars");
  assert.equal(a.status, 200, JSON.stringify(a.j));
  assert.equal(a.j.picture.cost_usd, 0.0731); assert.equal(a.j.month_usd, 0.07);
  const b = calls[0];
  assert.deepEqual(b.provider, { zdr: true, data_collection: "deny", allow_fallbacks: false });
  assert.equal(b.image_config.aspect_ratio, "3:2");   // 1440 × 900 is 1,6: nearer 3:2 than 16:9 assert.deepEqual(b.modalities, ["image", "text"]);
  assert.equal(b.messages[0].content[1].image_url.url, shot); assert.match(b.messages[0].content[0].text, /kveldslys$/);
  /* the next estimate is the dearest this model has cost, not the list price */
  assert.equal((await get("/api/gjengi?versjon=vAbcdefgh", "lars")).j.estimate_usd, 0.08);
  const r = await fetch(`${O}/${a.j.picture.download}`); assert.equal(r.status, 200); assert.match(r.headers.get("content-disposition"), /attachment; filename="sykehustomta-/);
  assert.equal((await r.arrayBuffer()).byteLength, 5000, "full size, as the model made it");
});

test("the cap is kept before the call: past it, a refusal that says so and no request to the model", async () => {
  const n = calls.length;
  const a = await post("/api/gjengi", { image: shot, versjon: "vAbcdefgh", shown_usd: 0.08 }, "lars");
  assert.equal(a.status, 200);   // 0.0731 + 0.08 ≤ 0.2
  const b = await post("/api/gjengi", { image: shot, versjon: "vAbcdefgh", shown_usd: 0.08 }, "lars");
  assert.equal(b.status, 402); assert.match(b.j.error, /Månedens grense for bilder er nådd: \$0\.15 av \$0\.20/);
  assert.equal(calls.length, n + 1, "the refused one never reached OpenRouter");
  const s = (await get("/api/gjengi?versjon=vAbcdefgh", "lars")).j;
  assert.equal(s.left_usd, 0.05); assert.equal(s.pictures.length, 2);
});

test("favourites: by its maker or the version's owner only, first in the list; a picture is seen only with its work", async () => {
  const list = (await get("/api/gjengi?versjon=vAbcdefgh", "lars")).j.pictures, older = list.at(-1);
  assert.equal((await post(`/api/gjengi/${older.id}/favoritt`, { on: true }, "mia")).status, 403);
  assert.equal((await post(`/api/gjengi/${older.id}/favoritt`, { on: true }, "lars")).j.picture.fav, true);
  assert.equal((await get("/api/gjengi?versjon=vAbcdefgh", "lars")).j.pictures[0].id, older.id);
  assert.deepEqual((await get("/api/gjengi?versjon=vAbcdefgh", "mia")).j.pictures, [], "another's private version shows none");
});
