/**
 * extract-error-message — surface the real reason behind a thrown value.
 *
 * supabase-js throws plain `PostgrestError` objects (`{ message, code, hint,
 * details }`) and edge-function failures (`FunctionsHttpError` /
 * `FunctionsRelayError`) which are not `Error` instances. The classic
 * `err instanceof Error ? err.message : "Something went wrong"` pattern
 * silently swallows the real reason and produces opaque toasts.
 *
 * This helper extracts the most informative human-readable message from any
 * thrown value and classifies it so callers can surface friendly, actionable
 * copy without losing the underlying `code`.
 *
 * Pure TS; no React, no Supabase imports. Fully unit-tested.
 */

export type ErrorKind =
  | "transient" // network/timeout/PGRST002 — safe to retry
  | "rls" // 42501 / row-level security
  | "validation" // 23xxx / check constraints / zod
  | "not_found" // PGRST116 / 404
  | "unknown";

export interface ExtractedError {
  /** Friendly, user-facing message — never opaque, always actionable. */
  message: string;
  /** Optional secondary line for toast `description`. Includes raw code. */
  description?: string;
  /** Raw upstream code if we could find one (e.g. "PGRST002", "42501"). */
  code?: string;
  /** Classification for retry / UI mapping. */
  kind: ErrorKind;
}

// Codes we know are safe to retry. Strings so we match both Postgres SQLSTATE
// and PostgREST string codes.
const TRANSIENT_CODES = new Set([
  "PGRST002", // schema cache miss, retrying
  "57014", // statement_timeout
  "08006", // connection_failure
  "08003", // connection_does_not_exist
  "08001", // sqlclient_unable_to_establish_sqlconnection
  "53300", // too_many_connections
  "40001", // serialization_failure
  "40P01", // deadlock_detected
  "503",
  "504",
  "522",
  "524",
]);

const TRANSIENT_MESSAGE_PATTERNS: RegExp[] = [
  /upstream request timeout/i,
  /fetch failed/i,
  /network ?error/i,
  /failed to fetch/i,
  /load failed/i,
  /timeout/i,
  /econnreset/i,
  /etimedout/i,
  /service unavailable/i,
  /bad gateway/i,
  /gateway timeout/i,
];

const RLS_PATTERNS: RegExp[] = [/row-level security/i, /violates row-level/i, /permission denied for/i];

interface PossibleErrorShape {
  message?: unknown;
  code?: unknown;
  hint?: unknown;
  details?: unknown;
  status?: unknown;
  error?: unknown;
  error_description?: unknown;
  msg?: unknown;
  name?: unknown;
  context?: unknown;
  cause?: unknown;
}

function asStr(v: unknown): string | undefined {
  if (typeof v === "string" && v.trim()) return v;
  if (typeof v === "number") return String(v);
  return undefined;
}

function rawMessageFrom(err: unknown): string | undefined {
  if (err == null) return undefined;
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  if (typeof err === "object") {
    const e = err as PossibleErrorShape;
    const direct =
      asStr(e.message) ?? asStr(e.error_description) ?? asStr(e.msg);
    if (direct) return direct;
    // { error: { message } } envelope
    if (e.error && typeof e.error === "object") {
      const nested = rawMessageFrom(e.error);
      if (nested) return nested;
    }
    if (typeof e.error === "string") return e.error;
    if (e.cause) {
      const causeMsg = rawMessageFrom(e.cause);
      if (causeMsg) return causeMsg;
    }
  }
  return undefined;
}

function rawCodeFrom(err: unknown): string | undefined {
  if (err == null || typeof err !== "object") return undefined;
  const e = err as PossibleErrorShape;
  const direct = asStr(e.code) ?? asStr(e.status);
  if (direct) return direct;
  if (e.error && typeof e.error === "object") {
    const nested = rawCodeFrom(e.error);
    if (nested) return nested;
  }
  if (e.cause) {
    const nested = rawCodeFrom(e.cause);
    if (nested) return nested;
  }
  return undefined;
}

export function classifyError(err: unknown): ErrorKind {
  const code = rawCodeFrom(err);
  const msg = rawMessageFrom(err) ?? "";
  if (code && TRANSIENT_CODES.has(code)) return "transient";
  if (TRANSIENT_MESSAGE_PATTERNS.some((re) => re.test(msg))) return "transient";
  if (code === "42501") return "rls";
  if (RLS_PATTERNS.some((re) => re.test(msg))) return "rls";
  if (code === "PGRST116") return "not_found";
  if (code && /^23\d{3}$/.test(code)) return "validation";
  if (/violates check constraint/i.test(msg)) return "validation";
  return "unknown";
}

/**
 * Decide whether a thrown value is worth a retry.
 * Pure function; safe to use inside service-layer retry loops.
 */
export function isTransientError(err: unknown): boolean {
  return classifyError(err) === "transient";
}

export function extractErrorMessage(err: unknown, fallback = "Something went wrong"): ExtractedError {
  const raw = rawMessageFrom(err);
  const code = rawCodeFrom(err);
  const kind = classifyError(err);

  let message: string;
  switch (kind) {
    case "transient":
      message =
        "We couldn't reach the database just now. Your draft is kept locally — please try again.";
      break;
    case "rls":
      message =
        "Your account doesn't have permission to do that. If you think this is wrong, ask an admin to check your role.";
      break;
    case "not_found":
      message = "We couldn't find what you were looking for. It may have been moved or deleted.";
      break;
    case "validation":
      message = raw ?? "Some fields don't look right. Please review and try again.";
      break;
    default:
      message = raw ?? fallback;
  }

  const description = code
    ? `Reference: ${code}${raw && raw !== message ? ` — ${raw}` : ""}`
    : raw && raw !== message
      ? raw
      : undefined;

  return { message, description, code, kind };
}
