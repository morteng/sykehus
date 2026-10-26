/* «Gjengi» as a photo mode (U3526, U3663, U3665): its tab in the right panel after Anton. Opening it turns the 3D view into the
   viewfinder: the lens sets the view's own field of view, the frame has the picture's shape, rule-of-thirds lines and the
   horizon over it (renderkit photoframe.js), and a small plan shows the camera with the frustum's rays; what is framed is
   exactly what is sent. One big shutter says its price. The price is said before the picture is made, with what the month
   has used of the household's cap; the pictures of the open version or draft are listed under, and the places they were
   taken from (photospots.js) can be flown to for free and taken again for a press. */
import { VIEWPOINTS, LOOKS, SIZES, DEFAULT_SIZE, lookFor, viewpointFor } from "./renderkit/photo.js";
import { LENSES, ASPECTS, frameRect, frameFov, viewFov, hFov, poseFromCam, frameSvg, frustumSvg } from "./renderkit/photoframe.js";
import { LOOK_NO, SIZE_NO, LENS_NO, ASPECT_NO } from "./gjengi-no.js";
import { spotOfView, flyTo, isStale, retakeBody, retake, total } from "./photospots.js";
const usd = v => `$${Number(v || 0).toFixed(2).replace(".", ",")}`;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const MONTH = ["januar", "februar", "mars", "april", "mai", "juni", "juli", "august", "september", "oktober", "november", "desember"];
const $ = id => document.getElementById(id);

