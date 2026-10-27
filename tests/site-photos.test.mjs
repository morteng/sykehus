/* Site photos (sitephotos.mjs, public/sitephotos.js, list_site_photos, look_at_site_photo): stored per person, 8 MB, by magic bytes,
   no filename kept; Anton reads them as «leser fra bilde» with the wing's numbers beside; the page's downscale and upload.
   No model is called. Run: node --test tests/site-photos.test.mjs */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createSitePhotos, kindOf, MAX_BYTES } from "../sitephotos.mjs";
import { fitSize, uploadUrl, downscale, startSitePhotos, MAX_EDGE } from "../public/sitephotos.js";

const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
const PNG = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.alloc(64, 2)]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), Buffer.alloc(32, 3)]);
const wings = [{ id: "sentralblokka", name: "Sentralblokka" }, { id: "midtfloy", name: "Midtfløy" }];

test("the first bytes say what an image is: JPEG, PNG and WebP pass, a script, a GIF and an empty file do not", () => {
  assert.equal(kindOf(JPG).type, "image/jpeg"); assert.equal(kindOf(PNG).ext, "png"); assert.equal(kindOf(WEBP).type, "image/webp");
  for (const b of [Buffer.from("<svg onload=alert(1)>................"), Buffer.from("GIF89a" + "x".repeat(40)), Buffer.alloc(0), Buffer.from("RIFF....WAVE" + "x".repeat(40))]) assert.equal(kindOf(b), null);
});
test("a photo is kept under a random id, never the person's filename; the limit, the type, the wing and the year are checked", () => {
  const dir = mkdtempSync(join(tmpdir(), "sykehus-sp-")), s = createSitePhotos({ dir, wings });
  const p = s.add("lars", JPG, { wing: "Sentralblokka", side: "sør", note: " tatt fra parkeringen ", year: "1962" });
  assert.deepEqual([p.wing, p.side, p.note, p.year], ["sentralblokka", "sør", "tatt fra parkeringen", 1962]);
  assert.match(p.id, /^p[A-Za-z0-9_-]{10}$/); assert.deepEqual(readdirSync(join(dir, "_bilder")).sort(), [`${p.id}.jpg`, `${p.id}.json`]);
  assert.equal(s.add("lars", PNG, { wing: "midtfloy", side: "nord-vest" }).side, "ukjent", "an unknown side is «ukjent»");
  const code = (b, o) => { try { s.add("lars", b, o); } catch (e) { return e.code; } return "kept"; };
  assert.equal(code(Buffer.from("not an image at all, just text"), { wing: "midtfloy" }), "bad_image");
  assert.equal(code(Buffer.concat([JPG, Buffer.alloc(MAX_BYTES)]), { wing: "midtfloy" }), "too_big");
  assert.equal(code(JPG, { wing: "no-such-wing" }), "bad_wing"); assert.equal(code(JPG, { wing: "midtfloy", year: 1500 }), "bad_year");
  assert.equal(readdirSync(join(dir, "_bilder")).length, 4, "the refused left nothing on disk");
  assert.equal(createSitePhotos({ dir, wings }).mine("lars").length, 2, "read back at start");
});
test("list, view and delete are the person's own only", () => {
  const s = createSitePhotos({ dir: mkdtempSync(join(tmpdir(), "sykehus-sp-")), wings }), a = s.add("lars", JPG, { wing: "midtfloy" }), b = s.add("mia", PNG, { wing: "midtfloy" });
  assert.deepEqual(s.mine("lars").map(p => p.id), [a.id]); assert.deepEqual(s.mine("mia").map(p => p.id), [b.id]); assert.deepEqual(s.mine(null), []);
  assert.equal(s.read("lars", b.id), null); assert.equal(s.remove("lars", b.id), false); assert.equal(s.mine("mia").length, 1);
  assert.deepEqual(s.read("lars", a.id).data, JPG); assert.equal(s.remove("lars", a.id), true); assert.equal(s.read("lars", a.id), null);
});

