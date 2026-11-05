import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../public/${p}`, import.meta.url), "utf8");

/* U3959: the input pill is the kit's (kit/kit.css .g-pill, kit/pill.js), the same as Fab's and the main app's. The markup wears
   its classes; no stylesheet of this app draws the pill's box, text box or buttons a second time; the page moves it with the kit. */
test("the pill is the kit's (U4487): the page has no pill markup, anton.js makes it with antonPill, no stylesheet of this app draws its box, the move is the kit's", () => {
  const html = read("index.html");
  assert.ok(!html.includes('id="talk-form"') && !html.includes('id="talkIn"') && !html.includes('id="talkSend"'), "a hand-made pill is left in the page");
  const css = read("sykehus.css") + read("kit/shell.css");
  assert.ok(!/(^|\n)\.pill\s*\{/.test(css), "a .pill box rule is left");
  assert.ok(!/\.pill textarea\s*\{/.test(css) && !/\.pill \.hist,\.pill \.round\{/.test(css), "a copy of the text box or the buttons is left");
  const kit = read("kit/kit.css");
  assert.ok(kit.includes(".g-pill{") && kit.includes(".g-pill__go{") && kit.includes(".g-anton"));
  const js = read("anton.js");
  assert.ok(js.includes('import { movePill } from "./kit/pill.js"') && js.includes("movePill(form, to, { chat: open })"));
  assert.ok(js.includes('import { antonPill } from "./kit/anton-pill.js"') && /const pill = antonPill\(\{/.test(js));
  assert.ok(/classList\.add\("is-stop", "stop", "working"\)/.test(js), "the send button keeps the kit class and turns into Stop");
});
