/* The picture on each card of the Forslag tab: a bird's-eye view of a version's after, 480x300 JPEG, kept at
   <versions dir>/_state/thumbs/<id>.jpg (persist.mjs's _state). The file's mtime is the version's `updated`, so a saved
   change makes the next request draw it again; a file with any other time is stale. The list never waits for a picture:
   the image route draws on the first request, concurrent requests for one version share one drawing, and at most
   LIMIT are drawn at once. render(version) -> Promise<Buffer> is given by the caller (mcp.mjs). */
import { readFileSync, writeFileSync, renameSync, mkdirSync, statSync, utimesSync, unlinkSync } from "node:fs";
import { join } from "node:path";

export const LIMIT = 2;
export function createThumbs({ dir = process.env.SYKEHUS_VERSIONS_DIR, render }) {
  const home = dir ? join(dir, "_state", "thumbs") : null, flying = new Map(), waiting = [];
  let busy = 0;
  if (home) try { mkdirSync(home, { recursive: true }); } catch (e) { console.error("thumbs: mkdir", e.message); }
  const file = id => join(home, id + ".jpg"), stamp = v => Math.floor(Date.parse(v.updated) / 1000) * 1000;
  const cached = v => { try { const p = file(v.id); return statSync(p).mtimeMs === stamp(v) ? readFileSync(p) : null; } catch { return null; } };
  const keep = (v, bytes) => { try { const p = file(v.id), t = p + ".tmp"; writeFileSync(t, bytes); utimesSync(t, stamp(v) / 1000, stamp(v) / 1000); renameSync(t, p); } catch (e) { console.error("thumbs: write", v.id, e.message); } };
  const slot = () => new Promise(ok => { if (busy < LIMIT) { busy++; ok(); } else waiting.push(ok); });
  const free = () => { const next = waiting.shift(); if (next) next(); else busy--; };
  async function draw(v) {
    await slot();
    try { const bytes = await render(v); if (home) keep(v, bytes); return bytes; } finally { free(); }
  }
  /* the picture of v as it stands now; a drawing in flight for the same save is shared */
  function get(v) {
    const hit = home && cached(v); if (hit) return Promise.resolve(hit);
    const k = v.id + "@" + v.updated; if (flying.has(k)) return flying.get(k);
    const p = draw(v).finally(() => flying.delete(k)); flying.set(k, p); return p;
  }
  /* a version gone for good: its picture goes too */
  const drop = id => { if (home) try { unlinkSync(file(id)); } catch {} };
  return { get, drop };
}
