import { useCallback, useEffect, useRef, useState } from "react";
import { ProfileSetupService, type ProfileDraftFields } from "./profile-setup.service";
import type { Profile } from "@/services/profile.service";

/**
 * useProfileSetupForm — the single hook backing both the modal dialog and
 * the standalone `/account/setup` page. Dialog and page render different
 * chrome but share state, autosave timing, and completion gating.
 */

const AUTOSAVE_DEBOUNCE_MS = 800;

export interface UseProfileSetupFormOptions {
  userId: string;
  onComplete?: () => void;
}

export interface UseProfileSetupFormReturn {
  profile: Profile | null;
  isLoading: boolean;
  isSaving: boolean;
  isCompleting: boolean;
  error: string | null;
  updateField: <K extends keyof ProfileDraftFields>(key: K, value: ProfileDraftFields[K]) => void;
  complete: () => Promise<void>;
}

export function useProfileSetupForm({ userId, onComplete }: UseProfileSetupFormOptions): UseProfileSetupFormReturn {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [draft, setDraft] = useState<ProfileDraftFields>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftRef = useRef<ProfileDraftFields>({});

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { profile: p } = await ProfileSetupService.initFromAuth(userId);
      if (!cancelled) {
        setProfile(p);
        setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const flush = useCallback(async () => {
    const pending = draftRef.current;
    if (Object.keys(pending).length === 0) return;
    draftRef.current = {};
    setIsSaving(true);
    try {
      await ProfileSetupService.autosaveDraft(userId, pending);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsSaving(false);
    }
  }, [userId]);

  const updateField = useCallback(
    <K extends keyof ProfileDraftFields>(key: K, value: ProfileDraftFields[K]) => {
      setDraft((prev) => ({ ...prev, [key]: value }));
      draftRef.current = { ...draftRef.current, [key]: value };
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => void flush(), AUTOSAVE_DEBOUNCE_MS);
    },
    [flush],
  );

  const complete = useCallback(async () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setIsCompleting(true);
    setError(null);
    try {
      // Merge the latest pending draft so we don't ship a stale autosave.
      const finalFields = { ...draftRef.current, ...draft };
      await ProfileSetupService.complete(userId, finalFields);
      onComplete?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsCompleting(false);
    }
  }, [draft, userId, onComplete]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  return { profile, isLoading, isSaving, isCompleting, error, updateField, complete };
}
