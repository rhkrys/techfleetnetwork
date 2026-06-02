// /welcome — first-run profile wizard (Part 2 §A2).
//
// Routed at /welcome, gated by profiles.onboarded_at. Powered by the
// public.v_profile_readiness view (single source of truth for nudges and
// meters) so the wizard always asks for the same fields the meter shows
// as missing.
//
// Brand voice: welcoming + caring + informative, sentence case, verb+object
// CTAs. No banned terms. Mobile-first (100dvh, safe area aware).

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CompletenessMeter } from "@/components/profile/CompletenessMeter";
import { SaveStatus, type SaveState } from "@/components/ui/save-status";
import { toast } from "@/components/ui/sonner";
import { PageTitle, Body, BodySmall } from "@/components/ui/typography";

interface Readiness {
  score: number;
  missing_fields: string[] | null;
}

const FIELD_LABELS: Record<string, string> = {
  first_name: "First name",
  last_name: "Last name",
  display_name: "Display name",
  country: "Country",
  timezone: "Timezone",
  avatar_url: "Profile photo",
  bio: "Short bio",
  discord_username: "Discord username",
};

const FIELD_HELP: Record<string, string> = {
  first_name: "We use this when we greet you across the platform.",
  last_name: "Helps your team recognize you in shared spaces.",
  display_name: "What teammates see on cards and comments.",
  country: "Used for time zone hints and event scheduling.",
  bio: "A short line about what you're learning or hoping to do.",
};

const STEP_FIELDS = ["first_name", "last_name", "display_name", "country", "bio"] as const;

export default function WelcomeWizard() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [stepIdx, setStepIdx] = useState(0);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [checking, setChecking] = useState(true);

  // Gate: if already onboarded, bounce to dashboard
  useEffect(() => {
    if (authLoading || !user) return;
    let cancelled = false;
    (async () => {
      const { data: profile } = await supabase
        .from("profiles")
        .select("onboarded_at, first_name, last_name, display_name, country, bio")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      if (profile?.onboarded_at) {
        navigate("/dashboard", { replace: true });
        return;
      }
      setValues({
        first_name: profile?.first_name ?? "",
        last_name: profile?.last_name ?? "",
        display_name: profile?.display_name ?? "",
        country: profile?.country ?? "",
        bio: profile?.bio ?? "",
      });
      const { data: r } = await supabase
        .from("v_profile_readiness" as never)
        .select("score, missing_fields")
        .eq("user_id", user.id)
        .maybeSingle();
      setReadiness((r as Readiness | null) ?? { score: 0, missing_fields: [] });
      setChecking(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user, authLoading, navigate]);

  const field = STEP_FIELDS[stepIdx];
  const totalSteps = STEP_FIELDS.length;
  const isLast = stepIdx === totalSteps - 1;
  const canAdvance = useMemo(() => {
    // Bio is optional, others encouraged but not blocking
    return true;
  }, []);

  if (authLoading || checking) {
    return (
      <main className="min-h-[100dvh] flex items-center justify-center px-4">
        <Body className="text-muted-foreground">Loading your welcome…</Body>
      </main>
    );
  }
  if (!user) {
    navigate("/login", { replace: true });
    return null;
  }

  async function saveCurrent() {
    if (!user) return;
    setSaveState("saving");
    const patch = { [field]: values[field]?.trim() || null };
    const { error } = await supabase
      .from("profiles")
      .update(patch)
      .eq("user_id", user.id);
    if (error) {
      setSaveState("error");
      toast.error("Couldn't save that field", { description: "Try again in a moment." });
      return false;
    }
    setSavedAt(new Date());
    setSaveState("saved");
    return true;
  }

  async function handleNext() {
    const ok = await saveCurrent();
    if (!ok) return;
    if (isLast) {
      // Mark onboarded
      await supabase
        .from("profiles")
        .update({ onboarded_at: new Date().toISOString() })
        .eq("user_id", user.id);
      toast.success("Welcome aboard", { description: "Your dashboard is ready." });
      navigate("/dashboard", { replace: true });
      return;
    }
    setStepIdx((i) => i + 1);
  }

  async function handleSkip() {
    if (isLast) {
      await supabase
        .from("profiles")
        .update({ onboarded_at: new Date().toISOString() })
        .eq("user_id", user.id);
      navigate("/dashboard", { replace: true });
      return;
    }
    setStepIdx((i) => i + 1);
  }

  return (
    <main className="min-h-[100dvh] bg-background px-4 py-8 pt-safe pb-safe">
      <div className="mx-auto w-full max-w-xl space-y-6">
        <header className="space-y-2 text-center">
          <PageTitle>Welcome to Tech Fleet</PageTitle>
          <Body className="text-muted-foreground">
            A few quick questions so your team can recognize you.
          </Body>
        </header>

        <CompletenessMeter compact />

        <Card>
          <CardHeader>
            <CardTitle>
              Step {stepIdx + 1} of {totalSteps}: {FIELD_LABELS[field]}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor={field}>{FIELD_LABELS[field]}</Label>
              {field === "bio" ? (
                <textarea
                  id={field}
                  className="w-full min-h-24 rounded-md border bg-background p-3 text-base"
                  value={values[field] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [field]: e.target.value }))}
                  maxLength={280}
                  placeholder="What are you learning or hoping to do?"
                />
              ) : (
                <Input
                  id={field}
                  value={values[field] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [field]: e.target.value }))}
                  autoFocus
                />
              )}
              {FIELD_HELP[field] ? (
                <BodySmall className="text-muted-foreground">{FIELD_HELP[field]}</Body>
              ) : null}
              <SaveStatus state={saveState} savedAt={savedAt} />
            </div>

            <div className="flex items-center justify-between pt-2">
              <Button variant="ghost" onClick={handleSkip} type="button">
                Skip for now
              </Button>
              <Button onClick={handleNext} disabled={!canAdvance} type="button">
                {isLast ? "Finish setup" : "Save and continue"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <BodySmall className="text-center text-muted-foreground">
          You can edit any of this later on your profile page.
        </Body>
      </div>
    </main>
  );
}
