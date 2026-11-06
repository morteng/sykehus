// U4819: on a phone the guide's step 7 «Nytt bygg og Hent fil» is lit whole: the white #bstack (it holds the pill) is laid down, not only the pill.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const css = readFileSync(new URL("../public/sykehus.css", import.meta.url), "utf8");

test("U4819: under body.tour-bygg on a phone #bstack gets visibility: hidden", () => {
  const m = css.match(/@media \(max-width:\s*599px\)\s*\{\s*body\.tour-bygg #bstack\s*\{([^}]*)\}/);
  assert.ok(m, "the rule is in the phone media query and names #bstack");
  assert.match(m[1], /visibility:\s*hidden/);
  assert.ok(!/body\.tour-bygg #talk-form/.test(css), "hiding only the pill leaves the white box");
});
