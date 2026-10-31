/* «Fasade» on the page: one screen. The side buttons on top, the drawing in the middle (a finger moves and zooms it, the pen draws),
   the tools at the bottom (Mål | Tegn | Angre | Nullstill) and one big button, «Send til Anton». The drawing and the numbers are
   fasade.js's; the pen is tegn.js's (a finger does not draw, so the palm can rest; a mouse does, for the desk).

   open({ host, site0, floors0, baseEdits, wingOf, commit, send, focus, side })
     site0, floors0   the data before any change (the page's own copies)
     baseEdits()      the edits the open draft or version has now
     commit(edits)    lays edits into the draft the way the page's own changes go (api/endring); resolves true when taken
     send(text, drawing)  to Anton (anton.js sendIt); resolves true, or { error } */
import { facadeDrawing, sidesOf, editsFor, readRef, tryEdits, sayChange, strokeWords, strokeToSite, toSvg, fm, initialLayout, layoutEdits, layoutFromEdits, openingsEdits, openingsFromEdits } from "./fasade.js";
import { pickAt, marquee, choose, snapMove, snapPoint, handlesOf, moveRect, resizeRect, layoutItemOf, typedItem, alignItems, distribute, arrayOf, selectAll, hudText } from "./gizmo.js";
import { esc as kitEsc } from "./kit/html.js";

const COLOURS = [["Rød", "#c8102e"], ["Blå", "#1f5fbf"], ["Svart", "#23211e"]];
const $ = (el, s) => el.querySelector(s);
const esc = s => kitEsc(s ?? ""); // null-safe; the escaping is the kit's (kit/html.js)
const keyOf = r => JSON.stringify(r);

