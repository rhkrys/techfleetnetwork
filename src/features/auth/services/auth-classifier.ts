import { type AuthErrorCode, isAuthErrorCode } from "../domain/auth-codes";

/**
 * Code-first classifier. Server is the source of truth; message strings
 * may NEVER produce `invalid_credentials` (the Vichea regression class).
 *
 * Accepted shapes:
 *   - { code: AuthErrorCode }                            broker / typed response
 *   - { status: number, body: { code: AuthErrorCode } }  HTTP layer
 *   - GoTrue AuthError with .code / .status              SDK fallback
 *   - Error with .name                                   client-side errors
 *   - unknown                                            → "unexpected"
 *
 * String matching is only used for transport-level signals (network /
 * service unavailable) and is FORBIDDEN from emitting `invalid_credentials`.
 */
const FORBIDDEN_STRING_CODES: ReadonlySet<AuthErrorCode> = new Set([
  "invalid_credentials",
  "account_locked",
  "rate_limited",
  "captcha_required",
  "mfa_invalid_code",
]);

function readCode(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const obj = value as Record<string, unknown>;
  if (typeof obj.code === "string") return obj.code;
  if (obj.body && typeof obj.body === "object" && typeof (obj.body as Record<string, unknown>).code === "string") {
    return (obj.body as Record<string, string>).code;
  }
  if (obj.error && typeof obj.error === "object" && typeof (obj.error as Record<string, unknown>).code === "string") {
    return (obj.error as Record<string, string>).code;
  }
  return undefined;
}

function readStatus(value: unknown): number | undefined {
  if (!value || typeof value !== "object") return undefined;
  const status = (value as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

function readName(value: unknown): string | undefined {
  if (value instanceof Error) return value.name;
  if (value && typeof value === "object" && typeof (value as { name?: unknown }).name === "string") {
    return (value as { name: string }).name;
  }
  return undefined;
}

/** Server codes (GoTrue / broker) aliased to canonical AuthErrorCode. */
const SERVER_CODE_ALIASES: Record<string, AuthErrorCode> = {
  email_exists: "account_exists",
  user_already_exists: "account_exists",
  email_address_already_registered: "account_exists",
  user_already_registered: "account_exists",
};

export function classifyAuthErrorCode(input: unknown): AuthErrorCode {
  // 1. Code-first: typed server response.
  const code = readCode(input);
  if (code) {
    if (isAuthErrorCode(code)) return code;
    if (SERVER_CODE_ALIASES[code]) return SERVER_CODE_ALIASES[code];
  }

  // 2. Client-side session write errors → ALWAYS non-punitive.
  const name = readName(input);
  if (name === "ClientSessionWriteError") {
    return "client_session_write_failed";
  }

  // 3. HTTP status fallback (server returned untyped error).
  const status = readStatus(input);
  if (status === 429) return "rate_limited";
  if (status === 401 || status === 403) return "invalid_credentials";
  if (status === 503) return "service_unavailable";

  // 4. Transport signals — string matching here is bounded and may NEVER
  //    emit a punitive code (enforced by FORBIDDEN_STRING_CODES below).
  const message = input instanceof Error ? input.message : typeof input === "string" ? input : "";
  if (/network|offline|failed to fetch/i.test(message)) {
    return safe("network_error");
  }
  if (/service unavailable|temporarily unavailable/i.test(message)) {
    return safe("service_unavailable");
  }

  return "unexpected";
}

/** Guard: string-matched paths can never produce a punitive code. */
function safe(candidate: AuthErrorCode): AuthErrorCode {
  if (FORBIDDEN_STRING_CODES.has(candidate)) {
    // Defensive: should be unreachable. Falls back to "unexpected" rather
    // than punishing a user from a message-string match.
    return "unexpected";
  }
  return candidate;
}
