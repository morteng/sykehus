// A photo from the camera, one copy for every chat pill. On a phone (coarse pointer) an input with capture="environment" opens the
// camera app. On a desktop the button is shown only when the browser lists a camera; getUserMedia runs in a kit modal (Take,
// Retake, Use) and every track stops when it closes, by any way. shrink() keeps a photo small enough to send. The lift of
// the camera code is from Fab's scan.js (getUserMedia, stop the tracks).
import { modal } from "./modal.js";
/** The decision, pure. A phone with a coarse pointer always has its camera app; a desktop needs a listed videoinput. */
export function cameraPath(coarse, hasVideoInput) {
    return coarse ? "capture" : hasVideoInput ? "stream" : "none";
}
const envOf = (e = {}) => {
    const doc = e.doc ?? document, win = doc.defaultView ?? window, md = win.navigator?.mediaDevices;
    return {
        doc,
        coarse: e.coarse ?? !!win.matchMedia?.("(pointer: coarse)").matches,
        enumerateDevices: e.enumerateDevices ?? (md?.enumerateDevices ? () => md.enumerateDevices() : undefined),
        getUserMedia: e.getUserMedia ?? (md?.getUserMedia ? (c) => md.getUserMedia(c) : undefined),
    };
};
/** Which path this device has. Use it as an attach item's `when()` after awaiting once (it is async because of enumerateDevices). */
export async function cameraAvailable(e) {
    const v = envOf(e);
    if (v.coarse)
        return "capture";
    if (!v.enumerateDevices || !v.getUserMedia)
        return "none";
    try {
        return cameraPath(false, (await v.enumerateDevices()).some((d) => d.kind === "videoinput"));
    }
    catch {
        return "none";
    }
}
/** The side of a picture w × h scaled to fit `max` on its longer side; never scaled up. */
export function fitSide(w, h, max) {
    const m = Math.max(w, h);
    if (m <= max)
        return [w, h];
    const s = max / m;
    return [Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s))];
}
/** A JPEG of at most `maxSide` px on its longer side. A file that cannot be decoded here (HEIC, a broken one) is handed back as it
 *  is: the cap of the attach refuses it if it is too big. A shrunk copy that came out larger than the original is not used. */
export async function shrink(file, maxSide = 2048) {
    try {
        const bmp = await createImageBitmap(file);
        const [w, h] = fitSide(bmp.width, bmp.height, maxSide);
        if (w === bmp.width && h === bmp.height && file.type === "image/jpeg") {
            bmp.close?.();
            return file;
        }
        const cv = document.createElement("canvas");
        cv.width = w;
        cv.height = h;
        cv.getContext("2d").drawImage(bmp, 0, 0, w, h);
        bmp.close?.();
        const blob = await new Promise((r) => cv.toBlob(r, "image/jpeg", 0.88));
        if (!blob || (blob.size >= file.size && file.type === "image/jpeg"))
            return file;
        return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg", lastModified: file.lastModified });
    }
    catch {
        return file;
    }
}
/** Takes one photo. Null when the person cancelled or there is no camera. A file still over the cap is for attach to refuse. */
export async function takePhoto(o) {
    const path = await cameraAvailable(o);
    const max = o.maxSide ?? 2048;
    const v = envOf(o);
    const f = path === "capture" ? await fromInput(v.doc) : path === "stream" ? await fromStream(o, v) : null;
    if (!f)
        return null;
    return shrink(f, max);
}
function fromInput(doc) {
    return new Promise((done) => {
        const i = doc.createElement("input");
        i.type = "file";
        i.accept = "image/*";
        i.setAttribute("capture", "environment");
        i.hidden = true;
        doc.body.append(i);
        const end = (f) => { i.remove(); done(f); };
        i.addEventListener("change", () => end(i.files?.[0] ?? null));
        i.addEventListener("cancel", () => end(null));
        i.click();
    });
}
function fromStream(o, v) {
    const { doc, getUserMedia } = v;
    const W = o.words;
    return new Promise((done) => {
        let stream = null, shot = null, result = null, gone = false;
        const stop = () => { stream?.getTracks().forEach((t) => t.stop()); stream = null; };
        const m = modal({ doc, title: W.title, closeLabel: W.close, className: "g-camera", onClose: () => { gone = true; stop(); m.el.remove(); done(result); } });
        const video = doc.createElement("video");
        video.className = "g-camera__view";
        video.autoplay = true;
        video.muted = true;
        video.setAttribute("playsinline", "");
        const said = doc.createElement("p");
        said.className = "g-camera__said";
        said.setAttribute("role", "status");
        const acts = doc.createElement("div");
        acts.className = "g-camera__acts";
        const btn = (label, primary = false) => { const b = doc.createElement("button"); b.type = "button"; b.textContent = label; if (primary)
            b.className = "pri"; return b; };
        const cancel = btn(W.cancel), take = btn(W.take, true), retake = btn(W.retake), use = btn(W.use, true);
        const face = () => { take.hidden = !!shot; retake.hidden = use.hidden = !shot; };
        face();
        acts.append(cancel, retake, take, use);
        m.body.append(video, said, acts);
        cancel.addEventListener("click", () => m.close());
        take.addEventListener("click", () => {
            const w = video.videoWidth, h = video.videoHeight;
            if (!w || !h)
                return;
            const [cw, ch] = fitSide(w, h, o.maxSide ?? 2048), cv = doc.createElement("canvas");
            cv.width = cw;
            cv.height = ch;
            cv.getContext("2d").drawImage(video, 0, 0, cw, ch);
            cv.toBlob((b) => { if (!b)
                return; shot = b; video.pause(); face(); }, "image/jpeg", 0.88);
        });
        retake.addEventListener("click", () => { shot = null; void video.play?.(); face(); });
        use.addEventListener("click", () => {
            if (!shot)
                return;
            result = new File([shot], `photo-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}.jpg`, { type: "image/jpeg" });
            m.close();
        });
        m.open();
        getUserMedia({ video: { facingMode: "environment" }, audio: false }).then((s) => {
            if (gone) {
                s.getTracks().forEach((t) => t.stop());
                return;
            } // closed while asking
            stream = s;
            video.srcObject = s;
            void video.play?.();
        }, () => { said.textContent = W.denied; });
    });
}
