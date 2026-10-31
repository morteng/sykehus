/* A stub of gulden-ai's sykehus door for the tests that file feedback (U3978): POST /internal/sykehus/feedback keeps a report,
   GET /internal/sykehus/reports?person lists that person's own, newest first. Point the server at it with SYKEHUS_ASSISTANT_URL
   and SYKEHUS_ASSISTANT_TOKEN = BEARER. A test changes a report's status or note in `filed`, as a developer does in the store. */
import { createServer } from "node:http";

export const BEARER = "door-bearer-for-tests-0123456789";

export async function stubDoor() {
  const filed = [];
  const server = createServer((req, res) => {
    const u = new URL(req.url, "http://x"); let raw = "";
    req.on("data", c => raw += c);
    req.on("end", () => {
      const send = (code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
      if (req.headers.authorization !== `Bearer ${BEARER}`) return send(401, { error: { code: "not_allowed" } });
      if (req.method === "POST" && u.pathname === "/internal/sykehus/feedback") { const b = JSON.parse(raw); filed.push({ ...b, id: "rp-" + (filed.length + 1), status: "ny", note: null }); return send(200, { id: "rp-" + filed.length }); }
      if (req.method === "GET" && u.pathname === "/internal/sykehus/reports") return send(200, { items: filed.filter(r => r.person === u.searchParams.get("person")).reverse().map(r => ({ id: r.id, at: r.at, text: r.text.split("\n")[0], status: r.status, note: r.note, ref: r.design_id ?? null })) });
      send(404, {});
    });
  });
  await new Promise(ok => server.listen(0, "127.0.0.1", ok));
  return { filed, url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}
