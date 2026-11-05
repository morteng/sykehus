// The input pill's placement (the look is kit.css `.g-pill`). One pill, one element: the same node sits where the page
// puts it while the conversation is closed and is the conversation's bottom row while it is open. It is moved, never
// copied, so the text, the caret, the selection and the text box height stay as they were.
import { iconSVG } from "./icons.js";
/** Draws the input pill (the markup kit.css `.g-pill` describes) so an app has no hand-made copy. Words are arguments. */
export function makePill(o) {
    const doc = (o.host?.ownerDocument ?? document);
    const el = doc.createElement("form");
    el.className = "g-pill";
    const mk = (t, c) => { const e = doc.createElement(t); e.className = c; return e; };
    for (const b of o.buttons ?? []) {
        const x = mk("button", "g-pill__btn");
        x.type = "button";
        x.innerHTML = iconSVG(b.icon);
        x.title = b.label;
        x.setAttribute("aria-label", b.label);
        x.addEventListener("click", b.onClick);
        el.append(x);
    }
    const mid = mk("div", "g-pill__mid"), input = mk("textarea", "g-pill__in"), busyLine = mk("p", "g-pill__busy");
    input.rows = o.rows ?? 1;
    input.placeholder = o.placeholder;
    input.setAttribute("aria-label", o.placeholder);
    busyLine.setAttribute("aria-live", "polite");
    mid.append(input, busyLine);
    const go = mk("button", "g-pill__go");
    go.type = "submit";
    let isBusy = false;
    const face = () => {
        go.classList.toggle("is-stop", isBusy);
        go.innerHTML = iconSVG(isBusy ? "stop" : "send");
        const l = isBusy ? o.stopLabel : o.sendLabel;
        go.title = l;
        go.setAttribute("aria-label", l);
    };
    face();
    el.append(mid, go);
    const submit = () => {
        if (isBusy) {
            o.onStop?.();
            return;
        }
        const t = input.value.trim();
        if (t)
            o.onSend(t);
    };
    el.addEventListener("submit", (e) => { e.preventDefault(); submit(); });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        submit();
    } });
    o.host?.append(el);
    return { el, input, status: (t) => { busyLine.textContent = t; }, busy: (on) => { isBusy = on; face(); }, clear: () => { input.value = ""; } };
}
/**
 * Moves the pill to the end of `to` and marks where it is (`g-pill--chat` while it is in the conversation). Motion: none
 * across the screen; it leaves its old place at once and fades in at the new one (opacity only; kit.css drops it for
 * reduced motion). Focus: when the focus was in the pill, or `focusText` (a button that opens the conversation was
 * pressed), the text box has it again in its new place, with the caret where it was. Returns true when the pill moved.
 */
export function movePill(form, to, o = {}) {
    if (!form || !to)
        return false;
    form.classList.toggle("g-pill--chat", !!o.chat);
    if (form.parentNode === to)
        return false;
    const doc = form.ownerDocument, t = form.querySelector("textarea"), act = doc.activeElement;
    const had = !!act && act !== doc.body && form.contains(act);
    const s = t ? { a: t.selectionStart, b: t.selectionEnd, d: t.selectionDirection || "none", top: t.scrollTop } : null;
    to.append(form);
    if (t && s) {
        t.scrollTop = s.top;
        if (had || o.focusText) {
            t.focus({ preventScroll: true });
            try {
                t.setSelectionRange(s.a, s.b, s.d);
            }
            catch { /* a field that cannot select */ }
        }
    }
    form.classList.remove("g-pill--in");
    void form.offsetWidth;
    form.classList.add("g-pill--in");
    return true;
}
/**
 * The list above the pill: when it was at its end it stays at its end, also when it gets shorter because the pill came in
 * or grew; when the person had scrolled up it stays where it is.
 */
export function keepAtEnd(list, slack = 60) {
    if (!list)
        return;
    let atEnd = true;
    const end = () => list.scrollHeight - list.scrollTop - list.clientHeight < slack;
    list.addEventListener("scroll", () => { atEnd = end(); }, { passive: true });
    const RO = list.ownerDocument.defaultView?.ResizeObserver;
    if (typeof RO === "function")
        new RO(() => { if (atEnd)
            list.scrollTop = list.scrollHeight; }).observe(list);
}
