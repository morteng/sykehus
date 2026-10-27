/* Prospekt (prospekt.mjs): a shared project, read-only, for anyone. Pictures, numbers and the plot's limits; no chat, no edit tools, no live 3D.
   «Utforsk i 3D» opens the normal project view (a visitor sees no edit tools there), which has «Tilbake til prospekt». A signed-in person is taken to
   the project view, unless the link says &se=1 (the «Prospekt» button does). */
import { prospektHtml, figures, GONE } from "./prospekt-view.js";
const $ = id => document.getElementById(id), q = new URLSearchParams(location.search);
const id = q.get("v") || (/^\/prospekt\/([^/]+)/.exec(location.pathname) || [])[1] || "", nokkel = q.get("nokkel");
let data = null, figs = [], at = 0;
const editor = (extra = "") => `./?versjon=${encodeURIComponent(id)}${nokkel ? `&nokkel=${encodeURIComponent(nokkel)}` : ""}&fra=prospekt${extra}`;

function lightbox() {
  const lb = $("lb"), show = i => { at = (i + figs.length) % figs.length; const f = figs[at]; $("lbImg").src = f.url; $("lbImg").alt = f.caption; $("lbCap").textContent = f.caption; $("lbD").href = f.url; lb.hidden = false; $("lbN").hidden = $("lbP").hidden = figs.length < 2; };
  document.addEventListener("click", e => { const b = e.target.closest("[data-lb]"); if (b) show(+b.dataset.lb); });
  $("lbX").onclick = () => { lb.hidden = true; $("lbImg").removeAttribute("src"); };
  $("lbN").onclick = () => show(at + 1); $("lbP").onclick = () => show(at - 1);
  lb.addEventListener("click", e => { if (e.target === lb) $("lbX").click(); });
  addEventListener("keydown", e => { if (lb.hidden) return; if (e.key === "Escape") $("lbX").click(); else if (e.key === "ArrowRight") show(at + 1); else if (e.key === "ArrowLeft") show(at - 1); });
}

(async () => {
  const main = $("pk");
  if (!id) { main.innerHTML = GONE; return; }
  let me = null;
  const [r, meR] = await Promise.all([fetch(`api/prospekt/${encodeURIComponent(id)}${nokkel ? `?nokkel=${encodeURIComponent(nokkel)}` : ""}`).catch(() => null), fetch("api/meg").then(x => x.json()).catch(() => null)]);
  me = meR?.person ?? null;
  if (me && !q.has("se")) { location.replace(editor()); return; }   // signed in: the normal project view; «Prospekt» there keeps this page open (&se=1)
  if (!r) { main.innerHTML = `<p class="pk-gone">Fikk ikke kontakt med tjeneren. Prøv igjen om litt.</p>`; return; }
  if (!r.ok) { main.innerHTML = GONE; return; }
  data = await r.json(); figs = figures(data); document.title = `${data.title} · Prospekt · Sykehustomta`;
  main.innerHTML = prospektHtml(data, { links: { explore: editor() } });
  lightbox();
})();
