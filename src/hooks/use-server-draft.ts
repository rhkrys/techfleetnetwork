/**
 * use-server-draft — server-side draft persistence for every create form.
 *
 * Why server-side instead of localStorage:
 *   - Survives device swaps, browser reinstalls, and the per-tab HMR reload
 *     guard in AuthContext/PageHeaderContext (which bypasses beforeunload).
 *   - Cross-device: pick a draft back up on phone after starting on laptop.
 *
 * Lifecycle (mirrors use-autosave):
 *   - mount   → SELECT form_drafts for (user_id, draft_key, schema_version);
 *               hydrate value & set restored=true if present.
 *   - change  → status='dirty'; flush every intervalMs if dirty && !saving.
 *   - hide/unmount/pre-hmr-reload → flush via beacon (save-form-draft edge fn)
 *     so the row is durable even when supabase-js can't finish its fetch.
 *   - submit  → caller invokes clearDraft() in mutation.onSuccess.
 *   - failure → exponential backoff (1s/3s/8s), then status='error'.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { normalizeThrownError } from "@/lib/error-normalization";
import { reportError } from "@/services/error-reporter.service";
import type { AutosaveStatus } from "@/hooks/use-autosave";

const DEFAULT_INTERVAL = 30_000;
const BACKOFFS = [1_000, 3_000, 8_000];
const MAX_PAYLOAD_BYTES = 262_144; // 256 KB — matches DB trigger cap
const PRE_HMR_EVENT = "lovable:pre-hmr-reload";

interface Options<T> {
  /** Stable, human-readable key, e.g. "project:new", `project-blast:${projectId}`. */
  draftKey: string;
  /** Bump when the form shape changes so stale drafts are ignored. */
  schemaVersion: number;
  /** Initial value when no draft exists. */
  initialValue: T;
  /** Disable on edit-mode pages (the row itself is the draft). */
  enabled: boolean;
  intervalMs?: number;
  /** Stable label for telemetry on repeated failures. */
  label: string;
  equals?: (a: T, b: T) => boolean;
}

interface Api<T> {
  value: T;
  setValue: React.Dispatch<React.SetStateAction<T>>;
  status: AutosaveStatus;
  /** True if mount hydrated from an existing draft. */
  restored: boolean;
  /** Wall-clock of the original draft's updated_at when restored, else null. */
  restoredAt: Date | null;
  lastSavedAt: Date | null;
  error: Error | null;
  /** Force a flush right now. */
  flush: () => Promise<void>;
  /** Delete the draft from the server. Call after successful submit. */
  clearDraft: () => Promise<void>;
  /** True while the initial hydrate is still pending. */
  hydrating: boolean;
}

function defaultEquals<T>(a: T, b: T): boolean {
  try { return JSON.stringify(a) === JSON.stringify(b); } catch { return a === b; }
}

