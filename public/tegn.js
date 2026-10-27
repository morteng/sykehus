/* «Tegn»: draw on a picture of the model and send it to Anton (rulings 2026-10-25 17:24Z and 17:31Z; the frames in
   docs/design/tegn; in the Anton-first layout over the view only, the panel as it is). The view the person chose stands still as a picture; the pen draws on it (a finger does not, so
   the palm can rest; a mouse does, for the desk); words go in the box under it (iPadOS Scribble writes there).

   What goes to Anton: the picture with the drawing (JPEG, at most 1280 px wide), and each stroke as points on the
   site, [east, north, kote] in metres, found by casting from the screen into the model (viewer.hit), with the camera
   and the mode, so he can place a change where it was drawn. */
const COLOURS = [["Rød", "#c8102e"], ["Blå", "#1f5fbf"], ["Svart", "#23211e"]];
const $ = id => document.getElementById(id);
const UNDO = `<svg class="i" viewBox="0 0 24 24"><path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 010 10h-3"/></svg>`;
const SEND = `<svg class="i" viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7"/></svg>`;

/* opens the drawing over the page; send(text, drawing) hands it on, and resolves true when it went, else {error} with the reason (the window stays and shows it) */
export function startDrawing({ viewer, labels, send, host = document.body }) {
  const R = host.getBoundingClientRect(), W = host.clientWidth || innerWidth, H = host.clientHeight || innerHeight, picture = viewer.snapshot(), camera = viewer.pose(), mode = viewer.view().mode;
  const names = [...labels.children].filter(e => e.style.display !== "none").map(e => { const m = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(e.style.transform); return m && { x: +m[1], y: +m[2], w: e.offsetWidth, h: e.offsetHeight, text: e.innerText, big: e.style.fontWeight === "600" }; }).filter(Boolean);
  document.body.classList.add("tegner");
  const box = document.createElement("div"); box.id = "tegn";
  box.innerHTML = `<canvas id="tegnInk" aria-label="Tegneflaten"></canvas>
    <div id="tegnTools" class="card"><span class="lbl">Tegn med pennen</span>
      ${COLOURS.map(([n, c], i) => `<button class="dot" data-c="${c}" aria-label="${n}" aria-pressed="${i === 0}"><i style="background:${c}"></i></button>`).join("")}
      <span class="sep"></span><button id="tegnUndo">${UNDO}Angre</button><button id="tegnClear">Tøm</button><button id="tegnCancel">Avbryt</button></div>
    <form id="tegnSend" class="card"><textarea id="tegnText" rows="2" placeholder="Skriv hva du vil, med pennen eller tastaturet"></textarea>
      <p id="tegnErr" role="alert" hidden></p><button type="submit" class="pri">${SEND}Send til Anton</button></form>`;
  host.append(box);   // over the view only: the panel stays as it is
  const cv = $("tegnInk"), dpr = Math.min(2, devicePixelRatio || 1);
  cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + "px"; cv.style.height = H + "px";
  const g = cv.getContext("2d"), bg = new Image();
  const strokes = []; let colour = COLOURS[0][1], cur = null;
  function draw() {
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    if (bg.complete) g.drawImage(bg, 0, 0, W, H);
    for (const n of names) {   // the names as they stood over the picture
      g.fillStyle = "#fbf9f4e0"; g.fillRect(n.x, n.y, n.w, n.h); g.fillStyle = "#23211e";
      g.font = `${n.big ? 600 : 400} ${n.big ? 14 : 12}px -apple-system, "Helvetica Neue", Arial, sans-serif`; g.textBaseline = "top";
      n.text.split("\n").forEach((t, i) => g.fillText(t, n.x + (n.big ? 7 : 3), n.y + 2 + i * 14));
    }
    g.lineCap = g.lineJoin = "round";
    for (const s of cur ? [...strokes, cur] : strokes) {
      g.strokeStyle = s.colour; g.lineWidth = 5; g.beginPath();
      s.points.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); if (s.points.length === 1) g.lineTo(s.points[0][0] + 0.1, s.points[0][1]);
      g.stroke();
    }
  }
  bg.onload = draw; bg.src = picture;
  const drawsWith = e => e.pointerType === "pen" || e.pointerType === "mouse";
  cv.addEventListener("pointerdown", e => { if (!drawsWith(e)) return; e.preventDefault(); cv.setPointerCapture(e.pointerId); cur = { colour, points: [[e.clientX - R.left, e.clientY - R.top]] }; draw(); });
  cv.addEventListener("pointermove", e => {
    if (!cur || !drawsWith(e)) return;
    for (const p of e.getCoalescedEvents?.() || [e]) { const [x0, y0] = cur.points.at(-1), x = p.clientX - R.left, y = p.clientY - R.top; if (Math.hypot(x - x0, y - y0) >= 2) cur.points.push([x, y]); }
    draw();
  });
  const end = () => { if (cur) { strokes.push(cur); cur = null; draw(); } };
  cv.addEventListener("pointerup", end); cv.addEventListener("pointercancel", end);
  cv.addEventListener("touchmove", e => e.preventDefault(), { passive: false });   // a resting palm does not scroll or zoom the page
  for (const b of box.querySelectorAll(".dot")) b.onclick = () => { colour = b.dataset.c; for (const o of box.querySelectorAll(".dot")) o.setAttribute("aria-pressed", String(o === b)); };
  $("tegnUndo").onclick = () => { strokes.pop(); draw(); };
  $("tegnClear").onclick = () => { strokes.length = 0; draw(); };
  const close = () => { box.remove(); document.body.classList.remove("tegner"); };
  $("tegnCancel").onclick = close;
  addEventListener("keydown", function esc(e) { if (e.key === "Escape" && document.body.contains(box)) { close(); removeEventListener("keydown", esc); } });
  $("tegnSend").onsubmit = async e => {
    e.preventDefault();
    const text = $("tegnText").value.trim();
    if (!strokes.length && !text) return;
    const btn = e.submitter || $("tegnSend").querySelector("button"); btn.disabled = true;
    /* each stroke on the site: at most 40 points along it, each cast into the model; the sky gives nothing */
    const site = strokes.map(s => { const step = Math.max(1, Math.ceil(s.points.length / 40)); return { colour: COLOURS.find(c => c[1] === s.colour)?.[0].toLowerCase() || s.colour, points: s.points.filter((_, i) => i % step === 0 || i === s.points.length - 1).map(([x, y]) => viewer.hit(x + R.left, y + R.top)).filter(Boolean) }; });
    const out = document.createElement("canvas"), k = Math.min(1, 1280 / W); out.width = Math.round(W * k); out.height = Math.round(H * k);
    out.getContext("2d").drawImage(cv, 0, 0, out.width, out.height);
    const image = out.toDataURL("image/jpeg", 0.82);
    const err = $("tegnErr"); err.hidden = true;
    let ok; try { ok = await send(text || "Se tegningen.", { image, strokes: site, camera, mode, size: [W, H] }); } catch (x) { console.error(x); ok = { error: "Noe gikk galt. Prøv igjen." }; }
    if (ok === true) close();   // sent: the picture is in the chat line now
    else { btn.disabled = false; err.textContent = ok?.error || "Tegningen ble ikke sendt. Prøv igjen."; err.hidden = false; }   // it stays, with the reason
  };
}
