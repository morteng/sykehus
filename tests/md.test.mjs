/* U3680: Anton's answers as markdown: marks, lists, safety, the chat's wiring */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/* a small stand-in for the DOM (no jsdom in this repo): enough to build and print what the kit's markdown.js builds */
const esc = t => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
class Text_ { constructor(t) { this.tag = "#text"; this.nodeName = "#text"; this.data = String(t); this.parent = null; } get textContent() { return this.data; } get outer() { return esc(this.data); } replaceWith(...xs) { const k = this.parent.kids, i = k.indexOf(this); k.splice(i, 1, ...xs); xs.forEach(x => { x.parent = this.parent; }); } }
class Node_ {
  constructor(tag) { this.tag = tag; this.nodeName = tag.toUpperCase(); this.kids = []; this.attrs = {}; this.parent = null; this.className = ""; this.classList = { add: c => { this.className = [this.className, c].filter(Boolean).join(" "); } }; }
  get ownerDocument() { return globalThis.document; }
  appendChild(x) { if (x.tag === "#frag") { for (const k of x.kids.splice(0)) this.appendChild(k); } else { x.parent = this; this.kids.push(x); } return x; }
  append(...xs) { for (const x of xs) this.appendChild(typeof x === "string" ? new Text_(x) : x); }
  replaceChildren(...xs) { this.kids = []; this.append(...xs); }
  setAttribute(k, v) { this.attrs[k] = String(v); } getAttribute(k) { return this.attrs[k] ?? null; }
  set textContent(t) { this.kids = []; if (t !== "") this.appendChild(new Text_(t)); }
  get textContent() { return this.kids.map(k => k.textContent).join(""); }
  get childNodes() { return this.kids; } get children() { return this.kids.filter(k => k.tag !== "#text"); }
  replaceWith(...xs) { const k = this.parent.kids, i = k.indexOf(this); k.splice(i, 1, ...xs); xs.forEach(x => { x.parent = this.parent; }); }
  get innerHTML() { return this.kids.map(k => k.outer).join(""); }
  get outer() {
    if (this.tag === "br" || this.tag === "hr") return `<${this.tag}>`;
    const a = { ...(this.className ? { class: this.className } : {}), ...this.attrs };
    return `<${this.tag}${Object.entries(a).map(([k, v]) => ` ${k}="${esc(v)}"`).join("")}>${this.innerHTML}</${this.tag}>`;
  }
}
globalThis.document = { createElement: t => new Node_(t), createTextNode: t => new Text_(t), createDocumentFragment: () => new Node_("#frag") };
const { renderMd, setMd } = await import("../public/md.js");
const html = t => { const d = document.createElement("div"); d.append(renderMd(t)); return d.innerHTML; };

test("the text from the pill: bold heading line and a - list", () => {
  const h = html("**Vern og regulering**\n- Tre bygningslokaliteter i Rørosveien\n- Verneplan fra 1998");
  assert.equal(h, "<p><strong>Vern og regulering</strong></p><ul><li>Tre bygningslokaliteter i Rørosveien</li><li>Verneplan fra 1998</li></ul>");
  assert.ok(!h.includes("**") && !h.includes("- Tre"));
});
test("italic, inline code, numbered list, heading, line break, paragraphs", () => {
  assert.equal(html("a *skrå* og `kode` og _også_"), "<p>a <em>skrå</em> og <code>kode</code> og <em>også</em></p>");
  assert.equal(html("1. en\n2. to"), "<ol><li>en</li><li>to</li></ol>");
  assert.equal(html("## Tittel\ntekst"), '<h2 class="md-h">Tittel</h2><p>tekst</p>');
  assert.equal(html("linje én\nlinje to\n\nny"), "<p>linje én<br>linje to</p><p>ny</p>");
  assert.equal(html("snake_case_name og 2*3*4"), "<p>snake_case_name og 2*3*4</p>");   // the kit (U3892): a * between two letters or digits opens no emphasis
  assert.equal(html("a\n\n> sitat\n\n```\n<b>1</b>\n```"), "<p>a</p><blockquote><p>sitat</p></blockquote><pre><code>&lt;b&gt;1&lt;/b&gt;</code></pre>");
});
test("safe: HTML is text, links are http(s) and mailto only, with noopener, in a new tab", () => {
  assert.equal(html("<img src=x onerror=alert(1)><script>x</script>"), "<p>&lt;img src=x onerror=alert(1)&gt;&lt;script&gt;x&lt;/script&gt;</p>");
  assert.equal(html("[ja](https://a.no/x)"), '<p><a href="https://a.no/x" target="_blank" rel="noopener noreferrer">ja</a></p>');
  assert.ok(!html("[x](javascript:alert(1))").includes("<a"));
  assert.ok(!html("[**x**](data:text/html,hi)").includes("<a"));
  assert.ok(!html("**<b onclick=1>x</b>**").includes("<b "));
});
test("streaming: a half-written mark stays plain; the whole text drawn again after each chunk gives the finished form", () => {
  assert.equal(html("**Vern og"), "<p>**Vern og</p>");
  const n = document.createElement("div"); let raw = "";
  for (const c of ["**Vern", " og regulering**\n- Tre", " bygninger"]) { raw += c; setMd(n, raw); }
  assert.equal(n.innerHTML, "<p><strong>Vern og regulering</strong></p><ul><li>Tre bygninger</li></ul>");
});
test("anton.js draws Anton's text with the renderer and the person's own text as plain text", () => {
  const a = readFileSync(new URL("../public/anton.js", import.meta.url), "utf8");
  assert.match(a, /import \{ setMd \} from "\.\/md\.js/);
  const m = readFileSync(new URL("../public/md.js", import.meta.url), "utf8");
  assert.match(m, /from "\.\/kit\/markdown\.js"/, "the renderer is the kit's, not a second copy");
  assert.ok(!/innerHTML/.test(m.replace(/\/\*[\s\S]*?\*\//g, "")), "no innerHTML in the wrapper");
  assert.match(a, /cls === "from-asst"\) \{ t\.raw = text; setMd\(t, text\)/);
  assert.match(a, /b\.raw \+= t\.delta \|\| ""; setMd\(b, b\.raw\)/);
  assert.match(a, /showReply\(text, true\)/, "an error stays plain");
  assert.match(a, /else t\.textContent = text/, "from-me stays text");
});
