/* U3657: the conversation over the pill: when it shows (the kit's rule) and the height it is remembered at (the kit's stored size, held to the view) */
import { test } from "node:test";
import assert from "node:assert/strict";
import { sheetShown } from "../public/kit/chat.js";
import { readWidth, saveWidth, clampWidth } from "../public/kit/split.js";
import { readFileSync } from "node:fs";

test("shown with something said and the Anton tab shut; not empty-handed, not beside the tab's own list", () => {
  assert.equal(sheetShown(0, false), false);   // an empty conversation: the pill as before
  assert.equal(sheetShown(4, false), true);
  assert.equal(sheetShown(4, true), false);    // the tab is open: the list is there
});

test("the stored height: held to 120 px and 60 % of the view (50 % on a phone), rubbish is none, a reset forgets it", () => {
  const m = new Map(), st = { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
  saveWidth(st, "sykehus-samtalehoyde", 333); assert.equal(readWidth(st, "sykehus-samtalehoyde", 800, 120, 0.6), 333);
  assert.equal(readWidth(st, "sykehus-samtalehoyde", 400, 120, 0.6), 240, "a smaller view holds it to 60 %");
  assert.equal(readWidth(st, "sykehus-samtalehoyde", 400, 120, 0.5), 200, "a phone: half");
  assert.equal(clampWidth(40, 800, 120, 0.6), 120);
  m.set("sykehus-samtalehoyde", "tall"); assert.equal(readWidth(st, "sykehus-samtalehoyde", 800, 120, 0.6), null);
  saveWidth(st, "sykehus-samtalehoyde", null); assert.equal(m.has("sykehus-samtalehoyde"), false);
});

test("the page wires the kit's sheet with that key and takes the tab's list and button, not a copy", () => {
  const a = readFileSync(new URL("../public/anton.js", import.meta.url), "utf8");
  assert.match(a, /chatSheet\(\{ host: \$\("bstack"\), log, actions: \$\("chat-top"\)/);
  assert.match(a, /key: "sykehus-samtalehoyde"/);
  assert.match(a, /sheetShown\(log\.children\.length, chatOpen\(\)\)/);
});

test("U3787: «Ny samtale» says it starts a new one and that Anton can look up the old ones, in the button and in the tour", () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8"), tour = readFileSync(new URL("../public/tour.js", import.meta.url), "utf8");
  const b = /<button[^>]*id="talkNew"[^>]*>/.exec(html)?.[0] ?? "";
  assert.ok(b.includes('title="Starter en ny samtale. Anton kan slå opp i de gamle når du viser til dem."'));
  assert.ok(b.includes('aria-label="Ny samtale"'), "the name of the button is unchanged"); assert.ok(!/glemmer/.test(b + tour), "nothing says Anton forgets");
  assert.ok(tour.includes("«Ny samtale» starter en ny samtale. Anton kan slå opp i de gamle når du viser til dem."));
});
