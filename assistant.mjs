/* Anton on the page: the pill at the bottom, for a person signed in here (login.mjs). The page never talks to
   gulden-ai; this server holds each person's queue and relays one turn at a time to gulden-ai's internal door, and
   sends what comes back to every page the person has open. The shapes are laser's (atomstack
   docs/contract-shared-assistant-chat.md and hurricane/server/assistant_chat.py, 2026-10-25), with one thread per
   person, session "sykehus:<person>".

     GET  /api/anton/strom       server-sent events: message, queue, text, tool, approval, done, error, steps, signed_out
     GET  /api/anton/historikk   the thread's last 50 items (gulden-ai's /history), and the queue
     POST /api/anton             {text, version?, drawing?, picture?, attachment?, selection?, point?{x,y}}  a message; it waits its turn (5 waiting at most). drawing
                                 (tegn.js): {image: a JPEG data URL, strokes: [{colour, points: [[east, north, kote]…]}],
                                 camera, mode, size}, passed on as it is.
                                 picture: {image: a JPEG, PNG or WebP data URL of at most 2,5 MB (the page shrinks a bigger one), name?}, a
                                 picture the person attached; passed on as it is, never together with a drawing (one picture a turn keeps the
                                 door's 4 MB body far off). attachment: {file: the sha /api/import gave, name, size_m?: [x, y, z]}, a file
                                 the page already brought in; passed on as it is
     POST /api/anton/godkjenn    {approval_id, decision: "accept"|"reject"}
     POST /api/anton/stopp       ends the running turn
     POST /api/anton/ny          «Ny samtale»: gulden-ai starts the thread afresh (/new-chat); every page empties

   To gulden-ai (SYKEHUS_ASSISTANT_URL + SYKEHUS_ASSISTANT_PREFIX, default /internal/sykehus; Bearer
   SYKEHUS_ASSISTANT_TOKEN): POST /chat {person, session, message, request_id, ui_lang: "nb", version?}, the device key in X-Door-Device on every call (U3544)
   answered with NDJSON lines text{delta} | tool{key,label,kind} | approval{id,key,tool,summary,expires_at} | ping |
   qr{url,minutes,label} (a one-time sign-in link for another machine, U3539) | done | error{code,message}; POST /approve, POST /cancel, GET /history. Anton's tools are this server's MCP tools,
   called by gulden-ai with the proxy secret and Remote-User set to the person.

   A check of the drawing runs in the background (gulden-no U3545): Anton answers the next message while it works. After a
   check_drawing tool line, and on every history read, this server asks GET /jobs?person&session every 3 s while a job
   runs. A finished job Anton has not read yet gets a turn in the person's queue: POST /chat {job} in place of a
   message. That turn is Anton's, so the pages get no person's message for it, only his answer and the result's receipt.

   A turn names the version the page shows when it is the person's own, so "this one" means that version. When any of
   a person's versions is saved (by Anton or anyone), their pages get "steps" and redraw it. */
import { randomUUID } from "node:crypto";

/* the relay's numbers and the sentences for a code are the kit's (public/kit/assistant-door.js, U3976): the contract Fab's relay keeps to as well */
import { DOOR, doorSentence } from "./public/kit/assistant-door.js";
const WAITING = DOOR.queueMax, LONGEST = DOOR.textMax, PER_10_MIN = DOOR.rateCount, RATE_WINDOW = DOOR.rateSeconds * 1e3, SILENCE = DOOR.silenceSeconds * 1e3, PING = DOOR.pingSeconds * 1e3, BUSY_TRIES = DOOR.busyTries, BUSY_WAIT = DOOR.busyRetrySeconds * 1e3, JOB_POLL = 3e3;
const words = code => doorSentence(code, { lang: "nb", name: "Anton" });

