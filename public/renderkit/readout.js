/* A pointer readout (U3883): a small chip in a corner of the view that says where the pointer is, «Ø 597 123,4  N 6 643 210,8  h 112,3 m».
   Fab's #hud look (muted text on a --panel chip with a --border), one copy for every app. No three.js: the app finds the
   point under the pointer and hands it in.

   formatReadout({ e, n, h }, { locale, decimals, words }) → string    pure; h is left out when it is not a number
   createReadout({ host, locale?, decimals?, words?, corner?, doc }) → { el, set(p), hide(), shown }
     set({ e, n, h? }) shows the chip with that point (east, north, height in metres); set(null) or a point with a
     non-number e or n hides it. corner: "bl" (default), "br", "tl", "tr". Colours are the UI kit's tokens. */

const WORDS = { e: "E", n: "N", h: "h" };
const fin = v => typeof v === "number" && Number.isFinite(v);

export function formatReadout(p, { locale = undefined, decimals = 1, words = {} } = {}) {
  const W = { ...WORDS, ...words };
  const num = v => v.toLocaleString(locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const parts = [`${W.e} ${num(p.e)}`, `${W.n} ${num(p.n)}`];
  if (fin(p.h)) parts.push(`${W.h} ${num(p.h)} m`);
  return parts.join("  ");
}

const CORNER = { bl: "left:10px;bottom:10px", br: "right:10px;bottom:10px", tl: "left:10px;top:10px", tr: "right:10px;top:10px" };

export function createReadout({ host, locale = undefined, decimals = 1, words = {}, corner = "bl", doc = globalThis.document } = {}) {
  const el = doc.createElement("div");
  el.className = "rk-readout"; el.hidden = true; el.setAttribute("aria-hidden", "true");
  el.style.cssText = `position:absolute;${CORNER[corner] || CORNER.bl};z-index:var(--z-canvas);pointer-events:none;white-space:pre;font-variant-numeric:tabular-nums;font-size:var(--fs-xs);color:var(--muted);background:var(--panel);border:1px solid var(--border);border-radius:var(--radius);padding:3px var(--sp-2)`;
  host.appendChild(el);
  const hide = () => { el.hidden = true; };
  function set(p) {
    if (!p || !fin(p.e) || !fin(p.n)) return hide();
    const t = formatReadout(p, { locale, decimals, words });
    if (el.textContent !== t) el.textContent = t;
    el.hidden = false;
  }
  return { el, set, hide, get shown() { return !el.hidden; } };
}
