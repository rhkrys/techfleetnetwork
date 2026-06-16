// Wave 1 PERF-W1-010: static import eliminates the Vite static/dynamic
// collision warning and ensures a single error-reporter singleton.
import { reportError } from "@/services/error-reporter.service";

type ServiceLogLevel = "warn" | "error";

type ServiceLogger = Record<ServiceLogLevel, (action: string, message: string, metadata?: Record<string, unknown>, error?: unknown) => void>;

export interface ServiceErrorLike {
  message: string;
  code?: string;
  details?: string;
  hint?: string;
}

interface HandleServiceErrorOptions {
  logger: ServiceLogger;
  action: string;
  message: string;
  metadata?: Record<string, unknown>;
  level?: ServiceLogLevel;
  throwMessage?: string;
}

export function serviceErrorMetadata(error: ServiceErrorLike): Record<string, unknown> {
  return {
    errorCode: error.code,
    errorDetails: error.details,
    errorHint: error.hint,
  };
}

function isAbortError(error: ServiceErrorLike): boolean {
  // React Query / fetch cancellation when component unmounts or query key
  // changes mid-flight. Expected behavior — not a bug, never report.
  const name = (error as { name?: string }).name;
  if (name === "AbortError") return true;
  const msg = error.message ?? "";
  return /\bAbortError\b|\boperation was aborted\b|\bsignal is aborted\b/i.test(msg);
}

export function handleServiceError(error: ServiceErrorLike | null | undefined, options: HandleServiceErrorOptions): boolean {
  if (!error) return false;

  // Silently swallow request cancellations. They are not actionable failures
  // and they were flooding the triage queue (133 occurrences in 19min).
  if (isAbortError(error)) {
    // Re-throw the original abort so React Query / callers recognize it as a
    // cancellation (not a real failure) and skip error UI / retries.
    const abortErr = new DOMException(error.message || "Aborted", "AbortError");
    throw abortErr;
  }

  const level = options.level ?? "error";
  options.logger[level](
    options.action,
    options.message,
    { ...(options.metadata ?? {}), ...serviceErrorMetadata(error) },
    error,
  );

  // Mirror to audit_log so admins see service-layer failures in /admin/activity-log.
  // CRITICAL: pass the STRUCTURED error (with .code/.status fields) — not a
  // pre-flattened message string — so reportError's isTransientError() check
  // can recognize PGRST002 / 57014 / 429 and downgrade to event_type=
  // infra_transient. Stringifying first loses those fields and lets transient
  // infra blips flood the Triage queue.
  void (async () => {
    try {
      const structured = error as unknown;
      reportError(structured, options.action, { severity: level });
    } catch { /* never throw from telemetry */ }
  })();

  if (options.throwMessage) throw new Error(options.throwMessage);
  return true;
}