/* Anton on the page: the pill at the bottom, for a person signed in here (login.mjs). The page never talks to
   gulden-ai; this server holds each person's queue and relays one turn at a time to gulden-ai's internal door, and
   sends what comes back to every page the person has open. The shapes are laser's (atomstack
   docs/contract-shared-assistant-chat.md and hurricane/server/assistant_chat.py, 2026-10-25), with one thread per
   person, session "sykehus:<person>".

     GET  /api/anton/strom       server-sent events: message, queue, text, tool, approval, done, error, steps, signed_out
     GET  /api/anton/historikk   the thread's last 50 items (gulden-ai's /history), and the queue
     POST /api/anton             {text, version?, drawing?, selection?}  a message; it waits its turn (5 waiting at most). drawing
                                 (tegn.js): {image: a JPEG data URL, strokes: [{colour, points: [[east, north, kote]…]}],
                                 camera, mode, size}, passed on as it is
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

const WAITING = 5, LONGEST = 4000, PER_10_MIN = 20, SILENCE = 180e3, PING = 15e3, BUSY_TRIES = 20, JOB_POLL = 3e3;

/* a drawing from the page, checked and tidied: a JPEG of at most 2,5 MB, at most 60 strokes of 60 site points */
function drawingOf(d) {
  const image = String(d?.image ?? "");
  if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(image) || image.length > 2.5e6) throw new Error("Tegningen kom ikke fram riktig. Prøv igjen.");
  const fin = v => typeof v === "number" && Number.isFinite(v);
  const strokes = (Array.isArray(d.strokes) ? d.strokes : []).slice(0, 60).map(s => ({ colour: String(s?.colour ?? "").slice(0, 20),
    points: (Array.isArray(s?.points) ? s.points : []).slice(0, 60).filter(p => Array.isArray(p) && p.length === 3 && p.every(fin) && Math.abs(p[0]) < 2000 && Math.abs(p[1]) < 2000) }));
  const camera = d.camera && typeof d.camera === "object" ? Object.fromEntries(Object.entries(d.camera).filter(([k, v]) => /^[a-z]{1,8}$/.test(k) && fin(v))) : {};
  return { image, strokes, camera, mode: ["3d", "plan", "section"].includes(d.mode) ? d.mode : "3d", size: Array.isArray(d.size) && d.size.every(fin) ? d.size.slice(0, 2) : null,
    note: "strokes are in site metres [east, north, kote] from the site origin, where each point of the line hit the model; the picture shows what the person saw and drew" };
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

