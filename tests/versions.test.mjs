/* Versions of the after (versions.mjs) through the connector's tools: who may keep and change them.
   node --test tests/versions.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

const dir = mkdtempSync(join(tmpdir(), "sykehus-versions-"));
const tok = "test-token-morten-0123456789", tokFile = join(dir, "tokens.json");
writeFileSync(tokFile, JSON.stringify({ [createHash("sha256").update(tok).digest("hex")]: "morten" }));
process.env.SYKEHUS_TOKENS = tokFile; delete process.env.SYKEHUS_TRUST_REMOTE_USER;
const { createMcp } = await import("../mcp.mjs");
const { createVersions } = await import("../versions.mjs");
const site = JSON.parse(readFileSync(new URL("../public/data/site.json", import.meta.url)));
const floors = JSON.parse(readFileSync(new URL("../public/data/floors.json", import.meta.url))).floors;
const store = join(dir, "v");
const mcp = createMcp({ site, floors, versions: createVersions(store) });
const T = Object.fromEntries(mcp.TOOLS.map(t => [t.name, t.run]));
const req = (h = {}) => ({ headers: { host: "localhost:8090", ...h } });
const morten = req({ authorization: `Bearer ${tok}` });

test("trying needs no login, keeping does", async () => {
  const d = await T.try_change({ edits: [{ kind: "demolish", building: "Vestfløy" }] }, req());
  assert.equal(d.saved, false); assert.equal(d.added.length, 1);
  await assert.rejects(T.new_version({ title: "Uten innlogging" }, req()), /innlogging/);
  await assert.rejects(T.new_version({ title: "Feil token" }, req({ authorization: "Bearer not-the-right-token-xx" })), /innlogging/);
});

test("Remote-User counts only when the server is told to trust it", async () => {
  await assert.rejects(T.new_version({ title: "Forfalsket" }, req({ "remote-user": "lars" })), /innlogging/);
  process.env.SYKEHUS_TRUST_REMOTE_USER = "1";
  try { const v = await T.new_version({ title: "Lars sin" }, req({ "remote-user": "lars" })); assert.equal(v.owner, "lars"); }
  finally { delete process.env.SYKEHUS_TRUST_REMOTE_USER; }
});

test("a version from a draft, changed by its owner only, kept on disk", async () => {
  const d = await T.try_change({ edits: [{ kind: "demolish", building: "alle" }, { kind: "restore", building: "Sentralblokka" }] }, req());
  const v = await T.new_version({ title: "Bare tårnet", from: d.draft }, morten);
  assert.equal(v.owner, "morten"); assert.equal(v.changes, 2); assert.match(v.link, /\?versjon=v/);
  const r = await T.try_change({ version: v.version, edits: [{ kind: "volume", name: "Drivhus", shape: "triangle", from: [-46, -62], to: [27, -62], width: 24, height: 18 }] }, morten);
  assert.equal(r.saved, true); assert.equal(r.changes, 3); assert.equal(r.after.built[0].name, "Drivhus");
  process.env.SYKEHUS_TRUST_REMOTE_USER = "1";
  try { await assert.rejects(T.try_change({ version: v.version, edits: [{ kind: "restore", building: "alle" }] }, req({ "remote-user": "lars" })), /morten sin/); }
  finally { delete process.env.SYKEHUS_TRUST_REMOTE_USER; }
  await T.undo_change({ draft: v.version, n: 3 }, morten);
  const again = createVersions(store).get(v.version);
  assert.equal(again.edits.length, 2); assert.equal(again.title, "Bare tårnet");
  const all = await T.list_versions({}, req()); assert.ok(all.versions.some(x => x.version === v.version));
  const shown = await T.show_draft({ draft: v.version }, req()); assert.equal(shown.saved, true); assert.ok(shown.after.demolished.length > 10);
});
