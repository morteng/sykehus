/* U3660: the panel's tabs, the bar's «Tilbakemelding» and the dialog's route (/api/feedback) as the kit's dialog posts to it */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWishes } from "../wishes.mjs";
import { KINDS, WORDS } from "../public/feedback.js";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

test("the tabs are Forslag, Bygg, Anton, in that order, and Ønsker is no tab", () => {
  const tabs = [...html.matchAll(/<button type="button" role="tab" data-tab="(\w+)"/g)].map(m => m[1]);
  assert.deepEqual(tabs, ["changes", "selected", "chat"]);
  assert.match(html, /<nav class="dock" id="dock" data-tabs="3"/); assert.ok(!/id="p-wish"|id="tab-wish"/.test(html));
});

test("the bar has «Tilbakemelding» where Gjengi was, and Gjengi sits in the tool column with the sun", () => {
  assert.match(html, /<button type="button" class="ab-ic" id="mfb" aria-label="Tilbakemelding" title="Gi tilbakemelding">/);
  const bar = html.slice(html.indexOf("<header"), html.indexOf("</header>")), col = html.slice(html.indexOf('<div class="zoom2">'), html.indexOf('<div class="sun-pop"'));
  assert.ok(!bar.includes('id="mgj"') && !bar.includes('id="gjPop"')); assert.ok(col.includes('id="sunBtn"') && col.includes('id="mgj"'));
});

function route(person) {
  const w = createWishes({ dir: mkdtempSync(join(tmpdir(), "fb-")), readJson: async req => req.body, personOf: () => person ? { person } : null });
  const call = async (method, path, body) => { let code, out; const res = { writeHead: c => { code = c; }, end: b => { out = JSON.parse(b); } }; await w.route({ method, body, headers: {} }, res, path); return [code, out]; };
  return { w, call };
}
const PNG = "data:image/png;base64," + Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.from("x")]).toString("base64");

test("the dialog's kinds are the ones the route takes; a report is kept as a wish with its kind, context and picture, and is listed with its status", async () => {
  const { w, call } = route("lars");
  assert.deepEqual(KINDS.map(k => k.id), ["bug", "idea", "question", "other"]); assert.equal(WORDS.thanks, "Sendt. Takk!");
  const [code, out] = await call("POST", "/api/feedback", { kind: "idea", text: " Et snitt gjennom drivhuset ", page: "/", tab: "chat", version: "vabcdefgh", screenshot: PNG });
  assert.equal(code, 200); assert.match(out.id, /^w/);
  const [, list] = await call("GET", "/api/onsker");
  assert.equal(list.wishes[0].text, "[Ide] Et snitt gjennom drivhuset"); assert.equal(list.wishes[0].status, "ny"); assert.match(list.wishes[0].tried, /side \/, fane chat, med bilde/);
  assert.equal(w.mine("lars").length, 1);
});

test("signed out is refused; a bad kind, a bad picture and a text too long have their codes; the 11th in an hour says when", async () => {
  assert.deepEqual(await route(null).call("POST", "/api/feedback", { kind: "bug", text: "x" }), [401, { error: "signed_out" }]);
  const { call } = route("lars");
  assert.equal((await call("POST", "/api/feedback", { kind: "nope", text: "x" }))[1].code, "bad_request");
  assert.deepEqual(await call("POST", "/api/feedback", { kind: "bug", text: "x", screenshot: "data:image/png;base64,AAAA" }), [400, { code: "bad_image" }]);
  assert.equal((await call("POST", "/api/feedback", { kind: "bug", text: "x".repeat(4001) }))[0], 413);
  for (let i = 0; i < 10; i++) assert.equal((await call("POST", "/api/feedback", { kind: "bug", text: "n" + i }))[0], 200);
  const [code, out] = await call("POST", "/api/feedback", { kind: "bug", text: "eleven" });
  assert.equal(code, 429); assert.equal(out.code, "limit"); assert.ok(Date.parse(out.retry_at) > Date.now());
});
