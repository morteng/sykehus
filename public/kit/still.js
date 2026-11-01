// The still: a picture of a live view (a 3D model, a section) drawn first on a surface that should not load the live view
// (a phone on a thin line). One button asks for the live view; a picture that cannot be loaded asks for it at once.
// Words and the picture's address are arguments; the app decides when a surface wants a still and what «live» draws.
import { attrs, element, esc } from "./html.js";
/** The markup of a still; `src` and `alt` go through esc() as attributes. */
export function stillHTML(o) {
    return `<figure class="g-still${o.className ? " " + esc(o.className) : ""}">`
        + `<img class="g-still__img"${attrs({ src: o.src, alt: o.alt, decoding: "async" })}>`
        + `<button type="button" class="g-still__more">${esc(o.more)}</button></figure>`;
}
/** A still as an element. It removes itself and calls `live` once, whichever of the button or a failed picture comes first. */
export function createStill(o) {
    const el = element(stillHTML(o), o.doc ?? document);
    let done = false;
    const go = () => { if (done)
        return; done = true; el.remove(); o.live(); };
    el.querySelector(".g-still__more").addEventListener("click", go);
    el.querySelector("img").addEventListener("error", go);
    return el;
}
