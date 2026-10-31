/* U3660: the panel's tabs, the bar's «Tilbakemelding» and the dialog's route (/api/feedback) as the kit's dialog posts to it */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWishes } from "../wishes.mjs";
import { KINDS, WORDS } from "../public/feedback.js";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

test("the tabs are Prosjekter, Bygg, Anton, Gjengi, in that order, and Ønsker is no tab", () => {
  const tabs = [...html.matchAll(/<button type="button" role="tab" data-tab="(\w+)"/g)].map(m => m[1]);
  assert.deepEqual(tabs, ["changes", "selected", "chat", "photo"]);
  assert.match(html, /<nav class="dock" id="dock" data-tabs="4"/); assert.ok(!/id="p-wish"|id="tab-wish"/.test(html));
});

test("the bar has «Tilbakemelding» where Gjengi was, and Gjengi is a tab after Anton (U3663): no button in the tool column, no card beside the sun", () => {
  assert.match(html, /<button type="button" class="ab-ic" id="mfb" aria-label="Tilbakemelding" title="Gi tilbakemelding">/);
  assert.ok(!html.includes('id="mgj"') && !html.includes('id="gjPop"'), "the map column's Gjengi button and its card are gone");
  assert.match(html, /id="tab-photo"[^>]*hidden>/, "signed out the tab is not there (anton.js shows it for a person)");
  assert.ok(html.indexOf('id="tab-chat"') < html.indexOf('id="tab-photo"'), "after Anton");
  for (const id of ["p-photo", "pf", "pfFrame", "pfInset", "pfLens", "pfAspect", "pfShot", "pfResult", "gjSpots", "gjRetake"]) assert.ok(html.includes(`id="${id}"`), id);
});


/* gulden-ai's door, in memory: the dialog's report is filed there (U3978) and read back from there */
function route(person) {
  const filed = [], fetchImpl = async (url, init) => {
    const u = new URL(url);
    if (u.pathname.endsWith("/feedback")) { filed.push({ ...JSON.parse(init.body), id: "rp-" + (filed.length + 1), status: "ny", note: null }); return new Response(JSON.stringify({ id: "rp-" + filed.length }), { status: 200 }); }
    return new Response(JSON.stringify({ items: filed.map(r => ({ id: r.id, at: r.at, text: r.text.split("\n")[0], status: r.status, note: r.note, ref: r.design_id ?? null })) }), { status: 200 });
  };
  const w = createWishes({ dir: mkdtempSync(join(tmpdir(), "fb-")), readJson: async req => req.body, personOf: () => person ? { person } : null, login: { base: "http://door.test", bearer: "b" }, fetchImpl });
  const call = async (method, path, body) => { let code, out; const res = { writeHead: c => { code = c; }, end: b => { out = JSON.parse(b); } }; await w.route({ method, body, headers: {} }, res, path); return [code, out]; };
  return { w, call, filed };
}
const PNG = "data:image/png;base64," + Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.from("x")]).toString("base64");

test("the dialog's kinds are the ones the route takes; a report is filed in the one store with its kind, context and picture, and is listed with its status", async () => {
  const { w, call, filed } = route("lars");
  assert.deepEqual(KINDS.map(k => k.id), ["bug", "idea", "question", "other"]); assert.equal(WORDS.thanks, "Sendt. Takk!");
  const [code, out] = await call("POST", "/api/feedback", { kind: "idea", text: " Et snitt gjennom drivhuset ", page: "/", tab: "chat", version: "vabcdefgh", screenshot: PNG });
  assert.equal(code, 200); assert.equal(out.id, "rp-1");
  assert.deepEqual([filed[0].person, filed[0].kind, filed[0].text, filed[0].page, filed[0].tab, filed[0].design_id], ["lars", "idea", "Et snitt gjennom drivhuset", "/", "chat", "vabcdefgh"]);
  assert.match(filed[0].attachment_ref, /^w[A-Za-z0-9_-]{10}$/, "the picture is kept here and named in the report");
  const [, list] = await call("GET", "/api/onsker");
  assert.equal(list.wishes[0].text, "Et snitt gjennom drivhuset"); assert.equal(list.wishes[0].status, "ny");
  assert.equal((await w.mine("lars")).length, 1);
});

test("signed out is refused; a bad kind, a bad picture and a text too long have their codes; the 11th in an hour says when", async () => {
  assert.deepEqual(await route(null).call("POST", "/api/feedback", { kind: "bug", text: "x" }), [401, { error: "signed_out" }]);
  const { call } = route("lars");
  assert.equal((await call("POST", "/api/feedback", { kind: "nope", text: "x" }))[1].code, "bad_request");
  assert.deepEqual(await call("POST", "/api/feedback", { kind: "bug", text: "x", screenshot: "data:image/png;base64,AAAA" }), [400, { code: "bad_image" }]);
  assert.equal((await call("POST", "/api/feedback", { kind: "bug", text: "x".repeat(4001) }))[0], 413);
  for (let i = 0; i < 10; i++) assert.equal((await call("POST", "/api/feedback", { kind: "bug", text: "Feil nummer " + i }))[0], 200);
  const [code, out] = await call("POST", "/api/feedback", { kind: "bug", text: "eleven" });
  assert.equal(code, 429); assert.equal(out.code, "limit"); assert.ok(Date.parse(out.retry_at) > Date.now());
});

test("U3672 (Morten 16:51Z «we don't need this text»): the Prosjekter tab has no «Forslag til «etter»» heading and no paragraph under it; the list and «Nytt prosjekt» stay, and the tour anchors on the tab, not on a heading", async () => {
  const { readFileSync } = await import("node:fs"), rd = f => readFileSync(new URL("../public/" + f, import.meta.url), "utf8");
  const html = rd("index.html"), panel = html.slice(html.indexOf('id="p-changes"'), html.indexOf("</section>", html.indexOf('id="p-changes"')));
  assert.doesNotMatch(panel, /<h2/); assert.doesNotMatch(panel, /Forslag til «etter»|Tegnet med Anton over modellen/);
  assert.match(panel, /id="mnp"/); assert.match(panel, /id="verList"/); assert.match(panel, /id="draftRow"/);
  assert.match(rd("sharing.js"), /sel-empty">Ingen prosjekter ennå\.<\/li>/); assert.doesNotMatch(rd("app.js"), /Ingen andre prosjekter/);
  const { steps } = await import("../public/tour.js"), s = steps({ phone: () => false, tab() { } }).find(x => x.title === "Prosjektet ditt");
  assert.match(String(s.el), /p-changes/); assert.doesNotMatch(String(s.el), /h2|etter/);
});
