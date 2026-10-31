// The one contract between an app and the household assistant's door (U3976): the numbers every app's server keeps to, and the
// sentence a page shows for each code the door (or the app's relay) answers with. A server that is not JavaScript reads the
// numbers from dist/assistant-door.sample.json (a test compares them). A language is a word list; the key set is not.
/** What an app's relay keeps to. Seconds unless the name says otherwise. */
export const DOOR = {
    /** messages that may wait for one thread */
    queueMax: 5,
    /** characters in one message */
    textMax: 4000,
    /** messages one person may send in `rateSeconds`, before the door's own limit */
    rateCount: 20,
    rateSeconds: 600,
    /** the door pings every `pingSeconds`; this long without a line means it is gone */
    silenceSeconds: 180,
    pingSeconds: 15,
    /** a 409 (another instance's turn runs) is retried, never shown: this many tries, this far apart */
    busyTries: 60,
    busyRetrySeconds: 3,
    /** a new conversation waits this many tries for a running turn to end */
    forgetTries: 20,
};
/** Every code a page may get, in one list. A code not here shows `internal`. */
export const DOOR_CODES = [
    "unavailable", "timeout", "limit", "queue_full", "too_long", "busy", "not_allowed", "approval_unknown", "approval_expired",
    "bad_request", "session_mismatch", "internal", "not_found", "gone", "answered", "already_done", "restart",
    /** a whole turn the door refuses this sign-in */
    "turn_not_allowed",
];
/** The sentences. `{name}` is the assistant's name, `{max}` the longest message. */
export const DOOR_WORDS = {
    en: {
        unavailable: "{name} is not reachable right now. Try again in a minute.",
        timeout: "{name} stopped answering. Try again.",
        limit: "Too many messages for now. Wait a few minutes.",
        queue_full: "Too many waiting messages. Wait for {name} to catch up.",
        too_long: "That message is too long ({max} characters at most).",
        busy: "{name} is still busy. Your message waits.",
        not_allowed: "Only the person who asked can do that.",
        approval_unknown: "That question has already been answered.",
        approval_expired: "That question expired. Ask again.",
        bad_request: "{name} could not read that message.",
        session_mismatch: "Something went wrong on the server. Reload the page.",
        internal: "Something went wrong on the server. Try again.",
        not_found: "That is no longer there.",
        gone: "No longer needed.",
        answered: "That question has already been answered.",
        already_done: "{name} has already made this change.",
        restart: "The server restarted in the middle of the answer. Send the message again.",
        turn_not_allowed: "{name} can’t work for this sign-in.",
    },
    nb: {
        unavailable: "{name} svarer ikke akkurat nå. Prøv igjen om et minutt.",
        timeout: "{name} sluttet å svare. Prøv igjen.",
        limit: "Mange meldinger på kort tid. Vent noen minutter.",
        queue_full: "Det venter allerede mange meldinger. Vent til {name} har svart.",
        too_long: "Meldingen er for lang (høyst {max} tegn).",
        busy: "{name} er opptatt. Meldingen din venter.",
        not_allowed: "Bare den som spurte kan gjøre det.",
        approval_unknown: "Spørsmålet er allerede besvart.",
        approval_expired: "Spørsmålet gikk ut. Spør på nytt.",
        bad_request: "{name} kunne ikke lese meldingen.",
        session_mismatch: "Noe gikk galt på serveren. Last siden på nytt.",
        internal: "Noe gikk galt. Prøv igjen.",
        not_found: "Det finnes ikke lenger.",
        gone: "Trengs ikke lenger.",
        answered: "Spørsmålet er allerede besvart.",
        already_done: "{name} har allerede gjort denne endringen.",
        restart: "Serveren startet på nytt midt i svaret. Send meldingen igjen.",
        turn_not_allowed: "{name} kan ikke jobbe for denne innloggingen.",
    },
};
/** The sentence for a code. The door's own sentence (`reason`) comes first; an unknown code reads as `internal`. `turn`: the
 *  code answers a whole turn (a `not_allowed` then means the assistant may not work for this sign-in). */
export function doorSentence(code, o) {
    if (o.reason)
        return o.reason;
    const words = DOOR_WORDS[o.lang];
    const key = (o.turn && code === "not_allowed" ? "turn_not_allowed" : code);
    const raw = DOOR_CODES.includes(key) ? words[key] : words.internal;
    return raw.replaceAll("{name}", o.name).replaceAll("{max}", String(DOOR.textMax));
}
