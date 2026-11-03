/* U3932: task handles (ext-tasks) for the long-running tool calls, and the input_required result (MRTR, SEP-2322).
   A task is a durable handle: tasks/get polls status and progress, tasks/update steers it mid-flight (inputResponses),
   tasks/result gives the finished result, tasks/cancel stops it. Kept in memory per server run, an hour after it ends;
   a client that reconnects asks by taskId (the owner must be the same person). */
import { randomBytes } from "node:crypto";

const KEEP_MS = 3600e3, MAX = 200;

/* a tool that needs an answer before it can go on: the result type input_required with the question; the client
   retries the same call with inputResponses[key] = { action: "accept", content } (or the answer itself) */
export const inputRequired = (key, message, properties, required = Object.keys(properties)) => Object.assign(new Error(message),
  { inputRequired: { resultType: "input_required", inputRequests: { [key]: { method: "elicitation/create", params: { message, requestedSchema: { type: "object", properties, required } } } }, requestState: key } });

/* the retry's answers as plain argument values: {key: {action, content}} → content's fields; a declined one is a refusal */
export function answersOf(inputResponses) {
  const out = {};
  for (const [k, v] of Object.entries(inputResponses && typeof inputResponses === "object" ? inputResponses : {})) {
    if (v && typeof v === "object" && typeof v.action === "string") { if (v.action !== "accept") out[`_${v.action}`] = k; else Object.assign(out, v.content || {}); }
    else if (v && typeof v === "object") Object.assign(out, v);
    else out[k] = v;
  }
  return out;
}

export function createTasks() {
  const all = new Map();
  const view = t => ({ taskId: t.id, status: t.status, statusMessage: t.message, createdAt: t.created, lastUpdatedAt: t.updated, ttl: KEEP_MS, pollInterval: 1000, progress: t.progress, steered: t.steered.length });
  const touch = (t, patch) => { Object.assign(t, patch, { updated: new Date().toISOString() }); };
  function sweep() {
    const now = Date.now();
    for (const [id, t] of all) if (t.ended && now - t.ended > KEEP_MS) all.delete(id);
    while (all.size > MAX) all.delete(all.keys().next().value);
  }
  function mine(id, owner) {
    const t = all.get(String(id));
    if (!t || t.owner !== (owner ?? null)) { const e = new Error(`Unknown task: ${id}`); e.code = -32602; throw e; }
    return t;
  }
  return {
    /* fn(ctx): ctx.progress(text), ctx.take() → the steering sent since (array of objects, emptied), ctx.cancelled */
    start(owner, fn) {
      sweep();
      const t = { id: "t" + randomBytes(8).toString("hex"), owner: owner ?? null, status: "working", message: "Started", created: new Date().toISOString(), updated: new Date().toISOString(), progress: [], steered: [], cancelled: false, result: null };
      all.set(t.id, t);
      const ctx = { get cancelled() { return t.cancelled; }, progress: m => { t.progress.push(m); if (t.progress.length > 50) t.progress.shift(); touch(t, { message: String(m) }); },
        take: () => t.steered.splice(0, t.steered.length) };
      Promise.resolve().then(() => fn(ctx)).then(r => { if (t.cancelled) return; t.result = r; touch(t, { status: "completed", message: "Done", ended: Date.now() }); },
        e => { if (t.cancelled) return; t.result = { content: [{ type: "text", text: e.message || String(e) }], isError: true }; touch(t, { status: "failed", message: e.message || "Failed", ended: Date.now() }); });
      return view(t);
    },
    get: (id, owner) => view(mine(id, owner)),
    /* steer: remember what was said so the running work reads it between its steps */
    update(id, owner, inputResponses) {
      const t = mine(id, owner);
      if (t.ended) return view(t);
      t.steered.push(answersOf(inputResponses)); touch(t, { message: "Steering received" });
      return view(t);
    },
    cancel(id, owner) { const t = mine(id, owner); if (!t.ended) { t.cancelled = true; touch(t, { status: "cancelled", message: "Cancelled", ended: Date.now() }); } return view(t); },
    result(id, owner) { const t = mine(id, owner); return t.ended && t.result ? { ...t.result, _meta: { "io.modelcontextprotocol/related-task": { taskId: t.id } } } : null; },
  };
}
