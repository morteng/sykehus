// A resizable panel (.g-split): a handle on one edge of a panel that is dragged with a pointer or moved with ← →, kept
// between a smallest width and a share of the window, remembered in the browser's storage, and put back by a double click.
// The kit draws the handle and sets the panel's width (an inline width and one custom property); the app decides when the
// handle is on at all (enabled: a phone's bottom sheet has none) and what to do when the width changed (a canvas resizes
// itself with its own observer). Words are always arguments.
export const clampWidth = (w, vw, min = 300, maxShare = 0.6) => Math.round(Math.max(min, Math.min(Math.max(min, Math.floor(vw * maxShare)), Number.isFinite(+w) ? +w : min)));
/** The stored width, clamped to this window, or null (none stored, rubbish, or the storage refuses). */
export function readWidth(storage, key, vw, min = 300, maxShare = 0.6) {
    try {
        const n = parseInt(String(storage?.getItem(key)), 10);
        return Number.isFinite(n) ? clampWidth(n, vw, min, maxShare) : null;
    }
    catch {
        return null;
    }
}
export function saveWidth(storage, key, w) {
    try {
        if (w == null)
            storage?.removeItem(key);
        else
            storage?.setItem(key, String(Math.round(w)));
    }
    catch { /* blocked storage: the width is for this visit only */ }
}
export function split(opts) {
    const { panel } = opts, doc = panel.ownerDocument, win = doc.defaultView;
    const min = opts.min ?? 300, share = opts.maxShare ?? 0.6, step = opts.step ?? 16, key = opts.key ?? "g-split-width", prop = opts.prop ?? "--split-w", start = (opts.edge ?? "start") === "start";
    const vw = opts.viewport ?? (() => win.innerWidth), on = opts.enabled ?? (() => true);
    const store = opts.storage !== undefined ? opts.storage : (() => { try {
        return win.localStorage;
    }
    catch {
        return null;
    } })();
    const el = doc.createElement("div");
    el.className = `g-split ${start ? "start" : "end"}`;
    el.setAttribute("role", "separator");
    el.setAttribute("aria-orientation", "vertical");
    el.tabIndex = 0;
    el.setAttribute("aria-valuemin", String(min));
    if (opts.name)
        el.setAttribute("aria-label", opts.name);
    if (opts.title)
        el.title = opts.title;
    panel.append(el);
    const now = () => Math.round(panel.getBoundingClientRect().width);
    function set(w) {
        if (!on() || w == null) {
            panel.style.removeProperty(prop);
            panel.style.removeProperty("width");
            el.removeAttribute("aria-valuenow");
            el.hidden = !on();
            return null;
        }
        const c = clampWidth(w, vw(), min, share);
        panel.style.setProperty(prop, `${c}px`);
        panel.style.width = `${c}px`;
        el.setAttribute("aria-valuenow", String(c));
        el.hidden = false;
        return c;
    }
    const refresh = () => { set(on() ? readWidth(store, key, vw(), min, share) : null); };
    const done = (w) => { saveWidth(store, key, w); opts.onChange?.(w); };
    let dragging = false;
    el.addEventListener("pointerdown", (e) => {
        if (!on() || e.button)
            return;
        dragging = true;
        el.setPointerCapture?.(e.pointerId);
        el.classList.add("sizing");
        doc.body.classList.add("g-sizing");
        e.preventDefault();
    });
    el.addEventListener("pointermove", (e) => {
        if (!dragging)
            return;
        const r = panel.getBoundingClientRect();
        set(start ? r.right - e.clientX : e.clientX - r.left);
    });
    const end = () => { if (!dragging)
        return; dragging = false; el.classList.remove("sizing"); doc.body.classList.remove("g-sizing"); done(now()); };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    el.addEventListener("keydown", (e) => {
        const d = { ArrowLeft: start ? step : -step, ArrowRight: start ? -step : step }[e.key];
        if (!d || !on())
            return;
        e.preventDefault();
        done(set(now() + d));
    });
    el.addEventListener("dblclick", () => { set(null); done(null); });
    win.addEventListener("resize", refresh);
    refresh();
    return { el, set, get: now, refresh };
}
