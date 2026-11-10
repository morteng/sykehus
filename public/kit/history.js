/* One undo and redo for every edit. An entry is { label, undo(), redo() }: an editor records small patches or a swap
   between two copies of its document. Pure state, no DOM: buttons read canUndo()/canRedo() and call undo()/redo().
   `createHistory(max)` makes an independent stack; the named exports are one shared stack for an app that wants one. */
export function createHistory(max = 50) {
  const undos = [], redos = [], subs = new Set();
  const emit = () => { for (const f of subs) f(); };
  const h = {
    onChange(f) { subs.add(f); return () => subs.delete(f); },
    canUndo: () => undos.length > 0,
    canRedo: () => redos.length > 0,
    peek: () => undos.at(-1) || null,
    labels: () => undos.map(e => e.label),
    record(label, undo, redo) {
      const e = { label, undo, redo }; undos.push(e); if (undos.length > max) undos.shift(); redos.length = 0; emit(); return e;
    },
    undo() { const e = undos.pop(); if (!e) return null; e.undo(); redos.push(e); emit(); return e; },
    redo() { const e = redos.pop(); if (!e) return null; e.redo(); undos.push(e); emit(); return e; },
    /* Undo one entry that a toast offers: only when it is still the latest, else newer edits would be undone behind its back. */
    undoEntry(e) { return h.peek() === e ? h.undo() : null; },
    clear() { undos.length = 0; redos.length = 0; emit(); },
  };
  return h;
}
const shared = createHistory(50);
export const { onChange, canUndo, canRedo, peek, labels, record, undo, redo, undoEntry, clear } = shared;
