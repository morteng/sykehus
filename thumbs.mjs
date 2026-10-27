/* The picture on each card of the Forslag tab: a bird's-eye view of a version's after, 480x300 JPEG, kept at
   <versions dir>/_state/thumbs/<id>.jpg (persist.mjs's _state). The file's mtime is the version's `updated`, so a saved
   change makes the next request draw it again; a file with any other time is stale. The list never waits for a picture:
   the image route draws on the first request, concurrent requests for one version share one drawing, and at most
   LIMIT are drawn at once. render(version) -> Promise<Buffer> is given by the caller (mcp.mjs). */
import { readFileSync, writeFileSync, renameSync, mkdirSync, statSync, utimesSync, unlinkSync } from "node:fs";
import { join } from "node:path";

export const LIMIT = 2;
/* the renderer's settings version: bump it when the card's picture is drawn differently, so no file drawn the old way is reused */
export const V = 2;
const TAN_SIDE = 2.2;
/* How the card's picture is drawn (Morten 2026-10-27: «it has red shit on it»): a clean bird's-eye view, natural colours, no accent, no focus,
   no scale bar or caption. The whole hospital site, widened to hold the box of what the project changed (changeArea's box) with a margin;
   no changes: the site as before. site = the shared before, area = changeArea(...) or null. */
export function cardOpts(site, area) {
  const ring = (site.buildings || []).filter(b => b.own).flatMap(b => b.ring).filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]));
  const bx = ring.length ? { x0: Math.min(...ring.map(p => p[0])), x1: Math.max(...ring.map(p => p[0])), y0: Math.min(...ring.map(p => p[1])), y1: Math.max(...ring.map(p => p[1])) } : null;
  const b = area?.box ? { x0: Math.min(area.box.x0, bx?.x0 ?? area.box.x0), x1: Math.max(area.box.x1, bx?.x1 ?? area.box.x1), y0: Math.min(area.box.y0, bx?.y0 ?? area.box.y0), y1: Math.max(area.box.y1, bx?.y1 ?? area.box.y1) } : bx;
  const cx = b ? (b.x0 + b.x1) / 2 : 0, cy = b ? (b.y0 + b.y1) / 2 : 0, side = b ? Math.max(b.x1 - b.x0, b.y1 - b.y0) : 0;
  return { from: 225, tilt: 35, target: [cx, cy, 25], dist: Math.round(Math.min(900, Math.max(330, TAN_SIDE * side))), focus: [], accent: false, width: 480, height: 300 };
}
export const drawCard = ({ site, s, area, picture }) => picture(s, cardOpts(site, area));
export function createThumbs({ dir = process.env.SYKEHUS_VERSIONS_DIR, render }) {
  const home = dir ? join(dir, "_state", "thumbs") : null, flying = new Map(), waiting = [];
  let busy = 0;
  if (home) try { mkdirSync(home, { recursive: true }); } catch (e) { console.error("thumbs: mkdir", e.message); }
  const file = id => join(home, `${id}.v${V}.jpg`), stamp = v => Math.floor(Date.parse(v.updated) / 1000) * 1000;
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
  const drop = id => { if (home) for (const f of [file(id), join(home, id + ".jpg")]) try { unlinkSync(f); } catch {} };
  return { get, drop };
}