export function createAssistant({ SECURITY, readJson, login, versions, pages, fetchImpl = fetch }) {
  const prefix = (process.env.SYKEHUS_ASSISTANT_PREFIX || "/internal/sykehus").replace(/\/+$/, "");
  const door = login.base + prefix, ready = login.anton;
  const send = (res, code, body) => { res.writeHead(code, { ...SECURITY, "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(body)); };
  const threads = new Map();   // person → { queue: [turn], running, subs: Set<res>, approvals: Map, sent: [times], stop }
  const thread = p => { let t = threads.get(p); if (!t) { t = { queue: [], running: null, subs: new Set(), approvals: new Map(), sent: [], stop: null, jobs: new Set(), polling: null }; threads.set(p, t); } return t; };
  const session = p => `sykehus:${p}`;
  const sse = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  function publish(person, event, data) { const t = threads.get(person); if (!t) return; for (const r of t.subs) r.write(sse(event, data)); }
  const queueView = t => ({ type: "queue", running: t.running ? { id: t.running.id, text: t.running.text } : null, waiting: t.queue.map(q => ({ id: q.id, text: q.text })) });
  /* show_building through the pill moves the person's open pages (mcp.mjs); false when none is open */
  if (pages) pages.show = (person, view) => { const t = threads.get(person); if (!t?.subs.size) return false; publish(person, "show", { type: "show", ...view }); return true; };
  versions?.watch?.(v => publish(v.owner, "steps", { type: "steps", version: v.id, title: v.title, changes: v.edits.length, updated: v.updated }));

  /* why a fetch to gulden-ai failed: undici's "fetch failed" hides it in e.cause (ECONNREFUSED, UND_ERR_SOCKET, a reset) */
  const whyOf = e => [e.name, e.message, e.cause?.code, e.cause?.message].filter(Boolean).join(" / ");
  const call = async (path, body, query, device) => {
    const q = query ? "?" + new URLSearchParams(query) : "";
    try {
      const r = await fetchImpl(door + path + q, { method: body ? "POST" : "GET", headers: { authorization: `Bearer ${login.bearer}`, accept: "application/json", "x-door-device": device, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
      return [r.status, await r.json().catch(() => ({}))];
    } catch (e) { console.error("anton", path, whyOf(e)); return [503, { error: { code: "unavailable" } }]; }
  };
  const codeOf = (j, d) => typeof j?.error?.code === "string" ? j.error.code : typeof j?.code === "string" ? j.code : d;
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

  async function run(person) {
    const t = thread(person);
    if (t.running) return;
    while (t.queue.length) {
      const turn = t.running = t.queue.shift();
      if (!turn.job) publish(person, "message", { type: "message", from: person, id: turn.id, text: turn.text, at: turn.at, ...(turn.drawing ? { image: turn.drawing.image } : {}), ...(turn.selection ? { about: turn.selection.summary } : {}) });
      publish(person, "queue", queueView(t));
      const body = turn.job ? { person, session: session(person), job: turn.job, request_id: turn.id, ui_lang: "nb" }
        : { person, session: session(person), message: turn.text, request_id: turn.id, ui_lang: "nb", ...(turn.version ? { version: turn.version } : {}), ...(turn.drawing ? { drawing: turn.drawing } : {}), ...(turn.selection ? { selection: turn.selection } : {}) };
      const stop = t.stop = { stopped: false, abort: () => {} };
      const onLine = line => {
        if (line.type === "ping" || !["text", "tool", "approval", "qr", "done", "error"].includes(line.type)) return;
        if (line.type === "qr" && !QR.test(String(line.url))) return;
        const out = line.type === "error" ? { type: "error", code: codeOf(line, "internal") }
          : line.type === "qr" ? { type: "qr", url: line.url, minutes: Math.min(15, Math.max(1, +line.minutes || 10)), label: String(line.label || "Skann med iPaden").slice(0, 60) } : { ...line };
        out.reply_to = turn.id;
        if (line.type === "approval" && typeof line.id === "string") t.approvals.set(line.id, { summary: String(line.summary || "").slice(0, 300) });
        if (line.type === "tool" && line.key === "check_drawing") watchJobs(person, turn.device);
        publish(person, line.type, out);
      };
      let st, j;
      try {
        for (let i = 0; i < BUSY_TRIES; i++) { [st, j] = await chat(body, turn.device, onLine, stop); if (st !== 409 || stop.stopped) break; await new Promise(ok => setTimeout(ok, 3000)); }
      } catch (e) { console.error("anton turn", e); st = 500; j = { error: { code: "internal" } }; }
      console.log("anton: turn", turn.id.slice(0, 8), "→", st);
      if (st !== 200) {
        if (refusedDevice(st, j)) { publish(person, "signed_out", { type: "signed_out" }); t.queue.length = 0; }
        publish(person, "error", { type: "error", code: codeOf(j, "unavailable"), reply_to: turn.id });
      }
      t.running = null; t.stop = null; t.approvals.clear();
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
      if (text.length > LONGEST) return send(res, 413, { error: `Høyst ${LONGEST} tegn i en melding.` });
      if (t.queue.length >= WAITING) return send(res, 429, { error: "Det venter allerede mange meldinger. Vent til Anton har svart." });
      const now = Date.now(); t.sent = t.sent.filter(x => now - x < 600e3);
      if (t.sent.length >= PER_10_MIN) return send(res, 429, { error: "Mange meldinger på kort tid. Vent noen minutter." });
      t.sent.push(now);
      const v = versions?.get(String(b?.version ?? "")), version = v && v.owner === me.person ? { id: v.id, title: v.title, changes: v.edits.length } : null;
      let drawing = null;
      if (b?.drawing != null) { try { drawing = drawingOf(b.drawing); } catch (e) { return send(res, 400, { error: e.message }); } }
      const selection = selectionOf(b?.selection);
      const turn = { id: randomUUID(), text, at: new Date().toISOString(), device: me.device, version, drawing, selection };
      if (pages) { if (version) pages.open.set(me.person, version.id); else pages.open.delete(me.person); }   // where Anton's changes go (mcp.mjs try_change)
      /* the wing or building picked when it was sent: a facade asked for with no wing named is that one's (mcp.mjs viewOf) */
      if (pages) { pages.picked ??= new Map(); const p = selection?.items.find(i => i.kind === "wing" || i.kind === "building"); if (p) pages.picked.set(me.person, p.id); else pages.picked.delete(me.person); }
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
    const items = Array.isArray(j.items) ? j.items : Array.isArray(j) ? j : [];
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
    if (req.method === "POST") { await post(req, res, me, path); return true; }
    send(res, 404, { error: "Ikke funnet" }); return true;
  }
  return { route, publish };
}