/* a drawing from the page, checked and tidied: a JPEG of at most 2,5 MB, at most 60 strokes of 60 site points */
function drawingOf(d) {
  const image = String(d?.image ?? "");
  if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(image) || image.length > 2.5e6) throw new Error("Tegningen kom ikke fram riktig. Prøv igjen.");
  const fin = v => typeof v === "number" && Number.isFinite(v);
  const strokes = (Array.isArray(d.strokes) ? d.strokes : []).slice(0, 60).map(s => ({ colour: String(s?.colour ?? "").slice(0, 20),
    points: (Array.isArray(s?.points) ? s.points : []).slice(0, 60).filter(p => Array.isArray(p) && p.length === 3 && p.every(fin) && Math.abs(p[0]) < 2000 && Math.abs(p[1]) < 2000) }));
  const camera = d.camera && typeof d.camera === "object" ? Object.fromEntries(Object.entries(d.camera).filter(([k, v]) => /^[a-z]{1,8}$/.test(k) && fin(v))) : {};
  return { image, strokes, camera, mode: ["3d", "plan", "section", "fasade"].includes(d.mode) ? d.mode : "3d", ...(d.mode === "fasade" && facadeOf(d.facade) ? { facade: facadeOf(d.facade) } : {}), size: Array.isArray(d.size) && d.size.every(fin) ? d.size.slice(0, 2) : null,
    note: "strokes are in site metres [east, north, kote] from the site origin, where each point of the line hit the model; the picture shows what the person saw and drew" };
}

/* a facade drawing (fasade.js): which side of which building, its frame in site metres and the strokes in the facade's own metres (t from the left end, kote), so Anton can place a change where it was drawn */
function facadeOf(f) {
  if (!f || typeof f !== "object") return null;
  const fin = v => typeof v === "number" && Number.isFinite(v), pair = a => Array.isArray(a) && a.length === 2 && a.every(fin) ? a.map(v => Math.round(v * 1e4) / 1e4) : null;
  const txt = (v, n) => String(v ?? "").replace(/[\u0000-\u001f]/g, "").slice(0, n), origin = pair(f.origin), along = pair(f.along), out = pair(f.out);
  if (!origin || !along || !out) return null;
  return { building: txt(f.building, 80), side: txt(f.side, 20), bearing: fin(f.bearing) ? f.bearing : null, origin, along, out, width_m: fin(f.width_m) ? f.width_m : null, base_kote: fin(f.base_kote) ? f.base_kote : null, top_kote: fin(f.top_kote) ? f.top_kote : null,
    strokes_m: (Array.isArray(f.strokes_m) ? f.strokes_m : []).slice(0, 60).map(s => ({ colour: txt(s?.colour, 20), points: (Array.isArray(s?.points) ? s.points : []).slice(0, 60).map(pair).filter(Boolean) })),
    changes: (Array.isArray(f.changes) ? f.changes : []).slice(0, 30).map(c => txt(c, 200)),
    note: "t (first number) is metres along the facade from its left end seen from outside; the site point of (t, kote) is origin + along * t, at the facade plane; out points away from the wall" };
}

/* a picture the person attached (the chat box: button, paste or drop): a JPEG, PNG or WebP data URL of at most 2,5 MB, with its name */
const PICTURE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
function pictureOf(p) {
  const image = String(p?.image ?? "");
  if (!PICTURE.test(image) || image.length > 2.5e6) throw new Error("Bildet kom ikke fram riktig. Prøv igjen.");
  const name = typeof p.name === "string" ? p.name.replace(/[\u0000-\u001f]/g, "").trim().slice(0, 120) : "";
  return { image, ...(name ? { name } : {}) };
}
/* a file already read in through /api/import (its sha is the id); the size is what that answered, metres */
function attachmentOf(a) {
  const file = String(a?.file ?? ""), name = typeof a?.name === "string" ? a.name.replace(/[\u0000-\u001f]/g, "").trim().slice(0, 120) : "";
  if (!/^[0-9a-f]{64}$/.test(file) || !name) throw new Error("Fila kom ikke fram riktig. Prøv igjen.");
  const size = Array.isArray(a.size_m) && a.size_m.length === 3 && a.size_m.every(v => typeof v === "number" && Number.isFinite(v) && v >= 0 && v < 1e6) ? a.size_m.map(v => Math.round(v * 100) / 100) : null;
  return { file, name, ...(size ? { size_m: size } : {}) };
}

