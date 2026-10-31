import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../public/${p}`, import.meta.url), "utf8");

/* U3977: the page shell and the toast are the kit's (uikit.lock.json: shell.css, toast.js). Nothing here carries a copy of Fab's stylesheet. */
test("the page takes the kit's shell, and there is no copy of Fab's stylesheet or a pin on one", () => {
  const html = read("index.html");
  assert.ok(html.indexOf('href="kit/shell.css') > html.indexOf('href="kit/kit.css') && html.indexOf('href="kit/shell.css') < html.indexOf('href="sykehus.css'), "kit.css, then shell.css, then the app's own");
  assert.ok(!/fab\/(laser|cardshell)\.css/.test(html), "the page links no copy");
  assert.equal(existsSync(new URL("../public/fab", import.meta.url)), false, "public/fab is gone");
  assert.equal(existsSync(new URL("./fab.test.mjs", import.meta.url)), false, "so is the test that pinned the copy");
  const shell = read("kit/shell.css");
  assert.ok(/\.appbar\{/.test(shell) && /aside\.side/.test(shell) && /\.talk-log\{/.test(shell), "the control: the shell has the app bar, the side panel and the talk log");
  const lock = JSON.parse(readFileSync(new URL("../uikit.lock.json", import.meta.url), "utf8"));
  assert.ok("shell.css" in lock.files && "toast.js" in lock.files);
});

test("the toast is the kit's: no element of its own, no #toast rule, one clock", () => {
  const app = read("app.js"), css = read("sykehus.css");
  assert.match(app, /import \{ toast as kitToast \} from "\.\/kit\/toast\.js";/);
  assert.ok(/kitToast\(\{ text, closeLabel: "Lukk", action: act, host: \$\("stage"\)/.test(app));
  assert.ok(!/id: "toast"/.test(app) && !/\$\("toast"\)/.test(app), "no toast element of its own");
  assert.ok(!/(^|\n)#toast/.test(css), "no #toast rule");
  assert.ok(!/setTimeout\([^)]*15000/.test(app), "no clock of its own");
});
