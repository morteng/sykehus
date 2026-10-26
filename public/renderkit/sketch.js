/* A plan sketch to mark up, one copy for every app (sykehus U3635, Morten 2026-10-26 11:51Z and 11:56Z: «a quick 2D plan of
   the proposed change with its key numbers and one button to build it; the person can draw pen strokes, drop pins with
   notes and write feedback; strokes and pins go back as a picture plus plan coordinates in metres»; 12:36Z «the system
   should be good at creating modules and re-using them»). hagekart and Fab take it later by the same lock.

   createSketch({ host, image, frame, title, legend, numbers, labels, colours, onSend, onBuild }) → { element, destroy() }
     image    the picture's address (a plan, north up, east right)
     frame    { centre: [east, north], k } where k is picture pixels to the metre, as the picture was drawn
              (look.js plan: k = (H / 2) / (dist * tan(fov / 2)); the picture's own size is read from the image)
     numbers  [{ label, value }] the key numbers (count, size, facing)
     labels   the app's words: { pen, pin, undo, clear, build, send, note, placeholder, empty }
     onSend({ text, drawing })   drawing = { image: JPEG data URL with the marks on it, strokes: [{ colour, points:
              [[east, north, 0], …] }], pins: [{ n, at: [east, north], note }] }; resolves true when it went
     onBuild()                   «Bygg det»
   toMetres(frame, size, [x, y]) and toPixels(frame, size, [e, n]) are the mapping, for the app's own tests.
   Classes (the app styles them): sk, sk-large (enlarged: the app makes it fill the screen), sk-stage, sk-legend, sk-nums, sk-tools, sk-sw, sk-dot, sk-pins, sk-feed, sk-act; the icon buttons are `button.icon` with a title.
   No three.js; plain DOM and a canvas. */
