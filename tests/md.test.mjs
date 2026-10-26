/* U3680: Anton's answers as markdown: marks, lists, safety, the chat's wiring */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/* a small stand-in for the DOM (no jsdom in this repo): enough to build and print what md.js builds */
const esc = t => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
class Node_ {
  constructor(tag) { this.tag = tag; this.kids = []; this.attrs = {}; this.classList = { add: c => { this.className = [this.className, c].filter(Boolean).join(" "); } }; }
  append(...xs) { for (const x of xs) { if (x instanceof Node_ && x.tag === "#frag") this.kids.push(...x.kids); else this.kids.push(typeof x === "string" ? x : x); } }
  set textContent(t) { this.kids = t === "" ? [] : [String(t)]; }
  get textContent() { return this.kids.map(k => typeof k === "string" ? k : k.textContent).join(""); }
  get lastChild() { return this.kids.at(-1); }
  set href(v) { this.attrs.href = v; } set target(v) { this.attrs.target = v; } set rel(v) { this.attrs.rel = v; }
  get innerHTML() { return this.kids.map(k => typeof k === "string" ? esc(k) : k.outer).join(""); }
  get outer() {
    if (this.tag === "br") return "<br>";
    const a = { ...(this.className ? { class: this.className } : {}), ...this.attrs };
    return `<${this.tag}${Object.entries(a).map(([k, v]) => ` ${k}="${esc(v)}"`).join("")}>${this.innerHTML}</${this.tag}>`;
  }
}
globalThis.document = { createElement: t => new Node_(t), createDocumentFragment: () => new Node_("#frag") };
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
  assert.equal(html("## Tittel\ntekst"), '<p class="md-h"><strong>Tittel</strong></p><p>tekst</p>');
  assert.equal(html("linje én\nlinje to\n\nny"), "<p>linje én<br>linje to</p><p>ny</p>");
  assert.equal(html("snake_case_name og 2*3*4"), "<p>snake_case_name og 2<em>3</em>4</p>");
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
  assert.match(a, /cls === "from-asst"\) \{ t\.raw = text; setMd\(t, text\)/);
  assert.match(a, /b\.raw \+= t\.delta \|\| ""; setMd\(b, b\.raw\)/);
  assert.match(a, /showReply\(text, true\)/, "an error stays plain");
  assert.match(a, /else t\.textContent = text/, "from-me stays text");
});
