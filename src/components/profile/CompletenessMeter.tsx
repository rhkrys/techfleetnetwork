// Profile completeness meter.
// Wave 2 of the comprehensive refactor — see plan §2A.
//
// Reads from public.v_profile_readiness (single source of truth) and shows
// the member their completeness score plus the next field to fill in.
//
// Pass `userId` to render for a specific user; otherwise the component
// resolves the current auth user.

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

export interface CompletenessMeterProps {
  userId?: string;
  className?: string;
  /** When true, hides the inline "Next: <field>" hint. */
  compact?: boolean;
}

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

export function CompletenessMeter({ userId, className, compact }: CompletenessMeterProps) {
  const [data, setData] = useState<Readiness | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let uid = userId;
        if (!uid) {
          const { data: auth } = await supabase.auth.getUser();
          uid = auth.user?.id;
        }
        if (!uid) {
          if (!cancelled) setLoading(false);
          return;
        }
        const { data: row } = await supabase
          .from("v_profile_readiness" as never)
          .select("score, missing_fields")
          .eq("user_id", uid)
          .maybeSingle();
        if (!cancelled) {
          setData((row as Readiness | null) ?? { score: 0, missing_fields: [] });
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (loading || !data) return null;

  const score = Math.round(Number(data.score) || 0);
  const next = (data.missing_fields ?? [])[0];
  const nextLabel = next ? FIELD_LABELS[next] ?? next : null;

  const tone =
    score >= 90
      ? "bg-emerald-500"
      : score >= 60
      ? "bg-primary"
      : "bg-amber-500";

  return (
    <div className={cn("w-full", className)} aria-label={`Profile is ${score}% complete`}>
      <div className="flex items-center justify-between text-sm mb-2">
        <span className="font-medium">Profile completeness</span>
        <span className="text-muted-foreground">{score}%</span>
      </div>
      <div
        className="h-2 w-full rounded-full bg-muted overflow-hidden"
        role="progressbar"
        aria-valuenow={score}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={cn("h-full transition-all duration-300", tone)}
          style={{ width: `${Math.min(100, Math.max(0, score))}%` }}
        />
      </div>
      {!compact && nextLabel ? (
        <p className="text-sm text-muted-foreground mt-2">
          Next up: <span className="text-foreground font-medium">{nextLabel}</span>
        </p>
      ) : null}
    </div>
  );
}
