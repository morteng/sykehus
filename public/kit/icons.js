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
    clip: "M21 11.5l-8.5 8.5a5.5 5.5 0 0 1-8-7.6l9-9a3.7 3.7 0 0 1 5.3 5.3l-9 9a1.8 1.8 0 0 1-2.6-2.6l8.3-8.3",
    pen: "M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19z M14.5 6.5l3 3",
    scan: "M4 8V5a1 1 0 0 1 1-1h3 M16 4h3a1 1 0 0 1 1 1v3 M20 16v3a1 1 0 0 1-1 1h-3 M8 20H5a1 1 0 0 1-1-1v-3 M4 12h16",
    plus: "M12 5v14 M5 12h14",
    down: "M12 5v14 M6 13l6 6 6-6",
    empty: "M4 7h16v12H4z M4 7l2-3h12l2 3 M9 12h6",
    help: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7 M12 17h.01",
    send: "M12 19V5 M5 12l7-7 7 7",
    stop: "M7 7h10v10H7z",
    history: "M3 12a9 9 0 1 0 3-6.7 M3 4v5h5 M12 7.5V12l3 2",
    mic: "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z M5 11a7 7 0 0 0 14 0 M12 18v3",
    chat: "M4 5h16v11H9l-5 4z M12 8.5v4 M10 10.5h4",
};
/** The glyph as SVG markup, hidden from assistive technology. */
export function iconSVG(name) {
    const w = name === "more" ? 3 : 2;
    return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"><path d="${ICONS[name]}"/></svg>`;
}
