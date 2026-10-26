// Follow the end of a scrolling list (a chat, a log): stay pinned to the end while the person is at the end, stop the
// moment they scroll up, and show a pill that takes them back. The pill shows whenever the list is not at its end, so it
// also tells them that text has come in below while they read above. Words are always arguments.
//
// Why it is built from three watchers and not from the scroll event alone: a scroll event is the only thing that tells us
// the person moved, but nothing in the list's own size fires one when text streams in, an image loads or a card grows.
// A MutationObserver (children added, text changed) and a ResizeObserver on each child (an image arriving, a card
// opening) both ask for one re-pin, made in requestAnimationFrame so it runs after layout and at most once a frame.
// The re-pin is an instant jump, never smooth: a smooth scroll restarted on every streamed chunk lags the end and
// fights the person's finger. Only the pill's own click may glide, and not for a person who asked for less motion.
import { iconSVG } from "./icons.js";
import { matches } from "./surfaces.js";
/** How close to the end still counts as at the end, in CSS pixels: sub-pixel layout and a trailing margin leave a few. */
export const END_THRESHOLD_PX = 48;
/** True when the list is at its end (or too short to scroll). Pure, so the rule is testable without a layout engine. */
export function atEnd(g, threshold = END_THRESHOLD_PX) {
    return g.scrollHeight - g.scrollTop - g.clientHeight <= threshold;
}
export function follow(list, opts) {
    const doc = list.ownerDocument;
    const win = doc.defaultView;
    const host = opts.host ?? list.parentElement;
    const threshold = opts.threshold ?? END_THRESHOLD_PX;
    const pill = doc.createElement("button");
    pill.type = "button";
    pill.className = "g-follow";
    pill.hidden = true;
    pill.setAttribute("aria-label", opts.label);
    pill.title = opts.label;
    pill.innerHTML = iconSVG("down");
    host.append(pill);
    let pinned = true; // following: the next change in size moves the list to its end
    let last = -1; // the scrollTop we set ourselves, so the scroll event it causes is not read as the person
    let jumping = false; // a smooth scroll from the pill is under way
    let frame = 0;
    let jumpTimer;
    const showPill = () => { pill.hidden = pinned || !!opts.suppress?.() || atEnd(list, threshold); };
    const pin = () => { list.scrollTop = list.scrollHeight; last = list.scrollTop; }; // the browser clamps: what stuck is what the scroll event will show
    const stopJump = () => { jumping = false; clearTimeout(jumpTimer); };
    const onScroll = () => {
        if (jumping) {
            if (atEnd(list, threshold)) {
                stopJump();
                pinned = true;
            }
            showPill();
            return;
        }
        if (list.scrollTop !== last)
            pinned = atEnd(list, threshold);
        showPill();
    };
    // a wheel, finger or key is the person: it ends a glide the pill started and is never read as ours
    const onPerson = () => { if (jumping) {
        stopJump();
        pinned = atEnd(list, threshold);
        showPill();
    } };
    const settle = () => { frame = 0; if (pinned)
        pin(); showPill(); };
    const later = () => { if (!frame)
        frame = win.requestAnimationFrame(settle); };
    const sizes = typeof win.ResizeObserver === "function" ? new win.ResizeObserver(later) : null;
    const watch = (n) => { if (n.nodeType === 1)
        sizes?.observe(n); };
    for (const c of Array.from(list.children))
        watch(c);
    const changes = new win.MutationObserver((records) => {
        for (const r of records)
            r.addedNodes.forEach(watch);
        later();
    });
    changes.observe(list, { childList: true, subtree: true, characterData: true });
    sizes?.observe(list); // the list's own box: a tab opening, a window resized
    list.addEventListener("scroll", onScroll, { passive: true });
    for (const ev of ["wheel", "touchstart", "keydown"])
        list.addEventListener(ev, onPerson, { passive: true });
    const toEnd = (smooth = false) => {
        pinned = true;
        if (smooth && !matches("reducedMotion", win) && typeof list.scrollTo === "function") {
            jumping = true;
            clearTimeout(jumpTimer);
            jumpTimer = setTimeout(() => { stopJump(); pin(); showPill(); }, 700);
            list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
        }
        else
            pin();
        showPill();
    };
    pill.addEventListener("click", () => toEnd(true));
    return {
        el: pill,
        following: () => pinned,
        toEnd,
        sync: () => { if (pinned)
            pin();
        else
            pinned = atEnd(list, threshold); showPill(); },
        destroy() {
            changes.disconnect();
            sizes?.disconnect();
            stopJump();
            if (frame)
                win.cancelAnimationFrame(frame);
            list.removeEventListener("scroll", onScroll);
            for (const ev of ["wheel", "touchstart", "keydown"])
                list.removeEventListener(ev, onPerson);
            pill.remove();
        },
    };
}
