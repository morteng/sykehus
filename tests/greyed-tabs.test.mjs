/* U3677 (Morten 2026-10-26 17:27Z «for ppl who are not logged in, bygg and anton tabs should be greyed out»): signed out, Bygg and Anton are disabled with the reason as their title;
   a tap does not switch; a page that opens on one falls back to Forslag; signed in nothing is changed. Gjengi's «Før» grey is the same rule. Run: node --test tests/greyed-tabs.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = f => readFileSync(new URL(`../public/${f}`, import.meta.url), "utf8");
test("signed out: Bygg and Anton are disabled with «Logg inn for å bygge og snakke med Anton»; signed in they are back; Forslag is never touched", () => {
  const a = read("anton.js");
  assert.match(a, /const NEEDS_LOGIN = "Logg inn for å bygge og snakke med Anton";/);
  assert.match(a, /for \(const \[id, name\] of \[\["tab-selected", "Bygg"\], \["tab-chat", "Anton"\]\]\) \{ const b = \$\(id\); b\.disabled = true; b\.title = NEEDS_LOGIN;/);
  assert.match(a, /panel\.show\("changes", \{ quiet: true \}\);/, "a page that opens on a greyed tab falls back to Forslag");
  assert.match(a, /for \(const id of \["tab-selected", "tab-chat"\]\) \{ const b = \$\(id\); b\.disabled = false; b\.removeAttribute\("title"\)/);
  assert.ok(!/tab-changes/.test(a.slice(a.indexOf("if (!me.person)"), a.indexOf("meReady();"))), "Forslag is not disabled");
});
test("a greyed tab is not a tab to go to (a tap on it does nothing and the fallback skips it), and one rule greys all of them", () => {
  assert.match(read("panel.js"), /\.filter\(b => !b\.hidden && !b\.disabled\)/);
  const c = read("sykehus.css"); assert.match(c, /\.dock \[data-tab\]:disabled \{ opacity: \.45; cursor: not-allowed; \}/); assert.ok(!/#tab-photo:disabled/.test(c), "one copy of the style");
  assert.ok(!/body\.anon #tab-chat\b/.test(c), "the Anton tab is no longer hidden signed out"); assert.ok(!/body\.anon \.dock\[data-tabs\] \{ --tabs: 2/.test(c), "three tabs show signed out (Forslag, Bygg, Anton)");
  assert.match(c, /body\.anon #p-chat, body\.anon #tab-photo/, "the conversation, the pill and Gjengi stay away signed out");
});