/* the real server: the routes and Anton's two tools */
const dir = mkdtempSync(join(tmpdir(), "sykehus-sp-srv-")), secret = "proxy-secret-for-tests-0123456789", PORT = 9500 + Math.floor(Math.random() * 90), O = `http://localhost:${PORT}`;
const as = p => ({ "remote-user": p, "x-sykehus-proxy-auth": secret });
const sv = spawn(process.execPath, [new URL("../server.mjs", import.meta.url).pathname], { env: { ...process.env, PORT: String(PORT), SYKEHUS_VERSIONS_DIR: join(dir, "v"), SYKEHUS_PROXY_SECRET: secret, DOCS: "" }, stdio: ["ignore", "pipe", "inherit"] });
await new Promise(ok => sv.stdout.on("data", d => String(d).includes("Sykehustomta on") && ok()));
after(() => sv.kill());
const up = (who, q, body) => fetch(`${O}/api/bilder?${q}`, { method: "POST", headers: { ...(who ? as(who) : {}), "content-type": "image/jpeg" }, body });
const rpc = async (name, args, who = "lars") => (await (await fetch(O + "/mcp", { method: "POST", headers: { "content-type": "application/json", ...as(who) }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) })).json()).result;
let mine;
test("the route: signed out is refused; an upload is kept and listed; another person sees none and cannot fetch or delete it", async () => {
  assert.equal((await up(null, "fløy=midtfloy", JPG)).status, 401); assert.equal((await fetch(O + "/api/bilder")).status, 401);
  assert.equal((await up("lars", "fløy=midtfloy", Buffer.from("<html>................"))).status, 400);
  assert.equal((await up("lars", "fløy=midtfloy", Buffer.concat([JPG, Buffer.alloc(MAX_BYTES)]))).status, 413);
  const r = await up("lars", "fløy=Sentralblokka&side=sør&note=fra%20parkeringen&%C3%A5r=1975", JPG); assert.equal(r.status, 201); mine = await r.json();
  const l = await (await fetch(O + "/api/bilder", { headers: as("lars") })).json(); assert.deepEqual(l.photos.map(p => p.id), [mine.id]); assert.ok(l.wings.some(w => w.id === "sentralblokka"));
  assert.equal((await (await fetch(O + "/api/bilder", { headers: as("mia") })).json()).photos.length, 0);
  assert.equal((await fetch(`${O}/api/bilder/${mine.id}`, { headers: as("mia") })).status, 404); assert.equal((await fetch(`${O}/api/bilder/${mine.id}`, { method: "DELETE", headers: as("mia") })).status, 404);
  const img = await fetch(`${O}/api/bilder/${mine.id}`, { headers: as("lars") }); assert.equal(img.headers.get("content-type"), "image/jpeg"); assert.deepEqual(Buffer.from(await img.arrayBuffer()), JPG);
});
test("list_site_photos lists the asker's own, by wing; a stranger's id is not found", async () => {
  const t = (await (await fetch(O + "/mcp", { method: "POST", headers: { "content-type": "application/json", ...as("lars") }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) })).json()).result.tools;
  assert.ok(t.some(x => x.name === "list_site_photos") && t.some(x => x.name === "look_at_site_photo"));
  const l = (await rpc("list_site_photos", {})).structuredContent; assert.deepEqual([l.count, l.photos[0].id, l.photos[0].side, l.photos[0].note, l.photos[0].year], [1, mine.id, "sør", "fra parkeringen", 1975]);
  assert.equal((await rpc("list_site_photos", { wing: "midtfloy" })).structuredContent.count, 0); assert.equal((await rpc("list_site_photos", {}, "mia")).structuredContent.count, 0);
  const bad = await rpc("look_at_site_photo", { photo: mine.id }, "mia"); assert.equal(bad.isError, true); assert.match(bad.content[0].text, /Fant ikke bildet/);
});
test("look_at_site_photo returns the picture, its facts as read off a photo, the wing's numbers beside it, and how to anchor and label a change", async () => {
  const r = await rpc("look_at_site_photo", { photo: mine.id }); assert.ok(!r.isError, JSON.stringify(r));
  const img = r.content.find(c => c.type === "image"); assert.equal(img.mimeType, "image/jpeg"); assert.deepEqual(Buffer.from(img.data, "base64"), JPG);
  const txt = r.content.filter(c => c.type === "text").map(c => c.text).join(" ");
  assert.match(txt, /leser fra bilde, aldri målt/); assert.match(txt, /ingen målestokk/); assert.match(txt, /tegningstall/); assert.match(txt, /try_change/); assert.match(txt, /fra parkeringen/);
  const m = r.structuredContent; assert.deepEqual([m.wing, m.side, m.year, m.read_from], ["sentralblokka", "sør", 1975, "bilde"]);
  assert.ok(Array.isArray(m.model_now.levels) && m.model_now.levels.length > 0, "the wing's storeys with kote are beside the picture"); assert.equal(typeof m.model_now.top_kote, "number");
  const lvl = m.model_now.levels[0];
  const ch = await rpc("try_change", { include_screenshot: false, edits: [{ kind: "level", wing: "sentralblokka", storey: lvl.storey, kote: lvl.kote + 0.1, why: `leser fra bilde ${mine.id}: etasjen ligger litt høyere, målt mot etasjehøyden fra storeys` }] });
  assert.equal(ch.structuredContent.rejected.length, 0, JSON.stringify(ch.structuredContent.rejected));
  assert.match(JSON.stringify(ch.structuredContent.added), /leser fra bilde/, "the label stays with the change");
});
test("a delete takes the file and the record; Anton no longer finds it", async () => {
  assert.equal((await fetch(`${O}/api/bilder/${mine.id}`, { method: "DELETE", headers: as("lars") })).status, 200);
  assert.deepEqual(readdirSync(join(dir, "v", "_bilder")), []); assert.equal((await rpc("look_at_site_photo", { photo: mine.id })).isError, true);
});

