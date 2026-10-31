/* Models from open libraries (U3571 S4): what may be fetched and what not (pm 02:55Z), and the libraries read from
   answers given here, so no network is needed.
   node --test tests/fetchimport.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { allowed, fetcherOf, libraries, FETCH_HOSTS } from "../fetchimport.mjs";

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
const CM_URL = "https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=12&gsrsearch=Drammen%20sykehus&prop=imageinfo&iiprop=url%7Cmime%7Csize%7Cextmetadata&iiextmetadatafilter=LicenseShortName%7CUsageTerms%7CArtist%7CDateTimeOriginal";
const cmPage = (index, title, lic, extra = {}) => ({ index, title: `File:${title}`, imageinfo: [{ url: `https://upload.wikimedia.org/x/${title}`, mime: "image/jpeg", width: 800, height: 600, extmetadata: { ...(lic ? { LicenseShortName: { value: lic } } : {}), Artist: { value: '<a href="x">Kari &amp; Ola</a>' }, ...extra } }] });
const CM = { query: { pages: { 1: cmPage(1, "Sykehus 1920.jpg", "Public domain"), 2: cmPage(2, "Fasade.jpg", "CC BY-NC-ND 4.0"), 3: cmPage(3, "Ny.jpg", "All rights reserved"), 4: cmPage(4, "Hvem.jpg", null), 5: cmPage(5, "Plan.jpg", "CC BY-SA 3.0") } } };
const stub = () => { const seen = []; return { seen, f: async u => { seen.push(u); const body = { "https://api.polyhaven.com/assets?type=models": JSON.stringify(PH_ASSETS), "https://api.polyhaven.com/files/Greenhouse_01": JSON.stringify(PH_FILES),
  "https://dl.polyhaven.org/x/Greenhouse_01_1k.gltf": JSON.stringify(GLTF), "https://dl.polyhaven.org/x/Greenhouse_01.bin": BIN, "https://raw.githubusercontent.com/FreeCAD/FreeCAD-library/master/index.html": INDEX, [CM_URL]: JSON.stringify(CM) }[u];
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

test("find_models: Commons pictures carry the file's own licence; unknown or reserved is link only; NC and ND are said, not blocked", async () => {
  const s = stub(), r = await libraries(s.f).find("Drammen sykehus"), by = n => r.pictures.find(x => x.title === n);
  assert.deepEqual(r.pictures.map(x => x.title), ["Sykehus 1920.jpg", "Fasade.jpg", "Ny.jpg", "Hvem.jpg", "Plan.jpg"], "in the search's own order");
  assert.equal(by("Sykehus 1920.jpg").url, "https://upload.wikimedia.org/x/Sykehus 1920.jpg"); assert.equal(by("Sykehus 1920.jpg").restriction, undefined);
  const nc = by("Fasade.jpg"); assert.ok(nc.url, "NC/ND still has a url"); assert.match(nc.restriction, /NC.*ND/); assert.equal(nc.attribution, "Kari & Ola");
  assert.equal(by("Plan.jpg").attribution, "Kari & Ola");
  for (const n of ["Ny.jpg", "Hvem.jpg"]) { assert.equal(by(n).url, undefined, n); assert.equal(by(n).link_only, true, n); assert.match(by(n).page, /^https:\/\/commons\.wikimedia\.org\/wiki\/File%3A/); }
  assert.equal(by("Hvem.jpg").licence, "ukjent");
  assert.deepEqual(r.found, [], "no model matched; the pictures are their own list"); assert.equal(r.unavailable, undefined);
  for (const p of r.pictures) if (p.url) assert.equal(allowed(p.url).ok, true, "a url fetch_model can take");
});

test("find_models: Commons down does not hide the models", async () => {
  const s = stub(), f = async u => { if (u.startsWith("https://commons.")) throw new Error("nede"); return s.f(u); };
  const r = await libraries(f).find("greenhouse"); assert.equal(r.found.length, 2); assert.deepEqual(r.pictures, []); assert.match(r.unavailable[0], /Wikimedia Commons: nede/);
});
