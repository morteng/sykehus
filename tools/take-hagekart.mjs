#!/usr/bin/env node
// Take hagekart's shared logic into sykehus at one sha (U3820, U3822, U3824): one copy, from the repo that owns it.
//   node tools/take-hagekart.mjs <gulden-no sha>   read stack/hagekart/public/<file> at that sha (git show, never a checkout),
//                                                  write public/hagekart/<file> and hagekart.lock.json
//   node tools/take-hagekart.mjs --check           fail when a copy is not the file at the lock's sha (git blob id)
// biome.js (a bed fills itself), history.js (one undo and redo), merge.js (three-way merge of a plan changed on two devices),
// walk.js, anchor.js, pose.js (GPS and compass walk; fix a photo from known roof lines) and what they import (detect.js, catalog.js).
// The brush geometry (paint.js) is already the render kit's (public/renderkit/paint.js). A copy is the file with one import
// path pointed at sykehus's render kit ("map" in the lock) and nothing else changed; --check undoes that and compares the blob id.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), ".."), LOCK = join(ROOT, "hagekart.lock.json");
const REPO = process.env.HAGEKART_REPO || join(process.env.HOME, "repos", "gulden-no");
export const FROM = "stack/hagekart/public", DEST = "public/hagekart";
export const FILES = ["biome.js", "history.js", "merge.js", "walk.js", "catalog.js", "anchor.js", "pose.js", "detect.js"];
export const MAP = { "./renderkit/paths2d.js": "../renderkit/paths2d.js" };
export const blobId = text => createHash("sha1").update(`blob ${Buffer.byteLength(text)}\0`).update(text).digest("hex");
const swap = (text, map) => text.replace(/(\bfrom\s*|\bimport\s*\(?\s*)(['"])([^'"\n]+)\2/g, (m, pre, q, spec) => Object.hasOwn(map, spec) ? `${pre}${q}${map[spec]}${q}` : m);
export const rewrite = text => swap(text, MAP);
export const original = text => swap(text, Object.fromEntries(Object.entries(MAP).map(([k, v]) => [v, k])));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = process.argv[2];
  if (arg === "--check") {
    const lock = JSON.parse(readFileSync(LOCK, "utf8")); let bad = 0;
    for (const [f, blob] of Object.entries(lock.files)) {
      const got = blobId(original(readFileSync(join(ROOT, DEST, f), "utf8")));
      if (got !== blob) { console.error(`${DEST}/${f} is not hagekart's ${f} at ${lock.hagekart}: blob ${got}, the lock says ${blob}. Take again; do not edit the copy.`); bad++; }
    }
    if (bad) process.exit(1);
    console.log(`ok: ${Object.keys(lock.files).length} files at ${lock.hagekart}`);
  } else if (/^[0-9a-f]{7,40}$/.test(arg || "")) {
    const sha = execFileSync("git", ["-C", REPO, "rev-parse", arg], { encoding: "utf8" }).trim(), files = {};
    mkdirSync(join(ROOT, DEST), { recursive: true });
    for (const f of FILES) {
      const text = execFileSync("git", ["-C", REPO, "show", `${sha}:${FROM}/${f}`], { encoding: "utf8", maxBuffer: 1 << 26 });
      writeFileSync(join(ROOT, DEST, f), rewrite(text)); files[f] = blobId(text);
    }
    writeFileSync(LOCK, JSON.stringify({ hagekart: sha, from: FROM, dest: DEST, map: MAP, files }, null, 2) + "\n");
    console.log(`took ${FILES.length} files at ${sha}`);
  } else { console.error("usage: take-hagekart.mjs <gulden-no sha> | --check"); process.exit(2); }
}
