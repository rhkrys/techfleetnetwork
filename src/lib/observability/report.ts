/**
 * Single public entry-point for client-side error reporting.
 *
 * Phase-2 triage refactor (May 2026): every caller in app/service code MUST
 * import { report } from here instead of touching error-reporter.service
 * directly. The ESLint rule `no-direct-error-reporter` enforces this so we
 * have ONE place to gate reports through the structural classifier.
 *
 * Pipeline:
 *   caller → report() → classify() drop?  → return silently
 *                     → classify() report? → reportError() → audit_log
 *
 * No string-match suppression. The classifier is structural (extension
 * frames, navigator.onLine, document.visibilityState, AbortError).
 */
import {
  reportError as internalReportError,
  reportActivity as internalReportActivity,
  reportRecovery as internalReportRecovery,
  type ReportSeverity,
  type ReportEventType,
} from "@/services/error-reporter.service";
import { classify } from "./classify";
import { toError } from "@/lib/errors/toError";

export type { ReportSeverity, ReportEventType };

export interface ReportContext {
  source: string;
  eventType?: ReportEventType;
  severity?: ReportSeverity;
  traceId?: string;
  extra?: Record<string, unknown>;
}

/**
 * Report an error after structural classification.
 * Silent (no network call, no enqueue) for: extension-frame errors,
 * offline state, hidden-tab fetch failures, AbortError.
 */
export function report(error: unknown, ctx: ReportContext): void {
  const classified = classify(error);
  if (!classified.report) {
    // Optional dev breadcrumb so a developer can still see what was dropped.
    if (typeof window !== "undefined" && (import.meta as { env?: { DEV?: boolean } }).env?.DEV) {
      // eslint-disable-next-line no-console
      console.debug("[report:dropped]", classified.reason, ctx.source, error);
    }
    return;
  }
  const normalized = toError(error);
  internalReportError(normalized, ctx.source, {
    eventType: ctx.eventType,
    severity: ctx.severity,
    traceId: ctx.traceId,
  });
}

/** Non-error activity (info/audit) — passes straight through, no classifier. */
export const reportActivity = internalReportActivity;
/** Recovery signal (e.g. circuit breaker closed) — passes straight through. */
export const reportRecovery = internalReportRecovery;