/* what was picked in the model when it was sent (valg.js): "this", "these" in the message */
/* a qr line carries a sign-in link to this site's /inn/ page and nothing else */
const QR = /^(https:\/\/sykehus\.gulden\.no|http:\/\/(localhost|127\.0\.0\.1):\d+)\/inn\/?#[A-Za-z0-9_-]{20,64}$/;

const KINDS = ["wing", "building", "new", "storey", "room", "facade", "element"];   // new: a building the after adds (its id, for reshape)
function selectionOf(s) {
  if (!s || !Array.isArray(s.items)) return null;
  const items = s.items.slice(0, 12).filter(i => KINDS.includes(i?.kind) && typeof i.id === "string" && i.id).map(i => ({ kind: i.kind, id: i.id.slice(0, 80), label: String(i.label ?? i.id).slice(0, 120), ...(typeof i.storey === "string" ? { storey: i.storey.slice(0, 40) } : {}) }));
  return items.length ? { items, ids: items.map(i => i.id), summary: String(s.summary ?? items.map(i => i.label).join(" · ")).slice(0, 300) } : null;
}

/* a point the page sends with a message (U3671: the pin Anton asked for): metres east and north on the site, shown to Anton only */
function pointOf(p) { return p && Number.isFinite(p.x) && Number.isFinite(p.y) && Math.abs(p.x) < 5000 && Math.abs(p.y) < 5000 ? { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 } : null; }
const HIDDEN = /\\n\(Nål: [^)]*\)/g;   // as it reads inside JSON text: a backslash and n   // what pointOf's note looks like in the door's text: taken out of what the person sees again (history)
import { createPersist } from "./persist.mjs";
import { createDoor, whyOf, codeOf } from "./door.mjs";   // one way to call gulden-ai's door (U3978)
export function createAssistant({ SECURITY, readJson, login, versions, pages, fetchImpl = fetch, dataDir = process.env.SYKEHUS_VERSIONS_DIR }) {
  /* what survives a restart (persist.mjs): the pins, the drawings, the turns a restart cut */
  const keep = createPersist(dataDir);
  keep.restorePins(pages);
  const prefix = (process.env.SYKEHUS_ASSISTANT_PREFIX || "/internal/sykehus").replace(/\/+$/, "");
  const ready = login.anton;
  const send = (res, code, body) => { res.writeHead(code, { ...SECURITY, "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(body)); };
  const threads = new Map();   // person → { queue: [turn], running, subs: Set<res>, approvals: Map, sent: [times], stop }
  const thread = p => { let t = threads.get(p); if (!t) { t = { queue: [], running: null, subs: new Set(), approvals: new Map(), pics: [], sent: [], stop: null, jobs: new Set(), polling: null }; threads.set(p, t); } return t; };
  /* the drawing a person sent is kept (the last 20) and served from here: the page's policy lets pictures come from its own origin only, so a data: URL in the chat line would show nothing */
  for (const person of keep.people()) thread(person).pics = keep.picsOf(person);
  const picUrl = id => `api/anton/tegning/${id}`;
  const session = p => `sykehus:${p}`;
  const sse = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  function publish(person, event, data) { const t = threads.get(person); if (!t) return; for (const r of t.subs) r.write(sse(event, data)); }
  const queueView = t => ({ type: "queue", running: t.running ? { id: t.running.id, text: t.running.text } : null, waiting: t.queue.map(q => ({ id: q.id, text: q.text })) });
  /* show_building through the pill moves the person's open pages (mcp.mjs); false when none is open */
  if (pages) pages.show = (person, view) => { const t = threads.get(person); if (!t?.subs.size) return false; publish(person, "show", { type: "show", ...view }); return true; };
  versions?.watch?.(v => publish(v.owner, "steps", { type: "steps", version: v.id, title: v.title, changes: v.edits.length, updated: v.updated }));

  const { url: door, call } = createDoor({ login, fetchImpl, prefix });
  /* gulden-ai refused the device (revoked in Settings › People, or one it does not know): every page says Anton cannot answer; the person stays signed in to sykehus (U3668) */
  const refusedDevice = (st, j) => st === 401 || codeOf(j, "") === "device_revoked";

  /* POST /chat and hand each NDJSON line on; [200] after done or error, else the status and body */
  async function chat(body, device, onLine, stop) {
    const ac = new AbortController(); let timer = setTimeout(() => ac.abort(), SILENCE);
    stop.abort = () => ac.abort();
    try {
      const r = await fetchImpl(door + "/chat", { method: "POST", headers: { authorization: `Bearer ${login.bearer}`, "content-type": "application/json", accept: "application/x-ndjson", "x-door-device": device }, body: JSON.stringify(body), signal: ac.signal });
      if (!r.ok) return [r.status, await r.json().catch(() => ({}))];
      const dec = new TextDecoder(); let buf = "";
      for await (const chunk of r.body) {
        clearTimeout(timer); timer = setTimeout(() => ac.abort(), SILENCE);
        buf += dec.decode(chunk, { stream: true });
        let i; while ((i = buf.indexOf("\n")) >= 0) {
          const raw = buf.slice(0, i); buf = buf.slice(i + 1);
          let line; try { line = JSON.parse(raw); } catch { continue; }
          if (line && typeof line.type === "string") { onLine(line); if (line.type === "done" || line.type === "error") return [200, {}]; }
        }
      }
      console.error("anton chat: the stream ended with no done line");
      return [502, { error: { code: "unavailable" } }];
    } catch (e) {
      if (!stop.stopped) console.error("anton chat", e.name === "AbortError" ? `no line in ${SILENCE / 1000} s` : whyOf(e));
      return stop.stopped ? [200, {}] : [e.name === "AbortError" ? 504 : 503, { error: { code: e.name === "AbortError" ? "timeout" : "unavailable" } }]; }
    finally { clearTimeout(timer); }
  }

  /* a finished background job Anton has not read gets his turn in the queue, once (U3545); asks while one runs */
  function watchJobs(person, device) {
    const t = thread(person);
    if (t.polling) return;
    const tick = async () => {
      const [st, j] = await call("/jobs", null, { person, session: session(person) }, device);
      const jobs = st === 200 && Array.isArray(j.jobs) ? j.jobs : [];
      for (const job of jobs) {
        if (job.state === "running" || job.reported || t.jobs.has(job.job)) continue;
        t.jobs.add(job.job);
        t.queue.push({ id: randomUUID(), job: job.job, text: "Kontrollen er ferdig", at: new Date().toISOString(), device });
        publish(person, "queue", queueView(t)); run(person);
      }
      if (jobs.some(job => job.state === "running")) t.polling = setTimeout(tick, JOB_POLL); else t.polling = null;
    };
    t.polling = setTimeout(tick, 0);
  }

  /* a version the person owns, else their work if one is made (never made here), as ids; selection, point and drawing as they were sent */
  function pin(person, turn) {
    if (!pages) return null;
    const open = turn.job ? versions?.get(pages.open.get(person)) : turn.version && versions?.get(turn.version.id), own = open?.owner === person ? open : null;
    const version = own?.id ?? versions?.list({ owner: person, viewer: person }).find(x => x.work)?.id ?? null;
    const ctx = { id: turn.id, person, version, draft: null, picked: turn.job ? pages.picked?.get(person) ?? null : turn.picked ?? null, selection: turn.selection ?? null, point: turn.point ?? null, drawing: !!turn.drawing,
      seen: version ? { id: version, edits: versions.get(version).edits.map(e => JSON.stringify(e)) } : null };
    (pages.turn ??= new Map()).set(person, ctx); keep.savePins(pages); return ctx;
  }
  async function run(person) {
    const t = thread(person);
    if (t.running) return;
    while (t.queue.length) {
      const turn = t.running = t.queue.shift();
      if (!turn.job) keep.turnTaken(person, turn);
      if (!turn.job) publish(person, "message", { type: "message", from: person, id: turn.id, text: turn.text, at: turn.at, ...(turn.drawing || turn.picture ? { image: picUrl(turn.id) } : {}), ...(turn.attachment ? { attachment: turn.attachment.name } : {}), ...(turn.selection ? { about: turn.selection.summary } : {}) });
      publish(person, "queue", queueView(t));
      const body = turn.job ? { person, session: session(person), job: turn.job, request_id: turn.id, ui_lang: "nb" }
        : { person, session: session(person), message: turn.point ? `${turn.text}\n(Nål: x=${turn.point.x}, y=${turn.point.y} meter på tomta, som try_change tar dem.)` : turn.text, request_id: turn.id, ui_lang: "nb", ...(turn.version ? { version: turn.version } : {}), ...(turn.drawing ? { drawing: turn.drawing } : {}), ...(turn.picture ? { picture: turn.picture } : {}), ...(turn.attachment ? { attachment: turn.attachment } : {}), ...(turn.selection ? { selection: turn.selection } : {}) };
      /* the turn's own copy of what the person's page said when the message was sent (Morten: «while Anton works, the user
         should be free to move around without that affecting what Anton sees or does»): mcp.mjs reads it, never pages.open, until the turn ends */
      const ctx = pin(person, turn);
      const stop = t.stop = { stopped: false, abort: () => {} };
      const onLine = line => {
        if (line.type === "ping" || !["text", "tool", "approval", "qr", "done", "error"].includes(line.type)) return;
        if (line.type === "qr" && !QR.test(String(line.url))) return;
        const out = line.type === "error" ? { type: "error", code: codeOf(line, "internal") }
          : line.type === "qr" ? { type: "qr", url: line.url, minutes: Math.min(15, Math.max(1, +line.minutes || 10)), label: String(line.label || "Skann med iPaden").slice(0, 60), ...(/^\d{4}$/.test(String(line.code)) ? { code: String(line.code) } : {}) } : { ...line };
        out.reply_to = turn.id;
        if (line.type === "approval" && typeof line.id === "string") t.approvals.set(line.id, { summary: String(line.summary || "").slice(0, 300) });
        if (line.type === "tool" && line.key === "check_drawing") watchJobs(person, turn.device);
        publish(person, line.type, out);
      };
      let st, j;
      try {
        for (let i = 0; i < BUSY_TRIES; i++) { [st, j] = await chat(body, turn.device, onLine, stop); if (st !== 409 || stop.stopped) break; await new Promise(ok => setTimeout(ok, BUSY_WAIT)); }
      } catch (e) { console.error("anton turn", e); st = 500; j = { error: { code: "internal" } }; }
      finally { if (pages?.turn?.get(person) === ctx) { pages.turn.delete(person); keep.savePins(pages); } }
      console.log("anton: turn", turn.id.slice(0, 8), "→", st);
      if (st !== 200) {
        if (refusedDevice(st, j)) { publish(person, "signed_out", { type: "signed_out" }); t.queue.length = 0; }
        publish(person, "error", { type: "error", code: codeOf(j, "unavailable"), reply_to: turn.id });
      }
      t.running = null; t.stop = null; t.approvals.clear(); keep.turnEnded(person);
      publish(person, "queue", queueView(t));
    }
  }

  async function post(req, res, me, path) {
    if (req.headers.origin && (() => { try { return new URL(req.headers.origin).host !== req.headers.host; } catch { return true; } })()) return send(res, 403, { error: "Feil opphav" });
    let b; try { b = await readJson(req, path === "/api/anton" ? 3e6 : 20000); } catch { return send(res, 400, { error: "Uleselig" }); }
    const t = thread(me.person);
    if (path === "/api/anton") {
      const text = String(b?.text ?? "").trim();
      if (!text) return send(res, 400, { error: "Skriv noe først." });
      if (text.length > LONGEST) return send(res, 413, { error: words("too_long") });
      if (t.queue.length >= WAITING) return send(res, 429, { error: words("queue_full") });
      const now = Date.now(); t.sent = t.sent.filter(x => now - x < RATE_WINDOW);
      if (t.sent.length >= PER_10_MIN) return send(res, 429, { error: words("limit") });
      t.sent.push(now);
      const v = versions?.get(String(b?.version ?? "")), version = v && v.owner === me.person ? { id: v.id, title: v.title, changes: v.edits.length } : null;
      let drawing = null;
      if (b?.drawing != null) { try { drawing = drawingOf(b.drawing); } catch (e) { return send(res, 400, { error: e.message }); } }
      let picture = null, attachment = null;
      try { if (b?.picture != null) picture = pictureOf(b.picture); if (b?.attachment != null) attachment = attachmentOf(b.attachment); } catch (e) { return send(res, 400, { error: e.message }); }
      if (picture && drawing) return send(res, 400, { error: "Send én tegning eller ett bilde om gangen." });
      const selection = selectionOf(b?.selection);
      const picked = selection?.items.find(i => i.kind === "wing" || i.kind === "building")?.id ?? null;
      const turn = { id: randomUUID(), text, at: new Date().toISOString(), device: me.device, version, drawing, picture, attachment, selection, point: pointOf(b?.point), picked };
      const shown = drawing?.image || picture?.image;
      if (shown) { keep.keepPic(me.person, turn.id, text, shown); t.pics.push({ id: turn.id, text, image: shown }); if (t.pics.length > 20) t.pics.shift(); }
      if (pages) { if (version) pages.open.set(me.person, version.id); else pages.open.delete(me.person); }   // where Anton's changes go (mcp.mjs try_change)
      /* the wing or building picked when it was sent: a facade asked for with no wing named is that one's (mcp.mjs viewOf) */
      if (pages) { pages.picked ??= new Map(); const p = selection?.items.find(i => i.kind === "wing" || i.kind === "building"); if (p) pages.picked.set(me.person, p.id); else pages.picked.delete(me.person); }
      keep.savePins(pages);
      t.queue.push(turn); publish(me.person, "queue", queueView(t)); run(me.person);
      console.log("anton: turn", turn.id.slice(0, 8), "taken,", t.subs.size, "pages listening");   // no text, no person
      return send(res, 202, { id: turn.id });
    }
    if (path === "/api/anton/godkjenn") {
      const id = String(b?.approval_id ?? ""), decision = b?.decision === "accept" ? "accept" : "reject";
      if (!t.approvals.has(id)) return send(res, 404, { error: "Spørsmålet er ikke lenger åpent." });
      const [st, j] = await call("/approve", { person: me.person, session: session(me.person), approval_id: id, decision }, null, me.device);
      if (st === 200) { t.approvals.delete(id); publish(me.person, "approval_done", { type: "approval_done", id, decision }); }
      return send(res, st === 200 ? 200 : 502, st === 200 ? { ok: true } : { error: codeOf(j, "unavailable") });
    }
    if (path === "/api/anton/stopp") {
      if (!t.running) return send(res, 200, { ok: true });
      const [st] = await call("/cancel", { person: me.person, session: session(me.person) }, null, me.device);
      if (st !== 200 && t.stop) { t.stop.stopped = true; t.stop.abort(); }
      return send(res, 200, { ok: true });
    }
    if (path === "/api/anton/ny") {
      if (t.running || t.queue.length) return send(res, 409, { error: "Vent til Anton har svart." });
      /* gulden-ai's /new-chat is idempotent by request_id and refuses a call without one (400 bad_request: the 502 of
         2026-10-25 21:05Z); the page may send its own, so a retry of the same click is one reset */
      const rid = /^[A-Za-z0-9._:-]{1,128}$/.test(String(b?.request_id ?? "")) ? String(b.request_id) : randomUUID();
      const [st, j] = await call("/new-chat", { person: me.person, session: session(me.person), request_id: rid }, null, me.device);
      if (refusedDevice(st, j)) return send(res, 401, { error: "signed_out" });
      if (st !== 200) { console.error("anton /new-chat", st, codeOf(j, "")); return send(res, 502, { error: codeOf(j, "unavailable") }); }
      publish(me.person, "cleared", { type: "cleared" }); return send(res, 200, { ok: true });
    }
    return send(res, 404, { error: "Ikke funnet" });
  }

  function stream(req, res, me) {
    res.writeHead(200, { ...SECURITY, "content-type": "text/event-stream", "cache-control": "no-store", "x-accel-buffering": "no" });
    const t = thread(me.person); t.subs.add(res);
    res.write(sse("queue", queueView(t)));
    const ping = setInterval(() => res.write(": ping\n\n"), PING);
    req.on("close", () => { clearInterval(ping); t.subs.delete(res); });
  }

  async function history(res, me) {
    const [st, j] = await call("/history", null, { person: me.person, session: session(me.person) }, me.device);
    if (refusedDevice(st, j)) return send(res, 401, { error: "signed_out" });
    const items = JSON.parse(JSON.stringify(Array.isArray(j.items) ? j.items : Array.isArray(j) ? j : []).replace(HIDDEN, ""));
    /* the person's own lines get their drawing back: by the turn's id when the door gives one, else by the words, oldest first */
    const pics = thread(me.person).pics, used = new Set();
    for (const it of items) if (it?.type === "message" && it.from !== "assistant" && !it.image) {
      const p = pics.find(x => !used.has(x.id) && (x.id === (it.request_id ?? it.id) || ((it.request_id ?? it.id) == null && x.text === it.text)));
      if (p) { used.add(p.id); it.image = picUrl(p.id); }
    }
    /* a turn a restart cut: its line, after the message it answered (else last), so the page shows it again at every reload */
    for (const n of keep.notesOf(me.person)) {
      let at = items.findLastIndex(it => it?.type === "message" && it.from !== "assistant" && (it.request_id ?? it.id) === n.reply_to);
      if (at < 0) at = items.findLastIndex(it => it?.type === "message" && it.from !== "assistant" && it.text === n.text);
      items.splice(at < 0 ? items.length : at + 1, 0, { type: "error", code: n.code, reply_to: n.reply_to });
    }
    if (st === 200) watchJobs(me.person, me.device);   // a job that finished while no page was open, or before a restart of this server
    return send(res, st === 200 ? 200 : 502, { items: items.slice(-50), queue: queueView(thread(me.person)), ...(st === 200 ? {} : { error: codeOf(j, "unavailable") }) });
  }

  /* true when the request was ours */
  async function route(req, res, path) {
    if (!path.startsWith("/api/anton")) return false;
    const me = login.personOf(req);
    if (!ready) { send(res, 503, { error: "Anton er ikke koblet til ennå." }); return true; }
    if (!me) { send(res, 401, { error: "signed_out" }); return true; }
    if (path === "/api/anton/strom" && req.method === "GET") { stream(req, res, me); return true; }
    if (path === "/api/anton/historikk" && req.method === "GET") { await history(res, me); return true; }
    const pic = req.method === "GET" && /^\/api\/anton\/tegning\/([0-9a-f-]{36})$/.exec(path);
    if (pic) {
      const p = thread(me.person).pics.find(x => x.id === pic[1]), bytes = p && (keep.picBytes(p.id) ?? (p.image ? Buffer.from(p.image.slice(p.image.indexOf(",") + 1), "base64") : null));
      if (!bytes) send(res, 404, { error: "Tegningen er ikke lenger her." });
      else { res.writeHead(200, { ...SECURITY, "content-type": bytes[0] === 0x89 ? "image/png" : bytes[0] === 0x52 ? "image/webp" : "image/jpeg", "cache-control": "private, max-age=3600" }); res.end(bytes); }
      return true;
    }
    if (req.method === "POST") { await post(req, res, me, path); return true; }
    send(res, 404, { error: "Ikke funnet" }); return true;
  }
  return { route, publish, flush: keep.flush };
}
