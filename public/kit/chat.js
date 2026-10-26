// The conversation over an input (.g-chat): a sheet that sits above the app's input and shows the messages the app has
// drawn, newest at the bottom, with the app's own actions in its header (a «new conversation» button) and a fold. Its
// top edge is the kit's resize handle (split.ts, axis «y»): dragged or moved with ↑ ↓, between `min` and a share of the
// view, remembered, put back by a double click; dragged down past the minimum it folds to the last message only. The
// kit draws no message: the app draws them into `log` and `actions` as it does elsewhere, and the sheet takes those two
// elements in while it shows and gives them back where they were when it does not (one list, moved, never copied).
// Words are always arguments.
import { split } from "./split.js";
/** Whether the sheet shows: there is something said, and the conversation is not already open elsewhere. */
export const sheetShown = (messages, openElsewhere) => messages > 0 && !openElsewhere;
const CHEVRON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg>';
export function chatSheet(o) {
    const doc = o.host.ownerDocument, win = doc.defaultView;
    const store = o.storage !== undefined ? o.storage : (() => { try {
        return win.localStorage;
    }
    catch {
        return null;
    } })();
    const key = o.key ?? "g-chat-height", min = o.min ?? 120;
    const el = doc.createElement("section");
    el.className = "g-chat";
    el.hidden = true;
    el.setAttribute("aria-label", o.title);
    const head = doc.createElement("div");
    head.className = "g-chat-head";
    const title = doc.createElement("span");
    title.className = "g-chat-title";
    title.textContent = o.title;
    const acts = doc.createElement("span");
    acts.className = "g-chat-acts";
    const foldBtn = doc.createElement("button");
    foldBtn.type = "button";
    foldBtn.className = "g-chat-fold";
    foldBtn.innerHTML = CHEVRON;
    head.append(title, acts, foldBtn);
    const body = doc.createElement("div");
    body.className = "g-chat-body";
    el.append(head, body);
    o.host.append(el);
    let home = null, homeActs = null;
    const spot = (n) => ({ parent: n.parentNode, next: n.nextSibling });
    const back = (n, h) => { if (h && n.parentNode !== h.parent)
        h.parent.insertBefore(n, h.next && h.next.parentNode === h.parent ? h.next : null); };
    const readFold = () => { try {
        return store?.getItem(key + "-fold") === "1";
    }
    catch {
        return false;
    } };
    const writeFold = (v) => { try {
        if (v)
            store?.setItem(key + "-fold", "1");
        else
            store?.removeItem(key + "-fold");
    }
    catch { /* this visit only */ } };
    let folded = readFold();
    const paint = () => {
        el.classList.toggle("folded", folded);
        foldBtn.setAttribute("aria-expanded", String(!folded));
        foldBtn.setAttribute("aria-label", folded ? o.unfoldLabel : o.foldLabel);
        foldBtn.title = folded ? o.unfoldLabel : o.foldLabel;
        if (folded) {
            el.style.removeProperty("height");
            sp.el.hidden = true;
        }
        else
            sp.refresh();
        toEnd();
    };
    const toEnd = () => { body.scrollTop = body.scrollHeight; };
    const sp = split({ panel: el, axis: "y", edge: "start", min, maxShare: o.maxShare ?? 0.6, step: 16, storage: store, key, prop: "--g-chat-h", name: o.name, title: o.hint,
        viewport: o.viewport, foldBelow: 30, onFold: () => { api.fold(true); o.onChange?.(); }, onChange: () => { toEnd(); o.onChange?.(); } });
    const api = {
        el, split: sp, toEnd,
        get open() { return o.log.parentNode === body; },
        get folded() { return folded; },
        show(on) {
            if (on) {
                if (o.log.parentNode !== body) {
                    home = spot(o.log);
                    body.append(o.log);
                }
                if (o.actions && o.actions.parentNode !== acts) {
                    homeActs = spot(o.actions);
                    acts.append(o.actions);
                }
                el.hidden = false;
                paint();
            }
            else {
                el.hidden = true;
                if (o.actions)
                    back(o.actions, homeActs);
                back(o.log, home);
            }
        },
        fold(on) { folded = on; writeFold(on); paint(); },
    };
    foldBtn.addEventListener("click", () => { api.fold(!folded); o.onChange?.(); });
    return api;
}
