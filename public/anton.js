/* Signing in and Anton on the page, in Fab's layout (the Anton-first redlines §2.1, §2.3, §5). The person chip in the
   app bar signs in (the four digits Morten reads on the phone, login.mjs) and out; signed in, the pill talks to Anton
   (assistant.mjs). The conversation is the «Anton» tab. While that tab is shut the pill sits at the bottom of the view
   with Anton's newest reply and a waiting question above it; while it is open the pill moves into its bottom row, one
   pill, moved, never copied. «Tegn» is the pill's first button; what is picked in the model shows as chips (the kit's
   g-pick) and goes with the message.

   The pill and its behaviour are Fab's (atomstack hurricane/server/web/editor.html #talk-form, editor.js placePill,
   laser.css .pill .bstack .reply .talk-item, at c7759f3): one box with a round send button that turns into Stop while
   Anton works, the reply above, approval cards. Here it is Norwegian, for one person and one site.

   When Anton saves one of the person's versions the server says "steps": the page shows that version again, from the
   same place (after the reply is done, so nothing is cut off). */
import { pick } from "./kit/pick.js";
import { follow } from "./kit/follow.js";
import { toolLine } from "./toolline.js";
import { setMd } from "./md.js?v=20261027b";   // U3680: Anton's answers are markdown; the person's own lines stay plain
import { announces, matcher, isTry } from "./livetries.js";

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const SEND = `<svg viewBox="0 0 24 24" aria-hidden="true"><path class="f" d="M12 4.5 19 11.5 17.6 12.9 13 8.3V20h-2V8.3L6.4 12.9 5 11.5z"/></svg>`, STOP = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="1.5"/></svg>`;
const CODES = {
  unavailable: "Anton svarer ikke akkurat nå. Prøv igjen om et minutt.", timeout: "Anton sluttet å svare. Prøv igjen.",
  limit: "Mange meldinger på kort tid. Vent noen minutter.", busy: "Anton er opptatt. Meldingen din venter.",
  too_long: "Meldingen er for lang.", not_allowed: "Anton kan ikke gjøre det for deg.", approval_expired: "Spørsmålet gikk ut. Spør på nytt.",
  approval_unknown: "Spørsmålet er allerede besvart.", internal: "Noe gikk galt. Prøv igjen.",
};
const POSE = "sykehus-pose";
const json = (url, body) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) }).catch(() => null);

/* version(): the version the page has open now (a «Riv» can make one after the page loaded); refresh(): that version
   again, in place where it can be (app.js); showView(view): the page to a view Anton's show_building chose */
export async function start({ viewer, version, refresh, showView, panel, valg, tries = null }) {
  /* back from a redraw: the camera where it was */
  try { const p = JSON.parse(sessionStorage.getItem(POSE) || "null"); sessionStorage.removeItem(POSE); if (p) viewer.pose(p); } catch { }
  /* the tour counts the steps whose part is on the page when it opens: it waits for this (U3669: «1 av 4» at first, «1 av 5» from «?», for the «Logg inn» button came after) */
  const meReady = () => { window.sykehusMeReady = true; dispatchEvent(new Event("sykehus:me")); };
  const me = await fetch("api/meg").then(r => r.json()).catch(() => ({ person: null, login: false }));
  const chip = $("me");
  const unmark = () => { $("talk-form").hidden = true; $("talk-form").classList.remove("wait"); document.body.classList.remove("talk-on"); try { localStorage.removeItem("sykehus-anton"); } catch { } };   // early.js showed it waiting
  if (!me.person) {
    /* not signed in (U3662): no pill, no chips, only «Logg inn» in the bar, with the code in a dialog. The Bygg, Anton and Gjengi tabs are not there at all (Morten
       2026-10-26 21:16Z «should not see greyed out anton, bygg or gjengi tabs … keep it as simple and anonymous»; this replaces the greyed tabs of U3677); a page
       that opens on one of them falls back to Forslag, the one tab left */
    unmark(); document.body.classList.add("anon");
    for (const id of ["tab-photo", "tab-selected", "tab-chat"]) $(id).hidden = true;
    $("dock").style.setProperty("--tabs", "1");
    panel.show("changes", { quiet: true });
    if (me.login) { chip.innerHTML = `<button type="button" class="me" id="meBtn"><i></i>Logg inn</button>`; chip.hidden = false; import("./login.js").then(m => m.startLogin({ button: $("meBtn") })).catch(e => console.error("login:", e)); }
    meReady();   // the bar has its «Logg inn»: the tour can count its steps (U3669)
    return;
  }
  document.body.classList.remove("anon");
  $("tab-photo").hidden = false;   // Gjengi costs money: only for a signed-in person (U3663)
  chip.innerHTML = `<button type="button" class="me" id="meBtn" aria-haspopup="true" aria-expanded="false" title="Logget inn som ${esc(me.person)}"><i></i>${esc(me.person)}</button>`;
  chip.hidden = false; chip.style.position = "relative";
  meReady();   // the person's chip is in the bar (U3669)
  if (me.via !== "gulden.no") {   // signed in on gulden.no: signed out there, not here
    const menu = document.createElement("div"); menu.className = "g-menu me-menu"; menu.setAttribute("role", "menu"); menu.hidden = true;
    menu.innerHTML = `<button type="button" role="menuitem" id="meOut">Logg ut</button>`; chip.append(menu);
    $("meBtn").onclick = () => { menu.hidden = !menu.hidden; $("meBtn").setAttribute("aria-expanded", String(!menu.hidden)); if (!menu.hidden) $("meOut").focus(); };
    $("meOut").onclick = async () => { await json("api/logg-ut"); location.reload(); };
    addEventListener("pointerdown", e => { if (!chip.contains(e.target)) { menu.hidden = true; $("meBtn").setAttribute("aria-expanded", "false"); } });
    menu.addEventListener("keydown", e => { if (e.key === "Escape") { menu.hidden = true; $("meBtn").focus(); } });
  }
  if (me.anton) talk(); else { unmark(); $("talk-empty").hidden = true; const t = $("talkLogin"); t.hidden = false; t.innerHTML = `<p class="mut">Anton er ikke koblet til ennå. Du kan se alt, og sende Morten en tilbakemelding.</p>`; }

  function talk() {
    document.body.classList.add("talk-on");
    const form = $("talk-form"), log = $("talkLog"), input = $("talkIn"), btn = $("talkSend"), busy = $("talkBusy");
    form.hidden = false; try { localStorage.setItem("sykehus-anton", "1"); } catch { }
    const replies = new Map(), told = new Set();
    let running = null, redraw = false, waiting = 0, unread = 0, asking = 0;
    const seen = new Set();   // the turns the stream has shown taken
    const chatOpen = () => panel.tab === "chat" && panel.open();
    /* the log follows its end while the person is at it, and lets go when they scroll up; the pill «Til nyeste» takes them back
       (kit/follow.js, U3830). Growth is seen by the kit (a streamed chunk, a picture, a card opening), so only an act that must
       show (the person's own message, a question that needs a yes, the tab opening) asks for the end */
    const fol = follow(log, { label: "Til nyeste", host: $("talk") }), toEnd = () => fol.toEnd();
    /* U3685 (Morten 18:28Z «the chat blocks most of the 3d view»): the conversation lives in the «Anton» tab only. Over the view stay the pill and
       one thin line: the step while Anton works, then the answer's first sentence with «Les mer», which opens the tab. */
    /* the pill where the chat is: in the tab's bottom row while it shows, else at the bottom of the view */
    let wasOpen = false;
    function placePill() {
      const open = chatOpen(), to = open ? $("chat-pill") : $("bstack");   // U3833: open, the panel holds the pill (wide or phone); shut, or another tab, it is over the view
      document.body.classList.toggle("pill-chat", open);
      if (form.parentElement !== to) { const f = document.activeElement === input; to.append(form); if (f) input.focus(); }
      if (open) { unread = 0; }
      showReply(); if (chatOpen() !== wasOpen) { wasOpen = chatOpen(); if (wasOpen) toEnd(); }   // the tab opening shows the end; later panel events leave a reader where they are
      words();
      panel.badge("chat", asking ? "!" : unread || 0);
    }
    addEventListener("sykehus:panel", placePill);
    /* the line over the pill: «Arbeider … <step>» while a turn runs, else the first sentence of Anton's newest answer and «Les mer» (the
       answer is kept whole in `answer`; the tab holds it rendered). A waiting question shows above it. */
    let answer = "", failed = false, lastStep = "";
    const firstSentence = md => { const t = String(md).replace(/```[\s\S]*?```/g, " ").replace(/^\s*(#{1,6}|[-*>]|\d+[.)])\s+/gm, "").replace(/[*_`]|\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\s+/g, " ").trim(); const m = t.match(/^.*?[.!?](?=\s|$)/); return (m ? m[0] : t).slice(0, 160); };
    function said() { showReply(); }
    function showReply(text, plain) {
      if (text != null) { answer = text; failed = !!plain; $("reply-card").classList.toggle("err", failed); }
      const body = $("reply-body"), more = $("reply-more"), open = chatOpen();
      const line = running ? `Arbeider … ${lastStep || step || "Anton tenker"}` : firstSentence(answer);
      if (body.textContent !== line) body.textContent = line;
      more.hidden = !!running || !answer;
      $("reply-card").hidden = !line || open;   // the open tab shows the answer and the step itself (U3833: the pill is in it, so no line over the map)
      $("reply").hidden = open || ($("reply-card").hidden && !$("reply-cards").children.length);
    }
    $("view").addEventListener("pointerdown", () => { if (running) return; answer = ""; showReply(); });   // the model first: touching it puts the answer away
    $("reply-more").onclick = $("reply-card").onclick = () => { if (answer) panel.reveal("chat"); };
    /* «Ny samtale» stays for the signed-in person even when this page has drawn nothing: gulden-ai may hold a thread
       the history did not give back (21:23Z: not there on testperson's page) */
    function empty() { const has = log.children.length > 0; $("talk-empty").hidden = has; $("chat-top").hidden = false; }
    function line(cls, text, who, image, about) {
      const li = document.createElement("li"); li.className = "talk-item " + cls;
      if (who) li.append(Object.assign(document.createElement("span"), { className: "talk-who", textContent: who }));
      const b = document.createElement("div"); b.className = "talk-body";
      if (about) b.append(Object.assign(document.createElement("span"), { textContent: `Om ${about}`, className: "about" }));
      if (image) b.append(Object.assign(document.createElement("img"), { src: image, alt: "Tegningen", className: "snap" }));
      const t = document.createElement(cls === "from-asst" ? "div" : "span"); if (cls === "from-asst") { t.raw = text; setMd(t, text); } else t.textContent = text; b.append(t); li.append(b);
      log.append(li); empty(); if (cls === "from-me" || cls === "err") toEnd();
      /* a failed turn shows in the pill's card too, not only in the tab (pm 21:20Z: the pill showed nothing) */
      if (cls === "err") showReply(text, true);
      return t;
    }
    /* while a turn runs (U3564, Morten 22:01Z «the red stop button … should animate to indicate anton is working.
       waits can get a bit worryingly long for an unexperienced user»): the stop button breathes (sykehus.css), and the
       line under the text says the step in plain words, from the tool events, and after 10 s how long it has been */
    const STEP = { look: "Ser på bygget", try_change: "Prøver endringen", undo_change: "Angrer en endring", show_building: "Viser deg bygget", show_draft: "Ser på forslaget",
      about_site: "Leser om tomta", about_wing: "Leser om fløyen", storeys: "Leser etasjene", floor_plan: "Leser plantegningen", openings: "Ser på fasadetegningen",
      search_documents: "Leter i dokumentene", read_document: "Leser et dokument", list_documents: "Leter i dokumentene", list_versions: "Ser på forslagene",
      new_version: "Lagrer forslaget", rename_version: "Lagrer navnet", set_sharing: "Endrer delingen", search_plants: "Leter etter planter" };
    let step = "", since = 0, ticking = null, turnOf = null;
    const stepOf = key => STEP[String(key || "").split(/[.:/]/).pop()] || "Arbeider";
    function state() {
      btn.innerHTML = running ? STOP : SEND; btn.className = "round " + (running ? "stop working" : "send");
      btn.title = running ? "Stopp (Anton arbeider)" : "Send"; btn.setAttribute("aria-label", running ? "Stopp, Anton arbeider" : "Send");
      if (running && turnOf !== running) { turnOf = running; step = ""; since = Date.now(); }
      if (!running) { turnOf = null; step = ""; }
      if (running && !ticking) ticking = setInterval(state, 1000); else if (!running && ticking) { clearInterval(ticking); ticking = null; }
      const s = Math.round((Date.now() - since) / 1000), time = s >= 10 ? ` · ${s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`}` : "";
      showReply();
      const text = running ? `${step || "Anton tenker"} …${time}${waiting ? ` (${waiting} venter)` : ""}` : "";
      if (busy.textContent !== text) busy.textContent = text;
    }
    /* the chips: what is picked goes with the message (Fab's pill-about, as the kit's g-pick) */
    const chips = pick($("talkPick"), { lead: "Valgt:", items: [], removeLabel: l => `Ta bort ${l}`, removeTitle: "Ta bort fra spørsmålet", more: n => `+${n} til`, onRemove: k => valg.remove(k), onClear: () => valg.clear() });
    const onPicks = () => { const items = valg.items; chips.set(items.map(i => ({ id: valg.key(i), label: i.label }))); words(); };
    /* the placeholder: what is picked, and in the narrow tab the short one, so it shows whole */
    const words = () => { input.placeholder = valg.items.length ? (chatOpen() ? "Spør om det valgte" : "Spør Anton om det du har valgt") : chatOpen() ? "Spør Anton" : "Spør Anton, eller be ham vise noe"; };
    addEventListener("sykehus:valg", onPicks); onPicks();
    addEventListener("sykehus:ask", () => { placePill(); input.focus(); });
    input.addEventListener("keydown", e => { if (e.key === "Escape" && valg.items.length) { e.stopPropagation(); valg.clear(); } });
    $("talkNew").onclick = async () => {
      /* one request id for the click and its retry (gulden-ai's /new-chat is idempotent by it); a server restarting
         answers 502 or nothing for a moment (U3623, 10:39Z: the click fell in a restart and the old turns stayed) */
      const rid = `ny-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      let r = await json("api/anton/ny", { request_id: rid });
      if (!r || r.status === 502 || r.status === 503) { await new Promise(ok => setTimeout(ok, 2500)); r = await json("api/anton/ny", { request_id: rid }); }
      if (!r?.ok) { const j = r ? await r.json().catch(() => ({})) : {}; line("err", j.error === "signed_out" ? "Anton kan ikke svare akkurat nå. Prøv igjen senere." : j.error || CODES.unavailable); }
    };
    for (const s of document.querySelectorAll("#talkSugg [data-say]")) s.onclick = () => { input.value = s.dataset.say; sendIt(); };
    input.oninput = () => { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 118) + "px"; };
    input.onkeydown = e => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendIt(); } };
    /* «Nytt forslag» (nytt-forslag.js) hands over its first turn here: the text goes in as if typed, then is sent */
    document.addEventListener("sykehus:anton-say", e => { if (e.detail?.text) sendIt({ text: e.detail.text, ...(e.detail.point ? { point: e.detail.point } : {}) }); });
    form.onsubmit = e => { e.preventDefault(); if (running && !input.value.trim()) json("api/anton/stopp"); else sendIt(); };
    async function sendIt(drawn) {
      const text = drawn ? drawn.text : input.value.trim(); if (!text) return false;
      const sel = valg.forMessage();
      const r = await json("api/anton", { text, version: version(), ...(drawn?.point ? { point: drawn.point } : {}), ...(drawn?.drawing ? { drawing: drawn.drawing } : {}), ...(sel ? { selection: sel } : {}) });
      if (r?.status === 401) { signedOut(); return false; }
      if (!r?.ok) { const j = r ? await r.json().catch(() => ({})) : {}; line("err", j.error || CODES.unavailable); return false; }
      if (!drawn) { input.value = ""; input.oninput(); }
      /* the stream must show the turn taken (queued or running); else the text comes back with a word (pm 21:31Z: the
         first message after load went away and reached no one) */
      const { id } = await r.json().catch(() => ({})); if (id && !seen.has(id)) setTimeout(() => { if (seen.has(id)) return; line("err", "Fikk ikke bekreftet at Anton fikk meldingen; den står i feltet igjen om du vil sende den på nytt."); if (!input.value.trim() && !drawn) { input.value = text; input.oninput(); } }, 8000);
      lastStep = ""; said(); panel.reveal("chat"); return true;   // the answer comes in the tab: it opens now (a phone: the sheet at half height)
    }
    $("talkTegn").onclick = () => import("./tegn.js?v=20261025b").then(m => m.startDrawing({ viewer, labels: viewer.labels, host: $("stage"), send: (text, drawing) => sendIt({ text, drawing }) }));
    let gone = false;
    /* U3668: an Anton refusal (401: a device gulden-ai does not know, a revoked one, a restart) says so and leaves the page
       signed in: it never logs the person out of sykehus or reloads (pm 16:13Z); the line shows once a half minute */
    function signedOut() { if (gone) return; gone = true; setTimeout(() => { gone = false; }, 30000); line("err", "Anton kan ikke svare akkurat nå. Prøv igjen senere."); }
    /* a question that needs a yes: in the log, and over the pill while the chat is shut; either answers both */
    function card(a) {
      const make = () => { const li = document.createElement("li"); li.className = "talk-item card";
        li.innerHTML = `<div class="talk-body"><b>${esc(a.summary || "Anton vil gjøre noe som trenger ditt ja.")}</b></div><div class="cnote">Du kan angre i «Forslag».</div><div class="asst-row"><button type="button" class="ckeep">Ikke nå</button><button type="button" class="go">Ja, gjør det</button></div>`; return li; };
      const copies = [make(), make()]; log.append(copies[0]); $("reply-cards").replaceChildren(copies[1]); empty(); toEnd();
      asking++; placePill(); showReply(); if (!chatOpen()) copies[1].querySelector(".ckeep").focus({ preventScroll: true });
      const answer = async d => {
        for (const c of copies) for (const b of c.querySelectorAll("button")) b.disabled = true;
        const r = await json("api/anton/godkjenn", { approval_id: a.id, decision: d });
        for (const c of copies) c.querySelector(".asst-row").textContent = r?.ok ? (d === "accept" ? "Ja." : "Ikke nå.") : "Fikk ikke svart.";
        asking = Math.max(0, asking - 1); setTimeout(() => { copies[1].remove(); showReply(); }, 1200); placePill();
      };
      for (const c of copies) { c.querySelector(".go").onclick = () => answer("accept"); c.querySelector(".ckeep").onclick = () => answer("reject"); }
    }
    /* a one-time sign-in link for another machine (U3539), as a QR to scan with it: big, on white, gone when it runs out */
    function qrCard(q) {
      const li = document.createElement("li"); li.className = "talk-item card qr";
      li.innerHTML = `<div class="talk-body"><b>${esc(q.label)}</b></div><div class="qr-box"></div><div class="cnote">Pek kameraet på iPaden mot ruten, og trykk på lenken som kommer opp. Koden virker én gang, i ${q.minutes} minutter.</div>${/^\d{4}$/.test(q.code) ? `<div class="cnote qr-code">Eller skriv fire sifre i appen: <b>${q.code}</b>. Åpne appen, trykk «Logg inn» og skriv dem. Samme regel: én gang, ${q.minutes} minutter.</div>` : ""}`;
      import("./vendor/qrcode.js").then(({ default: qrcode }) => {
        const c = qrcode(0, "M"); c.addData(q.url); c.make();
        const n = c.getModuleCount(), q4 = n + 8, svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"), d = [];
        for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (c.isDark(r, k)) d.push(`M${k + 4} ${r + 4}h1v1h-1z`);
        svg.setAttribute("viewBox", `0 0 ${q4} ${q4}`); svg.setAttribute("role", "img"); svg.setAttribute("aria-label", "Kode for å logge inn på en annen maskin");
        svg.innerHTML = `<rect width="${q4}" height="${q4}" fill="#fff"/><path fill="#000" d="${d.join("")}"/>`;
        li.querySelector(".qr-box").append(svg);
      });
      log.append(li); empty(); panel.reveal("chat"); toEnd();
      setTimeout(() => { li.querySelector(".qr-box").replaceChildren(); li.querySelectorAll(".cnote").forEach((n, i) => i ? n.remove() : n.textContent = "Koden er gått ut. Be Anton om en ny."); }, q.minutes * 60e3);
    }
    function goTo(id, title) {
      const li = document.createElement("li"); li.className = "talk-item tool";
      li.innerHTML = `<div class="talk-body">Anton har tegnet i «${esc(title || "versjonen")}». <a href="?versjon=${encodeURIComponent(id)}">Vis den</a></div>`; log.append(li); empty();
    }

    const sketchShown = new Set();   // the plans on the page by id (a reload and the stream both bring one)
    // the history first, then live
    const fromHistory = () => fetch("api/anton/historikk").then(r => r.status === 401 ? signedOut() : r.json()).then(h => {
      if (!h) return null;
      log.textContent = ""; replies.clear(); sketchShown.clear();
      for (const it of h.items || []) {
        if (it.type === "message") line(it.from === "assistant" ? "from-asst" : "from-me", it.text, it.from === "assistant" ? "Anton" : null);
        else if (it.type === "tool") line("tool", toolLine(it));
        else if (it.type === "qr_done") line("tool", "Innloggingskode vist");
      }
      empty(); return h;
    }).then(async h => { if (h) await fetch("api/skisser").then(r => r.ok ? r.json() : null).then(j => (j?.sketches || []).reduce((p, x) => p.then(() => sketchCard(x)), Promise.resolve())).catch(() => {}); return h; }).catch(() => null);   // the plans Anton showed come back with the thread (U3635)
    fromHistory();
    const es = new EventSource("api/anton/strom");
    /* U3622 (10:39Z): the stream broke under a turn (the server restarted: ERR_HTTP2_PROTOCOL_ERROR), so its words and
       its «done» never came, though the answer was in the thread. When the stream is back, the chat is drawn again from
       the thread, the last answer goes on the card, and the version is shown again (the turn may have changed it) */
    let dropped = false;
    es.addEventListener("error", () => { if (es.readyState !== EventSource.OPEN) dropped = true; });
    es.addEventListener("open", async () => {
      if (!dropped) return; dropped = false;
      const h = await fromHistory(); if (!h) return;
      const last = (h.items || []).filter(it => it.type === "message").at(-1);
      if (last?.from === "assistant") showReply(last.text);
      if (!h.queue?.running) { redraw = false; refresh(); }
    });
    const on = (ev, f) => es.addEventListener(ev, e => { if (e.data == null) return; try { f(JSON.parse(e.data)); } catch (x) { console.error(x); } });   // the stream's own "error" (a reconnect) has no data
    on("queue", q => { for (const x of [q.running, ...q.waiting]) if (x) seen.add(x.id); running = q.running?.id ?? null; waiting = q.waiting.length; state(); });
    on("message", m => { seen.add(m.id); line("from-me", m.text, null, m.image, m.about); lastStep = ""; said(); });
    on("text", t => {
      let b = replies.get(t.reply_to); if (!b) { b = line("from-asst", "", "Anton"); replies.set(t.reply_to, b); if (!chatOpen()) unread++; }
      b.raw += t.delta || ""; setMd(b, b.raw); if (step !== "Skriver svaret") { step = "Skriver svaret"; state(); } showReply(b.raw); panel.badge("chat", asking ? "!" : unread);
    });
    /* U3670: each try shows in the 3D view as a ghost at once and as a small picture on its row; a tap on it takes the camera back there */
    const tryRows = matcher((el, t) => {
      const li = el.closest("li"); if (!li || li.querySelector(".try-thumb")) return;
      const b = document.createElement("button"); b.type = "button"; b.className = "try-thumb"; b.title = "Gå tilbake til dette synet"; b.setAttribute("aria-label", "Gå tilbake til dette synet");
      const img = document.createElement("img"); img.src = t.thumb; img.alt = "Slik så det ut da Anton prøvde endringen"; b.append(img); b.onclick = () => tries?.back(t.pose); li.append(b);
    });
    let liveChain = Promise.resolve();
    const liveTry = () => { liveChain = liveChain.then(async () => { const r = await tries.run().catch(() => null); if (r) tryRows.thumb(r); else redraw = true; }); };
    on("tool", t => { if (t.label) { const el = line("tool", toolLine(t)); lastStep = toolLine(t); if (isTry(t.key)) tryRows.row(el); } step = stepOf(t.key); state(); });
    /* U3635: a plan Anton shows before he builds (propose_sketch): the picture to mark up (renderkit's sketch.js), «Bygg det»
       says so to Anton, the feedback goes as the drawing (the picture with the marks, strokes in metres) and the pins in words */
    async function sketchCard(s) {
      if (sketchShown.has(s.id)) return; sketchShown.add(s.id);
      const { createSketch } = await import("./renderkit/sketch.js"), li = document.createElement("li"); li.className = "talk-item card sketch"; log.append(li); empty();
      const m1 = v => String(Math.round(v * 10) / 10).replace(".", ",");
      createSketch({ host: li, image: s.url, frame: s.frame, title: s.title, legend: s.legend, numbers: s.numbers,
        onBuild: async () => { const b = li.querySelector(".sk-build"); b.disabled = true; if (await sendIt({ text: `Bygg det: ${s.title}` })) { li.querySelector(".sk-say").textContent = "Sendt til Anton."; fetch(`api/skisse/${s.id}/sendt`, { method: "POST" }).catch(() => { }); } else b.disabled = false; },
        onSend: async ({ text, drawing }) => {
          const pins = drawing.pins.map(p => `Nål ${p.n} (øst ${m1(p.at[0])}, nord ${m1(p.at[1])} m)${p.note ? `: ${p.note}` : ""}`);
          const { pins: _p, ...draw } = drawing;
          return sendIt({ text: [`Tilbakemelding på skissen «${s.title}»${text ? `: ${text}` : "."}`, ...pins].join("\n"), drawing: { ...draw, camera: {}, mode: "plan", size: s.size } });
        } });
      if (s.sent) { li.querySelector(".sk-say").textContent = "Sendt til Anton."; li.querySelector(".sk-build").disabled = true; }   // after a reload (U3661)
    }
    on("sketch", sketchCard);
    on("approval", card);
    on("qr", qrCard);
    on("error", e => line("err", CODES[e.code] || CODES.internal));
    on("done", () => {
      liveChain.then(() => { tries?.end(); tryRows.reset(); });
      if (redraw) { redraw = false; refresh(); }
      /* the reply came while this page was not listening (a reload mid-turn): the card takes it from the history
         (21:23Z: the section turn's answer was in the thread, the card empty) */
      showReply();
      if (!answer) fetch("api/anton/historikk").then(r => r.ok ? r.json() : null).then(h => {
        const last = (h?.items || []).filter(it => it.type === "message").at(-1);
        if (last?.from === "assistant" && !answer) showReply(last.text);
      }).catch(() => {});
    });
    /* Anton saved a version: the one open is shown again (in place when it can be), another gets a link */
    on("steps", s => { dispatchEvent(new CustomEvent("sykehus:versjoner")); if (s.version === version()) { if (running) { if (tries) liveTry(); else redraw = true; } else refresh(); } else if (announces(s) && !told.has(s.version)) { told.add(s.version); goTo(s.version, s.title); } });
    /* «vis meg»: show_building through the pill moves this page (mcp.mjs, assistant.mjs pages.show) */
    on("show", v => { if (/^v.{8}$/.test(v.draft || "")) { v = { ...v, version: v.draft }; delete v.draft; }   // a version's id is a version (21:05Z)
      if (v.version && v.version !== version() || v.draft) { try { sessionStorage.setItem(POSE, JSON.stringify(viewer.pose())); } catch { } location.assign(v.draft ? `./?utkast=${encodeURIComponent(v.draft)}` : `./?versjon=${encodeURIComponent(v.version)}${v.key ? `&nokkel=${encodeURIComponent(v.key)}` : ""}`); } else showView(v); });
    on("signed_out", signedOut);
    on("cleared", () => { log.textContent = ""; replies.clear(); answer = ""; showReply(); empty(); });
    placePill(); state(); empty();
    /* ready: what was typed while the page loaded (early.js) goes now */
    form.classList.remove("wait"); btn.disabled = false; words(); state(); if (form.dataset.queued) { delete form.dataset.queued; const go = () => { busy.textContent = ""; sendIt(); }; if (es.readyState === EventSource.OPEN) go(); else es.addEventListener("open", go, { once: true }); }   // once the stream listens, so the page sees its own turn
  }
}
