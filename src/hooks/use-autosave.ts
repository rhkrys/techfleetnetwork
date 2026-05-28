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
  /** Manual retry after error — fires immediately. */
  retry: () => void;
}

const DEFAULT_INTERVAL = 30_000;
const BACKOFFS = [1_000, 3_000, 8_000];

function defaultEquals<T>(a: T, b: T): boolean {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return a === b;
  }
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

  const valueRef = useRef(value);
  const lastSavedValueRef = useRef<T>(value);
  const savingRef = useRef(false);
  const enabledRef = useRef(enabled);
  const failureCountRef = useRef(0);
  const backoffTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSaveRef = useRef(onSave);
  const equalsRef = useRef(equals);
  const initializedRef = useRef(false);

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

  const flush = useCallback(async (): Promise<void> => {
    if (!enabledRef.current) return;
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
      const err = toError(e);

      failureCountRef.current += 1;
      setError(err);
      if (failureCountRef.current >= BACKOFFS.length) {
        setStatus("error");
        reportError(err, `autosave.${label}`, { severity: "warn" });
      } else {
        setStatus("dirty");
        const delay = BACKOFFS[failureCountRef.current - 1];
        if (backoffTimerRef.current) clearTimeout(backoffTimerRef.current);
        backoffTimerRef.current = setTimeout(() => { void flush(); }, delay);
      }
    } finally {
      savingRef.current = false;
    }
  }, [label]);

  // Fixed-interval ticker
  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => { void flush(); }, intervalMs);
    return () => window.clearInterval(id);
  }, [enabled, intervalMs, flush]);

  // Flush on tab hide & unmount
  useEffect(() => {
    if (!enabled) return;
    const onHide = () => { if (document.visibilityState === "hidden") void flush(); };
    const onPageHide = () => { void flush(); };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onPageHide);
      void flush();
      if (backoffTimerRef.current) clearTimeout(backoffTimerRef.current);
    };
  }, [enabled, flush]);

  // beforeunload guard while dirty or in-flight
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
    failureCountRef.current = 0;
    void flush();
  }, [flush]);

  return { status, lastSavedAt, error, retry };
}
