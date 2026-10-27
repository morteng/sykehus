/* Gjengi's light: the prompt says where the sun is (height, side against the camera, where shadows fall, the colour of the light) and the materials in view,
   in this order: geometry lock, light, materials, camera, people. No model is called: the fetch is a stub and the assertions are on the prompt text
   that crosses it. Azimuth and elevation are checked against an independent computation (NOAA's fractional-year method, not the app's sunPosition). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRenderings, promptPreview, materialsOf } from "../gjengi.mjs";
import { sunGeometry, bearingOf } from "../public/sunlight.js";
import { LOOKS } from "../public/photo-set.js";

const LAT = 59.74, LON = 10.2, R = Math.PI / 180;
/* NOAA: local clock time in Oslo (UTC+1, +2 in summer time) -> { az, el } */
function noaa(y, m, d, hour, dst) {
  const doy = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 0)) / 864e5), utc = hour - (dst ? 2 : 1);
  const g = 2 * Math.PI / 365 * (doy - 1 + (utc - 12) / 24);
  const eqt = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const dec = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const ha = ((utc * 60 + eqt + 4 * LON) / 4 - 180) * R, la = LAT * R;
  const el = Math.asin(Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(ha));
  const az = Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(la) - Math.tan(dec) * Math.cos(la)) / R + 180;
  return { az: (az + 360) % 360, el: el / R };
}
const Y = new Date().getFullYear();
test("azimuth and elevation at Drammen against an independent computation, DST included", () => {
  for (const [m, d, h, dst] of [[6, 21, 13.5, true], [6, 21, 21.5, true], [6, 21, 6, true], [10, 15, 17.5, true], [12, 21, 12, false], [3, 15, 10, false], [9, 22, 15, true], [1, 15, 9, false]]) {
    const a = noaa(Y, m, d, h, dst), g = sunGeometry({ sunM: m, sunD: d, sunH: h }, 0, Y);
    assert.ok(Math.abs(g.elevation - a.el) < 1, `${d}.${m} ${h}: elevation ${g.elevation} vs ${a.el.toFixed(1)}`);
    if (a.el > 0) assert.ok(Math.abs(wrap(g.azimuth - a.az)) < 2, `${d}.${m} ${h}: azimuth ${g.azimuth} vs ${a.az.toFixed(1)}`);
  }
  const noon = sunGeometry({ sunM: 6, sunD: 21, sunH: 13.5 }, 0, Y);   // solar noon is about 13:20 summer time
  assert.ok(Math.abs(noon.elevation - (90 - LAT + 23.44)) < 1, `solar noon on 21 June is 53.7 degrees: ${noon.elevation}`);
  assert.ok(Math.abs(noon.azimuth - 180) < 5, `az ${noon.azimuth}`);
});
const wrap = d => ((d % 360) + 540) % 360 - 180;

test("the camera's compass way from the viewer's yaw", () => {
  assert.equal(bearingOf("øyehøyde", 0), 0);                                  // yaw 0 stands south and looks north
  assert.ok(Math.abs(bearingOf("øyehøyde", -Math.PI / 2) - 90) < 1e-9);       // looks along (-sin yaw, cos yaw): yaw -90 looks east
  assert.ok(Math.abs(bearingOf("fugleperspektiv", Math.PI / 2) - 270) < 1e-9);
  assert.ok(Math.abs(bearingOf("aksonometri", 2) - 330) < 1e-9);              // turned 30 degrees, whatever the yaw
  assert.equal(bearingOf("øyehøyde", null), null);
});

const mats = [{ name: "nglasssor", material: "glass" }, { name: "Basseng", material: "water" }, { name: "Fløy", material: "brick" }];
const at = (sunM, sunD, sunH, look = "arkitektfoto", bearing = 180, extra = {}) => ({ viewpoint: "øyehøyde", look, lens: 24, sunM, sunD, sunH, bearing, materials: mats, ...extra });
const GEO = "This image is a view of a 3D model of a site";
const order = (t, ...parts) => { let at = -1; for (const p of parts) { const i = t.indexOf(p); assert.ok(i > at, `"${p}" must come after the one before it`); at = i; } };

/* the stub fetch: what crosses the boundary is the text part of the message */
const calls = [];
const png = "data:image/png;base64," + Buffer.alloc(5000, 9).toString("base64");
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 900 >> 8, 900 & 255, 1440 >> 8, 1440 & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]), Buffer.alloc(2048, 7)]);
const shot = "data:image/jpeg;base64," + jpeg.toString("base64");
const g = createRenderings({ dir: mkdtempSync(join(tmpdir(), "sykehus-gjlight-")), key: "k", cap: 100, size: "1K", readJson: async () => ({}), login: { personOf: () => ({ person: "lars" }) }, versions: null,
  fetchImpl: async (url, opt = {}) => { if (String(url).includes("/models")) return { ok: true, json: async () => ({ data: [] }) }; const b = JSON.parse(opt.body); calls.push(b); return { ok: true, status: 200, json: async () => ({ choices: [{ message: { images: [{ image_url: { url: png } }] } }], usage: { cost: 0.05 } }) }; } });
const sent = async body => { const n = calls.length; await g.make({ image: shot, work: "utkast:abcdef", ...body }, "lars"); assert.equal(calls.length, n + 1); return calls[n]; };
const textOf = b => b.messages[0].content[0].text;

