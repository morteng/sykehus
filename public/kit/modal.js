// A modal dialog (.g-modal): a title, a × and a body the app fills, over a dimmed page. Opening it moves focus in and keeps
// Tab inside; Esc, the × and a tap on the dimmed part close it, and focus goes back to what had it. On a narrow screen it
// is a full-height sheet. The app puts its own content in `body` and says what to do when it closes. Words are arguments.
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
    const api = {
        el, body,
        get isOpen() { return !el.hidden; },
        open() {
            if (!el.hidden)
                return;
            from = doc.activeElement;
            el.hidden = false;
            const f = focusables().filter(e => e !== x);
            (f[0] ?? x).focus({ preventScroll: true });
        },
        close() {
            if (el.hidden)
                return;
            el.hidden = true;
            from?.focus?.({ preventScroll: true });
            from = null;
            o.onClose?.();
        },
        setTitle(t) { el.querySelector("h2").textContent = t; },
    };
    return api;
}
