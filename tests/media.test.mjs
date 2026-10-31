/* U4007: sykehus lists a kept picture in gulden-ai's media registry, fire and forget; a failed call never touches the picture */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createMedia } from "../media.mjs";
import { createRenderings } from "../gjengi.mjs";

const wait = async f => { for (let i = 0; i < 100 && !f(); i++) await new Promise(r => setTimeout(r, 20)); };

test("a picture is posted to /internal/media with the door's bearer and its own numbers", async () => {
  const seen = [];
  const media = createMedia({ login: { base: "http://anton:8000", bearer: "tok" }, fetchImpl: async (u, o) => { seen.push([u, o]); return { status: 200 }; } });
  const bytes = Buffer.alloc(3000, 5);
  media.picture("render/r1", "lars", "person", "local://sykehus/render/r1.jpg", bytes, "jpg");
  await wait(() => seen.length);
  const [u, o] = seen[0], b = JSON.parse(o.body);
  assert.equal(u, "http://anton:8000/internal/media"); assert.equal(o.headers.authorization, "Bearer tok");
  assert.deepEqual(b, { app: "sykehus", ref: "render/r1", owner: "lars", access: "person", kind: "picture", source: "local://sykehus/render/r1.jpg", bytes: 3000,
    sha256: createHash("sha256").update(bytes).digest("hex"), mime: "image/jpeg", width: null, height: null });
});

test("no door, or a door that is down: nothing thrown, nothing posted without a door", async () => {
  let n = 0;
  createMedia({ login: { base: "", bearer: "" }, fetchImpl: async () => { n++; return { status: 200 }; } }).picture("p/1", "lars", "person", "local://x", Buffer.alloc(9), "png");
  createMedia({ login: { base: "http://x", bearer: "t" }, fetchImpl: async () => { n++; throw new Error("down"); } }).picture("p/2", "lars", "person", "local://x", Buffer.alloc(9), "png");
  await wait(() => n);
  assert.equal(n, 1, "only the configured one called, and its failure was swallowed");
});

test("a kept Gjengi render is registered under render/<its id> by the person who made it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sykehus-media-")), posted = [];
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 900 >> 8, 900 & 255, 1440 >> 8, 1440 & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]), Buffer.alloc(2048, 7)]);
  const shot = "data:image/jpeg;base64," + jpeg.toString("base64");
  const fetchImpl = async url => String(url).includes("/models") ? { ok: true, json: async () => ({ data: [] }) }
    : { ok: true, status: 200, json: async () => ({ choices: [{ message: { images: [{ image_url: { url: "data:image/png;base64," + Buffer.alloc(5000, 9).toString("base64") } }] } }], usage: { cost: 0.07 } }) };
  const versions = { get: id => id === "vAbcdefgh" ? { id, owner: "lars" } : null, visible: (v, who) => v.owner === who };
  const login = { personOf: req => req.headers["x-who"] ? { person: req.headers["x-who"] } : null };
  const readJson = req => new Promise((ok, no) => { const p = []; req.on("data", c => p.push(c)); req.on("end", () => { try { ok(JSON.parse(Buffer.concat(p))); } catch (e) { no(e); } }); });
  const media = { picture: (...a) => posted.push(a) };
  const g = createRenderings({ dir, key: "k", cap: 5, size: "1K", readJson, login, versions, fetchImpl, media });
  const srv = createServer(async (req, res) => { const url = new URL(req.url, "http://x"); if (!(await g.route(req, res, url.pathname, url))) res.writeHead(404).end(); }).listen(0);
  after(() => srv.close());
  const r = await fetch(`http://localhost:${srv.address().port}/api/gjengi`, { method: "POST", headers: { "content-type": "application/json", "x-who": "lars" }, body: JSON.stringify({ image: shot, versjon: "vAbcdefgh", shown_usd: 0.08 }) });
  const j = await r.json(); assert.equal(r.status, 200, JSON.stringify(j));
  assert.equal(posted.length, 1);
  const [ref, owner, access, source, bytes, ext] = posted[0];
  assert.equal(ref, `render/${j.picture.id}`); assert.equal(owner, "lars"); assert.equal(access, "person");
  assert.equal(source, `local://sykehus/render/${j.picture.id}.png`); assert.equal(bytes.length, 5000); assert.equal(ext, "png");
});
