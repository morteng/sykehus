// The one table of upload caps (U3992). An app that takes a file from a person reads its limit here, so the page, the server and
// the words in the refusal say the same number. Bytes. A cap is for the file a person hands in, not for what the app keeps.
export const UPLOAD_CAPS = {
    /** a photo of a real place a person brings in */
    sitePhoto: 8 * 1024 * 1024,
    /** a view a person sends to be made a realistic picture */
    render: 6 * 1024 * 1024,
    /** a screenshot attached to a note */
    wishPng: 1024 * 1024,
    /** a picture in a chat, and a person's own picture */
    chatPicture: 20 * 1024 * 1024,
    /** a document in a document room */
    document: 50 * 1024 * 1024,
    /** an IFC file brought into a project */
    ifc: 100 * 1024 * 1024,
};
/** The cap of one kind, in bytes. */
export function capOf(kind) {
    return UPLOAD_CAPS[kind];
}
/** The cap as words a person reads: «8 MB». */
export function capWords(kind) {
    const mb = UPLOAD_CAPS[kind] / (1024 * 1024);
    return mb >= 1 ? `${Math.round(mb)} MB` : `${Math.round(UPLOAD_CAPS[kind] / 1024)} KB`;
}
