/* U3886: the snow reading. Run: node --test tests/snow.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSnow } from "../snow.mjs";

const NOON = Date.UTC(2026, 9, 27, 12);
const nve = (Data, NoDataValue = -9999) => { const calls = []; return { calls, fetchImpl: async url => (calls.push(url), { ok: true, json: async () => ({ Data, NoDataValue }) }) }; };

test("asks NVE's sd theme for the last days at the point, and answers the newest day with data", async () => {
  const f = nve([0, 12, 31.5, -9999]), s = createSnow({ fetchImpl: f.fetchImpl, now: () => NOON });
  const out = await s.depth(560000, 6620000);
  assert.deepEqual(out, { mm: 31.5, date: "2026-10-26", src: "NVE seNorge" });          // the last cell was no data: the day before it
  assert.equal(f.calls[0], "https://gts.nve.no/api/GridTimeSeries/560000/6620000/2026-10-24/2026-10-27/sd.json");
});
test("kept an hour per 100 m cell, then asked again", async () => {
  let t = NOON; const f = nve([5]), s = createSnow({ fetchImpl: f.fetchImpl, now: () => t });
  await s.depth(560000, 6620000); await s.depth(560030, 6620020); assert.equal(f.calls.length, 1);
  t += 61 * 6e4; await s.depth(560000, 6620000); assert.equal(f.calls.length, 2);
});
test("no cell, a failure or an answer that is not a list is no snow known (null), and a failure is not kept", async () => {
  const none = createSnow({ fetchImpl: nve([-9999, -9999]).fetchImpl, now: () => NOON });
  assert.deepEqual(await none.depth(560000, 6620000), { mm: null });
  let n = 0; const down = createSnow({ fetchImpl: async () => { n++; throw new Error("net"); }, now: () => NOON });
  assert.deepEqual(await down.depth(560000, 6620000), { mm: null }); await down.depth(560000, 6620000); assert.equal(n, 2);
  const odd = createSnow({ fetchImpl: async () => ({ ok: true, json: async () => ({ Data: "x" }) }), now: () => NOON });
  assert.deepEqual(await odd.depth(560000, 6620000), { mm: null });
});
test("a point outside Norway is refused before NVE is asked, and the route answers JSON", async () => {
  const f = nve([3]), s = createSnow({ fetchImpl: f.fetchImpl, now: () => NOON });
  await assert.rejects(s.depth(0, 0), /Utenfor Norge/); assert.equal(f.calls.length, 0);
  const sent = {}, res = { writeHead(c, h) { sent.code = c; sent.h = h; return this; }, end(b) { sent.body = b; } };
  assert.equal(await s.route({}, res, "/api/snoe", new URL("http://x/api/snoe?x=560000&y=6620000")), true);
  assert.equal(sent.code, 200); assert.equal(JSON.parse(sent.body).mm, 3);
  assert.equal(await s.route({}, res, "/api/annet", new URL("http://x/api/annet")), false);
  await s.route({}, res, "/api/snoe", new URL("http://x/api/snoe?x=1&y=2")); assert.equal(sent.code, 400);
});
