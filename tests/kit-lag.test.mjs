import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

/* U3959: the kits pin must not drift (sykehus was 21 commits behind, the main app's tokens 51, and two pills looked different).
   tools/lag.mjs of the kits repo counts the commits of the lock's kit folder that kits main has after the lock's sha; more than
   10 is red. Exit 3 is «not measured» (no kits clone here: KITS_REPO, else ~/Projects/kits): the test is skipped and says so,
   it does not pass. Take the tip with `node <kits>/tools/take.mjs <sha> <lock>`. */
const KITS = process.env.KITS_REPO || join(homedir(), "Projects", "kits");
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));

function tool() {
  if (existsSync(join(KITS, "tools", "lag.mjs"))) return join(KITS, "tools", "lag.mjs");
  if (!existsSync(KITS)) return null;
  const shown = spawnSync("git", ["-C", KITS, "show", "origin/main:tools/lag.mjs"], { encoding: "utf8", env });   // a clone on another branch: kits main's tool
  if (shown.status !== 0) return null;
  const f = join(mkdtempSync(join(tmpdir(), "kit-lag-")), "lag.mjs");
  writeFileSync(f, shown.stdout);
  return f;
}

for (const lock of ["uikit.lock.json", "renderkit.lock.json"]) {
  test(`${lock} is at most 10 commits behind kits main`, (t) => {
    const lag = tool();
    if (!lag) return t.skip(`not measured: no kits clone with tools/lag.mjs at ${KITS} (set KITS_REPO)`);
    const r = spawnSync(process.execPath, [lag, new URL(`../${lock}`, import.meta.url).pathname, "--max", "10", "--repo", KITS], { encoding: "utf8", env });
    if (r.status === 3) return t.skip(r.stderr.trim());
    assert.equal(r.status, 0, (r.stdout + r.stderr).trim());
  });
}
