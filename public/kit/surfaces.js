// The kit's one list of surfaces: widths, input and preference queries. kit.css writes the same queries out literally
// (CSS cannot put a custom property in @media); tests/surfaces.test.mjs fails on any @media in kit.css not in QUERIES.
// Widths are in rem, so they follow the browser's font-size setting, not an app's clamped root size.
export const QUERIES = {
    narrow: "(max-width: 47.99rem)",
    medium: "(min-width: 48rem) and (max-width: 63.99rem)",
    desktop: "(min-width: 64rem) and (max-width: 89.99rem)",
    wide: "(min-width: 90rem)",
    hover: "(hover: hover) and (pointer: fine)",
    touch: "(hover: none), (pointer: coarse)",
    reducedMotion: "(prefers-reduced-motion: reduce)",
    forcedColors: "(forced-colors: active)",
    light: "(prefers-color-scheme: light)",
};
export const WIDTHS = ["narrow", "medium", "desktop", "wide"];
/** True when the surface's query matches now. */
export function matches(surface, win = window) {
    return win.matchMedia(QUERIES[surface]).matches;
}
/** The width band the window is in now. */
export function width(win = window) {
    return WIDTHS.find((w) => matches(w, win)) ?? "wide";
}
/** Calls fn with the new value each time the surface's query changes; returns the function that stops it. */
export function watch(surface, fn, win = window) {
    const mq = win.matchMedia(QUERIES[surface]);
    const on = (e) => fn(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
}
/** "tv" when the app marked the root as a TV (data-device="tv"), else "screen". Offline is not a surface: the app
 * passes it in as state (navigator.onLine and a failed call). */
export function device(root = document.documentElement) {
    return root.getAttribute("data-device") === "tv" ? "tv" : "screen";
}
