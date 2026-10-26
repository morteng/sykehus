/* Models from open libraries (U3571 S4): what may be fetched and what not (pm 02:55Z), and the libraries read from
   answers given here, so no network is needed.
   node --test tests/fetchimport.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { allowed, privateIp, fetcherOf, libraries, FETCH_HOSTS } from "../fetchimport.mjs";

test("only https to the hosts on the list; github.com only for raw and release files; the rest a link", () => {
  assert.equal(allowed("https://raw.githubusercontent.com/FreeCAD/FreeCAD-library/master/a.step").ok, true);
  assert.equal(allowed("https://github.com/o/r/releases/download/v1/a.ifc").ok, true);
  assert.equal(allowed("https://github.com/o/r/raw/main/a.ifc").ok, true);
  assert.equal(allowed("https://github.com/o/r/blob/main/a.ifc").ok, false, "a page, not a file");
  assert.equal(allowed("http://raw.githubusercontent.com/a").ok, false, "not https");
  assert.equal(allowed("https://raw.githubusercontent.com:8443/a").ok, false, "no other port");
  assert.equal(allowed("https://user:pw@raw.githubusercontent.com/a").ok, false);
  assert.equal(allowed("https://example.com/greenhouse.ifc").ok, false, "off the list");
  assert.equal(allowed("https://raw.githubusercontent.com.evil.example/a").ok, false, "a lookalike");
  const b = allowed("https://www.bimobject.com/en/product/x"); assert.equal(b.ok, false); assert.equal(b.link.name, "BIMobject", "an account-gated library: its link");
  assert.deepEqual(FETCH_HOSTS.slice().sort(), ["api.polyhaven.com", "commons.wikimedia.org", "dl.polyhaven.org", "github.com", "objects.githubusercontent.com", "raw.githubusercontent.com", "upload.wikimedia.org"]);
});

test("private, loopback, link-local, CGNAT and the like are inside; public addresses are not", () => {
  for (const ip of ["10.1.2.3", "127.0.0.1", "169.254.169.254", "100.64.0.1", "100.127.255.255", "172.16.0.1", "172.31.9.9", "192.168.1.1", "0.0.0.0", "224.0.0.1", "198.18.0.1",
    "::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "::ffff:10.0.0.1", "::ffff:127.0.0.1", "ff02::1", "not-an-ip"]) assert.equal(privateIp(ip), true, ip);
  for (const ip of ["8.8.8.8", "185.199.108.133", "100.63.255.255", "100.128.0.1", "172.15.0.1", "172.32.0.1", "2606:4700::1111", "2a04:4e42::644"]) assert.equal(privateIp(ip), false, ip);
});

test("a host on the list whose name points inside is not fetched; one off the list is not even looked up", async () => {
  const asked = [];
  const f = fetcherOf((host, opts, cb) => { asked.push(host); cb(null, [{ address: "10.0.0.5", family: 4 }]); });
  await assert.rejects(f("https://raw.githubusercontent.com/FreeCAD/FreeCAD-library/master/a.step"), /intern adresse/);
  assert.deepEqual(asked, ["raw.githubusercontent.com"]);
  const g = fetcherOf((host, opts, cb) => cb(null, [{ address: "185.199.108.133", family: 4 }, { address: "::1", family: 6 }]));
  await assert.rejects(g("https://raw.githubusercontent.com/a.step"), /intern adresse/, "one inside address among them is enough");
  await assert.rejects(f("https://example.com/a.ifc"), /ikke blant kildene/); assert.equal(asked.length, 1);
  await assert.rejects(f("http://169.254.169.254/latest/meta-data/"), /bare https/);
});

/* the libraries read from answers given here */
const PH_ASSETS = { Greenhouse_01: { name: "Small Greenhouse", tags: ["glass", "garden"], categories: ["props"], dimensions: [3000, 2000, 2500] }, ArmChair_01: { name: "Arm Chair 01", tags: ["chair"], categories: ["furniture"] } };
const BIN = Buffer.from([1, 2, 3, 4]);
const PH_FILES = { gltf: { "1k": { gltf: { url: "https://dl.polyhaven.org/x/Greenhouse_01_1k.gltf", include: { "Greenhouse_01.bin": { url: "https://dl.polyhaven.org/x/Greenhouse_01.bin" }, "textures/a.jpg": { url: "https://dl.polyhaven.org/x/a.jpg" } } } } } };
const GLTF = { asset: { version: "2.0" }, buffers: [{ uri: "Greenhouse_01.bin", byteLength: 4 }], images: [{ uri: "textures/a.jpg" }], textures: [{ source: 0 }], materials: [{ name: "glass" }], meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }] };
const INDEX = '<a href="https://github.com/FreeCAD/FreeCAD-library/blob/master/Architectural%20Parts/Greenhouses/Greenhouse_small.step?raw=true">s</a><a href="https://github.com/FreeCAD/FreeCAD-library/blob/master/Architectural%20Parts/Greenhouses/Greenhouse_small.FCStd?raw=true">f</a><a href="https://github.com/FreeCAD/FreeCAD-library/blob/master/Mechanical%20Parts/Bolt.step?raw=true">b</a>';
const stub = () => { const seen = []; return { seen, f: async u => { seen.push(u); const body = { "https://api.polyhaven.com/assets?type=models": JSON.stringify(PH_ASSETS), "https://api.polyhaven.com/files/Greenhouse_01": JSON.stringify(PH_FILES),
  "https://dl.polyhaven.org/x/Greenhouse_01_1k.gltf": JSON.stringify(GLTF), "https://dl.polyhaven.org/x/Greenhouse_01.bin": BIN, "https://raw.githubusercontent.com/FreeCAD/FreeCAD-library/master/index.html": INDEX }[u];
  if (body == null) throw new Error(`not stubbed: ${u}`); return { bytes: Buffer.from(body), url: u, filename: u.split("/").pop() }; } }; };

