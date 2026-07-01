/**
 * Security utilities — OWASP hardening helpers
 *
 * Covers OWASP Top 10 2021 + API Security Top 10:
 *   A01 Broken Access Control — IDOR guards, path traversal detection
 *   A02 Cryptographic Failures — safe nonce/CSRF generation, constant-time compare
 *   A03 Injection — SQL injection detection, HTML sanitization, prototype pollution
 *   A04 Insecure Design — rate limit helpers, mass assignment guards
 *   A05 Security Misconfiguration — CSP nonce, safe JSON parse
 *   A06 Vulnerable Components — (handled at dependency level)
 *   A07 Auth Failures — timing-safe compare, credential masking
 *   A08 Software & Data Integrity — safe JSON parse, deep sanitize
 *   A09 Logging & Monitoring Failures — PII masking, safe error messages
 *   A10 SSRF — URL allowlisting, blocked host patterns
 *
 * Additional: ReDoS protection, header injection prevention,
 * open redirect prevention, mass assignment guards, supply-chain,
 * third-party script/payment, WebSocket/XML, privacy, and zero-trust guards.
 *
 * No PII should ever pass through console.log in production.
 */

import DOMPurify from "dompurify";

// ─── XSS Prevention (A03, A07) ─────────────────────────────────────

export const ACTIVE_XSS_PATTERNS = [
  /<\s*(script|iframe|object|embed|svg|math|form|input|button|textarea|select|meta|link|base)\b/i,
  /<\s*\/\s*script\s*>/i,
  /on[a-z]+\s*=/i,
  /javascript\s*:/i,
  /vbscript\s*:/i,
  /data\s*:\s*text\/html/i,
  /expression\s*\(/i,
  /%3c\s*\/?\s*(script|iframe|object|embed|svg|math|form|meta|link|base)/i,
  /&#x?0*3c;?\s*\/?\s*(script|iframe|object|embed|svg|math|form|meta|link|base)/i,
];

export function hasActiveXssPattern(input: string): boolean {
  return ACTIVE_XSS_PATTERNS.some((pattern) => pattern.test(input));
}

/** Sanitize a string for safe display (prevents XSS via innerHTML) */
export function sanitizeText(input: string): string {
  if (typeof document === "undefined") {
    return input.replace(
      /[&<>'"]/g,
      (char) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char] ?? char
    );
  }
  const div = document.createElement("div");
  div.textContent = input;
  return div.innerHTML;
}

/**
 * Strip all HTML tags from input, returning plain text.
 *
 * Uses the DOM parser so obfuscated / nested tags (e.g. `<scr<script>ipt>`)
 * that defeat a single-pass regex are removed correctly — a regex blocklist
 * here was flagged by CodeQL (js/incomplete-multi-character-sanitization).
 * Falls back to a best-effort regex only when no DOM is available (non-browser
 * SSR), where the result is used as plain text and never as an HTML sink.
 */
export function stripHtml(input: string): string {
  if (!input) return "";
  if (typeof DOMParser !== "undefined") {
    return new DOMParser().parseFromString(input, "text/html").body.textContent ?? "";
  }
  return input.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "").replace(/<[^>]*>/g, "");
}

export function safeHref(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  if (value.length > 2_048 || hasHeaderInjection(value) || hasActiveXssPattern(value))
    return undefined;
  try {
    const parsed = new URL(value, window.location.origin);
    if (!["http:", "https:", "mailto:"].includes(parsed.protocol)) return undefined;
    if (parsed.protocol === "mailto:" && !/^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(parsed.href))
      return undefined;
    if (["http:", "https:"].includes(parsed.protocol) && !isSafeExternalUrl(parsed.href))
      return undefined;
    return parsed.href;
  } catch {
    return undefined;
  }
}

/**
 * Deep-sanitize an object's string values to prevent stored XSS.
 * Recursively strips `<script`, `on*=` event handlers, `javascript:`,
 * `vbscript:`, `data:text/html`, and expression() from strings.
 * Also guards against prototype pollution.
 */
export function deepSanitize<T>(obj: T, depth = 0): T {
  // Guard against deeply nested payloads (DoS via recursion)
  if (depth > 20) return obj;

  if (typeof obj === "string") {
    // Remove all HTML tags robustly via the DOM parser (stripHtml), then
    // neutralize dangerous text-level tokens that can still matter if the
    // value is later interpolated into markup. The previous regex tag
    // blocklist (`<script[\s>]`, `<iframe[\s>]`, …) was single-pass and
    // bypassable (CodeQL js/incomplete-multi-character-sanitization), so tag
    // removal is delegated to the parser rather than hand-rolled regexes.
    const text = stripHtml(obj);
    const scrubbed = text
      .replace(/javascript\s*:/gi, "")
      .replace(/vbscript\s*:/gi, "")
      .replace(/data\s*:\s*text\/html/gi, "")
      .replace(/expression\s*\(/gi, "")
      .replace(/on\w+\s*=/gi, "");
    return scrubbed as unknown as T;
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => deepSanitize(item, depth + 1)) as unknown as T;
  }
  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(obj)) {
      // Prototype pollution guard: reject __proto__, constructor, prototype keys
      if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
      result[key] = deepSanitize((obj as Record<string, unknown>)[key], depth + 1);
    }
    return result as T;
  }
  return obj;
}

