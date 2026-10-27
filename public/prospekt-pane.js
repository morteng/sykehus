/* The Prospekt in the viewing area (Morten 2026-10-28: «not full screen, in the viewing area, a new button top left, prospekt, as default view»).
   One content builder (prospekt-view.js) is mounted here; the old page /prospekt/<id> only sends on to the main page with this view picked (prospekt.js).
   Which view opens first: a shared project that is not the person's own opens on the Prospekt; the owner's opens on 3D; ?vis=prospekt / ?vis=3d asks. */
import { prospektHtml, GONE, LIGHTBOX_HTML } from "./prospekt-view.js";

export const sharedOpen = draft => !!draft?.version && !draft.missing && draft.sharing !== "privat";   // the Prospekt exists for a shared project only (the server answers privat with 404)
export function firstView({ shared, owner, asked }) {
  if (!shared) return "3d";
  if (asked === "prospekt" || asked === "3d") return asked;
  return owner ? "3d" : "prospekt";
}

/* the owner's own project that is not shared yet: there is no Prospekt to show a visitor, and the page says how to get one */
export const PRIVATE_HTML = `<div class="pk-gone"><h1>Prosjektet er privat</h1><p>Et prospekt finnes først når prosjektet er delt. Del det med lenke eller åpent under «Detaljer» i Prosjekter, så vises det her slik andre ser det.</p></div>`;
/* the Prospekt can be opened for a shared project, and for the owner's own while working, shared or not */
export const prospektOpen = (draft, owner) => sharedOpen(draft) || (!!draft?.version && !draft.missing && !!owner);

/* fetch the Prospekt and write it into `el`; resolves to its data, or null (it says why in `el`) */
export async function renderProspekt(el, { id, nokkel, explore, fetch: get = fetch }) {
  const r = await get(`api/prospekt/${encodeURIComponent(id)}${nokkel ? `?nokkel=${encodeURIComponent(nokkel)}` : ""}`).catch(() => null);
  if (!r) { el.innerHTML = `<p class="pk-gone">Fikk ikke kontakt med tjeneren. Prøv igjen om litt.</p>`; return null; }
  if (!r.ok) { el.innerHTML = GONE; return null; }
  const data = await r.json(); el.innerHTML = prospektHtml(data, { links: { explore } });
  return data;
}

/* the picture viewer, on the pane: a click on a figure opens it and the arrows step through `figs()` (the data's figures, in the order data-lb counts them) */
export function bindLightbox(pane, figs) {
  pane.insertAdjacentHTML("beforeend", LIGHTBOX_HTML);
  const lb = pane.querySelector("[data-pklb]"), q = s => lb.querySelector(s); let at = 0;
  const show = i => { const all = figs(); if (!all.length) return; at = (i + all.length) % all.length; const f = all[at]; q("[data-img]").src = f.url; q("[data-img]").alt = f.caption; q("[data-cap]").textContent = f.caption; q("[data-dl]").href = f.url; lb.hidden = false; q("[data-n]").hidden = q("[data-p]").hidden = all.length < 2; };
  const close = () => { lb.hidden = true; q("[data-img]").removeAttribute("src"); };
  pane.addEventListener("click", e => { const b = e.target.closest("[data-lb]"); if (b) show(+b.dataset.lb); });
  q("[data-x]").onclick = close; q("[data-n]").onclick = () => show(at + 1); q("[data-p]").onclick = () => show(at - 1);
  lb.addEventListener("click", e => { if (e.target === lb) close(); });
  addEventListener("keydown", e => { if (lb.hidden) return; if (e.key === "Escape") close(); else if (e.key === "ArrowRight") show(at + 1); else if (e.key === "ArrowLeft") show(at - 1); });
}
