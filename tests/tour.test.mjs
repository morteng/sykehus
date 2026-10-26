/* «Omvisning» (U3528, public/tour.js): the steps say what they show in a few plain sentences, each about a part that
   is on the page; the tour ends on the button that starts it again.
   node --test tests/tour.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { steps } from "../public/tour.js";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const hooks = { home() {}, pick() {}, unpick() {}, tab() {}, phone: () => false };

test("the steps: welcome first, the restart button last, short and plain, each part on the page", () => {
  const l = steps(hooks);
  assert.equal(l[0].el, undefined, "the welcome stands in the middle");
  assert.equal(l.at(-1).el, "#tourBtn");
  assert.ok(l.length >= 10 && l.length <= 14, `${l.length} steps`);
  for (const s of l) {
    assert.ok(s.title && s.text.length < 400, s.title);
    assert.ok(!/\b(han|hun|ham|henne|hans|hennes)\b/i.test(s.text), `«${s.title}»: Anton is named, not given a pronoun`);
    if (typeof s.el === "string") assert.match(html, new RegExp(`id="${s.el.slice(1)}"`), `${s.el} is in index.html`);
  }
  const ids = ["m3d", "p-selected", "tab-chat", "talk-form", "p-changes", "tab-changes", "tab-selected"];
  for (const id of ids) assert.match(html, new RegExp(`id="${id}"`), id);
});
