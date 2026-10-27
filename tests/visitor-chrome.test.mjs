/* Visitor chrome (Morten 2026-10-27: «fix FOUC and tabs showing and hiding for non-logged in visitors»): the first paint is the visitor's page;
   signed-in-only items are hidden by CSS from html.anon, which me-hint.js sets before first paint; /api/meg reconciles it and writes the hint.
   The hint is never a permission (the server refuses a visitor's writes). Run: node --test tests/visitor-chrome.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
const read = f => readFileSync(new URL(`../public/${f}`, import.meta.url), "utf8");
const html = read("index.html"), css = read("sykehus.css"), hint = read("me-hint.js"), app = read("app.js"), anton = read("anton.js");

const run = storage => {
  const classes = new Set(), doc = { documentElement: { classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c) } } };
  vm.runInNewContext(hint, { document: doc, localStorage: storage });
  return classes;
};
const store = v => ({ getItem: k => (k === "sykehus-me" ? v : null) });

test("first paint: no hint, a «0» hint, a stray value or a throwing store is a visitor; only «1» is not", () => {
  for (const v of [null, "0", "", "yes", "true"]) assert.ok(run(store(v)).has("anon"), `hint ${JSON.stringify(v)} is a visitor`);
  assert.ok(run({ getItem() { throw new Error("blocked"); } }).has("anon"), "storage that throws counts as a visitor");
  assert.ok(!run(store("1")).has("anon"), "a browser that had a person signed in keeps its signed-in chrome from the first paint");
});

test("the hint is read inside try/catch and is a blocking external script in <head>, before the stylesheets (the edge CSP forbids inline script)", () => {
  assert.match(hint, /^try \{ if \(localStorage\.getItem\("sykehus-me"\) !== "1"\)[^\n]*\} catch/m);
  const head = html.slice(0, html.indexOf("</head>"));
  const tag = head.match(/<script src="me-hint\.js[^"]*"><\/script>/);
  assert.ok(tag, "me-hint.js is in <head>"); assert.ok(!/\b(defer|async|type="module")/.test(tag[0]), "blocking: it must run before first paint");
  assert.ok(head.indexOf(tag[0]) < head.indexOf('rel="stylesheet"'), "before the first stylesheet");
  assert.ok(!/<script>/.test(html), "no inline script anywhere on the page");
});

test("default state: html.anon hides every signed-in-only item and leaves one tab, Prosjekter", () => {
  const rule = css.match(/html\.anon #tab-selected[^{]*\{[^}]*\}/)?.[0] || "";
  for (const sel of ["#tab-selected", "#tab-chat", "#tab-photo", "#p-selected", "#p-chat", "#p-photo", "#pf", "#p-changes .bygg-acts", "#talk-form", "[data-ask]", ".g-chat", "#mfb"]) assert.ok(rule.includes(`html.anon ${sel}`), `${sel} is hidden for a visitor from the first paint`);
  assert.match(rule, /display: none !important/);
  assert.match(css, /html\.anon #dock \{ --tabs: 1 !important; \}/, "the dock has its one column at first paint, not four then one");
  assert.ok(!/html\.anon #(tab-changes|p-changes)\s*[,{]/.test(css), "Prosjekter is never hidden for a visitor");
  const tabs = [...html.matchAll(/role="tab" data-tab="(\w+)"/g)].map(m => m[1]);
  const hidden = ["selected", "chat", "photo"];
  assert.deepEqual(tabs.filter(t => !hidden.includes(t)), ["changes"]);
});

test("a visitor's DOM state: «Nytt prosjekt» and the panels are not made visible for a visitor by any script", () => {
  assert.match(app, /\$\("mnp"\)\.parentElement\.hidden = !me\.person;/);
  const out = anton.slice(anton.indexOf("if (!me.person)"), anton.indexOf("meReady();"));
  assert.match(out, /document\.documentElement\.classList\.add\("anon"\)/);
  assert.match(out, /for \(const id of \["tab-photo", "tab-selected", "tab-chat"\]\) \$\(id\)\.hidden = true;/);
  assert.ok(!/\.hidden = false;[^\n]*tab-(chat|selected|photo)|tab-(chat|selected|photo)[^\n]*\.hidden = false/.test(out), "the visitor branch shows none of them");
});

test("reconcile: /api/meg answers write the hint, and the signed-in branch lifts html.anon", () => {
  assert.match(app, /localStorage\.setItem\("sykehus-me", me\.person \? "1" : "0"\)/);
  assert.match(anton, /document\.documentElement\.classList\.remove\("anon"\); try \{ localStorage\.setItem\("sykehus-me", "1"\); \} catch/);
  assert.match(anton, /document\.documentElement\.classList\.add\("anon"\); try \{ localStorage\.setItem\("sykehus-me", "0"\); \} catch/);
  for (const m of app.matchAll(/localStorage\.setItem\("sykehus-me"[^\n]*/g)) assert.match(app.slice(app.lastIndexOf("try {", m.index), m.index), /^try \{/);
});

test("the hint is not a permission: nothing on the server side reads it, and the cache strings moved", () => {
  for (const f of ["../auth.mjs", "../gater.mjs", "../mcp.mjs"]) { try { assert.ok(!/sykehus-me/.test(readFileSync(new URL(f, import.meta.url), "utf8")), f); } catch (e) { if (e.code !== "ENOENT") throw e; } }
  assert.match(html, /app\.js\?v=2026\d+[a-z0-9]+/); assert.match(html, /sykehus\.css\?v=2026\d+[a-z0-9]+/);
  assert.match(app, /anton\.js\?v=2026\d+[a-z0-9]+/);
});
