/* Signing in and Anton on the page. «Logg inn» on the title card asks for the four digits Morten reads on the phone
   (login.mjs); signed in, the pill at the bottom talks to Anton (assistant.mjs), and the conversation shows above it.
   The pill and its behaviour are laser's (atomstack hurricane/server/web/lobbychat.js and laser.css .pill,
   2026-10-25): one box with a round send button that turns into Stop while Anton works, the history button, the reply
   growing above, approval cards. Here it is plainer, larger and Norwegian, for one person and one site.

   When Anton saves one of the person's versions the server says "steps": the page shows that version again, from the
   same place (after the reply is done, so nothing is cut off). */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const SEND = `<svg viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7"/></svg>`, STOP = `<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2" class="f"/></svg>`;
const HIST = `<svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h10"/></svg>`;
const CODES = {
  unavailable: "Anton svarer ikke akkurat nå. Prøv igjen om et minutt.", timeout: "Anton sluttet å svare. Prøv igjen.",
  limit: "Mange meldinger på kort tid. Vent noen minutter.", busy: "Anton er opptatt. Meldingen din venter.",
  too_long: "Meldingen er for lang.", not_allowed: "Anton kan ikke gjøre det for deg.", approval_expired: "Spørsmålet gikk ut. Spør på nytt.",
  approval_unknown: "Spørsmålet er allerede besvart.", internal: "Noe gikk galt. Prøv igjen.",
};
const POSE = "sykehus-pose";
const PEN = `<svg viewBox="0 0 24 24"><path d="M4 20l4-1 11-11-3-3L5 16z"/><path d="M14 6l3 3"/></svg>`;
const TEGN = new URLSearchParams(location.search).has("tegn");   // hidden until the pill is live (ruling 2026-10-25 17:31Z)

