/* «Om stedet» (U3823): what the ground and the registers say about the plot, in the Prosjekter tab: hazards (flood, quick clay, slides, radon),
   heritage within 50 m and invasive plants near, each row with its source. Read from /api/om-stedet the first time it is opened. */
import { esc } from "./kit/html.js";
export function startOmStedet(details) {
  const body = details.querySelector("#omStedetBody"); let done = false;
  const draw = r => `${r.place ? `<p class="om-place">${esc(r.place)}</p>` : ""}${r.sections.map(s => `<h4>${esc(s.title)}</h4>${s.rows.length
    ? `<ul>${s.rows.map(x => `<li>${esc(x.line)}<br><small>${esc(x.how)}</small></li>`).join("")}</ul>` : `<p><small>${esc(s.empty)}</small></p>`}`).join("")}
    ${r.zoning ? `<h4>Reguleringsplan</h4><p><small>${esc(r.zoning)}</small></p>` : ""}<p><small>Kart og registre for tidlig vurdering, ikke en avgjørelse.${r.fetched ? ` Hentet ${esc(new Date(r.fetched).toLocaleDateString("nb-NO"))}.` : ""}</small></p>`;
  details.addEventListener("toggle", async () => {
    if (!details.open || done) return; body.textContent = "Henter …";
    try { const r = await fetch("api/om-stedet"); if (!r.ok) throw 0; body.innerHTML = draw(await r.json()); done = true; }
    catch { body.textContent = "Fikk ikke hentet opplysningene om tomta nå. Prøv igjen om litt."; }
  });
}
