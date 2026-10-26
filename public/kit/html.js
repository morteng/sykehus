// String markup helpers. Every piece that a server also draws (the twin) is built as a string here, so the server's copy
// and the kit's can be compared byte for byte (dist/item.sample.json). Every text goes through esc().
/** Escapes text for an HTML text node or a double-quoted attribute, as Python's html.escape(x, quote=True) does. */
export function esc(x) {
    return String(x).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
}
/** ` name="value"` for each set attribute, in the given order; `true` writes the bare name, false/undefined/null nothing. */
export function attrs(a) {
    let out = "";
    for (const [k, v] of Object.entries(a)) {
        if (v === undefined || v === null || v === false)
            continue;
        out += v === true ? ` ${k}` : ` ${k}="${esc(v)}"`;
    }
    return out;
}
/** The elements a markup string makes, in a document (a template keeps scripts inert). */
export function fragment(markup, doc = document) {
    const t = doc.createElement("template");
    t.innerHTML = markup;
    return t.content;
}
/** The one element a markup string makes. */
export function element(markup, doc = document) {
    const el = fragment(markup, doc).firstElementChild;
    if (!el)
        throw new Error("the markup makes no element");
    return el;
}
