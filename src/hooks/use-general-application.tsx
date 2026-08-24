/**
 * Custom hook encapsulating all General Application state management,
 * persistence, and validation logic.
 */
import { useState, useCallback, useRef, useEffect, useLayoutEffect, useMemo } from "react";
import { DiscordNotifyService } from "@/services/discord-notify.service";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { usePageHeader } from "@/contexts/PageHeaderContext";
import { ProfileService } from "@/services/profile.service";
import {
  GeneralApplicationService,
  type GeneralApplication,
} from "@/services/general-application.service";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { showFormErrors, scrollToFirstError } from "@/lib/form-validation";
import {
  type AppFormData,
  EMPTY_FORM,
  TOTAL_SECTIONS,
  SECTION_TITLES,
  getFieldErrors,
  canSubmit,
} from "@/lib/validators/general-application";
import { Badge } from "@/design-system";

import { CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAutosave } from "@/hooks/use-autosave";

export function useGeneralApplication() {
  const { user, profile, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const { setHeader } = usePageHeader();

  const [loading, setLoading] = useState(true);
  const [activeApp, setActiveApp] = useState<GeneralApplication | null>(null);
  const [form, setForm] = useState<AppFormData>({ ...EMPTY_FORM });
  const [title, setTitle] = useState("");
  const [section, setSection] = useState(1);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [sectionsTouched, setSectionsTouched] = useState<Set<number>>(new Set());
  const [showCelebration, setShowCelebration] = useState(false);
  const formContainerRef = useRef<HTMLDivElement>(null);
  const initialLoadDone = useRef(false);

  const isCompleted = activeApp?.status === "completed";

  // Scroll to top on section change
  useEffect(() => {
    formContainerRef.current?.scrollTo({ top: 0, behavior: "instant" });
  }, [section]);

  const updateField = useCallback(<K extends keyof AppFormData>(key: K, value: AppFormData[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const populateFormFromApp = useCallback(
    (app: GeneralApplication) => {
      setForm({
        hours_commitment: app.hours_commitment || "",
        portfolio_url: app.portfolio_url || "",
        linkedin_url: app.linkedin_url || "",
        country: profile?.country || "",
        timezone: profile?.timezone || "",
        discord_username: profile?.discord_username || "",
        has_discord_account: profile?.has_discord_account ?? true,
        experience_areas: profile?.experience_areas || [],
        professional_goals: profile?.professional_goals || "",
        notify_training_opportunities: profile?.notify_training_opportunities || false,
        notify_announcements: profile?.notify_announcements || false,
        education_background: profile?.education_background || [],
        interests: profile?.interests || [],
        scheduling_url: profile?.scheduling_url || "",
        previous_engagement: app.previous_engagement || "",
        previous_engagement_ways: app.previous_engagement_ways || [],
        teammate_learnings: app.teammate_learnings || "",
        agile_vs_waterfall: app.agile_vs_waterfall || "",
        psychological_safety: app.psychological_safety || "",
        agile_philosophies: app.agile_philosophies || "",
        collaboration_challenges: app.collaboration_challenges || "",
        service_leadership_definition: app.service_leadership_definition || "",
        service_leadership_actions: app.service_leadership_actions || "",
        service_leadership_challenges: app.service_leadership_challenges || "",
        service_leadership_situation: app.service_leadership_situation || "",
      });
      setTitle(app.title);
      setSection(
        app.status === "completed"
          ? 1
          : app.current_section > 0
            ? Math.min(app.current_section, TOTAL_SECTIONS)
            : 1
      );
    },
    [profile]
  );

  /** Load or create the single general application */
  const loadOrCreateApp = useCallback(async () => {
    if (!user || initialLoadDone.current) return;
    setLoading(true);
    try {
      const data = await GeneralApplicationService.list(user.id);
      if (data.length > 0) {
        const app = data[0];
        setActiveApp(app);
        populateFormFromApp(app);
      } else {
        const app = await GeneralApplicationService.create(user.id);
        setActiveApp(app);
        populateFormFromApp(app);
      }
      initialLoadDone.current = true;
    } catch {
      toast.error("We couldn't load your application. Refresh to try again.");
    } finally {
      setLoading(false);
    }
  }, [user, populateFormFromApp]);

  useEffect(() => {
    loadOrCreateApp();
  }, [loadOrCreateApp]);

  /** Push page context into the global header */
  useLayoutEffect(() => {
    const statusBadge = activeApp ? (
      <Badge
        variant={activeApp.status === "completed" ? "default" : "secondary"}
        className={cn(
          "text-xs whitespace-nowrap",
          activeApp.status === "completed" && "bg-success/10 text-success border-success/30 gap-1"
        )}
      >
        {activeApp.status === "completed" && <CheckCircle2 className="h-3 w-3" />}
        {activeApp.status === "completed" ? "Completed" : "Draft"}
      </Badge>
    ) : undefined;

    setHeader({
      breadcrumbs: [
        { label: "Applications", href: "/applications" },
        { label: "General Application" },
      ],
      title: "General Application",
      badge: statusBadge,
    });
    return () => setHeader(null);
  }, [activeApp, setHeader]);

  const gatherSaveFields = useCallback(
    (): Partial<GeneralApplication> => ({
      title,
      hours_commitment: form.hours_commitment,
      portfolio_url: form.portfolio_url,
      linkedin_url: form.linkedin_url,
      previous_engagement: form.previous_engagement,
      previous_engagement_ways: form.previous_engagement_ways,
      teammate_learnings: form.teammate_learnings,
      agile_vs_waterfall: form.agile_vs_waterfall,
      psychological_safety: form.psychological_safety,
      agile_philosophies: form.agile_philosophies,
      collaboration_challenges: form.collaboration_challenges,
      service_leadership_definition: form.service_leadership_definition,
      service_leadership_actions: form.service_leadership_actions,
      service_leadership_challenges: form.service_leadership_challenges,
      service_leadership_situation: form.service_leadership_situation,
      current_section: section,
    }),
    [title, form, section]
  );

  /** Sync profile fields from Section 2 — note: discord_username/has_discord_account
   *  are intentionally excluded. The shared ProfileDiscordConnector is the only
   *  writer for verified Discord identity (profile.discord_user_id +
   *  profile.discord_username). Overwriting them here would clobber the verified
   *  link with stale form state. */
  const syncProfileFields = useCallback(async () => {
    if (!user) return;
    try {
      await ProfileService.updateFields(user.id, {
        country: form.country,
        timezone: form.timezone,
        experience_areas: form.experience_areas,
        professional_goals: form.professional_goals,
        notify_training_opportunities: form.notify_training_opportunities,
        notify_announcements: form.notify_announcements,
        education_background: form.education_background,
        interests: form.interests,
        scheduling_url: form.scheduling_url,
      });
      await refreshProfile();
    } catch {
      // Non-blocking
    }
  }, [user, form, refreshProfile]);

  const handleSave = useCallback(
    async (markComplete = false) => {
      if (!activeApp) return;
      setSaving(true);
      try {
        const fields = gatherSaveFields();
        if (markComplete) {
          fields.status = "completed";
          if (!isCompleted) {
            (fields as Record<string, unknown>).completed_at = new Date().toISOString();
          }
        } else if (!isCompleted) {
          fields.status = "draft";
        }
        await GeneralApplicationService.save(activeApp.id, fields);
        await syncProfileFields();
        const updated = await GeneralApplicationService.fetch(activeApp.id);
        if (updated) setActiveApp(updated);

        if (markComplete && !isCompleted) {
          setShowCelebration(true);
          // Fire-and-forget Discord notification
          const displayName = profile?.display_name || profile?.first_name || "A member";
          const discord = profile?.discord_username || undefined;
          const discordId = profile?.discord_user_id || undefined;
          DiscordNotifyService.applicationSubmitted(displayName, "General", discord, discordId);
          // Fire-and-forget confirmation email (idempotent — outbox row + sweeper
          // back this up if the call fails or the user closes the tab).
          supabase.functions
            .invoke("send-application-confirmation", {
              body: { kind: "general", applicationId: activeApp.id },
            })
            .catch(() => {
              /* sweeper will retry */
            });
        } else {
          toast.success(markComplete ? "Application updated!" : "Progress saved");
        }
      } catch {
        toast.error("We couldn't save your application. Refresh and try again.");
      } finally {
        setSaving(false);
      }
    },
    [activeApp, isCompleted, gatherSaveFields, syncProfileFields]
  );

  const validateSection = useCallback((): boolean => {
    const fieldErrors = getFieldErrors(form, section);
    setSectionsTouched((prev) => new Set(prev).add(section));
    setErrors(fieldErrors);

    if (Object.keys(fieldErrors).length > 0) {
      // Verbose error toast + auto-scroll/focus to first invalid field.
      // Centralized so every form in the app behaves the same way.
      showFormErrors(fieldErrors);
      scrollToFirstError();
      return false;
    }
    return true;
  }, [form, section]);

  const handleNext = useCallback(async () => {
    if (!validateSection()) return;
    const nextSection = Math.min(section + 1, TOTAL_SECTIONS);
    setSection(nextSection);
    setErrors({});
    if (activeApp) {
      setSaving(true);
      try {
        const fields = gatherSaveFields();
        fields.current_section = nextSection;
        // Do NOT write `status` here. Status is owned solely by handleSave;
        // writing "draft" on Next would race with a concurrent Submit and
        // revert a completed row back to draft.
        await GeneralApplicationService.save(activeApp.id, fields);

        await syncProfileFields();
        const updated = await GeneralApplicationService.fetch(activeApp.id);
        if (updated) setActiveApp(updated);
      } catch {
        /* non-blocking */
      }
      setSaving(false);
    }
  }, [validateSection, section, activeApp, isCompleted, gatherSaveFields, syncProfileFields]);

  const handleBack = useCallback(() => {
    setErrors({});
    setSection((s) => Math.max(s - 1, 1));
  }, []);

  // ── Autosave: 30s tick, draft only, no toast ───────────────────────────
  const autosaveValue = useMemo(() => ({ ...gatherSaveFields() }), [gatherSaveFields]);
  const autosave = useAutosave({
    value: autosaveValue,
    enabled: !!activeApp && !isCompleted,
    label: "general-application",
    onSave: async (fields) => {
      if (!activeApp) return;
      // CRITICAL: never write `status` from autosave. A late-arriving autosave
      // would otherwise clobber a just-submitted `completed` row back to `draft`
      // (race), leaving `completed_at` set but `status='draft'` — the exact
      // pattern that caused the submission loop. Status is owned solely by
      // handleSave(markComplete).
      await GeneralApplicationService.save(activeApp.id, fields);
      try {
        await syncProfileFields();
      } catch {
        /* non-blocking */
      }
    },
  });

  return {
    // State
    loading,
    activeApp,
    form,
    title,
    section,
    saving,
    errors,
    sectionsTouched,
    showCelebration,
    isCompleted,
    formContainerRef,
    autosave,

    // Setters
    setSection,
    setErrors,
    setShowCelebration,

    // Actions
    updateField,
    handleSave,
    handleNext,
    handleBack,
    canSubmit: () => canSubmit(form),

    // Navigation
    navigate,
  };
}
