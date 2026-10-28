/* What the chat box attaches (button, paste, drop). A picture (JPEG, PNG or WebP) goes with the message as
   picture {image: a data URL, name}: at most 2,5 MB as the server counts it (the characters of the data URL), shrunk to a
   JPEG here when it is bigger. Any other file goes through /api/import as «Hent fil» does and the message carries
   attachment {file, name, size_m}, the answer of the import. The server's caps (assistant.mjs) are the same numbers. */
export const MAX_PICTURE = 2.5e6, MAX_FILE = 100 * 1024 * 1024, PICTURE_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const isPicture = f => PICTURE_TYPES.includes(f?.type);

const readDataUrl = f => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => no(new Error("Fikk ikke lest bildet.")); r.readAsDataURL(f); });
/* a JPEG of the picture, smaller step by step (side at most 2000 px, then quality and size down) until it fits */
async function shrinkToJpeg(file, max) {
  const bmp = await createImageBitmap(file).catch(() => { throw new Error("Fikk ikke lest bildet."); });
  let side = Math.min(1, 2000 / Math.max(bmp.width, bmp.height)), q = 0.85;
  for (let i = 0; i < 12; i++) {
    const c = Object.assign(document.createElement("canvas"), { width: Math.max(1, Math.round(bmp.width * side)), height: Math.max(1, Math.round(bmp.height * side)) }), x = c.getContext("2d");
    x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); x.drawImage(bmp, 0, 0, c.width, c.height);   // no alpha in a JPEG: white behind
    const url = c.toDataURL("image/jpeg", q); if (url.length <= max) { bmp.close?.(); return url; }
    q = Math.max(0.5, q - 0.1); side *= 0.8;
  }
  bmp.close?.(); throw new Error("Bildet er for stort, selv gjort mindre.");
}
/* → {image, name}; read and shrink are the browser's, given here so a test can give its own */
export async function pictureOf(file, { read = readDataUrl, shrink = shrinkToJpeg } = {}) {
  const url = await read(file);
  if (url.length <= MAX_PICTURE) return { image: url, name: file.name || "bilde" };
  return { image: await shrink(file, MAX_PICTURE), name: String(file.name || "bilde").replace(/\.[A-Za-z0-9]{2,5}$/, "") + ".jpg" };
}
/* → {file, name, size_m?}: the file read in by /api/import (a model, or a plan in DXF or DWG), or the reason in the server's words */
export async function uploadFile(file, post = fetch) {
  if (file.size > MAX_FILE) throw new Error("Fila er større enn 100 MB.");
  let j; try { j = await post(`api/import?filename=${encodeURIComponent(file.name)}`, { method: "POST", headers: { "content-type": "application/octet-stream" }, body: file }).then(r => r.json()); }
  catch { throw new Error("Fikk ikke sendt fila."); }
  if (j?.error || !/^[0-9a-f]{64}$/.test(j?.file || "")) throw new Error(j?.error || "Fila ble ikke lest.");
  return { file: j.file, name: file.name, ...(Array.isArray(j.size_m) ? { size_m: j.size_m } : {}) };
}
/* the fields a message takes from what is attached: one picture or one file */
export const fieldsOf = att => !att ? {} : att.picture ? { picture: att.picture } : { attachment: att.attachment };