test("sunset 21 June 21:30, arkitektfoto, camera looking south: low sun behind the camera on the right, shadows away and to the left, warm; no 'crisp daylight'", async () => {
  const b = await sent(at(6, 21, 21.5)), t = textOf(b);
  assert.deepEqual(b.provider, { zdr: true, data_collection: "deny", allow_fallbacks: false });
  assert.ok(t.startsWith(GEO), "the geometry lock is first");
  assert.match(t, /5\.6 degrees above the horizon \(low\), in the north-west: behind the camera on the right/);
  assert.match(t, /Very long shadows fall away from the viewer and to the left/);
  assert.match(t, /Golden hour: warm orange-gold low light, long soft shadows/);
  assert.match(t, /keep their direction and do not relight from another side/);
  assert.doesNotMatch(t, /crisp daylight/i); assert.doesNotMatch(t, /daylight, neutral colour/);
  assert.match(t, /neutral white balance for the light described/);
  order(t, GEO, "Light, which decides", "Materials in view", "Camera (", "Planting:");
  assert.match(t, /glass \(nglasssor\), reflecting the warm sky/); assert.match(t, /water \(Basseng\), mirroring the sky/); assert.match(t, /brick \(Fløy\), visible brick courses/);
});

test("sunset 15 October 17:30, looking west with the sun ahead on the left: backlit, shadows toward the viewer and to the right; another look says no time of day of its own", async () => {
  for (const look of ["arkitektfoto", "konkurransebilde", "hvitmodell", "drone"]) {
    const t = textOf(await sent(at(10, 15, 17.5, look, 270)));
    assert.match(t, /4 degrees above the horizon \(low\), in the south-west: ahead and to the left, a mostly backlit view/, look);
    assert.match(t, /Very long shadows fall toward the viewer and to the right/, look);
    assert.match(t, /Golden hour/, look); assert.doesNotMatch(t, /crisp daylight/, look); assert.ok(t.startsWith(GEO));
  }
  for (const k of Object.keys(LOOKS)) assert.doesNotMatch(LOOKS[k].style + (LOOKS[k].flat || ""), /daylight|blue hour|soft (light|shadows)|soft light/i, `the look ${k} states no light of its own`);
});

test("noon: a high sun, hard white light, short shadows; the side follows the camera", async () => {
  const south = textOf(await sent(at(6, 21, 13.5, "arkitektfoto", 0)));   // looking north, the sun in the south
  assert.match(south, /53\.7 degrees above the horizon \(high\), in the south: straight behind the camera, so the view is front-lit/);
  assert.match(south, /Short shadows fall away from the viewer/); assert.match(south, /High sun: hard white light/); assert.doesNotMatch(south, /Golden hour|warm orange/);
  const north = textOf(await sent(at(6, 21, 13.5, "arkitektfoto", 180)));   // looking south, into the sun
  assert.match(north, /straight ahead, so the view is backlit/); assert.match(north, /Short shadows fall toward the viewer/);
  const east = textOf(await sent(at(6, 21, 13.5, "arkitektfoto", 90)));
  assert.match(east, /to the right, side light from the right/); assert.match(east, /Short shadows fall sideways to the left/);
});

test("night and blue hour: artificial light only, no daylight shadows kept; glass shows the lit interior", async () => {
  const night = textOf(await sent(at(12, 15, 23)));
  assert.match(night, /night, a dark sky, no daylight and no cast shadows, only artificial light/); assert.doesNotMatch(night, /keep their direction/);
  assert.match(night, /do not keep them/); assert.match(night, /glass \(nglasssor\), dark, reflecting the sky glow, the warm lit interior showing through/); assert.match(night, /water \(Basseng\), a dark mirror/);
  assert.ok(night.startsWith(GEO));
  const dusk = textOf(await sent(at(1, 15, 9)));
  assert.match(dusk, /blue hour, a deep blue sky/); assert.match(dusk, /warm lit windows/);
  /* the person's own ask for blue hour is honoured at noon: warn only, never refused */
  const asked = textOf(await sent(at(6, 21, 13.5, "blåtime")));
  assert.match(asked, /blue hour/); assert.ok(asked.startsWith(GEO));
});

test("what the page sends is sanitised: bearing 0-360, a bad sun is the default's, materials sliced to 12 and to known shapes; no bearing, no side said", () => {
  const t = promptPreview(at(6, 21, 13.5, "arkitektfoto", 540));   // 540 clamps to 360: looking north
  assert.match(t, /straight behind the camera/);   // looking north (360), the sun in the south
  assert.doesNotMatch(promptPreview({ ...at(6, 21, 13.5), bearing: undefined }), /behind the camera|ahead|side light|fall (toward|away|sideways)/);
  assert.match(promptPreview({ viewpoint: "øyehøyde", sunM: 99, sunD: 99, sunH: 99 }), /21\. June at 14:00/);
  const many = Array.from({ length: 30 }, (_, i) => ({ name: "x".repeat(100) + i, material: i % 2 ? "glass" : "Concrete" })).concat([{ name: "bad", material: "<script>" }, null, 7]);
  const list = materialsOf(many); assert.equal(list.length, 12); assert.ok(list.every(m => m.name.length <= 40 && /^[a-z_]+$/.test(m.material)));
  const fromSpot = promptPreview({ viewpoint: "øyehøyde", sunM: 6, sunD: 21, sunH: 13.5, spot: { pose: { x: 0, y: 0, h: 0, yaw: Math.PI, pitch: 0, dist: 100 } } });
  assert.match(fromSpot, /straight ahead, so the view is backlit/, "no bearing sent: it is read from the spot's yaw (yaw 180 degrees looks south, into the noon sun)");
  assert.match(promptPreview({ viewpoint: "øyehøyde", sunM: 6, sunD: 21, sunH: 13.5, wish: "kveldslys" }), /kveldslys$/);
});
