/* The person's effects switch (U4482), one answer per device: the cookie gulden_fx (Domain=gulden.no beside gulden_theme),
   no cookie = on. data-fx="off" on <html> is how the kit's effects (kit/effects.js fxOn) know; reduced motion wins there. */
import { FX_COOKIE, fxCookie } from "./kit/effects.js";

/** Stamps <html data-fx="off"> when the cookie says off, else removes it. */
export function stampFx(doc = document) {
  const off = (doc.cookie || "").split(/;\s*/).some(c => c === `${FX_COOKIE}=off`);
  if (off) doc.documentElement.setAttribute("data-fx", "off"); else doc.documentElement.removeAttribute("data-fx");
  return !off;
}

/** The person presses På or Av: the cookie is written and data-fx flips at once. */
export function setFx(on, doc = document, loc = doc.defaultView?.location ?? location) {
  doc.cookie = fxCookie(on, loc.hostname, loc.protocol === "https:");
  stampFx(doc);
}

/** The «Effekter» På / Av pill pair (the kit's .g-seg), as a row to put in a menu or a settings box. */
export function fxPills(doc = document) {
  const row = doc.createElement("div"); row.className = "fx-row"; row.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:12px;padding:6px 10px";
  const label = doc.createElement("span"); label.textContent = "Effekter";
  const seg = doc.createElement("div"); seg.className = "g-seg"; seg.setAttribute("role", "group"); seg.setAttribute("aria-label", "Effekter");
  const mk = (text, on) => { const b = doc.createElement("button"); b.type = "button"; b.textContent = text; b.dataset.fx = on ? "on" : "off"; return b; };
  const bOn = mk("På", true), bOff = mk("Av", false);
  const face = () => { const on = doc.documentElement.getAttribute("data-fx") !== "off"; bOn.setAttribute("aria-pressed", String(on)); bOff.setAttribute("aria-pressed", String(!on)); };
  for (const b of [bOn, bOff]) b.addEventListener("click", () => { setFx(b === bOn, doc); face(); });
  face(); seg.append(bOn, bOff); row.append(label, seg);
  return row;
}
