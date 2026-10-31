// U3973: a picture is shown through the stack's scaler (/px/) with the kit's picture helper (public/kit/picture.js), and nothing else.
// A raw <img>, new Image(), createElement("img") or a CSS url() background in the app's own code is a fault unless the file is
// listed in EXEMPT with its count and reason. A new site, or a new file, turns this red. Take a site OUT of EXEMPT when it moves to
// the helper; never add one to get green. A picture file over 20 KB in public/ is served as it is only when listed in BIG_OK.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";

const ROOT = join(import.meta.dirname, "..");
const PUB = join(ROOT, "public");
const RAW = /<img\b|createElement\(["']img["']\)|new Image\(/;
const CSS_RAW = /background(?:-image)?\s*:[^;{}]*url\(/;
const SKIP = /^(public\/(kit|renderkit|vendor)\/|public\/(three|jsqr))|(^|\/)(node_modules|tests|\.git)\//;
const LOCAL = "a picture made in this browser (snapshot, upload preview, the drawing the person sent, a data: address): nothing to scale on a server";
const EXEMPT = {
  "public/app.js": [4, "snapshots are LOCAL; the drawn sheet and the wish thumbnails are static 64 px WebP"],
  "public/anton.js": [2, LOCAL],
  "public/fasade-view.js": [1, LOCAL],
  "public/gjengi.js": [1, LOCAL + " (the compare view's data: address, in pic())"],
  "public/mcp-app.js": [1, LOCAL],
  "public/prospekt-view.js": [1, "the lightbox's own element: prospekt-pane.js sets its src with ownScaled() at 1600 px"],
  "public/sitephotos.js": [1, LOCAL],
  "public/tegn.js": [1, LOCAL],
  "public/viewer.js": [1, LOCAL],
};
const BIG_OK = {
  "public/renderkit/": "PBR textures, loaded by three.js as textures (not <img>)",
  "public/data/ark/": "the sheets' archive thumbnails, 21-26 KB each (tools/thumbs.py), at their shown size already",
  "public/data/skann/": "the scanned sheets the tracing tool reads at full size (trace.js)",
  "public/data/snitt/": "the drawn sections: the panel shows a scaled copy (app.js drawnList); these are the full sheets behind «Åpne tegningen stor»",
  "public/icons/icon-512.png": "the manifest icon",
  "public/tex-grass.jpg": "the terrain's grass texture, loaded by three.js",
};
const IMG_EXT = /\.(png|jpe?g|webp|avif|gif|hdr)$/i;

function walk(dir, out = []) {
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, f.name);
    if (f.isDirectory()) { if (!SKIP.test(relative(ROOT, p) + "/")) walk(p, out); } else out.push(p);
  }
  return out;
}

export function sites() {
  const out = {};
  for (const p of [...walk(PUB), ...readdirSync(ROOT).filter((f) => /\.mjs$/.test(f)).map((f) => join(ROOT, f))]) {
    const rel = relative(ROOT, p);
    if (SKIP.test(rel) || !/\.(js|mjs|html|css)$/.test(rel)) continue;
    const rx = rel.endsWith(".css") ? CSS_RAW : RAW;
    const n = readFileSync(p, "utf8").split("\n").filter((l) => rx.test(l) && !/^\s*(\/\/|\*|\/\*)/.test(l)).length;
    if (n) out[rel] = n;
  }
  return out;
}

test("the instrument sees a raw picture (the control: zero matches is not an absence)", () => {
  assert.ok(Object.keys(sites()).length > 0, "no raw picture site found anywhere: the search is broken, not the app clean");
  for (const s of ['<img src="/a.jpg">', 'document.createElement("img")', "new Image()"]) assert.ok(RAW.test(s), s);
  assert.ok(CSS_RAW.test("a{background: url(/x.png) no-repeat}"));
});

test("no picture skips the helper", () => {
  const bad = Object.entries(sites()).filter(([f, n]) => n > (EXEMPT[f]?.[0] ?? 0)).map(([f, n]) => `${f}: found ${n}, allowed ${EXEMPT[f]?.[0] ?? 0}`);
  assert.deepEqual(bad, [], "show a picture with picture() from public/kit/picture.js; a person's own picture goes through ownPictureHTML() (the route redirects to a signed address, px.mjs); EXEMPT is for a picture made in this browser");
});

test("an exemption is still needed", () => {
  const seen = sites();
  const stale = Object.entries(EXEMPT).filter(([f, [n]]) => (seen[f] ?? 0) < n).map(([f, [n]]) => `${f}: listed ${n}, found ${seen[f] ?? 0}`);
  assert.deepEqual(stale, [], "EXEMPT lists more sites than exist: lower it");
});

test("no picture over 20 KB in public/ is served as it is", () => {
  const big = walk(PUB).filter((p) => IMG_EXT.test(p) && statSync(p).size > 20 * 1024).map((p) => relative(ROOT, p))
    .filter((rel) => !Object.keys(BIG_OK).some((k) => rel === k || (k.endsWith("/") && rel.startsWith(k))));
  assert.deepEqual(big, [], "show it with the helper or list it in BIG_OK with why");
});