// ─── URL Safety (A10 SSRF, Open Redirect) ───────────────────────────

/** Validate a URL is safe (no javascript: or data: protocols) */
export function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url, window.location.origin);
    return ["http:", "https:", "mailto:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}

/**
 * Validate that a URL points to an allowed external host (anti-SSRF).
 * Blocks internal IPs, cloud metadata endpoints, and non-HTTP protocols.
 */
const BLOCKED_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\.\d+\.\d+\.\d+$/,
  /^::1$/,
  /^10\.\d+\.\d+\.\d+$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/,
  /^192\.168\.\d+\.\d+$/,
  /^0\.0\.0\.0$/,
  /^169\.254\.\d+\.\d+$/, // Link-local / AWS metadata
  /^\[::1?\]$/, // IPv6 loopback
  /^metadata\.google\.internal$/i,
  /^\.internal$/i, // GCP internal
  /^fd[0-9a-f]{2}:/i, // IPv6 ULA
  /^fc[0-9a-f]{2}:/i, // IPv6 ULA
];

export function isSafeExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) return false;
    const host = parsed.hostname;
    if (!host || host.length === 0) return false;
    // Block numeric-only hostnames (potential IP bypass)
    if (/^\d+$/.test(host)) return false;
    return !BLOCKED_HOST_PATTERNS.some((p) => p.test(host));
  } catch {
    return false;
  }
}

export function isPrivateNetworkHost(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, "");
  return BLOCKED_HOST_PATTERNS.some((p) => p.test(normalized));
}

export function requireSafeOutboundUrl(
  value: string,
  allowedHosts?: readonly string[]
): URL | null {
  try {
    const parsed = new URL(value);
    if (!isSafeExternalUrl(parsed.href)) return null;
    if (allowedHosts && !allowedHosts.includes(parsed.hostname)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Prevent open redirect attacks by validating redirect targets.
 * Only allows same-origin or explicitly allowed external domains.
 */
const ALLOWED_REDIRECT_DOMAINS = ["techfleetnetwork.lovable.app", "guide.techfleet.org"];

export function isSafeRedirectUrl(url: string): boolean {
  try {
    // Relative URLs are always safe (same-origin)
    if (url.startsWith("/") && !url.startsWith("//")) return true;
    const parsed = new URL(url, window.location.origin);
    if (parsed.origin === window.location.origin) return true;
    return ALLOWED_REDIRECT_DOMAINS.includes(parsed.hostname);
  } catch {
    return false;
  }
}

export function normalizeSafeRedirectTarget(value: string, fallback = "/dashboard"): string {
  if (!isSafeRedirectUrl(value)) return fallback;
  const parsed = new URL(value, window.location.origin);
  if (parsed.origin === window.location.origin)
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  return parsed.href;
}

export function isSecureTlsUrl(value: string, allowedHosts?: readonly string[]): boolean {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") return false;
    if (isPrivateNetworkHost(parsed.hostname)) return false;
    return !allowedHosts || allowedHosts.includes(parsed.hostname);
  } catch {
    return false;
  }
}

// ─── Third-Party JavaScript and Payment Integrity ───────────────────

const TRUSTED_THIRD_PARTY_SCRIPT_HOSTS = new Set([
  "js.stripe.com",
  "www.googletagmanager.com",
  "challenges.cloudflare.com",
]);

export function isTrustedThirdPartyScriptUrl(src: string, integrity?: string): boolean {
  try {
    const parsed = new URL(src, window.location.origin);
    if (parsed.protocol !== "https:") return false;
    if (parsed.origin === window.location.origin) return true;
    if (!TRUSTED_THIRD_PARTY_SCRIPT_HOSTS.has(parsed.hostname)) return false;
    // SRI is required where providers support static assets. Dynamic providers
    // that cannot support SRI must be explicitly allowlisted above and covered by CSP.
    if (parsed.hostname === "js.stripe.com" || parsed.hostname === "challenges.cloudflare.com")
      return true;
    return typeof integrity === "string" && /^sha(256|384|512)-[A-Za-z0-9+/=]+$/.test(integrity);
  } catch {
    return false;
  }
}

export interface PaymentWebhookReplayInput {
  timestampMs: number;
  nowMs?: number;
  toleranceMs?: number;
  idempotencyKey: string;
  seenIdempotencyKeys?: ReadonlySet<string>;
}

export function isPaymentWebhookReplaySafe({
  timestampMs,
  nowMs = Date.now(),
  toleranceMs = 5 * 60 * 1000,
  idempotencyKey,
  seenIdempotencyKeys,
}: PaymentWebhookReplayInput): boolean {
  if (!idempotencyKey || idempotencyKey.length < 12 || idempotencyKey.length > 200) return false;
  if (!Number.isFinite(timestampMs) || Math.abs(nowMs - timestampMs) > toleranceMs) return false;
  if (seenIdempotencyKeys?.has(idempotencyKey)) return false;
  return true;
}

export interface TransactionAuthorizationInput {
  actorUserId: string;
  confirmationUserId: string;
  action: string;
  resourceId: string;
  nonce: string;
  replayedNonce?: boolean;
  amountCents?: number;
  requiresMfa?: boolean;
  mfaVerified?: boolean;
}

export function isHighRiskTransactionAuthorized(input: TransactionAuthorizationInput): boolean {
  if (!isValidUuid(input.actorUserId) || input.actorUserId !== input.confirmationUserId)
    return false;
  if (!input.action || !input.resourceId || input.nonce.length < 16 || input.replayedNonce)
    return false;
  if (
    input.amountCents !== undefined &&
    (!Number.isInteger(input.amountCents) || input.amountCents < 0)
  )
    return false;
  if (input.requiresMfa && !input.mfaVerified) return false;
  return true;
}

// ─── Cryptographic Helpers (A02) ────────────────────────────────────

/** Generate a cryptographically random nonce for CSP */
export function generateNonce(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Generate a CSRF token */
export function generateCsrfToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}

// ─── PII Protection (A09) ───────────────────────────────────────────

/** Mask PII for logging (show only last 4 chars) */
export function maskPii(value: string): string {
  if (value.length <= 4) return "****";
  return "*".repeat(value.length - 4) + value.slice(-4);
}

/** Mask email for logging: j***@example.com */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 1) return "***@***";
  return email[0] + "***" + email.slice(at);
}

