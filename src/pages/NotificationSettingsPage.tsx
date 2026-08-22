import { useEffect, useMemo, useState } from "react";
import { Loader2, Lock } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

type Prefs = Record<string, "on" | "off">;

const KINDS: Array<{ key: string; label: string; description: string }> = [
  {
    key: "announcement",
    label: "Announcements",
    description: "Broadcasts from Tech Fleet leadership.",
  },
  {
    key: "project_application",
    label: "Project applications",
    description: "Status updates on applications you submitted.",
  },
  {
    key: "interview",
    label: "Interview scheduling",
    description: "Invitations and reminders for interviews.",
  },
  {
    key: "training_opportunity",
    label: "Training opportunities",
    description: "New courses or quests that match your goals.",
  },
  {
    key: "support_ticket_reply",
    label: "Support replies",
    description: "Responses to your Get Help tickets.",
  },
  {
    key: "discord_link",
    label: "Discord linking",
    description: "Updates about your Discord connection and roles.",
  },
  {
    key: "quest_nudge",
    label: "Quest nudges",
    description: "Gentle reminders when a quest has gone quiet.",
  },
  {
    key: "system",
    label: "System updates",
    description: "Account, security, and platform notices.",
  },
];

// Tier 0 critical email — always sent, never unsubscribable. Shown for transparency.
const ALWAYS_ON_EMAIL = [
  "Sign-in and security",
  "Application and interview updates",
  "Support replies",
];

