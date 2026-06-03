/**
 * use-autosave — fixed-interval draft autosave with backoff.
 *
 * Why fixed interval instead of debounce:
 *   At 100k members with 5 long forms, per-keystroke debounce can burst the
 *   DB with thousands of writes/minute. A 30s ticker bounds load to at most
 *   2 writes/min/active-form regardless of typing speed.
 *
 * Lifecycle:
 *   - value change → status='dirty'
 *   - every intervalMs tick, if dirty && !saving → run onSave(value)
 *   - flush on tab hide (visibilitychange/pagehide) and on unmount
 *   - beforeunload guard while dirty || saving
 *   - failures: exponential backoff (1s/3s/8s), max 3 retries, then 'error'
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { normalizeThrownError } from "@/lib/error-normalization";
import { reportError } from "@/services/error-reporter.service";

export type AutosaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

interface Options<T> {
  value: T;
  enabled: boolean;
  intervalMs?: number;
  onSave: (value: T) => Promise<void>;
  /** Optional equality check; defaults to shallow JSON compare. */
  equals?: (a: T, b: T) => boolean;
  /** Stable label used for telemetry on repeated failures. */
  label: string;
}

interface AutosaveApi {
  status: AutosaveStatus;
  lastSavedAt: Date | null;
  error: Error | null;
  /** True when the circuit is open — autosave is paused; manual retry only. */
  circuitOpen: boolean;
  /** Classified reason the circuit opened, for inline UI copy. */
  circuitReason: AutosaveCircuitReason | null;
  /** Manual retry after error — fires immediately. */
  retry: () => void;
}

/**
 * Classifies why autosave is failing, so the UI can show actionable copy
 * (e.g. "form is out of date — reload" vs "we can't save right now — retry").
 */
export type AutosaveCircuitReason =
  | "auth_lost"        // 401 — session expired
  | "schema_drift"     // 400 / 42703 etc — bad column / validation
  | "rate_limited"     // 429
  | "permission"       // 403 / 42501
  | "transient"        // 5xx that exhausted backoffs
  | "unknown";

const DEFAULT_INTERVAL = 30_000;
const BACKOFFS = [1_000, 3_000, 8_000];

function defaultEquals<T>(a: T, b: T): boolean {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return a === b;
  }
}

/** Best-effort error classification — works with PostgrestError, Response-like, plain Error. */
function classifyError(err: unknown): AutosaveCircuitReason {
  const anyErr = err as { status?: number; statusCode?: number; code?: string; message?: string } | undefined;
  const status = anyErr?.status ?? anyErr?.statusCode;
  const code = anyErr?.code;
  const msg = (anyErr?.message ?? "").toLowerCase();

  if (status === 401 || code === "PGRST301" || msg.includes("jwt") || msg.includes("unauthorized")) return "auth_lost";
  if (status === 403 || code === "42501" || msg.includes("permission denied") || msg.includes("rls")) return "permission";
  if (status === 429 || msg.includes("rate limit") || msg.includes("too many")) return "rate_limited";
  if (status && status >= 400 && status < 500) return "schema_drift";
  if (code && /^4\d/.test(code)) return "schema_drift";
  if (status && status >= 500) return "transient";
  return "unknown";
}

/** 4xx-class reasons short-circuit immediately (no backoff retries). */
function isFatalReason(r: AutosaveCircuitReason): boolean {
  return r === "auth_lost" || r === "schema_drift" || r === "permission";
}

