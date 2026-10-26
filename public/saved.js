/* Saved camera views (U3562, Morten 2026-10-25 21:18Z «let the system remember custom viewpoints / camera shots and
   user easily move between them»): renderkit's views.js keeps the list; this is what a view holds here, the same for
   the page (app.js) and the server (mcp.mjs). The keys are those of a show_building view, so the page shows a saved
   one as it shows Anton's: the camera (x, y, h: what it looks at; yaw, pitch, dist), 3d, plan or a section, a storey,
   and for a section or a facade the wing, the building, the cut and the side. */
export { addView, renameView, removeView, findView, checkViews, freeName, MAX_VIEWS } from "./renderkit/views.js";

export const VIEW_SPEC = {
  num: { x: [-3000, 3000], y: [-3000, 3000], h: [-500, 1000], yaw: [-1000, 1000], pitch: [-1.6, 1.6], dist: [1, 5000], kote: [-100, 400], sunM: [1, 12], sunD: [1, 31], sunH: [0, 24] },
  str: { storey: 40, wing: 60, building: 80, drawn: 80, caption: 240 },
  one: { mode: ["3d", "plan", "section"], section: ["tverr", "lengde", "fasade"], side: ["N", "Ø", "S", "V"],
    /* U3527: a person's eye, the before or the after of a pair, names on the picture, one of a series of shots */
    cam: ["eye"], era: ["før", "etter"], names: [true, false], series: [true] },
};
