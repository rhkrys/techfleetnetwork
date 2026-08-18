// The /fleety Discord bot posts its answer into a public channel. Prepending "You asked: <question>"
// makes the reply self-contained -- but the question is raw user input, so echoing it verbatim would
// let a member ping @everyone, spoof formatting, or inject markdown into the channel. Neutralize it:
// defuse mentions, strip markdown control chars, collapse whitespace, bound length. Pure -> testable.
// Built with codepoint filtering + String.fromCharCode (no unicode literals) so the source is ASCII.

const ECHO_MAX = 280;
const ZWSP = String.fromCharCode(0x200b); // zero-width space (defuses @-mentions)
const ELLIPSIS = String.fromCharCode(0x2026);
const MARKDOWN = new Set(["`", "*", "_", "~", "|", ">", "\\"]);

export function sanitizeEcho(text: string, max = ECHO_MAX): string {
  const out: string[] = [];
  for (const ch of (text ?? "").normalize("NFKC")) {
    const c = ch.charCodeAt(0);
    if (c < 0x20 || (c >= 0x7f && c <= 0x9f)) {
      out.push(" "); // control char -> space
    } else if (ch === "@") {
      out.push("@" + ZWSP); // defuse @everyone/@here/<@id> pings
    } else if (!MARKDOWN.has(ch)) {
      out.push(ch); // drop Discord markdown control chars, keep the rest
    }
  }
  const clean = out.join("").replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return clean.slice(0, max).trimEnd() + ELLIPSIS;
}

/** Prepend a safe "You asked:" echo to the answer (skipped if the question is empty after cleaning). */
export function withQuestionEcho(question: string, answer: string): string {
  const q = sanitizeEcho(question);
  return q ? `**You asked:** ${q}\n\n${answer}` : answer;
}
