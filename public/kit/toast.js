// The one toast (.g-toast): a quiet line over the page, with a button when there is an act and a × that shuts it. One is up at
// a time per page: a newer one replaces the older in place. It goes after the same time in every app (TOAST_MS; twice that
// when it carries an act the person may want, e.g. «Undo»); hovering it or focusing into it holds it, leaving starts the clock
// again. An app places it (its own rule on .g-toast, or `host`) and may hear when it shows and hides (`onShow`, `onHide`,
// for a layout that keeps room for it). Words are arguments.
export const TOAST_MS = 6000;
export const TOAST_ACT_MS = 12000;
const slots = new WeakMap();
/** Show a toast; returns it, or null when `intercept` took it. */
export function toast(o) {
    const doc = o.doc ?? document;
    let s = slots.get(doc);
    if (!s) {
        const el = doc.createElement("div");
        s = { el, keep: false, timer: undefined, held: false, onHide: undefined, ms: TOAST_MS };
        slots.set(doc, s);
        const hold = () => { s.held = true; clearTimer(s); };
        const release = () => { s.held = false; arm(s, hide); };
        el.addEventListener("mouseenter", hold);
        el.addEventListener("focusin", hold);
        el.addEventListener("mouseleave", release);
        el.addEventListener("focusout", release);
    }
    const slot = s, el = slot.el;
    const hide = () => {
        clearTimer(slot);
        slot.held = false;
        if (el.hidden && !el.isConnected)
            return;
        el.hidden = true;
        if (!slot.keep)
            el.remove();
        const f = slot.onHide;
        slot.onHide = undefined;
        f?.(el);
    };
    const was = !el.hidden && el.isConnected;
    el.className = "g-toast" + (o.err ? " err" : "") + (o.className ? " " + o.className : "");
    el.setAttribute("role", "status");
    const line = doc.createElement("span");
    line.className = "g-toast-line";
    line.textContent = o.text;
    const x = doc.createElement("button");
    x.type = "button";
    x.className = "g-toast-x";
    x.textContent = "×";
    x.title = o.closeLabel;
    x.setAttribute("aria-label", o.closeLabel);
    x.addEventListener("click", hide);
    const kids = [];
    if (o.icon)
        kids.push(o.icon);
    kids.push(line);
    if (o.action) {
        const a = doc.createElement("button");
        a.type = "button";
        a.className = "g-toast-act";
        a.textContent = o.action.label;
        const run = o.action.run;
        a.addEventListener("click", () => { hide(); run(); });
        kids.push(a);
    }
    kids.push(x);
    el.replaceChildren(...kids);
    slot.ms = o.hold ?? (o.action ? TOAST_ACT_MS : TOAST_MS);
    if (o.intercept?.(el, slot.ms)) {
        clearTimer(slot);
        if (!was) {
            el.hidden = true;
            if (!o.keep)
                el.remove();
        }
        return null;
    }
    slot.onHide = o.onHide;
    el.hidden = false;
    slot.keep = o.keep ?? false;
    if (!el.isConnected)
        (o.host ?? doc.body).append(el);
    slot.held = false;
    arm(slot, hide);
    if (!was)
        o.onShow?.(el);
    return { el, hide };
}
function clearTimer(s) { if (s.timer !== undefined)
    clearTimeout(s.timer); s.timer = undefined; }
function arm(s, hide) { clearTimer(s); if (!s.held)
    s.timer = setTimeout(hide, s.ms); }
