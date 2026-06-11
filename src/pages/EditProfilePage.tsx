import { useState, useEffect, useLayoutEffect, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { MultiSelect } from "@/components/ui/multi-select";
import { ResponsiveTabs, ResponsiveTabsList, ResponsiveTabsContent, type TabItem } from "@/components/ui/responsive-tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import {
  User, Globe, Check,
  Mail, Trash2, KeyRound, Clock, AlertCircle, Loader2,
} from "lucide-react";
import { PushNotificationToggle } from "@/components/PushNotificationToggle";
import { InstallAppCard } from "@/components/InstallAppCard";
import { MembershipTiersGrid } from "@/components/MembershipTiersGrid";
import { MembershipFaq } from "@/components/MembershipFaq";
import { CurrentMembershipBanner } from "@/components/CurrentMembershipBanner";
import { Skeleton } from "@/components/ui/skeleton";

import { useAuth } from "@/contexts/AuthContext";
import { useMembershipRealtime } from "@/hooks/use-membership-realtime";
import { ProfileService } from "@/services/profile.service";
import { sessionPort } from "@/features/auth/ports/session.port";
import { profileSchema, ACTIVITY_OPTIONS } from "@/lib/validators/profile";
import { EDUCATION_OPTIONS } from "@/lib/application-options";
import { COUNTRIES } from "@/lib/countries";
import { TIMEZONES } from "@/lib/timezones";
import { cn } from "@/lib/utils";
import { AvatarUpload } from "@/components/AvatarUpload";
import { supabase } from "@/integrations/supabase/client";
import { TotpMfaManagement } from "@/components/TotpMfaManagement";
import { toast } from "sonner";
import { usePageHeader } from "@/contexts/PageHeaderContext";
import { ExperienceAreasSelect } from "@/components/ExperienceAreasSelect";
import { ValidatedField } from "@/components/ui/validated-field";
import { validationBorderClass, getFieldValidationState, showFormErrors, scrollToFirstError } from "@/lib/form-validation";
import { SearchFirstCombobox } from "@/components/profile/SearchFirstCombobox";
import { ProfileDiscordConnector } from "@/components/profile/ProfileDiscordConnector";
import { ScopedErrorBoundary } from "@/components/ScopedErrorBoundary";
import { reportValidationRejection } from "@/services/error-reporter.service";
import { getGumroadManageUrl } from "@/lib/gumroad";

