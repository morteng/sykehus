/* /inn/#<token>: the one-time link Anton shows as a QR on another machine (U3539, gulden-ai's sykehus_sign_in_link).
   The token is in the fragment, so no server log or Referer carries it; the page takes it and clears the address at
   once, and spends it only on the tap, so a link preview or a prefetch costs nothing. The tap posts it to
   /api/logg-inn {link, device} (login.mjs), which asks gulden-ai and sets the 90-day cookie as after a code. */
const $ = id => document.getElementById(id);
const token = location.hash.slice(1);
history.replaceState(null, "", location.pathname);
const device = /iPad|iPhone/.test(navigator.userAgent) || navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent) ? "iPad/iPhone" : /Mac/.test(navigator.userAgent) ? "Mac" : /Windows/.test(navigator.userAgent) ? "Windows" : "nettleser";

if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) {
  $("say").textContent = "Denne siden åpnes fra koden Anton viser. Be Anton om en ny kode, og skann den med denne maskinen.";
  $("on").hidden = false;
} else {
  $("say").textContent = "Anton har sendt deg hit fra en annen maskin.";
  $("go").hidden = false; $("go").focus();
  $("go").onclick = async () => {
    $("go").disabled = true; $("err").textContent = "";
    let r, j = {};
    try { r = await fetch("../api/logg-inn", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ link: token, device }) }); j = await r.json().catch(() => ({})); }
    catch { $("err").textContent = "Fikk ikke kontakt. Prøv igjen om litt."; $("go").disabled = false; return; }
    if (!r.ok) { $("err").textContent = j.error || "Det gikk ikke."; $("go").hidden = true; $("on").hidden = false; return; }
    $("go").hidden = true;
    $("say").textContent = j.name ? `Velkommen, ${j.name}. Maskinen husker deg i tre måneder.` : "Du er logget inn. Maskinen husker deg i tre måneder.";
    $("on").hidden = false; $("on").focus();
    setTimeout(() => location.replace("../"), 2500);
  };
}
