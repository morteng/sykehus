/* The pill before the page is up (pm 21:41Z: a reload's first ~17 s, the pill not yet there or not yet listening, and
   a message typed then was lost). For one who had Anton here before (anton.js keeps the mark), the pill shows at once
   as waiting: what is typed stays, Return keeps it to be sent, and anton.js sends it when it is ready. Never a native
   submit (that would reload the page and lose the text). */
(() => {
  const f = document.getElementById("talk-form"), t = document.getElementById("talkIn"), b = document.getElementById("talkSend"), busy = document.getElementById("talkBusy");
  if (!f || !t) return;
  const keep = () => { if (!t.value.trim()) return; f.dataset.queued = "1"; busy.textContent = "Sendes når Anton er klar …"; };
  f.addEventListener("submit", e => { if (f.classList.contains("wait")) { e.preventDefault(); keep(); } });
  let had = false; try { had = localStorage.getItem("sykehus-anton") === "1"; } catch { }
  if (!had) { document.body.classList.add("anon"); return; }   // never signed in here: no Anton until anton.js has asked (U3662)
  /* not ready, where it is looked at (pm 21:53Z: the placeholder still said «Spør Anton»): the field, the line under it
     (a status, read out) and the button's name */
  f.hidden = false; f.classList.add("wait"); document.body.classList.add("talk-on");   // talk-on: its width, as anton.js gives it
  t.placeholder = "Anton lastes … skriv gjerne, det sendes når han er klar";
  if (b) { b.disabled = true; b.title = "Anton lastes …"; b.setAttribute("aria-label", "Anton lastes"); }
  busy.setAttribute("aria-live", "polite"); busy.textContent = "Anton lastes …";
  t.addEventListener("keydown", e => { if (f.classList.contains("wait") && e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); keep(); } });
})();
