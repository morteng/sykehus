// The one way to show a picture (U3973). A picture is never served as it is: the stack's scaler (imgproxy, under
// /px/ on every app host) cuts it to the width it is drawn at and writes WebP, and this file writes the <img> that asks for it.
// A server that draws pages writes the same markup with its twin (Fab: ukit.py picture(); compared byte for byte with
// dist/picture.sample.json). The scaler holds no key: its Caddy block admits only a width in WIDTHS, the app's own
// source prefix and no «..», so a width outside WIDTHS is not an address it answers (404).
import { attrs } from "./html.js";
/** The widths the scaler answers. A shown width rounds UP to the next one, so the picture is never softer than drawn. */
export const WIDTHS = [160, 240, 320, 480, 640, 800, 1024, 1280, 1600, 2048];
/** The smallest width in WIDTHS that is at least `w` (the largest when `w` is beyond them). */
export function bucket(w) {
    const n = Math.ceil(w);
    return WIDTHS.find((x) => x >= n) ?? WIDTHS[WIDTHS.length - 1];
}
const SAFE = /^\/[A-Za-z0-9._~/-]+$/;
// SVG and GIF are not cut (a drawing scales by itself, a GIF may move); data: and blob: are not on the scaler's host at all.
const RAW = /\.(svg|gif)$|^(data|blob):/i;
/** The scaler's address for a path of the app (`/static/a.jpg`) at width `w`; null when the path cannot go through it. */
export function scaled(path, w, from) {
    if (!SAFE.test(path) || path.includes("..") || RAW.test(path))
        return null;
    const src = from.origin === "local" ? `local://${path}` : `${from.origin.replace(/\/+$/, "")}${path}`;
    return `${from.base ?? "/px"}/rs:fit:${bucket(w)}:0/plain/${src}`;
}
/** The <img> markup: src at the shown width, srcset 1x/2x, width/height, lazy and async. A path the scaler cannot take is written as it is. */
export function pictureHTML(path, o, from) {
    const one = scaled(path, o.w, from);
    const two = scaled(path, o.w * 2, from);
    const a = {
        src: one ?? path,
        srcset: one && two && one !== two ? `${one} 1x, ${two} 2x` : undefined,
        width: Math.round(o.w),
        height: o.h === undefined ? undefined : Math.round(o.h),
        alt: o.alt,
        class: o.class,
        loading: o.eager ? undefined : "lazy",
        fetchpriority: o.eager ? "high" : undefined,
        decoding: "async",
    };
    return `<img${attrs(a)}>`;
}
/** The same <img> as an element. */
export function picture(path, o, from, doc = document) {
    const t = doc.createElement("template");
    t.innerHTML = pictureHTML(path, o, from);
    return t.content.firstElementChild;
}
/** The cases the twin must equal: dist/picture.sample.json (tools/build.mjs). */
export const PICTURE_CASES = [
    { path: "/static/a.jpg", opts: { w: 296, h: 180, alt: "A jig" }, from: { origin: "http://laser:8000" } },
    { path: "/img/b.png", opts: { w: 1000, alt: "", eager: true, class: "hero" }, from: { origin: "http://app:8000/" } },
    { path: "/tex/c.jpg", opts: { w: 3000, h: 2000, alt: "A \"quote\" & <tag>" }, from: { origin: "local" } },
    { path: "/static/d.svg", opts: { w: 24, h: 24, alt: "" }, from: { origin: "http://laser:8000" } },
    { path: "/static/../x.jpg", opts: { w: 100, alt: "" }, from: { origin: "http://laser:8000" } },
];
