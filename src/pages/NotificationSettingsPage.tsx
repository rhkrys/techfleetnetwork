import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
// TFDS migration (design-system Phase: first page). UI now comes from the owned
// design system instead of @/components/ui. See docs/design/design-system/.
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Switch,
  Label,
  Skeleton,
  Text,
} from "@/design-system";
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

export default function NotificationSettingsPage() {
  const { user } = useAuth();
  const [prefs, setPrefs] = useState<Prefs>({});
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("notification_prefs")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        toast.error("Could not load notification settings", {
          description: "Refresh the page to try again.",
        });
      } else {
        setPrefs((data?.notification_prefs as Prefs | null) ?? {});
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

  return (
    <div className="container max-w-3xl py-8 space-y-6">
      <header className="space-y-1">
        <Text brand="pageTitle" as="h1">
          Notification preferences
        </Text>
        <Text brand="bodySmall" color="muted">
          Choose which alerts reach you in-app. Email preferences live on your profile.
        </Text>
      </header>

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
                    onChange={(_, v) => toggle(k.key, v)}
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