export const COLOURS = [["Rød", "#c8102e"], ["Blå", "#1f5fbf"], ["Svart", "#23211e"]];
export const toMetres = (frame, [W, H], [x, y]) => [frame.centre[0] + (x - W / 2) / frame.k, frame.centre[1] - (y - H / 2) / frame.k];
export const toPixels = (frame, [W, H], [e, n]) => [W / 2 + (e - frame.centre[0]) * frame.k, H / 2 - (n - frame.centre[1]) * frame.k];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const WORDS = { pen: "Penn", pin: "Nål", undo: "Angre", clear: "Tøm", big: "Større", small: "Mindre", build: "Bygg det", send: "Send tilbakemelding", note: "Merknad", placeholder: "Skriv hva som skal endres", empty: "Tegn, sett en nål eller skriv." };
const ICON = {   // 24 px line icons; the app's button styles do the rest
  pen: '<path d="M4 20l4-1 11-11-3-3L5 16z"/><path d="M14 6l3 3"/>', pin: '<path d="M12 21s-6-5.6-6-10.5a6 6 0 0112 0C18 15.4 12 21 12 21z"/><circle cx="12" cy="10.5" r="2.2"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 010 10h-3"/>', clear: '<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>',
  big: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>', small: '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>' };
const icon = k => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON[k]}</svg>`;

export function createSketch({ host, image, frame, title = "", legend = "", numbers = [], labels = {}, colours = COLOURS, onSend, onBuild }) {
  const L = { ...WORDS, ...labels }, el = document.createElement("figure"); el.className = "sk";
  const tip = (k, c = "") => `class="icon ${c}" title="${esc(L[k])}" aria-label="${esc(L[k])}"`;
  el.innerHTML = `<figcaption>${esc(title)}</figcaption>
    <div class="sk-stage"><img alt="${esc(title)}" draggable="false"><canvas aria-label="${esc(L.pen)}"></canvas></div>
    ${legend ? `<p class="sk-legend"><i></i>${esc(legend)}</p>` : ""}
    ${numbers.length ? `<dl class="sk-nums">${numbers.map(n => `<div><dt>${esc(n.label)}</dt><dd>${esc(n.value)}</dd></div>`).join("")}</dl>` : ""}
    <div class="sk-tools"><button type="button" ${tip("pen", "sk-mode")} data-m="pen" aria-pressed="true">${icon("pen")}</button><button type="button" ${tip("pin", "sk-mode")} data-m="pin" aria-pressed="false">${icon("pin")}</button>
      <span class="sk-sw">${colours.map(([n, c], i) => `<button type="button" class="sk-dot" data-c="${c}" title="${esc(n)}" aria-label="${esc(n)}" aria-pressed="${i === 0}"><i style="background:${c}"></i></button>`).join("")}</span>
      <button type="button" ${tip("undo", "sk-undo")}>${icon("undo")}</button><button type="button" ${tip("clear", "sk-clear")}>${icon("clear")}</button><button type="button" ${tip("big", "sk-big")}>${icon("big")}</button></div>
    <ol class="sk-pins"></ol>
    <textarea class="sk-feed" rows="2" placeholder="${esc(L.placeholder)}"></textarea>
    <div class="sk-act"><button type="button" class="sk-build pri">${esc(L.build)}</button><button type="button" class="sk-send">${esc(L.send)}</button><span class="sk-say" role="status"></span></div>`;
  host.append(el);
  const q = s => el.querySelector(s), img = q("img"), cv = q("canvas"), g = cv.getContext("2d"), list = q(".sk-pins"), say = q(".sk-say");
  const strokes = [], pins = []; let colour = colours[0][1], mode = "pen", cur = null;
  const size = () => [img.naturalWidth || 1024, img.naturalHeight || 640];
  const at = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * cv.width / r.width, (e.clientY - r.top) * cv.height / r.height]; };
  function paint(ctx = g, scale = 1) {
    const z = Math.max(1, cv.width / (cv.clientWidth || cv.width)) * scale;   // marks keep their size on screen, whatever the picture is shown at
    ctx.lineCap = ctx.lineJoin = "round"; ctx.lineWidth = 3 * z;
    for (const s of cur ? [...strokes, cur] : strokes) { ctx.strokeStyle = s.colour; ctx.beginPath(); s.points.forEach(([x, y], i) => i ? ctx.lineTo(x * scale, y * scale) : ctx.moveTo(x * scale, y * scale)); ctx.stroke(); }
    ctx.font = `bold ${14 * z}px sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    pins.forEach((p, i) => { ctx.fillStyle = p.colour; ctx.beginPath(); ctx.arc(p.x * scale, p.y * scale, 11 * z, 0, 7); ctx.fill(); ctx.fillStyle = "#fff"; ctx.fillText(String(i + 1), p.x * scale, p.y * scale + 1); });
  }
  const redraw = () => { g.clearRect(0, 0, cv.width, cv.height); paint(); };
  const fit = () => { const [W, H] = size(); cv.width = W; cv.height = H; redraw(); };
  img.onload = fit; img.src = image;
  const note = () => { list.innerHTML = ""; pins.forEach((p, i) => { const li = document.createElement("li"); li.innerHTML = `<b>${i + 1}</b><input type="text" maxlength="200" aria-label="${esc(L.note)} ${i + 1}" placeholder="${esc(L.note)}">`; li.querySelector("input").value = p.note; li.querySelector("input").oninput = e => { p.note = e.target.value; }; list.append(li); }); };
  cv.style.touchAction = "none";
  cv.onpointerdown = e => {
    const [x, y] = at(e);
    if (mode === "pin") { if (pins.length >= 12) return; pins.push({ x, y, colour, note: "" }); note(); redraw(); list.lastChild?.querySelector("input").focus({ preventScroll: true }); return; }
    cv.setPointerCapture(e.pointerId); cur = { colour, points: [[x, y]] };
  };
  cv.onpointermove = e => { if (!cur) return; cur.points.push(at(e)); redraw(); };
  const end = () => { if (cur) { if (cur.points.length > 1) strokes.push(cur); cur = null; redraw(); } };
  cv.onpointerup = cv.onpointercancel = end;
  for (const b of el.querySelectorAll(".sk-mode")) b.onclick = () => { mode = b.dataset.m; for (const x of el.querySelectorAll(".sk-mode")) x.setAttribute("aria-pressed", x === b); cv.style.cursor = mode === "pin" ? "copy" : "crosshair"; };
  for (const b of el.querySelectorAll(".sk-dot")) b.onclick = () => { colour = b.dataset.c; for (const x of el.querySelectorAll(".sk-dot")) x.setAttribute("aria-pressed", x === b); };
  q(".sk-undo").onclick = () => { if (!strokes.length && pins.length) { pins.pop(); note(); } else strokes.pop(); redraw(); };
  q(".sk-clear").onclick = () => { strokes.length = pins.length = 0; note(); redraw(); };
  const big = q(".sk-big"), shut = e => { if (e.key === "Escape") toggle(false); };
  function toggle(on = !el.classList.contains("sk-large")) { el.classList.toggle("sk-large", on); big.innerHTML = icon(on ? "small" : "big"); big.title = big.ariaLabel = on ? L.small : L.big; document.body.classList.toggle("sk-open", on); (on ? addEventListener : removeEventListener)("keydown", shut); }
  big.onclick = () => toggle();
  q(".sk-build").onclick = () => onBuild?.();
  q(".sk-send").onclick = async () => {
    const text = q(".sk-feed").value.trim(); if (!text && !strokes.length && !pins.length) { say.textContent = L.empty; return; }
    const [W, H] = size(), s = Math.min(1, 1280 / W), out = document.createElement("canvas"); out.width = Math.round(W * s); out.height = Math.round(H * s);
    const o = out.getContext("2d"); o.drawImage(img, 0, 0, out.width, out.height); paint(o, s);
    const step = pts => { const k = Math.max(1, Math.ceil(pts.length / 40)); return pts.filter((_, i) => i % k === 0 || i === pts.length - 1); };
    const round = v => Math.round(v * 10) / 10, m = ([x, y]) => toMetres(frame, [W, H], [x, y]).map(round);
    const drawing = { image: out.toDataURL("image/jpeg", 0.85), strokes: strokes.map(t => ({ colour: colours.find(c => c[1] === t.colour)?.[0].toLowerCase() || t.colour, points: step(t.points).map(p => [...m(p), 0]) })),
      pins: pins.map((p, i) => ({ n: i + 1, at: m([p.x, p.y]), note: p.note.trim() })) };
    const ok = await onSend?.({ text, drawing }); say.textContent = ok ? "" : say.textContent;
    if (ok) { strokes.length = pins.length = 0; q(".sk-feed").value = ""; note(); redraw(); }
  };
  return { element: el, destroy: () => { toggle(false); el.remove(); } };
}
