/* U3663 + U3665: the photo mode's lens and frame reach the viewer, a picture keeps its spot, a spot is flown to for free and taken
   again only for a press, and Anton's proposal makes nothing. The browser part is the e2e shots; here the logic that decides. Run: node --test tests/photomode.test.mjs */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRenderings, spotOf } from "../gjengi.mjs";
import { spotOfView, choiceOfSpot, flyTo, isStale, retakeBody, retake, total } from "../public/photospots.js";
import { frameFov, frameRect, viewFov, LENSES } from "../public/renderkit/photoframe.js";

const POSE = { x: 12.5, y: -40.25, h: 18, yaw: 0.8, pitch: 0.45, dist: 210, eye: false };
const SUN = { sunM: 12, sunD: 21, sunH: 15 };
const view = { pose: POSE, mm: 35, fov: frameFov(35, "3:2"), aspect: "3:2", look: "arkitektfoto", viewpoint: "fugleperspektiv", lens: "35", sun: SUN, version: "vAbcdefgh", n: 4 };

test("a spot holds the camera, the lens, the shape, the look, the light, the eye height, the version and its change count", () => {
  const s = spotOfView(view);
  assert.deepEqual(s.pose, POSE); assert.deepEqual([s.mm, s.aspect, s.look, s.lens, s.version, s.n, s.eyeh], [35, "3:2", "arkitektfoto", "35", "vAbcdefgh", 4, null]); assert.deepEqual(s.sun, SUN);
  assert.equal(spotOfView({ ...view, pose: { ...POSE, eye: true } }).eyeh, 1.7, "the person's eye is 1,7 m over the ground");
  assert.equal(spotOfView({ ...view, sun: null }).sun, null);
});
test("the lens' field of view and the frame reach the view: the frame's height spans the lens' angle for every lens", () => {
  for (const [id, L] of Object.entries(LENSES)) for (const a of ["3:2", "16:9", "1:1", "4:5", "2:3"]) {
    const H = 640, r = frameRect(1000, H, a), ff = frameFov(L.mm, a), vf = viewFov(ff, r, H);
    assert.ok(Math.abs(2 * Math.atan(Math.tan(vf * Math.PI / 360) * r.h / H) * 180 / Math.PI - ff) < 1e-9, `${id} ${a}`);
  }
  assert.ok(frameFov(24, "3:2") > frameFov(85, "3:2"));
});
test("flying to a spot puts the camera exactly where it was (the viewer's pose) and the light as it was; nothing else", () => {
  const s = spotOfView(view), to = [], suns = [];
  const c = flyTo(s, { fly: p => to.push(p), setSun: x => suns.push(x) });
  assert.deepEqual(to, [POSE]); assert.deepEqual(suns, [SUN]); assert.deepEqual(c.pose, POSE); assert.notEqual(c.pose, s.pose, "a copy: the card cannot change the spot");
  assert.deepEqual([c.lens, c.mm, c.aspect, c.look], ["35", 35, "3:2", "arkitektfoto"]);
  assert.deepEqual(choiceOfSpot(s).sun, SUN);
});
test("a retake reuses the spot: the same camera, lens, shape, look and light, tied to the picture it retakes", () => {
  const p = { id: "abcdefghijklmnop", spot: spotOfView(view) }, b = retakeBody(p, { size: "2K" });
  assert.deepEqual([b.viewpoint, b.look, b.lens, b.aspect, b.sunM, b.sunD, b.sunH, b.retake_of, b.size], ["fugleperspektiv", "arkitektfoto", 35, "3:2", 12, 21, 15, "abcdefghijklmnop", "2K"]); assert.deepEqual(b.spot, p.spot);
});
test("no retake without a press: nothing is made and nothing is asked for", async () => {
  let made = 0; const make = async () => { made++; };
  for (const c of [undefined, false, "yes", 1, null]) await assert.rejects(retake([{ id: 1 }], { confirmed: c, make }), e => e.code === "needs_press");
  assert.equal(made, 0);
  await retake([{ id: 1 }, { id: 2 }], { confirmed: true, make }); assert.equal(made, 2);
  assert.equal(total(3, 0.12), 0.36);
});
test("the model changed: a saved version says it by its clock, a draft by its change count", () => {
  assert.equal(isStale({ stale: true, spot: { n: 4 } }, 4), true); assert.equal(isStale({ stale: false, spot: { n: 3 } }, 9), false, "the server's clock wins");
  assert.equal(isStale({ stale: null, spot: { n: 4 } }, 6), true); assert.equal(isStale({ stale: null, spot: { n: 4 } }, 4), false); assert.equal(isStale({ stale: null, spot: { n: null } }, 4), false);
});
test("the server keeps only numbers and known words of a spot", () => {
  const s = spotOf({ ...view, look: "<script>", mm: 9999, aspect: "7:1", sun: { sunM: 13, sunD: 1, sunH: 1 }, extra: "x" });
  assert.equal(s.look, null); assert.equal(s.mm, 200); assert.equal(s.aspect, null); assert.equal(s.sun, null); assert.ok(!("extra" in s));
  assert.equal(spotOf({ pose: { x: "a" } }), null); assert.equal(spotOf(null), null);
});

