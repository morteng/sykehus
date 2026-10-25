// The level strip (.g-levels): one button per level of a building, top level first as the app gives them, and an
// optional «all» button above them. A tap picks one; ↑ ↓ Page Up Page Down move one; Home goes to «all»; a finger or pen
// dragged along the strip moves through the levels with a bubble (.tip) beside it. Words are always arguments.
// The app places the strip (position, offsets); the kit only draws it. An app position other than static keeps the tip
// anchored, as the kit's own position:relative does.
export function levels(host, opts) {
    const doc = host.ownerDocument;
    const el = doc.createElement("nav");
    el.className = "g-levels";
    if (opts.name)
        el.setAttribute("aria-label", opts.name);
    const ol = doc.createElement("ol");
    const tip = doc.createElement("span");
    tip.className = "tip";
    tip.setAttribute("aria-hidden", "true");
    tip.hidden = true;
    el.append(ol, tip);
    host.append(el);
    let items = opts.items;
    let value = opts.value;
    // the buttons in strip order, «all» first when there is one; key is the value each one stands for
    let buttons = [];
    const draw = () => {
        ol.replaceChildren();
        buttons = [];
        const li = (child, cls) => {
            const l = doc.createElement("li");
            if (cls)
                l.className = cls;
            if (child)
                l.append(child);
            ol.append(l);
            return l;
        };
        const button = (key, label, title, cls, aria) => {
            const b = doc.createElement("button");
            b.type = "button";
            if (cls.length)
                b.className = cls.join(" ");
            b.textContent = label;
            if (title)
                b.title = title;
            if (aria)
                b.setAttribute("aria-label", aria);
            b.addEventListener("click", () => choose(key, b));
            buttons.push({ key, b, tip: title ?? aria ?? label });
            li(b);
        };
        if (opts.all) {
            button(null, opts.all.label, opts.all.title, ["all"]);
            if (items.length)
                li(undefined, "sep").setAttribute("role", "presentation");
        }
        for (const it of items) {
            const cls = [it.drawn ? "drawn" : "", it.dim ? "dim" : ""].filter(Boolean);
            button(it.id, it.label, it.title, cls, opts.labelOf?.(it));
        }
        if (opts.cap) {
            const c = li(undefined, "cap");
            c.textContent = opts.cap;
            c.setAttribute("aria-hidden", "true");
        }
        show();
    };
    /** aria-pressed on the chosen button, and the one tab stop on it (or on the first button when none is chosen). */
    const show = () => {
        const at = index(value);
        buttons.forEach(({ b }, i) => {
            b.setAttribute("aria-pressed", String(i === at));
            b.tabIndex = i === (at < 0 ? 0 : at) ? 0 : -1;
        });
    };
    const index = (v) => buttons.findIndex((x) => x.key === v);
    const choose = (key, focus) => {
        const changed = key !== value;
        value = key;
        show();
        if (focus && doc.activeElement !== focus && focus.isConnected)
            focus.focus();
        if (changed)
            opts.onPick(key);
    };
    ol.addEventListener("keydown", (e) => {
        if (!buttons.length)
            return;
        const at = index(value);
        let to;
        if (e.key === "ArrowUp" || e.key === "PageUp")
            to = at < 0 ? 0 : Math.max(0, at - 1);
        else if (e.key === "ArrowDown" || e.key === "PageDown")
            to = at < 0 ? 0 : Math.min(buttons.length - 1, at + 1);
        else if (e.key === "Home")
            to = 0;
        else if (e.key === "End")
            to = buttons.length - 1;
        else
            return;
        e.preventDefault();
        const x = buttons[to];
        if (x)
            choose(x.key, x.b);
    });
    // a finger or a pen dragged along the strip: the level under it is chosen as it changes (the view follows the
    // finger), and the bubble names it; a release ends the drag and picks nothing more. A mouse only taps.
    let drag = null;
    const under = (y) => {
        let best = -1;
        let dist = Infinity;
        buttons.forEach(({ b }, i) => {
            const r = b.getBoundingClientRect();
            const d = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
            if (d < dist)
                (dist = d), (best = i);
        });
        return best;
    };
    const follow = (y) => {
        const x = buttons[under(y)];
        if (!x)
            return;
        tip.textContent = x.tip;
        tip.style.top = `${x.b.offsetTop + x.b.offsetHeight / 2}px`;
        tip.hidden = false;
        if (x.key !== value)
            choose(x.key);
    };
    const end = (e) => {
        if (e.pointerId !== drag)
            return;
        drag = null;
        tip.hidden = true;
    };
    ol.addEventListener("pointerdown", (e) => {
        if (e.pointerType !== "touch" && e.pointerType !== "pen")
            return;
        drag = e.pointerId;
        try {
            ol.setPointerCapture(e.pointerId);
        }
        catch {
            /* a synthetic pointer has nothing to capture */
        }
        follow(e.clientY);
    });
    ol.addEventListener("pointermove", (e) => {
        if (e.pointerId === drag)
            follow(e.clientY);
    });
    ol.addEventListener("pointerup", end);
    ol.addEventListener("pointercancel", end);
    draw();
    return {
        el,
        set(v) {
            value = v;
            show();
        },
        setItems(next) {
            items = next;
            draw();
        },
    };
}
