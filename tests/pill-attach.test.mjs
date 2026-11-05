/* U4447: the Anton pill is [+][text][send]; the + is the kit's attach with Tegn, Last opp fil, Ta bilde. The separate «Tegn»
   button and #talkAttach are gone; the request body keeps picture / attachment (fieldsOf), so api/anton is untouched.
   Source checks (no DOM in this repo). node --test tests/pill-attach.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fieldsOf } from "../public/attach.js";

const read = p => readFileSync(new URL(`../public/${p}`, import.meta.url), "utf8");

test("the + menu shows three items, in Norwegian, and the old buttons are gone", () => {
  const js = read("anton.js"), html = read("index.html");
  const items = js.slice(js.indexOf("items: ["), js.indexOf("words: {", js.indexOf("items: ["))), labels = [...items.matchAll(/key: "[a-z]+", label: "([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(labels, ["Tegn", "Last opp fil", "Ta bilde"]);
  assert.match(js, /label: "Legg ved"/);
  assert.match(js, /import \{ attach as kitAttach \} from "\.\/kit\/attach\.js"/);
  assert.match(js, /import \{ takePhoto, cameraAvailable \} from "\.\/kit\/camera\.js"/);
  for (const gone of ["talkTegn", "talkAttach", "talkFile", "talkAtt"]) { assert.ok(!html.includes(`id="${gone}"`), gone); assert.ok(!js.includes(`$("${gone}")`), gone); }
  assert.ok(!/<button[^>]*>\s*(<svg.*?<\/svg>)?\s*Tegn\s*<\/button>/s.test(html), "no separate Tegn text button");
});

test("Tegn opens the existing draw mode and sends the drawing as before; the body keeps picture or attachment", () => {
  const js = read("anton.js");
  assert.match(js, /run: \(\) => \{ draw\(\); return null; \}/);
  assert.match(js, /import\("\.\/tegn\.js\?v=\d+a"\)\.then\(m => m\.startDrawing\(\{ viewer, labels: viewer\.labels, host: \$\("stage"\), send: \(text, drawing\) => sendIt\(\{ text, drawing \}\) \}\)\)/);
  assert.match(js, /json\("api\/anton", \{ text, version: version\(\), \.\.\.withIt, /);
  assert.deepEqual(fieldsOf({ picture: { image: "data:x", name: "a.png" } }), { picture: { image: "data:x", name: "a.png" } });
  assert.deepEqual(fieldsOf({ attachment: { file: "a".repeat(64), name: "x.ifc" } }), { attachment: { file: "a".repeat(64), name: "x.ifc" } });
  assert.deepEqual(fieldsOf(null), {});
});
