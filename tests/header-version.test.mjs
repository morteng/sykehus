/* U3565: the version card leads the header (the site name after it, smaller); the card over a pick ends above the pill and
   keeps «Ferdig» in view; «Angre siste» names what it takes out.   node --test tests/header-version.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const f = p => readFileSync(new URL(`../public/${p}`, import.meta.url), "utf8");
test("the version card comes before the site name in the header", () => {
  const h = f("index.html");
  assert.ok(h.indexOf('class="wherebar"') > 0 && h.indexOf('class="wherebar"') < h.indexOf('class="brand"'));
});
test("the card over a pick has the pill's top as its floor and scrolls; Ferdig is sticky", () => {
  const j = f("float.js"), c = f("sykehus.css");
  assert.match(j, /floor = pill \? Math\.min\(H, pill\[1\] - 8\)/);
  assert.match(j, /el\.style\.maxHeight/);
  assert.match(j, /floor - h - 8/);
  assert.match(c, /\.fl \.fl-form \.fl-acts \{ position: sticky/);
});
test("«Angre siste» says what it removes", () => {
  assert.match(f("app.js"), /<span>Ta ut «\$\{esc\(short\(draft\.edits\[n - 1\]\)\)\}»<\/span>/);
});
