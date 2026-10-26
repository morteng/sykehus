import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

/* the kit's files (uikit.lock.json, taken by kits tools/take.mjs): each copy is the kit's file at the lock's sha, by
   git's blob id; none of them imports anything, so a copy is the file itself */
test("public/kit holds the kit's files at the lock's sha", () => {
  const lock = JSON.parse(readFileSync(new URL("../uikit.lock.json", import.meta.url), "utf8"));
  assert.ok(Object.keys(lock.files).length >= 4);
  for (const [name, id] of Object.entries(lock.files)) {
    const buf = readFileSync(new URL(`../${lock.dest}/${name}`, import.meta.url));
    assert.equal(createHash("sha1").update(`blob ${buf.length}\0`).update(buf).digest("hex"), id, name);
  }
});

/* U3830: the Anton log follows its end through the kit (kit/follow.js), on the element that really scrolls. fab/laser.css gives
   .talk-log overflow-y:auto and the flex rest of the tab; #talk is visible-overflow and never scrolls, so scrolling it (the
   old toEnd) did nothing. The pill lives in #talk, which sykehus.css makes the positioned host. */
test("anton.js follows the log (#talkLog, the scroller) with the kit, and nothing scrolls #talk", () => {
  const src = readFileSync(new URL("../public/anton.js", import.meta.url), "utf8");
  assert.match(src, /import \{ follow \} from "\.\/kit\/follow\.js";/);
  assert.match(src, /follow\(log, \{ label: "Til nyeste", host: \$\("talk"\) \}\)/);
  assert.match(src, /log = \$\("talkLog"\)/);
  assert.doesNotMatch(src, /\$\("talk"\)\.scrollTop|t\.scrollTop = t\.scrollHeight/);
  const css = readFileSync(new URL("../public/fab/laser.css", import.meta.url), "utf8");
  assert.match(css, /\.talk-log\{[^}]*overflow-y:auto/);
  assert.match(readFileSync(new URL("../public/sykehus.css", import.meta.url), "utf8"), /#p-chat #talk \{ position: relative; \}/);
});