export default function EditProfilePage() {
  const { user, profile, refreshProfile, signOut } = useAuth();
  const { syncing: membershipSyncing } = useMembershipRealtime();
  const navigate = useNavigate();
  const { setHeader } = usePageHeader();

  const isOAuth = user?.app_metadata?.provider === "google" || user?.app_metadata?.providers?.includes("google");

  const [form, setForm] = useState({
    firstName: "", lastName: "", email: "", country: "", timezone: "",
    discordUsername: "", interests: [] as string[],
    portfolio_url: "", linkedin_url: "", scheduling_url: "",
    experience_areas: [] as string[], professional_goals: "",
    notify_training_opportunities: false, notify_announcements: false,
    education_background: [] as string[],
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [countryOpen, setCountryOpen] = useState(false);
  const [timezoneOpen, setTimezoneOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [resetPasswordLoading, setResetPasswordLoading] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [searchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const validTabs = ["basic-info", "background", "preferences", "membership", "account"];
  const [activeTab, setActiveTab] = useState(
    tabParam && validTabs.includes(tabParam) ? tabParam : "basic-info"
  );

  // Sync activeTab with ?tab= changes (e.g. profile menu re-navigation while on /profile/edit)
  useEffect(() => {
    if (tabParam && validTabs.includes(tabParam) && tabParam !== activeTab) {
      setActiveTab(tabParam);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabParam]);

  useEffect(() => {
    if (!initialized && profile) {
      setForm({
        firstName: profile.first_name || "",
        lastName: profile.last_name || "",
        email: profile.email || user?.email || "",
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
      setErrors({});
      setInitialized(true);
    }
  }, [profile, user, initialized]);

  const markTouched = (field: string) =>
    setTouched((prev) => ({ ...prev, [field]: true }));

  // Real-time validation for touched fields
  useEffect(() => {
    if (Object.keys(touched).length === 0) return;
    const result = profileSchema.safeParse({
      firstName: form.firstName, lastName: form.lastName, country: form.country,
      timezone: form.timezone, discordUsername: form.discordUsername,
      interests: form.interests, portfolio_url: form.portfolio_url,
      linkedin_url: form.linkedin_url, scheduling_url: form.scheduling_url,
      experience_areas: form.experience_areas,
      professional_goals: form.professional_goals,
      notify_training_opportunities: form.notify_training_opportunities,
      notify_announcements: form.notify_announcements,
      education_background: form.education_background,
    });
    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      result.error.issues.forEach((err) => {
        const field = err.path[0] as string;
        if (!fieldErrors[field]) fieldErrors[field] = err.message;
      });
      const touchedErrors: Record<string, string> = {};
      for (const [k, v] of Object.entries(fieldErrors)) {
        if (touched[k]) touchedErrors[k] = v;
      }
      setErrors(touchedErrors);
    } else {
      // Clear only touched field errors
      const remaining: Record<string, string> = {};
      for (const [k, v] of Object.entries(errors)) {
        if (!touched[k]) remaining[k] = v;
      }
      setErrors(remaining);
    }
  }, [form, touched]);

  const toggleInterest = (interest: string) => {
    setForm((prev) => ({
      ...prev,
      interests: prev.interests.includes(interest)
        ? prev.interests.filter((i) => i !== interest)
        : [...prev.interests, interest],
    }));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    // Mark all fields touched
    const allTouched: Record<string, boolean> = {
      firstName: true, lastName: true, country: true, timezone: true,
      discordUsername: true, email: true,
    };
    setTouched(allTouched);

    const result = profileSchema.safeParse({
      firstName: form.firstName, lastName: form.lastName, country: form.country,
      timezone: form.timezone, discordUsername: form.discordUsername,
      interests: form.interests, portfolio_url: form.portfolio_url,
      linkedin_url: form.linkedin_url, scheduling_url: form.scheduling_url,
      experience_areas: form.experience_areas,
      professional_goals: form.professional_goals,
      notify_training_opportunities: form.notify_training_opportunities,
      notify_announcements: form.notify_announcements,
      education_background: form.education_background,
    });

    if (!result.success) {
      reportValidationRejection("profileSchema", result.error.issues, "EditProfilePage.handleSubmit");
      const fieldErrors: Record<string, string> = {};
      result.error.issues.forEach((err) => {
        const field = err.path[0] as string;
        if (!fieldErrors[field]) fieldErrors[field] = err.message;
      });
      setErrors(fieldErrors);

      const fieldLabels: Record<string, string> = {
        firstName: "First name", lastName: "Last name", country: "Country",
        timezone: "Timezone", discordUsername: "Discord username", email: "Email",
      };
      showFormErrors(fieldErrors, fieldLabels);

      // Switch to tab with first error
      const fieldToTab: Record<string, string> = {
        firstName: "basic-info", lastName: "basic-info", country: "basic-info",
        timezone: "basic-info", discordUsername: "basic-info", email: "basic-info",
      };
      const firstField = Object.keys(fieldErrors)[0];
      const targetTab = fieldToTab[firstField];
      if (targetTab) {
        setActiveTab(targetTab);
        scrollToFirstError();
      }
      return;
    }

    if (!isOAuth) {
      if (!form.email.trim()) {
        setErrors({ email: "Email is required" });
        showFormErrors({ email: "Email is required" }, { email: "Email" });
        setActiveTab("basic-info");
        scrollToFirstError();
        return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
        setErrors({ email: "Please enter a valid email" });
        showFormErrors({ email: "Please enter a valid email" }, { email: "Email" });
        setActiveTab("basic-info");
        scrollToFirstError();
        return;
      }
    }

    setErrors({});
    setSaving(true);
    try {
      await ProfileService.update(user!.id, result.data, !isOAuth ? form.email.trim() : undefined);
      await refreshProfile();
      // Force form re-initialization from fresh profile on next render
      setInitialized(false);
      setTouched({});
      toast.success("Profile saved.", { duration: 5000, position: "top-center" });
    } catch (err: any) {
      setErrors({ general: err.message });
      showFormErrors({ general: err.message }, { general: "Save" });
    } finally {
      setSaving(false);
    }
  };

  const handleResetPassword = async () => {
    if (!user?.email) return;
    setResetPasswordLoading(true);
    try {
      await sessionPort.resetPassword(user.email, `${window.location.origin}/reset-password`);
      toast.success("Password reset email sent — check your inbox.", {
        description: "Check your inbox for a link to reset your password.",
        duration: 5000,
        position: "top-center",
      });
    } catch {
      toast.info("If an account exists with that email, a reset link has been sent.", { duration: 5000, position: "top-center" });
    } finally {
      setResetPasswordLoading(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirmText !== "Delete") return;
    setDeleting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");
      const res = await supabase.functions.invoke("delete-account", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.error) throw new Error("Failed to delete account");
      toast.success("Your account has been deleted.", { duration: 5000, position: "top-center" });
      setDeleteDialogOpen(false);
      await supabase.auth.signOut({ scope: "local" });
      navigate("/", { replace: true });
    } catch (err: any) {
      toast.error(err.message || "We couldn't delete your account. Please try again.", { duration: 30000, position: "top-center" });
    } finally {
      setDeleting(false);
    }
  };

  useLayoutEffect(() => {
    setHeader({
      breadcrumbs: [
        { label: "Dashboard", href: "/dashboard" },
        { label: "Edit Profile" },
      ],
      title: "Edit Profile",
      description: "Manage your profile information, background, and preferences.",
    });
    return () => setHeader(null);
  }, [setHeader]);

  const vs = (field: string, value: string | string[] | boolean) =>
    getFieldValidationState(errors[field], value, !!touched[field]);
  const bc = (field: string, value: string | string[] | boolean) =>
    validationBorderClass(vs(field, value));
  const selectedTimezoneLabel = TIMEZONES.find((tz) => tz.value === form.timezone)?.label || form.timezone;

  return (
    <form
      id="edit-profile-form"
      onSubmit={handleSubmit}
      noValidate
      className="flex flex-col h-[calc(100dvh-3rem)] animate-fade-in"
    >
      <ResponsiveTabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col flex-1 min-h-0">
        {/* Sticky tabs */}
        <div className="sticky top-0 z-30 bg-background border-b px-4 sm:px-6 py-2 pt-safe pl-safe pr-safe">
          {errors.general && (
            <div className="mb-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm" role="alert">
              {errors.general}
            </div>
          )}
          <ResponsiveTabsList
            tabs={[
              { value: "basic-info", label: "Basic Info" },
              { value: "background", label: "Background" },
              { value: "preferences", label: "Preferences" },
              { value: "membership", label: "Membership" },
              { value: "account", label: "Account" },
            ] as TabItem[]}
            value={activeTab}
            onValueChange={setActiveTab}
          />
        </div>

        {/* Scrollable content area */}
        <div className="flex-1 overflow-y-auto">
          <div className="container-app max-w-3xl py-6">

          {/* ── Tab 1: Basic Info ── */}
          <ResponsiveTabsContent value="basic-info" className="space-y-6">
            <div className="card-elevated p-6 sm:p-8 space-y-6">
              {/* Avatar */}
              {user && (
                <AvatarUpload
                  userId={user.id}
                  currentUrl={profile?.avatar_url || null}
                  initials={`${(form.firstName?.[0] || "").toUpperCase()}${(form.lastName?.[0] || "").toUpperCase()}` || "U"}
                  onUploaded={async () => { await refreshProfile(); }}
                />
              )}

              {/* Email */}
              <ValidatedField id="edit-email" label="Email" error={errors.email} value={form.email} touched={touched.email}>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  <Input
                    id="edit-email"
                    type="email"
                    value={form.email}
                    onChange={(e) => !isOAuth && setForm({ ...form, email: e.target.value })}
                    onBlur={() => markTouched("email")}
                    readOnly={!!isOAuth}
                    disabled={!!isOAuth}
                    className={cn("pl-10", isOAuth && "bg-muted/50", bc("email", form.email))}
                    aria-invalid={!!errors.email}
                  />
                </div>
                {isOAuth ? (
                  <p className="text-xs text-muted-foreground">Email is managed by your Google account.</p>
                ) : (
                  <p className="text-xs text-muted-foreground">Update your contact email address.</p>
                )}
              </ValidatedField>

              {/* First name */}
              <ValidatedField id="edit-firstName" label="First name" required error={errors.firstName} value={form.firstName} touched={touched.firstName}>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  <Input id="edit-firstName" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} onBlur={() => markTouched("firstName")} placeholder="Jane" className={cn("pl-10", bc("firstName", form.firstName))} required aria-invalid={!!errors.firstName} />
                </div>
              </ValidatedField>

              {/* Last name */}
              <ValidatedField id="edit-lastName" label="Last name" required error={errors.lastName} value={form.lastName} touched={touched.lastName}>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  <Input id="edit-lastName" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} onBlur={() => markTouched("lastName")} placeholder="Doe" className={cn("pl-10", bc("lastName", form.lastName))} required aria-invalid={!!errors.lastName} />
                </div>
              </ValidatedField>

              {/* Country */}
              <ValidatedField id="edit-country" label="Country" required error={errors.country} value={form.country} touched={touched.country}>
                <SearchFirstCombobox id="edit-country-trigger" open={countryOpen} onOpenChange={setCountryOpen} selectedValue={form.country} selectedLabel={form.country} emptyLabel="Search country" searchPlaceholder="Start typing a country name…" emptyMessage="No country found." options={COUNTRIES.map((c) => ({ value: c.name, label: c.name }))} icon={<Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />} invalid={!!errors.country} triggerClassName={bc("country", form.country)} onSelect={(value) => { setForm({ ...form, country: value }); setCountryOpen(false); markTouched("country"); }} />
              </ValidatedField>

              {/* Timezone */}
              <ValidatedField id="edit-timezone" label="Timezone" required error={errors.timezone} value={form.timezone} touched={touched.timezone}>
                <SearchFirstCombobox id="edit-timezone-trigger" open={timezoneOpen} onOpenChange={setTimezoneOpen} selectedValue={form.timezone} selectedLabel={selectedTimezoneLabel} emptyLabel="Search timezone" searchPlaceholder="Start typing a city, region, or GMT offset…" emptyMessage="No timezone found." options={TIMEZONES.map((tz) => ({ value: tz.value, label: tz.label }))} icon={<Clock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />} invalid={!!errors.timezone} triggerClassName={bc("timezone", form.timezone)} onSelect={(value) => { setForm({ ...form, timezone: value }); setTimezoneOpen(false); markTouched("timezone"); }} />
              </ValidatedField>

              <ScopedErrorBoundary label="Discord connector">
                <ProfileDiscordConnector />
              </ScopedErrorBoundary>

              {/* Portfolio & LinkedIn */}
              <ValidatedField id="edit-portfolio" label="Portfolio URL" value={form.portfolio_url} touched={touched.portfolio_url}>
                <Input id="edit-portfolio" type="url" value={form.portfolio_url} onChange={(e) => setForm({ ...form, portfolio_url: e.target.value })} placeholder="https://yourportfolio.com" maxLength={500} />
              </ValidatedField>
              <ValidatedField id="edit-linkedin" label="LinkedIn URL" value={form.linkedin_url} touched={touched.linkedin_url}>
                <Input id="edit-linkedin" type="url" value={form.linkedin_url} onChange={(e) => setForm({ ...form, linkedin_url: e.target.value })} placeholder="https://linkedin.com/in/yourprofile" maxLength={500} />
              </ValidatedField>
              <ValidatedField id="edit-scheduling" label="Your Scheduling Link" value={form.scheduling_url} touched={touched.scheduling_url}>
                <Input id="edit-scheduling" type="url" value={form.scheduling_url} onChange={(e) => setForm({ ...form, scheduling_url: e.target.value })} placeholder="https://calendly.com/yourname" maxLength={500} />
              </ValidatedField>
            </div>
          </ResponsiveTabsContent>


          {/* ── Tab 2: Background ── */}
          <ResponsiveTabsContent value="background" className="space-y-6">
            <div className="card-elevated p-6 sm:p-8 space-y-6">
              {/* Activity Interests */}
              <div className="space-y-3">
                <Label>Activity interests</Label>
                <p className="text-xs text-muted-foreground">What kinds of activities do you want to do in Tech Fleet?</p>
                {ACTIVITY_OPTIONS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => toggleInterest(option)}
                    className={cn(
                      "w-full text-left p-3 rounded-lg border transition-all flex items-center gap-3",
                      form.interests.includes(option) ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
                    )}
                  >
                    <div className={cn("h-4 w-4 shrink-0 rounded-sm border flex items-center justify-center", form.interests.includes(option) ? "bg-primary border-primary text-primary-foreground" : "border-primary")} aria-hidden="true">
                      {form.interests.includes(option) && <Check className="h-3 w-3" />}
                    </div>
                    <span className="text-sm text-foreground">{option}</span>
                  </button>
                ))}
              </div>

              {/* Experience Areas */}
              <div className="space-y-1.5">
                <Label>Experience areas</Label>
                <p className="text-xs text-muted-foreground">What areas do you want to gain experience in?</p>
                <ExperienceAreasSelect
                  selected={form.experience_areas}
                  onChange={(v) => setForm({ ...form, experience_areas: v })}
                />
              </div>

              {/* Professional Goals */}
              <div className="space-y-1.5">
                <Label htmlFor="edit-professional-goals">Professional development goals</Label>
                <Textarea
                  id="edit-professional-goals"
                  value={form.professional_goals}
                  onChange={(e) => setForm({ ...form, professional_goals: e.target.value })}
                  placeholder="Describe your professional development goals..."
                  className="min-h-[100px] resize-y"
                  maxLength={5000}
                />
              </div>

              {/* Education */}
              <div className="space-y-1.5">
                <Label>Education background</Label>
                <MultiSelect
                  options={EDUCATION_OPTIONS.map((e) => ({ value: e, label: e }))}
                  selected={form.education_background}
                  onChange={(v) => setForm({ ...form, education_background: v })}
                  placeholder="Search and select education..."
                  aria-label="Education background"
                />
              </div>
            </div>
          </ResponsiveTabsContent>


          <ResponsiveTabsContent value="preferences" className="space-y-6">
            <div className="card-elevated p-6 sm:p-8 space-y-6">
              <div className="space-y-4">
                <Label className="text-base font-semibold">Notification preferences</Label>
                <div className="flex items-start gap-3">
                  <Checkbox
                    id="edit-notify"
                    checked={form.notify_training_opportunities}
                    onCheckedChange={(checked) => setForm({ ...form, notify_training_opportunities: !!checked })}
                  />
                  <div>
                    <Label htmlFor="edit-notify" className="text-sm leading-relaxed cursor-pointer">
                      Notify me about training opportunities that match my preferences
                    </Label>
                    <p className="text-xs text-muted-foreground mt-0.5">Receive in-app notifications when matching opportunities open or change status.</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Checkbox
                    id="edit-notify-announcements"
                    checked={form.notify_announcements}
                    onCheckedChange={(checked) => setForm({ ...form, notify_announcements: !!checked })}
                  />
                  <div>
                    <Label htmlFor="edit-notify-announcements" className="text-sm leading-relaxed cursor-pointer">
                      Send me email notifications
                    </Label>
                    <p className="text-xs text-muted-foreground mt-0.5">Receive emails about announcements and, if combined with the above, training opportunity alerts.</p>
                  </div>
                </div>
                {/* Push Notifications */}
                <PushNotificationToggle />
              </div>

              {/* Install App */}
              <div className="space-y-4 pt-2 border-t border-border">
                <Label className="text-base font-semibold">App installation</Label>
                <InstallAppCard />
              </div>
            </div>
          </ResponsiveTabsContent>

          {/* ── Tab: Membership ── */}
          <ResponsiveTabsContent value="membership" className="space-y-6">
            {membershipSyncing ? (
              <section
                aria-label="Syncing current membership plan"
                aria-busy="true"
                className="rounded-lg border border-primary/40 bg-primary/5 p-5 sm:p-6"
              >
                <div className="flex items-start gap-3">
                  <Skeleton className="h-10 w-10 rounded-full" />
                  <div className="w-full max-w-md space-y-3">
                    <Skeleton className="h-3 w-28" />
                    <Skeleton className="h-7 w-64" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-40" />
                  </div>
                </div>
              </section>
            ) : (
              <CurrentMembershipBanner
                currentTier={profile?.membership_tier ?? "starter"}
                isFoundingMember={Boolean(profile?.is_founding_member)}
                billingPeriod={(profile as { membership_billing_period?: string } | null)?.membership_billing_period ?? null}
                membershipUpdatedAt={profile?.membership_updated_at ?? null}
                manageUrl={
                  (profile?.membership_tier ?? "starter") !== "starter"
                    ? getGumroadManageUrl(profile?.membership_sku ?? null)
                    : null
                }
              />
            )}
            <div className="card-elevated p-6 sm:p-8 space-y-6">
              <div className="space-y-2">
                <h2 className="text-2xl font-bold text-foreground">Membership Tiers</h2>
                <p className="text-sm text-muted-foreground max-w-2xl">
                  Tech Fleet's membership model invites everyone to practice shared
                  leadership and build a different world. Choose the tier that fits
                  where you are now. You can switch any time.
                </p>
              </div>

              <MembershipTiersGrid
                currentTier={profile?.membership_tier ?? "starter"}
                isFoundingMember={Boolean(profile?.is_founding_member)}
                manageUrl={getGumroadManageUrl(profile?.membership_sku ?? null)}
                onSelect={(intent) => {
                  if (intent.action === "subscribe" && intent.skuUrl) {
                    window.open(intent.skuUrl, "_blank", "noopener,noreferrer");
                    return;
                  }
                  if (intent.action === "subscribe" && !intent.skuUrl) {
                    toast.info(
                      "This subscription option isn't available yet — check back soon.",
                      { position: "top-center" },
                    );
                    return;
                  }
                  if (intent.action === "waitlist") {
                    toast.success(
                      `Thanks! We'll let you know when ${intent.tier === "professional" ? "Professional" : "this tier"} is ready.`,
                      { position: "top-center" },
                    );
                    return;
                  }
                  if (intent.action === "manage" || intent.action === "downgrade") {
                    const url = getGumroadManageUrl(profile?.membership_sku ?? null);
                    window.open(url, "_blank", "noopener,noreferrer");
                    return;
                  }
                }}
              />
            </div>
            <div className="card-elevated p-6 sm:p-8">
              <MembershipFaq />
            </div>
          </ResponsiveTabsContent>

          {/* ── Tab 4: Account ── */}
          <ResponsiveTabsContent value="account" className="space-y-6">
            <div className="card-elevated p-6 sm:p-8 space-y-6">
              <div className="space-y-1.5">
                <Label>Password</Label>
                {isOAuth ? (
                  <div className="p-3 rounded-lg bg-muted/50 border border-border">
                    <p className="text-sm text-muted-foreground">
                      You signed in with Google. Password management is handled by your Google account.
                    </p>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <Button type="button" variant="outline" size="sm" onClick={handleResetPassword} disabled={resetPasswordLoading}>
                      {resetPasswordLoading ? "Sending…" : "Reset Password"}
                    </Button>
                    <p className="text-xs text-muted-foreground">We'll send a reset link to your email.</p>
                  </div>
                )}
              </div>

              {/* Two-Factor Authentication (TOTP) — Google Authenticator, Authy, etc. */}
              <div className="pt-2 border-t">
                <TotpMfaManagement />
              </div>

              <div className="pt-2 border-t">
                <ScopedErrorBoundary label="Discord connector">
                  <ProfileDiscordConnector />
                </ScopedErrorBoundary>
              </div>

              <div className="space-y-1.5 pt-2 border-t">
                <Label>Your Data</Label>
                <p className="text-xs text-muted-foreground mb-2">Download a complete copy of all your data stored on this platform (GDPR / HIPAA Right of Access).</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    try {
                      toast.info("Preparing your data export…", { position: "top-center" });
                      const { data, error } = await supabase.rpc("export_my_data");
                      if (error) throw error;
                      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `techfleet-data-export-${new Date().toISOString().slice(0, 10)}.json`;
                      document.body.appendChild(a);
                      a.click();
                      document.body.removeChild(a);
                      URL.revokeObjectURL(url);
                      toast.success("Data export downloaded.", { position: "top-center" });
                    } catch {
                      toast.error("We couldn't export your data. Please try again.", { position: "top-center" });
                    }
                  }}
                >
                  Export My Data
                </Button>
              </div>

              <div className="space-y-1.5 pt-2 border-t">
                <Label className="text-destructive">Danger zone</Label>
                <p className="text-xs text-muted-foreground mb-2">Once you delete your account, there is no going back. Please be certain.</p>
                <Button
                  type="button"
                  variant="outline"
                  className="text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => { setDeleteConfirmText(""); setDeleteDialogOpen(true); }}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete Account
                </Button>
              </div>
            </div>
          </ResponsiveTabsContent>
          </div>
        </div>

        {/* Sticky save bar */}
        <div className="sticky bottom-0 z-30 bg-background border-t px-4 sm:px-6 py-3">
          <div className="container-app max-w-3xl">
            <Button type="submit" className="w-full sm:w-auto" disabled={saving}>
              {saving ? "Saving…" : "Save Changes"}
            </Button>
          </div>
        </div>
      </ResponsiveTabs>

      {/* Delete account confirmation dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive">Delete your account?</DialogTitle>
            <DialogDescription>
              This permanently removes your profile, progress, and activity. You can't undo this.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 py-2">
            <Label htmlFor="delete-confirm">
              Type <strong className="text-foreground">Delete</strong> to confirm
            </Label>
            <Input
              id="delete-confirm"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder="Delete"
              autoComplete="off"
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)} disabled={deleting}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeleteAccount} disabled={deleteConfirmText !== "Delete" || deleting}>
              {deleting ? "Deleting…" : "Delete account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </form>
  );
}