export function useServerDraft<T>({
  draftKey,
  schemaVersion,
  initialValue,
  enabled,
  intervalMs = DEFAULT_INTERVAL,
  label,
  equals = defaultEquals,
}: Options<T>): Api<T> {
  const [value, setValue] = useState<T>(initialValue);
  const [status, setStatus] = useState<AutosaveStatus>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [restored, setRestored] = useState(false);
  const [restoredAt, setRestoredAt] = useState<Date | null>(null);
  const [hydrating, setHydrating] = useState(enabled);

  const valueRef = useRef<T>(value);
  const lastSavedValueRef = useRef<T>(value);
  const savingRef = useRef(false);
  const failureCountRef = useRef(0);
  const backoffTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const equalsRef = useRef(equals);
  const enabledRef = useRef(enabled);
  const hydratedRef = useRef(false);
  const userIdRef = useRef<string | null>(null);

  useEffect(() => { equalsRef.current = equals; }, [equals]);
  useEffect(() => { enabledRef.current = enabled; }, [enabled]);
  useEffect(() => { valueRef.current = value; }, [value]);

  // ── Hydrate from server on mount ────────────────────────────────────────
  useEffect(() => {
    if (!enabled) { setHydrating(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || cancelled) { setHydrating(false); return; }
        userIdRef.current = user.id;

        const { data, error: selErr } = await supabase
          .from("form_drafts")
          .select("payload, schema_version, updated_at, expires_at")
          .eq("user_id", user.id)
          .eq("draft_key", draftKey)
          .maybeSingle();

        if (cancelled) return;
        if (selErr) {
          reportError(selErr, `server-draft.hydrate.${label}`, { severity: "warn" });
          setHydrating(false);
          return;
        }
        if (!data) { setHydrating(false); hydratedRef.current = true; return; }

        const expired = data.expires_at && new Date(data.expires_at).getTime() < Date.now();
        const wrongVersion = data.schema_version !== schemaVersion;
        if (expired || wrongVersion) {
          await supabase.from("form_drafts").delete()
            .eq("user_id", user.id).eq("draft_key", draftKey);
          setHydrating(false);
          hydratedRef.current = true;
          return;
        }

        const restoredValue = data.payload as T;
        setValue(restoredValue);
        valueRef.current = restoredValue;
        lastSavedValueRef.current = restoredValue;
        setRestored(true);
        setRestoredAt(new Date(data.updated_at));
        setStatus("saved");
        setLastSavedAt(new Date(data.updated_at));
        hydratedRef.current = true;
      } finally {
        if (!cancelled) setHydrating(false);
      }
    })();
    return () => { cancelled = true; };
  }, [enabled, draftKey, schemaVersion, label]);

  // ── Mark dirty when value changes (after hydrate) ───────────────────────
  useEffect(() => {
    if (!enabled || !hydratedRef.current) return;
    if (equalsRef.current(value, lastSavedValueRef.current)) return;
    setStatus((s) => (s === "saving" ? s : "dirty"));
  }, [value, enabled]);

  // ── Flush impl ──────────────────────────────────────────────────────────
  const flush = useCallback(async (): Promise<void> => {
    if (!enabledRef.current) return;
    if (savingRef.current) return;
    if (!hydratedRef.current) return;
    const userId = userIdRef.current;
    if (!userId) return;
    const current = valueRef.current;
    if (equalsRef.current(current, lastSavedValueRef.current)) return;

    const payloadStr = (() => { try { return JSON.stringify(current); } catch { return ""; } })();
    if (!payloadStr) return;
    if (payloadStr.length > MAX_PAYLOAD_BYTES) {
      const err = new Error("Draft is too big to save (over 256 KB). Trim it and try again.");
      setError(err);
      setStatus("error");
      return;
    }

    savingRef.current = true;
    setStatus("saving");
    try {
      const { error: upsertErr } = await supabase
        .from("form_drafts")
        .upsert(
          [{
            user_id: userId,
            draft_key: draftKey,
            schema_version: schemaVersion,
            payload: current as never,
          }],
          { onConflict: "user_id,draft_key" },
        );
      if (upsertErr) throw upsertErr;

      lastSavedValueRef.current = current;
      failureCountRef.current = 0;
      setError(null);
      setLastSavedAt(new Date());
      const stillDirty = !equalsRef.current(valueRef.current, lastSavedValueRef.current);
      setStatus(stillDirty ? "dirty" : "saved");
    } catch (e) {
      const err = normalizeThrownError(e, "Draft save failed");
      failureCountRef.current += 1;
      setError(err);
      if (failureCountRef.current >= BACKOFFS.length) {
        setStatus("error");
        reportError(err, `server-draft.${label}`, { severity: "warn" });
      } else {
        setStatus("dirty");
        const delay = BACKOFFS[failureCountRef.current - 1];
        if (backoffTimerRef.current) clearTimeout(backoffTimerRef.current);
        backoffTimerRef.current = setTimeout(() => { void flush(); }, delay);
      }
    } finally {
      savingRef.current = false;
    }
  }, [draftKey, schemaVersion, label]);

  // ── Fixed-interval ticker ───────────────────────────────────────────────
  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => { void flush(); }, intervalMs);
    return () => window.clearInterval(id);
  }, [enabled, intervalMs, flush]);

  // ── Best-effort beacon flush on unload / HMR / tab hide ─────────────────
  useEffect(() => {
    if (!enabled) return;

    const beaconFlush = async () => {
      if (!hydratedRef.current) return;
      const userId = userIdRef.current;
      if (!userId) return;
      const current = valueRef.current;
      if (equalsRef.current(current, lastSavedValueRef.current)) return;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/save-form-draft`;
        const body = JSON.stringify({
          draft_key: draftKey,
          schema_version: schemaVersion,
          payload: current,
        });
        // sendBeacon doesn't carry custom headers, so include the JWT in the URL as a query param;
        // the edge function reads either header or query.
        if (typeof navigator.sendBeacon === "function") {
          const blob = new Blob([body], { type: "application/json" });
          navigator.sendBeacon(`${url}?token=${encodeURIComponent(session.access_token)}`, blob);
          lastSavedValueRef.current = current;
          return;
        }
        await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body,
          keepalive: true,
        });
        lastSavedValueRef.current = current;
      } catch {
        // best-effort; the next mount will re-hydrate the previous save
      }
    };

    const onVisibility = () => { if (document.visibilityState === "hidden") void beaconFlush(); };
    const onPageHide = () => { void beaconFlush(); };
    const onPreHmr = () => { void beaconFlush(); };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener(PRE_HMR_EVENT, onPreHmr);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener(PRE_HMR_EVENT, onPreHmr);
      void flush();
      if (backoffTimerRef.current) clearTimeout(backoffTimerRef.current);
    };
  }, [enabled, draftKey, schemaVersion, flush]);

  // ── Server-side clear (called by mutation.onSuccess) ────────────────────
  const clearDraft = useCallback(async () => {
    const userId = userIdRef.current;
    if (!userId) return;
    try {
      await supabase.from("form_drafts").delete()
        .eq("user_id", userId).eq("draft_key", draftKey);
      lastSavedValueRef.current = valueRef.current;
      setRestored(false);
      setRestoredAt(null);
      setStatus("idle");
      setLastSavedAt(null);
    } catch (e) {
      const err = normalizeThrownError(e, "Draft clear failed");
      reportError(err, `server-draft.clear.${label}`, { severity: "warn" });
    }
  }, [draftKey, label]);

  return {
    value,
    setValue,
    status,
    restored,
    restoredAt,
    lastSavedAt,
    error,
    flush,
    clearDraft,
    hydrating,
  };
}
