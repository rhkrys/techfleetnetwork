// Pure, dependency-free decision logic for the Resend webhook — extracted from
// index.ts so the security-relevant classification is unit-testable without the
// Deno runtime, Svix, or a database. No Deno/npm imports here on purpose.

export const SUPPRESS_EVENTS: Record<string, "bounce" | "complaint"> = {
  "email.bounced": "bounce",
  "email.complained": "complaint",
};

// Positive/transient signals — acknowledged (200) but NEVER restrict sending.
export const LOG_ONLY_EVENTS = new Set(["email.delivered", "email.delivery_delayed", "email.sent"]);

export type ResendAction =
  | { kind: "suppress"; reason: "bounce" | "complaint"; status: "bounced" | "complained" }
  | { kind: "log" }
  | { kind: "ignore" };

/** Map a Resend event type to what the webhook should do. Only HARD events suppress. */
export function classifyResendEvent(type: string): ResendAction {
  const reason = SUPPRESS_EVENTS[type];
  if (reason) {
    return { kind: "suppress", reason, status: reason === "bounce" ? "bounced" : "complained" };
  }
  if (LOG_ONLY_EVENTS.has(type)) return { kind: "log" };
  return { kind: "ignore" };
}

/** Resend `to` may be a string or string[]; return the first recipient, normalized. */
export function normalizeRecipient(to: string | string[] | undefined | null): string {
  const first = Array.isArray(to) ? to[0] : (to ?? "");
  return String(first ?? "")
    .trim()
    .toLowerCase();
}

/** Mask an email for logs so PII never lands in plaintext (info-disclosure control). */
export function redactEmail(email: string): string {
  const [local, domain] = String(email).split("@");
  if (!domain) return "***";
  return `${(local ?? "").slice(0, 1)}***@${domain}`;
}