/* the route: a picture keeps its spot beside it; a retake is tied to it */
const dir = mkdtempSync(join(tmpdir(), "sykehus-photo-"));
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 900 >> 8, 900 & 255, 1440 >> 8, 1440 & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]), Buffer.alloc(2048, 7)]);
const shot = "data:image/jpeg;base64," + jpeg.toString("base64"), calls = [];
async function fetchImpl(url, opt = {}) {
  if (String(url).includes("/models")) return { ok: true, json: async () => ({ data: [] }) };
  calls.push(JSON.parse(opt.body)); return { ok: true, status: 200, json: async () => ({ choices: [{ message: { images: [{ image_url: { url: "data:image/png;base64," + Buffer.alloc(5000, 9).toString("base64") } }] } }], usage: { cost: 0.05 }, provider: "Google" }) };
}
let updated = "2026-10-26T10:00:00.000Z";
const versions = { get: id => id === "vAbcdefgh" ? { id, owner: "lars", sharing: "privat", own: "egen", updated } : null, visible: (v, who) => v.owner === who };
const login = { personOf: req => req.headers["x-who"] ? { person: req.headers["x-who"] } : null };
const readJson = req => new Promise((ok, no) => { const p = []; req.on("data", c => p.push(c)); req.on("end", () => { try { ok(JSON.parse(Buffer.concat(p))); } catch (e) { no(e); } }); });
const g = createRenderings({ dir, key: "k", cap: 5, size: "1K", readJson, login, versions, fetchImpl, now: () => new Date("2026-10-26T12:00:00Z") });
const srv = createServer(async (req, res) => { const url = new URL(req.url, "http://x"); if (!(await g.route(req, res, url.pathname, url))) res.writeHead(404).end(); }).listen(0);
after(() => srv.close());
const O = `http://localhost:${srv.address().port}`;
const post = (p, body, who) => fetch(O + p, { method: "POST", headers: { "content-type": "application/json", ...(who ? { "x-who": who } : {}) }, body: JSON.stringify(body) }).then(async r => ({ status: r.status, j: await r.json() }));
const get = (p, who) => fetch(O + p, { headers: who ? { "x-who": who } : {} }).then(async r => ({ status: r.status, j: await r.json() }));

test("a picture keeps its spot with every field, asked for in the frame's shape; the list says who's it is", async () => {
  const a = await post("/api/gjengi", { image: shot, versjon: "vAbcdefgh", size: "1K", shown_usd: 1, aspect: "4:5", spot: { ...view, aspect: "4:5" } }, "lars");
  assert.equal(a.status, 200, JSON.stringify(a.j)); assert.equal(calls.at(-1).image_config.aspect_ratio, "4:5", "the frame's shape is the picture's");
  const s = a.j.picture.spot; assert.deepEqual(s.pose, POSE); assert.deepEqual([s.mm, s.aspect, s.look, s.viewpoint, s.lens, s.version, s.n], [35, "4:5", "arkitektfoto", "fugleperspektiv", "35", "vAbcdefgh", 4]); assert.deepEqual(s.sun, SUN); assert.ok(Math.abs(s.fov - frameFov(35, "3:2")) < 1e-9);
  const l = (await get("/api/gjengi?versjon=vAbcdefgh", "lars")).j.pictures; assert.equal(l.length, 1); assert.equal(l[0].mine, true); assert.deepEqual(l[0].spot.pose, POSE);
  assert.equal(JSON.parse(readFileSync(join(dir, "index.json"), "utf8")).at(-1).spot.pose.yaw, 0.8, "kept on the server beside the picture");
  assert.equal(l[0].stale, false, "the version was saved before the picture");
  updated = "2026-10-26T13:00:00.000Z"; assert.equal((await get("/api/gjengi?versjon=vAbcdefgh", "lars")).j.pictures[0].stale, true, "the version was saved after: the model has changed");
});
test("a retake is a new picture from the same spot, tied to the first, and the spots list holds the originals only", async () => {
  const first = (await get("/api/gjengi?versjon=vAbcdefgh", "lars")).j.pictures[0], n = calls.length;
  const b = await post("/api/gjengi", { image: shot, versjon: "vAbcdefgh", size: "1K", shown_usd: 1, spot: first.spot, retake_of: first.id, aspect: first.spot.aspect }, "lars");
  assert.equal(b.status, 200); assert.equal(calls.length, n + 1); assert.equal(b.j.picture.retake_of, first.id); assert.deepEqual(b.j.picture.spot, first.spot);
  assert.deepEqual(g.spotsOf("lars").map(r => r.id), [first.id]); assert.deepEqual(g.spotsOf("mia"), []);
  const stranger = await post("/api/gjengi", { image: shot, versjon: "vAbcdefgh", size: "1K", shown_usd: 1, spot: first.spot, retake_of: first.id }, "lars"); assert.equal(stranger.status, 200);
});
test("Anton's proposal makes nothing: the model is not called and the month's spend is as it was, until the person presses", async () => {
  const [first] = g.spotsOf("lars"), n = calls.length, before = (await get("/api/gjengi?versjon=vAbcdefgh", "lars")).j;
  g.propose("lars", [first.id]);
  const s = (await get("/api/gjengi?versjon=vAbcdefgh", "lars")).j;
  assert.deepEqual(s.retake, { ids: [first.id] }); assert.equal(calls.length, n); assert.equal(s.month_usd, before.month_usd); assert.equal(s.pictures.length, before.pictures.length);
  assert.equal((await get("/api/gjengi?versjon=vAbcdefgh", "mia")).j.retake, null, "another person sees no card");
  assert.equal((await post("/api/gjengi/proposal", {}, "lars")).status, 200); assert.equal((await get("/api/gjengi?versjon=vAbcdefgh", "lars")).j.retake, null);
});

