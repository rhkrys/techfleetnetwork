/**
 * Structural error classifier (not string-match).
 *
 * Replaces the historical SUPPRESSED_PATTERNS list in error-reporter.service
 * for the categories that are structurally identifiable: extension frames,
 * offline state, hidden tab, and DOMException AbortError. String suppression
 * stays only for vendor messages that have no structural signal.
 *
 * Used by both the reporter (drops at source) and React Query's global
 * onError (decides whether to forward to the reporter at all).
 */

const EXTENSION_FRAME_RE = /(chrome|moz|safari-web)-extension:\/\//i;
const ABOUT_FRAME_RE = /(^|\s)at\s+about:/i;

export interface ClassifiedError {
  /** Should this error be reported to audit_log / agent_fix_queue? */
  report: boolean;
  /** Reason for dropping (logged locally, not reported). */
  reason?: "extension_frame" | "offline" | "hidden_tab_fetch" | "aborted";
  /** Should the caller retry transparently? */
  retriable: boolean;
}

interface MaybeError {
  name?: string;
  message?: string;
  stack?: string;
}

function hasExtensionFrame(err: MaybeError): boolean {
  const stack = err.stack ?? "";
  return EXTENSION_FRAME_RE.test(stack) || ABOUT_FRAME_RE.test(stack);
}

function isAbort(err: MaybeError): boolean {
  if (err.name === "AbortError") return true;
  const msg = err.message ?? "";
  return /operation was aborted|signal is aborted/i.test(msg);
}

function isFetchTypeError(err: unknown): boolean {
  if (!(err instanceof TypeError)) return false;
  return /fetch|network/i.test(err.message);
}

/**
 * Classify a thrown value. The reporter must check `classify(err).report`
 * before writing to audit_log. React Query's QueryCache onError must do the
 * same before forwarding.
 */
export function classify(value: unknown): ClassifiedError {
  const err = (value ?? {}) as MaybeError;

  // 1. Browser extension frame → never reportable. Extensions cannot be fixed
  //    in app code; they pollute the queue. (MetaMask, TransOver, etc.)
  if (typeof err.stack === "string" && hasExtensionFrame(err)) {
    return { report: false, reason: "extension_frame", retriable: false };
  }

  // 2. Aborted requests are expected on unmount / query-key change.
  if (isAbort(err)) {
    return { report: false, reason: "aborted", retriable: false };
  }

  // 3. Offline → user state, not code bug.
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { report: false, reason: "offline", retriable: true };
  }

  // 4. Backgrounded tab with a fetch TypeError → almost always nav abort.
  if (
    typeof document !== "undefined" &&
    document.visibilityState === "hidden" &&
    isFetchTypeError(value)
  ) {
    return { report: false, reason: "hidden_tab_fetch", retriable: true };
  }

  return { report: true, retriable: isFetchTypeError(value) };
}
