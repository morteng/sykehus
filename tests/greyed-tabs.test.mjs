/* U3677 became «hidden» (Morten 2026-10-26 21:16Z «non-logged-in users … should not see greyed out anton, bygg or gjengi tabs in right pane, they should be hidden. keep it as simple and anonymous»):
   signed out, Bygg, Anton and Gjengi are not on the dock at all (Forslag is the one tab left); signed in nothing is changed. Run: node --test tests/greyed-tabs.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = f => readFileSync(new URL(`../public/${f}`, import.meta.url), "utf8");
test("signed out: Bygg, Anton and Gjengi are hidden, not greyed; Forslag is never touched; signed in nothing is hidden by this", () => {
  const a = read("anton.js"), out = a.slice(a.indexOf("if (!me.person)"), a.indexOf("meReady();"));
  assert.match(out, /for \(const id of \["tab-photo", "tab-selected", "tab-chat"\]\) \$\(id\)\.hidden = true;/);
  assert.ok(!/disabled|NEEDS_LOGIN/.test(out), "no greyed tab left");
  assert.match(out, /panel\.show\("changes", \{ quiet: true \}\);/, "a page that opens on a hidden tab falls back to Forslag");
  assert.ok(!/tab-changes/.test(out), "Forslag is not hidden");
  assert.ok(!/NEEDS_LOGIN/.test(a));
  const inn = a.slice(a.indexOf('document.body.classList.remove("anon")'), a.indexOf("chip.innerHTML = `<button type=\"button\" class=\"me\" id=\"meBtn\" aria-haspopup"));
  assert.match(inn, /\$\("tab-photo"\)\.hidden = false;/);
});
test("a hidden or greyed tab is not a tab to go to, and the pill, the composer and the feedback button stay away signed out", () => {
  assert.match(read("panel.js"), /\.filter\(b => !b\.hidden && !b\.disabled\)/);
  const c = read("sykehus.css"); assert.match(c, /\.dock \[data-tab\]:disabled \{ opacity: \.45; cursor: not-allowed; \}/);
  assert.match(c, /body\.anon #p-chat, body\.anon #tab-photo/);
});
