/**
 * Shared structured logger for Supabase Edge Functions.
 *
 * Outputs JSON-structured log lines so they are easy to search
 * and filter in the edge function logs viewer.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";
type EventOutcome = "success" | "failure" | "denied" | "error";

const SENSITIVE_LOG_KEY_PATTERN =
  /password|passcode|secret|token|jwt|authorization|cookie|api[_-]?key|private[_-]?key|session|otp|totp|mfa|ssn|credit|card/i;

interface LogEntry {
  level: LogLevel;
  fn: string;
  action: string;
  msg: string;
  ts: string;
  durationMs?: number;
  meta?: Record<string, unknown>;
  "event.action": string;
  "event.outcome"?: EventOutcome;
  "trace.id"?: string;
  error?: {
    name: string;
    message: string;
  };
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

function formatError(err: unknown): LogEntry["error"] | undefined {
  if (!err) return undefined;
  if (err instanceof Error) {
    return { name: err.name, message: String(redactLogValue(err.message)) };
  }
  return { name: "UnknownError", message: String(redactLogValue(err)) };
}

function emit(entry: LogEntry) {
  const line = JSON.stringify(entry);
  switch (entry.level) {
    case "debug":
    case "info":
      console.log(line);
      break;
    case "warn":
      console.warn(line);
      break;
    case "error":
      console.error(line);
      break;
  }
}

export function createEdgeLogger(fnName: string) {
  const make = (
    level: LogLevel,
    action: string,
    msg: string,
    meta?: Record<string, unknown>,
    err?: unknown
  ): LogEntry => ({
    level,
    fn: fnName,
    action,
    "event.action": action,
    "event.outcome": level === "error" ? "error" : undefined,
    msg,
    ts: new Date().toISOString(),
    meta: meta ? (redactLogValue(meta) as Record<string, unknown>) : undefined,
    // Populate the queryable trace.id from either traceId or requestId — the hand-off/SPF pipeline
    // threads a `requestId` through every stage, so keying off it makes those logs correlatable
    // (previously trace.id only read `traceId`, which those callers never set, leaving it empty).
    "trace.id":
      typeof meta?.traceId === "string"
        ? meta.traceId
        : typeof meta?.requestId === "string"
          ? meta.requestId
          : undefined,
    error: formatError(err),
  });

  return {
    debug(action: string, msg: string, meta?: Record<string, unknown>) {
      emit(make("debug", action, msg, meta));
    },
    info(action: string, msg: string, meta?: Record<string, unknown>) {
      emit(make("info", action, msg, meta));
    },
    warn(action: string, msg: string, meta?: Record<string, unknown>, err?: unknown) {
      emit(make("warn", action, msg, meta, err));
    },
    error(action: string, msg: string, meta?: Record<string, unknown>, err?: unknown) {
      emit(make("error", action, msg, meta, err));
    },
    /** Time an async operation and log start/end/error automatically */
    async track<T>(
      action: string,
      description: string,
      meta: Record<string, unknown> | undefined,
      fn: () => Promise<T>
    ): Promise<T> {
      const start = performance.now();
      emit(make("info", action, `Starting: ${description}`, meta));
      try {
        const result = await fn();
        const durationMs = Math.round(performance.now() - start);
        emit({
          ...make("info", action, `Completed: ${description}`, { ...meta, durationMs }),
          durationMs,
        });
        return result;
      } catch (err) {
        const durationMs = Math.round(performance.now() - start);
        emit({
          ...make("error", action, `Failed: ${description}`, { ...meta, durationMs }, err),
          durationMs,
        });
        throw err;
      }
    },
  };
}
