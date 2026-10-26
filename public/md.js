/* U3680: Anton's answers as markdown. Built with createElement and textContent only, never innerHTML, so no HTML in the
   text can reach the page; a link takes http(s) and mailto only. Shows: **bold**, *italic*, `code`, [text](url),
   headings (as small bold lines), - and 1. lists, line breaks, paragraphs, fenced code. A half-written mark (the
   stream) stays plain until its closing mark arrives, so each chunk can be drawn again from the whole text.
   Follow-up: gulden-ai's frontend/src/ui/markdown.ts is a second renderer (marked + DOMPurify, TypeScript); the kits
   have none. One copy belongs in kits/ui. */
const el = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };
const SAFE = /^(https?:\/\/|mailto:)/i;

/** inline marks into `parent` */
export function inline(parent, s) {
  const re = /`([^`\n]+)`|\*\*(.+?)\*\*|__(.+?)__|\*(?!\s)([^*\n]+?)\*(?!\*)|(?<![\w])_(?!\s)([^_\n]+?)_(?![\w])|\[([^\]\n]+)\]\(([^)\s]+)\)/g;
  let i = 0, m;
  while ((m = re.exec(s))) {
    if (m.index > i) parent.append(s.slice(i, m.index));
    if (m[1] != null) { const c = el("code"); c.textContent = m[1]; parent.append(c); }
    else if (m[2] != null || m[3] != null) { const b = el("strong"); inline(b, m[2] ?? m[3]); parent.append(b); }
    else if (m[4] != null || m[5] != null) { const e = el("em"); inline(e, m[4] ?? m[5]); parent.append(e); }
    else if (SAFE.test(m[7])) { const a = el("a"); a.href = m[7]; a.target = "_blank"; a.rel = "noopener noreferrer"; inline(a, m[6]); parent.append(a); }
    else parent.append(m[0]);
    i = re.lastIndex;
  }
  if (i < s.length) parent.append(s.slice(i));
}

const lines = (parent, ls) => ls.forEach((l, k) => { if (k) parent.append(el("br")); inline(parent, l); });

/** the whole text as a fragment of blocks */
export function renderMd(text) {
  const out = document.createDocumentFragment(), src = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
  let para = [], list = null, code = null;
  const flush = () => { if (para.length) { const p = el("p"); lines(p, para); out.append(p); para = []; } };
  const li = (ol, first) => { if (!list || list.ol !== ol) { flush(); list = { ol, node: el(ol ? "ol" : "ul") }; out.append(list.node); } const x = el("li"); x.__ls = [first]; list.node.append(x); return x; };
  const redo = x => { x.textContent = ""; lines(x, x.__ls); };
  for (const raw of src) {
    if (code) { if (/^\s*```/.test(raw)) code = null; else { code.textContent += (code.textContent ? "\n" : "") + raw; } continue; }
    if (/^\s*```/.test(raw)) { flush(); list = null; const pre = el("pre"); code = el("code"); pre.append(code); out.append(pre); continue; }
    let m;
    if (!raw.trim()) { flush(); continue; }   // a blank line ends a paragraph; a list may go on after it
    if ((m = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(raw))) { flush(); list = null; const p = el("p", "md-h"); const b = el("strong"); inline(b, m[2]); p.append(b); out.append(p); continue; }
    if ((m = /^\s*[-*+]\s+(.*)$/.exec(raw))) { flush(); const x = li(false, m[1]); redo(x); continue; }
    if ((m = /^\s*\d{1,3}[.)]\s+(.*)$/.exec(raw))) { flush(); const x = li(true, m[1]); redo(x); continue; }
    if (list && /^\s+\S/.test(raw) && list.node.lastChild) { const x = list.node.lastChild; x.__ls.push(raw.trim()); redo(x); continue; }   // a wrapped list line
    list = null; para.push(raw.trim());
  }
  flush();
  return out;
}

/** put `text` into `node` as markdown (drawn again whole on each chunk) */
export function setMd(node, text) { node.textContent = ""; node.append(renderMd(text)); node.classList.add("md"); return node; }
