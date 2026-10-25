/* Saved camera views (U3562, Morten 2026-10-25 21:18Z «let the system remember custom viewpoints / camera shots and
   user easily move between them»): renderkit's views.js keeps the list; this is what a view holds here, the same for
   the page (app.js) and the server (mcp.mjs). The keys are those of a show_building view, so the page shows a saved
   one as it shows Anton's: the camera (x, y, h: what it looks at; yaw, pitch, dist), 3d, plan or a section, a storey,
   and for a section or a facade the wing, the building, the cut and the side. */
export { addView, renameView, removeView, findView, checkViews, freeName, MAX_VIEWS } from "./renderkit/views.js";

export const VIEW_SPEC = {
  num: { x: [-3000, 3000], y: [-3000, 3000], h: [-500, 1000], yaw: [-1000, 1000], pitch: [-1.6, 1.6], dist: [1, 5000] },
  str: { storey: 40, wing: 60, building: 80, drawn: 80 },
  one: { mode: ["3d", "plan", "section"], section: ["tverr", "lengde", "fasade"], side: ["N", "Ø", "S", "V"] },
};
