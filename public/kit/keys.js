// The editing keys of a drawing page, as one map (the same on a Mac and elsewhere): Backspace or Delete is «delete»,
// Cmd/Ctrl-Z is «undo», Shift-Cmd-Z, Ctrl-Shift-Z or Ctrl-Y is «redo». Nothing in a text field (input, textarea, select,
// contenteditable): the browser's own undo stays there. The app owns what each does (and its redo stack).
export function editKey(e) {
    if (e.defaultPrevented || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName ?? "") || e.target?.isContentEditable)
        return null;
    const k = String(e.key).toLowerCase(), mod = e.metaKey || e.ctrlKey;
    if (!mod)
        return k === "backspace" || k === "delete" ? "delete" : null;
    if (k === "z")
        return e.shiftKey ? "redo" : "undo";
    if (k === "y" && e.ctrlKey && !e.metaKey && !e.shiftKey)
        return "redo";
    return null;
}
