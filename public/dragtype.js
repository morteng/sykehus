/* Type a number while you drag, and two chips for a finger (U3878). One copy for both editors: the volume build
   (renderkit build.js) and the ground knobs (renderkit shape.js) call live() as the pointer moves; a digit key opens the
   kit's type-in box (kit/typein.js); Enter hands the numbers back to the editor's typed(), which ends the drag as the one
   change a drag is. On a coarse pointer two chips show during a drag: «Uten fest» (snaps off) and «Skriv mål». */
import { typein } from "./kit/typein.js";

/* the fields each drag shows, in the words on screen */
const FIELDS = {
  move: [{ key: "d", label: "Flytt", unit: "m" }],
  end: [{ key: "L", label: "Lengde", unit: "m" }, { key: "W", label: "Bredde", unit: "m" }],
  side: [{ key: "L", label: "Lengde", unit: "m" }, { key: "W", label: "Bredde", unit: "m" }],
  ring: [{ key: "a", label: "Retning", unit: "°" }],
  point: [{ key: "L", label: "Lengde", unit: "m" }],
  edge: [{ key: "d", label: "Flytt", unit: "m" }],
};

export function createDragType({ host, coarse = matchMedia("(pointer: coarse)").matches || new URLSearchParams(location.search).has("chips") }) {
  let editor = null, kind = null; const boxes = new Map(); let chips = null, snapBtn = null;
  const at = p => { const r = host.getBoundingClientRect(); return p ? { x: p.x - r.left, y: p.y - r.top } : { x: r.width / 2, y: r.height / 2 }; };
  function boxFor(k) {
    const key = (editor.name || "") + k;
    if (boxes.has(key)) return boxes.get(key);
    const b = typein({ host, fields: FIELDS[k], label: "Skriv mål" });
    b.onCommit(v => { const ed = editor; if (ed) ed.typed(v); });
    boxes.set(key, b); return b;
  }
  function makeChips() {
    chips = Object.assign(document.createElement("div"), { className: "drag-chips" }); chips.hidden = true;
    chips.style.cssText = "position:absolute;left:50%;bottom:16px;transform:translateX(-50%);z-index:7;display:flex;gap:8px";
    const mk = (t, f) => { const b = Object.assign(document.createElement("button"), { type: "button", textContent: t });
      b.style.cssText = "font:600 13px/1 system-ui,sans-serif;min-height:40px;padding:0 14px;border-radius:20px;border:1px solid rgba(0,0,0,.2);background:rgba(255,255,255,.95);color:#1d1b18;touch-action:none";
      b.addEventListener("pointerdown", e => { e.stopPropagation(); e.preventDefault(); f(b); }); return b; };
    snapBtn = mk("Uten fest", b => { if (!editor) return; editor.setSnaps(!editor.snaps); b.setAttribute("aria-pressed", String(!editor.snaps)); b.style.background = editor.snaps ? "rgba(255,255,255,.95)" : "#2f6fde"; b.style.color = editor.snaps ? "#1d1b18" : "#fff"; });
    chips.append(snapBtn, mk("Skriv mål", () => { if (!editor || !kind || !FIELDS[kind]) return; const b = boxFor(kind); b.pin(true); b.show(at(null)); b.focus(); }));
    host.append(chips);
  }
  return {
    /* the editors' onLive: ed is {name, typed, setSnaps, snaps} */
    live(ed, k, vals, p) {
      if (!FIELDS[k]) return;
      editor = ed; kind = k; const b = boxFor(k);
      if (b.isShown()) b.update(vals, at(p)); else b.show(at(p), vals);
      if (coarse) { if (!chips) makeChips(); chips.hidden = false; }
    },
    /* the editors' onBusy */
    busy(on) {
      if (on) return;
      for (const b of boxes.values()) { b.pin(false); b.hide(); }
      if (chips) { chips.hidden = true; snapBtn.setAttribute("aria-pressed", "false"); snapBtn.style.background = "rgba(255,255,255,.95)"; snapBtn.style.color = "#1d1b18"; }
      editor = null; kind = null;
    },
  };
}
