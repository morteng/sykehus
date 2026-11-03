// The ⋯ menu: a button that opens a short list of actions. Esc or a click outside closes it and gives focus back; Up and
// Down move between the actions. The words are the app's.
// The box lives in the top layer (popover) and is placed from the button's rectangle, so no card, scroller or overflow:hidden
// ancestor can clip it: it opens under the button, above it when there is no room below, and stays inside the window.
import { placeFromButton } from "./place.js";
let open = null;
/** Closes the menu that is open, if any. */
export function closeMenu() {
    open?.close();
}
/** Opens the menu under the button. Returns the close function. */
export function openMenu(button, actions, doc = button.ownerDocument) {
    open?.close();
    const box = doc.createElement("div");
    box.className = "g-menu";
    box.setAttribute("role", "menu");
    const items = actions.map((a) => {
        const b = doc.createElement("button");
        b.type = "button";
        b.setAttribute("role", "menuitem");
        b.tabIndex = -1;
        b.textContent = a.label;
        if (a.danger)
            b.dataset.danger = "";
        b.addEventListener("click", () => {
            close();
            a.run();
        });
        return b;
    });
    box.append(...items);
    const host = button.closest(".g-more") ?? button.parentElement ?? doc.body;
    const view = doc.defaultView;
    box.setAttribute("popover", "manual");
    host.append(box);
    if (typeof box.showPopover === "function")
        box.showPopover();
    placeFromButton(box, button, view);
    button.setAttribute("aria-expanded", "true");
    const onMove = (e) => {
        if (e.type === "scroll" && box.contains(e.target))
            return;
        close();
    };
    const onKey = (e) => {
        const i = items.indexOf(doc.activeElement);
        if (e.key === "Escape") {
            e.preventDefault();
            close();
            button.focus();
        }
        else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            const n = items.length;
            const next = e.key === "ArrowDown" ? (i < 0 ? 0 : (i + 1) % n) : i < 0 ? n - 1 : (i - 1 + n) % n;
            items[next]?.focus({ preventScroll: true });
        }
        else if (e.key === "Tab")
            close();
    };
    const onDown = (e) => {
        if (!box.contains(e.target) && e.target !== button && !button.contains(e.target))
            close();
    };
    function close() {
        box.remove();
        button.setAttribute("aria-expanded", "false");
        box.removeEventListener("keydown", onKey);
        doc.removeEventListener("pointerdown", onDown, true);
        doc.removeEventListener("scroll", onMove, true);
        view?.removeEventListener("resize", onMove);
        if (open?.close === close)
            open = null;
    }
    box.addEventListener("keydown", onKey);
    doc.addEventListener("pointerdown", onDown, true);
    doc.addEventListener("scroll", onMove, true);
    view?.addEventListener("resize", onMove);
    open = { close };
    items[0]?.focus({ preventScroll: true });
    return close;
}
