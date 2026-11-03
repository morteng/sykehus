// The pieces without behaviour: each is markup (a string, so a server can draw the same) and, where a page builds it on the
// client, an element. Words are always arguments; the kit holds none.
import { attrs, element, esc } from "./html.js";
import { iconSVG } from "./icons.js";
/** A read-only status chip. `.g-status[data-tone]` sets --status; the chip reads it. */
export function statusHTML(text, tone = "muted") {
    return `<span class="g-status" data-tone="${esc(tone)}">${esc(text)}</span>`;
}
/** A count after a word (a tab, a heading), in its own span with the gap before it. */
export function countHTML(n) {
    return `<span class="g-count tnum">${esc(n)}</span>`;
}
/** An icon button: one label is both its accessible name and its tooltip, never one without the other. */
export function iconButtonHTML(icon, label, extra = {}) {
    const { class: cls, ...rest } = extra;
    return `<button type="button" class="g-icon-button${cls ? " " + esc(String(cls)) : ""}"${attrs({ "aria-label": label, title: label, ...rest })}>${iconSVG(icon)}</button>`;
}
export function iconButton(icon, label, extra = {}, doc = document) {
    return element(iconButtonHTML(icon, label, extra), doc);
}
/** The tile: a picture for a thing that has none (--tile-ground, --tile-line, a wash of --status). Text is optional. */
export function tileHTML(text = "") {
    return `<div class="g-tile">${text ? `<span class="g-tile__text tnum">${esc(text)}</span>` : ""}</div>`;
}
/** The empty state: a glyph, the first line, one line what to do. The one action (a button or link) is the app's, put in
 * `.g-empty__act`. */
export function emptyHTML(w) {
    return `<div class="g-empty">${iconSVG("empty")}<p class="g-empty__title">${esc(w.title)}</p>${w.hint ? `<p class="g-empty__hint">${esc(w.hint)}</p>` : ""}<div class="g-empty__act"></div></div>`;
}
export function empty(w, action, doc = document) {
    const el = element(emptyHTML(w), doc);
    const act = el.querySelector(".g-empty__act");
    if (action)
        act?.append(action);
    else
        act?.remove();
    return el;
}
/** The no-match line: the words with the query in them, and one quiet button that clears the search. */
export function noMatch(text, clearWord, onClear, doc = document) {
    const p = doc.createElement("p");
    p.className = "g-nomatch";
    const b = doc.createElement("button");
    b.type = "button";
    b.className = "g-link";
    b.textContent = clearWord;
    b.addEventListener("click", onClear);
    p.append(text + " ", b);
    return p;
}
