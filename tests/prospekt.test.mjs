/* Prospekt (Morten 2026-10-27): a read-only page per shared project. Sharing decides on every request: privat, an unknown id and a wrong key are
   the same 404 (JSON and pictures); lenke opens with its key and is never listed; offentlig opens and is listed. The JSON has exactly PROSPEKT_KEYS.
   A render shows unless the owner turned it off (owner only); one is the hero. The real server runs; the plot's facts come from a stub.
   node --test tests/prospekt.test.mjs
   2026-10-28: the Prospekt is a view in the viewing area (prospekt-pane.js); the old page only sends on. */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import vm from "node:vm";
import { PROSPEKT_KEYS, numbersOf, limitsOf } from "../prospekt.mjs";
import { prospektHtml, GONE } from "../public/prospekt-view.js";
import { firstView, sharedOpen, prospektOpen, PRIVATE_HTML, renderProspekt } from "../public/prospekt-pane.js";

const secret = "proxy-secret-for-tests-0123456789", as = who => ({ "remote-user": who, "x-sykehus-proxy-auth": secret });
const dir = mkdtempSync(join(tmpdir(), "sykehus-prospekt-")), vdir = join(dir, "v");
const REPORT = { place: "Dronninggata 28", hazards: [{ level: "moderate", text: "I aktsomhetsområde for kvikkleireskred.", source: "NVE" }],
  heritage_within_50m: [{ name: "Sykehus, Dronninggata 28.", protection: "Kommunalt listeført", distance_m: 5 }], invasive_plants_within_500m: [] };
const hk = createServer((q, r) => { q.resume(); r.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: JSON.stringify(REPORT) }] } })); });
await new Promise(ok => hk.listen(0, ok)); after(() => hk.close());
async function boot() {
  const PORT = 9300 + Math.floor(Math.random() * 600), srv = spawn(process.execPath, [new URL("../server.mjs", import.meta.url).pathname], { env: { ...process.env, PORT: String(PORT), SYKEHUS_VERSIONS_DIR: vdir, SYKEHUS_PROXY_SECRET: secret, SYKEHUS_HAGEKART_URL: `http://localhost:${hk.address().port}/mcp`, DOCS: "" }, stdio: ["ignore", "pipe", "inherit"] });
  await new Promise(ok => srv.stdout.on("data", d => String(d).includes("Sykehustomta on") && ok()));
  const O = `http://localhost:${PORT}`;
  const call = async (name, args, h) => (await (await fetch(O + "/mcp", { method: "POST", headers: { "content-type": "application/json", ...h }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) })).json()).result.structuredContent;
  const page = (body, h) => fetch(O + "/api/endring", { method: "POST", headers: { "content-type": "application/json", ...h }, body: JSON.stringify(body) }).then(async r => ({ status: r.status, j: await r.json() }));
  return { O, call, page, stop: () => srv.kill() };
}
let s = await boot();
const lars = as("lars"), kari = as("kari");
const pub = (await s.call("new_version", { title: "Til alle" }, lars)).version; await s.call("set_sharing", { version: pub, sharing: "offentlig" }, lars);
const lnk = await s.call("new_version", { title: "Bare lenke" }, lars); const link = (await s.call("set_sharing", { version: lnk.version, sharing: "lenke" }, lars)).link, KEY = /nokkel=([^&]+)/.exec(link)[1];
const priv = (await s.call("new_version", { title: "Privat" }, lars)).version;
s.stop();
const rec = (id, v, at, extra = {}) => ({ id, at, by: "lars", work: `versjon:${v}`, ext: "jpg", bytes: 6, cost_usd: 0.1, fav: false, model: "m", ...extra });
const bytes = n => Buffer.from(`JPEG-${n}`);
const R = { p1: "aaaaaaaaaaaaaaa1", p2: "aaaaaaaaaaaaaaa2", p3: "aaaaaaaaaaaaaaa3", l1: "bbbbbbbbbbbbbbb1", v1: "ccccccccccccccc1" };
const g = join(vdir, "gjengi"); mkdirSync(g, { recursive: true });
writeFileSync(join(g, "index.json"), JSON.stringify([rec(R.p1, pub, "2026-10-26T10:00:00Z"), rec(R.p2, pub, "2026-10-27T10:00:00Z"), rec(R.p3, pub, "2026-10-27T11:00:00Z", { ext: "png" }), rec(R.l1, lnk.version, "2026-10-27T10:00:00Z"), rec(R.v1, priv, "2026-10-27T10:00:00Z"),
  { id: "ddddddddddddddd1", at: "2026-10-27T12:00:00Z", by: "lars", work: null, failed: true, cost_usd: 0.1 }]));
