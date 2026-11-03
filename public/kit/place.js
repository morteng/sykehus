// Places a top-layer box (a popover) from the button that opened it: under the button with the right edges level (or the left edges, `align`), above it when
// the room below is short, always inside the window. The one placement rule of the ⋯ menu and the help popover (U3988).
/** Sets `left`, `top` and `max-height` on `box` (fixed, in the top layer) from `button`'s rectangle. Call after the box is shown,
 * so its size is known. Nothing is set when the window has no size (a test document with no layout). */
export function placeFromButton(box, button, view, gap = 4, edge = 8, align = "end") {
    const w = view?.innerWidth ?? 0;
    const h = view?.innerHeight ?? 0;
    if (!w || !h)
        return;
    const r = button.getBoundingClientRect();
    box.style.maxHeight = `${h - 2 * edge}px`;
    const bw = box.offsetWidth;
    const bh = box.offsetHeight;
    // "auto": a button in the left half of the window hangs its box from the left edge, so the box never opens far to the left of it
    const start = align === "auto" && (r.left + r.right) / 2 < w / 2;
    const left = Math.max(edge, Math.min(start ? r.left : r.right - bw, w - bw - edge));
    const below = r.bottom + gap;
    const top = below + bh <= h - edge ? below : r.top - gap - bh >= edge ? r.top - gap - bh : Math.max(edge, h - edge - bh);
    box.style.left = `${left}px`;
    box.style.top = `${top}px`;
}
