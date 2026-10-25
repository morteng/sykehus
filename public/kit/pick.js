// The selection row (.g-pick): what the person has picked, as chips with a square mark (the colour the view highlights
// a picked thing with) and a × each, after a lead word. Four chips show; the rest wait behind a «+n» chip until it is
// tapped. Esc in the row clears the whole pick. The row hides itself when nothing is picked. Words are always arguments.
// The mark is --g-pick-mark with its edge --g-pick-mark-edge: an app sets its own highlight colour on .g-pick, an item
// its own with `swatch`.
/** How many chips show before the «+n» chip. */
export const PICK_SHOWN = 4;
export function pick(host, opts) {
    const doc = host.ownerDocument;
    const el = doc.createElement("div");
    el.className = "g-pick";
    el.setAttribute("role", "group");
    el.setAttribute("aria-label", opts.lead);
    host.append(el);
    let items = [];
    let open = false;
    const chip = (it) => {
        const c = doc.createElement("span");
        c.className = "chip";
        c.dataset.id = it.id;
        const mark = doc.createElement("i");
        if (it.swatch)
            mark.style.setProperty("--g-pick-mark", it.swatch);
        const x = doc.createElement("button");
        x.type = "button";
        x.setAttribute("aria-label", opts.removeLabel(it.label));
        x.title = opts.removeTitle;
        x.textContent = "×";
        x.addEventListener("click", () => {
            const at = items.indexOf(it);
            draw(items.filter((y) => y !== it));
            const next = el.querySelectorAll(".chip > button, button.chip");
            (next[Math.min(at, next.length - 1)] ?? null)?.focus();
            opts.onRemove(it.id);
        });
        c.append(mark, it.label, x);
        return c;
    };
    const draw = (next) => {
        items = next;
        if (items.length <= PICK_SHOWN)
            open = false;
        el.hidden = items.length === 0;
        const lead = doc.createElement("span");
        lead.className = "lead";
        lead.textContent = opts.lead;
        const shown = open ? items : items.slice(0, PICK_SHOWN);
        el.replaceChildren(lead, ...shown.map(chip));
        const rest = items.length - shown.length;
        if (rest > 0) {
            const m = doc.createElement("button");
            m.type = "button";
            m.className = "chip more";
            m.setAttribute("aria-expanded", "false");
            m.textContent = opts.more(rest);
            m.addEventListener("click", () => {
                open = true;
                draw(items);
                el.querySelectorAll(".chip > button")[PICK_SHOWN]?.focus();
            });
            el.append(m);
        }
    };
    el.addEventListener("keydown", (e) => {
        if (e.key !== "Escape" || !items.length)
            return;
        e.preventDefault();
        opts.onClear();
    });
    draw(opts.items);
    return { el, set: draw };
}