test("find_models: both libraries by every word, each with its licence; the gated ones as links", async () => {
  const s = stub(), r = await libraries(s.f).find("greenhouse");
  assert.deepEqual(r.found.map(x => [x.library, x.title, x.licence.split(" ")[0], x.format]), [["FreeCAD-biblioteket", "Greenhouse small", "CC-BY-3.0", "STEP"], ["Poly Haven", "Small Greenhouse", "CC0", "glTF"]]);
  assert.equal(r.found[0].url, "https://raw.githubusercontent.com/FreeCAD/FreeCAD-library/master/Architectural%20Parts/Greenhouses/Greenhouse_small.step", "the raw file, on the list");
  assert.equal(r.found[1].url, "polyhaven:Greenhouse_01");
  assert.ok(r.link_only.some(l => l.name === "BIMobject" && l.link.includes("greenhouse")));
  await libraries(s.f).find("chair"); assert.equal(s.seen.filter(u => u.includes("assets")).length, 1, "the index kept a day");
});

test("a Poly Haven model comes as one .gltf, its buffers inside and its pictures left out", async () => {
  const s = stub(), g = await libraries(s.f).get("polyhaven:Greenhouse_01"), d = JSON.parse(g.bytes);
  assert.equal(g.filename, "Greenhouse_01.gltf"); assert.equal(g.licence, "CC0"); assert.equal(g.url, "https://polyhaven.com/a/Greenhouse_01");
  assert.equal(d.buffers[0].uri, "data:application/octet-stream;base64," + BIN.toString("base64"));
  assert.equal(d.images, undefined); assert.equal(d.materials, undefined); assert.equal(d.meshes[0].primitives[0].material, undefined);
  assert.ok(!s.seen.some(u => u.endsWith(".jpg")), "no pictures fetched");
  await assert.rejects(libraries(s.f).get("polyhaven:../../x"), /Ukjent/);
});