const SENSITIVE_LOG_KEY_PATTERN =
  /password|passcode|secret|token|jwt|authorization|cookie|api[_-]?key|private[_-]?key|session|otp|totp|mfa|ssn|credit|card/i;

export type SecurityEventOutcome = "success" | "failure" | "denied" | "error";

export interface SecurityLogEntry {
  "event.category":
    | "authentication"
    | "authorization"
    | "data_access"
    | "validation"
    | "system"
    | "ai_tool";
  "event.action": string;
  "event.outcome": SecurityEventOutcome;
  "user.id"?: string;
  "resource.id"?: string;
  "trace.id"?: string;
  details?: Record<string, unknown>;
}

function redactLogValue(value: unknown, key = ""): unknown {
  if (SENSITIVE_LOG_KEY_PATTERN.test(key)) return "[REDACTED]";
  if (typeof value === "string") {
    return value
      .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]")
      .replace(
        /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
        "[REDACTED_JWT]"
      )
      .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]");
  }
  if (Array.isArray(value)) return value.map((item) => redactLogValue(item, key));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([childKey, childValue]) => [
        childKey,
        redactLogValue(childValue, childKey),
      ])
    );
  }
  return value;
}

export function createSecurityLogEntry(entry: SecurityLogEntry): SecurityLogEntry {
  return {
    ...entry,
    details: entry.details ? (redactLogValue(entry.details) as Record<string, unknown>) : undefined,
  };
}

/**
 * Safe error message formatter that strips sensitive details.
 * Prevents internal details from leaking to the client (A09).
 */
export function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    // Strip stack traces, file paths, and SQL details
    const msg = error.message;
    if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT/i.test(msg)) {
      return "Service temporarily unavailable";
    }
    if (/relation.*does not exist|column.*does not exist/i.test(msg)) {
      return "A data error occurred";
    }
    if (/permission denied|row-level security/i.test(msg)) {
      return "Access denied";
    }
    // Return generic for unrecognized database/system errors
    if (/pg_|sql|supabase|postgres/i.test(msg)) {
      return "An internal error occurred";
    }
    // Truncate and return sanitized message
    return msg.slice(0, 200);
  }
  return "An unexpected error occurred";
}

// ─── Timing-Safe Comparison (A02, A07) ──────────────────────────────

/**
 * Constant-time string comparison to prevent timing attacks.
 * Pads the shorter string so the loop length never leaks which input
 * was shorter — the XOR still produces a non-zero result on mismatch.
 */
