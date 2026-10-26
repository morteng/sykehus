/* U3680, U3681: Anton's answers as markdown. The renderer is the kit's (kit/markdown.js, taken by sha: uikit.lock.json), the
   one copy the other apps use too: built with createElement and text nodes only, never innerHTML, a link takes http(s) and
   mailto only, an image is not drawn. This file only says what this page wants of it: a single newline is a line break. */
import { renderMarkdown, setMarkdown } from "./kit/markdown.js";

const OPTS = { breaks: true };
/** the whole text as a fragment of blocks */
export const renderMd = (text) => renderMarkdown(text, OPTS);
/** put `text` into `node` as markdown (drawn again whole on each chunk) */
export const setMd = (node, text) => setMarkdown(node, text, OPTS);
