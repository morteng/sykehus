/* Photo spots (U3665, Morten 2026-10-26 «system should remember photolocations so it can revisit them and generate updated
   images if model changes (by request of course)»): the place a picture was taken from, with what and in which light, kept
   beside the picture (gjengi.mjs spotOf says what the server keeps). No DOM: gjengi.js feeds it the viewer and the card.
   Flying to a spot is free. A new picture from a spot costs money and is made only when a person has pressed for it. */
const NUM = ["x", "y", "h", "yaw", "pitch", "dist"];

/* what a spot is made of, from the card's choice and the view's pose; `look` etc. are the card's, `at` where the model stands now */
export function spotOfView({ pose, mm, fov, aspect, look, viewpoint, lens = null, sun = null, version = null, n = null }) {
  return { pose: { ...Object.fromEntries(NUM.map(k => [k, pose[k]])), eye: !!pose.eye }, mm, fov, aspect, look, viewpoint, lens, sun: sun ? { sunM: sun.sunM, sunD: sun.sunD, sunH: sun.sunH } : null, eyeh: pose.eye ? 1.7 : null, version, n };
}
/* the card's choice again, from a spot: the lens, the shape, the look, the light, and the pose the camera goes to */
export function choiceOfSpot(s) { return { lens: s.lens || null, mm: s.mm, aspect: s.aspect, look: s.look, viewpoint: s.viewpoint, sun: s.sun, pose: { ...s.pose } }; }
/* to the spot: the camera by `fly` (the viewer's look, in time, or its pose at once), the light by `setSun`; returns the choice the card takes over */
export function flyTo(spot, { fly, setSun }) {
  const c = choiceOfSpot(spot); fly({ ...c.pose }); if (c.sun) setSun(c.sun); return c;
}
/* the model changed since the picture: the server says it for a saved version (its clock); for a draft the change count in the spot is compared */
export const isStale = (p, changesNow) => p.stale != null ? !!p.stale : p.spot?.n != null && changesNow != null ? p.spot.n !== changesNow : false;
/* the body of a new picture from a spot: the same camera, lens, shape, look and light, tied to the picture it retakes */
export function retakeBody(p, base) {
  const s = p.spot; return { ...base, viewpoint: s.viewpoint || undefined, look: s.look || undefined, lens: s.mm ?? undefined, eyeh: s.eyeh ?? undefined, aspect: s.aspect || undefined, ...(s.sun || {}), spot: s, retake_of: p.id };
}
/* a retake is made only for a press: `confirmed` is the person's press on the card (or on «Ta på nytt»); without it nothing is sent and nothing is spent */
export async function retake(list, { confirmed, make }) {
  if (confirmed !== true) throw Object.assign(new Error("Et nytt bilde koster penger og lages bare når du trykker."), { code: "needs_press" });
  const out = []; for (const p of list) out.push(await make(p)); return out;
}
/* what the card says for the price of several */
export const total = (n, each) => Math.round(n * each * 100) / 100;
