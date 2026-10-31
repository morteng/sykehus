/* The picture register (gulden-no U4007): tell gulden-ai's media registry about a picture sykehus keeps (a Gjengi render, a person's
   site photo). POST <gulden-ai>/internal/media with the same bearer as the door (SYKEHUS_ASSISTANT_URL / _TOKEN, login.mjs).
   An index, never a gate: the call is not waited for, a failure is logged and dropped, nothing is queued or retried. The route's wire
   shape is gulden-ai API-CONTRACT.md « POST /internal/media »; `source` is a local:// address nothing reads yet. */
import { createHash } from "node:crypto";

const MIME = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

export function createMedia({ login, fetchImpl = fetch } = {}) {
  const base = login?.base || "", bearer = login?.bearer || "";
  /* ref is sykehus' own id (`photo/<id>`, `render/<id>`); the registry stores it as `sykehus:<ref>` */
  function picture(ref, owner, access, source, bytes, ext, width = null, height = null) {
    if (!base || !bearer || !owner || !bytes?.length) return;
    const body = { app: "sykehus", ref, owner, access, kind: "picture", source, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"),
      mime: MIME[ext] || null, width, height };
    Promise.resolve().then(async () => {
      const r = await fetchImpl(`${base}/internal/media`, { method: "POST", signal: AbortSignal.timeout(5000), headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" }, body: JSON.stringify(body) });
      if (r.status !== 200) console.warn(`media register ${ref}: the door answered ${r.status}`);
    }).catch(e => console.error("media register", ref, e.message));
  }
  /* the picture is gone: drop its registry rows (POST /internal/media/delete {app, ref}); same fire and forget as `picture` */
  function forget(ref) {
    if (!base || !bearer || !ref) return;
    Promise.resolve().then(async () => {
      const r = await fetchImpl(`${base}/internal/media/delete`, { method: "POST", signal: AbortSignal.timeout(5000), headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" }, body: JSON.stringify({ app: "sykehus", ref }) });
      if (r.status !== 200) console.warn(`media forget ${ref}: the door answered ${r.status}`);
    }).catch(e => console.error("media forget", ref, e.message));
  }
  return { picture, forget };
}