export function safeCompare(a: string, b: string): boolean {
  const maxLen = Math.max(a.length, b.length);
  // Length mismatch will still fail because padded chars won't match,
  // but we track it explicitly to guarantee rejection.
  let result = a.length ^ b.length;
  for (let i = 0; i < maxLen; i++) {
    result |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return result === 0;
}

// ─── Input Guards (A03, A04) ────────────────────────────────────────

/** Enforce a maximum byte length on a string (prevents oversized payloads) */
export function enforceMaxBytes(input: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  const encoded = encoder.encode(input);
  if (encoded.length <= maxBytes) return input;
  const decoder = new TextDecoder("utf-8", { fatal: false });
  return decoder.decode(encoded.slice(0, maxBytes));
}

/**
 * Detect common SQL injection patterns in user input.
 * Use as an additional defense layer (RLS + parameterized queries are primary).
 */
const SQL_INJECTION_PATTERNS = [
  /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|ALTER|UNION|EXEC|TRUNCATE|GRANT|REVOKE)\b.*\b(FROM|INTO|TABLE|SET|WHERE|ALL)\b)/i,
  /(['";]\s*(--))/,
  /(\/\*[\s\S]*?\*\/)/,
  /(\bOR\b\s+\d+\s*=\s*\d+)/i,
  /(\bAND\b\s+\d+\s*=\s*\d+)/i,
  /(;\s*(DROP|ALTER|TRUNCATE|DELETE)\b)/i,
  /(\bEXEC(UTE)?\s+(xp_|sp_))/i,
  /(\bINFORMATION_SCHEMA\b)/i,
  /(\bpg_catalog\b)/i,
  /(\bCHAR\s*\(\d+\))/i,
];

export function hasSqlInjectionPattern(input: string): boolean {
  return SQL_INJECTION_PATTERNS.some((p) => p.test(input));
}

/**
 * Detect path traversal attempts (A01).
 * Validates file names/paths don't escape intended directories.
 */
export function hasPathTraversal(input: string): boolean {
  const normalized = decodeURIComponent(input);
  return (
    /\.\.[/\\]/.test(normalized) ||
    /%2e%2e[/\\%]/i.test(input) ||
    /\.\.%2f/i.test(input) ||
    /\.\.%5c/i.test(input)
  );
}

/**
 * Detect HTTP header injection attempts.
 * Prevents CRLF injection in header values.
 */
export function hasHeaderInjection(input: string): boolean {
  return /[\r\n]/.test(input) || /%0[aAdD]/i.test(input);
}

export function validateRestQueryParams(
  params: URLSearchParams,
  allowedKeys: readonly string[]
): { valid: boolean; unexpected: string[] } {
  const allowed = new Set(allowedKeys);
  const unexpected = [...params.keys()].filter((key) => !allowed.has(key));
  const hasUnsafeValue = [...params.values()].some(
    (value) =>
      value.length > 1_000 ||
      hasSqlInjectionPattern(value) ||
      hasHeaderInjection(value) ||
      hasCRSAttackPattern(value)
  );
  return { valid: unexpected.length === 0 && !hasUnsafeValue, unexpected };
}

/**
 * Mass assignment protection (A04 Insecure Design).
 * Picks only allowed keys from an object, rejecting everything else.
 * Use when processing user-submitted form data before DB writes.
 */
export function pickAllowedFields<T extends Record<string, unknown>>(
  data: T,
  allowedKeys: string[]
): Partial<T> {
  const result: Partial<T> = {};
  const allowedSet = new Set(allowedKeys);
  for (const key of Object.keys(data)) {
    if (allowedSet.has(key)) {
      (result as Record<string, unknown>)[key] = data[key];
    }
  }
  return result;
}

export function getUnexpectedFields<T extends Record<string, unknown>>(
  data: T,
  allowedKeys: string[]
): string[] {
  const allowedSet = new Set(allowedKeys);
  return Object.keys(data).filter((key) => !allowedSet.has(key));
}

/**
 * Validate UUID format to prevent IDOR attacks (A01).
 * Ensures IDs follow the standard UUID v4 pattern.
 */
export function isValidUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export interface ObjectAccessScope {
  actorUserId: string;
  ownerUserId: string;
  actorTenantId?: string;
  resourceTenantId?: string;
  isAdmin?: boolean;
}

export function isAuthorizedObjectAccess(scope: ObjectAccessScope): boolean {
  if (!isValidUuid(scope.actorUserId) || !isValidUuid(scope.ownerUserId)) return false;
  if (scope.isAdmin === true) return true;
  if (scope.actorUserId !== scope.ownerUserId) return false;
  if (scope.actorTenantId !== undefined || scope.resourceTenantId !== undefined) {
    if (!scope.actorTenantId || !scope.resourceTenantId) return false;
    return scope.actorTenantId === scope.resourceTenantId;
  }
  return true;
}

/**
 * Validate that a string is safe for use in content-disposition headers.
 * Prevents header injection via file names.
 */
export function sanitizeFileName(name: string): string {
  return name
    .replace(/[^\w\s.-]/g, "_") // Replace non-safe chars
    .replace(/\.{2,}/g, ".") // Collapse multiple dots
    .slice(0, 200); // Max length
}

// ─── ReDoS Protection ───────────────────────────────────────────────

/**
 * Safely test a regex against input with a length limit.
 * Prevents ReDoS by rejecting excessively long inputs.
 */
export function safeRegexTest(pattern: RegExp, input: string, maxLength = 10_000): boolean {
  if (input.length > maxLength) return false;
  return pattern.test(input);
}

// ─── Prototype Pollution Guard (A08) ────────────────────────────────

/**
 * Safe JSON.parse that strips prototype-polluting keys.
 * Use instead of raw JSON.parse for untrusted input.
 */
export function safeJsonParse<T = unknown>(json: string): T {
  return JSON.parse(json, (key, value) => {
    if (key === "__proto__" || key === "constructor" || key === "prototype") {
      return undefined;
    }
    return value;
  }) as T;
}

// ─── HTML Sanitization (DOMPurify) (A03) ────────────────────────────

/**
 * Strict allow-list for user-generated rich text (announcements, banners,
 * notification bodies). Locked down to ONLY the formatting tags Quill emits
 * — no styling vectors of any kind:
 *
 *   • No `style` attribute (forbids inline CSS)
 *   • No `class` attribute (forbids referencing global Tailwind/utility CSS)
 *   • No `id` or `name` attributes (forbids `:target` abuse + DOM clobbering)
 *   • No `<style>`, `<link>`, `<svg>`, `<math>`, `<iframe>`, `<object>`, `<embed>`
 *   • No `<div>`, `<span>`, `<img>`, `<table>` (positional/visual abuse vectors)
 *
 * This is enforced both on read (renderer) AND on write (DB trigger
 * `sanitize_user_html_trigger`) for defense in depth — a compromised
 * admin token cannot store CSS/HTML payloads either.
 */
export function sanitizeHtml(dirty: string): string {
  if (typeof dirty !== "string" || dirty.length === 0) return "";
  // Hard cap to prevent DOM-based DoS via giant HTML blobs.
  const capped = dirty.length > 100_000 ? dirty.slice(0, 100_000) : dirty;
  // Normalize non-breaking spaces (literal &nbsp; entities and U+00A0) that
  // some rich-text editors / pasted Word/Google Docs content insert between
  // every word — they suppress wrapping and make announcements look "jumbled".
  const normalized = capped
    .replace(/&nbsp;/gi, " ")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]{2,}/g, " ");
  return DOMPurify.sanitize(normalized, {
    ALLOWED_TAGS: [
      "p",
      "br",
      "strong",
      "b",
      "em",
      "i",
      "u",
      "s",
      "a",
      "ul",
      "ol",
      "li",
      "h2",
      "h3",
      "blockquote",
    ],
    ALLOWED_ATTR: ["href", "target", "rel"],
    ALLOW_DATA_ATTR: false,
    ALLOW_UNKNOWN_PROTOCOLS: false,
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|\/(?!\/)|#)/i,
    FORBID_TAGS: [
      "style",
      "link",
      "meta",
      "base",
      "script",
      "iframe",
      "object",
      "embed",
      "form",
      "input",
      "button",
      "textarea",
      "select",
      "option",
      "svg",
      "math",
      "img",
      "video",
      "audio",
      "source",
      "track",
      "frame",
      "frameset",
      "applet",
      "div",
      "span",
      "table",
      "thead",
      "tbody",
      "tfoot",
      "tr",
      "th",
      "td",
      "colgroup",
      "col",
      "caption",
    ],
    FORBID_ATTR: [
      "style",
      "class",
      "id",
      "name",
      "srcset",
      "sizes",
      "loading",
      "ping",
      "formaction",
      "background",
      "poster",
    ],
    KEEP_CONTENT: true, // keep inner text of stripped wrapper tags
    SANITIZE_DOM: true, // mitigate DOM clobbering
    SANITIZE_NAMED_PROPS: true,
    IN_PLACE: false,
  });
}

