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
    const mid = mk("div", "g-pill__mid"), input = mk("textarea", "g-pill__in g-anton-input");
    input.rows = o.rows ?? 1;
    input.placeholder = o.placeholder;
    input.setAttribute("aria-label", o.placeholder);
    mid.append(input);
    const goBtn = mk("button", "g-pill__go g-anton-send"), icon = mk("span", "g-anton-send-icon");
    goBtn.append(icon);
    if (o.idPrefix) {
        input.id = `${o.idPrefix}-input`;
        goBtn.id = `${o.idPrefix}-send`;
    }
    el.append(mid, goBtn);
    const sticky = o.disableWhileSending !== false;
    const micOpt = typeof o.mic === "function" ? { mode: "click", onClick: o.mic } : o.mic;
    const hold = micOpt?.mode === "hold";
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
    let off = false, busy = false;
    const wantsMic = () => !!micOpt && !input.value.trim() && !a.files().length;
    function face() {
        const mic = !busy && wantsMic();
        goBtn.type = mic || busy ? "button" : "submit";
        icon.innerHTML = iconSVG(busy ? "stop" : mic ? "mic" : "send");
        const l = busy ? (w.stop ?? w.send) : mic ? (w.mic ?? w.send) : w.send;
        goBtn.title = l;
        goBtn.setAttribute("aria-label", l);
        goBtn.classList.toggle("g-anton-busy", busy);
    }
    face();
    const disabled = (on) => {
        off = on;
        el.classList.toggle("is-busy", on);
        el.setAttribute("aria-busy", String(on));
        if (!sticky) {
            el.setAttribute("aria-disabled", String(on));
            goBtn.setAttribute("aria-disabled", String(on));
            input.setAttribute("aria-disabled", String(on));
            if (on)
                closeMenu();
            return;
        }
        input.disabled = on;
        goBtn.disabled = on;
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
        if (sticky)
            disabled(true);
        try {
            await o.onSend(text, files);
        }
        catch (e) {
            if (!input.value)
                input.value = was;
            for (const f of files)
                a.add(f);
            o.onError?.({ kind: "send", message: e instanceof Error ? e.message : String(e) });
        }
        finally {
            if (sticky)
                disabled(false);
            face();
        }
    };
    const enterSends = () => {
        const m = o.enterSends ?? true;
        if (m !== "auto")
            return m;
        const win = doc.defaultView;
        const coarse = !!win?.matchMedia?.("(pointer: coarse)").matches;
        return !(coarse || (win?.innerWidth ?? 1024) < 768);
    };
    el.addEventListener("submit", (e) => { e.preventDefault(); void submit(); });
    goBtn.addEventListener("click", () => {
        if (busy) {
            o.onStop?.();
            return;
        }
        if (goBtn.type === "button" && !off && !hold)
            micOpt?.onClick?.();
    });
    if (hold) {
        let down = false;
        const up = () => { if (down) {
            down = false;
            micOpt?.onUp?.();
        } };
        goBtn.addEventListener("pointerdown", () => { if (!busy && !off && wantsMic() && !down) {
            down = true;
            micOpt?.onDown?.();
        } });
        for (const t of ["pointerup", "pointercancel", "pointerleave"])
            goBtn.addEventListener(t, up);
    }
    input.addEventListener("input", face);
    const api = {
        el, input, attach: a, send: goBtn, sendIcon: icon,
        disabled, setDisabled: disabled, isDisabled: () => off,
        setBusy: (on) => { busy = on; face(); }, isBusy: () => busy,
        go: submit,
        value: () => input.value,
        setValue: (v) => { input.value = v; face(); },
        focus: () => input.focus(),
        clear: () => { input.value = ""; a.clear(); face(); },
    };
    input.addEventListener("keydown", (e) => {
        if (o.beforeKey?.(e, api))
            return;
        if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
            if (enterSends()) {
                e.preventDefault();
                void submit();
            }
        }
        else if (e.key === "Escape")
            closeMenu();
    });
    return api;
}
