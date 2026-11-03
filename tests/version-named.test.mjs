/* U3785: a message that names a version other than the open one reaches Anton with a note: read the named one, or say which version he works in.
   The real assistant with a stand-in door that stores the chat body. node --test tests/version-named.test.mjs */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { createVersions } from "../versions.mjs";
import { createAssistant, otherVersionNote } from "../assistant.mjs";

const versions = createVersions(mkdtempSync(join(tmpdir(), "sykehus-named-")));
const pages = { open: new Map(), show: () => false };
const open = versions.create("lars", "Nytt forslag"), mine = versions.create("lars", "Mitt etter");
const bodies = [];
const door = createServer((req, res) => { let s = ""; req.on("data", c => s += c); req.on("end", () => {
  if (req.url.endsWith("/chat")) { bodies.push(JSON.parse(s)); res.writeHead(200, { "content-type": "application/x-ndjson" }); return res.end(JSON.stringify({ type: "done" }) + "\n"); }
  res.writeHead(200, { "content-type": "application/json" }).end("{}"); }); });
await new Promise(ok => door.listen(0, ok));
after(() => { door.closeAllConnections?.(); door.close(); setTimeout(() => process.exit(0), 300).unref(); });
const login = { base: `http://localhost:${door.address().port}`, anton: true, bearer: "x", personOf: () => ({ person: "lars", device: "d1" }) };
const anton = createAssistant({ SECURITY: {}, readJson: async r => { let b = ""; for await (const c of r) b += c; return JSON.parse(b); }, login, versions, pages });
const post = body => new Promise(ok => { const req = { method: "POST", headers: { host: "x" }, [Symbol.asyncIterator]: async function* () { yield Buffer.from(JSON.stringify(body)); } };
  anton.route(req, { writeHead() {}, end: b => ok(JSON.parse(b)), write() {} }, "/api/anton"); });
const until = async f => { for (let i = 0; i < 300 && !f(); i++) await new Promise(ok => setTimeout(ok, 10)); assert.ok(f(), "timed out"); };

test("the same message on the same open draft: the door gets the named version's id and the sentence to say", async () => {
  const text = "Lag en trapp ned fra terrassen på Sentralblokka til hagen, i versjonen «Mitt etter».";
  await post({ text, version: open.id }); await until(() => bodies.length === 1);
  const m = bodies[0].message;
  assert.ok(m.startsWith(text)); assert.ok(m.includes(`«Mitt etter» (${mine.id})`)); assert.ok(m.includes(`«Nytt forslag» (${open.id})`));
  assert.ok(m.includes("show_draft target=<id>")); assert.ok(m.includes("Jeg jobber i «Nytt forslag», ikke «Mitt etter»"));
});

test("no other version named: the message goes as typed", async () => {
  await post({ text: "Lag en trapp i «Nytt forslag».", version: open.id }); await until(() => bodies.length === 2);
  assert.equal(bodies[1].message, "Lag en trapp i «Nytt forslag».");
  assert.equal(otherVersionNote("hei «Finnes ikke»", open, [open, mine]), "");
});
