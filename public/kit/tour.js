// A guided tour (.g-tour): a light falls on one part of the page at a time and a card beside it says what it is, with
// «Next», «Back», the arrow keys and Esc. A step whose part is not on the page now is passed over. Which list runs, for
// whom, and whether it offers itself are the app's: `now()` says (whichTour below is the usual rule), the lists are the
// app's steps, and `onSeen` is told when the person finished it or closed it with the ×, so the app can remember that
// (writeCookie below is a first-party flag for it). Words are always arguments.
const visible = (el, win) => !!el && el.getClientRects().length > 0 && win.getComputedStyle(el).visibility !== "hidden";
/** What tour a person gets. Visitor (signed out): the short one, once, closed with × counts as seen. Signed in: the full one once
 *  (also after the visitor one); when the version seen is older than `version`, only the newer steps («nytt», since: the version
 *  seen); closed with × (dismissed) it never offers itself again. `seenIn` is the version of the signed-in tour seen, or null. */
export function whichTour(o) {
    if (!o.signedIn)
        return { kind: "gjest", due: !o.seen };
    const inn = o.seenIn != null && Number.isFinite(+o.seenIn) ? +o.seenIn : 0;
    if (o.dismissed || inn >= o.version)
        return { kind: "full", due: false };
    return inn === 0 ? { kind: "full", due: true } : { kind: "nytt", due: true, since: inn };
}
/** A first-party flag in a cookie (Path=/, SameSite=Lax, a year by default; Secure on https). */
export function writeCookie(doc, name, value, days = 365) {
    try {
        doc.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${Math.round(days * 86400)}; SameSite=Lax${doc.defaultView?.location.protocol === "https:" ? "; Secure" : ""}`;
    }
    catch { /* cookies blocked */ }
}
export function readCookie(doc, name) {
    try {
        for (const c of doc.cookie.split("; "))
            if (c.startsWith(name + "="))
                return decodeURIComponent(c.slice(name.length + 1));
    }
    catch { /* cookies blocked */ }
    return null;
}
export function createTour(o) {
    const doc = o.doc ?? document, win = doc.defaultView;
    let at = -1, kind = "", list = [], plan = [], root = null, hole, card;
    const elOf = (s) => !s.el ? null : typeof s.el === "function" ? s.el() ?? null : doc.querySelector(s.el);
    const q = (sel) => root.querySelector(sel);
    function build() {
        root = doc.createElement("div");
        root.className = "g-tour";
        root.innerHTML = `<div class="g-tour-hole"></div>
      <div class="g-tour-card" role="dialog" aria-modal="true" aria-labelledby="gTourTitle" aria-describedby="gTourText">
        <div class="g-tour-top"><span class="g-tour-n"></span><button type="button" class="g-tour-x">×</button></div>
        <h2 id="gTourTitle"></h2><p id="gTourText"></p>
        <div class="g-tour-acts"><button type="button" class="g-tour-back"></button><button type="button" class="go g-tour-next"></button></div>
      </div>`;
        doc.body.append(root);
        hole = q(".g-tour-hole");
        card = q(".g-tour-card");
        const x = q(".g-tour-x");
        x.setAttribute("aria-label", o.words.close);
        x.title = o.words.closeTitle;
        q(".g-tour-back").textContent = o.words.back;
        x.onclick = () => end("x");
        q(".g-tour-back").onclick = () => go(at - 1, -1);
        q(".g-tour-next").onclick = () => go(at + 1, 1);
        root.addEventListener("pointerdown", (e) => { if (!e.target.closest(".g-tour-card"))
            e.preventDefault(); });
        win.addEventListener("resize", place);
        win.addEventListener("keydown", key, true);
    }
    function key(e) {
        if (at < 0)
            return;
        if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            end("x");
        }
        else if (e.key === "ArrowRight") {
            e.preventDefault();
            go(at + 1, 1);
        }
        else if (e.key === "ArrowLeft") {
            e.preventDefault();
            go(at - 1, -1);
        }
    }
    /* the light on the part, the card beside it where there is room: under, over, right of, left of, else in the middle */
    function place() {
        if (at < 0)
            return;
        const el = elOf(list[at]), W = win.innerWidth, H = win.innerHeight, cw = Math.min(340, W - 24), pad = 6;
        card.style.width = cw + "px";
        const ch = card.offsetHeight;
        if (!el) {
            hole.style.cssText = `left:${W / 2}px;top:${H / 2}px;width:0;height:0`;
            card.style.left = (W - cw) / 2 + "px";
            card.style.top = Math.max(12, (H - ch) / 2) + "px";
            return;
        }
        const r = el.getBoundingClientRect(), x = Math.max(4, r.left - pad), y = Math.max(4, r.top - pad), w = Math.min(W - 8, r.right + pad) - x, hh = Math.min(H - 8, r.bottom + pad) - y;
        hole.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${hh}px`;
        const clampX = (v) => Math.max(12, Math.min(W - cw - 12, v)), clampY = (v) => Math.max(12, Math.min(H - ch - 12, v));
        const big = w * hh > W * H * 0.4; // the whole model: the card over it, low in the middle
        let left, top;
        if (big) {
            left = (W - cw) / 2;
            top = H - ch - 96;
        }
        else if (y + hh + 12 + ch < H) {
            left = clampX(x);
            top = y + hh + 12;
        }
        else if (y - 12 - ch > 0) {
            left = clampX(x);
            top = y - 12 - ch;
        }
        else if (x + w + 12 + cw < W) {
            left = x + w + 12;
            top = clampY(y);
        }
        else if (x - 12 - cw > 0) {
            left = x - 12 - cw;
            top = clampY(y);
        }
        else {
            left = (W - cw) / 2;
            top = (H - ch) / 2;
        }
        card.style.left = clampX(left) + "px";
        card.style.top = clampY(top) + "px";
    }
    async function go(i, dir = 1) {
        if (i >= list.length)
            return end("done");
        if (i < 0)
            return;
        const s = list[i];
        try {
            await s.before?.();
        }
        catch { /* the page is not ready for it */ }
        await new Promise(ok => win.requestAnimationFrame(() => win.requestAnimationFrame(() => ok())));
        if (s.el && !visible(elOf(s), win))
            return go(i + dir, dir); // not on the page now: the next one
        at = i;
        if (!plan.includes(i))
            plan = [...plan, i].sort((a, b) => a - b);
        q(".g-tour-n").textContent = o.words.count(plan.indexOf(i) + 1, plan.length);
        q("#gTourTitle").textContent = s.title;
        q("#gTourText").textContent = s.text;
        q(".g-tour-back").hidden = i === 0;
        q(".g-tour-next").textContent = i === list.length - 1 ? o.words.done : o.words.next;
        root.hidden = false;
        place();
        q(".g-tour-next").focus({ preventScroll: true });
    }
    function end(how = "done") {
        if (at < 0 && !(root && !root.hidden))
            return;
        at = -1;
        if (root)
            root.hidden = true;
        o.onSeen(kind, how);
        o.onEnd?.();
    }
    return {
        /* the count is made once: the steps whose part is on the page now, or that put it there first (before) */
        async start(auto = false) {
            const t = o.now();
            kind = auto ? t.kind : t.manual ?? t.kind;
            list = o.list(kind);
            plan = list.map((_, k) => k).filter(k => !list[k].el || list[k].before || visible(elOf(list[k]), win));
            if (!root)
                build();
            await go(0);
        },
        end, get on() { return at >= 0; }, get due() { return o.now().due; },
    };
}
