import { hasActiveXssPattern } from "@/lib/security";
import {
  isDisposableEmailDomain,
  isStrongPassword,
  normalizeEmailInput,
} from "@/lib/validators/auth";
import { createLogger } from "@/services/logger.service";

const log = createLogger("ClientInputFirewall");

// `malicious` separates an automated / attack-shaped payload (control chars,
// prototype-pollution keys, oversized or over-deep bodies) from an ordinary,
// correctable content problem (invalid email, weak or markup-containing
// password). Only the former arms the short session lock — a content problem
// must never dead-end every later request behind a generic "unsafe input" error.
type Verdict = { allowed: true } | { allowed: false; reason: string; malicious: boolean };

const BACKEND_PATH_PATTERN = /\/(auth|rest|functions)\/v1\//;
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH"]);
const MAX_JSON_BODY_BYTES = 250_000;
const MAX_TEXT_VALUE_BYTES = 50_000;
const MAX_ARRAY_ITEMS = 200;
const MAX_OBJECT_DEPTH = 12;
const ATTACK_LOCK_KEY = "tfn:client-input-firewall:attack-lock-until";
const ATTACK_LOCK_MS = 10 * 60_000;
const EMAIL_KEY_PATTERN = /(^|_|-)email($|_|-)/i;
const PASSWORD_KEY_PATTERN = /(^|_|-)password($|_|-)/i;
const EMAIL_PATTERN = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,63}$/i;
const DANGEROUS_EMAIL_CHARS = /[<>"'`\\\s]/;
const hasUnsafeControlChar = (value: string) => {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (
      (code >= 0 && code <= 8) ||
      code === 11 ||
      code === 12 ||
      (code >= 14 && code <= 31) ||
      code === 127
    )
      return true;
  }
  return false;
};

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function blocked(reason: string, malicious = false): Verdict {
  return { allowed: false, reason, malicious };
}

function lockBackendWritesForAttack() {
  try {
    window.sessionStorage.setItem(ATTACK_LOCK_KEY, String(Date.now() + ATTACK_LOCK_MS));
  } catch {
    // Storage can be unavailable in private/locked-down contexts; the current request is still blocked.
  }
}

function getAttackLockVerdict(): Verdict | null {
  try {
    const lockUntil = Number(window.sessionStorage.getItem(ATTACK_LOCK_KEY) || 0);
    if (lockUntil > Date.now())
      return blocked(
        "Unsafe input was detected. For your security this tab is paused briefly — open a new tab or private window to continue. (Refreshing this tab will not clear it.)",
        true
      );
    if (lockUntil) window.sessionStorage.removeItem(ATTACK_LOCK_KEY);
  } catch {
    return null;
  }
  return null;
}

function inspectString(key: string, value: string): Verdict {
  const isEmailKey = EMAIL_KEY_PATTERN.test(key);
  const isPasswordKey = PASSWORD_KEY_PATTERN.test(key);
  const normalizedEmail = isEmailKey ? normalizeEmailInput(value) : value;

  // Control characters / grossly oversized values are automated-attack-shaped —
  // a human form never emits them. These arm the session lock.
  if (byteLength(value) > MAX_TEXT_VALUE_BYTES) return blocked("Input is too long.", true);
  if (hasUnsafeControlChar(value))
    return blocked("Input contains invalid control characters.", true);

  // Ordinary, correctable content problems — reject THIS request with a
  // specific message, but never lock the session.
  if (
    isEmailKey &&
    value &&
    (DANGEROUS_EMAIL_CHARS.test(normalizedEmail) || !EMAIL_PATTERN.test(normalizedEmail))
  ) {
    return blocked("Enter a valid email address.");
  }
  if (isEmailKey && value && isDisposableEmailDomain(normalizedEmail)) {
    return blocked("Use a permanent email address, not a temporary inbox.");
  }
  if (isPasswordKey && value && !isStrongPassword(value)) {
    return blocked("Password does not meet the security requirements.");
  }

  // Defense-in-depth XSS/markup content check. Still refuses a match — but as a
  // correctable, NON-locking rejection. A password is a hashed credential that
  // is never rendered as HTML, so a hit there is almost always a legitimate
  // strong password containing '<' or ':'; we give a password-specific message
  // instead of dead-ending the whole session. For rendered fields (names, bio)
  // a match is a genuine stored-XSS attempt and is likewise refused here, with
  // the server-side deepSanitize + output encoding as the authoritative wall.
  if (hasActiveXssPattern(value)) {
    return blocked(
      isPasswordKey
        ? 'Your password can\'t include markup like < >, "javascript:", or on…= sequences. Please choose a different password.'
        : "Input contains unsafe content."
    );
  }
  return { allowed: true };
}

