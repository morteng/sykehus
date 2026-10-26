// Markdown for a model's answer (U3681): one renderer for the apps that show a model's text. Built with createElement and
// text nodes only, never innerHTML, so no HTML in the text can reach the page (`<script>` is the words «<script>»). No
// dependency. It draws: paragraphs, # headings (h1-h6, class md-h), - * + and 1. lists (nested, an ordered one keeps its
// start), > quotes, fenced code, --- rules, GFM tables, and inline `code`, **bold**, __bold__, *italic*, _italic_, ~~strike~~,
// [text](url), <url>, a bare http(s):// or www. address, and \-escapes. A link takes http(s) and mailto only (anything
// else stays as the text it was written as) and opens in a new tab with rel="noopener noreferrer". An image is drawn only
// when the app hands `image` (the app decides what a picture from a model may fetch); without it the alt text stays.
// A half-written mark (a stream) stays plain until its closing mark arrives, so each chunk can be drawn again from the whole
// text. A numbered line that follows a line of text starts a list at once (the model writes «**T.N.T.**\n9. a»), and a line
// that is only «4.» is the text «4.», not an empty list item.
const SAFE = /^(https?:\/\/|mailto:)/i;
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const HEAD = /^\s{0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
const RULE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const BULLET = /^(\s*)([-*+])\s+(\S.*)$/;
const NUMBER = /^(\s*)(\d{1,9})[.)]\s+(\S.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const URL_PART = String.raw `<?((?:[^()\s<>]|\([^()\s]*\))*)>?`;
const INLINE = new RegExp([
    String.raw `\\([\\\x60*_{}\[\]()#+\-.!~|<>])`, // 1 escape
    String.raw `\x60([^\x60\n]+)\x60`, // 2 code
    String.raw `!\[([^\]\n]*)\]\(${URL_PART}(?:\s+"[^"\n]*")?\)`, // 3 alt, 4 src
    String.raw `\[([^\]\n]*)\]\(${URL_PART}(?:\s+"[^"\n]*")?\)`, // 5 text, 6 href
    String.raw `<((?:https?:\/\/|mailto:)[^\s<>]+)>`, // 7 autolink
    String.raw `\*\*(?=\S)(.+?)\*\*|__(?=\S)(.+?)__`, // 8, 9 bold
    String.raw `~~(?=\S)(.+?)~~`, // 10 strike
    String.raw `\*(?=[^\s*])([^*\n]+?)\*(?!\*)|_(?=[^\s_])([^_\n]+?)_(?!\w)`, // 11, 12 italic
    String.raw `\b((?:https?:\/\/|www\.)[^\s<>]+)`, // 13 bare address
].join("|"), "g");
const el = (c, tag, cls) => {
    const e = c.doc.createElement(tag);
    if (cls)
        e.className = cls;
    return e;
};
/** Text with the paragraph's newlines as the app wants them (a space, or a <br>). */
function text(c, parent, s) {
    if (!s)
        return;
    if (!s.includes("\n"))
        return void parent.appendChild(c.doc.createTextNode(s));
    s.split("\n").forEach((part, k) => {
        if (k)
            parent.appendChild(c.opts.breaks ? el(c, "br") : c.doc.createTextNode("\n"));
        if (part)
            parent.appendChild(c.doc.createTextNode(part));
    });
}
/** An address a link may have, or null. The app may rewrite it first (`href`); the allowlist then has the last word. */
function safeHref(c, raw) {
    const given = c.opts.href ? c.opts.href(raw) : raw;
    if (given == null)
        return null;
    // eslint-disable-next-line no-control-regex
    return SAFE.test(given) && !/[\u0000-\u001f\u007f\s]/.test(given) ? given : null;
}
function anchor(c, href) {
    const a = el(c, "a");
    a.setAttribute("href", href);
    a.setAttribute("target", "_blank");
    a.setAttribute("rel", "noopener noreferrer");
    return a;
}
/** The inline marks of `s` into `parent`. A link's own text holds no other link. */
function inline(c, parent, s, inLink = false) {
    let i = 0;
    for (const m of s.matchAll(INLINE)) {
        const at = m.index ?? 0;
        if (at < i)
            continue;
        text(c, parent, s.slice(i, at));
        i = at + m[0].length;
        if (m[1] != null) {
            parent.appendChild(c.doc.createTextNode(m[1]));
        }
        else if (m[2] != null) {
            const code = el(c, "code");
            code.textContent = m[2];
            parent.appendChild(code);
        }
        else if (m[3] != null) {
            const src = safeHref(c, m[4] ?? "");
            const pic = src && c.opts.image ? c.opts.image(m[3], src, c.doc) : null;
            parent.appendChild(pic ?? c.doc.createTextNode(m[3]));
        }
        else if (m[5] != null) {
            const href = inLink ? null : safeHref(c, m[6] ?? "");
            if (href == null) {
                text(c, parent, inLink ? m[5] : m[0]);
                continue;
            }
            const a = anchor(c, href);
            inline(c, a, m[5], true);
            parent.appendChild(a);
        }
        else if (m[7] != null) {
            if (inLink) {
                text(c, parent, m[0]);
                continue;
            }
            const a = anchor(c, m[7]);
            a.textContent = m[7];
            parent.appendChild(a);
        }
        else if (m[8] != null || m[9] != null) {
            if (m[9] != null && /\w/.test(s[at - 1] ?? "")) {
                text(c, parent, m[0]);
                continue;
            }
            const b = el(c, "strong");
            inline(c, b, (m[8] ?? m[9]), inLink);
            parent.appendChild(b);
        }
        else if (m[10] != null) {
            const d = el(c, "del");
            inline(c, d, m[10], inLink);
            parent.appendChild(d);
        }
        else if (m[11] != null || m[12] != null) {
            if (m[12] != null && /\w/.test(s[at - 1] ?? "")) {
                text(c, parent, m[0]);
                continue;
            }
            const e = el(c, "em");
            inline(c, e, (m[11] ?? m[12]), inLink);
            parent.appendChild(e);
        }
        else if (m[13] != null) {
            let url = m[13];
            for (;;) {
                const cut = /[.,;:!?'"*_~]$/.test(url) || (url.endsWith(")") && (url.match(/\(/g) ?? []).length < (url.match(/\)/g) ?? []).length);
                if (!cut)
                    break;
                url = url.slice(0, -1);
            }
            i = at + url.length;
            const href = inLink ? null : safeHref(c, /^www\./i.test(url) ? `https://${url}` : url);
            if (href == null) {
                text(c, parent, url);
                continue;
            }
            const a = anchor(c, href);
            a.textContent = url;
            parent.appendChild(a);
        }
    }
    text(c, parent, s.slice(i));
}
const indentOf = (line) => /^ */.exec(line)[0].length;
const cells = (line) => line.trim().replace(/\\\|/g, "\u0000").replace(/^\|/, "").replace(/\|$/, "").split("|").map((x) => x.trim().replace(/\u0000/g, "|"));
const isTableAt = (ls, i) => i + 1 < ls.length && ls[i].includes("|") && TABLE_SEP.test(ls[i + 1]) && ls[i + 1].includes("-") && cells(ls[i]).length === cells(ls[i + 1]).length;
const startsBlock = (ls, i) => {
    const l = ls[i];
    return FENCE.test(l) || HEAD.test(l) || RULE.test(l) || QUOTE.test(l) || BULLET.test(l) || NUMBER.test(l) || isTableAt(ls, i);
};
function blocks(c, parent, ls) {
    let i = 0;
    while (i < ls.length) {
        const line = ls[i];
        let m;
        if (!line.trim()) {
            i++;
        }
        else if ((m = FENCE.exec(line))) {
            const mark = m[1];
            const body = [];
            const close = new RegExp(`^\\s{0,3}${mark[0] === "~" ? "~" : "\\x60"}{${mark.length},}\\s*$`);
            for (i++; i < ls.length && !close.test(ls[i]); i++)
                body.push(ls[i]);
            i++; // the closing fence; an unclosed one runs to the end (a stream)
            const pre = el(c, "pre");
            const code = el(c, "code");
            code.textContent = body.join("\n");
            pre.appendChild(code);
            parent.appendChild(pre);
        }
        else if ((m = HEAD.exec(line))) {
            const h = el(c, `h${m[1].length}`, "md-h");
            inline(c, h, m[2]);
            parent.appendChild(h);
            i++;
        }
        else if (RULE.test(line)) {
            parent.appendChild(el(c, "hr"));
            i++;
        }
        else if (QUOTE.test(line)) {
            const inner = [];
            for (; i < ls.length && (m = QUOTE.exec(ls[i])); i++)
                inner.push(m[1]);
            const q = el(c, "blockquote");
            blocks(c, q, inner);
            parent.appendChild(q);
        }
        else if (BULLET.test(line) || NUMBER.test(line)) {
            i = list(c, parent, ls, i);
        }
        else if (isTableAt(ls, i)) {
            const table = el(c, "table");
            const head = el(c, "tr");
            for (const h of cells(line))
                inline(c, head.appendChild(el(c, "th")), h);
            table.appendChild(el(c, "thead")).appendChild(head);
            const body = table.appendChild(el(c, "tbody"));
            for (i += 2; i < ls.length && ls[i].trim() && ls[i].includes("|"); i++) {
                const tr = body.appendChild(el(c, "tr"));
                for (const d of cells(ls[i]))
                    inline(c, tr.appendChild(el(c, "td")), d);
            }
            parent.appendChild(table);
        }
        else {
            const para = [line.trim()];
            for (i++; i < ls.length && ls[i].trim() && !startsBlock(ls, i); i++)
                para.push(ls[i].trim());
            inline(c, parent.appendChild(el(c, "p")), para.join("\n"));
        }
    }
}
/** One list (and the lists inside its items) from line `i`; returns the line after it. */
function list(c, parent, ls, i) {
    const first = (BULLET.exec(ls[i]) ?? NUMBER.exec(ls[i]));
    const ordered = NUMBER.test(ls[i]) && !BULLET.test(ls[i]);
    const base = first[1].length;
    const node = el(c, ordered ? "ol" : "ul");
    if (ordered && Number(first[2]) !== 1)
        node.setAttribute("start", first[2]);
    parent.appendChild(node);
    while (i < ls.length) {
        const m = ordered ? NUMBER.exec(ls[i]) : BULLET.exec(ls[i]);
        if (!m || m[1].length > base + 1)
            break;
        const item = [m[3]];
        for (i++; i < ls.length; i++) {
            const l = ls[i];
            if (!l.trim()) {
                // a blank line holds the item only when more of it follows, indented
                const next = ls.slice(i + 1).find((x) => x.trim());
                if (next !== undefined && indentOf(next) >= base + 2) {
                    item.push("");
                    continue;
                }
                break;
            }
            if (indentOf(l) >= base + 2)
                item.push(l.slice(Math.min(indentOf(l), base + 2)));
            else if (!startsBlock(ls, i) && item[item.length - 1] !== "")
                item.push(l.trim()); // a wrapped line
            else
                break;
        }
        const li = node.appendChild(el(c, "li"));
        blocks(c, li, item);
        if (!item.includes(""))
            for (const p of Array.from(li.children))
                if (p.nodeName === "P")
                    p.replaceWith(...Array.from(p.childNodes)); // a tight item is its text, not a paragraph
        while (i < ls.length && !ls[i].trim() && ls.slice(i + 1).find((x) => x.trim()) !== undefined && (ordered ? NUMBER : BULLET).test(ls.slice(i + 1).find((x) => x.trim())))
            i++;
    }
    return i;
}
/** The whole text as a fragment of blocks. */
export function renderMarkdown(src, opts = {}) {
    const doc = opts.doc ?? document;
    const out = doc.createDocumentFragment();
    blocks({ doc, opts }, out, String(src ?? "").replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n"));
    return out;
}
/** Put `src` into `node` as markdown (drawn again whole on each chunk of a stream); `node` gets the class md. */
export function setMarkdown(node, src, opts = {}) {
    node.replaceChildren(renderMarkdown(src, { doc: node.ownerDocument, ...opts }));
    node.classList.add("md");
    return node;
}
