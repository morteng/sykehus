/* U3649: «Riv» and «Fjern» hide what is picked at once, before the server answers; the answer then draws the page as
   always (show() in app.js). When the change does not go through, what was hidden is shown again. Pure: the viewer's
   own calls (setGone, streets setRemoved) come in as deps, so no second copy of how a thing is hidden lives here. */
import { ROAD_ID } from "./roads.js";

/* deps: targets (ids, or { building, name } for a road section; a surface, a path or a building), back true when they come back
   instead of going, gone() the building ids hidden now, roads() the road
   ids hidden now, setGone(ids), setRoads(ids), clear() ends the pick (not needed back), send() the request, null when it did not go through */
export async function tearAtOnce({ targets, gone, roads, setGone, setRoads, clear = () => { }, send, back = false }) {
  const ids = targets.map(t => typeof t === "string" ? t : t.building), roadIds = ids.filter(id => ROAD_ID.test(id));
  const g0 = [...gone()], r0 = [...roads()];
  const buildingIds = ids.filter(id => !ROAD_ID.test(id)), next = (was, add) => back ? was.filter(x => !add.includes(x)) : [...was, ...add];
  setGone(next(g0, buildingIds)); setRoads(next(r0, roadIds)); if (!back) clear();
  let r = null;
  try { r = await send(); } finally { if (!r) { setGone(g0); setRoads(r0); } }
  return r;
}