for (const [n, f] of [[R.p1, "jpg"], [R.p2, "jpg"], [R.p3, "png"], [R.l1, "jpg"], [R.v1, "jpg"]]) writeFileSync(join(g, `${n}.${f}`), bytes(n));
s = await boot(); after(() => s.stop());
const get = (p, h) => fetch(s.O + p, { headers: h }).then(async r => ({ status: r.status, type: r.headers.get("content-type"), text: await r.text(), r }));
const gone = await get("/api/prospekt/vzzzzzzzz");

test("privat, an unknown id and a lenke without its key all answer the same 404, for the JSON and for the pictures; even to the owner of the privat one", async () => {
  for (const p of [`/api/prospekt/${priv}`, `/api/prospekt/${lnk.version}`, `/api/prospekt/${lnk.version}?nokkel=feil`, `/api/prospekt/${priv}/bilde/${R.v1}.jpg`, `/api/prospekt/${lnk.version}/bilde/${R.l1}.jpg`, `/api/prospekt/vzzzzzzzz/bilde/${R.p1}.jpg`, `/api/prospekt/${priv}?nokkel=${KEY}`]) {
    const r = await get(p); assert.equal(r.status, 404, p); assert.equal(r.text, gone.text, `${p}: same body as an unknown id`);
  }
  assert.equal((await get(`/api/prospekt/${priv}`, lars)).status, 404, "the owner too: privat has no prospekt");
  assert.equal((await get(`/api/prospekt/${priv}`, kari)).status, 404);
});

test("offentlig opens for a visitor and is listed; lenke opens with its key (and for its owner), and is never listed to a visitor or another person", async () => {
  const r = await get(`/api/prospekt/${pub}`); assert.equal(r.status, 200);
  const list = async h => (await (await fetch(s.O + "/api/versjoner", { headers: h })).json()).versions;
  assert.ok((await list()).some(v => v.version === pub), "offentlig is in the visitor's list");
  assert.equal((await get(`/api/prospekt/${lnk.version}?nokkel=${KEY}`)).status, 200);
  assert.equal((await get(`/api/prospekt/${lnk.version}`, lars)).status, 200, "its owner needs no key");
  assert.ok(!(await list()).some(v => v.version === lnk.version), "lenke is not in the visitor's list");
  assert.ok(!(await list(kari)).some(v => v.version === lnk.version), "nor in another person's");
  assert.equal((await list(lars)).find(v => v.version === lnk.version).pkey, KEY, "the owner's row carries the link key the Prospekt button needs");
  assert.equal((await list(kari)).find(v => v.version === pub).pkey, undefined, "a public row carries none");
  await s.page({ unshare: lnk.version }, lars);   // sharing is read on every request: taken back, it is gone at once
  assert.equal((await get(`/api/prospekt/${lnk.version}?nokkel=${KEY}`)).status, 404);
  assert.equal((await get(`/api/prospekt/${lnk.version}/bilde/${R.l1}.jpg?nokkel=${KEY}`)).status, 404);
  await s.page({ share: lnk.version, sharing: "lenke" }, lars);
});

