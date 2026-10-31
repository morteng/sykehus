/* «Bilder» (under Bygg): the person's own photos of the building as it stands. A photo is made at most 2000 px on its long edge in the
   browser (a phone's camera picture is 12 MB), sent to /api/bilder (sitephotos.mjs) with its wing, facade side, note and year, listed,
   viewed and deleted here; Anton reads them with the connector's look_at_site_photo. Only the person's own are ever shown. */
import { ownPictureHTML } from "./kit/picture.js";
export const MAX_EDGE = 2000, SIDES = ["nord", "øst", "sør", "vest", "ukjent"];
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
/* the size a picture is sent at: as it is when small enough, else the long edge brought to max */
export function fitSize(w, h, max = MAX_EDGE) { const k = Math.min(1, max / Math.max(w, h)); return { w: Math.round(w * k), h: Math.round(h * k) }; }
/* the address a photo is sent to; the filename is never sent */
export function uploadUrl({ wing, side, note, year }) {
  const q = new URLSearchParams({ "fløy": wing, side: SIDES.includes(side) ? side : "ukjent" });
  if (note && note.trim()) q.set("note", note.trim().slice(0, 300)); if (year) q.set("år", String(year));
  return "api/bilder?" + q;
}
export const WORDS = { empty: "Ingen bilder ennå.", sending: "Sender …", sent: "Bildet er lagt til.", failed: "Fikk ikke lagt til bildet. Prøv igjen.", signedOut: "Logg inn for å legge til bilder.", del: "Slett bildet", sure: "Slette bildet?", unreadable: "Fikk ikke lest bildet. Bruk et JPEG-, PNG- eller WebP-bilde." };
/* a file as a JPEG (PNG and WebP stay as they are when already small) at most MAX_EDGE on its long edge */
export async function downscale(file, { max = MAX_EDGE, bitmap = createImageBitmap, canvas = (w, h) => Object.assign(document.createElement("canvas"), { width: w, height: h }) } = {}) {
  const bm = await bitmap(file, { imageOrientation: "from-image" }), { w, h } = fitSize(bm.width, bm.height, max);
  if (w === bm.width && h === bm.height && file.size <= 4 * 1024 * 1024 && /^image\/(jpeg|png|webp)$/.test(file.type)) { bm.close?.(); return file; }
  const c = canvas(w, h); c.getContext("2d").drawImage(bm, 0, 0, w, h); bm.close?.();
  return await new Promise((ok, no) => c.toBlob(b => b ? ok(b) : no(new Error("toBlob")), "image/jpeg", 0.85));
}

export function startSitePhotos({ root, toast = () => {}, fetchImpl = (...a) => fetch(...a), shrink = downscale }) {
  const $ = s => root.querySelector(s);
  const form = $("#phForm"), file = $("#phFile"), wing = $("#phWing"), side = $("#phSide"), note = $("#phNote"), year = $("#phYear"), go = $("#phGo"), list = $("#phList"), say = $("#phSay");
  const drop = $("#phDrop"), pick = $("#phPick"); let busy = false;
  /* the chosen files as small pictures, each with a way to leave it out before it is sent (the input's own list is rebuilt) */
  function showPick() {
    if (!pick) return; const fs = [...(file.files || [])]; pick.hidden = !fs.length;
    pick.innerHTML = fs.map((f, i) => `<li><img alt="" src="${esc(URL.createObjectURL(f))}"><button type="button" data-out="${i}" title="Ta bort fra utvalget" aria-label="Ta bort ${esc(f.name || "bildet")} fra utvalget">×</button></li>`).join("");
  }
  const setFiles = fs => { const dt = new DataTransfer(); fs.forEach(f => dt.items.add(f)); file.files = dt.files; showPick(); };
  file.onchange = showPick;
  if (pick) pick.onclick = e => { const i = e.target.closest("[data-out]")?.dataset.out; if (i != null) setFiles([...file.files].filter((_, j) => j !== +i)); };
  if (drop) {
    drop.ondragover = e => { e.preventDefault(); drop.classList.add("over"); }; drop.ondragleave = () => drop.classList.remove("over");
    drop.ondrop = e => { e.preventDefault(); drop.classList.remove("over"); const fs = [...(e.dataTransfer?.files || [])].filter(f => /^image\//.test(f.type)); if (fs.length) setFiles([...file.files, ...fs]); };
  }
  const speak = t => { say.textContent = t; say.hidden = !t; };
  async function load() {
    const r = await fetchImpl("api/bilder").catch(() => null);
    if (!r || !r.ok) { list.innerHTML = ""; if (r?.status === 401) speak(WORDS.signedOut); return; }
    const j = await r.json(); if (!wing.options.length) wing.innerHTML = j.wings.map(w => `<option value="${esc(w.id)}">${esc(w.name)}</option>`).join("");
    list.innerHTML = j.photos.length ? j.photos.map(p => `<li data-id="${esc(p.id)}"><a href="api/bilder/${esc(p.id)}" target="_blank" rel="noopener">${ownPictureHTML(`api/bilder/${p.id}`, { w: 240, alt: `${p.wing_name}, fasade ${p.side}` })}</a>
      <div><b>${esc(p.wing_name)}</b> · ${esc(p.side)}${p.year ? ` · ${p.year}` : ""}${p.note ? `<br><small>${esc(p.note)}</small>` : ""}</div><button type="button" class="ph-del" data-del="${esc(p.id)}" title="${WORDS.del}" aria-label="${WORDS.del}">×</button></li>`).join("") : `<li class="ph-empty">${WORDS.empty}<small>Legg til bilder over: Anton kan se på dem.</small></li>`;
  }
  list.onclick = async e => {
    const id = e.target.closest("[data-del]")?.dataset.del; if (!id) return;
    if (!confirm(WORDS.sure)) return;
    const r = await fetchImpl(`api/bilder/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => null);
    if (r?.ok) load(); else toast(WORDS.failed);
  };
  form.onsubmit = async e => {
    e.preventDefault(); if (busy || !file.files.length) return; busy = true; go.disabled = true;
    let n = 0, bad = 0;
    for (const f of [...file.files]) {
      speak(`${WORDS.sending} ${++n} av ${file.files.length}`);
      try {
        const blob = await shrink(f), r = await fetchImpl(uploadUrl({ wing: wing.value, side: side.value, note: note.value, year: year.value }), { method: "POST", headers: { "content-type": blob.type || "application/octet-stream" }, body: blob });
        if (!r.ok) { bad++; if (r.status === 401) { speak(WORDS.signedOut); break; } speak((await r.json().catch(() => ({}))).error || WORDS.failed); }
      } catch { bad++; speak(WORDS.unreadable); }
    }
    busy = false; go.disabled = false; file.value = ""; note.value = ""; showPick();
    if (!bad) { speak(""); toast(WORDS.sent); }
    await load();
  };
  load();
  return { load };
}
