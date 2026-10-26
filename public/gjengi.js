/* «Gjengi» (U3526): the view as it is now, made a realistic picture by an image model (the server's gjengi.mjs). The
   price of one picture is said before it is made, with what the month has used of the household's cap; the pictures
   of the open version or draft are listed under, favourites first, each with a star and «Last ned» (full size). */
const usd = v => `$${Number(v || 0).toFixed(2).replace(".", ",")}`;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const MONTH = ["januar", "februar", "mars", "april", "mai", "juni", "juli", "august", "september", "oktober", "november", "desember"];

export function startGjengi({ btn, pop, viewer, work, toast }) {
  const say = pop.querySelector("#gjSay"), go = pop.querySelector("#gjGo"), wish = pop.querySelector("#gjWish"), list = pop.querySelector("#gjList");
  let st = null, busy = false;
  const q = () => { const w = work(); return w.versjon ? `versjon=${encodeURIComponent(w.versjon)}${w.nokkel ? `&nokkel=${encodeURIComponent(w.nokkel)}` : ""}` : w.utkast ? `utkast=${encodeURIComponent(w.utkast)}` : ""; };
  function draw() {
    if (!st) return;
    const w = work(), m = MONTH[new Date().getUTCMonth()];
    const room = st.left_usd >= st.estimate_usd;
    say.textContent = !st.on ? "Gjengi er ikke slått på her ennå."
      : !st.signed_in ? `Logg inn for å gjengi: hvert bilde koster penger (omtrent ${usd(st.estimate_usd)}).`
      : !w.versjon && !w.utkast ? "Gjør en endring eller åpne et forslag først: bildene lagres i forslaget."
      : `Et bilde av det du ser nå koster omtrent ${usd(st.estimate_usd)}. Brukt i ${m}: ${usd(st.month_usd)} av ${usd(st.cap_usd)}.${room ? "" : " Grensen er nådd denne måneden."}`;
    go.disabled = busy || !st.on || !st.signed_in || (!w.versjon && !w.utkast) || !room;
    go.textContent = busy ? "Lager bildet …" : `Lag bilde (omtrent ${usd(st.estimate_usd)})`;
    list.innerHTML = (st.pictures || []).map(p => `<li><a href="${esc(p.url)}" target="_blank" rel="noopener" title="Åpne i full størrelse"><img src="${esc(p.url)}" alt="Gjengitt bilde ${esc(new Date(p.at).toLocaleString("nb-NO"))}" loading="lazy"></a>
      <span class="gj-r"><button type="button" class="gj-fav" data-fav="${esc(p.id)}" aria-pressed="${p.fav}" title="${p.fav ? "Ta bort som favoritt" : "Behold som favoritt"}" aria-label="${p.fav ? "Ta bort som favoritt" : "Behold som favoritt"}">${p.fav ? "★" : "☆"}</button>
      <a href="${esc(p.download)}" download>Last ned</a><small>${esc(new Date(p.at).toLocaleDateString("nb-NO"))} · ${usd(p.cost_usd)}${p.wish ? ` · ${esc(p.wish)}` : ""}</small></span></li>`).join("");
    for (const b of list.querySelectorAll("[data-fav]")) b.onclick = () => fav(b.dataset.fav, b.getAttribute("aria-pressed") !== "true");
  }
  async function load() {
    st = await fetch(`api/gjengi?${q()}`).then(r => r.json()).catch(() => null);
    if (!st) say.textContent = "Fikk ikke kontakt."; draw();
  }
  async function fav(id, on) {
    const j = await fetch(`api/gjengi/${id}/favoritt`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ on }) }).then(r => r.json()).catch(() => ({ error: "Fikk ikke kontakt." }));
    if (j.error) return toast(j.error);
    await load();
  }
  function open(on) { pop.hidden = !on; btn.setAttribute("aria-expanded", String(on)); btn.setAttribute("aria-pressed", String(on)); if (on) load(); }
  btn.onclick = () => open(pop.hidden);
  pop.onsubmit = async e => {
    e.preventDefault(); if (busy || !st) return;
    busy = true; draw(); say.textContent = "Bildemodellen lager bildet. Det tar ofte 10–40 sekunder.";
    const w = work(), image = viewer.snapshot();
    let j;
    try { j = await fetch("api/gjengi", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ image, wish: wish.value.trim() || undefined, shown_usd: st.estimate_usd, ...(w.versjon ? { versjon: w.versjon, nokkel: w.nokkel || undefined } : { utkast: w.utkast }) }) }).then(r => r.json()); }
    catch { j = { error: "Fikk ikke kontakt." }; }
    busy = false;
    if (j.error) { await load(); say.textContent = j.error; return; }
    wish.value = ""; Object.assign(st, j); await load();
    toast(`Bildet er laget (${usd(j.picture.cost_usd)}). Trykk på stjernen for å beholde det som favoritt.`);
  };
  addEventListener("keydown", e => { if (e.key === "Escape" && !pop.hidden) open(false); });
  document.addEventListener("pointerdown", e => { if (!pop.hidden && !e.target.closest(".gj")) open(false); });
  return { load };
}
