/* «Gjengi» (U3526): the view as it is now, made a realistic picture by an image model (the server's gjengi.mjs). The
   price of one picture is said before it is made, with what the month has used of the household's cap; the pictures
   of the open version or draft are listed under, favourites first, each with a star and «Last ned» (full size). */
import { VIEWPOINTS, LOOKS, SIZES, DEFAULT_SIZE, viewpointFor, lookFor, shotOf } from "./gjengicam.js";
const usd = v => `$${Number(v || 0).toFixed(2).replace(".", ",")}`;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const MONTH = ["januar", "februar", "mars", "april", "mai", "juni", "juli", "august", "september", "oktober", "november", "desember"];

export function startGjengi({ btn, pop, viewer, work, toast, sun = () => null }) {
  const say = pop.querySelector("#gjSay"), go = pop.querySelector("#gjGo"), wish = pop.querySelector("#gjWish"), list = pop.querySelector("#gjList");
  let st = null, busy = false;
  /* the camera of the picture (gjengicam.js): the person's choice, or null for what the view has by itself; lens and eye height
     only from Anton (show_building camera, lens_mm, eye_height_m) */
  const pick = { viewpoint: null, look: null, size: null, lens: null, eyeh: null }, cam = pop.querySelector("#gjCam");
  const vpNow = () => pick.viewpoint || viewpointFor({ ...viewer.view(), dist: viewer.pose().dist }), lookNow = () => pick.look || lookFor(vpNow()), sizeNow = () => pick.size || st?.default_size || DEFAULT_SIZE;
  const priceOf = id => (st?.sizes || []).find(z => z.id === id)?.estimate_usd ?? st?.estimate_usd ?? 0;
  function drawCam() {
    const vp = vpNow(), lk = lookNow(), sz = sizeNow(), btns = (list, on, key) => Object.entries(list).map(([id, o]) => `<button type="button" data-${key}="${esc(id)}" aria-pressed="${id === on}" title="${esc(o.tip || "")}">${esc(o.no)}</button>`).join("");
    cam.innerHTML = `<b>Synsvinkel</b><div class="gj-row">${btns(VIEWPOINTS, vp, "vp")}</div><b>Kamera og stil</b><div class="gj-row">${btns(LOOKS, lk, "lk")}</div>
      <b>Størrelse og pris</b><div class="gj-row">${Object.entries(SIZES).map(([id, o]) => `<button type="button" data-sz="${id}" aria-pressed="${id === sz}" title="${esc(o.no)}: bildet lages i ${id}. Prisen er omtrent ${usd(priceOf(id))}">${esc(o.no)} ${usd(priceOf(id))}</button>`).join("")}</div>
      <small>${pick.viewpoint || pick.look ? "Du har valgt selv." : "Valgt av seg selv etter det du ser."}</small>`;
    for (const b of cam.querySelectorAll("[data-vp]")) b.onclick = () => { pick.viewpoint = b.dataset.vp === viewpointFor({ ...viewer.view(), dist: viewer.pose().dist }) ? null : b.dataset.vp; pick.look = null; draw(); };
    for (const b of cam.querySelectorAll("[data-lk]")) b.onclick = () => { pick.look = b.dataset.lk === lookFor(vpNow()) ? null : b.dataset.lk; draw(); };
    for (const b of cam.querySelectorAll("[data-sz]")) b.onclick = () => { pick.size = b.dataset.sz; draw(); };
  }
  const q = () => { const w = work(); return w.versjon ? `versjon=${encodeURIComponent(w.versjon)}${w.nokkel ? `&nokkel=${encodeURIComponent(w.nokkel)}` : ""}` : w.utkast ? `utkast=${encodeURIComponent(w.utkast)}` : ""; };
  function draw() {
    if (!st) return;
    const w = work(), m = MONTH[new Date().getUTCMonth()];
    const est = priceOf(sizeNow()), room = st.left_usd >= est; drawCam();
    say.textContent = !st.on ? "Gjengi er ikke slått på her ennå."
      : !st.signed_in ? `Logg inn for å gjengi: hvert bilde koster penger (omtrent ${usd(est)}).`
      : !w.versjon && !w.utkast ? "Gjør en endring eller åpne et forslag først: bildene lagres i forslaget."
      : `Et bilde av det du ser nå koster omtrent ${usd(est)}. Brukt i ${m}: ${usd(st.month_usd)} av ${usd(st.cap_usd)}.${room ? "" : " Grensen er nådd denne måneden."}`;
    go.disabled = busy || !st.on || !st.signed_in || (!w.versjon && !w.utkast) || !room;
    go.textContent = busy ? "Lager bildet …" : `Lag bilde (omtrent ${usd(est)})`;
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
    const w = work(), shot = shotOf({ viewpoint: vpNow(), look: lookNow(), lens: pick.lens, eyeh: pick.eyeh }, {}), image = viewer.snapshot(shot);
    let j;
    try { j = await fetch("api/gjengi", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ image, wish: wish.value.trim() || undefined, shown_usd: priceOf(sizeNow()), size: sizeNow(), viewpoint: shot.viewpoint, look: shot.look, lens: pick.lens ?? undefined, eyeh: pick.eyeh ?? undefined, ...(sun() || {}), ...(w.versjon ? { versjon: w.versjon, nokkel: w.nokkel || undefined } : { utkast: w.utkast }) }) }).then(r => r.json()); }
    catch { j = { error: "Fikk ikke kontakt." }; }
    busy = false;
    if (j.error) { await load(); say.textContent = j.error; return; }
    wish.value = ""; Object.assign(st, j); await load();
    toast(`Bildet er laget (${usd(j.picture.cost_usd)}). Trykk på stjernen for å beholde det som favoritt.`);
  };
  addEventListener("keydown", e => { if (e.key === "Escape" && !pop.hidden) open(false); });
  document.addEventListener("pointerdown", e => { if (!pop.hidden && !e.target.closest(".gj")) open(false); });
  /* a view that says the camera (Anton's show_building: camera, look, lens, eye height, size): the card's choice follows it */
  function setChoice(v) {
    if (!v) return; let on = false;
    if (VIEWPOINTS[v.camera]) { pick.viewpoint = v.camera; on = true; } if (LOOKS[v.look]) { pick.look = v.look; on = true; }
    if (Number.isFinite(v.lens)) { pick.lens = v.lens; on = true; } if (Number.isFinite(v.eyeh)) { pick.eyeh = v.eyeh; on = true; } if (SIZES[v.gsize]) { pick.size = v.gsize; on = true; }
    if (on && st) draw();
  }
  return { load, setChoice };
}