test("the JSON has exactly the public keys: no owner address, chat, wishes or other ids; renders are id, url and time only", async () => {
  const j = JSON.parse((await get(`/api/prospekt/${pub}`)).text);
  assert.deepEqual(Object.keys(j).sort(), [...PROSPEKT_KEYS].sort());
  assert.equal(j.owner, "lars"); assert.equal(j.title, "Til alle"); assert.equal(j.sharing, "offentlig");
  for (const r of j.renders) assert.deepEqual(Object.keys(r).sort(), ["at", "id", "url"]);
  assert.deepEqual(j.stills.map(x => Object.keys(x).sort().join()), ["title,url", "title,url", "title,url"]);
  assert.deepEqual(Object.keys(j.numbers).sort(), ["bra_m2", "bta_m2", "demolished", "how", "volumes"]);
  assert.ok(!/@|wish|onsk|chat|nokkel|"key"|"own"/i.test((await get(`/api/prospekt/${pub}`)).text.replace(/api\/prospekt\/[^"]+/g, "")), "no address, wish, chat or key anywhere in the body");
  assert.deepEqual(j.limits.map(l => l.how.split(" (")[0]), ["Fra NVE", "Fra Riksantikvarens register"]);
  assert.match(j.limits[0].line, /kvikkleire/); assert.match(j.limits[1].line, /5 m unna/);
  const l = JSON.parse((await get(`/api/prospekt/${lnk.version}?nokkel=${KEY}`)).text);
  assert.ok(l.renders[0].url.includes(`nokkel=${KEY}`), "a link-only prospekt's picture URLs carry its key");
});

test("a render shows unless the owner turned it off; the owner picks the hero; both owner only, and the pictures follow", async () => {
  const ids = async () => JSON.parse((await get(`/api/prospekt/${pub}`)).text);
  let j = await ids(); assert.deepEqual(j.renders.map(r => r.id).sort(), [R.p1, R.p2, R.p3].sort(), "all three by default; the failed one is not a render");
  assert.equal(j.hero, R.p3, "no hero chosen: the newest");
  for (const h of [{}, kari]) { const r = await s.page({ prospekt: { render: R.p1, show: false } }, h); assert.equal(r.status, 400, "signed out or another person is refused"); }
  assert.equal((await ids()).renders.length, 3, "nothing changed");
  const off = await s.page({ prospekt: { render: R.p1, show: false } }, lars); assert.equal(off.status, 200); assert.deepEqual(off.j, { id: R.p1, prospekt: false, hero: false });
  j = await ids(); assert.ok(!j.renders.some(r => r.id === R.p1));
  assert.equal((await get(`/api/prospekt/${pub}/bilde/${R.p1}.jpg`)).status, 404, "a hidden render is not served either");
  assert.equal((await s.page({ prospekt: { render: R.l1, hero: true } }, kari)).status, 400, "another's render");
  assert.equal((await s.page({ prospekt: { render: "nonexistentidxxx", hero: true } }, lars)).status, 400);
  const hero = await s.page({ prospekt: { render: R.p2, hero: true } }, lars); assert.deepEqual(hero.j, { id: R.p2, prospekt: true, hero: true });
  j = await ids(); assert.equal(j.hero, R.p2); assert.equal(j.renders[0].id, R.p2, "the hero is first");
  await s.page({ prospekt: { render: R.p1, hero: true } }, lars); j = await ids(); assert.equal(j.hero, R.p1, "one hero at a time, and a hidden one chosen is shown again");
  assert.equal((await s.page({ prospekt: { render: R.p1, show: false } }, lars)).j.hero, false, "hiding the hero takes the hero away");
  await s.page({ prospekt: { render: R.p1, show: true } }, lars);
});

test("a shown render is served as stored, with its own type; a wrong extension or another version's render is 404", async () => {
  const j = JSON.parse((await get(`/api/prospekt/${pub}`)).text), png = j.renders.find(r => r.id === R.p3), jpg = j.renders.find(r => r.id === R.p2);
  const a = await fetch(`${s.O}/${png.url}`); assert.equal(a.status, 200); assert.equal(a.headers.get("content-type"), "image/png"); assert.deepEqual(Buffer.from(await a.arrayBuffer()), bytes(R.p3));
  const b = await fetch(`${s.O}/${jpg.url}`); assert.equal(b.headers.get("content-type"), "image/jpeg"); assert.deepEqual(Buffer.from(await b.arrayBuffer()), bytes(R.p2));
  assert.equal((await get(`/api/prospekt/${pub}/bilde/${R.p3}.jpg`)).status, 404, "stored as png");
  assert.equal((await get(`/api/prospekt/${pub}/bilde/${R.l1}.jpg`)).status, 404, "another project's render");
});

test("the model's stills are drawn on the server for a shared project only: a JPEG for offentlig, the same 404 for privat, lenke without key and an unknown still", async () => {
  const j = JSON.parse((await get(`/api/prospekt/${pub}`)).text), r = await fetch(`${s.O}/${j.stills[0].url}`), b = Buffer.from(await r.arrayBuffer());
  assert.equal(r.status, 200); assert.equal(r.headers.get("content-type"), "image/jpeg"); assert.deepEqual([...b.subarray(0, 3)], [0xff, 0xd8, 0xff]); assert.ok(b.length > 5000, "a real picture");
  for (const p of [`/api/prospekt/${priv}/modell/sorvest.jpg`, `/api/prospekt/${lnk.version}/modell/sorvest.jpg`, `/api/prospekt/vzzzzzzzz/modell/sorvest.jpg`]) assert.equal((await get(p)).text, gone.text, p);
  assert.equal((await get(`/api/prospekt/${pub}/modell/finnesikke.jpg`)).status, 404);
});
test("the old address /prospekt/<id> and /prospekt.html still resolve: a small page whose script opens the main page with the Prospekt view picked; the main page still hides what a visitor may not use", async () => {
  for (const p of [`/prospekt/${pub}`, "/prospekt.html"]) {
    const r = await get(p); assert.equal(r.status, 200, p); assert.match(r.type, /text\/html/); assert.match(r.text, /src="prospekt\.js/); assert.match(r.text, /<base href="\/">/);
    assert.ok(!/<form|<input|prospekt\.css/i.test(r.text), "no controls and no brochure of its own in the page");
  }
  const go = (href, id) => { let to = null; const u = new URL(href); vm.runInNewContext(readFileSync(new URL("../public/prospekt.js", import.meta.url), "utf8"), { URLSearchParams, encodeURIComponent, location: { search: u.search, pathname: u.pathname, replace: x => { to = x; } } }); return to; };
  assert.equal(go(`http://x/prospekt/${pub}`), `./?versjon=${pub}&vis=prospekt`, "the id from the path");
  assert.equal(go(`http://x/prospekt.html?v=${pub}`), `./?versjon=${pub}&vis=prospekt`, "the id from ?v=");
  assert.equal(go(`http://x/prospekt.html?v=${lnk.version}&nokkel=k%201`), `./?versjon=${lnk.version}&nokkel=k%201&vis=prospekt`, "a link-only project keeps its key");
  assert.equal(go("http://x/prospekt.html"), "./", "no id: the main page");
  const idx = (await get("/")).text; assert.match(idx, /me-hint\.js/, "the visitor chrome is still the main page's");
});

test("numbersOf: a new volume's storeys, kote per storey and areas as calculated; BRA absent without a sourced factor; no volume, no rows", () => {
  const site = { added: [], demolished: [], landscape: [], buildings: [], wings: [] };
  const n = numbersOf({ ...structuredClone(JSON.parse(readJson("public/data/site.json"))) }, [], [{ kind: "volume", shape: "box", name: "Test", from: [0, 0], to: [10, 0], width: 8, height: 9, storeys: 3, base_kote: 20 }], { prices: [], bra_factor: null });
  assert.equal(n.volumes.length, 1); const v = n.volumes[0];
  assert.deepEqual([v.name, v.storeys, v.footprint_m2, v.bta_m2, v.bra_m2, v.foot_kote, v.top_kote, v.storey_kotes], ["Test", 3, 80, 240, null, 20, 29, [20, 23, 26]]);
  assert.equal(n.bra_m2, null); assert.match(n.how, /beregnet/); assert.match(n.how, /BRA er ikke oppgitt/);
  assert.equal(numbersOf(JSON.parse(readJson("public/data/site.json")), [], [], { prices: [], bra_factor: null }).volumes.length, 0); void site;
});
test("limitsOf: each limit is a plain line with how it is known", () => {
  assert.deepEqual(limitsOf(REPORT), [{ line: "I aktsomhetsområde for kvikkleireskred.", how: "Fra NVE (kart for tidlig vurdering, ikke en avgjørelse)" },
    { line: "Kulturminne 5 m unna: Sykehus, Dronninggata 28. (Kommunalt listeført)", how: "Fra Riksantikvarens register (Kulturminnesøk)" }]);
  assert.deepEqual(limitsOf({}), []);
});
test("the page markup: full-bleed hero with the title, facts column, renders then stills with captions, limits last, «Laget med Sykehustomta»; escaped text; no live 3D", () => {
  const base = { version: "v1", title: "A <b>&\" hus", owner: "lars", updated: "2026-10-27T10:00:00Z", hero: "r2", renders: [{ id: "r1", url: "u1", at: "2026-10-26T10:00:00Z" }, { id: "r2", url: "u2", at: "2026-10-27T10:00:00Z" }],
    stills: [{ title: "Modellen sett fra sørvest", url: "s1" }], numbers: { volumes: [{ name: "Hus", storeys: 3, footprint_m2: 288, bta_m2: 864, bra_m2: null, foot_kote: 22, top_kote: 31.6, storey_kotes: [22, 25.2, 28.4] }], bta_m2: 864, bra_m2: null, demolished: { count: 0 }, how: "Beregnet." },
    limits: [{ line: "Kvikkleire.", how: "Fra NVE" }], limits_say: null };
  const h = prospektHtml(base, { links: { explore: "./?versjon=v1&vis=3d" } });
  assert.match(h, /class="pk-hero-img" data-lb="1"[^>]*><img src="u2"/, "the hero is the chosen render, first and large");
  assert.ok(h.indexOf('class="pk-hero') < h.indexOf('class="pk-facts"') && h.indexOf('class="pk-facts"') < h.indexOf("<h2>Bilder") && h.indexOf("<h2>Bilder") < h.indexOf("<h2>Modellen") && h.indexOf("<h2>Modellen") < h.indexOf("Tomta og begrensninger"), "order: hero, facts, pictures, model, limits");
  assert.match(h, /data-lb="0"[^>]*><img src="u1"/); assert.match(h, /data-lb="2"[^>]*><img src="s1"/); assert.match(h, /<figcaption>Modellen sett fra sørvest<\/figcaption>/); assert.match(h, /Gjengitt bilde, 26\. oktober 2026/);
  assert.match(h, /<a class="pk-btn" data-explore href="\.\/\?versjon=v1&amp;vis=3d">Utforsk i 3D<\/a>/); assert.match(h, /Laget med Sykehustomta/);
  assert.ok(!/canvas|<script|webgl|viewer/i.test(h), "no live 3D in the page");
  assert.match(h, /<dt>BRA<\/dt><dd>ikke oppgitt/); assert.match(h, /<dt>Høyeste kote<\/dt><dd>\+31,6 m/); assert.match(h, /etasjer \+22 · \+25,2 · \+28,4/);
  assert.ok(h.includes("A &lt;b&gt;&amp;&quot; hus") && !h.includes("<b>&"), "title escaped"); assert.match(h, /Av lars/);
  assert.ok(!/<h2>Bilder/.test(prospektHtml({ ...base, renders: [base.renders[1]] })), "only the hero: no «Bilder»");
  const bare = prospektHtml({ ...base, hero: null, renders: [] }); assert.match(bare, /class="pk-hero-img" data-lb="0"[^>]*><img src="s1"/, "no render: the first still is the hero");
  assert.ok(!/<h2>Modellen/.test(bare), "and is not shown twice"); assert.match(GONE, /Fant ikke prospektet/);
});
test("which view opens first: a shared project's Prospekt for a visitor and for anyone not the owner; 3D for the owner; ?vis= asks; a project with no Prospekt opens on 3D", () => {
  for (const [shared, owner, asked, want, why] of [[true, false, null, "prospekt", "visitor or another person"], [true, true, null, "3d", "the owner"], [true, true, "prospekt", "prospekt", "the owner asks"], [true, false, "3d", "3d", "a visitor asks"],
    [true, false, "x", "prospekt", "an unknown ask is no ask"], [false, false, null, "3d", "nothing shared: no Prospekt"], [false, false, "prospekt", "3d", "asked, but privat or missing"]]) assert.equal(firstView({ shared, owner, asked }), want, why);
  assert.deepEqual([{ version: "v1", sharing: "offentlig" }, { version: "v1", sharing: "lenke" }, { version: "v1", sharing: "privat" }, { version: "v1", sharing: "offentlig", missing: true }, null].map(sharedOpen), [true, true, false, false, false]);
});
test("the viewing area mounts the one content builder: the real server's answer becomes the page, with «Utforsk i 3D» as a switch; a 404 says so; no contact says so", async () => {
  const el = { innerHTML: "" }, via = u => fetch(`${s.O}/${u}`);
  const j = await renderProspekt(el, { id: pub, explore: "?versjon=x&vis=3d", fetch: via });
  assert.equal(j.title, "Til alle"); assert.equal(el.innerHTML, prospektHtml(j, { links: { explore: "?versjon=x&vis=3d" } }), "the same markup the builder makes, nothing else");
  assert.match(el.innerHTML, /<a class="pk-btn" data-explore href="\?versjon=x&amp;vis=3d">Utforsk i 3D<\/a>/);
  assert.equal(await renderProspekt(el, { id: priv, fetch: via }), null); assert.equal(el.innerHTML, GONE);
  assert.equal(await renderProspekt(el, { id: pub, fetch: () => Promise.reject(new Error("down")) }), null); assert.match(el.innerHTML, /Fikk ikke kontakt/);
  let url = null; await renderProspekt(el, { id: lnk.version, nokkel: "k 1", fetch: u => { url = u; return Promise.resolve(null); } }); assert.equal(url, `api/prospekt/${lnk.version}?nokkel=k%201`, "the link key goes along");
});
test("the owner has the Prospekt while working: open for their own project shared or not, for another's only when shared; and it follows the project (the same answer, drawn again after a pick changes)", async () => {
  const v = sharing => ({ version: "v1", sharing }), tbl = [[v("offentlig"), false, true], [v("lenke"), false, true], [v("privat"), false, false], [v("privat"), true, true], [v("offentlig"), true, true], [{ ...v("privat"), missing: true }, true, false], [null, true, false]];
  for (const [d, owner, want] of tbl) assert.equal(prospektOpen(d, owner), want, JSON.stringify([d, owner]));
  assert.match(PRIVATE_HTML, /Prosjektet er privat/);
  /* the owner's flow in the page: show() and the picks both call pkRefresh, which draws the Prospekt again when it is the open view */
  const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(app, /ifcLink\(\); pkRefresh\(\);/, "after every change to the project (show)"); assert.match(app, /pkLoad\(\); pkRefresh\(\);/, "after the owner's picks");
  assert.match(app, /const pkRefresh = \(\) => \{ if \(pkOn\) pkShow\(true\); \}/); assert.match(app, /draft\?\.sharing !== pkSharing\) pkRefresh\(\)/, "and when the sharing changes");
  const el = { innerHTML: "" }, via = u => fetch(`${s.O}/${u}`, { headers: lars });   // the owner's own request: the same builder and data path as a visitor's
  const before = await renderProspekt(el, { id: pub, fetch: via }), html0 = el.innerHTML; assert.ok(before.renders.some(r => r.id === R.p2));
  await s.page({ prospekt: { render: R.p2, show: false } }, lars);
  const after = await renderProspekt(el, { id: pub, fetch: via }); assert.ok(!after.renders.some(r => r.id === R.p2)); assert.notEqual(el.innerHTML, html0, "the page changed with the pick");
  assert.ok(!el.innerHTML.includes(`bilde/${R.p2}`), "the hidden render is gone from the markup");
  await s.page({ prospekt: { render: R.p2, show: true } }, lars); assert.ok((await renderProspekt(el, { id: pub, fetch: via })).renders.some(r => r.id === R.p2), "and back");
});
test("one copy: only the pane module builds the brochure; the main page and the old address use it or send on; the visitor is no longer sent away from the main page", () => {
  const rd = f => readFileSync(new URL(`../public/${f}`, import.meta.url), "utf8"), app = rd("app.js"), html = rd("index.html");
  for (const f of ["app.js", "prospekt.js", "me-hint.js"]) assert.ok(!/prospektHtml|factsHtml|limitsHtml|volumesHtml/.test(rd(f)), `${f} builds no brochure`);
  assert.match(rd("prospekt-pane.js"), /prospektHtml\(data/); assert.match(app, /import \{[^}]*renderProspekt[^}]*\} from "\.\/prospekt-pane\.js/);
  assert.ok(!/location\.replace/.test(rd("me-hint.js")), "me-hint.js no longer redirects");
  assert.ok(!/pkBack|drawBack|fra=|prospekt\.html|&se=1/.test(app + html), "the full-page «Tilbake til prospekt» and its links are gone");
  const group = /<span class="seg2" role="group" aria-label="Visning">(.*?)<\/span>/s.exec(html)[1], ids = [...group.matchAll(/id="(\w+)"/g)].map(m => m[1]);
  assert.deepEqual(ids.slice(0, 2), ["mpk", "m3d"], "«Prospekt» is the first view button, next to 3D"); assert.match(group, /id="mpk" hidden[^>]*>Prospekt<\/button>/);
  assert.ok(html.indexOf('id="stage"') < html.indexOf('id="pkPane"') && html.indexOf('id="pkPane"') < html.indexOf('class="vt"'), "the pane is in the stage, with the same area as the model");
  assert.match(app, /firstView\(\{ shared: pkShared\(\), owner: mine\(\), asked: qs\.get\("vis"\) \}\)/, "the first view is decided from the owner and ?vis=");
  assert.match(rd("sykehus.css"), /body\.pk-on \.nz[^{]*\.vt > :not\(\.seg2\)/, "only the view buttons stay over the Prospekt");
});
import { readFileSync } from "node:fs";
function readJson(f) { return readFileSync(new URL(`../${f}`, import.meta.url), "utf8"); }
