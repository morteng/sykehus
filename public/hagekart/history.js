/* One undo and redo for every edit. An entry is { label, undo(), redo() }: the brush records small patches (the areas and plants
   a stroke took and made), everything else records a swap between two copies of the plan. Pure state, no DOM: the dock and the
   map's buttons read canUndo()/canRedo() and call undo()/redo(). */
const MAX = 50;
const undos = [], redos = [], subs = new Set();
const emit = () => { for (const f of subs) f(); };
export const onChange = f => { subs.add(f); return () => subs.delete(f); };
export const canUndo = () => undos.length > 0;
export const canRedo = () => redos.length > 0;
export const peek = () => undos.at(-1) || null;
export const labels = () => undos.map(e => e.label);
export function record(label, undo, redo) {
  const e = { label, undo, redo }; undos.push(e); if (undos.length > MAX) undos.shift(); redos.length = 0; emit(); return e;
}
export function undo() { const e = undos.pop(); if (!e) return null; e.undo(); redos.push(e); emit(); return e; }
export function redo() { const e = redos.pop(); if (!e) return null; e.redo(); undos.push(e); emit(); return e; }
/* Undo one entry that a toast offers: only when it is still the latest, else the newer edits would be undone behind its back. */
export function undoEntry(e) { return peek() === e ? undo() : null; }
export function clear() { undos.length = 0; redos.length = 0; emit(); }
