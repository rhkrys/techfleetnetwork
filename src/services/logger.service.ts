/**
 * Centralized logging service for the Tech Fleet app.
 *
 * Provides structured, leveled logging with automatic context enrichment
 * (timestamp, service name, user ID when available). All services should
 * use this instead of raw console.log / console.error.
 *
 * Logs are written to the browser console in development and can later
 * be forwarded to an external service (e.g. Sentry, LogFlare) by
 * swapping out the transport without touching callers.
 */

import { normalizeThrownError } from "@/lib/error-normalization";
import { redactText } from "@/lib/redact";

export type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  level: LogLevel;
  service: string;
  action: string;
  message: string;
  timestamp: string;
  durationMs?: number;
  userId?: string;
  metadata?: Record<string, unknown>;
  error?: {
    name: string;
    message: string;
    stack?: string;
    code?: string;
  };
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// Default minimum level — could be driven by env var or remote config
const MIN_LEVEL: LogLevel = (import.meta.env.VITE_LOG_LEVEL as LogLevel) || "debug";

// Log throttling: max N logs per key per window to prevent console flooding at scale
const THROTTLE_WINDOW_MS = 10_000; // 10 seconds
const THROTTLE_MAX_PER_KEY = 5;
const throttleCounts = new Map<string, { count: number; windowStart: number }>();
const SENSITIVE_KEY_PATTERN =
  /email|password|token|secret|key|authorization|cookie|discord|useragent|user_agent|ip|consent|dsar|dob|birth_year|birthyear|gpc|ssn|tax_id|phone/i;

function isThrottled(key: string): boolean {
  const now = Date.now();
  const entry = throttleCounts.get(key);
  if (!entry || now - entry.windowStart > THROTTLE_WINDOW_MS) {
    throttleCounts.set(key, { count: 1, windowStart: now });
    // Prevent unbounded map growth — prune stale entries periodically
    if (throttleCounts.size > 200) {
      for (const [k, v] of throttleCounts) {
        if (now - v.windowStart > THROTTLE_WINDOW_MS) throttleCounts.delete(k);
      }
    }
    return false;
  }
  entry.count++;
  if (entry.count > THROTTLE_MAX_PER_KEY) {
    if (entry.count === THROTTLE_MAX_PER_KEY + 1) {
      console.warn(
        `[LOG THROTTLED] "${key}" — suppressing repeated logs for ${THROTTLE_WINDOW_MS / 1000}s`
      );
    }
    return true;
  }
  return false;
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[MIN_LEVEL];
}

function formatError(err: unknown): LogEntry["error"] | undefined {
  if (!err) return undefined;
  const normalized = normalizeThrownError(err);
  return {
    name: normalized.name,
    message: redactText(normalized.message),
    stack: normalized.stack ? redactText(normalized.stack) : undefined,
    code: normalized.code,
  };
}

function redactValue(value: unknown, key = ""): unknown {
  if (SENSITIVE_KEY_PATTERN.test(key)) return "[redacted]";
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map((item) => redactValue(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([childKey, childValue]) => [
        childKey,
        redactValue(childValue, childKey),
      ])
    );
  }
  return value;
}

function emit(entry: LogEntry) {
  if (!shouldLog(entry.level)) return;

  // Throttle repeated logs from same service+action
  const throttleKey = `${entry.service}:${entry.action}`;
  if (isThrottled(throttleKey)) return;

  const prefix = `[${entry.timestamp}] [${entry.level.toUpperCase()}] [${entry.service}] [${entry.action}]`;

  switch (entry.level) {
    case "debug":
      console.debug(prefix, entry.message, entry.metadata ?? "", entry.error ?? "");
      break;
    case "info":
      console.info(prefix, entry.message, entry.metadata ?? "");
      break;
    case "warn":
      console.warn(prefix, entry.message, entry.metadata ?? "", entry.error ?? "");
      break;
    case "error":
      console.error(prefix, entry.message, entry.metadata ?? "", entry.error ?? "");
      break;
  }
}

/**
 * Creates a scoped logger for a specific service.
 *
 * Usage:
 * ```ts
 * const log = createLogger("ProfileService");
 * log.info("fetch", "Loading profile", { userId });
 * log.error("update", "Failed to save", { userId }, err);
 * ```
 */
export function createLogger(service: string) {
  const makeEntry = (
    level: LogLevel,
    action: string,
    message: string,
    metadata?: Record<string, unknown>,
    err?: unknown
  ): LogEntry => ({
    level,
    service,
    action,
    message: redactText(message),
    timestamp: new Date().toISOString(),
    metadata: metadata ? (redactValue(metadata) as Record<string, unknown>) : undefined,
    error: formatError(err),
  });

  return {
    debug(action: string, message: string, metadata?: Record<string, unknown>) {
      emit(makeEntry("debug", action, message, metadata));
    },
    info(action: string, message: string, metadata?: Record<string, unknown>) {
      emit(makeEntry("info", action, message, metadata));
    },
    warn(action: string, message: string, metadata?: Record<string, unknown>, err?: unknown) {
      emit(makeEntry("warn", action, message, metadata, err));
    },
    error(action: string, message: string, metadata?: Record<string, unknown>, err?: unknown) {
      emit(makeEntry("error", action, message, metadata, err));
    },

    /** Wrap an async operation with automatic start/success/error logging */
    async track<T>(
      action: string,
      description: string,
      metadata: Record<string, unknown> | undefined,
      fn: () => Promise<T>
    ): Promise<T> {
      const start = performance.now();
      emit(makeEntry("info", action, `Starting: ${description}`, metadata));
      try {
        const result = await fn();
        const durationMs = Math.round(performance.now() - start);
        const entry = makeEntry("info", action, `Completed: ${description}`, {
          ...metadata,
          durationMs,
        });
        entry.durationMs = durationMs;
        emit(entry);
        return result;
      } catch (err) {
        const durationMs = Math.round(performance.now() - start);
        const entry = makeEntry(
          "error",
          action,
          `Failed: ${description}`,
          {
            ...metadata,
            durationMs,
          },
          err
        );
        entry.durationMs = durationMs;
        emit(entry);
        throw err;
      }
    },
  };
}