// Force every surviving <a> to open in a new tab with a safe rel.
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer nofollow");
  }
});

// ─── Content-Type Validation (A05) ──────────────────────────────────

/**
 * Allowed file upload MIME types.
 * SVG is intentionally EXCLUDED — SVGs can carry <script> and event handlers
 * that survive client-side rendering, and our public storage buckets serve
 * files with their declared Content-Type, so a malicious SVG would execute
 * in the user's origin context. Use PNG/JPG/WebP for any image upload.
 */
const ALLOWED_UPLOAD_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
  "video/mp4",
  "video/webm",
  "audio/mpeg",
  "audio/mp4",
]);

const ALLOWED_UPLOAD_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "pdf",
  "mp4",
  "webm",
  "mp3",
  "m4a",
]);

/** Max file size in bytes (10 MB) */
const MAX_UPLOAD_SIZE = 10 * 1024 * 1024;

export function validateFileUpload(file: File): { valid: boolean; error?: string } {
  const safeName = sanitizeFileName(file.name);
  const extension = safeName.split(".").pop()?.toLowerCase() ?? "";
  if (!extension || !ALLOWED_UPLOAD_EXTENSIONS.has(extension)) {
    return { valid: false, error: "File extension is not allowed" };
  }
  if (!ALLOWED_UPLOAD_TYPES.has(file.type)) {
    return { valid: false, error: `File type "${file.type}" is not allowed` };
  }
  if (file.size > MAX_UPLOAD_SIZE) {
    return {
      valid: false,
      error: `File size exceeds the ${MAX_UPLOAD_SIZE / (1024 * 1024)}MB limit`,
    };
  }
  if (hasPathTraversal(file.name)) {
    return { valid: false, error: "Invalid file name" };
  }
  return { valid: true };
}

