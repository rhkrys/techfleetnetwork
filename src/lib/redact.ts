/**
 * Central PII redaction (ADR-0021, Phase 0b redaction fix).
 *
 * One owner for the redaction rule so the logger and the error reporter can never
 * drift apart on what counts as sensitive. Strips emails, JWTs, and bearer tokens
 * from free text before it is logged or written to `audit_log`.
 *
 * Pattern SOURCES are exported (not shared RegExp objects) so each caller builds
 * its own instance with the flags it needs — no shared mutable `lastIndex` leaks
 * between callers.
 */

// user@host.tld
export const EMAIL_SOURCE = "[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}";
// A JWT: `eyJ`-prefixed header.payload.signature, each base64url.
export const JWT_SOURCE = "\\beyJ[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\b";
// `Bearer <token>` (Authorization header value leaking into a message/stack).
export const BEARER_SOURCE = "\\b[Bb]earer\\s+[A-Za-z0-9._~+/=-]+";

/**
 * Redact PII from free text before logging or persisting it. JWT/bearer are
 * redacted before email so a token that happens to embed an @ is caught as a token.
 */
export function redactText(value: string): string {
  if (!value) return value;
  return value
    .replace(new RegExp(JWT_SOURCE, "g"), "[redacted-jwt]")
    .replace(new RegExp(BEARER_SOURCE, "g"), "Bearer [redacted]")
    .replace(new RegExp(EMAIL_SOURCE, "gi"), "[redacted-email]");
}
