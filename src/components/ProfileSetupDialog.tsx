import { useState, useEffect, useRef, useCallback, type FormEvent } from "react";
import { useLocation } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { MultiSelect } from "@/components/ui/multi-select";
import {
  AlertCircle,
  User,
  Globe,
  Check,
  Mail,
  Clock,
  CheckCircle2,
  CloudUpload,
  CloudOff,
  Loader2,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { ProfileService } from "@/services/profile.service";
import { JourneyService } from "@/services/journey.service";
import { DiscordNotifyService } from "@/services/discord-notify.service";
import {
  profileSchema,
  ACTIVITY_OPTIONS,
  PROFILE_FIELD_LABELS,
  PROFILE_FIELD_GUIDANCE,
} from "@/lib/validators/profile";
import { showFormErrors, scrollToFirstError } from "@/lib/form-validation";
import { EDUCATION_OPTIONS } from "@/lib/application-options";
import { COUNTRIES } from "@/lib/countries";
import { ExperienceAreasSelect } from "@/components/ExperienceAreasSelect";
import { TIMEZONES } from "@/lib/timezones";
import { cn } from "@/lib/utils";
import { SearchFirstCombobox } from "@/components/profile/SearchFirstCombobox";
import { ProfileDiscordConnector } from "@/components/profile/ProfileDiscordConnector";
import { reportValidationRejection } from "@/services/error-reporter.service";

export function ProfileSetupDialog() {
  const { user, profile, profileLoaded, refreshProfile } = useAuth();
  const location = useLocation();
  const isOAuth =
    user?.app_metadata?.provider === "google" || user?.app_metadata?.providers?.includes("google");
  // Suppress the dialog on dedicated profile-setup/edit routes — the page already
  // renders the same form, and mounting both causes every field (e.g. timezone)
  // to appear twice on screen.
  //
  // Also suppress on the password-recovery routes. A recovery link establishes a
  // real session, so an incomplete-profile user (e.g. signed up but never
  // onboarded, then forgot their password) would otherwise get this modal mounted
  // OVER the "Set your new password" form — hijacking the reset before they can
  // submit. Setting a password must never be interrupted; onboarding resumes on
  // /dashboard after the reset completes.
  const onSuppressedRoute =
    /^\/(profile-setup|profile\/edit|edit-profile|reset-password|forgot-password)/i.test(
      location.pathname
    );
  const shouldShow =
    !!user && profileLoaded && profile !== null && !profile.profile_completed && !onSuppressedRoute;

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    country: "",
    timezone: "",
    discordUsername: "",
    interests: [] as string[],
    portfolio_url: "",
    linkedin_url: "",
    scheduling_url: "",
    experience_areas: [] as string[],
    professional_goals: "",
    notify_training_opportunities: false,
    notify_announcements: false,
    education_background: [] as string[],
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [countryOpen, setCountryOpen] = useState(false);
  const [timezoneOpen, setTimezoneOpen] = useState(false);

  // Auto-save state
  type AutosaveStatus = "idle" | "pending" | "saving" | "saved" | "error" | "offline";
  const [autosaveStatus, setAutosaveStatus] = useState<AutosaveStatus>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveInFlightRef = useRef(false);
  const pendingRetryRef = useRef(false);
  const lastSerializedRef = useRef<string>("");

  useEffect(() => {
    setOpen(shouldShow);
  }, [shouldShow]);

  // Online/offline awareness so we can pause autosave gracefully
  useEffect(() => {
    const handleOnline = () => {
      if (autosaveStatus === "offline") setAutosaveStatus("idle");
      // If a save was queued while offline, trigger immediately
      if (pendingRetryRef.current) {
        pendingRetryRef.current = false;
        setAutosaveStatus("pending");
      }
    };
    const handleOffline = () => setAutosaveStatus("offline");
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    if (typeof navigator !== "undefined" && !navigator.onLine) setAutosaveStatus("offline");
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [autosaveStatus]);

  useEffect(() => {
    if (!initialized && profile && user) {
      setForm({
        firstName: profile.first_name || "",
        lastName: profile.last_name || "",
        email: profile.email || user.email || "",
        country: profile.country || "",
        timezone: profile.timezone || "",
        discordUsername: profile.discord_username || "",
        interests: profile.interests || [],
        portfolio_url: profile.portfolio_url || "",
        linkedin_url: profile.linkedin_url || "",
        scheduling_url: (profile as any).scheduling_url || "",
        experience_areas: profile.experience_areas || [],
        professional_goals: profile.professional_goals || "",
        notify_training_opportunities: profile.notify_training_opportunities || false,
        notify_announcements: (profile as any).notify_announcements || false,
        education_background: profile.education_background || [],
      });
      setInitialized(true);
    }
  }, [profile, user, initialized]);

  // ---------------- Auto-save ----------------
  // Snapshot the form state into the DB columns, debounced. Never sets
  // profile_completed (that only happens on explicit "Complete" submit).
  // Uses ProfileService.updateFields which is allowlist-protected.
  const performAutosave = useCallback(async () => {
    if (!user) return;
    if (saveInFlightRef.current) {
      // Re-trigger after current save finishes
      pendingRetryRef.current = true;
      return;
    }
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setAutosaveStatus("offline");
      pendingRetryRef.current = true;
      return;
    }

    const payload: Record<string, unknown> = {
      first_name: form.firstName,
      last_name: form.lastName,
      display_name: `${form.firstName} ${form.lastName}`.trim(),
      country: form.country,
      timezone: form.timezone,
      interests: form.interests || [],
      portfolio_url: form.portfolio_url || "",
      linkedin_url: form.linkedin_url || "",
      scheduling_url: form.scheduling_url || "",
      experience_areas: form.experience_areas || [],
      professional_goals: form.professional_goals || "",
      notify_training_opportunities: !!form.notify_training_opportunities,
      notify_announcements: !!form.notify_announcements,
      education_background: form.education_background || [],
    };

    const serialized = JSON.stringify(payload);
    if (serialized === lastSerializedRef.current) {
      // Nothing actually changed since last successful save — skip the round-trip
      setAutosaveStatus((prev) => (prev === "pending" ? "saved" : prev));
      return;
    }

    saveInFlightRef.current = true;
    setAutosaveStatus("saving");
    try {
      await ProfileService.updateFields(user.id, payload);
      lastSerializedRef.current = serialized;
      setLastSavedAt(new Date());
      setAutosaveStatus("saved");
    } catch (err) {
      setAutosaveStatus("error");
      // Auto-retry once after a short delay
      pendingRetryRef.current = true;
    } finally {
      saveInFlightRef.current = false;
      // If user kept typing during the save, kick off another debounce
      if (pendingRetryRef.current) {
        pendingRetryRef.current = false;
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(performAutosave, 1500);
      }
    }
  }, [user, form]);

  // Debounced trigger: every form change schedules a save 1.2s later.
  useEffect(() => {
    if (!initialized || !user || !open) return;

    setAutosaveStatus((prev) => (prev === "offline" ? "offline" : "pending"));
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      performAutosave();
    }, 1200);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [form, initialized, user, open, performAutosave]);

  // Flush a pending save when the user closes the dialog or navigates away.
  useEffect(() => {
    const flush = () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
        // Fire-and-forget; we can't await in beforeunload reliably.
        performAutosave();
      }
    };
    window.addEventListener("beforeunload", flush);
    // reason: tab-switch-safe — flushes a debounced autosave when the tab is hidden; never reloads or redirects.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flush();
    });
    return () => {
      window.removeEventListener("beforeunload", flush);
    };
  }, [performAutosave]);
  // -------------------------------------------

  const toggleInterest = (interest: string) => {
    setForm((prev) => ({
      ...prev,
      interests: prev.interests.includes(interest)
        ? prev.interests.filter((i) => i !== interest)
        : [...prev.interests, interest],
    }));
  };
  const selectedTimezoneLabel =
    TIMEZONES.find((tz) => tz.value === form.timezone)?.label || form.timezone;

  const handleComplete = async (e: FormEvent) => {
    e.preventDefault();
    if (!user) return;

    const fieldErrors: Record<string, string> = {};
    if (!isOAuth) {
      if (!form.email.trim()) fieldErrors.email = "Email is required";
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()))
        fieldErrors.email = "Please enter a valid email";
    }
    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors);
      showFormErrors(fieldErrors, PROFILE_FIELD_LABELS, PROFILE_FIELD_GUIDANCE);
      scrollToFirstError();
      return;
    }

    const result = profileSchema.safeParse({
      firstName: form.firstName,
      lastName: form.lastName,
      country: form.country,
      timezone: form.timezone,
      discordUsername: form.discordUsername,
      interests: form.interests,
      portfolio_url: form.portfolio_url,
      linkedin_url: form.linkedin_url,
      scheduling_url: form.scheduling_url,
      experience_areas: form.experience_areas,
      professional_goals: form.professional_goals,
      notify_training_opportunities: form.notify_training_opportunities,
      notify_announcements: form.notify_announcements,
      education_background: form.education_background,
    });

    if (!result.success) {
      reportValidationRejection(
        "profileSchema",
        result.error.issues,
        "ProfileSetupDialog.handleSubmit"
      );
      const errs: Record<string, string> = {};
      result.error.issues.forEach((err) => {
        const field = err.path[0] as string;
        if (!errs[field]) errs[field] = err.message;
      });
      setErrors(errs);
      showFormErrors(errs, PROFILE_FIELD_LABELS, PROFILE_FIELD_GUIDANCE);
      scrollToFirstError();
      return;
    }

    setErrors({});
    setSaving(true);

    try {
      await ProfileService.update(user.id, result.data, !isOAuth ? form.email.trim() : undefined);
      await refreshProfile();
      await JourneyService.upsertTask(user.id, "first_steps", "profile", true);
      const displayName = `${result.data.firstName} ${result.data.lastName}`.trim();
      const discordUser = result.data.discordUsername || undefined;
      const updatedProfile = await ProfileService.fetch(user.id);
      const discordId = updatedProfile?.discord_user_id || undefined;
      DiscordNotifyService.profileCompleted(
        displayName,
        result.data.country,
        discordUser,
        discordId
      );
      DiscordNotifyService.taskCompleted(displayName, "profile", discordUser, discordId);
      setOpen(false);
    } catch (err: any) {
      const generalErr = { general: err.message };
      setErrors(generalErr);
      showFormErrors(generalErr, PROFILE_FIELD_LABELS, PROFILE_FIELD_GUIDANCE);
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className={cn(
          "p-0 gap-0 flex flex-col overflow-hidden",
          // Mobile: full-screen sheet. Tablet+: centered modal with comfortable max width.
          "w-screen h-[100dvh] max-w-none rounded-none border-0",
          "sm:w-[calc(100vw-2rem)] sm:h-auto sm:max-h-[92dvh] sm:max-w-2xl sm:rounded-lg sm:border",
          "lg:max-w-3xl xl:max-w-4xl"
        )}
      >
        <DialogHeader className="px-4 sm:px-6 pt-5 sm:pt-6 pb-3 sm:pb-4 shrink-0 border-b">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <DialogTitle className="text-lg sm:text-xl">Welcome to Tech Fleet</DialogTitle>
              <DialogDescription className="mt-1 text-sm">
                Take a moment to set up your profile so we can personalize your experience. You can
                also finish this later from your onboarding steps.
              </DialogDescription>
            </div>
            <AutosaveIndicator status={autosaveStatus} lastSavedAt={lastSavedAt} />
          </div>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
          <form
            id="profile-setup-form"
            onSubmit={handleComplete}
            className="px-4 sm:px-6 py-5 sm:py-6 space-y-8"
            noValidate
          >
            {errors.general && (
              <div
                className="p-3 rounded-md bg-destructive/10 text-destructive text-sm"
                role="alert"
              >
                {errors.general}
              </div>
            )}

            {/* Section: Basics */}
            <section className="space-y-4" aria-labelledby="setup-section-basics">
              <h3
                id="setup-section-basics"
                className="text-sm font-semibold text-foreground/80 uppercase tracking-wide"
              >
                The basics
              </h3>

              {/* Email — full width */}
              <div className="space-y-1.5">
                <Label htmlFor="dialog-email">
                  Email {!isOAuth && <span className="text-destructive">*</span>}
                </Label>
                <div className="relative">
                  <Mail
                    className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none"
                    aria-hidden="true"
                  />
                  <Input
                    id="dialog-email"
                    type="email"
                    value={form.email}
                    onChange={(e) => !isOAuth && setForm({ ...form, email: e.target.value })}
                    readOnly={!!isOAuth}
                    disabled={!!isOAuth}
                    className={cn("pl-10", isOAuth && "bg-muted/50")}
                    aria-invalid={!!errors.email}
                  />
                </div>
                {isOAuth && (
                  <p className="text-xs text-muted-foreground">
                    Email is managed by your Google account.
                  </p>
                )}
                {errors.email && (
                  <p className="text-sm text-destructive flex items-center gap-1" role="alert">
                    <AlertCircle className="h-3 w-3" /> {errors.email}
                  </p>
                )}
              </div>

              {/* First/Last name — 2-col on sm+ */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="dialog-firstName">
                    First name <span className="text-destructive">*</span>
                  </Label>
                  <div className="relative">
                    <User
                      className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none"
                      aria-hidden="true"
                    />
                    <Input
                      id="dialog-firstName"
                      value={form.firstName}
                      onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                      placeholder="Jane"
                      className="pl-10"
                      required
                      aria-invalid={!!errors.firstName}
                    />
                  </div>
                  {errors.firstName && (
                    <p className="text-sm text-destructive flex items-center gap-1" role="alert">
                      <AlertCircle className="h-3 w-3" /> {errors.firstName}
                    </p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="dialog-lastName">
                    Last name <span className="text-destructive">*</span>
                  </Label>
                  <div className="relative">
                    <User
                      className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none"
                      aria-hidden="true"
                    />
                    <Input
                      id="dialog-lastName"
                      value={form.lastName}
                      onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                      placeholder="Doe"
                      className="pl-10"
                      required
                      aria-invalid={!!errors.lastName}
                    />
                  </div>
                  {errors.lastName && (
                    <p className="text-sm text-destructive flex items-center gap-1" role="alert">
                      <AlertCircle className="h-3 w-3" /> {errors.lastName}
                    </p>
                  )}
                </div>
              </div>

              {/* Country/Timezone — 2-col on sm+ */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="dialog-country-trigger">
                    Country <span className="text-destructive">*</span>
                  </Label>
                  <SearchFirstCombobox
                    id="dialog-country-trigger"
                    open={countryOpen}
                    onOpenChange={setCountryOpen}
                    selectedValue={form.country}
                    selectedLabel={form.country}
                    emptyLabel="Search country"
                    searchPlaceholder="Start typing a country name…"
                    emptyMessage="No country found."
                    options={COUNTRIES.map((c) => ({ value: c.name, label: c.name }))}
                    icon={
                      <Globe
                        className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none"
                        aria-hidden="true"
                      />
                    }
                    invalid={!!errors.country}
                    contentClassName="z-[60]"
                    listClassName="max-h-[260px]"
                    modal
                    onSelect={(value) => {
                      setForm((prev) => ({ ...prev, country: value }));
                      setCountryOpen(false);
                    }}
                  />
                  {errors.country && (
                    <p className="text-sm text-destructive flex items-center gap-1" role="alert">
                      <AlertCircle className="h-3 w-3" /> {errors.country}
                    </p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="dialog-timezone-trigger">
                    Timezone <span className="text-destructive">*</span>
                  </Label>
                  <SearchFirstCombobox
                    id="dialog-timezone-trigger"
                    open={timezoneOpen}
                    onOpenChange={setTimezoneOpen}
                    selectedValue={form.timezone}
                    selectedLabel={selectedTimezoneLabel}
                    emptyLabel="Search timezone"
                    searchPlaceholder="Start typing a city, region, or GMT offset…"
                    emptyMessage="No timezone found."
                    options={TIMEZONES.map((tz) => ({ value: tz.value, label: tz.label }))}
                    icon={
                      <Clock
                        className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none"
                        aria-hidden="true"
                      />
                    }
                    invalid={!!errors.timezone}
                    contentClassName="z-[60]"
                    listClassName="max-h-[260px]"
                    modal
                    onSelect={(value) => {
                      setForm((prev) => ({ ...prev, timezone: value }));
                      setTimezoneOpen(false);
                    }}
                  />
                  {errors.timezone && (
                    <p className="text-sm text-destructive flex items-center gap-1" role="alert">
                      <AlertCircle className="h-3 w-3" /> {errors.timezone}
                    </p>
                  )}
                </div>
              </div>

              <ProfileDiscordConnector />
            </section>

            {/* Section: Links */}
            <section className="space-y-4" aria-labelledby="setup-section-links">
              <h3
                id="setup-section-links"
                className="text-sm font-semibold text-foreground/80 uppercase tracking-wide"
              >
                Your links{" "}
                <span className="font-normal normal-case text-muted-foreground">(optional)</span>
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="dialog-portfolio">Portfolio URL</Label>
                  <Input
                    id="dialog-portfolio"
                    type="url"
                    value={form.portfolio_url}
                    onChange={(e) => setForm({ ...form, portfolio_url: e.target.value })}
                    placeholder="https://yourportfolio.com"
                    maxLength={500}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="dialog-linkedin">LinkedIn URL</Label>
                  <Input
                    id="dialog-linkedin"
                    type="url"
                    value={form.linkedin_url}
                    onChange={(e) => setForm({ ...form, linkedin_url: e.target.value })}
                    placeholder="https://linkedin.com/in/yourprofile"
                    maxLength={500}
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="dialog-scheduling">Your scheduling link</Label>
                  <Input
                    id="dialog-scheduling"
                    type="url"
                    value={form.scheduling_url}
                    onChange={(e) => setForm({ ...form, scheduling_url: e.target.value })}
                    placeholder="https://calendly.com/yourname"
                    maxLength={500}
                  />
                </div>
              </div>
            </section>

            {/* Section: Interests */}
            <section className="space-y-4" aria-labelledby="setup-section-interests">
              <h3
                id="setup-section-interests"
                className="text-sm font-semibold text-foreground/80 uppercase tracking-wide"
              >
                Activity interests
              </h3>
              <p className="text-xs text-muted-foreground -mt-2">
                What kinds of activities do you want to do in Tech Fleet?
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {ACTIVITY_OPTIONS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => toggleInterest(option)}
                    className={cn(
                      "w-full text-left p-3 rounded-lg border transition-all flex items-center gap-3 min-h-[44px]",
                      form.interests.includes(option)
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/50"
                    )}
                    aria-pressed={form.interests.includes(option)}
                  >
                    <div
                      className={cn(
                        "h-4 w-4 shrink-0 rounded-sm border flex items-center justify-center",
                        form.interests.includes(option)
                          ? "bg-primary border-primary text-primary-foreground"
                          : "border-primary"
                      )}
                      aria-hidden="true"
                    >
                      {form.interests.includes(option) && <Check className="h-3 w-3" />}
                    </div>
                    <span className="text-sm text-foreground">{option}</span>
                  </button>
                ))}
              </div>
            </section>

            {/* Section: Background */}
            <section className="space-y-4" aria-labelledby="setup-section-background">
              <h3
                id="setup-section-background"
                className="text-sm font-semibold text-foreground/80 uppercase tracking-wide"
              >
                Background &amp; goals
              </h3>

              <div className="space-y-1.5">
                <Label>Experience areas</Label>
                <p className="text-xs text-muted-foreground">
                  What areas do you want to gain experience in?
                </p>
                <ExperienceAreasSelect
                  selected={form.experience_areas}
                  onChange={(v) => setForm({ ...form, experience_areas: v })}
                />
              </div>

              <div className="space-y-1.5">
                <Label>Education background</Label>
                <MultiSelect
                  options={EDUCATION_OPTIONS.map((e) => ({ value: e, label: e }))}
                  selected={form.education_background}
                  onChange={(v) => setForm({ ...form, education_background: v })}
                  placeholder="Search or select education..."
                  aria-label="Education background"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="dialog-goals">Professional development goals</Label>
                <Textarea
                  id="dialog-goals"
                  value={form.professional_goals}
                  onChange={(e) => setForm({ ...form, professional_goals: e.target.value })}
                  placeholder="Describe your professional development goals..."
                  className="min-h-[100px] resize-y"
                  maxLength={5000}
                />
              </div>
            </section>

            {/* Section: Notifications */}
            <section className="space-y-3" aria-labelledby="setup-section-notifications">
              <h3
                id="setup-section-notifications"
                className="text-sm font-semibold text-foreground/80 uppercase tracking-wide"
              >
                Notification preferences
              </h3>
              <div className="flex items-start gap-3">
                <Checkbox
                  id="dialog-notify-training"
                  checked={form.notify_training_opportunities}
                  onCheckedChange={(checked) =>
                    setForm({ ...form, notify_training_opportunities: !!checked })
                  }
                  className="mt-0.5"
                />
                <div className="min-w-0">
                  <Label
                    htmlFor="dialog-notify-training"
                    className="text-sm leading-relaxed cursor-pointer"
                  >
                    Notify me about training opportunities that match my preferences
                  </Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Receive in-app notifications when matching opportunities open.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Checkbox
                  id="dialog-notify-announcements"
                  checked={form.notify_announcements}
                  onCheckedChange={(checked) =>
                    setForm({ ...form, notify_announcements: !!checked })
                  }
                  className="mt-0.5"
                />
                <div className="min-w-0">
                  <Label
                    htmlFor="dialog-notify-announcements"
                    className="text-sm leading-relaxed cursor-pointer"
                  >
                    Send me email notifications
                  </Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Receive emails about announcements and, if combined with the above, training
                    opportunity alerts.
                  </p>
                </div>
              </div>
            </section>
          </form>
        </div>

        {/* Sticky footer — safe-area aware on mobile */}
        <div
          className="border-t bg-background px-4 sm:px-6 py-3 sm:py-4 shrink-0 flex flex-col-reverse sm:flex-row sm:justify-end gap-2"
          style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 0.75rem)" }}
        >
          <Button
            type="button"
            variant="ghost"
            onClick={() => setOpen(false)}
            disabled={saving}
            className="w-full sm:w-auto"
          >
            Skip for now
          </Button>
          <Button
            form="profile-setup-form"
            type="submit"
            disabled={saving}
            className="w-full sm:w-auto sm:min-w-[220px]"
          >
            {saving ? "Saving…" : "Complete Profile Setup"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Visible auto-save status — gives users continuous feedback that their
 * data is being saved (Nielsen heuristic #1: visibility of system status).
 */
function AutosaveIndicator({
  status,
  lastSavedAt,
}: {
  status: "idle" | "pending" | "saving" | "saved" | "error" | "offline";
  lastSavedAt: Date | null;
}) {
  const formatTime = (d: Date) =>
    d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

  let icon: React.ReactNode = null;
  let label = "";
  let tone = "text-muted-foreground";

  switch (status) {
    case "saving":
      icon = <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />;
      label = "Saving…";
      break;
    case "pending":
      icon = <CloudUpload className="h-3.5 w-3.5" aria-hidden="true" />;
      label = "Unsaved changes";
      break;
    case "saved":
      icon = <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />;
      label = lastSavedAt ? `Saved at ${formatTime(lastSavedAt)}` : "All changes saved";
      tone = "text-emerald-600 dark:text-emerald-400";
      break;
    case "error":
      icon = <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />;
      label = "Couldn't save — will retry";
      tone = "text-destructive";
      break;
    case "offline":
      icon = <CloudOff className="h-3.5 w-3.5" aria-hidden="true" />;
      label = "Offline — will save when reconnected";
      tone = "text-amber-600 dark:text-amber-400";
      break;
    case "idle":
    default:
      icon = <CloudUpload className="h-3.5 w-3.5 opacity-60" aria-hidden="true" />;
      label = "Auto-saves as you type";
      break;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={cn(
        "shrink-0 inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap",
        tone
      )}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
      <span className="sr-only sm:hidden">{label}</span>
    </div>
  );
}