/* the page */
test("a big picture is brought to 2000 px on its long edge and sent as JPEG; a small one is sent as it is", async () => {
  assert.deepEqual(fitSize(4000, 3000), { w: 2000, h: 1500 }); assert.deepEqual(fitSize(3000, 4000), { w: 1500, h: 2000 }); assert.deepEqual(fitSize(800, 600), { w: 800, h: 600 });
  let drawn = null; const canvas = (w, h) => ({ getContext: () => ({ drawImage: (b, x, y, W, H) => { drawn = [W, H]; } }), toBlob: cb => cb(new Blob(["j"], { type: "image/jpeg" })) });
  const out = await downscale({ size: 9e6, type: "image/jpeg" }, { bitmap: async () => ({ width: 4000, height: 3000 }), canvas });
  assert.deepEqual(drawn, [MAX_EDGE, 1500]); assert.equal(out.type, "image/jpeg");
  const small = { size: 1000, type: "image/png" }; assert.equal(await downscale(small, { bitmap: async () => ({ width: 800, height: 600 }), canvas }), small);
});
test("the upload carries wing, side, note and year in the address, never the filename; the list shows only what the server gave; delete asks first", async () => {
  assert.equal(uploadUrl({ wing: "midtfloy", side: "øst", note: " tatt fra parkeringen ", year: "1962" }), "api/bilder?fl%C3%B8y=midtfloy&side=%C3%B8st&note=tatt+fra+parkeringen&%C3%A5r=1962");
  assert.equal(new URL("http://x/" + uploadUrl({ wing: "w", side: "<b>" })).searchParams.get("side"), "ukjent");
  const el = () => ({ innerHTML: "", hidden: false, textContent: "", value: "", options: [], files: [], disabled: false });
  const nodes = { "#phForm": el(), "#phFile": el(), "#phWing": el(), "#phSide": el(), "#phNote": el(), "#phYear": el(), "#phGo": el(), "#phList": el(), "#phSay": el() };
  nodes["#phWing"].value = "midtfloy"; nodes["#phSide"].value = "sør"; nodes["#phNote"].value = "x"; nodes["#phFile"].files = [{ name: "IMG_4711 Ola Nordmann.jpg" }];
  const calls = []; let photos = [];
  const fetchImpl = async (u, o = {}) => { calls.push([u, o.method || "GET", o.body]); if (o.method === "POST") { photos = [{ id: "pAAAAAAAAAA", wing_name: "Midtfløy", side: "sør", year: null, note: "<script>" }]; return { ok: true, status: 201 }; }
    if (o.method === "DELETE") return { ok: true }; return { ok: true, status: 200, json: async () => ({ photos, wings: [{ id: "midtfloy", name: "Midtfløy" }] }) }; };
  const said = []; startSitePhotos({ root: { querySelector: s => nodes[s] }, toast: t => said.push(t), fetchImpl, shrink: async f => ({ type: "image/jpeg", size: 5 }) });
  await new Promise(r => setTimeout(r, 5)); await nodes["#phForm"].onsubmit({ preventDefault() {} });
  const post = calls.find(c => c[1] === "POST"); assert.ok(!post[0].includes("IMG_4711") && !post[0].includes("Ola"), "no filename goes"); assert.match(post[0], /fl%C3%B8y=midtfloy&side=s%C3%B8r&note=x/);
  assert.match(nodes["#phList"].innerHTML, /api\/bilder\/pAAAAAAAAAA/); assert.ok(!nodes["#phList"].innerHTML.includes("<script>"), "a note is text"); assert.deepEqual(said, ["Bildet er lagt til."]);
  globalThis.confirm = () => false; await nodes["#phList"].onclick({ target: { closest: () => ({ dataset: { del: "pAAAAAAAAAA" } }) } }); assert.ok(!calls.some(c => c[1] === "DELETE"), "no delete without a yes");
  globalThis.confirm = () => true; await nodes["#phList"].onclick({ target: { closest: () => ({ dataset: { del: "pAAAAAAAAAA" } }) } }); assert.ok(calls.some(c => c[1] === "DELETE" && c[0] === "api/bilder/pAAAAAAAAAA"));
});