export function startGjengi({ panel, viewer, work, toast, sun = () => null, setSun = () => {}, setMode = () => {}, rings = () => [], changes = () => null, sunLabel = () => "" }) {
  const say = $("gjSay"), go = $("gjGo"), wish = $("gjWish"), list = $("gjList"), cam = $("gjCam"), pf = $("pf"), view = $("view"), result = $("pfResult"), inset = $("pfInset"), shotBtn = $("pfShot");
  let st = null, busy = false, on = false, prevTab = "changes", prevMode = "3d", tick = null, sig = "", selSpot = null;
  /* the person's choice over what the view has by itself; null is «valgt av seg selv» */
  const pick = { lens: null, mm: null, aspect: null, look: null, size: null, viewpoint: null };
  const pose = () => viewer.pose();
  const vpNow = () => pick.viewpoint || (pose().eye || pose().pitch < 0.35 ? "øyehøyde" : "fugleperspektiv");
  const lookNow = () => pick.look || lookFor(vpNow());
  const mmNow = () => pick.mm ?? LOOKS[lookNow()].mm ?? VIEWPOINTS[vpNow()].mm ?? 35;
  const lensNow = () => pick.lens || Object.keys(LENSES).find(k => LENSES[k].mm === mmNow() && !LENSES[k].aerial) || null;
  const aspectNow = () => pick.aspect || LOOKS[lookNow()].aspect || VIEWPOINTS[vpNow()].aspect;
  const sizeNow = () => pick.size || st?.default_size || DEFAULT_SIZE;
  const priceOf = id => (st?.sizes || []).find(z => z.id === id)?.estimate_usd ?? st?.estimate_usd ?? 0;
  const q = () => { const w = work(); return w.versjon ? `versjon=${encodeURIComponent(w.versjon)}${w.nokkel ? `&nokkel=${encodeURIComponent(w.nokkel)}` : ""}` : w.utkast ? `utkast=${encodeURIComponent(w.utkast)}` : ""; };
  const chips = (items, now, key, label) => items.map(([id, t, tip]) => `<button type="button" data-${key}="${esc(id)}" aria-pressed="${id === now}" title="${esc(tip || "")}"${label ? ` aria-label="${esc(label)} ${esc(t)}"` : ""}>${esc(t)}</button>`).join("");

  /* ---- the viewfinder: the lens' field of view, the frame, the inset ---- */
  function layout() {
    const W = view.clientWidth || 600, H = view.clientHeight || 400, a = aspectNow(), ff = frameFov(mmNow(), a), r = frameRect(W, H, a, W < 600 ? 0.05 : 0.08);
    viewer.lens(viewFov(ff, r, H));
    $("pfFrame").innerHTML = frameSvg(W, H, r, { pitch: pose().eye ? 0 : pose().pitch, frameFovDeg: ff });
    $("pfTag").textContent = `${LENS_NO[lensNow()]?.no || `${mmNow()} mm`} · ${a}${pose().eye ? " · øyehøyde 1,7 m" : ""}`;
    $("pfTag").style.cssText = `left:${r.x + 8}px;top:${Math.max(4, r.y - 22)}px`;
    drawInset(); drawBar();
  }
  let dragM = null;
  function drawInset() { const p = pose(), a = aspectNow(); inset.innerHTML = frustumSvg(p, hFov(frameFov(mmNow(), a), a), { size: inset.clientWidth || 150, m: dragM, rings: rings() }); }
  inset.addEventListener("pointerdown", e => {
    const p = pose(), size = inset.clientWidth || 150, a = aspectNow(); dragM = Math.max(60, p.dist * 0.7 * 3); inset.setPointerCapture(e.pointerId);
    const at = ev => { const b = inset.getBoundingClientRect(), k = size / dragM; return [p.x + (ev.clientX - b.left - size / 2) / k, p.y - (ev.clientY - b.top - size / 2) / k]; };
    const move = ev => { const [x, y] = at(ev), n = poseFromCam(pose(), x, y); viewer.pose({ yaw: n.yaw, dist: Math.max(15, Math.min(1500, n.dist)) }); layout(); };
    const up = () => { dragM = null; inset.removeEventListener("pointermove", move); inset.removeEventListener("pointerup", up); layout(); };
    inset.addEventListener("pointermove", move); inset.addEventListener("pointerup", up); void a; e.preventDefault();
  });
  function drawBar() {
    $("pfLens").innerHTML = chips(Object.entries(LENSES).map(([id]) => [id, LENS_NO[id].no, LENS_NO[id].tip]), lensNow(), "ln", "Linse");
    $("pfAspect").innerHTML = chips(ASPECTS.map(id => [id, id, ASPECT_NO[id]]), aspectNow(), "as", "Bildeform");
    for (const b of $("pfLens").querySelectorAll("[data-ln]")) b.onclick = () => { const same = b.dataset.ln === pick.lens; pick.lens = same ? null : b.dataset.ln; pick.mm = same ? null : LENSES[b.dataset.ln].mm; layout(); };
    for (const b of $("pfAspect").querySelectorAll("[data-as]")) b.onclick = () => { pick.aspect = b.dataset.as === pick.aspect ? null : b.dataset.as; layout(); };
  }
  function drawCam() {
    const lk = lookNow(), sz = sizeNow(), p = pose();
    cam.innerHTML = `<b>Stil</b><div class="gj-row">${chips(Object.entries(LOOK_NO).map(([id, o]) => [id, o.no, o.tip]), lk, "lk")}</div>
      <b>Sola</b><div class="gj-row"><button type="button" id="gjSun" title="Velg dato og klokkeslett for lyset">${esc(sunLabel() || "Sola")}</button></div>
      <b>Størrelse og pris</b><div class="gj-row">${Object.keys(SIZES).map(id => `<button type="button" data-sz="${id}" aria-pressed="${id === sz}" title="${esc(SIZE_NO[id])}: bildet lages i ${id}. Prisen er omtrent ${usd(priceOf(id))}">${esc(SIZE_NO[id])} ${usd(priceOf(id))}</button>`).join("")}</div>
      <small>${pick.lens || pick.aspect || pick.look ? "Du har valgt selv." : "Valgt av seg selv etter det du ser."}${p.eye ? " Øyehøyde 1,7 m over bakken." : ""}</small>`;
    for (const b of cam.querySelectorAll("[data-lk]")) b.onclick = () => { pick.look = b.dataset.lk === lookFor(vpNow()) ? null : b.dataset.lk; draw(); layout(); };
    for (const b of cam.querySelectorAll("[data-sz]")) b.onclick = () => { pick.size = b.dataset.sz; draw(); };
    $("gjSun").onclick = () => $("sunBtn").click();
  }

  /* ---- the card: price, the shutter, the pictures, the places ---- */
  const can = () => { const w = work(); return !busy && st?.on && st.signed_in && (w.versjon || w.utkast) && st.left_usd >= priceOf(sizeNow()); };
  function draw() {
    if (!st) return;
    const w = work(), m = MONTH[new Date().getUTCMonth()], est = priceOf(sizeNow()), room = st.left_usd >= est; drawCam();
    say.textContent = !st.on ? "Gjengi er ikke slått på her ennå."
      : !st.signed_in ? `Logg inn for å gjengi: hvert bilde koster penger (omtrent ${usd(est)}).`
      : !w.versjon && !w.utkast ? "Gjør en endring eller åpne et forslag først: bildene lagres i forslaget."
      : `Rammen er bildet: det du ser i den blir sendt. Brukt i ${m}: ${usd(st.month_usd)} av ${usd(st.cap_usd)}.${room ? "" : " Grensen er nådd denne måneden."}`;
    const label = busy ? "Lager bildet …" : `Ta bildet · ca. ${usd(est)}`;
    for (const b of [go, shotBtn]) { b.disabled = !can(); b.setAttribute("aria-label", label); }
    go.textContent = label; $("pfPrice").textContent = busy ? "Lager …" : `ca. ${usd(est)}`; shotBtn.title = label;
    list.innerHTML = (st.pictures || []).map(p => `<li><a href="${esc(p.url)}" target="_blank" rel="noopener" title="Åpne i full størrelse"><img src="${esc(p.url)}" alt="Gjengitt bilde ${esc(new Date(p.at).toLocaleString("nb-NO"))}" loading="lazy"></a>
      <span class="gj-r"><button type="button" class="gj-fav" data-fav="${esc(p.id)}" aria-pressed="${p.fav}" title="${p.fav ? "Ta bort som favoritt" : "Behold som favoritt"}" aria-label="${p.fav ? "Ta bort som favoritt" : "Behold som favoritt"}">${p.fav ? "★" : "☆"}</button>
      <a href="${esc(p.download)}" download>Last ned</a><small>${esc(new Date(p.at).toLocaleDateString("nb-NO"))} · ${usd(p.cost_usd)}${p.wish ? ` · ${esc(p.wish)}` : ""}</small></span></li>`).join("");
    for (const b of list.querySelectorAll("[data-fav]")) b.onclick = () => fav(b.dataset.fav, b.getAttribute("aria-pressed") !== "true");
    drawSpots(); drawRetake();
  }
  const spots = () => (st?.pictures || []).filter(p => p.mine && p.spot && !p.retake_of);
  const latestRetake = id => (st?.pictures || []).filter(p => p.retake_of === id).sort((a, b) => b.at.localeCompare(a.at))[0] || null;
  function drawSpots() {
    const box = $("gjSpots"), all = spots(); box.hidden = !all.length; $("gjSpotsH").hidden = !all.length; box.innerHTML = all.map(p => {
      const stale = isStale(p, changes()), t = `${LOOK_NO[p.spot.look]?.no || "Bilde"}, ${p.spot.mm} mm, ${p.spot.aspect || ""}, ${new Date(p.at).toLocaleDateString("nb-NO")}${stale ? ". Modellen er endret siden" : ""}`;
      return `<button type="button" class="pf-spot" data-spot="${esc(p.id)}" aria-pressed="${p.id === selSpot}" title="${esc(t)}. Trykk for å gå dit"><img src="${esc(p.url)}" alt="${esc(t)}" loading="lazy">${stale ? '<i class="pf-new" aria-label="Modellen er endret siden"></i>' : ""}</button>`; }).join("");
    for (const b of box.querySelectorAll("[data-spot]")) b.onclick = () => selectSpot(b.dataset.spot);
    const p = all.find(x => x.id === selSpot), d = $("gjSpot"); d.hidden = !p; if (!p) return;
    const stale = isStale(p, changes()), re = latestRetake(p.id), est = priceOf(sizeNow());
    d.innerHTML = `<p class="pf-spot-t">${esc(LOOK_NO[p.spot.look]?.no || "Bilde")} · ${p.spot.mm} mm · ${esc(p.spot.aspect || "")}${p.spot.sun ? ` · ${esc(sunLabel(p.spot.sun))}` : ""}</p>${stale ? '<p class="pf-stale">Modellen er endret siden dette bildet.</p>' : ""}
      <div class="gj-row"><button type="button" id="gjAgain" ${can() ? "" : "disabled"}>Ta på nytt · ca. ${usd(est)}</button>${re ? '<button type="button" id="gjCmp">Før og etter</button>' : ""}</div>`;
    $("gjAgain").onclick = () => retakeOne(p.id, true);   // the press
    if (re) $("gjCmp").onclick = () => showResult({ before: p.url, after: re.url, pic: re, beforeText: "Før", afterText: "Nå" });
  }
  /* to a place: the camera flies there, the card takes its lens, shape, look and light (free) */
  function selectSpot(id) {
    const p = spots().find(x => x.id === id); if (!p) return; selSpot = id;
    const c = flyTo(p.spot, { fly: pz => viewer.look(pz, 900), setSun });
    Object.assign(pick, { lens: c.lens, mm: c.mm, aspect: c.aspect, look: c.look, viewpoint: c.viewpoint }); draw(); layout();
  }
  /* Anton's proposal and the person's press: the card says the count and the total price; the pictures are made only when «Lag bildene» is pressed */
  function drawRetake() {
    const box = $("gjRetake"), ids = (st?.retake?.ids || []).filter(id => spots().some(p => p.id === id)); box.hidden = !ids.length; if (!ids.length) { box.innerHTML = ""; return; }
    const sum = total(ids.length, priceOf(sizeNow())), room = st.left_usd >= sum;
    box.innerHTML = `<p><b>${ids.length} ${ids.length === 1 ? "bilde" : "bilder"} · ca. ${usd(sum)}</b><br><small>Nye bilder fra ${ids.length === 1 ? "stedet" : "stedene"} Anton foreslår, med dagens modell.${room ? "" : " Grensen for måneden rekker ikke."}</small></p>
      <div class="gj-row"><button type="button" id="gjRetakeGo" ${room && can() ? "" : "disabled"}>Lag ${ids.length === 1 ? "bildet" : "bildene"}</button><button type="button" id="gjRetakeNo">Ikke nå</button></div>`;
    $("gjRetakeGo").onclick = () => retakeMany(ids, true);   // the press that confirms the price on the card $("gjRetakeNo").onclick = async () => { await fetch("api/gjengi/proposal", { method: "POST" }).catch(() => null); st.retake = null; draw(); };
  }

  async function load() {
    st = await fetch(`api/gjengi?${q()}`).then(r => r.json()).catch(() => null);
    if (!st) say.textContent = "Fikk ikke kontakt."; draw();
  }
  async function fav(id, onFav) {
    const j = await fetch(`api/gjengi/${id}/favoritt`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ on: onFav }) }).then(r => r.json()).catch(() => ({ error: "Fikk ikke kontakt." }));
    if (j.error) return toast(j.error);
    await load();
  }

  /* ---- the picture: the shot is the view's own camera through the frame; the answer shows over the view ---- */
  const spotNow = () => spotOfView({ pose: pose(), mm: mmNow(), fov: frameFov(mmNow(), aspectNow()), aspect: aspectNow(), look: lookNow(), viewpoint: vpNow(), lens: lensNow(), sun: sun(), version: work().versjon || work().utkast || null, n: changes() });
  async function post(extra) {
    const w = work(), spot = extra?.spot || spotNow(), image = viewer.snapshot({ live: true, mm: spot.mm, aspect: spot.aspect, viewpoint: spot.viewpoint });
    const body = { image, wish: wish.value.trim() || undefined, shown_usd: priceOf(sizeNow()), size: sizeNow(), viewpoint: spot.viewpoint, look: spot.look, lens: spot.mm, eyeh: spot.eyeh ?? undefined, aspect: spot.aspect, spot, ...(sun() || {}), ...(extra || {}), ...(w.versjon ? { versjon: w.versjon, nokkel: w.nokkel || undefined } : { utkast: w.utkast }) };
    let j; try { j = await fetch("api/gjengi", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(r => r.json()); } catch { j = { error: "Fikk ikke kontakt." }; }
    return { j, image };
  }
  async function shoot() {
    if (busy || !st || !can()) return; busy = true; draw(); say.textContent = "Bildemodellen lager bildet. Det tar ofte 10–40 sekunder.";
    const { j, image } = await post(); busy = false;
    if (j.error) { await load(); say.textContent = j.error; return; }
    wish.value = ""; Object.assign(st, j); await load();
    showResult({ before: image, after: j.picture.url, pic: j.picture, beforeText: "Modellen", afterText: "Bildet" });
  }
  /* a new picture from a place: the camera and the light go there at once, then the same shot as then; only called from a press */
  async function retakeOne(id, confirmed = false) { return retakeMany([id], confirmed); }
  async function retakeMany(ids, confirmed = false) {
    if (busy || !st) return; busy = true; draw(); let last = null;
    try {
      await retake(ids.map(id => spots().find(p => p.id === id)).filter(Boolean), { confirmed, make: async p => {
        say.textContent = `Lager bildet fra ${LOOK_NO[p.spot.look]?.no || "stedet"} … Det tar ofte 10–40 sekunder.`;
        const c = flyTo(p.spot, { fly: pz => viewer.pose(pz), setSun }); Object.assign(pick, { lens: c.lens, mm: c.mm, aspect: c.aspect, look: c.look, viewpoint: c.viewpoint }); layout();
        const { j, image } = await post(retakeBody(p, {})); if (j.error) throw Object.assign(new Error(j.error), { shown: true });
        Object.assign(st, j); last = { before: p.url, after: j.picture.url, pic: j.picture, beforeText: "Før", afterText: "Nå", image }; return j;
      } });
      await fetch("api/gjengi/proposal", { method: "POST" }).catch(() => null);
    } catch (e) { say.textContent = e.message; } finally { busy = false; await load(); }
    if (last) showResult(last);
  }
  function showResult({ before, after, pic, beforeText, afterText }) {
    result.hidden = false;
    result.innerHTML = `<div class="pf-res"><div class="pf-cmp" style="aspect-ratio:${aspectNow().replace(":", " / ")}"><img class="pf-after" src="${esc(after)}" alt="${esc(afterText)}">${before ? `<img class="pf-before" src="${esc(before)}" alt="${esc(beforeText)}" style="clip-path:inset(0 50% 0 0)"><input type="range" min="0" max="100" value="50" aria-label="Dra for å sammenligne ${esc(beforeText.toLowerCase())} og ${esc(afterText.toLowerCase())}"><span class="pf-l">${esc(beforeText)}</span><span class="pf-r">${esc(afterText)}</span>` : ""}</div>
      <div class="gj-row"><button type="button" id="pfAgain">Ta et nytt</button><button type="button" id="pfSave" aria-pressed="${!!pic?.fav}">${pic?.fav ? "Lagret ★" : "Lagre"}</button><a class="pf-dl" href="${esc(pic?.download || after)}" download>Last ned</a></div></div>`;
    const range = result.querySelector("input[type=range]"), bef = result.querySelector(".pf-before");
    if (range) range.oninput = () => { bef.style.clipPath = `inset(0 ${100 - +range.value}% 0 0)`; };
    $("pfAgain").onclick = () => { result.hidden = true; result.innerHTML = ""; };
    $("pfSave").onclick = async () => { if (!pic) return; await fav(pic.id, true); $("pfSave").textContent = "Lagret ★"; $("pfSave").setAttribute("aria-pressed", "true"); toast("Bildet er beholdt som favoritt."); };
  }

  /* ---- photo mode in and out: what is not needed is hidden by the body's class, the view's own lens is given back ---- */
  function enter() {
    if (on) return; on = true; prevMode = viewer.view().mode; if (prevMode !== "3d") setMode("3d");
    document.body.classList.add("photo"); pf.hidden = false; panel.snap?.("peek"); layout(); load();
    tick = setInterval(() => { const s = JSON.stringify([pose(), view.clientWidth, view.clientHeight, sun()]); if (s !== sig && dragM == null) { sig = s; layout(); drawCam(); } }, 250);
  }
  function leave() {
    if (!on) return; on = false; clearInterval(tick); document.body.classList.remove("photo"); pf.hidden = true; result.hidden = true; result.innerHTML = ""; viewer.lens(null);
    if (prevMode !== "3d") setMode(prevMode);
  }
  addEventListener("sykehus:panel", e => { if (e.detail === "photo") enter(); else { prevTab = e.detail; leave(); } });
  $("pfExit").onclick = () => panel.show(prevTab);
  addEventListener("keydown", e => { if (e.key !== "Escape" || !on) return; if (!result.hidden) { result.hidden = true; result.innerHTML = ""; } else panel.show(prevTab); });
  go.onclick = shotBtn.onclick = shoot;
  new ResizeObserver(() => { if (on) layout(); }).observe(view);
  /* a view that says the camera (Anton's show_building: camera, look, lens, eye height, size) or a proposal to retake places */
  function setChoice(v) {
    if (!v) return; let any = false;
    if (VIEWPOINTS[v.camera]?.mm) { pick.viewpoint = v.camera; any = true; } if (LOOKS[v.look]) { pick.look = v.look; any = true; }
    if (Number.isFinite(v.lens)) { pick.mm = v.lens; pick.lens = null; any = true; } if (SIZES[v.gsize]) { pick.size = v.gsize; any = true; }
    if (any && st) { draw(); if (on) layout(); }
  }
  /* Anton proposed new pictures from some places: the Gjengi tab shows the card with the price; nothing is made until the press */
  function proposal() { panel.reveal("photo"); setTimeout(load, 0); }
  return { load, setChoice, proposal, enter, leave, get on() { return on; }, pick, spotNow, selectSpot, retakeMany };
}
