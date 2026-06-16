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

import { isTransientError } from "@/lib/transient-error";

const EXTENSION_FRAME_RE = /(chrome|moz|safari-web)-extension:\/\//i;
const ABOUT_FRAME_RE = /(^|\s)at\s+about:/i;
// Translation extensions (Google Translate, Transover, DeepL, etc.) mutate the
// live DOM under React. When React then tries to reconcile, the expected node
// has been moved or removed and the browser throws
// `NotFoundError: Failed to execute 'insertBefore'/'removeChild' on 'Node'`.
// Unrecoverable extension noise — never a Tech Fleet bug. Drop at the
// reporter; the surrounding <ScopedErrorBoundary> remounts the subtree.
const DOM_EXTENSION_RE = /Failed to execute '(insertBefore|removeChild|appendChild)' on 'Node'/i;

export interface ClassifiedError {
  /** Should this error be reported to audit_log / agent_fix_queue? */
  report: boolean;
  /** Reason for dropping (logged locally, not reported). */
  reason?: "extension_frame" | "offline" | "hidden_tab_fetch" | "aborted" | "dom_extension_mutation" | "infra_transient";
  /** Should the caller retry transparently? */
  retriable: boolean;
}

/** Public — also used by <ScopedErrorBoundary> to trigger silent remount. */
export function isDomExtensionMutationError(err: unknown): boolean {
  if (!err) return false;
  const e = err as { name?: string; message?: string };
  if (e.name !== "NotFoundError") return false;
  return DOM_EXTENSION_RE.test(e.message ?? "");
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

  // 1b. DOM mutation collision caused by a translation extension — same
  //     class of "not our bug, but no extension frame in the stack because
  //     React's reconciler is what actually threw."
  if (isDomExtensionMutationError(value)) {
    return { report: false, reason: "dom_extension_mutation", retriable: true };
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
