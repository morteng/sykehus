// The one picture lightbox (.g-lightbox, U4011): a picture shown large in the kit's modal, with its caption and, when there
// are several, previous / next (buttons and the arrow keys). Every app's picture view is this one piece. It is the modal underneath, so one modal is open at a time and Esc, the ×
// and the dimmed part close it. The app gives each picture's `src` already cut by the scaler (picture.ts), its words as arguments.
import { modal } from "./modal.js";
export function lightbox(o) {
    const doc = o.doc ?? document, win = doc.defaultView;
    const m = modal({ doc, title: "", closeLabel: o.closeLabel, className: "g-lightbox", onClose: () => { win.removeEventListener("keydown", onKey, true); o.onClose?.(); } });
    m.body.innerHTML = `<div class="g-lb-stage"><button type="button" class="g-lb-step g-lb-prev">‹</button><img class="g-lb-img" alt=""><button type="button" class="g-lb-step g-lb-next">›</button></div><p class="g-lb-cap"></p>`;
    const img = m.body.querySelector(".g-lb-img"), cap = m.body.querySelector(".g-lb-cap");
    const prev = m.body.querySelector(".g-lb-prev"), next = m.body.querySelector(".g-lb-next");
    prev.title = o.prevLabel;
    prev.setAttribute("aria-label", o.prevLabel);
    next.title = o.nextLabel;
    next.setAttribute("aria-label", o.nextLabel);
    let items = [], at = 0;
    function show(i) {
        at = (i + items.length) % items.length;
        const it = items[at];
        img.src = it.src;
        img.alt = it.alt;
        m.setTitle(it.alt);
        cap.replaceChildren();
        if (it.caption)
            cap.append(it.caption);
        cap.hidden = !it.caption;
        prev.hidden = next.hidden = items.length < 2;
    }
    function onKey(e) {
        if (!m.isOpen || items.length < 2)
            return;
        if (e.key === "ArrowLeft") {
            e.preventDefault();
            show(at - 1);
        }
        else if (e.key === "ArrowRight") {
            e.preventDefault();
            show(at + 1);
        }
    }
    prev.addEventListener("click", () => show(at - 1));
    next.addEventListener("click", () => show(at + 1));
    return {
        modal: m,
        get isOpen() { return m.isOpen; },
        open(list, index = 0) {
            if (!list.length)
                return;
            items = list;
            show(index);
            win.addEventListener("keydown", onKey, true);
            m.open();
        },
        close() { m.close(); },
    };
}