// ─── Rate Limiting Helper (A04) ─────────────────────────────────────

/**
 * Client-side rate limiter for UI actions (e.g., form submissions).
 * Uses a sliding window approach. NOT a substitute for server-side rate limiting.
 */
const actionTimestamps = new globalThis.Map<string, number[]>();

export function isClientRateLimited(action: string, maxAttempts = 5, windowMs = 60_000): boolean {
  const now = Date.now();
  const timestamps = actionTimestamps.get(action) || [];
  // Remove expired entries
  const recent = timestamps.filter((t) => now - t < windowMs);
  if (recent.length >= maxAttempts) return true;
  recent.push(now);
  actionTimestamps.set(action, recent);
  return false;
}

/** Reset client-side rate limit for an action */
export function resetClientRateLimit(action: string): void {
  actionTimestamps.delete(action);
}

// ─── CORS Origin Validation ─────────────────────────────────────────

const ALLOWED_ORIGINS = new Set([
  "https://techfleetnetwork.lovable.app",
  "https://id-preview--3ae718a9-cd87-4a00-991b-209d8baa78ad.lovable.app",
]);

/** Validate that a request origin is allowed */
export function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  return ALLOWED_ORIGINS.has(origin);
}

// ─── WSTG Session Security (WSTG-SESS-07, WSTG-SESS-09) ───────────

/**
 * Clear sensitive session data when the app is backgrounded (MASVS-STORAGE-2).
 * Removes cached form data from sessionStorage to prevent data theft
 * on shared/public devices. Preserves session management keys.
 */
export function clearSensitiveSessionData(): void {
  const keysToKeep = new Set([
    "session_started_at",
    "theme",
    `sb-${import.meta.env.VITE_SUPABASE_PROJECT_ID}-auth-token`,
  ]);
  const keysToRemove: string[] = [];
  for (let i = 0; i < sessionStorage.length; i++) {
    const key = sessionStorage.key(i);
    if (key && !keysToKeep.has(key)) {
      keysToRemove.push(key);
    }
  }
  for (const key of keysToRemove) {
    sessionStorage.removeItem(key);
  }
}

export interface SessionPolicyInput {
  startedAt: number;
  lastActivityAt: number;
  now?: number;
  idleTimeoutMs?: number;
  absoluteTimeoutMs?: number;
  revoked?: boolean;
}

export function isSessionWithinPolicy({
  startedAt,
  lastActivityAt,
  now = Date.now(),
  idleTimeoutMs = 20 * 60 * 1000,
  absoluteTimeoutMs = 4 * 60 * 60 * 1000,
  revoked = false,
}: SessionPolicyInput): boolean {
  if (revoked) return false;
  if (!Number.isFinite(startedAt) || !Number.isFinite(lastActivityAt)) return false;
  if (now - lastActivityAt > idleTimeoutMs) return false;
  if (now - startedAt > absoluteTimeoutMs) return false;
  return true;
}

export function getSessionPolicyFailureReason(
  input: SessionPolicyInput
): "revoked" | "invalid" | "idle_timeout" | "absolute_timeout" | null {
  const now = input.now ?? Date.now();
  const idleTimeoutMs = input.idleTimeoutMs ?? 20 * 60 * 1000;
  const absoluteTimeoutMs = input.absoluteTimeoutMs ?? 4 * 60 * 60 * 1000;
  if (input.revoked) return "revoked";
  if (
    !Number.isFinite(input.startedAt) ||
    !Number.isFinite(input.lastActivityAt) ||
    input.lastActivityAt < input.startedAt
  )
    return "invalid";
  if (now - input.lastActivityAt > idleTimeoutMs) return "idle_timeout";
  if (now - input.startedAt > absoluteTimeoutMs) return "absolute_timeout";
  return null;
}

export function isValidTotpCode(value: string): boolean {
  return /^\d{6}$/.test(value.replace(/\s/g, ""));
}

// ─── WebSocket / Web Service / XML Safety ───────────────────────────

export interface WebSocketHandshakePolicy {
  origin: string | null;
  allowedOrigins: readonly string[];
  authenticated: boolean;
  channel: string;
  allowedChannels: readonly string[];
}

export function isWebSocketHandshakeAllowed(policy: WebSocketHandshakePolicy): boolean {
  if (!policy.authenticated) return false;
  if (!policy.origin || !policy.allowedOrigins.includes(policy.origin)) return false;
  if (!policy.allowedChannels.includes(policy.channel)) return false;
  return /^[a-z0-9:_-]{1,100}$/i.test(policy.channel);
}

