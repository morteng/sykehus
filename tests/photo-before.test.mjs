/* U3666 (Morten 2026-10-26 15:55Z «just grey out "gjengi" when in "før" mode»): with no version or draft open the Gjengi tab is greyed (not hidden) and says why; any grey shutter says its reason on itself. Run: node --test tests/photo-before.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { whyNot, hasWork, NEEDS_WORK } from "../public/photospots.js";
const ok = { st: { on: true, signed_in: true, left_usd: 5 }, work: { versjon: "vAbcdefgh" }, busy: false, price: 0.12 };
test("the shutter is grey for one reason each, in plain Norwegian, and live when there is none", () => {
  assert.equal(whyNot(ok), null); assert.equal(whyNot({ ...ok, work: { utkast: "abcd1234" } }), null);
  assert.equal(whyNot({ ...ok, work: {} }), "Åpne et forslag for å ta bilder"); assert.equal(NEEDS_WORK, "Åpne et forslag for å ta bilder"); assert.equal(whyNot({ ...ok, work: null }), NEEDS_WORK);
  assert.equal(whyNot({ ...ok, st: { ...ok.st, signed_in: false } }), "Logg inn for å ta bilder"); assert.equal(whyNot({ ...ok, st: { ...ok.st, on: false } }), "Gjengi er ikke slått på her");
  assert.equal(whyNot({ ...ok, st: { ...ok.st, left_usd: 0.05 } }), "Månedens grense er nådd"); assert.equal(whyNot({ ...ok, busy: true }), "Lager bildet …"); assert.equal(whyNot({ ...ok, st: null }), "Henter prisen …");
  assert.equal(hasWork({}), false); assert.equal(hasWork({ versjon: "v" }), true);
});
test("the tab is disabled, not hidden, with the reason as its title; the photo mode is left for the earlier tab", () => {
  const js = readFileSync(new URL("../public/gjengi.js", import.meta.url), "utf8"), css = readFileSync(new URL("../public/sykehus.css", import.meta.url), "utf8");
  assert.match(js, /tabBtn\.disabled = !ok/); assert.match(js, /tabBtn\.title = ok \? .+ : NEEDS_WORK/); assert.ok(!/tabBtn\.hidden/.test(js));
  assert.match(js, /if \(!ok && on\) panel\.show\(prevTab\)/, "open when the person goes to Før: leave for the earlier tab");
  assert.match(js, /if \(!hasWork\(work\(\)\)\) \{ panel\.show\(prevTab\); return; \}/, "it cannot be entered without work");
  assert.match(css, /\.dock \[data-tab\]:disabled \{ opacity: \.45/);
});
