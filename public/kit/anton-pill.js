// The Anton input pill: [history][+][text][send/mic], the chips above the field. One look and one behaviour for every chat
// input in every app. Built from DOM given a host. It owns the + button and its menu (the app's items, and «New chat» when
// the app passes onNewChat), the chips, paste and drop of files, Enter / Shift+Enter / Esc and the disabled state while a
// send runs. It never fetches: a pick only adds a chip; the app uploads at send, inside its own onSend(text, files).
// First consumers: Fab, Sykehus and gulden-ai (U4487).
import { attach } from "./attach.js";
import { iconSVG } from "./icons.js";
import { closeMenu } from "./menu.js";
export function antonPill(o) {
    const doc = o.host.ownerDocument;
    const mk = (t, c) => { const e = doc.createElement(t); e.className = c; return e; };
    const w = o.words;
    const el = mk("form", "g-pill g-anton");
    el.noValidate = true;
    if (o.onHistory) {
        const h = mk("button", "g-pill__btn");
        h.type = "button";
        h.innerHTML = iconSVG("history");
        h.title = w.history;
        h.setAttribute("aria-label", w.history);
        h.addEventListener("click", () => o.onHistory?.());
        el.append(h);
    }
    const mid = mk("div", "g-pill__mid"), input = mk("textarea", "g-pill__in");
    input.rows = o.rows ?? 1;
    input.placeholder = o.placeholder;
    input.setAttribute("aria-label", o.placeholder);
    mid.append(input);
    const go = mk("button", "g-pill__go");
    el.append(mid, go);
    o.host.append(el);
    const items = [];
    if (o.onNewChat)
        items.push({ key: "new-chat", label: w.newChat ?? "", icon: "chat", run: () => { o.onNewChat?.(); return null; } });
    for (const { id, ...rest } of o.items)
        items.push({ key: id, ...rest });
    const fail = (kind, message, name) => { o.onError?.({ kind, message, name }); return message; };
    const a = attach({
        host: el, before: mid, label: w.attach, items, field: "files", accept: o.accept, maxFiles: o.maxFiles ?? 5, ...(o.maxBytes === undefined ? {} : { cap: o.maxBytes }),
        words: {
            remove: w.remove,
            tooBig: (n, cap) => fail("tooBig", w.tooBig(n, cap), n),
            tooMany: (m) => fail("tooMany", w.tooMany(m)),
        },
        onChange: () => face(),
    });
    let off = false;
    const wantsMic = () => !!o.mic && !input.value.trim() && !a.files().length;
    function face() {
        const mic = wantsMic();
        go.type = mic ? "button" : "submit";
        go.innerHTML = iconSVG(mic ? "mic" : "send");
        const l = mic ? (w.mic ?? w.send) : w.send;
        go.title = l;
        go.setAttribute("aria-label", l);
    }
    face();
    const disabled = (on) => {
        off = on;
        el.classList.toggle("is-busy", on);
        el.setAttribute("aria-busy", String(on));
        input.disabled = on;
        go.disabled = on;
        for (const b of el.querySelectorAll(".g-pill__btn, .g-attach__x"))
            b.disabled = on;
        if (on)
            closeMenu();
    };
    const submit = async () => {
        if (off)
            return;
        const text = input.value.trim();
        if (!text && !a.files().length)
            return;
        const files = a.take();
        const was = input.value;
        input.value = "";
        disabled(true);
        try {
            await o.onSend(text, files);
        }
        catch (e) {
            input.value = was;
            for (const f of files)
                a.add(f);
            o.onError?.({ kind: "send", message: e instanceof Error ? e.message : String(e) });
        }
        finally {
            disabled(false);
            face();
        }
    };
    el.addEventListener("submit", (e) => { e.preventDefault(); void submit(); });
    go.addEventListener("click", () => { if (go.type === "button" && !off)
        o.mic?.(); });
    input.addEventListener("input", face);
    input.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
            e.preventDefault();
            void submit();
        }
        else if (e.key === "Escape")
            closeMenu();
    });
    return {
        el, input, attach: a,
        disabled, isDisabled: () => off,
        focus: () => input.focus(),
        clear: () => { input.value = ""; a.clear(); face(); },
    };
}