export function isXmlPayloadSafe(xml: string): boolean {
  if (xml.length > 100_000) return false;
  return !/(<!DOCTYPE|<!ENTITY|SYSTEM\s+["']|PUBLIC\s+["']|xinclude|file:\/\/|expect:\/\/|php:\/\/)/i.test(
    xml
  );
}

export function isJsonOnlyContentType(contentType: string | null): boolean {
  return (
    isExpectedContentType(contentType, "application/json") &&
    !/xml|html|text\/plain/i.test(contentType ?? "")
  );
}

// ─── CRS-Inspired WAF Patterns (ModSecurity CRS) ───────────────────

/**
 * Detect common attack payloads that match ModSecurity CRS rules.
 * Use as an additional defense layer in edge functions.
 */
const CRS_ATTACK_PATTERNS = [
  // CRS 941 — XSS patterns
  /<script[\s>]/i,
  /\bon\w+\s*=\s*["']/i,
  /javascript\s*:/i,
  /vbscript\s*:/i,
  /<iframe[\s>]/i,
  /<object[\s>]/i,
  /<embed[\s>]/i,
  /<svg[\s>].*\bon/i,
  // CRS 942 — SQL injection patterns
  /(\b(UNION|SELECT|INSERT|UPDATE|DELETE|DROP)\b.*\b(FROM|INTO|TABLE|SET|WHERE)\b)/i,
  /(;\s*(DROP|ALTER|TRUNCATE|DELETE|CREATE)\b)/i,
  /(\bOR\b\s+\d+\s*=\s*\d+)/i,
  /(\bEXEC(UTE)?\s+(xp_|sp_))/i,
  // CRS 944 — Java/deserialization patterns
  /java\.lang\.\w+/i,
  /javax?\.\w+\.\w+/i,
  // CRS 930 — LFI patterns
  /\.\.[\/\\]/,
  /(\/etc\/(passwd|shadow|hosts))/i,
  /(%00|%0[aAdD])/,
  // CRS 931 — RFI patterns
  /(https?:\/\/.*\.(php|asp|jsp|cgi))/i,
];

export function hasCRSAttackPattern(input: string): boolean {
  if (input.length > 50_000) return true; // Oversized payload = suspicious
  return CRS_ATTACK_PATTERNS.some((p) => p.test(input));
}

export function shouldApplyVirtualPatch(
  input: string,
  activeSignatures: readonly RegExp[] = CRS_ATTACK_PATTERNS
): boolean {
  return activeSignatures.some((signature) => signature.test(input));
}

// ─── MASVS: Sensitive Field Protection ──────────────────────────────

/**
 * HTML attributes for sensitive input fields to prevent data caching.
 * Per OWASP MASVS-STORAGE-2, prevent autocomplete/autofill for sensitive data.
 */
export const SENSITIVE_INPUT_ATTRS = {
  autoComplete: "off",
  autoCorrect: "off",
  autoCapitalize: "off",
  spellCheck: false,
  "data-lpignore": "true", // LastPass
  "data-1p-ignore": "true", // 1Password
} as const;

export interface PrivacyDisclosurePolicy {
  purpose: string;
  dataCategories: readonly string[];
  consentGranted: boolean;
  retentionDays: number;
  thirdPartySharing?: boolean;
}

export function isPrivacyDisclosureAllowed(policy: PrivacyDisclosurePolicy): boolean {
  if (!policy.purpose || policy.dataCategories.length === 0) return false;
  if (!policy.consentGranted) return false;
  if (
    !Number.isInteger(policy.retentionDays) ||
    policy.retentionDays < 1 ||
    policy.retentionDays > 365
  )
    return false;
  if (
    policy.thirdPartySharing &&
    policy.dataCategories.some((category) => /ssn|password|token|secret|mfa/i.test(category))
  )
    return false;
  return true;
}

export interface ZeroTrustAccessContext extends ObjectAccessScope {
  authenticated: boolean;
  deviceTrusted?: boolean;
  networkTrusted?: boolean;
  requestedAction: "read" | "write" | "delete" | "admin";
  allowedActions: readonly string[];
  mfaVerified?: boolean;
}

export function isZeroTrustAccessAllowed(context: ZeroTrustAccessContext): boolean {
  if (!context.authenticated) return false;
  if (!isAuthorizedObjectAccess(context)) return false;
  if (!context.allowedActions.includes(context.requestedAction)) return false;
  if (
    (context.requestedAction === "delete" || context.requestedAction === "admin") &&
    !context.mfaVerified
  )
    return false;
  // Never trust the network by itself; a trusted device can lower friction only
  // after identity, resource scope, and action checks have passed.
  if (context.networkTrusted && !context.deviceTrusted && context.requestedAction !== "read")
    return false;
  return true;
}

// ─── Dependency Track: SBOM Metadata ────────────────────────────────

/**
 * Returns Software Bill of Materials metadata for the application.
 * Per Dependency Track guidelines, applications should expose SBOM info.
 */
export function getSBOMMetadata() {
  return {
    format: "CycloneDX",
    specVersion: "1.5",
    component: {
      type: "application",
      name: "tech-fleet-network",
      version: "1.0.0",
      description: "Tech Fleet professional training platform",
    },
    toolsUsed: ["npm audit", "lovable-dependency-scan"],
    lastScanDate: new Date().toISOString(),
  };
}

export interface DependencyRiskInput {
  name: string;
  version: string;
  license?: string;
  knownVulnerabilitySeverity?: "low" | "moderate" | "high" | "critical";
  maintained?: boolean;
  pinned?: boolean;
}

export function isDependencyAcceptableForUse(dep: DependencyRiskInput): boolean {
  if (!dep.name || !dep.version || dep.version === "latest" || dep.pinned === false) return false;
  if (dep.maintained === false) return false;
  if (dep.knownVulnerabilitySeverity === "high" || dep.knownVulnerabilitySeverity === "critical")
    return false;
  return true;
}

// ─── Content Integrity ──────────────────────────────────────────────

/**
 * Validate that a string doesn't contain null bytes (CRS 920 protocol violation).
 * Null bytes can be used to bypass security filters.
 */
export function hasNullBytes(input: string): boolean {
  return input.includes("\0") || /%00/i.test(input);
}

/**
 * Validate Content-Type header matches expected value (WSTG-CONF-02).
 * Prevents content-type confusion attacks.
 */
export function isExpectedContentType(actual: string | null, expected: string): boolean {
  if (!actual) return false;
  return actual.toLowerCase().startsWith(expected.toLowerCase());
}

export function isTrustedCssToken(value: string): boolean {
  return (
    /^(?:[a-z][a-z0-9-]*:)?(?:bg|text|border|ring|shadow|from|to|via|fill|stroke|accent|muted|primary|secondary|destructive|card|popover|background|foreground)(?:-[a-z0-9/.[\]:]+)*$/i.test(
      value
    ) && !/[;{}()@]|url\s*\(|expression\s*\(|import/i.test(value)
  );
}

// ─── OWASP LLM Top 10: Client-Side AI Security ─────────────────────

/**
 * LLM02: Detect PII patterns in AI output for client-side redaction.
 * Use as a defense-in-depth layer — server-side filtering is primary.
 */
const CLIENT_PII_PATTERNS = [
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z]{2,}\b/gi, // emails
  /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, // US phone numbers
  /\b\d{3}-\d{2}-\d{4}\b/g, // SSN
  /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, // credit cards
];

export function redactPIIFromOutput(text: string): string {
  let redacted = text;
  for (const pattern of CLIENT_PII_PATTERNS) {
    redacted = redacted.replace(pattern, "[REDACTED]");
  }
  return redacted;
}

/**
 * LLM05: Sanitize AI-generated markdown/HTML before rendering.
 * Prevents XSS from AI output that may contain injected scripts.
 */
export function sanitizeAIMarkdown(markdown: string): string {
  if (typeof markdown !== "string" || markdown.length === 0) return "";
  // Delegate to the DOMPurify allowlist sanitizer rather than a regex
  // blocklist. Regex stripping of <script>/<iframe>/on*= was bypassable and
  // mis-escaped & characters (CodeQL js/incomplete-multi-character-sanitization,
  // js/bad-tag-filter, js/double-escaping). DOMPurify parses the markup and
  // drops anything not on the allowlist, which is robust to obfuscation.
  return sanitizeHtml(markdown);
}

export interface AiToolPolicy {
  toolName: string;
  allowedTools: readonly string[];
  requiresHumanApproval?: boolean;
  touchesSecrets?: boolean;
  writesData?: boolean;
}

export function isAllowedAiToolCall(policy: AiToolPolicy): boolean {
  if (!policy.allowedTools.includes(policy.toolName)) return false;
  if (policy.touchesSecrets) return false;
  if (policy.writesData && !policy.requiresHumanApproval) return false;
  return true;
}

/**
 * LLM01: Detect prompt injection patterns in user input (client-side).
 * Use as pre-flight check before sending to AI endpoint.
 */
export function hasPromptInjectionPattern(input: string): boolean {
  const patterns = [
    /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?|rules?)/i,
    /you\s+are\s+now\s+(a|an|the|DAN|jailbroken)/i,
    /system\s*prompt/i,
    /\[SYSTEM\]/i,
    /reveal\s+(your|the)\s+(system|initial)\s+(prompt|instructions?)/i,
    /bypass\s+(the\s+)?(restrictions?|filters?|safety)/i,
    /tool\s*call|function\s*call|mcp\s*server/i,
    /exfiltrate|send\s+(secrets?|tokens?|keys?)\s+to/i,
  ];
  return patterns.some((p) => p.test(input));
}