export default function NotificationSettingsPage() {
  const { user } = useAuth();
  const [prefs, setPrefs] = useState<Prefs>({});
  const [emailOpportunities, setEmailOpportunities] = useState(true);
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [savingEmailOpps, setSavingEmailOpps] = useState(false);
  const [savingMarketing, setSavingMarketing] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("notification_prefs, notify_opportunities")
        .eq("user_id", user.id)
        .maybeSingle();
      // Marketing state is Email Octopus's (the source of truth). Read it LIVE per-user via the
      // eo-contact-status edge function so we reflect subscribes/unsubscribes made outside the
      // platform too. If EO is unavailable or disabled, fall back to the cached mirror.
      let marketingOn = false;
      try {
        const { data: live, error: liveErr } = await supabase.functions.invoke("eo-contact-status");
        const s = (live as { status?: string } | null)?.status;
        if (!liveErr && (s === "subscribed" || s === "unsubscribed" || s === "not_found")) {
          marketingOn = s === "subscribed";
        } else {
          const { data: cached } = await supabase.rpc("get_my_marketing_subscription");
          marketingOn = cached === "subscribed";
        }
      } catch {
        const { data: cached } = await supabase.rpc("get_my_marketing_subscription");
        marketingOn = cached === "subscribed";
      }
      if (cancelled) return;
      if (error) {
        toast.error("Could not load notification settings", {
          description: "Refresh the page to try again.",
        });
      } else {
        setPrefs((data?.notification_prefs as Prefs | null) ?? {});
        setEmailOpportunities(data?.notify_opportunities ?? true);
        setMarketingOptIn(marketingOn);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const isOn = useMemo(() => (key: string) => prefs[key] !== "off", [prefs]);

  const toggle = async (key: string, on: boolean) => {
    if (!user) return;
    setSavingKey(key);
    const next: Prefs = { ...prefs, [key]: on ? "on" : "off" };
    setPrefs(next);
    const { error } = await supabase
      .from("profiles")
      .update({ notification_prefs: next })
      .eq("user_id", user.id);
    setSavingKey(null);
    if (error) {
      setPrefs(prefs);
      toast.error("Could not save preference", { description: "Try toggling again." });
      return;
    }
    toast.success(on ? "Turned on" : "Turned off", {
      description: KINDS.find((k) => k.key === key)?.label,
    });
  };

  const toggleEmailOpportunities = async (on: boolean) => {
    if (!user) return;
    setSavingEmailOpps(true);
    const previous = emailOpportunities;
    setEmailOpportunities(on);
    const { error } = await supabase
      .from("profiles")
      .update({ notify_opportunities: on })
      .eq("user_id", user.id);
    setSavingEmailOpps(false);
    if (error) {
      setEmailOpportunities(previous);
      toast.error("Could not save preference", { description: "Try toggling again." });
      return;
    }
    toast.success(on ? "Turned on" : "Turned off", {
      description: "Opportunities and platform updates",
    });
  };

  // Marketing/newsletter opt-in. Email Octopus is the source of truth (ADR-0017); the RPC records
  // the intent (fail-open) and the background worker syncs it to EO. The displayed value comes from a
  // live per-user EO read on load (eo-contact-status), so it reflects the true EO state.
  const toggleMarketing = async (on: boolean) => {
    if (!user) return;
    setSavingMarketing(true);
    const previous = marketingOptIn;
    setMarketingOptIn(on);
    const { error } = await supabase.rpc("set_my_marketing_subscription", {
      p_subscribed: on,
      p_source: "profile",
    });
    setSavingMarketing(false);
    if (error) {
      setMarketingOptIn(previous);
      toast.error("Could not save preference", { description: "Try again in a moment." });
      return;
    }
    toast.success(on ? "Subscribed" : "Unsubscribed", {
      description: "Newsletter and marketing emails",
    });
  };

  return (
    <div className="container max-w-3xl py-8 space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Notification preferences</h1>
        <p className="text-sm text-muted-foreground">
          Choose which alerts reach you in-app and by email.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Email preferences</CardTitle>
          <CardDescription>
            Choose what reaches your inbox. Account and essential emails always send.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : (
            <>
              <div className="space-y-3">
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold">Account and essential emails</h3>
                  <p className="text-sm text-muted-foreground">
                    We always send these. They keep your account and applications working.
                  </p>
                </div>
                <div className="divide-y divide-border rounded-lg border border-border">
                  {ALWAYS_ON_EMAIL.map((item) => (
                    <div key={item} className="flex items-center justify-between gap-4 px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Lock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                        <span className="text-sm font-medium">{item}</span>
                      </div>
                      <span className="text-xs font-medium text-muted-foreground">Always on</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-4">
                <div className="space-y-1">
                  <Label htmlFor="pref-opportunities" className="text-base font-medium">
                    Opportunities and platform updates
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    Project openings, reminders, and platform news. You can turn these off anytime,
                    including from any of these emails.
                  </p>
                </div>
                <div className="flex items-center gap-2 pt-1">
                  {savingEmailOpps && (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  )}
                  <Switch
                    id="pref-opportunities"
                    checked={emailOpportunities}
                    onCheckedChange={toggleEmailOpportunities}
                    aria-label="Toggle opportunities and platform updates emails"
                  />
                </div>
              </div>

              <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-4">
                <div className="space-y-1">
                  <Label htmlFor="pref-marketing" className="text-base font-medium">
                    Newsletter and marketing emails
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    Stories, community news, and product updates from Tech Fleet. Optional and off
                    by default. You can unsubscribe here or from any of these emails.
                  </p>
                </div>
                <div className="flex items-center gap-2 pt-1">
                  {savingMarketing && (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  )}
                  <Switch
                    id="pref-marketing"
                    checked={marketingOptIn}
                    onCheckedChange={toggleMarketing}
                    aria-label="Toggle newsletter and marketing emails"
                  />
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>In-app notifications</CardTitle>
          <CardDescription>
            Turning a kind off stops new notifications of that kind from appearing. Past
            notifications are unaffected.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : (
            KINDS.map((k) => (
              <div
                key={k.key}
                className="flex items-start justify-between gap-4 rounded-lg border border-border p-4"
              >
                <div className="space-y-1">
                  <Label htmlFor={`pref-${k.key}`} className="text-base font-medium">
                    {k.label}
                  </Label>
                  <p className="text-sm text-muted-foreground">{k.description}</p>
                </div>
                <div className="flex items-center gap-2 pt-1">
                  {savingKey === k.key && (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  )}
                  <Switch
                    id={`pref-${k.key}`}
                    checked={isOn(k.key)}
                    onCheckedChange={(v) => toggle(k.key, v)}
                    aria-label={`Toggle ${k.label}`}
                  />
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
