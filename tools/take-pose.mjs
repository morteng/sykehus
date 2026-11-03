#!/usr/bin/env node
// Take hagekart's pose.js and anchor.js (fix a photo from known roof lines) into sykehus at one sha (U3824): one copy,
// from the repo that owns it, byte for byte. The lock keeps the sha and each file's blob id.
//   node tools/take-pose.mjs <hagekart sha>   git show each file at that sha (never a checkout); write public/ and hagekart-pose.lock.json
//   node tools/take-pose.mjs --check          fail when a copy is not the file at the lock's sha
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), ".."), LOCK = join(ROOT, "hagekart-pose.lock.json");
const REPO = process.env.HAGEKART_REPO || join(process.env.HOME, "repos", "gulden-no", "stack", "hagekart");
export const FILES = ["pose.js", "anchor.js"];
export const blobId = text => createHash("sha1").update(`blob ${Buffer.byteLength(text)}\0`).update(text).digest("hex");

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = process.argv[2];
  if (arg === "--check") {
    const lock = JSON.parse(readFileSync(LOCK, "utf8")); let bad = 0;
    for (const f of FILES) {
      const got = blobId(readFileSync(join(ROOT, "public", f), "utf8"));
      if (got !== lock.blobs[f]) { console.error(`public/${f} is not hagekart's public/${f} at ${lock.hagekart}: blob ${got}, the lock says ${lock.blobs[f]}. Take again; do not edit the copy.`); bad++; }
    }
    if (bad) process.exit(1);
    console.log(`ok: ${FILES.join(", ")} at ${lock.hagekart}`);
  } else if (/^[0-9a-f]{7,40}$/.test(arg || "")) {
    const sha = execFileSync("git", ["-C", REPO, "rev-parse", arg], { encoding: "utf8" }).trim(), blobs = {};
    for (const f of FILES) {
      const text = execFileSync("git", ["-C", REPO, "show", `${sha}:./public/${f}`], { encoding: "utf8", maxBuffer: 1 << 26 });
      writeFileSync(join(ROOT, "public", f), text); blobs[f] = blobId(text);
    }
    writeFileSync(LOCK, JSON.stringify({ hagekart: sha, files: FILES.map(f => `public/${f}`), blobs }, null, 2) + "\n");
    console.log(`took ${FILES.join(", ")} at ${sha}`);
  } else { console.error("usage: take-pose.mjs <hagekart sha> | --check"); process.exit(2); }
}
