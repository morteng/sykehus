/* U3652: Gjengi's camera: the viewpoint and look a view has by itself, the lens' field of view, the prompt line, the size
   and shape in the request (one image call a picture, the estimate by size), and Anton's show_building camera and look */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { VIEWPOINTS, LOOKS, SIZES, viewpointFor, lookFor, shotOf, fovFor, promptLine } from "../public/gjengicam.js";
import { createRenderings } from "../gjengi.mjs";

test("the viewpoint and the look a view has by itself, and never froskeperspektiv", () => {
  assert.equal(viewpointFor({ mode: "3d", eye: true, dist: 30 }), "øyehøyde"); assert.equal(viewpointFor({ mode: "3d", dist: 90 }), "øyehøyde");
  assert.equal(viewpointFor({ mode: "3d", dist: 380 }), "fugleperspektiv"); assert.equal(viewpointFor({ mode: "plan", dist: 380 }), "aksonometri");
  assert.equal(viewpointFor({ mode: "section" }), "fasade");
  assert.deepEqual(Object.keys(VIEWPOINTS).map(v => [v, lookFor(v)]), [["øyehøyde", "arkitektfoto"], ["fugleperspektiv", "drone"], ["aksonometri", "hvitmodell"], ["fasade", "arkitektfoto"], ["froskeperspektiv", "arkitektfoto"]]);
  for (const d of [30, 90, 380]) for (const mode of ["3d", "plan", "section"]) assert.notEqual(viewpointFor({ mode, dist: d }), "froskeperspektiv");
  assert.deepEqual(Object.keys(LOOKS), ["arkitektfoto", "blåtime", "konkurransebilde", "drone", "hvitmodell", "skisse"]);
});

test("the lens sets the field of view; the look's shape and the line to the model", () => {
  assert.equal(Math.round(fovFor(24, [3, 2]) * 10) / 10, 53.1, "24 mm on a 3:2 frame: 2·atan(12/24)");
  assert.ok(fovFor(35, [16, 9]) < fovFor(24, [3, 2]) && fovFor(24, [2, 3]) > fovFor(24, [3, 2]), "longer lens narrower; a portrait frame is taller");
  const eye = shotOf({}, { mode: "3d", eye: true }); assert.deepEqual([eye.viewpoint, eye.look, eye.mm, eye.aspect, eye.eye], ["øyehøyde", "arkitektfoto", 24, "3:2", 1.6]);
  const air = shotOf({}, { mode: "3d", dist: 400 }); assert.deepEqual([air.viewpoint, air.look, air.mm, air.aspect], ["fugleperspektiv", "drone", 35, "16:9"]);
  const plan = shotOf({}, { mode: "plan" }); assert.deepEqual([plan.viewpoint, plan.look, plan.mm, plan.aspect], ["aksonometri", "hvitmodell", null, "1:1"], "parallel: no lens");
  const frog = shotOf({ viewpoint: "froskeperspektiv", lens: 17, eyeh: 0.4 }); assert.deepEqual([frog.mm, frog.eye, frog.aspect], [17, 0.4, "2:3"]);
  assert.equal(shotOf({ viewpoint: "øyehøyde", lens: 5 }).mm, 10, "a lens is held to 10-200 mm");
  assert.match(promptLine(eye), /^Eye-level view, two-point perspective, verticals corrected\. Architectural photograph, tilt-shift lens \(24 mm\)/);
  assert.match(promptLine(shotOf({ viewpoint: "øyehøyde", look: "blåtime" })), /blue hour.*warm lit windows/);
  assert.match(promptLine(shotOf({ viewpoint: "fugleperspektiv", lens: 28 })), /Aerial photograph, 28 mm lens/);
  assert.match(promptLine(plan), /White clay massing model/); assert.match(promptLine(shotOf({ look: "skisse" })), /watercolour/); assert.match(promptLine(shotOf({ look: "konkurransebilde" })), /people and planting/);
  for (const v of Object.keys(VIEWPOINTS)) for (const l of Object.keys(LOOKS)) assert.ok(promptLine(shotOf({ viewpoint: v, look: l })).length < 330, `${v}/${l}: one short line`);
});

/* the route: one image call a picture; the request carries the size, the look's shape and the camera line; the estimate differs by size */
const dir = mkdtempSync(join(tmpdir(), "sykehus-cam-"));
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 853 >> 8, 853 & 255, 1280 >> 8, 1280 & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]), Buffer.alloc(2048, 7)]);
const shot = "data:image/jpeg;base64," + jpeg.toString("base64"), calls = [];
async function fetchImpl(url, opt = {}) {
  if (String(url).includes("/models")) return { ok: true, json: async () => ({ data: [{ id: "google/gemini-3.1-flash-image", pricing: { prompt: "0.0000005", completion: "0.000003", image_output: "0.00006" } }] }) };
  calls.push(JSON.parse(opt.body));
  return { ok: true, status: 200, json: async () => ({ choices: [{ message: { images: [{ image_url: { url: "data:image/png;base64," + Buffer.alloc(5000, 9).toString("base64") } }] } }], usage: { cost: 0.11 } }) };
}
const versions = { get: id => id === "vAbcdefgh" ? { id, owner: "lars", sharing: "privat" } : null, visible: (v, who) => v.owner === who };
const login = { personOf: req => req.headers["x-who"] ? { person: req.headers["x-who"] } : null };
const readJson = req => new Promise((ok, no) => { const p = []; req.on("data", c => p.push(c)); req.on("end", () => { try { ok(JSON.parse(Buffer.concat(p))); } catch (e) { no(e); } }); });
const g = createRenderings({ dir, key: "k", cap: 5, readJson, login, versions, fetchImpl });
const srv = createServer(async (req, res) => { const url = new URL(req.url, "http://x"); if (!(await g.route(req, res, url.pathname, url))) res.writeHead(404).end(); }).listen(0);
after(() => srv.close());
const O = `http://localhost:${srv.address().port}`;
const post = (b) => fetch(O + "/api/gjengi", { method: "POST", headers: { "content-type": "application/json", "x-who": "lars" }, body: JSON.stringify(b) }).then(async r => ({ status: r.status, j: await r.json() }));

