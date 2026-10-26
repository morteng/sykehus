/* U3684: the ground against what was asked. A flat fixture says flat and finds the 1,5 m drop elsewhere; a sloped one says the fall and fits.
   Then the real tool: about_ground with want_drop_m answers with fall.line, fall.answer and candidates.
   node --test tests/ground-fits.test.mjs */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fallOf, findDrops, fitLine, steepestRise } from "../groundfit.mjs";

const way = (id, x0, y0, x1, y1) => ({ id, what: id, ring: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });
/* flat everywhere except a 1,5 m step down to the east of x=100 (over 6 m), where a way lies at x 108..110 */
const flat = ([x]) => x < 100 ? 20.1 + 0.002 * x : x > 106 ? 18.6 : 20.1 - (x - 100) * 0.25;
const slope = ([x, y]) => 20 - 0.15 * y;      // 0,15 m per metre, falling north to south
const C = [0, 0], ways = [way("gangvei-nær", -20, -6, 20, -4), way("gangvei-ned", 108, -20, 110, 20)];

test("flat ground: the fall line says nearly flat with the numbers; a 1,5 m drop does not fit here", () => {
  const f = fallOf(flat, C, 40);
  assert.ok(f.spread_m < 0.3, f.line); assert.match(f.line, /nesten flatt: 0,\d m mellom høyeste og laveste punkt innen 40 m/);
  const cands = findDrops({ groundAt: flat, c: C, R: 120, drop: 1.5, ways });
  const a = fitLine(steepestRise(flat, C, 12), 1.5, cands, 12);
  assert.equal(a.fits_here, false); assert.match(a.answer, /faller bare 0 m over 10 m \(størst innen 12 m\), ikke 1,5 m/);
  assert.ok(cands.length >= 1 && cands.length <= 3);
  for (const k of cands) { assert.equal(k.bottom.is, "gangvei-ned"); assert.ok(k.run_m <= 10); assert.ok(k.top.kote - k.bottom.kote >= 1.35, JSON.stringify(k)); assert.ok(k.top.x < k.bottom.x, "up the slope is west"); assert.equal(k.top.is, "åpen mark"); }
  assert.match(a.answer, /Nærmeste steder som passer/);
  assert.deepEqual(findDrops({ groundAt: flat, c: C, R: 120, drop: 1.5, ways: [ways[0]] }), [], "the near way has no fall at all: no candidate");
});

test("a building or a way on the top end is not a candidate; a laid surface is named", () => {
  const blocked = findDrops({ groundAt: flat, c: C, R: 120, drop: 1.5, ways, buildings: [{ ring: [[90, -30], [107, -30], [107, 30], [90, 30]] }] });
  assert.deepEqual(blocked, []);
  const laid = findDrops({ groundAt: flat, c: C, R: 120, drop: 1.5, ways, surfaces: [{ name: "Plen", surface: "grass", ring: [[80, -30], [107, -30], [107, 30], [80, 30]] }] });
  assert.ok(laid.length && laid.every(k => /Plen/.test(k.top.is)));
});