export function useAutosave<T>({
  value,
  enabled,
  intervalMs = DEFAULT_INTERVAL,
  onSave,
  equals = defaultEquals,
  label,
}: Options<T>): AutosaveApi {
  const [status, setStatus] = useState<AutosaveStatus>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [circuitOpen, setCircuitOpen] = useState(false);
  const [circuitReason, setCircuitReason] = useState<AutosaveCircuitReason | null>(null);

  const valueRef = useRef(value);
  const lastSavedValueRef = useRef<T>(value);
  const savingRef = useRef(false);
  const enabledRef = useRef(enabled);
  const failureCountRef = useRef(0);
  const backoffTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSaveRef = useRef(onSave);
  const equalsRef = useRef(equals);
  const initializedRef = useRef(false);
  const circuitOpenRef = useRef(false);
  // Track that we've already emitted ONE audit row for this circuit-open
  // window so we don't write a row per ticker firing (the bug we're fixing).
  const circuitReportedRef = useRef(false);

  useEffect(() => { onSaveRef.current = onSave; }, [onSave]);
  useEffect(() => { equalsRef.current = equals; }, [equals]);
  useEffect(() => { enabledRef.current = enabled; }, [enabled]);

  // Track value changes → mark dirty (skip initial mount so prefilled forms
  // don't immediately autosave).
  useEffect(() => {
    valueRef.current = value;
    if (!initializedRef.current) {
      initializedRef.current = true;
      lastSavedValueRef.current = value;
      return;
    }
    if (!enabledRef.current) return;
    if (equalsRef.current(value, lastSavedValueRef.current)) return;
    setStatus((s) => (s === "saving" ? s : "dirty"));
  }, [value]);

  const openCircuit = useCallback((err: Error, reason: AutosaveCircuitReason) => {
    circuitOpenRef.current = true;
    setCircuitOpen(true);
    setCircuitReason(reason);
    setStatus("error");
    setError(err);
    if (backoffTimerRef.current) { clearTimeout(backoffTimerRef.current); backoffTimerRef.current = null; }
    if (!circuitReportedRef.current) {
      circuitReportedRef.current = true;
      reportError(err, `autosave.${label}`, {
        severity: "warn",
        extraFields: [`autosave_circuit_open`, `reason:${reason}`, `label:${label}`],
      });
    }
  }, [label]);

  const flush = useCallback(async (): Promise<void> => {
    if (!enabledRef.current) return;
    if (circuitOpenRef.current) return; // hard stop — manual retry only
    if (savingRef.current) return;
    const current = valueRef.current;
    if (equalsRef.current(current, lastSavedValueRef.current)) return;

    savingRef.current = true;
    setStatus("saving");
    try {
      await onSaveRef.current(current);
      lastSavedValueRef.current = current;
      failureCountRef.current = 0;
      setError(null);
      setLastSavedAt(new Date());
      // If the value changed during the save, we're still dirty.
      const stillDirty = !equalsRef.current(valueRef.current, lastSavedValueRef.current);
      setStatus(stillDirty ? "dirty" : "saved");
    } catch (e) {
      const err = normalizeThrownError(e, "Autosave failed");
      const reason = classifyError(e);

      // 4xx-class errors are not retryable — open the circuit immediately.
      if (isFatalReason(reason)) {
        openCircuit(err, reason);
        return;
      }

      failureCountRef.current += 1;
      setError(err);
      if (failureCountRef.current >= BACKOFFS.length) {
        // Backoffs exhausted on transient 5xx — open the circuit so the
        // 30s ticker stops calling flush() forever (the bug we're fixing).
        openCircuit(err, reason === "unknown" ? "transient" : reason);
      } else {
        setStatus("dirty");
        const delay = BACKOFFS[failureCountRef.current - 1];
        if (backoffTimerRef.current) clearTimeout(backoffTimerRef.current);
        backoffTimerRef.current = setTimeout(() => { void flush(); }, delay);
      }
    } finally {
      savingRef.current = false;
    }
  }, [openCircuit]);

  // Fixed-interval ticker — paused while circuit is open.
  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => {
      if (circuitOpenRef.current) return;
      void flush();
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [enabled, intervalMs, flush]);

  // Flush on tab hide & unmount — also skipped while circuit is open.
  useEffect(() => {
    if (!enabled) return;
    const onHide = () => {
      if (circuitOpenRef.current) return;
      if (document.visibilityState === "hidden") void flush();
    };
    const onPageHide = () => {
      if (circuitOpenRef.current) return;
      void flush();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onPageHide);
      if (!circuitOpenRef.current) void flush();
      if (backoffTimerRef.current) clearTimeout(backoffTimerRef.current);
    };
  }, [enabled, flush]);

  // beforeunload guard while dirty or in-flight (always — even with circuit open).
  useEffect(() => {
    if (!enabled) return;
    const handler = (e: BeforeUnloadEvent) => {
      if (status === "dirty" || status === "saving" || status === "error") {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [enabled, status]);

  const retry = useCallback(() => {
    // Close the circuit and try once. Success resets fully; another failure
    // re-opens (and re-classifies) but suppresses a duplicate audit row.
    failureCountRef.current = 0;
    circuitOpenRef.current = false;
    setCircuitOpen(false);
    setCircuitReason(null);
    void flush();
  }, [flush]);

  return { status, lastSavedAt, error, circuitOpen, circuitReason, retry };
}
