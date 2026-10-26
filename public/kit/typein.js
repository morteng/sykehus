// Type a number while you drag (SketchUp's measurements box, Fusion's drag fields). DOM only: the app draws and drags, this
// box shows the live numbers beside the cursor and lets the person type the exact ones instead.
//
// The rule: while the box is shown, a digit key (or , . -) with no modifier, pressed anywhere but in some other text
// field, starts typing: the first field takes focus and the key. Focus is moved with the keyboard only; a pointer drag
// in the app keeps its capture. Enter commits every field (a field not typed in keeps its live value), Tab moves
// between fields and wraps, Esc drops the typing and shows the live values again. While typing, update() is ignored, so
// the drag cannot overwrite what is being typed. Words (labels) are arguments; the app gives them in its language.
import { esc as escapeHTML } from "./html.js";
const LENGTH = { m: 1, cm: 0.01, mm: 0.001 };
const ANGLE = new Set(["°", "deg", "grader"]);
/**
 * Parse what a person typed, in the field's unit. «2,5», «2.5», «25 cm» (to m), «90°», «-3». Returns null when it is
 * not a number or the unit does not fit the field (cm in an angle field). No unit typed means the field's own.
 */
export function parseTyped(text, unit) {
    const m = /^\s*([+-]?(?:\d+[.,]?\d*|[.,]\d+))\s*([^\d\s]*)\s*$/.exec(text);
    if (!m)
        return null;
    const n = Number(m[1].replace(",", "."));
    if (!Number.isFinite(n))
        return null;
    const typed = m[2].toLowerCase();
    if (typed === "" || typed === unit.toLowerCase())
        return n;
    if (ANGLE.has(unit))
        return ANGLE.has(typed) ? n : null;
    const to = LENGTH[unit.toLowerCase()], from = LENGTH[typed];
    if (to === undefined || from === undefined)
        return null;
    return Math.round((n * from / to) * 1e9) / 1e9;
}
const OFFSET = 16; // px between the cursor and the box
export function typein(opts) {
    const host = opts.host;
    const doc = host.ownerDocument;
    const decimals = opts.decimals ?? 2;
    const box = doc.createElement("div");
    box.className = "g-typein";
    box.setAttribute("role", "group");
    if (opts.label)
        box.setAttribute("aria-label", opts.label);
    box.hidden = true;
    const inputs = new Map();
    for (const f of opts.fields) {
        const row = doc.createElement("label");
        row.className = "g-typein__row";
        row.innerHTML = `<span class="g-typein__name">${escapeHTML(f.label)}</span><input class="g-typein__in" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" aria-label="${escapeHTML(f.label)}" data-key="${escapeHTML(f.key)}"><span class="g-typein__unit" aria-hidden="true">${escapeHTML(f.unit)}</span>`;
        inputs.set(f.key, row.querySelector("input"));
        box.append(row);
    }
    box.toggleAttribute("data-pin", !!opts.pin);
    host.append(box);
    let shown = false, typing = false, pinned = !!opts.pin, last = opts.fields[0]?.key ?? "";
    let live = {};
    for (const f of opts.fields)
        live[f.key] = f.value;
    const dirty = new Set();
    const commits = new Set();
    const cancels = new Set();
    const fmt = (n) => String(Math.round(n * 10 ** decimals) / 10 ** decimals);
    const paint = () => {
        for (const f of opts.fields) {
            const i = inputs.get(f.key);
            i.value = live[f.key] === undefined ? "" : fmt(live[f.key]);
            i.removeAttribute("aria-invalid");
        }
    };
    const place = (at) => {
        const w = box.offsetWidth, h = box.offsetHeight;
        const maxX = Math.max(0, host.clientWidth - w), maxY = Math.max(0, host.clientHeight - h);
        let x = at.x + OFFSET, y = at.y + OFFSET;
        if (host.clientWidth && x > maxX)
            x = at.x - OFFSET - w; // no room right of the cursor: left of it
        if (host.clientHeight && y > maxY)
            y = at.y - OFFSET - h;
        box.style.left = `${Math.min(Math.max(0, x), maxX)}px`;
        box.style.top = `${Math.min(Math.max(0, y), maxY)}px`;
    };
    const stopTyping = () => {
        typing = false;
        dirty.clear();
        paint();
        const a = doc.activeElement;
        if (a && box.contains(a))
            a.blur();
    };
    const begin = (key, seed) => {
        const i = inputs.get(key) ?? inputs.values().next().value;
        if (!i)
            return;
        if (!shown) {
            box.hidden = false;
            shown = true;
        }
        last = i.dataset.key;
        typing = true;
        if (seed !== undefined) {
            i.value = seed;
            dirty.add(last);
        }
        i.focus({ preventScroll: true });
        if (seed === undefined)
            i.select();
        else
            i.setSelectionRange(i.value.length, i.value.length);
    };
    const onKey = (e) => {
        if (!shown || typing)
            return;
        if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing)
            return;
        if (!/^[0-9,.\-]$/.test(e.key))
            return;
        const t = e.target;
        if (t && !box.contains(t) && (t.closest?.("input,textarea,select,[contenteditable]") ?? null))
            return;
        e.preventDefault();
        begin(last, e.key);
    };
    const onBoxKey = (e) => {
        const el = e.target;
        if (e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            const out = {};
            let bad = false;
            for (const f of opts.fields) {
                const i = inputs.get(f.key);
                if (!dirty.has(f.key)) {
                    out[f.key] = live[f.key];
                    continue;
                }
                const n = parseTyped(i.value, f.unit);
                if (n === null) {
                    i.setAttribute("aria-invalid", "true");
                    bad = true;
                }
                else {
                    i.removeAttribute("aria-invalid");
                    out[f.key] = n;
                }
            }
            if (bad)
                return;
            typing = false;
            dirty.clear();
            const a = doc.activeElement;
            if (a && box.contains(a))
                a.blur();
            live = { ...live, ...out };
            paint();
            if (!pinned) {
                box.hidden = true;
                shown = false;
            }
            for (const cb of [...commits])
                cb(out);
        }
        else if (e.key === "Escape") {
            if (!typing)
                return;
            e.preventDefault();
            e.stopPropagation();
            stopTyping();
            for (const cb of [...cancels])
                cb();
        }
        else if (e.key === "Tab") {
            const keys = opts.fields.map((f) => f.key);
            const at = keys.indexOf(el.dataset.key ?? "");
            const next = e.shiftKey ? at - 1 : at + 1;
            e.preventDefault();
            begin(keys[(next + keys.length) % keys.length]);
        }
    };
    const onInput = (e) => { const i = e.target; dirty.add(i.dataset.key); i.removeAttribute("aria-invalid"); typing = true; };
    const onFocusIn = (e) => { const i = e.target; if (i.dataset?.key) {
        last = i.dataset.key;
        typing = true;
    } };
    doc.addEventListener("keydown", onKey, true);
    box.addEventListener("keydown", onBoxKey);
    box.addEventListener("input", onInput);
    box.addEventListener("focusin", onFocusIn);
    paint();
    if (opts.at)
        place(opts.at);
    return {
        el: box,
        show(at, values) {
            if (values && !typing) {
                live = { ...live, ...values };
                paint();
            }
            box.hidden = false;
            shown = true;
            place(at);
        },
        update(values, at) {
            if (typing)
                return;
            live = { ...live, ...values };
            paint();
            if (at && shown)
                place(at);
        },
        hide() {
            if (typing)
                stopTyping();
            if (pinned)
                return;
            box.hidden = true;
            shown = false;
        },
        focus(key) { begin(key ?? last); },
        pin(on) { pinned = on; box.toggleAttribute("data-pin", on); },
        isShown: () => shown,
        isTyping: () => typing,
        onCommit(cb) { commits.add(cb); return () => { commits.delete(cb); }; },
        onCancel(cb) { cancels.add(cb); return () => { cancels.delete(cb); }; },
        destroy() {
            doc.removeEventListener("keydown", onKey, true);
            box.removeEventListener("keydown", onBoxKey);
            box.removeEventListener("input", onInput);
            box.removeEventListener("focusin", onFocusIn);
            commits.clear();
            cancels.clear();
            box.remove();
            shown = false;
            typing = false;
        },
    };
}