test("sloped ground: the fall is stated and 1,5 m fits here", () => {
  const f = fallOf(slope, C, 40); assert.ok(f.spread_m > 10, f.line); assert.match(f.line, /faller 12 m innen 40 m: høyest 26 \(sør/);
  assert.equal(f.high.kote, 26); assert.equal(f.low.kote, 14);
  const a = fitLine(steepestRise(slope, C, 12), 1.5, [], 12); assert.equal(a.fits_here, true); assert.match(a.answer, /kan passe/);
  assert.equal(fitLine({ rise_m: 0.2, run_m: 10 }, 1.5, []).fits_here, false); assert.match(fitLine({ rise_m: 0.2, run_m: 10 }, 1.5, []).answer, /Fant ikke noe sted/);
});

/* Sentralblokka south, as measured: 9 % fall (15,2 at the wall, 13,2 at 23 m): the ring spread is 1,9 m, yet no 1,5 m over a 10 m run */
test("a gentle 9 % slope: the ring spread is over 1,5 m but 1,5 m does not fit over 10 m", () => {
  const gentle = ([, y]) => 15.2 + 0.09 * y;
  assert.ok(fallOf(gentle, C, 12).spread_m > 1.5); const r = steepestRise(gentle, C, 12); assert.ok(r.rise_m < 1.35, JSON.stringify(r));
  assert.equal(fitLine(r, 1.5, []).fits_here, false);
  assert.equal(fitLine(steepestRise(([, y]) => 0.2 * y, C, 12), 1.5, []).fits_here, true);
});

/* the terrain model is only interpolated under a footprint (live: a 1,7 m rise ended inside building 134660428): a rise that starts or ends in one is no ground */
test("a steep rise inside a building footprint is not counted", () => {
  const hump = ([x, y]) => Math.abs(x) < 4 && Math.abs(y) < 4 ? 17 : 15;
  assert.ok(steepestRise(hump, C, 12).rise_m >= 2);
  assert.equal(steepestRise(hump, C, 12, 10, [{ ring: [[-4.5, -4.5], [4.5, -4.5], [4.5, 4.5], [-4.5, 4.5]] }]).rise_m, 0);
});

const dir = mkdtempSync(join(tmpdir(), "gf-")), secret = "proxy-secret-for-tests-0123456789", PORT = 8000 + Math.floor(Math.random() * 900), O = `http://localhost:${PORT}`;
const srv = spawn(process.execPath, [new URL("../server.mjs", import.meta.url).pathname], { env: { ...process.env, PORT: String(PORT), SYKEHUS_VERSIONS_DIR: join(dir, "v"), SYKEHUS_PROXY_SECRET: secret, SYKEHUS_COOKIE_SECRET: "cookie-secret-for-tests-0123456789abcdef" }, stdio: ["ignore", "pipe", "inherit"] });
await new Promise(ok => srv.stdout.on("data", d => String(d).includes("Sykehustomta on") && ok()));
after(() => srv.kill());
const rpc = async (method, params) => (await (await fetch(O + "/mcp", { method: "POST", headers: { "content-type": "application/json", "remote-user": "lars", "x-sykehus-proxy-auth": secret }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })).json()).result;

test("about_ground on the real site: fall line always; want_drop_m adds the answer and candidates; INSTRUCTIONS tell Anton to compare", async () => {
  const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } });
  assert.match(init.instructions, /compare what they asked/); assert.match(init.instructions, /want_drop_m/);
  const ws = (await rpc("tools/call", { name: "about_site", arguments: {} })).structuredContent.wings, wing = ws.find(w => /Sentral/i.test(w.name)) || ws[0];
  const g = (await rpc("tools/call", { name: "about_ground", arguments: { wing: wing.name, side: "S" } })).structuredContent;
  assert.ok(Number.isFinite(g.fall.spread_m)); assert.match(g.fall.line, /innen 40 m/); assert.ok(g.note.startsWith(g.fall.line)); assert.equal(g.fall.answer, undefined);
  const h = (await rpc("tools/call", { name: "about_ground", arguments: { wing: wing.name, side: "S", want_drop_m: 1.5, radius_m: 100 } })).structuredContent;
  assert.equal(h.radius_m, 100); assert.equal(h.fall.asked_drop_m, 1.5); assert.equal(typeof h.fall.fits_here, "boolean"); assert.ok(h.fall.answer.length > 10); assert.ok(Array.isArray(h.fall.candidates) && h.fall.candidates.length <= 3);
  for (const k of h.fall.candidates) { assert.ok(k.run_m <= 10); assert.ok(k.top.kote - k.bottom.kote >= 1.35); }
  console.log(h.fall.line, "|", h.fall.answer);
  assert.ok(h.ways.every(w => Number.isFinite(w.kote_vs_center_m)));
});
