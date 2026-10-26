/* U3649: Backspace or Delete takes the picked thing away (the card's own «Riv» or «Fjern»), Cmd/Ctrl-Z takes the
   newest change back, Shift-Cmd-Z, Ctrl-Shift-Z or Ctrl-Y puts it back. In a text field the keys are the browser's own.
   The changes taken back are kept here, in this page only; a new change, or the page shown again after another
   tab's or Anton's, empties them. */
import { editKey } from "./kit/keys.js";
/* the key map is the kit's (editKey); the redo stack below is this page's */
export const keyAct = editKey;

/* deps: edits() the draft's changes now (null when there is no draft of one's own), undo(n, expect) true when it went
   through, put(edit) re-adds one change, true when it went through, say(text), name(edit), riv() the card's act, true
   when the card had one */
export function createKeys({ edits, undo, put, say, name, riv }) {
  const redo = [];
  async function run(act) {
    if (act === "undo") {
      const all = edits(); if (!all?.length) return false;
      const e = all[all.length - 1];
      if (!await undo(all.length, e)) return true;
      redo.push(e); say(`Angret: ${name(e)}`); return true;
    }
    const e = redo.pop(); if (!e) return false;
    if (!await put(e)) { redo.push(e); return true; }
    say(`Gjort igjen: ${name(e)}`); return true;
  }
  return {
    run, redo,
    clear: () => { redo.length = 0; },
    /* the draft fetched again (Anton's «steps» comes after every change, one's own too): the redo stays when it is the
       list this page holds, and goes when another tab or Anton made it differ (U3649, the live drive 2026-10-26) */
    echo: theirs => { if (JSON.stringify(theirs) !== JSON.stringify(edits())) redo.length = 0; },
    taken: e => { redo.push(e); },   // a change taken back by the toast's «Angre»
    /* the page's keydown: true when the key was taken (default stopped) */
    key(e) {
      const a = keyAct(e); if (!a) return false;
      if (a === "delete") { if (!riv()) return false; e.preventDefault(); return true; }
      e.preventDefault(); run(a); return true;
    },
  };
}
