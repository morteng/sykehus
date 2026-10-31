import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../public/${p}`, import.meta.url), "utf8");

/* U3959: the input pill is the kit's (kit/kit.css .g-pill, kit/pill.js), the same as Fab's and the main app's. The markup wears
   its classes; no stylesheet of this app draws the pill's box, text box or buttons a second time; the page moves it with the kit. */
test("the pill is the kit's: the markup wears the kit classes, no copy of the box is left, the move is the kit's", () => {
  const html = read("index.html"), form = html.slice(html.indexOf('<form class="pill g-pill" id="talk-form"'), html.indexOf("</form>", html.indexOf('id="talk-form"')));
  for (const c of ["g-pill__mid", "g-pill__in", "g-pill__busy", "g-pill__go"]) assert.ok(form.includes(c), c);
  const css = read("sykehus.css") + read("fab/laser.css");
  assert.ok(!/(^|\n)\.pill\s*\{/.test(css), "a .pill box rule is left");
  assert.ok(!/\.pill textarea\s*\{/.test(css) && !/\.pill \.hist,\.pill \.round\{/.test(css), "a copy of the text box or the buttons is left");
  const kit = read("kit/kit.css");
  assert.ok(kit.includes(".g-pill{") && kit.includes(".g-pill__go{"));
  const js = read("anton.js");
  assert.ok(js.includes('import { movePill } from "./kit/pill.js"') && js.includes("movePill(form, to, { chat: open })"));
  assert.ok(/btn\.className = "round g-pill__go "/.test(js), "the send button keeps the kit class when it turns into Stop");
});
