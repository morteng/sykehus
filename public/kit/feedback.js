// Feedback (.g-feedback): a button the app puts in its bar, and a dialog (the kit's modal) with a kind, a text, an optional
// picture of the page, and the context line saying what is sent along. A report that cannot go now (offline, or the server
// down) is kept in this browser and sent when it can; a rate limit says when sending is possible again. The app gives the
// words, the kinds, the endpoint (POST JSON { kind, text, ...context, screenshot? } → 2xx, or { code, retry_at? }), the
// context, and may put its own list («what you sent before») under the form. Written for Fab's feedback (one copy).
import { modal } from "./modal.js";
/** The page drawn without the dialog, through an SVG foreignObject (no library), as a PNG that fits `pngMax` bytes; null when it cannot. */
export async function pagePicture(doc, o = {}) {
    const win = doc.defaultView, W = win.innerWidth, H = win.innerHeight, pngMax = o.pngMax ?? 1024 * 1024;
    const live = [...doc.querySelectorAll("input,textarea,select")], copy = doc.documentElement.cloneNode(true);
    [...copy.querySelectorAll("input,textarea,select")].forEach((n, i) => {
        const s = live[i];
        if (!s)
            return;
        if (n.type === "checkbox" || n.type === "radio") {
            if (s.checked)
                n.setAttribute("checked", "");
        }
        else if (n.tagName === "TEXTAREA")
            n.textContent = s.value;
        else if (n.tagName === "SELECT")
            [...n.options].forEach((op, j) => { if (j === s.selectedIndex)
                op.setAttribute("selected", ""); });
        else
            n.setAttribute("value", s.value);
    });
    copy.querySelectorAll(`script,link,noscript,.g-modal,.g-tour${o.drop ? "," + o.drop : ""}`).forEach(n => n.remove());
    const data = async (u) => { const b = await (await win.fetch(u)).blob(); return new Promise(res => { const f = new win.FileReader(); f.onload = () => res(String(f.result)); f.readAsDataURL(b); }); };
    await Promise.all([...copy.querySelectorAll("img[src]")].map(async (i) => { try {
        i.src = await data(i.src);
    }
    catch {
        i.removeAttribute("src");
    } }));
    const style = doc.createElement("style");
    style.textContent = (await Promise.all((o.styles ?? []).map(async (u) => (await win.fetch(u)).text()))).join("\n");
    copy.querySelector("head").append(style);
    copy.style.cssText += `;width:${W}px;height:${H}px;overflow:hidden`;
    copy.querySelector("body").style.cssText += `;margin-top:${-win.scrollY}px`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><foreignObject width="100%" height="100%">${new win.XMLSerializer().serializeToString(copy)}</foreignObject></svg>`;
    const img = new win.Image();
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    await img.decode();
    for (const s of [Math.min(win.devicePixelRatio || 1, 2), 1, 0.75, 0.5, 0.35]) {
        const c = doc.createElement("canvas");
        c.width = Math.round(W * s);
        c.height = Math.round(H * s);
        const g = c.getContext("2d");
        g.fillStyle = win.getComputedStyle(doc.body).backgroundColor || "#fff";
        g.fillRect(0, 0, c.width, c.height);
        g.drawImage(img, 0, 0, c.width, c.height);
        const url = c.toDataURL("image/png");
        if ((url.length - 22) * 3 / 4 <= pngMax)
            return url;
    }
    return null;
}
export function feedback(o) {
    const doc = o.doc ?? document, win = doc.defaultView, w = o.words, MAX = o.max ?? 4000;
    const dot = doc.createElement("i");
    dot.className = "g-fb-dot";
    dot.hidden = true;
    o.button.append(dot);
    const waiting = () => { try {
        return JSON.parse(win.localStorage.getItem(o.queueKey) || "[]");
    }
    catch {
        return [];
    } };
    function keep(list) {
        try {
            list.length ? win.localStorage.setItem(o.queueKey, JSON.stringify(list)) : win.localStorage.removeItem(o.queueKey);
        }
        catch {
            try {
                win.localStorage.setItem(o.queueKey, JSON.stringify(list.map(x => ({ ...x, screenshot: undefined }))));
            }
            catch { /* nowhere to keep it */ }
        }
        dot.hidden = !waiting().length;
    }
    const post = (body) => win.fetch(o.endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    async function flush() {
        let list = waiting(), sent = 0;
        while (list.length && win.navigator.onLine !== false) {
            let r;
            try {
                r = await post(list[0]);
            }
            catch {
                break;
            }
            if (r.status === 429 || r.status >= 500 || r.status === 401)
                break;
            list = list.slice(1);
            if (r.ok)
                sent++;
            keep(list);
        }
        keep(list);
        if (sent)
            o.toast(w.sentLater);
    }
    const m = modal({ doc, title: w.title, closeLabel: w.close, className: "g-fb" });
    m.body.innerHTML = `<form class="g-fb-form">
    <div class="g-fb-kinds" role="group">${o.kinds.map(k => `<button type="button" data-kind="${k.id}" aria-pressed="false"></button>`).join("")}</div>
    <label class="g-fb-sr"></label><textarea rows="5" maxlength="${MAX}"></textarea>
    <p class="g-fb-count" aria-live="polite" hidden></p>
    <label class="g-fb-check"><input type="checkbox" class="g-fb-pic"> <span></span></label>
    <div class="g-fb-shot" hidden><span class="g-fb-thumb"><img><button type="button" class="g-fb-x">×</button></span><p class="g-fb-note"></p></div>
    <p class="g-fb-ctx"></p><p class="g-fb-err" role="alert" hidden></p>
    <div class="g-fb-acts"><button type="button" class="g-fb-cancel"></button><button type="submit" class="g-fb-send" disabled></button></div></form>`;
    const q = (s) => m.body.querySelector(s);
    const form = q(".g-fb-form"), ta = q("textarea"), send = q(".g-fb-send"), pic = q(".g-fb-pic"), err = q(".g-fb-err");
    q(".g-fb-kinds").setAttribute("aria-label", w.kindGroup);
    q(".g-fb-sr").textContent = w.textLabel;
    ta.id = (ta.id || "gFbText" + Math.random().toString(36).slice(2, 6));
    q(".g-fb-sr").htmlFor = ta.id;
    ta.placeholder = w.placeholder;
    q(".g-fb-check span").textContent = w.picture;
    q(".g-fb-shot img").alt = w.pictureAlt;
    const x = q(".g-fb-x");
    x.setAttribute("aria-label", w.pictureRemove);
    x.title = w.pictureRemove;
    q(".g-fb-note").textContent = w.pictureNote;
    q(".g-fb-cancel").textContent = w.cancel;
    send.textContent = w.send;
    [...m.body.querySelectorAll(".g-fb-kinds button")].forEach((b, i) => { b.textContent = o.kinds[i].label; });
    if (o.below)
        m.body.append(o.below);
    let kind = "", shot = null, busy = false, blockedUntil = 0;
    const say = (t) => { err.textContent = t; err.hidden = !t; };
    const count = () => {
        const n = ta.value.length, c = q(".g-fb-count");
        c.hidden = n < MAX * 0.9;
        c.textContent = w.left(MAX - n);
        send.disabled = busy || !ta.value.trim() || Date.now() < blockedUntil;
    };
    const setPic = async (on) => {
        pic.checked = on;
        shot = null;
        q(".g-fb-shot").hidden = true;
        if (!on)
            return;
        let made = false;
        m.el.style.visibility = "hidden"; // the page without the dialog
        try {
            made = await (o.picture ? o.picture() : pagePicture(doc, o.pngMax != null ? { pngMax: o.pngMax } : {}));
        }
        catch (e) {
            console.warn("feedback picture", e);
        }
        m.el.style.visibility = "";
        if (!pic.checked)
            return;
        if (!made) {
            pic.checked = false;
            return say(made === null ? w.pictureTooBig : w.pictureFailed);
        }
        shot = made;
        q(".g-fb-shot img").src = shot;
        q(".g-fb-shot").hidden = false;
    };
    m.body.querySelectorAll(".g-fb-kinds button").forEach(b => b.onclick = () => {
        kind = b.dataset.kind;
        m.body.querySelectorAll(".g-fb-kinds button").forEach(y => y.setAttribute("aria-pressed", String(y === b)));
        ta.placeholder = o.kinds.find(k => k.id === kind).placeholder;
    });
    ta.addEventListener("input", count);
    pic.addEventListener("change", () => setPic(pic.checked));
    x.onclick = () => { setPic(false); pic.focus(); };
    q(".g-fb-cancel").onclick = () => m.close();
    const lock = (on) => { busy = on; ta.readOnly = on; pic.disabled = on; send.textContent = on ? w.sending : w.send; count(); };
    const reset = () => { kind = ""; ta.value = ""; ta.placeholder = w.placeholder; m.body.querySelectorAll(".g-fb-kinds button").forEach(y => y.setAttribute("aria-pressed", "false")); setPic(false); say(""); count(); };
    form.onsubmit = async (e) => {
        e.preventDefault();
        if (busy || !ta.value.trim())
            return;
        say("");
        const body = { kind: kind || o.kinds[o.kinds.length - 1].id, text: ta.value.trim(), ...o.context().ctx, ...(pic.checked && shot ? { screenshot: shot } : {}) };
        const offline = () => { keep([...waiting(), body]); m.close(); reset(); o.toast(w.savedHere); };
        if (win.navigator.onLine === false)
            return offline();
        lock(true);
        let r;
        try {
            r = await post(body);
        }
        catch {
            lock(false);
            return offline();
        }
        const j = await r.json().catch(() => ({}));
        lock(false);
        if (r.ok) {
            m.close();
            reset();
            o.toast(w.thanks);
            return;
        }
        if (r.status === 401)
            return say(w.signedOut);
        if (r.status === 429 && j.code === "limit") {
            if (j.retry_at) {
                blockedUntil = Date.parse(j.retry_at);
                setTimeout(count, Math.max(0, blockedUntil - Date.now()) + 500);
                count();
            }
            return say(w.limit(j.retry_at ? new Date(j.retry_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }) : ""));
        }
        if (j.code === "bad_image" || (j.code === "too_long" && body.screenshot && body.text.length <= MAX)) {
            setPic(false);
            return say(w.pictureTooBig);
        }
        if (j.code === "too_long")
            return say(w.tooLong);
        say(w.notSent);
    };
    o.button.setAttribute("aria-haspopup", "dialog");
    const open = () => { q(".g-fb-ctx").textContent = o.context().line; say(""); count(); o.onOpen?.(); m.open(); };
    o.button.addEventListener("click", open);
    keep(waiting());
    win.addEventListener("online", flush);
    if (waiting().length)
        flush();
    return { open, close: () => m.close(), flush, modal: m };
}
