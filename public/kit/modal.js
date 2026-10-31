// A modal dialog (.g-modal): a title, a × and a body the app fills, over a dimmed page. Opening it moves focus in and keeps
// Tab inside; Esc, the × and a tap on the dimmed part close it, and focus goes back to what had it. On a narrow screen it
// is a full-height sheet. The app puts its own content in `body` and says what to do when it closes. Words are arguments.
//
// ONE MODAL IS OPEN AT A TIME, in every app (U3979; the rule is the main app's). Every scrim is `position: fixed; inset: 0` at one
// z-index, so a second would paint over the first and swallow its clicks while the Tab trap served whichever was last in the
// DOM. `openModal` (the bare layer: an app's own scrim and sheet classes, its own content) throws on a second, loud, and
// `activeModal()` says whether one is up; `modal().open()` shuts the one that is up first, so nothing stacks.
const LAYER_FOCUSABLE = "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])";
let active = null;
/** The modal currently on screen, or null. Check this before opening one: `openModal` throws on a second. */
export function activeModal() { return active; }
/** Close whatever is open, if anything: for teardown paths that must not care which feature owns the layer. */
export function closeAnyModal() { active?.close(); }
export function openModal(opts) {
    if (active)
        throw new Error("a modal is already open — check activeModal() before opening another");
    const doc = opts.doc ?? document;
    // Where focus came from, so it can go back to the control that opened this.
    const from = doc.activeElement instanceof HTMLElement ? doc.activeElement : null;
    const scrim = doc.createElement("div");
    scrim.className = opts.scrimClass;
    scrim.tabIndex = -1;
    const sheet = doc.createElement("div");
    sheet.className = opts.sheetClass;
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-modal", "true");
    sheet.setAttribute("aria-label", opts.label);
    scrim.appendChild(sheet);
    const requestClose = () => opts.onRequestClose?.();
    const items = () => Array.from(scrim.querySelectorAll(LAYER_FOCUSABLE));
    // The trap listens on the document, not the scrim: a scrim-scoped listener only fires once focus is inside, so a click on the
    // backdrop (or focus parked on <body>) would leave Tab walking the page behind the sheet.
    const onFocusIn = (e) => {
        if (!active)
            return;
        const target = e.target;
        if (target && scrim.contains(target))
            return;
        (items()[0] ?? scrim).focus();
    };
    const onKey = (e) => {
        if (!active)
            return;
        if (e.key === "Escape") {
            // Only the top layer closes: the key goes no further (a room underneath has its own Escape).
            e.preventDefault();
            e.stopPropagation();
            requestClose();
            return;
        }
        if (e.key !== "Tab")
            return;
        const f = items();
        if (!f.length)
            return;
        const first = f[0], last = f[f.length - 1], el = doc.activeElement;
        if (!el || !scrim.contains(el)) {
            e.preventDefault();
            (e.shiftKey ? last : first).focus();
            return;
        }
        if (e.shiftKey && el === first) {
            e.preventDefault();
            last.focus();
        }
        else if (!e.shiftKey && el === last) {
            e.preventDefault();
            first.focus();
        }
    };
    // A click that started on a control inside the sheet bubbles to the scrim too: only the backdrop itself dismisses.
    if (opts.dismissOnBackdrop !== false)
        scrim.addEventListener("click", (e) => { if (e.target === scrim)
            requestClose(); });
    doc.addEventListener("keydown", onKey, true);
    doc.addEventListener("focusin", onFocusIn);
    // The page behind must not scroll; the previous inline value comes back, because "" would be a guess about what was there.
    const overflow = doc.body.style.overflow;
    doc.body.style.overflow = "hidden";
    doc.body.appendChild(scrim);
    let open = true;
    const handle = {
        scrim, sheet,
        get isOpen() { return open; },
        close() {
            if (!open)
                return;
            open = false;
            doc.removeEventListener("keydown", onKey, true);
            doc.removeEventListener("focusin", onFocusIn);
            scrim.remove();
            doc.body.style.overflow = overflow;
            if (active === handle)
                active = null;
            // Restore focus only if it is still ours to move: a caller that put focus somewhere deliberate wins.
            if ((doc.activeElement === doc.body || doc.activeElement === null) && from?.isConnected)
                from.focus();
            opts.onClosed?.();
        },
    };
    active = handle;
    return handle;
}
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
let seq = 0;
export function modal(o) {
    const doc = o.doc ?? document, win = doc.defaultView;
    const id = `gModal${++seq}`;
    const el = doc.createElement("div");
    el.className = "g-modal";
    el.hidden = true;
    el.innerHTML = `<div class="g-modal-panel${o.className ? " " + o.className : ""}" role="dialog" aria-modal="true" aria-labelledby="${id}t" tabindex="-1">
    <div class="g-modal-head"><h2 id="${id}t"></h2><button type="button" class="g-modal-x">×</button></div><div class="g-modal-body"></div></div>`;
    const panel = el.querySelector(".g-modal-panel"), body = el.querySelector(".g-modal-body"), x = el.querySelector(".g-modal-x");
    el.querySelector("h2").textContent = o.title;
    x.setAttribute("aria-label", o.closeLabel);
    x.title = o.closeLabel;
    doc.body.append(el);
    let from = null;
    const focusables = () => [...panel.querySelectorAll(FOCUSABLE)].filter(e => !e.hidden && e.getClientRects().length > 0);
    function key(e) {
        if (el.hidden)
            return;
        if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            api.close();
            return;
        }
        if (e.key !== "Tab")
            return;
        const f = focusables();
        if (!f.length) {
            e.preventDefault();
            panel.focus();
            return;
        }
        const first = f[0], last = f[f.length - 1], at = doc.activeElement;
        if (e.shiftKey && (at === first || at === panel || !panel.contains(at))) {
            e.preventDefault();
            last.focus();
        }
        else if (!e.shiftKey && (at === last || !panel.contains(at))) {
            e.preventDefault();
            first.focus();
        }
    }
    win.addEventListener("keydown", key, true);
    x.addEventListener("click", () => api.close());
    el.addEventListener("pointerdown", (e) => { if (e.target === el)
        api.close(); });
    // what the registry holds for this dialog: the dimmed part is its scrim and the panel its sheet, as for a bare layer
    const layer = { scrim: el, sheet: panel, close: () => api.close(), get isOpen() { return !el.hidden; } };
    const api = {
        el, body,
        get isOpen() { return !el.hidden; },
        open() {
            if (!el.hidden)
                return;
            if (active && active !== layer)
                active.close(); // one at a time: the one up is shut first
            active = layer;
            from = doc.activeElement;
            el.hidden = false;
            const f = focusables().filter(e => e !== x);
            (f[0] ?? x).focus({ preventScroll: true });
        },
        close() {
            if (el.hidden)
                return;
            if (active === layer)
                active = null;
            el.hidden = true;
            from?.focus?.({ preventScroll: true });
            from = null;
            o.onClose?.();
        },
        setTitle(t) { el.querySelector("h2").textContent = t; },
    };
    return api;
}
