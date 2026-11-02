/* «Gjengi» (U3526, U3982): the picture is made by gulden-ai's door (the signed-in person, no key or cap here), what a picture
   cost is OpenRouter's own figure as the door returns it, favourites and the full-size download; against the route over HTTP,
   the door a double that answers as gulden-ai's /internal/sykehus/picture does ({ image, model, cost_usd }) */
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
let answer = () => ({ image: "data:image/png;base64," + Buffer.alloc(5000, 9).toString("base64"), media_type: "image/png", model: "google/gemini-3.1-flash-image", cost_usd: 0.0731 });
/* gulden-ai's picture door (U3982): the bearer, the person, the view; the answer is the picture as a data URL with the stated cost.
   The pricing list is OpenRouter's public one, read only for the estimate. */
let refuse = null;
async function fetchImpl(url, opt = {}) {
  if (String(url).includes("/models")) return { ok: true, json: async () => ({ data: [{ id: "google/gemini-3.1-flash-image", pricing: { prompt: "0.0000005", completion: "0.000003", image_output: "0.00006" } }] }) };
  assert.equal(url, "http://gulden-ai:8000/internal/sykehus/picture");
  assert.equal(opt.headers.authorization, "Bearer door-token");
  const b = JSON.parse(opt.body); calls.push(b);
  if (refuse) return { ok: false, status: 402, json: async () => refuse };
  return { ok: true, status: 200, json: async () => answer(b) };
}
const versions = { get: id => id === "vAbcdefgh" ? { id, owner: "lars", sharing: "privat", own: "egen" } : null, visible: (v, who, key) => v.owner === who || key === v.own };
const login = { personOf: req => req.headers["x-who"] ? { person: req.headers["x-who"] } : null };
const readJson = req => new Promise((ok, no) => { const p = []; req.on("data", c => p.push(c)); req.on("end", () => { try { ok(JSON.parse(Buffer.concat(p))); } catch (e) { no(e); } }); });
const g = createRenderings({ dir, base: "http://gulden-ai:8000", token: "door-token", size: "1K", readJson, login, versions, fetchImpl });
const srv = createServer(async (req, res) => { const url = new URL(req.url, "http://x"); if (!(await g.route(req, res, url.pathname, url))) res.writeHead(404).end(); }).listen(0);
after(() => srv.close());
const O = `http://localhost:${srv.address().port}`;
const post = (p, body, who) => fetch(O + p, { method: "POST", headers: { "content-type": "application/json", ...(who ? { "x-who": who } : {}) }, body: JSON.stringify(body) }).then(async r => ({ status: r.status, j: await r.json() }));
const get = (p, who) => fetch(O + p, { headers: who ? { "x-who": who } : {} }).then(async r => ({ status: r.status, j: await r.json() }));

