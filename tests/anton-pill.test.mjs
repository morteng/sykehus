/* U4487: the Anton pill is the kit's (kit/anton-pill.js, class g-anton), not a copy. Source checks (no DOM in this repo):
   the element comes from the kit, the items are in order (New chat first, from onNewChat), and a send posts the body it did
   before: text, version, picture or attachment, selection. node --test tests/anton-pill.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = p => readFileSync(new URL(`../public/${p}`, import.meta.url), "utf8");

test("the pill element is the kit's g-anton form; the page and the app's script draw no pill of their own", () => {
  const kit = read("kit/anton-pill.js"), js = read("anton.js"), html = read("index.html");
  assert.ok(kit.includes('"g-pill g-anton"'));
  assert.match(js, /const pill = antonPill\(\{\s+host: \$\("bstack"\)/);
  assert.match(js, /const form = pill\.el, input = pill\.input/);
  assert.ok(!/createElement\("form"\)|<form[^>]*pill/.test(js + html), "a second pill");
});

test("the + menu: New chat first, then Tegn, Last opp fil, Ta bilde, in this order", () => {
  const js = read("anton.js"), kit = read("kit/anton-pill.js");
  assert.ok(kit.indexOf('key: "new-chat"') < kit.indexOf("for (const { id, ...rest } of o.items)"), "the kit puts New chat before the app's items");
  const a = js.indexOf("antonPill({"), block = js.slice(a, js.indexOf("onSend:", a));
  assert.deepEqual([...block.matchAll(/id: "([a-z]+)", label: "([^"]+)"/g)].map(m => m[2]), ["Tegn", "Last opp fil", "Ta bilde"]);
  assert.match(block, /onNewChat: \(\) => newChat\(\)/);
  assert.match(block, /newChat: "Ny samtale"/);
});

test("a send posts api/anton with text, version, the picture or attachment field, and the selection, as before; a drawing posts point and drawing", () => {
  const js = read("anton.js");
  const post = js.slice(js.indexOf("async function post("), js.indexOf("async function sendIt("));
  assert.match(post, /json\("api\/anton", \{ text, version: version\(\), \.\.\.extra, \.\.\.\(sel \? \{ selection: sel \} : \{\}\) \}\)/);
  const send = js.slice(js.indexOf("async function pillSend("));
  assert.match(send, /\{ picture: await pictureOf\(/); assert.match(send, /\{ attachment: await uploadFile\(/);
  assert.match(send, /post\(text \|\| "Se på det jeg la ved\.", withIt, true\)/);
  const drawn = js.slice(js.indexOf("async function sendIt("), js.indexOf("async function pillSend("));
  assert.match(drawn, /\.\.\.\(drawn\.point \? \{ point: drawn\.point \} : \{\}\), \.\.\.\(drawn\.drawing \? \{ drawing: drawn\.drawing \} : \{\}\)/);
});
