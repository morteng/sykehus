#!/usr/bin/env node
// Take hagekart's plant list into sykehus at one sha (U3659): one copy, from the repo that owns it.
//   node tools/take-plants.mjs <hagekart sha>     read public/plants.json at that sha (git show, never a checkout),
//                                                 write public/hagekart-plants.js and hagekart-plants.lock.json
//   node tools/take-plants.mjs --check            fail when the copy is not the file at the lock's sha (blob id)
// The copy is hagekart's file as it is, set after `export default ` so the page and the server can import it at once
// (a JSON import is not safe in every browser). public/plants.js reads it and keeps what sykehus draws.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), ".."), LOCK = join(ROOT, "hagekart-plants.lock.json"), COPY = join(ROOT, "public", "hagekart-plants.js");
const REPO = process.env.HAGEKART_REPO || join(process.env.HOME, "Projects", "hagekart"), FILE = "public/plants.json", HEAD = "export default ";
export const blobId = text => createHash("sha1").update(`blob ${Buffer.byteLength(text)}\0`).update(text).digest("hex");
export const wrap = (sha, text) => `/* hagekart's ${FILE} at ${sha}, taken by tools/take-plants.mjs (U3659). Do not edit: take again. */\n${HEAD}${text.replace(/\n$/, "")};\n`;
export const unwrap = copy => { const i = copy.indexOf(HEAD); return copy.slice(i + HEAD.length).replace(/;\n$/, "") + "\n"; };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = process.argv[2];
  if (arg === "--check") {
    const lock = JSON.parse(readFileSync(LOCK, "utf8")), got = blobId(unwrap(readFileSync(COPY, "utf8")));
    if (got !== lock.blob) { console.error(`public/hagekart-plants.js is not hagekart's ${FILE} at ${lock.hagekart}: blob ${got}, the lock says ${lock.blob}. Take again; do not edit the copy.`); process.exit(1); }
    console.log(`ok: ${FILE} at ${lock.hagekart}`);
  } else if (/^[0-9a-f]{7,40}$/.test(arg || "")) {
    const sha = execFileSync("git", ["-C", REPO, "rev-parse", arg], { encoding: "utf8" }).trim(), text = execFileSync("git", ["-C", REPO, "show", `${sha}:${FILE}`], { encoding: "utf8", maxBuffer: 1 << 26 });
    JSON.parse(text);
    writeFileSync(COPY, wrap(sha, text)); writeFileSync(LOCK, JSON.stringify({ hagekart: sha, file: FILE, copy: "public/hagekart-plants.js", blob: blobId(text) }, null, 2) + "\n");
    console.log(`took ${FILE} at ${sha}`);
  } else { console.error("usage: take-plants.mjs <hagekart sha> | --check"); process.exit(2); }
}
