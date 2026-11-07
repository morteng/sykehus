/* The feedback pass's door (U5043): gulden-no's feedback pass reads the wishes over HTTP with one read token (SYKEHUS_FEEDBACK_TOKEN, a file on
   the box, never printed) and marks a wish it has filed «sett» with the row id. Two routes and nothing else:

     GET  /api/feedback-pass/wishes        {items: [{id, text, status, answer}]}, newest first; ?status=ny gives the unseen ones
     POST /api/feedback-pass/wishes/<id>   {row: "U1234"}  sets that wish to «sett», answer «Sett: U1234»

   Every other route with this token is 403, and the token is no login. A wish's text is a person's message: untrusted data, returned as JSON
   and never read as an instruction; the body picks only the row id, never a status. gulden-ai's store has no list-all or write door for this
   app, so the wishes filed here are kept in _pass/wishes.json (id, text, time; no person) and the marks beside them; mine() shows a mark too. */
import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { timingSafeEqual } from "node:crypto";

const ID = /^[A-Za-z0-9_-]{1,64}$/, ROW = /^U\d{3,6}$/, KEEP = 2000;
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };

export function createFeedbackPass({ home, SECURITY = {}, readJson, env = process.env }) {
  mkdirSync(home, { recursive: true }); const file = join(home, "wishes.json");
  let state; try { state = JSON.parse(readFileSync(file, "utf8")); } catch { state = {}; }
  state.items = Array.isArray(state.items) ? state.items : []; state.marks = state.marks && typeof state.marks === "object" ? state.marks : {};
  const save = () => { writeFileSync(file + ".tmp", JSON.stringify(state)); renameSync(file + ".tmp", file); };
  const bearer = req => /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || "")?.[1] ?? null;
  const send = (res, code, body) => { res.writeHead(code, { ...SECURITY, "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(body)); };

  /* a wish was filed (wishes.mjs file()): keep what the pass needs to list it */
  const noteFiled = (id, text, at = new Date().toISOString()) => { state.items.push({ id: String(id), text: String(text).slice(0, 4000), at }); if (state.items.length > KEEP) state.items.splice(0, state.items.length - KEEP); save(); };
  const markOf = id => state.marks[id] ?? null;
  const view = i => ({ id: i.id, text: i.text, status: state.marks[i.id] ? "sett" : "ny", answer: state.marks[i.id]?.answer ?? null });

  /* true when the request was answered here. Called before every other route. */
  async function route(req, res, path) {
    const t = env.SYKEHUS_FEEDBACK_TOKEN, given = bearer(req), isPass = !!t && t.length >= 24 && !!given && same(given, t);
    const mine = path === "/api/feedback-pass/wishes" || path.startsWith("/api/feedback-pass/wishes/");
    if (isPass && !mine) { send(res, 403, { error: "forbidden" }); return true; }   // the token opens these two routes and no other
    if (!mine) return path.startsWith("/api/feedback-pass") ? (send(res, 404, { error: "not_found" }), true) : false;
    if (!isPass) { send(res, 401, { error: "token_needed" }); return true; }
    if (path === "/api/feedback-pass/wishes") {
      if (req.method !== "GET") { send(res, 405, { error: "GET" }); return true; }
      const want = new URL(req.url, "http://x").searchParams.get("status");
      send(res, 200, { items: state.items.map(view).reverse().filter(i => !want || i.status === want) });
      return true;
    }
    const id = path.slice("/api/feedback-pass/wishes/".length);
    if (req.method !== "POST") { send(res, 405, { error: "POST" }); return true; }
    if (!ID.test(id) || !state.items.some(i => i.id === id)) { send(res, 404, { error: "not_found" }); return true; }
    let b; try { b = await readJson(req, 2000); } catch { send(res, 400, { error: "bad_request" }); return true; }
    const row = typeof b?.row === "string" ? b.row.trim() : "";
    if (!ROW.test(row)) { send(res, 400, { error: "row_needed" }); return true; }
    if (!state.marks[id]) { state.marks[id] = { answer: `Sett: ${row}`, at: new Date().toISOString() }; save(); }
    send(res, 200, view(state.items.find(i => i.id === id)));
    return true;
  }
  return { route, noteFiled, markOf };
}