test("gjengi: the estimate by size, and one call whose body carries the size, the shape and the camera line", async () => {
  const s = (await (await fetch(`${O}/api/gjengi?versjon=vAbcdefgh`, { headers: { "x-who": "lars" } })).json());
  assert.deepEqual(s.sizes.map(z => z.id), Object.keys(SIZES)); assert.equal(s.default_size, "2K");
  const [k1, k2, k4] = s.sizes.map(z => z.estimate_usd); assert.ok(k1 < k2 && k2 < k4, `Utkast < Standard < Stor: ${k1} ${k2} ${k4}`);
  assert.equal(s.estimate_usd, k2, "the default is Standard");
  const a = await post({ image: shot, versjon: "vAbcdefgh", size: "4K", viewpoint: "froskeperspektiv", look: "blåtime", lens: 18, shown_usd: k4 });
  assert.equal(a.status, 200, JSON.stringify(a.j)); assert.equal(calls.length, 1, "one image call a picture");
  const b = calls[0];
  assert.deepEqual([b.image_config.image_size, b.image_config.aspect_ratio], ["4K", "2:3"], "the size chosen; the froskeperspektiv's portrait shape, not the picture's 3:2");
  assert.match(b.messages[0].content[0].text, /Low viewpoint looking up, two-point perspective.*blue hour.*\(18 mm\)/);
  assert.equal(b.messages[0].content[1].image_url.url, shot, "the view is still the only geometry");
  const cheap = await post({ image: shot, versjon: "vAbcdefgh", size: "1K", shown_usd: k1 }); assert.equal(cheap.status, 200);
  assert.equal(calls[1].image_config.image_size, "1K"); assert.equal(calls[1].image_config.aspect_ratio, "3:2", "no camera: the picture's own shape");
  assert.doesNotMatch(calls[1].messages[0].content[0].text, /Camera and look/);
  assert.equal((await post({ image: shot, versjon: "vAbcdefgh", size: "2K", shown_usd: 0.01 })).status, 409, "a price shown lower than the size's is refused");
});

/* Anton: show_building's camera and look */
const secret = "proxy-secret-for-tests-0123456789", PORT = 9100 + Math.floor(Math.random() * 800), M = `http://localhost:${PORT}`;
const sv = spawn(process.execPath, [new URL("../server.mjs", import.meta.url).pathname], { env: { ...process.env, PORT: String(PORT), SYKEHUS_VERSIONS_DIR: join(dir, "v"), SYKEHUS_PROXY_SECRET: secret, DOCS: "" }, stdio: ["ignore", "pipe", "inherit"] });
await new Promise(ok => sv.stdout.on("data", d => String(d).includes("Sykehustomta on") && ok()));
after(() => sv.kill());
const rpc = async (method, params) => (await (await fetch(M + "/mcp", { method: "POST", headers: { "content-type": "application/json", "remote-user": "lars", "x-sykehus-proxy-auth": secret }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })).json()).result;
const text = r => r.content.filter(c => c.type === "text").map(c => c.text).join(" ");

test("show_building: camera, look, lens and size in the event; the description names all five cameras and six looks", async () => {
  const tool = (await rpc("tools/list")).tools.find(t => t.name === "show_building");
  for (const w of ["øyehøyde", "fugleperspektiv", "aksonometri", "fasade", "froskeperspektiv", "arkitektfoto", "blåtime", "konkurransebilde", "drone", "hvitmodell", "skisse", "Trykk Gjengi for bildet", "utkast"]) assert.ok(tool.description.includes(w), w);
  assert.deepEqual(tool.inputSchema.properties.camera.enum, Object.keys(VIEWPOINTS)); assert.deepEqual(tool.inputSchema.properties.look.enum, Object.keys(LOOKS));
  const r = await rpc("tools/call", { name: "show_building", arguments: { wing: "Sentralblokka", from_direction: "S", camera: "froskeperspektiv", look: "blåtime", lens_mm: 20, eye_height_m: 0.5, picture_size: "stor", sun: { month: 12, day: 21, hour: 15 } } });
  assert.ok(!r.isError, text(r)); const v = r.structuredContent.view;
  assert.deepEqual([v.camera, v.look, v.lens, v.eyeh, v.gsize, v.sunM], ["froskeperspektiv", "blåtime", 20, 0.5, "4K", 12]);
  const bad = await rpc("tools/call", { name: "show_building", arguments: { camera: "skråfoto" } }); assert.equal(bad.isError, true); assert.match(text(bad), /finnes ikke.*øyehøyde/);
});
