// The + button of a chat pill: a menu of ways to bring something in (a file, a photo, a sketch, a scan), the chips of what is
// attached, paste of any file and drop. One copy for every chat pill. A function, not an element. It never fetches: the app
// reads `take()` when the person sends. Chips carry a name and × and no picture (a page's CSP may refuse blob: and data: previews).
import { iconSVG } from "./icons.js";
import { openMenu } from "./menu.js";
import { UPLOAD_CAPS } from "./upload-caps.js";
export function attach(o) {
    const doc = o.host.ownerDocument;
    const cap = o.cap ?? UPLOAD_CAPS.chatPicture;
    const list = [];
    const mk = (t, c) => { const e = doc.createElement(t); e.className = c; return e; };
    const button = mk("button", "g-pill__btn");
    button.type = "button";
    button.innerHTML = iconSVG("plus");
    button.title = o.label;
    button.setAttribute("aria-label", o.label);
    button.setAttribute("aria-haspopup", "menu");
    button.setAttribute("aria-expanded", "false");
    const input = mk("input", "g-attach__input");
    input.type = "file";
    input.name = o.field;
    input.multiple = o.maxFiles > 1;
    input.hidden = true;
    input.tabIndex = -1;
    const tray = mk("div", "g-attach__tray");
    const chips = mk("div", "g-attach__chips");
    chips.style.display = "contents";
    const say = mk("p", "g-attach__say");
    say.setAttribute("role", "status");
    tray.append(chips, say);
    o.host.insertBefore(button, o.before ?? null);
    o.host.insertBefore(input, o.before ?? null);
    o.host.prepend(tray);
    const draw = () => {
        chips.replaceChildren(...list.map((f) => {
            const c = mk("span", "g-attach__chip");
            const n = mk("span", "g-attach__name");
            n.textContent = f.name;
            const x = mk("button", "g-attach__x");
            x.type = "button";
            x.innerHTML = iconSVG("x");
            x.title = o.words.remove(f.name);
            x.setAttribute("aria-label", o.words.remove(f.name));
            x.addEventListener("click", () => api.remove(list.indexOf(f)));
            c.append(n, x);
            return c;
        }));
        o.onChange?.([...list]);
    };
    const api = {
        button,
        tray,
        files: () => [...list],
        add(f) {
            if (f.size > cap) {
                say.textContent = o.words.tooBig(f.name, `${Math.round(cap / 1048576)} MB`);
                return false;
            }
            if (list.length >= o.maxFiles) {
                say.textContent = o.words.tooMany(o.maxFiles);
                return false;
            }
            say.textContent = "";
            list.push(f);
            draw();
            return true;
        },
        remove(i) {
            if (i < 0 || i >= list.length)
                return;
            list.splice(i, 1);
            say.textContent = "";
            draw();
        },
        clear() {
            say.textContent = "";
            if (!list.length)
                return;
            list.length = 0;
            draw();
        },
        take() {
            const out = [...list];
            api.clear();
            return out;
        },
    };
    const addAll = (fs) => { for (const f of Array.from(fs ?? []))
        if (!api.add(f))
            break; };
    input.addEventListener("change", () => { addAll(input.files); input.value = ""; });
    const pick = (it) => {
        if (it.run) {
            void Promise.resolve(it.run()).then((r) => { if (r)
                addAll(Array.isArray(r) ? r : [r]); });
            return;
        }
        input.accept = it.accept ?? o.accept;
        if (it.capture)
            input.setAttribute("capture", it.capture);
        else
            input.removeAttribute("capture");
        input.click();
    };
    button.addEventListener("click", () => {
        const shown = o.items.filter((it) => !it.when || it.when());
        if (!shown.length)
            return;
        openMenu(button, shown.map((it) => ({ label: it.label, icon: it.icon, run: () => pick(it) })), doc);
    });
    o.host.addEventListener("paste", (e) => {
        const fs = e.clipboardData?.files;
        if (fs && fs.length) {
            e.preventDefault();
            addAll(fs);
        }
    });
    const zone = o.drop ?? o.host;
    const hasFiles = (e) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    zone.addEventListener("dragover", (e) => { if (hasFiles(e)) {
        e.preventDefault();
        zone.classList.add("g-attach--drop");
    } });
    zone.addEventListener("dragleave", () => zone.classList.remove("g-attach--drop"));
    zone.addEventListener("drop", (e) => {
        zone.classList.remove("g-attach--drop");
        const fs = e.dataTransfer?.files;
        if (fs && fs.length) {
            e.preventDefault();
            addAll(fs);
        }
    });
    return api;
}