test("the price before, then one picture sent to gulden-ai's door as the signed-in person: the stated cost kept, no key or cap here", async () => {
  const s = await get("/api/gjengi?versjon=vAbcdefgh", "lars");
  assert.equal(s.j.signed_in, true); assert.equal(s.j.on, true); assert.equal(s.j.cap_usd, null, "the caps are gulden-ai's"); assert.equal(s.j.left_usd, null); assert.equal(s.j.month_usd, 0);
  assert.equal(s.j.estimate_usd, 0.1, "the model is not known before the first picture: the 1K fallback");
  assert.equal((await post("/api/gjengi", { image: shot, versjon: "vAbcdefgh" })).status, 401, "signed out: nothing is made");
  assert.equal(calls.length, 0);
  const a = await post("/api/gjengi", { image: shot, versjon: "vAbcdefgh", wish: "kveldslys", shown_usd: 0.1 }, "lars");
  assert.equal(a.status, 200, JSON.stringify(a.j));
  assert.equal(a.j.picture.cost_usd, 0.0731); assert.equal(a.j.month_usd, 0.07);
  const b = calls[0];
  assert.deepEqual(Object.keys(b).sort(), ["aspect", "image", "person", "prompt", "size"], "what crosses to gulden-ai: no key, no model, no routing");
  assert.equal(b.person, "lars"); assert.equal(b.size, "1K");
  assert.equal(b.aspect, "3:2");   // 1440 × 900 is 1,6: nearer 3:2 than 16:9
  assert.equal(b.image, shot); assert.match(b.prompt, /kveldslys$/);
  /* the next estimate is the dearest this model has cost, not the fallback */
  assert.equal((await get("/api/gjengi?versjon=vAbcdefgh", "lars")).j.estimate_usd, 0.08);
  const r = await fetch(`${O}/${a.j.picture.download}`); assert.equal(r.status, 200); assert.match(r.headers.get("content-disposition"), /attachment; filename="sykehustomta-/);
  assert.equal((await r.arrayBuffer()).byteLength, 5000, "full size, as the model made it");
});

test("a person or door over its cap: gulden-ai's sentence reaches the page as a 402 and nothing is kept", async () => {
  const n = (await get("/api/gjengi?versjon=vAbcdefgh", "lars")).j.pictures.length;
  refuse = { error: "person_cap", message: "Du har brukt opp kvoten din (USD 10 av 10), så jeg stopper her. Be Morten om mer." };
  const b = await post("/api/gjengi", { image: shot, versjon: "vAbcdefgh", shown_usd: 0.08 }, "lars");
  refuse = null;
  assert.equal(b.status, 402); assert.match(b.j.error, /Du har brukt opp kvoten din/);
  assert.equal((await get("/api/gjengi?versjon=vAbcdefgh", "lars")).j.pictures.length, n);
  const a = await post("/api/gjengi", { image: shot, versjon: "vAbcdefgh", shown_usd: 0.08 }, "lars");
  assert.equal(a.status, 200); assert.equal((await get("/api/gjengi?versjon=vAbcdefgh", "lars")).j.pictures.length, 2);
});

test("favourites: by its maker or the version's owner only, first in the list; a picture is seen only with its work", async () => {
  const list = (await get("/api/gjengi?versjon=vAbcdefgh", "lars")).j.pictures, older = list.at(-1);
  assert.equal((await post(`/api/gjengi/${older.id}/favoritt`, { on: true }, "mia")).status, 403);
  assert.equal((await post(`/api/gjengi/${older.id}/favoritt`, { on: true }, "lars")).j.picture.fav, true);
  assert.equal((await get("/api/gjengi?versjon=vAbcdefgh", "lars")).j.pictures[0].id, older.id);
  assert.deepEqual((await get("/api/gjengi?versjon=vAbcdefgh", "mia")).j.pictures, [], "another's private version shows none");
});

test("U4117: the picture list carries the registry's alt for a render that has one, the others keep none", async () => {
  const asked = [], made = [];
  const g2 = createRenderings({ dir: mkdtempSync(join(tmpdir(), "sykehus-gjengi-alt-")), base: "http://gulden-ai:8000", token: "door-token", size: "1K", readJson, login, versions, fetchImpl,
    media: { picture: (ref) => made.push(ref), forget() {}, alts: async refs => { asked.push(refs); return { [refs[0]]: "En rød mursteinsbygning mot blå himmel" }; } } });
  const s2 = createServer(async (req, res) => { const url = new URL(req.url, "http://x"); if (!(await g2.route(req, res, url.pathname, url))) res.writeHead(404).end(); }).listen(0);
  after(() => s2.close());
  const P = `http://localhost:${s2.address().port}`, hdr = { "content-type": "application/json", "x-who": "lars" };
  for (let i = 0; i < 2; i++) { const r = await fetch(P + "/api/gjengi", { method: "POST", headers: hdr, body: JSON.stringify({ image: shot, versjon: "vAbcdefgh", shown_usd: 0.1 }) }); assert.equal(r.status, 200, JSON.stringify(await r.json())); }
  const list = (await (await fetch(P + "/api/gjengi?versjon=vAbcdefgh", { headers: hdr })).json()).pictures;
  assert.equal(list.length, 2); assert.deepEqual(asked, [list.map(p => `render/${p.id}`)]);
  assert.equal(list[0].alt, "En rød mursteinsbygning mot blå himmel"); assert.ok(!("alt" in list[1]));
});
