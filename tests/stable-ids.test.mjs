/* S1: a new building keeps its id. Before, an id was its place in the replay (volum-N), so a demolish moved the later ones and
   the next unnamed building could land on an existing one. node --test tests/stable-ids.test.mjs */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { checkEdit, applyEdits } from "../public/edits.js";
import { stampVolumeIds, nextVolumeId, deadEdits } from "../public/design.js";
import { createVersions } from "../versions.mjs";

const site = JSON.parse(readFileSync(new URL("../public/data/site.json", import.meta.url)));
const floors = JSON.parse(readFileSync(new URL("../public/data/floors.json", import.meta.url))).floors;
const vol = (i, extra = {}) => ({ kind: "volume", name: `Hus ${i}`, shape: "box", from: [-60 + i * 12, -70], to: [-52 + i * 12, -70], width: 6, height: 4, ...extra });
const legacy = () => {   // the old shape: no ids, a demolish in the middle, a volume after it
  const ed = [];
  for (const e of [vol(1), vol(2), vol(3), vol(4), vol(5), { kind: "demolish", building: "volum-3" }, vol(6), vol(7)]) { const m = applyEdits(site, floors, ed); ed.push(e.kind === "volume" ? checkEdit(m.site, m.floors, e) : e); }
  return ed;
};
const seen = edits => (applyEdits(site, floors, edits).site.added || []).map(a => [a.id, a.name]);

test("the migrated replay equals the old replay, and running it again changes nothing", () => {
  const old = legacy(), before = seen(old), mig = JSON.parse(JSON.stringify(old));
  assert.ok(old.filter(e => e.kind === "volume").every(e => e.id == null), "the fixture has no ids, as the stored versions do");
  assert.equal(stampVolumeIds(mig), true);
  assert.deepEqual(mig.filter(e => e.kind === "volume").map(e => e.id), ["volum-1", "volum-2", "volum-3", "volum-4", "volum-5", "volum-5", "volum-5"], "today's rule, read off the replay (volum-6 and -7 each land on volum-5: the bug, kept as it meant)");
  assert.deepEqual(seen(mig), before, "same buildings, same ids, same names");
  const again = JSON.stringify(mig); assert.equal(stampVolumeIds(mig), false); assert.equal(JSON.stringify(mig), again);
});

test("after a demolish of volum-5 the later ids hold and a new unnamed building never overwrites", () => {
  const ed = [vol(1), vol(2), vol(3), vol(4), vol(5), vol(6)].map((e, i) => ({ ...e, id: `volum-${i + 1}` }));
  ed.push({ kind: "demolish", building: "volum-5" });
  const ids = () => seen(ed).map(x => x[0]);
  assert.deepEqual(ids(), ["volum-1", "volum-2", "volum-3", "volum-4", "volum-6"]);
  const id = nextVolumeId(ed); assert.equal(id, "volum-7"); assert.ok(!ids().includes(id));
  ed.push({ ...vol(9), id });
  assert.deepEqual(ids(), ["volum-1", "volum-2", "volum-3", "volum-4", "volum-6", "volum-7"], "nothing overwritten");
  assert.equal(seen(ed).find(x => x[0] === "volum-6")[1], "Hus 6");
});

test("deadEdits: a torn-down new building, what was done to it and the demolish; one made again under the id is live", () => {
  const ed = [{ ...vol(1), id: "volum-1" }, { kind: "reshape", id: "volum-1", height: 6 }, { ...vol(2), id: "volum-2" }, { kind: "demolish", building: "volum-1" }, { ...vol(3), id: "volum-1" }];
  assert.deepEqual(deadEdits(ed), [0, 1, 3]);
});

test("versions.mjs writes the ids once, only when an edit lacks one", () => {
  const dir = mkdtempSync(join(tmpdir(), "sykehus-stable-")), id = "vAAAAAAAA", f = join(dir, id + ".json");
  const rec = { id, owner: "lars", title: "Gammel", edits: legacy(), sharing: "privat", key: "k", own: "o", created: "2026-10-01T00:00:00.000Z", updated: "2026-10-01T00:00:00.000Z" };
  writeFileSync(f, JSON.stringify(rec));
  const v1 = createVersions(dir).get(id);
  assert.ok(v1.edits.filter(e => e.kind === "volume").every(e => e.id), "stamped on load");
  assert.equal(JSON.parse(readFileSync(f, "utf8")).edits.filter(e => e.kind === "volume").every(e => e.id), true, "and written");
  const at = statSync(f).mtimeMs, text = readFileSync(f, "utf8"); createVersions(dir);
  assert.equal(readFileSync(f, "utf8"), text); assert.equal(statSync(f).mtimeMs, at, "the second load writes nothing");
});

/* S1b / S1c through the tool, a draft */
const PORT = 19000 + Math.floor(Math.random() * 900), BASE = `http://localhost:${PORT}`;
const srv = spawn(process.execPath, [new URL("../server.mjs", import.meta.url).pathname], { env: { ...process.env, PORT: String(PORT) }, stdio: ["ignore", "pipe", "inherit"] });
await new Promise(ok => srv.stdout.on("data", d => String(d).includes("Sykehustomta on") && ok()));
after(() => srv.kill());
let n = 0;
const call = async (name, args) => { const r = await (await fetch(`${BASE}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++n, method: "tools/call", params: { name, arguments: { include_screenshot: false, ...args } } }) })).json(); return r.result; };
const draftEdits = async d => (await call("show_draft", { draft: d })).structuredContent;

test("try_change stamps ids; tearing down a new building takes its edits out instead of adding a demolish", async () => {
  const r1 = (await call("try_change", { edits: [vol(1), vol(2), vol(3)] })).structuredContent, d = r1.draft;
  assert.deepEqual(r1.added.map(a => a.id), ["volum-1", "volum-2", "volum-3"]);
  await call("try_change", { draft: d, edits: [{ kind: "reshape", id: "volum-2", height: 7 }] });
  const r3 = (await call("try_change", { draft: d, edits: [{ kind: "demolish", building: "volum-2" }] })).structuredContent;
  assert.equal(r3.applied, 1); assert.equal(r3.changes_in_draft, 3 + 1 - 2, "volume 2 and its reshape are gone, no demolish was added");
  assert.match(r3.added[0].replaced, /Hus 2/);
  const r4 = (await call("try_change", { draft: d, edits: [vol(8)] })).structuredContent;
  assert.deepEqual(r4.added.map(b => b.id), ["volum-4"], "a later unnamed building takes a fresh id");
  const all = (await call("show_draft", { draft: d })).structuredContent;
  assert.deepEqual((all.after?.built || []).map(b => b.id).sort(), ["volum-1", "volum-3", "volum-4"]);
});
