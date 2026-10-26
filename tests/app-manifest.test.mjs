/* U3813: the page installs from the iPad home screen: a manifest the server serves as such, linked from the page, with the
   tags iOS reads, and the CSS that keeps the bars out from under the notch and the home indicator. */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";

const read = f => readFileSync(new URL(f, import.meta.url), "utf8");
const PORT = 9000 + Math.floor(Math.random() * 900), O = `http://localhost:${PORT}/`;
const srv = spawn(process.execPath, [new URL("../server.mjs", import.meta.url).pathname], { env: { ...process.env, PORT: String(PORT) }, stdio: ["ignore", "pipe", "inherit"] });
await new Promise(ok => srv.stdout.on("data", d => String(d).includes("Sykehustomta on") && ok()));
after(() => srv.kill());

test("the manifest is served as a manifest and says standalone, with icons that exist", async () => {
  const r = await fetch(O + "manifest.webmanifest"); assert.equal(r.status, 200); assert.match(r.headers.get("content-type"), /^application\/manifest\+json/);
  const m = await r.json(); assert.deepEqual([m.name, m.display, m.start_url, m.scope], ["Sykehustomta", "standalone", "/", "/"]);
  assert.deepEqual(m.icons.map(i => i.sizes).sort(), ["192x192", "512x512"]);
  for (const i of m.icons) { const png = await fetch(O + i.src.slice(1)); assert.equal(png.headers.get("content-type"), "image/png"); }
});

test("the page links the manifest, asks for the whole screen and carries the iOS tags", () => {
  const h = read("../public/index.html");
  assert.match(h, /<link rel="manifest" href="manifest\.webmanifest">/);
  assert.match(h, /name="viewport"[^>]*viewport-fit=cover/);
  for (const t of ['apple-mobile-web-app-capable" content="yes', 'mobile-web-app-capable" content="yes', 'apple-mobile-web-app-title" content="Sykehustomta', 'apple-mobile-web-app-status-bar-style" content="default']) assert.ok(h.includes(t), t);
});

test("the bars use the safe-area insets", () => {
  const c = read("../public/sykehus.css");
  for (const sel of [".appbar", ".bstack", "#scale", "#levels", ".pf-bar"]) assert.match(c, new RegExp(`^${sel.replace(".", "\\.")}[^{]*\\{[^}]*env\\(safe-area-inset-(top|bottom)`, "m"), sel);
});
