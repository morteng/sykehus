import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DOOR, DOOR_CODES, doorSentence } from "../public/kit/assistant-door.js";

/* U3976: the relay keeps to the kit's one contract with the assistant's door, and the page shows the kit's sentences. Fab takes the same
   file, so a forced busy error reads the same in both. A guard that cannot read the sources reds: it finds the import first. */
const read = f => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

test("the relay's numbers are the kit's, written nowhere else", () => {
  const src = read("assistant.mjs");
  assert.match(src, /from "\.\/public\/kit\/assistant-door\.js"/, "the guard did not find the kit import: it proves nothing");
  for (const name of ["WAITING", "LONGEST", "PER_10_MIN", "SILENCE", "PING", "BUSY_TRIES"]) assert.doesNotMatch(src, new RegExp(`\\b${name}\\s*=\\s*[0-9]`), `${name} is a literal: take it from the kit`);
  assert.equal(DOOR.busyTries, 60);
});

test("the page keeps no table of codes: it asks the kit, with the stream's errors as a turn's", () => {
  const src = read("public/anton.js");
  assert.match(src, /import \{ doorSentence \} from "\.\/kit\/assistant-door\.js"/);
  assert.doesNotMatch(src, /\b(approval_unknown|session_mismatch|queue_full)\s*:/, "a local table of the door's codes");
  assert.doesNotMatch(src, /\bCODES\b/);
  assert.match(src, /doorWords\(it\.code, true\)/);
});

test("a forced busy code reads the same sentence as in Fab's lobby (one table), and the four codes sykehus lacked are no longer «Noe gikk galt»", () => {
  assert.equal(doorSentence("busy", { lang: "nb", name: "Anton" }), "Anton er opptatt. Meldingen din venter.");
  const generic = doorSentence("internal", { lang: "nb", name: "Anton" });
  for (const c of ["queue_full", "session_mismatch", "not_found", "bad_request"]) { assert.ok(DOOR_CODES.includes(c)); assert.notEqual(doorSentence(c, { lang: "nb", name: "Anton" }), generic, c); }
});

test("the server's refusals use the kit's words", () => {
  const src = read("assistant.mjs");
  for (const c of ["too_long", "queue_full", "limit"]) assert.ok(src.includes(`words("${c}")`), c);
  assert.doesNotMatch(src, /Høyst \$\{LONGEST\}/);
});