export function open({ host = document.body, site0, floors0, baseEdits, wingOf, commit, send, focus = "sentralblokka", side = "Sørsiden", keep = {} }) {
  if (document.getElementById("fasade")) return null;   // one surface at a time
  document.body.classList.add("tegner");
  const box = document.createElement("div"); box.id = "fasade"; box.setAttribute("role", "dialog"); box.setAttribute("aria-label", "Fasade");
  box.innerHTML = `<header class="fx-top"><button type="button" class="fx-x" aria-label="Lukk">Lukk</button>
      <select class="fx-bygg" aria-label="Bygg"></select><nav class="fx-sides" aria-label="Side"></nav></header>
    <div class="fx-stage"><div class="fx-pan"><div class="fx-svg"></div></div><canvas class="fx-ink" aria-label="Tegneflaten"></canvas></div>
    <p class="fx-hint" role="status">Trykk på et tall med ramme for å endre det.</p>
    <div class="fx-num card" hidden><b class="fx-lbl"></b><div class="fx-row"><button type="button" class="fx-m" aria-label="Mindre">−</button><input class="fx-in" inputmode="decimal" aria-label="Tall i meter"><span>m</span><button type="button" class="fx-p" aria-label="Mer">+</button><button type="button" class="fx-ok">Ferdig</button></div><p class="fx-err" role="alert" hidden></p></div>
    <div class="fx-sel card" hidden><b class="fx-sl"></b><div class="fx-sf"><label>Bredde<input data-f="bredde" inputmode="decimal"></label><label>Fra venstre<input data-f="venstre" inputmode="decimal"></label><label>Dybde<input data-f="dybde" inputmode="decimal"></label><label class="fx-sup">Understøttet<input type="checkbox" data-f="support"></label></div>
      <div class="fx-sb"><button type="button" data-a="fjern">Fjern</button><button type="button" data-a="kopier">Kopier</button><button type="button" data-a="mer">Mer</button><button type="button" data-a="ferdig" class="fx-ok">Ferdig</button></div>
      <div class="fx-more" hidden><button type="button" data-a="etasje">Velg alle på etasjen</button><button type="button" data-a="venstre">Juster til venstre</button><button type="button" data-a="fordel">Fordel jevnt</button><button type="button" data-a="rekke">Kopier 4 ganger, 3,2 m mellom</button><button type="button" data-a="alle">Fjern alle balkonger</button><button type="button" data-a="orig">Tilbakestill til original</button></div></div>
    <div class="fx-hand"></div>
    <footer class="fx-bar"><div class="fx-tools"><button type="button" class="fx-mode" data-mode="mal" aria-pressed="true">Mål</button><button type="button" class="fx-mode" data-mode="tegn" aria-pressed="false">Tegn</button>
        <span class="fx-pens" hidden>${COLOURS.map(([n, c], i) => `<button type="button" class="dot" data-c="${c}" aria-label="${n}" aria-pressed="${i === 0}"><i style="background:${c}"></i></button>`).join("")}<button type="button" class="fx-era" aria-pressed="false">Visk ut</button></span>
        <button type="button" class="fx-mode" data-mode="ny">Ny balkong</button><button type="button" class="fx-mode" data-mode="nydør">Ny dør</button><button type="button" class="fx-mer">Balkonger</button><button type="button" class="fx-undo">Angre</button><button type="button" class="fx-reset">Nullstill</button></div>
      <div class="fx-send"><textarea rows="2" placeholder="Skriv hva du vil (valgfritt)" aria-label="Melding til Anton"></textarea><div class="fx-btns"><button type="button" class="fx-save" hidden>Bare lagre målene</button><button type="button" class="pri fx-go">Send til Anton</button></div></div>
      <p class="fx-err fx-senderr" role="alert" hidden></p></footer>`;
  host.append(box);
  const stage = $(box, ".fx-stage"), pan = $(box, ".fx-pan"), svgBox = $(box, ".fx-svg"), ink = $(box, ".fx-ink"), hint = $(box, ".fx-hint"), numCard = $(box, ".fx-num");
  const wings = (site0.wings || []).filter(w => (site0.buildings || []).some(b => b.wing === w.id));
  const kp = keep.state;   // what the last close kept (miniapp.js): the person's unsent work
  let focusId = kp?.focusId ?? focus, sideName = kp?.sideName ?? side, mode = "mal", colour = COLOURS[0][1], erasing = false, selected = null, d = null, model = null;
  let seen = [0, 0], sel = [], layoutBy = {}, doorsBy = {}, origBy = {}, faceBy = {}, drag = null, marq = null, pending = [];   // [{ ref, value, was }] in the order made; doorsBy: the person's own doors per side (the openings edits)
  let strokes = [];   // [{ colour, pts: [[t, z]] }] in facade metres
  const hist = [], snap = () => JSON.stringify({ pending, strokes, layoutBy, doorsBy, faceBy });
  const push = () => { hist.push(snap()); if (hist.length > 60) hist.shift(); };
  const view = { k: 1, x: 0, y: 0 };   // the zoom and where the drawing stands in the stage
  const dark = () => document.documentElement.dataset.theme === "dark" || (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
  /* what the drawing is made of: the model with the pending edits; a refusal says why and leaves the last good picture */
  function build() {
    const b0 = tryEdits(site0, floors0, baseEdits(), []).site, edits = pending.flatMap(p => editsFor(b0, p.ref, p.value));
    const m = tryEdits(site0, floors0, baseEdits(), edits);
    const R = stage.getBoundingClientRect(), W = Math.max(520, Math.round(R.width || 900)), H = Math.max(360, Math.round(R.height || 560));
    seen = [R.width, R.height]; d = facadeDrawing(m.site, { focus: focusId, side: sideName }, wingOf, { W, H, dark: dark() });
    if (layoutBy[d.face.side] || sel.length || doorsBy[d.face.side]) d = facadeDrawing(m.site, { focus: focusId, side: sideName, ...(layoutBy[d.face.side] || sel.length ? { layout: layoutBy[d.face.side], selected: sel } : {}), ...(doorsBy[d.face.side] ? { doors: doorsBy[d.face.side] } : {}) }, wingOf, { W, H, dark: dark() });
    model = m;
  }
  function paint() {
    svgBox.innerHTML = toSvg(d); svgBox.style.width = d.W + "px"; svgBox.style.height = d.H + "px";
    pan.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.k})`; pan.style.transformOrigin = "0 0";
    const R = stage.getBoundingClientRect(); ink.width = R.width * (devicePixelRatio || 1); ink.height = R.height * (devicePixelRatio || 1); ink.style.width = R.width + "px"; ink.style.height = R.height + "px";
    inkDraw(); handles(); $(box, ".fx-save").hidden = !pending.length && !dirtyAny();
    if (!drag) hint.textContent = mode === "mal" ? "Trykk på et tall med ramme for å endre det, eller på en balkong eller en dør for å flytte den. Fingeren flytter og zoomer." : mode === "ny" ? "Trykk på fasaden der balkongen skal stå." : mode === "nydør" ? "Trykk på fasaden der døren skal stå, eller på et vindu for å gjøre det om til en dør." : "Tegn med pennen. Fingeren flytter og zoomer tegningen.";
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
    if (marq) { const [a, b] = [toStage(d.toPx(...marq.a)), toStage(d.toPx(...marq.b))]; g.save(); g.strokeStyle = "#1f5fbf"; g.fillStyle = "rgba(31,95,191,.10)"; g.lineWidth = 1.5; g.setLineDash(marq.b[0] >= marq.a[0] ? [] : [6, 4]); g.fillRect(a[0], a[1], b[0] - a[0], b[1] - a[1]); g.strokeRect(a[0], a[1], b[0] - a[0], b[1] - a[1]); g.restore(); }
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
    const hEl = e.target.closest?.("[data-h]");
    if (hEl && sel.length === 1) { push(); drag = { k: "size", h: hEl.dataset.h, id: sel[0], r0: { ...rectOf(sel[0]) } }; return; }
    if (mode === "mal" && e.pointerType !== "touch" && ptrs.size === 1) {
      const p = metres(e), hit = pickAt(editable(), p, 10 / (d.p * view.k));
      if (hit) {
        push(); const was = sel.includes(hit.id); if (!was || e.shiftKey) sel = choose(sel, [hit.id], e.shiftKey);
        hit.kind === "dør" ? ensureDoors() : ensureLayout(); sel = remap(sel, hit); selCard();
        if (sel.length) { const rs = Object.fromEntries(sel.map(id => [id, { ...rectOf(id) }])), pr = sel.includes(remap([hit.id], hit)[0]) ? remap([hit.id], hit)[0] : sel[0]; drag = { k: "move", start: p, prim: pr, rs }; }
        refresh(); return;
      }
      if (e.shiftKey && e.pointerType === "mouse") { marq = { a: p, b: p, add: true }; return; }
    }
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), k: view.k }; tap = null; drag = null; marq = null; }
    else tap = { x: e.clientX, y: e.clientY, t: Date.now(), vx: view.x, vy: view.y };
  });
  stage.addEventListener("pointermove", e => {
    const p = ptrs.get(e.pointerId); if (!p) return;
    if (drag || marq) { const pm = metres(e); if (marq) { marq.b = pm; inkDraw(); return; } moveDrag(e, pm); return; }
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
    if (drag) { drag = null; refresh(); selCard(); return; }
    if (marq) { const r = marquee(editable(), marq.a, marq.b); sel = choose(sel, r.keys, e.shiftKey); marq = null; if (sel.length) { push(); ensureLayout(); if (sel.some(id => d.items.find(i => i.id === id)?.kind === "dør")) ensureDoors(); } selCard(); refresh(); return; }
    if (cur) { if (!cur.erase && cur.pts.length) strokes.push(cur); cur = null; inkDraw(); return; }
    if (tap && e.type === "pointerup" && Date.now() - tap.t < 600 && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) <= 8 && (mode === "mal" || mode === "ny" || mode === "nydør")) hitAt(e);
    if (ptrs.size < 2) pinch = null; tap = null;
  };
  stage.addEventListener("pointerup", up); stage.addEventListener("pointercancel", up);
  stage.addEventListener("touchmove", e => e.preventDefault(), { passive: false });   // a resting palm does not scroll or zoom the page
  stage.addEventListener("wheel", e => { e.preventDefault(); const R = stage.getBoundingClientRect(); zoomTo(view.k * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX - R.left, e.clientY - R.top); }, { passive: false });
  function hitAt(e) {
    const [x, y] = toLocal(e.clientX, e.clientY), slack = 8 / view.k;
    const hits = d.dims.filter(m => m.hit && m.ref).map(m => [m, Math.hypot(Math.max(m.hit[0] - x, 0, x - m.hit[0] - m.hit[2]), Math.max(m.hit[1] - y, 0, y - m.hit[1] - m.hit[3]))]).filter(([, dist]) => dist <= slack).sort((a, b) => a[1] - b[1]);
    if (mode === "ny") return addBalcony(d.toM(x, y));
    if (mode === "nydør") return addDoor(d.toM(x, y));
    if (!hits.length) { const it = pickAt(editable(), d.toM(x, y), 14 / (d.p * view.k)); if (it) { push(); sel = choose(sel, [it.id], e.shiftKey); it.kind === "dør" ? ensureDoors() : ensureLayout(); sel = remap(sel, it); numCard.hidden = true; selCard(); refresh(); return; } if (sel.length) { sel = []; selCard(); refresh(); } }
    if (hits.length) select(hits[0][0]);
    else if (d.dims.some(m => m.hit && !m.ref)) numCard.hidden = true;
    else { numCard.hidden = true; selected = null; }
  }
  /* the balconies: items of the drawing, a layout of one facade, the gizmo (gizmo.js) */
  const dirtyAny = () => Object.keys(layoutBy).length > 0 || doorSides().length > 0, coarse = matchMedia("(pointer: coarse)").matches;
  /* what may be picked: the balconies when the person owns this facade's balconies, the doors when he owns its doors */
  const doorSides = () => Object.keys(doorsBy).filter(sd => doorsBy[sd].length || openingsFromEdits(baseEdits(), faceBy[sd]) != null);
  const editable = () => { const balOk = !!(layoutBy[d.face.side] || d.items.every(i => i.kind === "dør" || i.built) || layoutFromEdits(baseEdits(), d.face)), doorOk = doorsBy[d.face.side] != null || openingsFromEdits(baseEdits(), d.face) != null;
    return [...(balOk ? d.items.filter(i => i.kind !== "dør") : []), ...(doorOk ? d.items.filter(i => i.kind === "dør") : [])]; };
  const rectOf = id => { const i = d.items.find(x => x.id === id); return i ? { x0: i.x0, x1: i.x1, z0: i.z0, z1: i.z1 } : null; };
  function ensureLayout() {
    const sd = d.face.side; if (!layoutBy[sd]) { faceBy[sd] = d.face; const L = layoutFromEdits(baseEdits(), d.face) ?? initialLayout(d); origBy[sd] = JSON.parse(JSON.stringify(L)); layoutBy[sd] = L; build(); }
    faceBy[sd] = d.face; return layoutBy[sd];
  }
  const remap = (ids, hit) => ids.map(id => d.items.some(i => i.id === id) ? id : (d.items.find(i => i.storey === hit.storey && Math.abs(i.x0 - hit.x0) < 0.6)?.id ?? id));
  const setLayout = L => { layoutBy[d.face.side] = L; };
  /* the person's own doors of this facade: the draft's openings edits read back, else none yet. When the layout takes over from
     the model's doors (its own read of the same edits), the picked ids are kept by matching the doors' place, so a selected door stays selected */
  function ensureDoors() {
    const sd = d.face.side;
    if (!doorsBy[sd]) {
      const was = d.items.filter(i => i.kind === "dør" && sel.includes(i.id));
      faceBy[sd] = d.face; doorsBy[sd] = openingsFromEdits(baseEdits(), d.face) ?? []; build();
      sel = sel.map(id => { const w = was.find(x => x.id === id); return w && !d.items.some(i => i.id === id) ? (d.items.find(i => i.kind === "dør" && Math.abs(i.x0 - w.x0) < 0.6 && Math.abs(i.z0 - w.z0) < 0.3)?.id ?? id) : id; });
    }
    faceBy[sd] = d.face; return doorsBy[sd];
  }
  const setDoors = L => { doorsBy[d.face.side] = L; };
  let raf = 0; const live = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; try { build(); } catch { return; } svgBox.innerHTML = toSvg(d); inkDraw(); handles(); }); };
  function moveDrag(e, p) {
    const sd = d.face.side, isDoor = (doorsBy[sd] || []).some(i => i.id === drag.id), L = isDoor ? doorsBy[sd] : layoutBy[sd]; if (!L) return;
    const setL = isDoor ? setDoors : setLayout;
    const ctx = { levels: d.levels.map(l => l.kote), corners: [0, d.width_m], off: e.altKey || e.ctrlKey, tol: 8 / (d.p * view.k) };
    if (drag.k === "move") {
      const r0 = drag.rs[drag.prim], res = snapMove(moveRect(r0, p[0] - drag.start[0], p[1] - drag.start[1]), { ...ctx, others: d.items.filter(i => !sel.includes(i.id)) }), dx = res.rect.x0 - r0.x0, dz = res.rect.z0 - r0.z0;
      setL(L.map(i => drag.rs[i.id] ? layoutItemOf(i, moveRect(drag.rs[i.id], dx, dz), d.levels) : i)); hint.textContent = hudText(res.rect, res.snaps);
    } else {
      const sp = snapPoint(p, { ...ctx, others: d.items.filter(i => i.id !== drag.id) }), r = resizeRect(drag.r0, drag.h, [sp.p[0], drag.r0.z1]);
      setL(L.map(i => i.id === drag.id ? layoutItemOf(i, { ...r, z1: drag.r0.z1 }, d.levels) : i)); hint.textContent = hudText(r, sp.snaps);
    }
    live();
  }
  function handles() {
    const h = $(box, ".fx-hand"); h.innerHTML = ""; const it = sel.length === 1 && mode === "mal" && d.items.find(i => i.id === sel[0]); if (!it) return;
    for (const g of handlesOf(it, d.p * view.k, coarse).filter(x => x.handle === "e" || x.handle === "w")) {
      const R = stage.getBoundingClientRect(), [x, y] = toStage(d.toPx(...g.at)), b = document.createElement("div"); b.dataset.h = g.handle; b.setAttribute("aria-label", g.handle === "e" ? "Dra høyre kant" : "Dra venstre kant");
      b.style.cssText = `left:${R.left + x - g.size / 2}px;top:${R.top + y - g.size / 2}px;width:${g.size}px;height:${g.size}px`; h.append(b);
    }
  }
  function selCard() {
    const c = $(box, ".fx-sel"), items = sel.map(id => (doorsBy[d.face.side] || []).find(i => i.id === id) || layoutBy[d.face.side]?.find(i => i.id === id) || d.items.find(i => i.id === id)).filter(Boolean);
    c.hidden = !items.length; if (!items.length) { $(c, ".fx-more").hidden = true; return; }
    numCard.hidden = true; const anyDoor = items.some(i => i.kind === "dør");
    $(c, ".fx-sl").textContent = items.length === 1 ? (items[0].kind === "dør" ? "Dør" : `Balkong, ${items[0].storey}`) : `${items.length} valgt`;
    const one = items.length === 1 ? items[0] : null, q = k => $(c, `[data-f=${k}]`);
    for (const k of ["bredde", "venstre", "dybde"]) { q(k).parentElement.hidden = !one || (k === "dybde" && anyDoor); }
    const sup = q("support").parentElement; sup.hidden = !one || one.kind === "dør"; if (one && one.kind !== "dør") q("support").checked = !!one.support;
    for (const b of c.querySelectorAll("[data-a=kopier],[data-a=mer]")) b.hidden = anyDoor;   // kopiering og «Mer» gjelder balkongene
    if (anyDoor) $(c, ".fx-more").hidden = true;
    if (one) { const t0 = one.t0 ?? one.x0, t1 = one.t1 ?? one.x1; q("bredde").value = nf(t1 - t0); q("venstre").value = nf(t0); q("dybde").value = nf(one.depth ?? 1.8); }
  }
  function addBalcony(p) {
    push(); const L = ensureLayout(), lv = d.levels.reduce((b, l) => Math.abs(l.kote - p[1]) < Math.abs(b.kote - p[1]) ? l : b, d.levels[0]); if (!lv) return;
    const t0 = Math.round(Math.min(Math.max(0, p[0] - 1.5), Math.max(0, d.width_m - 3)) * 10) / 10, it = { id: `ny:${Date.now()}`, storey: lv.name, t0, t1: Math.round((t0 + 3) * 10) / 10, depth: 1.8 };
    setLayout([...L, it]); sel = [it.id]; mode = "mal"; for (const m of box.querySelectorAll(".fx-mode")) m.setAttribute("aria-pressed", String(m.dataset.mode === "mal")); refresh(); selCard();
  }
  /* a new door: on a window it takes the window's place and reaches down to the floor (the drawing hides the window), else it stands where the person tapped */
  function addDoor(p) {
    push(); ensureDoors(); const floor = z => { const f = [...d.levels].reverse().find(l => l.kote <= z + 0.3); return f?.kote ?? d.base_kote; };
    const w = (d.windowRects || []).find(r => p[0] >= r.t0 - 0.15 && p[0] <= r.t1 + 0.15 && p[1] >= r.z0 - 0.35 && p[1] <= r.z1 + 0.35);
    const it = w ? { id: `dør:${Date.now()}`, t0: w.t0, t1: w.t1, z0: floor(w.z0), z1: w.z1, win: [w.t0, w.t1, w.z0, w.z1] }
      : (() => { const f = floor(p[1]), t0 = Math.round(Math.min(Math.max(0, p[0] - 0.5), Math.max(0, d.width_m - 1)) * 10) / 10; return { id: `dør:${Date.now()}`, t0, t1: Math.round((t0 + 1) * 10) / 10, z0: f, z1: Math.round((f + 2.1) * 100) / 100 }; })();
    setDoors([...doorsBy[d.face.side], it]); sel = [it.id]; mode = "mal"; for (const m of box.querySelectorAll(".fx-mode")) m.setAttribute("aria-pressed", String(m.dataset.mode === "mal")); refresh(); selCard();
  }
  for (const inp of box.querySelectorAll(".fx-sf input")) inp.onchange = () => {
    if (sel.length !== 1) return;
    if (inp.dataset.f === "support") {   // «Understøttet»: støtter under dekket, i tegningen og i modellen
      const L = layoutBy[d.face.side], cur = L?.find(i => i.id === sel[0]); if (!cur || cur.kind === "dør") return;
      push(); setLayout(L.map(i => i === cur ? { ...i, support: inp.checked } : i)); refresh(); selCard(); return;
    }
    const doorSel = (doorsBy[d.face.side] || []).some(i => i.id === sel[0]), L = doorSel ? doorsBy[d.face.side] : layoutBy[d.face.side]; if (!L) return;
    const cur = L.find(i => i.id === sel[0]), nx = cur && typedItem(cur, inp.dataset.f, inp.value);
    if (!nx) { say("Det tallet passer ikke her."); selCard(); return; } push(); (doorSel ? setDoors : setLayout)(L.map(i => i === cur ? nx : i)); refresh(); selCard();
  };
  function act(a) {
    const sd = d.face.side, c = $(box, ".fx-sel"), L = () => ensureLayout(), chosen = () => L().filter(i => sel.includes(i.id)), rectI = i => ({ id: i.id, kind: "balkong", storey: i.storey, x0: i.t0, x1: i.t1, z0: (d.levels.find(l => l.name === i.storey)?.kote ?? 0) - 0.2, z1: d.levels.find(l => l.name === i.storey)?.kote ?? 0 });
    const place = (items, rects) => L().map(i => { const r = rects.find(x => x.id === i.id); return r ? layoutItemOf(i, r, d.levels) : i; });
    if (a === "mer") { $(c, ".fx-more").hidden = !$(c, ".fx-more").hidden; return; }
    if (a === "ferdig") { sel = []; selCard(); refresh(); return; }
    /* dører valgt: bare Fjern og Ferdig gjelder dem (kopiering og «Mer» er balkongenes); «Tilbakestill til original» tar dem med, sammen med balkongene */
    if (sel.some(id => d.items.find(i => i.id === id)?.kind === "dør")) ensureDoors();
    const doorIds = (doorsBy[sd] || []).filter(i => sel.includes(i.id)).map(i => i.id);
    if (doorIds.length) {
      if (a === "fjern") { push(); setDoors(doorsBy[sd].filter(i => !sel.includes(i.id))); sel = sel.filter(id => !doorIds.includes(id)); if (!sel.length) { $(c, ".fx-more").hidden = true; refresh(); selCard(); return; } }
      else if (a !== "orig") { $(c, ".fx-more").hidden = true; refresh(); selCard(); return; }
    }
    push();
    if (a === "fjern") setLayout(L().filter(i => !sel.includes(i.id))), sel = [];
    else if (a === "kopier" || a === "rekke") {
      const src = a === "rekke" ? chosen().slice(0, 1) : chosen(), made = src.flatMap(i => (a === "rekke" ? arrayOf(rectI(i), 4, 3.2) : [moveRect(rectI(i), i.t1 - i.t0 + 0.6, 0)]).map((r, k) => ({ ...i, id: `ny:${Date.now()}:${i.id}:${k}`, storey: i.storey, t0: r.x0, t1: r.x1, built: false })));
      setLayout([...L(), ...made]); sel = made.map(m => m.id);
    } else if (a === "etasje") { const st = chosen()[0]?.storey; sel = L().filter(i => i.storey === st).map(i => i.id); }
    else if (a === "venstre") setLayout(place(0, alignItems(chosen().map(rectI), "venstre")));
    else if (a === "fordel") setLayout(place(0, distribute(chosen().map(rectI))));
    else if (a === "alle") { setLayout([]); sel = []; }
    else if (a === "orig") {
      if (layoutFromEdits(baseEdits(), d.face) == null) { delete layoutBy[sd]; } else { const o = facadeDrawing(tryEdits(site0, floors0, [], []).site, { focus: focusId, side: sideName }, wingOf, { W: d.W, H: d.H }); setLayout(initialLayout(o)); }
      delete doorsBy[sd];   // dørene også: tilbake til det utkastet allerede har
      sel = [];
    }
    if (a !== "etasje") { $(c, ".fx-more").hidden = true; } refresh(); selCard();
  }
  $(box, ".fx-sel").addEventListener("click", e => { const b = e.target.closest("button"); if (b) act(b.dataset.a); });
  $(box, ".fx-mer").onclick = () => { const c = $(box, ".fx-sel"); c.hidden = false; $(c, ".fx-sl").textContent = `Balkonger, ${d.face.side.toLowerCase()}`; for (const k of c.querySelectorAll(".fx-sf label")) k.hidden = true; $(c, ".fx-more").hidden = false; };
  const layoutWords = sd => {
    const cur = layoutBy[sd], o = origBy[sd] || [], gone = o.filter(i => !cur.some(c => c.id === i.id)).length, news = cur.filter(c => !o.some(i => i.id === c.id)).length, moved = cur.filter(c => { const i = o.find(x => x.id === c.id); return i && (Math.abs(i.t0 - c.t0) > 0.04 || Math.abs(i.t1 - c.t1) > 0.04 || i.storey !== c.storey || i.depth !== c.depth || !!i.support !== !!c.support); });
    return [`Balkongene på ${sd.toLowerCase()}: ${cur.length} i alt (${gone} fjernet, ${news} nye, ${moved.length} flyttet eller endret).`, ...cur.slice(0, 40).map(c => `  ${c.storey}: ${nf(c.t0)} til ${nf(c.t1)} m fra venstre, dybde ${nf(c.depth ?? 1.8)} m${c.support ? ", understøttet" : ""}`)];
  };
  /* the doors' words for Anton: what the person changed on this facade */
  const doorWords = sd => {
    const cur = doorsBy[sd] || [];
    return [`Dørene på ${sd.toLowerCase()}: ${cur.length} ${cur.length === 1 ? "dør" : "dører"} i alt (de opprinnelige vinduene står urørt).`, ...cur.map(c => `  ${c.win ? "vindu gjort om til dør" : "ny dør"}: ${nf(c.t0)} til ${nf(c.t1)} m fra venstre, fra ${fm(c.z0)} til ${fm(c.z1)} m over havet`)];
  };

  /* the buttons */
  box.addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.side) { sideName = b.dataset.side; view.k = 1; view.x = view.y = 0; strokes = []; numCard.hidden = true; refresh(); }
    else if (b.classList.contains("fx-x")) close();
    else if (b.classList.contains("fx-mode")) { mode = b.dataset.mode; if (mode !== "mal") { sel = []; selCard(); } for (const m of box.querySelectorAll(".fx-mode")) m.setAttribute("aria-pressed", String(m === b)); $(box, ".fx-pens").hidden = mode !== "tegn"; if (mode === "tegn") numCard.hidden = true; ink.style.pointerEvents = "none"; paint(); }
    else if (b.classList.contains("dot")) { colour = b.dataset.c; erasing = false; for (const o of box.querySelectorAll(".dot")) o.setAttribute("aria-pressed", String(o === b)); $(box, ".fx-era").setAttribute("aria-pressed", "false"); }
    else if (b.classList.contains("fx-era")) { erasing = !erasing; b.setAttribute("aria-pressed", String(erasing)); }
    else if (b.classList.contains("fx-undo")) { const s = hist.pop(); if (s) { ({ pending, strokes, layoutBy, doorsBy, faceBy } = JSON.parse(s)); sel = []; selCard(); numCard.hidden = true; refresh(); } }
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
      const lSides = Object.keys(layoutBy), dSides = doorSides(), lWords = [...lSides.flatMap(layoutWords), ...dSides.flatMap(doorWords)];
      if (!pending.length && !strokes.length && !text && !lSides.length && !dSides.length) { say("Gjør en endring eller tegn noe først."); return; }
      if (pending.length || lSides.length || dSides.length) {
        const edits = [...pending.flatMap(p => editsFor(model0.site, p.ref, p.value)), ...lSides.flatMap(sd => layoutEdits(faceBy[sd], faceBy[sd].wing, layoutBy[sd])), ...dSides.flatMap(sd => openingsEdits(faceBy[sd], faceBy[sd].wing, doorsBy[sd]))], words = pending.map(p => sayChange(p.ref, p.was, p.value, model.site));
        if (!(await commit(edits))) { say("Fikk ikke lagret målene. Prøv igjen."); return; }
        pending.forEach((p, i) => { p.sent = words[i]; });
      }
      const words = [...pending.map(p => p.sent), ...lWords];
      for (const sd of lSides) delete layoutBy[sd]; for (const sd of dSides) delete doorsBy[sd]; sel = [];
      if (!toAnton) { pending = []; hist.length = 0; refresh(); selCard(); say("Målene er lagret."); return; }
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
      if (ok === true) { pending = []; strokes = []; close(true); } else say(ok?.error || "Ble ikke sendt. Prøv igjen.");
    } catch (e) { say(e.message || "Noe gikk galt."); } finally { sending = false; bt.forEach(x => { x.disabled = false; }); }
  }
  function close(sent = false) { keep.state = sent === true || (!pending.length && !strokes.length && !dirtyAny()) ? null : { focusId, sideName, pending, strokes, layoutBy, doorsBy, origBy, faceBy }; box.remove(); document.body.classList.remove("tegner"); removeEventListener("keydown", onKey); removeEventListener("resize", onResize); ro.disconnect(); }
  const onKey = e => { if (e.key === "Escape" && !(e.target instanceof HTMLTextAreaElement)) close(); }; addEventListener("keydown", onKey);
  const onResize = () => { view.k = 1; view.x = view.y = 0; refresh(); }; addEventListener("resize", onResize); const ro = new ResizeObserver(() => { if (Math.abs(stage.clientHeight - seen[1]) > 2 || Math.abs(stage.clientWidth - seen[0]) > 2) onResize(); }); ro.observe(stage);
  if (kp) { pending = kp.pending; strokes = kp.strokes; layoutBy = kp.layoutBy; doorsBy = kp.doorsBy || {}; origBy = kp.origBy; faceBy = kp.faceBy; }
  $(box, ".fx-bygg").value = focusId;
  if (!refresh()) { sideName = null; refresh(); }
  sideName = d?.face.side ?? sideName;
  return { close, get drawing() { return d; }, get pending() { return pending; } };
}
