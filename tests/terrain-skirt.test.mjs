/* wish w6bJkpPlLw6: a new building's pad meets the ground along an eased skirt, not a kink. node --test tests/terrain-skirt.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkEdit, applyEdits } from "../public/edits.js";

const site0 = JSON.parse(readFileSync(new URL("../public/data/site.json", import.meta.url)));
const floors = JSON.parse(readFileSync(new URL("../public/data/floors.json", import.meta.url))).floors;
const terrain = { ...site0.terrain, z: new Array(site0.terrain.z.length).fill(15.5) }, site = { ...site0, terrain };
const tower = { kind: "volume", id: "tarn", name: "Tårn", shape: "box", material: "concrete", from: [-10, -80], to: [10, -80], width: 10, height: 30, base_kote: 13 };

test("the pad's cut leaves the ground eased: no cell steeper than 1:2, and the skirt's last step is smaller than a straight batter's", () => {
  const m0 = applyEdits(site, floors, []), e = checkEdit(m0.site, m0.floors, tower), m = applyEdits(site, floors, [e]), T = m.site.terrain;
  /* the row through the building's middle (y = -80), going out west from the wall at x = -15 */
  const r = Math.floor((T.y1 + 80) / T.res), zs = []; for (let x = -15; x > -45; x -= T.res) zs.push(T.z[r * T.w + Math.floor((x - T.x0) / T.res)]);
  assert.ok(zs[0] < 13.2, "the foot is at the pad");
  assert.equal(zs.at(-1), 15.5, "and the ground is met again");
  for (let i = 1; i < zs.length; i++) assert.ok(Math.abs(zs[i] - zs[i - 1]) / T.res <= 0.5 + 1e-6, `slope at step ${i} is within 1:2`);
  const last = zs.findLast(z => z < 15.5 - 0.005), drop = 15.5 - last;
  assert.ok(drop < T.res * 0.5, `the last cell under the ground is ${drop} m under it, eased (a 1:2 batter would leave ${T.res * 0.5} m)`);
});
