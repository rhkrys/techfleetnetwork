/**
 * Classify auth errors into actionable categories so LoginPage can render
 * honest, recovery-focused messaging and only penalize the user (device
 * lockout + server rate-limit increment) on confirmed credential rejects.
 *
 * AUTH-VICHEA-FIX (2026-06-09): classifier is now CODE-FIRST. It recognises
 * typed error classes (ClientSessionWriteError) and server-issued codes
 * (`invalid_credentials`) BEFORE falling back to message-string matching.
 * The string "invalid login response" used to map to INVALID_CREDENTIALS
 * via the bare "invalid login" pattern — that pattern has been removed.
 * Only explicit credential phrases match now.
 *
 * See LCL-FIX-003 / LCL-FIX-005 / AUTH-VICHEA-001.
 */
import { isAuthThrottleCaptchaError } from "@/lib/auth-throttle-captcha";
import { isClientSessionWriteError } from "@/lib/auth/session-health";

export type AuthErrorKind =
  | "INVALID_CREDENTIALS"
  | "CAPTCHA_REQUIRED"
  | "CAPTCHA_FAILED"
  | "RATE_LIMITED"
  | "DOMAIN_INVALID"
  | "SESSION_INCOMPLETE"
  | "CLIENT_SESSION_WRITE_FAILED"
  | "NETWORK"
  | "SERVER"
  | "UNKNOWN";

export interface ClassifiedAuthError {
  kind: AuthErrorKind;
  message: string;
  /** True only for INVALID_CREDENTIALS — controls lockout/rate-limit increments. */
  countsAgainstUser: boolean;
}

// AUTH-VICHEA-FIX: removed bare "invalid login" — too broad, matched the
// client-side ClientSessionWriteError message ("Invalid login response").
// Use explicit credential-only phrases. Server `invalid_credentials` code is
// matched via codeOf() above and never reaches this list.
const CRED_PATTERNS = [
  "invalid login credentials",
  "invalid credentials",
  "invalid email or password",
  "email and password didn't match",
  "incorrect email or password",
];

const DOMAIN_PATTERNS = [
  "use an email address with a real domain",
  "real domain",
];

const CAPTCHA_FAILED_PATTERNS = [
  "verification didn't complete",
  "captcha verification failed",
  "turnstile",
];

const CAPTCHA_REQUIRED_PATTERNS = [
  "complete the human verification",
  "captcha_required",
];

const RATE_PATTERNS = [
  "too many",
  "rate limit",
  "temporarily locked",
];

const NETWORK_PATTERNS = [
  "failed to fetch",
  "network error",
  "load failed",
  "fetch failed",
  "networkerror",
  // NOTE: do NOT add "sign-in didn't complete" here — that phrase belongs to
  // ClientSessionWriteError, which is matched earlier via isClientSessionWriteError().
  // Keeping it here would misclassify the typed error as a network failure and
  // strip the recovery copy.
];

function messageOf(err: unknown): string {
  if (!err) return "";
  if (err instanceof Error) return err.message ?? "";
  if (typeof err === "string") return err;
  const m = (err as { message?: unknown }).message;
  return typeof m === "string" ? m : "";
}

function statusOf(err: unknown): number | undefined {
  const s = (err as { status?: unknown }).status;
  return typeof s === "number" ? s : undefined;
}

function codeOf(err: unknown): string | undefined {
  const c = (err as { code?: unknown }).code;
  return typeof c === "string" ? c : undefined;
}

export function classifyAuthError(err: unknown): ClassifiedAuthError {
  const raw = messageOf(err);
  const msg = raw.toLowerCase();
  const status = statusOf(err);
  const code = codeOf(err);

  // AUTH-VICHEA-001: CODE-FIRST — a client-side session-write failure is
  // recognised by its typed class, never by message text. It must NEVER
  // count against the user (no lockout, no rate-limit increment, no CAPTCHA
  // refresh-as-penalty). Returning SESSION_INCOMPLETE keeps the existing UX
  // copy path while ensuring countsAgainstUser stays false.
  if (isClientSessionWriteError(err)) {
    return {
      kind: "CLIENT_SESSION_WRITE_FAILED",
      message: "The password was accepted, but the browser did not store the session. We refreshed verification so the next sign-in can continue.",
      countsAgainstUser: false,
    };
  }

  // Server-issued credential rejection (typed code from the auth backend).
  // Match BEFORE any message-based heuristics so backend taxonomy wins.
  if (code === "invalid_credentials" || code === "INVALID_CREDENTIALS") {
    return {
      kind: "INVALID_CREDENTIALS",
      message: "That email and password didn't match. Double-check, or use one of the recovery options below.",
      countsAgainstUser: true,
    };
  }

  if (isAuthThrottleCaptchaError(err)) {
    return {
      kind: "RATE_LIMITED",
      message:
        "Too many sign-in attempts in a short window. Complete the verification below and try again.",
      countsAgainstUser: false,
    };
  }

  if (DOMAIN_PATTERNS.some((p) => msg.includes(p))) {
    return {
      kind: "DOMAIN_INVALID",
      message:
        "We couldn't recognize that email's domain. Double-check the address and try again.",
      countsAgainstUser: false,
    };
  }

  if (CRED_PATTERNS.some((p) => msg.includes(p))) {
    return {
      kind: "INVALID_CREDENTIALS",
      message:
        "That email and password didn't match. Double-check, or use one of the recovery options below.",
      countsAgainstUser: true,
    };
  }

  if (CAPTCHA_FAILED_PATTERNS.some((p) => msg.includes(p))) {
    return {
      kind: "CAPTCHA_FAILED",
      message:
        "Verification didn't complete. Refresh the check below and try again.",
      countsAgainstUser: false,
    };
  }

  if (CAPTCHA_REQUIRED_PATTERNS.some((p) => msg.includes(p))) {
    return {
      kind: "CAPTCHA_REQUIRED",
      message: "Complete the human verification below before signing in.",
      countsAgainstUser: false,
    };
  }

  if (status === 429 || RATE_PATTERNS.some((p) => msg.includes(p))) {
    return {
      kind: "RATE_LIMITED",
      message:
        raw ||
        "This account is temporarily locked after multiple failed sign-ins. Try again in a few minutes, or reset your password.",
      countsAgainstUser: false,
    };
  }

  if (NETWORK_PATTERNS.some((p) => msg.includes(p)) || status === 0) {
    return {
      kind: "NETWORK",
      message:
        "We couldn't reach the sign-in service. Check your connection and try again.",
      countsAgainstUser: false,
    };
  }

  if (typeof status === "number" && status >= 500) {
    return {
      kind: "SERVER",
      message:
        "The sign-in service hit a snag. Please try again in a moment.",
      countsAgainstUser: false,
    };
  }

  if (msg.includes("sign-in didn't complete") || msg.includes("session didn't finish")) {
    return {
      kind: "SESSION_INCOMPLETE",
      message: "The password was accepted, but the browser did not store the session. We refreshed verification so the next sign-in can continue.",
      countsAgainstUser: false,
    };
  }

  return {
    kind: "UNKNOWN",
    message: raw || "Something went wrong. Please try again.",
    countsAgainstUser: false,
  };
}

// AUTH-ENGINE Ship 6: re-export the canonical client-session-write helpers
// so legacy tests keep a single import surface.
export {
  isClientSessionWriteError,
  type ClientSessionWriteError,
} from "@/lib/auth/session-health";