/* Anton's tools, through the real server: they list and propose, never make */
const base = mkdtempSync(join(tmpdir(), "sykehus-photo-mcp-")), vdir = join(base, "v");
mkdirSync(join(vdir, "gjengi"), { recursive: true });
writeFileSync(join(vdir, "gjengi", "index.json"), JSON.stringify([{ id: "aaaaaaaaaaaaaaaa", at: "2026-10-25T10:00:00.000Z", by: "lars", work: "versjon:vAbcdefgh", model: "m", size: "1K", ext: "png", cost_usd: 0.07, est_usd: 0.07, spot: spotOf(view), fav: false },
  { id: "bbbbbbbbbbbbbbbb", at: "2026-10-25T11:00:00.000Z", by: "mia", work: "utkast:xyzxyzxy", model: "m", size: "1K", ext: "png", cost_usd: 0.07, est_usd: 0.07, spot: spotOf(view), fav: false }]));
const secret = "proxy-secret-for-tests-0123456789", PORT = 9900 + Math.floor(Math.random() * 90), M = `http://localhost:${PORT}`;
const sv = spawn(process.execPath, [new URL("../server.mjs", import.meta.url).pathname], { env: { ...process.env, PORT: String(PORT), SYKEHUS_VERSIONS_DIR: vdir, SYKEHUS_PROXY_SECRET: secret, SYKEHUS_OPENROUTER_API_KEY: "test-key", DOCS: "" }, stdio: ["ignore", "pipe", "inherit"] });
await new Promise(ok => sv.stdout.on("data", d => String(d).includes("Sykehustomta on") && ok()));
after(() => sv.kill());
const rpc = async (method, params, who = "lars") => (await (await fetch(M + "/mcp", { method: "POST", headers: { "content-type": "application/json", "remote-user": who, "x-sykehus-proxy-auth": secret }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })).json()).result;
const text = r => r.content.filter(c => c.type === "text").map(c => c.text).join(" ");
test("Anton lists the person's own spots, and retake_photos only proposes: the card's count and total price, not a picture", async () => {
  const tools = (await rpc("tools/list")).tools; assert.ok(tools.some(t => t.name === "photo_spots") && tools.some(t => t.name === "retake_photos"));
  assert.match(tools.find(t => t.name === "retake_photos").description, /NOTHING/);
  const l = (await rpc("tools/call", { name: "photo_spots", arguments: {} })).structuredContent; assert.deepEqual(l.spots.map(s => s.id), ["aaaaaaaaaaaaaaaa"], "only the asker's");
  assert.deepEqual([l.spots[0].look, l.spots[0].lens_mm, l.spots[0].aspect], ["arkitektfoto", 35, "3:2"]);
  const r = await rpc("tools/call", { name: "retake_photos", arguments: { spots: ["aaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbb"] } }); assert.ok(!r.isError, text(r));
  assert.equal(r.structuredContent.proposed, 1, "another person's spot is not taken"); assert.equal(r.structuredContent.total_usd, r.structuredContent.each_usd);
  assert.match(r.structuredContent.said, /1 bilde · ca\. \$/);
  const s = await (await fetch(`${M}/api/gjengi?utkast=zzzzzzzz`, { headers: { "remote-user": "lars", "x-sykehus-proxy-auth": secret } })).json();
  assert.deepEqual(s.retake, { ids: ["aaaaaaaaaaaaaaaa"] }); assert.equal(s.month_usd, 0.14, "nothing spent by the proposal (the two seeded pictures, October)");
  assert.equal((await rpc("tools/call", { name: "retake_photos", arguments: { spots: ["bbbbbbbbbbbbbbbb"] } })).isError, true);
});
