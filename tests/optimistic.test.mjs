/* U3649: «Riv» hides the pick before the server answers, and shows it again when the change does not go through */
import { test } from "node:test";
import assert from "node:assert/strict";
import { tearAtOnce } from "../public/optimistic.js";

function rig(answer) {
  const log = [], state = { gone: ["old"], roads: ["vei-osm-1"] };
  let release; const wait = new Promise(r => { release = r; });
  const deps = {
    gone: () => state.gone, roads: () => state.roads,
    setGone: ids => { log.push(["gone", [...ids]]); state.gone = ids; }, setRoads: ids => { log.push(["roads", [...ids]]); state.roads = ids; },
    clear: () => log.push(["clear"]),
    send: async () => { log.push(["send"]); await wait; log.push(["answer"]); return answer; },
  };
  return { log, state, deps, release };
}

test("a building and a road section are hidden and the pick cleared before the request resolves", async () => {
  const r = rig({ n: 1, k: 2 });
  const p = tearAtOnce({ ...r.deps, targets: ["b1", { building: "vei-nvdb-22", name: "Dronninggata" }] });
  await new Promise(x => setTimeout(x, 0));   // the request is out and not answered
  assert.deepEqual(r.log, [["gone", ["old", "b1"]], ["roads", ["vei-osm-1", "vei-nvdb-22"]], ["clear"], ["send"]]);
  r.release(); assert.deepEqual(await p, { n: 1, k: 2 });
  assert.equal(r.log.at(-1)[0], "answer"); assert.deepEqual(r.state, { gone: ["old", "b1"], roads: ["vei-osm-1", "vei-nvdb-22"] });
});

test("when the change does not go through, what was hidden is shown again", async () => {
  const r = rig(null);
  const p = tearAtOnce({ ...r.deps, targets: ["b1"] }); r.release();
  assert.equal(await p, null);
  assert.deepEqual(r.state, { gone: ["old"], roads: ["vei-osm-1"] });
  assert.deepEqual(r.log.slice(-3), [["answer"], ["gone", ["old"]], ["roads", ["vei-osm-1"]]]);
});

test("a request that throws also shows it again", async () => {
  const r = rig(null); r.deps.send = async () => { throw new Error("x"); };
  await assert.rejects(tearAtOnce({ ...r.deps, targets: ["b1"] }));
  assert.deepEqual(r.state, { gone: ["old"], roads: ["vei-osm-1"] });
});