function inspectValue(value: unknown, key = "", depth = 0): Verdict {
  if (depth > MAX_OBJECT_DEPTH) return blocked("Input is too deeply nested.", true);
  if (typeof value === "string") return inspectString(key, value);
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_ITEMS) return blocked("Input has too many items.", true);
    for (const item of value) {
      const verdict = inspectValue(item, key, depth + 1);
      if (!verdict.allowed) return verdict;
    }
    return { allowed: true };
  }
  if (value && typeof value === "object") {
    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
      if (["__proto__", "constructor", "prototype"].includes(childKey))
        return blocked("Input contains unsafe fields.", true);
      const verdict = inspectValue(childValue, childKey, depth + 1);
      if (!verdict.allowed) return verdict;
    }
  }
  return { allowed: true };
}

async function inspectBody(input: RequestInfo | URL, init?: RequestInit): Promise<Verdict> {
  const body = init?.body ?? (input instanceof Request ? input.clone().body : undefined);
  if (!body) return { allowed: true };
  if (typeof body === "string") {
    if (byteLength(body) > MAX_JSON_BODY_BYTES) return blocked("Request is too large.", true);
    try {
      return inspectValue(JSON.parse(body));
    } catch {
      return inspectString("body", body);
    }
  }
  if (body instanceof URLSearchParams) {
    if (byteLength(body.toString()) > MAX_JSON_BODY_BYTES)
      return blocked("Request is too large.", true);
    for (const [key, value] of body.entries()) {
      const verdict = inspectString(key, value);
      if (!verdict.allowed) return verdict;
    }
  }
  if (body instanceof FormData) {
    for (const [key, value] of body.entries()) {
      if (typeof value === "string") {
        const verdict = inspectString(key, value);
        if (!verdict.allowed) return verdict;
      }
    }
  }
  if (input instanceof Request && !init?.body) {
    const text = await input.clone().text();
    if (text) return inspectBody(input, { body: text });
  }
  return { allowed: true };
}

function rejectionResponse(reason: string): Response {
  return new Response(JSON.stringify({ error: reason }), {
    status: 400,
    statusText: "Bad Request",
    headers: { "Content-Type": "application/json", "X-Client-Input-Blocked": "true" },
  });
}

export function shouldInspectClientInput(url: URL, method: string): boolean {
  return (
    url.origin !== window.location.origin &&
    WRITE_METHODS.has(method) &&
    BACKEND_PATH_PATTERN.test(url.pathname)
  );
}

export async function blockUnsafeClientInput(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  url: URL,
  method: string
): Promise<Response | null> {
  if (!shouldInspectClientInput(url, method)) return null;
  const locked = getAttackLockVerdict();
  if (locked?.allowed === false) return rejectionResponse(locked.reason);
  const verdict = await inspectBody(input, init);
  if (verdict.allowed === true) return null;
  // Only genuine attack-shaped payloads pause the session. Correctable content
  // problems (bad email, weak or markup-containing password) are refused for
  // THIS request only, so the user can fix the field and immediately retry —
  // no 10-minute dead tab behind a generic error.
  if (verdict.malicious) {
    lockBackendWritesForAttack();
    log.warn(
      "firewall",
      `Locked session after attack-shaped request to ${url.pathname}: ${verdict.reason}`,
      { path: url.pathname, method }
    );
  } else {
    log.info("firewall", `Rejected invalid input to ${url.pathname}: ${verdict.reason}`, {
      path: url.pathname,
      method,
    });
  }
  return rejectionResponse(verdict.reason);
}

export const __clientInputFirewallTestHooks = { inspectValue, inspectString };
