/* «Logg inn» (U3662, Morten 14:58Z «if you are not logged in, you don't see anton pill or tab at all. but you do see a logg in button
   that gives a modal where dad can enter his code he gets from me (4 digit)»): the bar's button opens the kit's dialog (kit/modal.js)
   with one field for the four digits. At the fourth digit it goes to POST api/logg-inn (login.mjs: gulden-ai checks the code, this
   server sets its cookie); the server's own sentence says what is wrong, also how long to wait. On success the page loads again as
   the person, with Anton, and says so once. */
import { modal } from "./kit/modal.js";

export const FLAG = "sykehus-innlogget";
const device = () => /Mac/.test(navigator.userAgent) ? "Mac" : /iPad|iPhone/.test(navigator.userAgent) ? "iPad/iPhone" : /Windows/.test(navigator.userAgent) ? "Windows" : "nettleser";

/** Send the code: {ok:true, person} or {ok:false, error} in the server's words. */
export async function signIn(code, fetchImpl = fetch) {
  let r; try { r = await fetchImpl("api/logg-inn", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, device: device() }) }); } catch { return { ok: false, error: "Fikk ikke kontakt. Prøv igjen om litt." }; }
  const j = await r.json().catch(() => ({}));
  return r.ok ? { ok: true, person: j.person } : { ok: false, error: j.error || "Det gikk ikke. Prøv igjen." };
}

export function startLogin({ button, reload = () => location.reload() }) {
  const m = modal({ title: "Logg inn", closeLabel: "Lukk", className: "login-modal" });
  m.body.innerHTML = `<form class="login-form" autocomplete="off">
    <p class="login-sub">Du får koden av Morten.</p>
    <label class="login-l">Koden, fire sifre<input class="login-code" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="one-time-code" aria-describedby="loginErr"></label>
    <p class="login-err err" id="loginErr" role="alert" hidden></p>
    <div class="g-fb-acts"><button type="button" class="login-cancel">Avbryt</button><button type="submit" class="g-fb-send login-go" disabled>Logg inn</button></div>
    <p class="login-note">Maskinen husker deg i tre måneder. Uten innlogging kan du se alt, men ikke lagre.</p></form>`;
  const q = s => m.body.querySelector(s), form = q("form"), code = q(".login-code"), err = q(".login-err"), go = q(".login-go");
  let sending = false;
  const say = t => { err.textContent = t; err.hidden = !t; };
  code.addEventListener("input", () => { code.value = code.value.replace(/\D/g, "").slice(0, 4); go.disabled = code.value.length !== 4 || sending; if (code.value.length === 4) form.requestSubmit(); });
  q(".login-cancel").onclick = () => m.close();
  form.onsubmit = async e => {
    e.preventDefault(); if (sending || code.value.length !== 4) return; sending = true; go.disabled = true; say("");
    const r = await signIn(code.value);
    if (r.ok) { try { sessionStorage.setItem(FLAG, "1"); } catch { } m.close(); reload(); return; }
    sending = false; say(r.error); code.value = ""; code.focus();
  };
  button.addEventListener("click", () => { say(""); code.value = ""; go.disabled = true; m.open(); code.focus(); });
  return m;
}
