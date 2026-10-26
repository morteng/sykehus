/* U3670 (Morten 2026-10-26 16:48Z «if anton or subagents are doing renderings they can stream in as thumbnails in chat so user can
   see what it is doing while it works»): each try Anton makes shows in the 3D view as a ghost and as a thumbnail on its row in
   the chat. No DOM, no viewer: anton.js and app.js bring those. */
/* the new parts of this turn: ids in the model now that were not there when the turn began (an undone try is gone from `now`) */
export const ghostIds = (startIds, nowIds) => (nowIds || []).filter(id => !startIds.has(id));
/* «Anton har tegnet i «…»» is said only for a version with a real edit in it: a new, empty version said it above the first message (Trappetest, 16:45Z) */
export const announces = s => !!s && (+s.changes || 0) > 0;
/* a try's chat row and its thumbnail come in either order (the version is saved before the tool line comes): each waits for the other, oldest first */
export function matcher(attach) {
  const rows = [], thumbs = [];
  return {
    row(el) { const t = thumbs.shift(); if (t) attach(el, t); else rows.push(el); },
    thumb(t) { const el = rows.shift(); if (el) attach(el, t); else thumbs.push(t); },
    get waiting() { return { rows: rows.length, thumbs: thumbs.length }; },
    reset() { rows.length = 0; thumbs.length = 0; },
  };
}
/* the tools that make a try: the key gulden-ai sends names it (a tool table's name, with or without a prefix) */
export const isTry = key => /(^|[.:/_])try_change$/.test(String(key || ""));
