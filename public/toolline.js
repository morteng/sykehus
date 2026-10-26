// A tool line in Anton's chat: its label, and the receipt gulden-ai sends beside it when the tool has one
// (gulden-no U3647: the Bygg checker's «Kontrollen fant 2 avvik · 0,04 $», cost included). Live and from the history.
export const toolLine = t => (t.receipt?.line ? `${t.label}: ${t.receipt.line}` : t.label);
