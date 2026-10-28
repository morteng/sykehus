/* «Fasade» on the page: one screen. The side buttons on top, the drawing in the middle (a finger moves and zooms it, the pen draws),
   the tools at the bottom (Mål | Tegn | Angre | Nullstill) and one big button, «Send til Anton». The drawing and the numbers are
   fasade.js's; the pen is tegn.js's (a finger does not draw, so the palm can rest; a mouse does, for the desk).

   open({ host, site0, floors0, baseEdits, wingOf, commit, send, focus, side })
     site0, floors0   the data before any change (the page's own copies)
     baseEdits()      the edits the open draft or version has now
     commit(edits)    lays edits into the draft the way the page's own changes go (api/endring); resolves true when taken
     send(text, drawing)  to Anton (anton.js sendIt); resolves true, or { error } */
import { facadeDrawing, sidesOf, editsFor, readRef, tryEdits, sayChange, strokeWords, strokeToSite, toSvg, fm } from "./fasade.js";

const COLOURS = [["Rød", "#c8102e"], ["Blå", "#1f5fbf"], ["Svart", "#23211e"]];
const $ = (el, s) => el.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const keyOf = r => JSON.stringify(r);

export function open({ host = document.body, site0, floors0, baseEdits, wingOf, commit, send, focus = "sentralblokka", side = "Sørsiden" }) {
  document.body.classList.add("tegner");
  const box = document.createElement("div"); box.id = "fasade"; box.setAttribute("role", "dialog"); box.setAttribute("aria-label", "Fasade");
  box.innerHTML = `<header class="fx-top"><button type="button" class="fx-x" aria-label="Lukk">Lukk</button>
      <select class="fx-bygg" aria-label="Bygg"></select><nav class="fx-sides" aria-label="Side"></nav></header>
    <div class="fx-stage"><div class="fx-pan"><div class="fx-svg"></div></div><canvas class="fx-ink" aria-label="Tegneflaten"></canvas></div>
    <p class="fx-hint" role="status">Trykk på et tall med ramme for å endre det.</p>
    <div class="fx-num card" hidden><b class="fx-lbl"></b><div class="fx-row"><button type="button" class="fx-m" aria-label="Mindre">−</button><input class="fx-in" inputmode="decimal" aria-label="Tall i meter"><span>m</span><button type="button" class="fx-p" aria-label="Mer">+</button><button type="button" class="fx-ok">Ferdig</button></div><p class="fx-err" role="alert" hidden></p></div>
    <footer class="fx-bar"><div class="fx-tools"><button type="button" class="fx-mode" data-mode="mal" aria-pressed="true">Mål</button><button type="button" class="fx-mode" data-mode="tegn" aria-pressed="false">Tegn</button>
        <span class="fx-pens" hidden>${COLOURS.map(([n, c], i) => `<button type="button" class="dot" data-c="${c}" aria-label="${n}" aria-pressed="${i === 0}"><i style="background:${c}"></i></button>`).join("")}<button type="button" class="fx-era" aria-pressed="false">Visk ut</button></span>
        <button type="button" class="fx-undo">Angre</button><button type="button" class="fx-reset">Nullstill</button></div>
      <div class="fx-send"><textarea rows="2" placeholder="Skriv hva du vil (valgfritt)" aria-label="Melding til Anton"></textarea><div class="fx-btns"><button type="button" class="fx-save" hidden>Bare lagre målene</button><button type="button" class="pri fx-go">Send til Anton</button></div></div>
      <p class="fx-err fx-senderr" role="alert" hidden></p></footer>`;
  host.append(box);
  const stage = $(box, ".fx-stage"), pan = $(box, ".fx-pan"), svgBox = $(box, ".fx-svg"), ink = $(box, ".fx-ink"), hint = $(box, ".fx-hint"), numCard = $(box, ".fx-num");
  const wings = (site0.wings || []).filter(w => (site0.buildings || []).some(b => b.wing === w.id));
  let focusId = focus, sideName = side, mode = "mal", colour = COLOURS[0][1], erasing = false, selected = null, d = null, model = null;
  let seen = [0, 0], pending = [];   // [{ ref, value, was }] in the order made
  let strokes = [];   // [{ colour, pts: [[t, z]] }] in facade metres
  const hist = [], snap = () => JSON.stringify({ pending, strokes });
  const push = () => { hist.push(snap()); if (hist.length > 60) hist.shift(); };
  const view = { k: 1, x: 0, y: 0 };   // the zoom and where the drawing stands in the stage
  const dark = () => document.documentElement.dataset.theme === "dark" || (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
  /* what the drawing is made of: the model with the pending edits; a refusal says why and leaves the last good picture */
  function build() {
    const b0 = tryEdits(site0, floors0, baseEdits(), []).site, edits = pending.flatMap(p => editsFor(b0, p.ref, p.value));
    const m = tryEdits(site0, floors0, baseEdits(), edits);
    const R = stage.getBoundingClientRect(), W = Math.max(520, Math.round(R.width || 900)), H = Math.max(360, Math.round(R.height || 560));
    seen = [R.width, R.height]; d = facadeDrawing(m.site, { focus: focusId, side: sideName }, wingOf, { W, H, dark: dark() }); model = m;
  }
  function paint() {
    svgBox.innerHTML = toSvg(d); svgBox.style.width = d.W + "px"; svgBox.style.height = d.H + "px";
    pan.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.k})`; pan.style.transformOrigin = "0 0";
    const R = stage.getBoundingClientRect(); ink.width = R.width * (devicePixelRatio || 1); ink.height = R.height * (devicePixelRatio || 1); ink.style.width = R.width + "px"; ink.style.height = R.height + "px";
    inkDraw(); $(box, ".fx-save").hidden = !pending.length;
    hint.textContent = mode === "mal" ? "Trykk på et tall med ramme for å endre det. Fingeren flytter og zoomer." : "Tegn med pennen. Fingeren flytter og zoomer tegningen.";
  }
  const refresh = () => { try { build(); $(box, ".fx-senderr").hidden = true; } catch (e) { say(e.message); return false; } paint(); sideButtons(); return true; };
  function say(t) { const e = $(box, ".fx-senderr"); e.textContent = t; e.hidden = !t; }
  function sideButtons() {
    $(box, ".fx-sides").innerHTML = d.sides.map(s => `<button type="button" data-side="${esc(s.name)}" aria-pressed="${s.name === d.face.side}">${esc(s.name)}</button>`).join("");
  }
  /* the stage's point ↔ the drawing's pixel ↔ metres */
  const toLocal = (cx, cy) => { const R = stage.getBoundingClientRect(); return [(cx - R.left - view.x) / view.k, (cy - R.top - view.y) / view.k]; };
  const toStage = ([x, y]) => [x * view.k + view.x, y * view.k + view.y];
  function inkDraw() {
    const g = ink.getContext("2d"), s = devicePixelRatio || 1; g.setTransform(s, 0, 0, s, 0, 0); g.clearRect(0, 0, ink.width, ink.height); g.lineCap = g.lineJoin = "round"; g.lineWidth = 4;
    for (const st of cur ? [...strokes, cur] : strokes) {
      g.strokeStyle = st.colour; g.beginPath();
      st.pts.forEach(([t, z], i) => { const [x, y] = toStage(d.toPx(t, z)); i ? g.lineTo(x, y) : g.moveTo(x, y); });
      if (st.pts.length === 1) { const [x, y] = toStage(d.toPx(...st.pts[0])); g.lineTo(x + 0.1, y); }
      g.stroke();
    }
  }
  /* the number card */
  const nf = v => String(Math.round(v * 100) / 100).replace(".", ",");
  function select(dim) {
    selected = dim; numCard.hidden = false; $(numCard, ".fx-lbl").textContent = dim.label; $(numCard, ".fx-in").value = nf(dim.value); $(numCard, ".fx-err").hidden = true; $(numCard, ".fx-in").focus({ preventScroll: true });
  }
  function setValue(v) {
    if (!selected || !Number.isFinite(v)) return;
    const ref = selected.ref, was = pending.find(p => keyOf(p.ref) === keyOf(ref))?.was ?? readRef(model.site, ref), before = snap(), prev = pending.slice();
    pending = pending.filter(p => keyOf(p.ref) !== keyOf(ref)); if (Math.abs(v - was) > 1e-6) pending.push({ ref, value: v, was });
    const err = $(numCard, ".fx-err");
    try { build(); } catch (e) { pending = prev; err.textContent = e.message; err.hidden = false; return; }
    err.hidden = true; if (hist.at(-1) !== before) hist.push(before); paint();
    const nd = d.dims.find(x => keyOf(x.ref) === keyOf(ref)); if (nd) { selected = nd; $(numCard, ".fx-lbl").textContent = nd.label; }
  }
  $(numCard, ".fx-in").oninput = e => { const v = parseFloat(e.target.value.replace(",", ".")); setValue(v); };
  $(numCard, ".fx-m").onclick = () => { const v = Math.round(((selected?.value ?? 0) - 0.1) * 100) / 100; $(numCard, ".fx-in").value = nf(v); setValue(v); };
  $(numCard, ".fx-p").onclick = () => { const v = Math.round(((selected?.value ?? 0) + 0.1) * 100) / 100; $(numCard, ".fx-in").value = nf(v); setValue(v); };
  $(numCard, ".fx-ok").onclick = () => { numCard.hidden = true; selected = null; };
  /* the pointers: a pen or a mouse in «Tegn» draws; otherwise one finger (or the mouse) moves, two fingers zoom, a short touch is a tap */
  const ptrs = new Map(); let cur = null, tap = null, pinch = null;
  const draws = e => mode === "tegn" && (e.pointerType === "pen" || e.pointerType === "mouse");
  const metres = e => d.toM(...toLocal(e.clientX, e.clientY));
  function erase(e) {
    const [x, y] = toLocal(e.clientX, e.clientY), r = 16 / view.k, n = strokes.length;
    strokes = strokes.filter(s => !s.pts.some(([t, z]) => { const [a, b] = d.toPx(t, z); return Math.hypot(a - x, b - y) < r; }));
    if (strokes.length !== n) inkDraw();
  }
  stage.addEventListener("pointerdown", e => {
    stage.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (draws(e)) { e.preventDefault(); push(); if (erasing) { cur = { erase: true }; erase(e); } else { cur = { colour, pts: [metres(e)] }; inkDraw(); } return; }
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), k: view.k }; tap = null; }
    else tap = { x: e.clientX, y: e.clientY, t: Date.now(), vx: view.x, vy: view.y };
  });
  stage.addEventListener("pointermove", e => {
    const p = ptrs.get(e.pointerId); if (!p) return;
    if (cur) { if (cur.erase) erase(e); else { for (const c of e.getCoalescedEvents?.() || [e]) { const m = d.toM(...toLocal(c.clientX, c.clientY)), l = cur.pts.at(-1); if (Math.hypot(m[0] - l[0], m[1] - l[1]) * d.p * view.k >= 2) cur.pts.push(m); } inkDraw(); } return; }
    const px0 = p.x, py0 = p.y; p.x = e.clientX; p.y = e.clientY;
    if (ptrs.size === 2 && pinch) { const [a, b] = [...ptrs.values()], dd = Math.hypot(a.x - b.x, a.y - b.y), R = stage.getBoundingClientRect(), cx = (a.x + b.x) / 2 - R.left, cy = (a.y + b.y) / 2 - R.top; zoomTo(pinch.k * dd / pinch.d, cx, cy); return; }
    if (tap) { const dx = e.clientX - tap.x, dy = e.clientY - tap.y; if (Math.hypot(dx, dy) > 8) { view.x = tap.vx + dx; view.y = tap.vy + dy; clamp(); pan.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.k})`; inkDraw(); } }
    void px0; void py0;
  });
  function zoomTo(k, cx, cy) {
    k = Math.min(6, Math.max(1, k)); const f = k / view.k; view.x = cx - (cx - view.x) * f; view.y = cy - (cy - view.y) * f; view.k = k; clamp(); paint();
  }
  function clamp() { const R = stage.getBoundingClientRect(); view.x = Math.min(0, Math.max(R.width - d.W * view.k, view.x)); view.y = Math.min(0, Math.max(R.height - d.H * view.k, view.y)); if (view.k === 1) { view.x = 0; view.y = 0; } }
  const up = e => {
    ptrs.delete(e.pointerId);
    if (cur) { if (!cur.erase && cur.pts.length) strokes.push(cur); cur = null; inkDraw(); return; }
    if (tap && e.type === "pointerup" && Date.now() - tap.t < 600 && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) <= 8 && mode === "mal") hitAt(e);
    if (ptrs.size < 2) pinch = null; tap = null;
  };
  stage.addEventListener("pointerup", up); stage.addEventListener("pointercancel", up);
  stage.addEventListener("touchmove", e => e.preventDefault(), { passive: false });   // a resting palm does not scroll or zoom the page
  stage.addEventListener("wheel", e => { e.preventDefault(); const R = stage.getBoundingClientRect(); zoomTo(view.k * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX - R.left, e.clientY - R.top); }, { passive: false });
  function hitAt(e) {
    const [x, y] = toLocal(e.clientX, e.clientY), slack = 8 / view.k;
    const hits = d.dims.filter(m => m.hit && m.ref).map(m => [m, Math.hypot(Math.max(m.hit[0] - x, 0, x - m.hit[0] - m.hit[2]), Math.max(m.hit[1] - y, 0, y - m.hit[1] - m.hit[3]))]).filter(([, dist]) => dist <= slack).sort((a, b) => a[1] - b[1]);
    if (hits.length) select(hits[0][0]);
    else if (d.dims.some(m => m.hit && !m.ref)) numCard.hidden = true;
    else { numCard.hidden = true; selected = null; }
  }
  /* the buttons */
  box.addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.side) { sideName = b.dataset.side; view.k = 1; view.x = view.y = 0; strokes = []; numCard.hidden = true; refresh(); }
    else if (b.classList.contains("fx-x")) close();
    else if (b.classList.contains("fx-mode")) { mode = b.dataset.mode; for (const m of box.querySelectorAll(".fx-mode")) m.setAttribute("aria-pressed", String(m === b)); $(box, ".fx-pens").hidden = mode !== "tegn"; if (mode === "tegn") numCard.hidden = true; ink.style.pointerEvents = "none"; paint(); }
    else if (b.classList.contains("dot")) { colour = b.dataset.c; erasing = false; for (const o of box.querySelectorAll(".dot")) o.setAttribute("aria-pressed", String(o === b)); $(box, ".fx-era").setAttribute("aria-pressed", "false"); }
    else if (b.classList.contains("fx-era")) { erasing = !erasing; b.setAttribute("aria-pressed", String(erasing)); }
    else if (b.classList.contains("fx-undo")) { const s = hist.pop(); if (s) { ({ pending, strokes } = JSON.parse(s)); numCard.hidden = true; refresh(); } }
    else if (b.classList.contains("fx-reset")) { if (pending.length || strokes.length) { push(); pending = []; strokes = []; numCard.hidden = true; refresh(); } }
    else if (b.classList.contains("fx-go")) go(true);
    else if (b.classList.contains("fx-save")) go(false);
  });
  $(box, ".fx-bygg").innerHTML = [...wings.map(w => `<option value="${esc(w.id)}">${esc(w.name)}</option>`), ...(site0.added || []).filter(a => a.kind === "volume" && a.from && a.to && !/^balkong/i.test(a.name || "")).map(a => `<option value="${esc(a.id)}">${esc(a.name)} (nytt)</option>`)].join("");
  $(box, ".fx-bygg").value = focusId;
  $(box, ".fx-bygg").onchange = e => { focusId = e.target.value; pending = []; strokes = []; hist.length = 0; sideName = null; view.k = 1; view.x = view.y = 0; numCard.hidden = true; if (refresh()) sideName = d.face.side; };
  /* sending: the measures first (the draft, the same way the page's own changes go), then the words, the strokes and the picture */
  let sending = false;
  async function go(toAnton) {
    if (sending) return; sending = true; const bt = box.querySelectorAll(".fx-go, .fx-save"); bt.forEach(x => { x.disabled = true; }); say("");
    try {
      const text = $(box, ".fx-send textarea").value.trim(), model0 = tryEdits(site0, floors0, baseEdits(), []);
      if (!pending.length && !strokes.length && !text) { say("Gjør en endring eller tegn noe først."); return; }
      if (pending.length) {
        const edits = pending.flatMap(p => editsFor(model0.site, p.ref, p.value)), words = pending.map(p => sayChange(p.ref, p.was, p.value, model.site));
        if (!(await commit(edits))) { say("Fikk ikke lagret målene. Prøv igjen."); return; }
        pending.forEach((p, i) => { p.sent = words[i]; });
      }
      const words = pending.map(p => p.sent);
      if (!toAnton) { pending = []; hist.length = 0; refresh(); say("Målene er lagret."); return; }
      const lines = [`Tegning av fasaden: ${d.face.building}, ${d.face.side.toLowerCase()}.`, ...(words.length ? ["Målene som er endret (fra, til):", ...words.map(w => `- ${w}`)] : []), ...(strokes.length ? [`${strokes.length} ${strokes.length === 1 ? "strek" : "streker"} tegnet på fasaden (meter fra venstre ende, kote):`, strokeWords(strokes, d.face)] : []), ...(text ? [text] : [])];
      const out = document.createElement("canvas"), k = Math.min(1, 1280 / d.W); out.width = Math.round(d.W * k); out.height = Math.round(d.H * k);
      const g = out.getContext("2d"); g.scale(k, k);
      await new Promise(res => { const im = new Image(); im.onload = () => { g.drawImage(im, 0, 0, d.W, d.H); res(); }; im.onerror = res; im.src = URL.createObjectURL(new Blob([toSvg(d)], { type: "image/svg+xml" })); });
      g.lineCap = g.lineJoin = "round"; g.lineWidth = 4;
      for (const s of strokes) { g.strokeStyle = s.colour; g.beginPath(); s.pts.forEach(([t, z], i) => { const [x, y] = d.toPx(t, z); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke(); }
      const name = c => COLOURS.find(x => x[1] === c)?.[0].toLowerCase() || c;
      const drawing = { image: out.toDataURL("image/jpeg", 0.82), strokes: strokes.map(s => strokeToSite(s, d.world, name(s.colour))), camera: {}, mode: "fasade", size: [d.W, d.H],
        facade: { ...d.face, strokes_m: strokes.map(s => ({ colour: name(s.colour), points: s.pts.slice(0, 60).map(q => q.map(v => Math.round(v * 100) / 100)) })), changes: words } };
      let ok; try { ok = await send(lines.join("\n"), drawing); } catch (x) { console.error(x); ok = { error: "Noe gikk galt. Prøv igjen." }; }
      if (ok === true) { pending = []; close(); } else say(ok?.error || "Ble ikke sendt. Prøv igjen.");
    } catch (e) { say(e.message || "Noe gikk galt."); } finally { sending = false; bt.forEach(x => { x.disabled = false; }); }
  }
  function close() { box.remove(); document.body.classList.remove("tegner"); removeEventListener("keydown", onKey); removeEventListener("resize", onResize); ro.disconnect(); }
  const onKey = e => { if (e.key === "Escape" && !(e.target instanceof HTMLTextAreaElement)) close(); }; addEventListener("keydown", onKey);
  const onResize = () => { view.k = 1; view.x = view.y = 0; refresh(); }; addEventListener("resize", onResize); const ro = new ResizeObserver(() => { if (Math.abs(stage.clientHeight - seen[1]) > 2 || Math.abs(stage.clientWidth - seen[0]) > 2) onResize(); }); ro.observe(stage);
  if (!refresh()) { sideName = null; refresh(); }
  sideName = d?.face.side ?? sideName;
  return { close, get drawing() { return d; }, get pending() { return pending; } };
}
