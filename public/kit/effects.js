// Small effects for small moments: a few leaves when the person adds or finishes something, a soft puff of dust when
// they remove something. DOM only. One reused layer holds the particles; each is removed when its animation ends.
//
// The rules (the README row repeats them): only on a person's OWN act, never on a step the assistant takes; leaves mean
// added or done, dust means removed; the layer takes no pointer events, so nothing is ever blocked; under one second;
// nothing at all when the person prefers less motion. Colours come from the kit tokens, so every look and dark mode follow.
export const MAX_PARTICLES = 14;
/** The longest any particle lives, in ms (the CSS animation is as long). */
export const FX_MS = { leaves: 900, dust: 800, spark: 600 };
const DEFAULT_COUNT = { leaves: 10, dust: 6, spark: 8 };
const DEFAULT_COLORS = {
    leaves: ["var(--ok)", "color-mix(in srgb, var(--ok) 55%, var(--warn))", "var(--warn)"], // green and honey: --accent is the app's ink in some looks, never a leaf
    dust: ["color-mix(in srgb, var(--muted) 75%, transparent)"],
    spark: ["var(--ok)", "var(--warn)"],
};
const CLASS = { leaves: "g-fx-leaf", dust: "g-fx-dust", spark: "g-fx-spark" };
/** Never more live particles than this, so a held key cannot pile them up. */
const LIVE_CAP = 40;
function calm(doc) {
    const w = doc.defaultView;
    return !w || !w.matchMedia || w.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
function layerOf(doc) {
    let el = doc.querySelector(".g-fx-layer");
    if (!el) {
        el = doc.createElement("div");
        el.className = "g-fx-layer";
        el.setAttribute("aria-hidden", "true");
        doc.body.append(el);
    }
    return el;
}
/** Particles out of the page point (x, y), in page (viewport) pixels. Returns how many were drawn (0 for reduced motion). */
export function burst(x, y, opts) {
    const doc = opts.doc ?? document;
    if (calm(doc) || !Number.isFinite(x) || !Number.isFinite(y))
        return 0;
    const kind = opts.kind;
    const layer = layerOf(doc);
    const room = LIVE_CAP - layer.childElementCount;
    const n = Math.min(MAX_PARTICLES, Math.max(1, Math.floor(opts.count ?? DEFAULT_COUNT[kind])), room);
    if (n <= 0)
        return 0;
    const colors = opts.colors?.length ? opts.colors : DEFAULT_COLORS[kind];
    for (let i = 0; i < n; i++) {
        const s = doc.createElement("span");
        const a = kind === "dust" ? -Math.PI / 2 + (Math.random() - 0.5) * 3 : (i / n) * 2 * Math.PI + Math.random() * 0.4;
        const d = kind === "dust" ? 16 + Math.random() * 20 : kind === "spark" ? 14 + Math.random() * 18 : 26 + Math.random() * 26;
        s.className = CLASS[kind];
        s.style.left = `${x}px`;
        s.style.top = `${y}px`;
        s.style.setProperty("--g-fx-c", colors[i % colors.length]);
        s.style.setProperty("--g-fx-dx", `${(Math.cos(a) * d).toFixed(1)}px`);
        s.style.setProperty("--g-fx-dy", `${(Math.sin(a) * d - (kind === "dust" ? 8 : 0)).toFixed(1)}px`);
        s.style.setProperty("--g-fx-rot", `${Math.round(Math.random() * 360)}deg`);
        s.style.setProperty("--g-fx-s", (0.8 + Math.random() * 0.5).toFixed(2));
        layer.append(s);
        setTimeout(() => s.remove(), FX_MS[kind] + 60);
    }
    return n;
}
/** Like burst(), at a point the app projects (a map or 3D scene to screen): `project()` gives page pixels, or null when
 * the point is off screen (nothing is drawn then). */
export function burstAt(point, project, opts) {
    const q = project(point);
    return q ? burst(q.x, q.y, opts) : 0;
}
function once(el, cls) {
    const doc = el.ownerDocument;
    if (calm(doc))
        return;
    el.classList.remove(cls);
    void el.offsetWidth; // restart the animation when it is run twice
    el.classList.add(cls);
    setTimeout(() => el.classList.remove(cls), 450);
}
/** A new thing arrives with a small pop (a card, a pin). */
export function popIn(el) { once(el, "g-fx-pop"); }
/** A new thing rises a few pixels into place (a row, a card in a list). */
export function riseIn(el) { once(el, "g-fx-rise"); }