export async function start({ viewer, versionId, info, closable, CLOSE }) {
  /* back from a redraw: the camera where it was */
  try { const p = JSON.parse(sessionStorage.getItem(POSE) || "null"); sessionStorage.removeItem(POSE); if (p) viewer.pose(p); } catch { }
  const me = await fetch("api/meg").then(r => r.json()).catch(() => ({ person: null, login: false }));
  const link = $("loginLink");
  if (!me.person && !me.login) return;
  $("me").hidden = false;
  if (!me.person) { link.onclick = e => { e.preventDefault(); askCode(); }; return; }
  if (me.via === "gulden.no") { link.textContent = `Logget inn som ${me.person}`; link.removeAttribute("href"); link.onclick = null; }   // signed out on gulden.no, not here
  else { link.textContent = `Logget inn som ${me.person} · Logg ut`; link.onclick = async e => { e.preventDefault(); await fetch("api/logg-ut", { method: "POST" }); location.reload(); }; }
  if (me.anton) pill(me.person);
  wishBox();

  /* «Ønsker»: what Sykehustomta cannot do yet, to Morten (wishes.mjs); your own, and for Morten all of them */
  function wishBox() {
    const btn = $("wishBtn"); btn.hidden = false;
    const ST = { ny: "ny", sett: "sett", laget: "laget", nei: "ikke nå" };
    btn.onclick = async () => {
      info.innerHTML = `${CLOSE}<h2>Ønsker</h2><p style="margin:2px 0 8px">Noe du vil at Sykehustomta skal kunne, men som ikke går ennå? Skriv det her, så ser Morten det.</p>
        <form id="wishForm"><textarea id="wishText" maxlength="4000" placeholder="For eksempel: Jeg vil kunne tegne et snitt gjennom drivhuset."></textarea>
        <div style="display:flex;gap:8px;align-items:center;margin-top:8px"><button type="submit" class="pri">Send</button><span id="wishOk" class="ok" role="status"></span></div></form>
        <p id="wishErr" class="err" role="alert"></p><ul class="wishes" id="wishList"></ul>`;
      info.style.display = "block"; closable(info); $("wishText").focus();
      $("wishForm").onsubmit = async e => {
        e.preventDefault(); $("wishErr").textContent = ""; $("wishOk").textContent = "";
        const r = await fetch("api/onsker", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: $("wishText").value, version: versionId }) }).catch(() => null);
        const j = r ? await r.json().catch(() => ({})) : {};
        if (r?.ok) { $("wishText").value = ""; $("wishOk").textContent = "Sendt. Morten ser det."; list(); } else $("wishErr").textContent = j.error || "Fikk ikke sendt. Prøv igjen.";
      };
      list();
    };
    async function list() {
      const j = await fetch("api/onsker").then(r => r.ok ? r.json() : { wishes: [] }).catch(() => ({ wishes: [] })), ul = $("wishList"); if (!ul) return;
      ul.innerHTML = j.wishes.length ? j.wishes.map(w => `<li>${esc(w.text)}<br><small>${j.admin ? esc(w.person) + " · " : ""}${new Date(w.at).toLocaleDateString("nb-NO")}</small>
        ${j.admin ? `<select data-id="${esc(w.id)}" aria-label="Status">${Object.entries(ST).map(([k, t]) => `<option value="${k}"${k === w.status ? " selected" : ""}>${t}</option>`).join("")}</select>` : `<span class="st ${esc(w.status)}">${ST[w.status] || esc(w.status)}</span>`}
        ${w.note ? `<br><small>Morten: ${esc(w.note)}</small>` : ""}</li>`).join("") : "";
      for (const s of ul.querySelectorAll("select")) s.onchange = () => fetch(`api/onsker/${encodeURIComponent(s.dataset.id)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: s.value }) });
    }
  }

  /* the four digits, big, in the card */
  function askCode() {
    info.innerHTML = `${CLOSE}<h2>Logg inn</h2><p style="margin:4px 0 10px">Skriv de fire sifrene du har fått på telefonen.</p>
      <form id="codeForm" autocomplete="off"><input id="code" inputmode="numeric" pattern="[0-9]*" maxlength="4" aria-label="Koden, fire sifre" autofocus>
      <button type="submit" class="pri">Logg inn</button></form><p id="codeErr" class="err" role="alert"></p>
      <p class="src">Maskinen husker deg i tre måneder. Uten innlogging kan du se alt, men ikke lagre.</p>`;
    info.style.display = "block"; closable(info);
    const code = $("code"); code.focus();
    code.oninput = () => { code.value = code.value.replace(/\D/g, "").slice(0, 4); if (code.value.length === 4) $("codeForm").requestSubmit(); };
    $("codeForm").onsubmit = async e => {
      e.preventDefault(); $("codeErr").textContent = "";
      const device = /Mac/.test(navigator.userAgent) ? "Mac" : /iPad|iPhone/.test(navigator.userAgent) ? "iPad/iPhone" : /Windows/.test(navigator.userAgent) ? "Windows" : "nettleser";
      const r = await fetch("api/logg-inn", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: code.value, device }) }).catch(() => null);
      const j = r ? await r.json().catch(() => ({})) : { error: "Fikk ikke kontakt." };
      if (r?.ok) return location.reload();
      $("codeErr").textContent = j.error || "Det gikk ikke."; code.value = ""; code.focus();
    };
  }

  function pill(person) {
    document.body.classList.add("anton");
    const box = document.createElement("div"); box.id = "anton";
    box.innerHTML = `<div id="talk" class="card" hidden><div class="talkhead"><button id="talkNew" class="link" title="Glem samtalen og begynn på nytt">Ny samtale</button></div><ol id="talkLog"></ol></div>
      <div class="pill card"><button class="hist" id="talkHist" title="Samtalen" aria-label="Vis samtalen">${HIST}</button>${TEGN ? `<button class="tegn" id="talkTegn" title="Tegn på et bilde av modellen">${PEN}Tegn</button>` : ""}
        <div class="pillmid"><div class="busy" id="talkBusy"></div><textarea id="talkIn" rows="1" placeholder="Spør Anton, eller be ham tegne …" aria-label="Melding til Anton"></textarea></div>
        <button class="round send" id="talkSend" title="Send" aria-label="Send">${SEND}</button></div>`;
    document.body.append(box);
    const log = $("talkLog"), talk = $("talk"), input = $("talkIn"), btn = $("talkSend"), busy = $("talkBusy");
    const replies = new Map(), told = new Set();
    let running = null, redraw = false, waiting = 0;
    const show = (on = true) => { talk.hidden = !on; if (on) talk.scrollTop = talk.scrollHeight; };
    function line(cls, text, who, image) {
      const li = document.createElement("li"); li.className = cls;
      if (who) li.append(Object.assign(document.createElement("b"), { textContent: who }));
      if (image) li.append(Object.assign(document.createElement("img"), { src: image, alt: "Tegningen", className: "drawn" }));
      const b = document.createElement("div"); b.textContent = text; li.append(b); log.append(li); show(); return b;
    }
    function state() {
      btn.innerHTML = running ? STOP : SEND; btn.className = "round " + (running ? "stop" : "send");
      btn.title = btn.ariaLabel = running ? "Stopp" : "Send";
      busy.textContent = running ? (waiting ? `Anton tenker … (${waiting} venter)` : "Anton tenker …") : "";
    }
    $("talkHist").onclick = () => show(talk.hidden);
    $("talkNew").onclick = async () => {
      const r = await fetch("api/anton/ny", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).catch(() => null);
      if (!r?.ok) { const j = r ? await r.json().catch(() => ({})) : {}; line("err", j.error === "signed_out" ? "Logg inn på nytt." : j.error || CODES.unavailable); }
    };
    $("view").addEventListener("pointerdown", () => show(false));   // the model first: touching it folds the talk away
    input.oninput = () => { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 118) + "px"; };
    input.onkeydown = e => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendIt(); } };
    btn.onclick = () => running && !input.value.trim() ? fetch("api/anton/stopp", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }) : sendIt();
    async function sendIt(drawn) {
      const text = drawn ? drawn.text : input.value.trim(); if (!text) return false;
      const r = await fetch("api/anton", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, version: versionId, ...(drawn ? { drawing: drawn.drawing } : {}) }) }).catch(() => null);
      if (r?.status === 401) { signedOut(); return false; }
      if (!r?.ok) { const j = r ? await r.json().catch(() => ({})) : {}; line("err", j.error || CODES.unavailable); return false; }
      if (!drawn) { input.value = ""; input.oninput(); }
      return true;
    }
    if (TEGN) $("talkTegn").onclick = () => import("./tegn.js").then(m => m.startDrawing({ viewer, labels: viewer.labels, send: (text, drawing) => sendIt({ text, drawing }) }));
    let gone = false;
    function signedOut() { if (gone) return; gone = true; if (me.via === "gulden.no") { line("err", "Anton kan ikke jobbe for denne innloggingen akkurat nå."); return; } fetch("api/logg-ut", { method: "POST" }).finally(() => location.reload()); }
    function card(a) {
      const li = document.createElement("li"); li.className = "ask";
      li.innerHTML = `<div>${esc(a.summary || "Anton vil gjøre noe som trenger ditt ja.")}</div><div class="acts"><button class="pri">Ja, gjør det</button><button>Nei</button></div>`;
      const [yes, no] = li.querySelectorAll("button");
      const answer = async d => { yes.disabled = no.disabled = true; const r = await fetch("api/anton/godkjenn", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ approval_id: a.id, decision: d }) }).catch(() => null);
        li.querySelector(".acts").textContent = r?.ok ? (d === "accept" ? "Ja." : "Nei.") : "Fikk ikke svart."; };
      yes.onclick = () => answer("accept"); no.onclick = () => answer("reject");
      log.append(li); show();
    }
    function redrawNow() { try { sessionStorage.setItem(POSE, JSON.stringify(viewer.pose())); } catch { } location.reload(); }
    function goTo(id, title) {
      const li = document.createElement("li"); li.className = "tool";
      li.innerHTML = `Anton har tegnet i «${esc(title || "versjonen")}». <a href="?versjon=${encodeURIComponent(id)}">Vis den</a>`; log.append(li); show();
    }

    // the history first, then live
    fetch("api/anton/historikk").then(r => r.status === 401 ? signedOut() : r.json()).then(h => {
      for (const it of h?.items || []) {
        if (it.type === "message") line(it.from === "assistant" ? "from-anton" : "from-me", it.text, it.from === "assistant" ? "Anton" : null);
        else if (it.type === "tool") line("tool", it.label);
      }
      if (!log.children.length) line("from-anton", "Hei! Jeg er Anton. Be meg rive bygg, legge til balkonger, tegne et drivhus eller noe annet på tomta, så tegner jeg det i en versjon du kan vise fram.", "Anton");
      show(false);
    }).catch(() => {});
    const es = new EventSource("api/anton/strom");
    const on = (ev, f) => es.addEventListener(ev, e => { if (e.data == null) return; try { f(JSON.parse(e.data)); } catch (x) { console.error(x); } });   // the stream's own "error" (a reconnect) has no data
    on("queue", q => { running = q.running?.id ?? null; waiting = q.waiting.length; state(); });
    on("message", m => line("from-me", m.text, null, m.image));
    on("text", t => { let b = replies.get(t.reply_to); if (!b) { b = line("from-anton", "", "Anton"); replies.set(t.reply_to, b); } b.textContent += t.delta || ""; show(); });
    on("tool", t => { if (t.label) line("tool", t.label); });
    on("approval", card);
    on("error", e => line("err", CODES[e.code] || CODES.internal));
    on("done", () => { if (redraw) redrawNow(); });
    on("steps", s => { if (s.version === versionId) { if (running) redraw = true; else redrawNow(); } else if (!told.has(s.version)) { told.add(s.version); goTo(s.version, s.title); } });
    on("signed_out", signedOut);
    on("cleared", () => { log.textContent = ""; replies.clear(); line("from-anton", "Ny samtale. Hva vil du gjøre med tomta?", "Anton"); });
  }
}
