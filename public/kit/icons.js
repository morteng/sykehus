// The kit's icon set: Feather-style strokes, currentColor, 24 px grid, stroke 2 (the dots of «more» 3). A glyph alone
// carries no name: a control that shows one gets its name from iconButton()'s label (aria-label and tooltip, one word).
export const ICONS = {
    list: "M4 6h16 M4 12h16 M4 18h16",
    grid: "M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M13 13h7v7h-7z",
    more: "M5 12h.01 M12 12h.01 M19 12h.01",
    search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z M20 20l-4-4",
    x: "M6 6l12 12 M18 6L6 18",
    open: "M14 5h5v5 M19 5l-8 8 M17 14v5H5V7h5",
    download: "M12 4v11 M7 10l5 5 5-5 M5 20h14",
    camera: "M4 8h3l2-2.5h6L17 8h3v11H4z M12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z",
    plus: "M12 5v14 M5 12h14",
    down: "M12 5v14 M6 13l6 6 6-6",
    empty: "M4 7h16v12H4z M4 7l2-3h12l2 3 M9 12h6",
};
/** The glyph as SVG markup, hidden from assistive technology. */
export function iconSVG(name) {
    const w = name === "more" ? 3 : 2;
    return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"><path d="${ICONS[name]}"/></svg>`;
}
