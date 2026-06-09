import { useQuery, useQueryClient } from "@/lib/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity, Clock, MailWarning } from "lucide-react";
import { useState } from "react";
import { toast } from "@/hooks/use-toast";

interface SendStateRow {
  bulk_send_delay_ms: number | null;
  bulk_send_delay_peak_ms: number | null;
  bulk_peak_hours_utc: number[] | null;
  bulk_hourly_cap: number | null;
  bulk_consecutive_rate_limits: number | null;
  bulk_retry_after_until: string | null;
  bulk_paused: boolean | null;
  updated_at: string;
}

/**
 * Bulk lane throttle + stuck-pending tiles. Surfaces the new
 * `bulk_send_delay_peak_ms` / `bulk_peak_hours_utc` config (Issue H of the
 * 2026-06-02 activity-log audit) and the existing
 * `get_stuck_pending_email_count` RPC (Issue I).
 */
export function EmailBulkThrottleCard() {
  const qc = useQueryClient();
  const [resuming, setResuming] = useState(false);
  const send = useQuery({
    queryKey: ["email", "bulk-lane-state"] as const,
    meta: { audit: "system_health.bulk_lane_state" },
    queryFn: async () => {
      const { data, error } = await supabase
        .from("email_send_state")
        .select(
          "bulk_send_delay_ms,bulk_send_delay_peak_ms,bulk_peak_hours_utc,bulk_hourly_cap,bulk_consecutive_rate_limits,bulk_retry_after_until,bulk_paused,updated_at",
        )
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as SendStateRow | null;
    },
    staleTime: 60_000,
  });

  const stuck = useQuery({
    queryKey: ["email", "stuck-pending"] as const,
    meta: { audit: "system_health.stuck_pending_email" },
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_stuck_pending_email_count", { p_age_minutes: 10 });
      if (error) throw error;
      return Number(data ?? 0);
    },
    staleTime: 60_000,
  });

  if (send.isLoading || stuck.isLoading) {
    return <Skeleton className="h-32 w-full" />;
  }

  const s = send.data;
  const nowHour = new Date().getUTCHours();
  const isPeak = (s?.bulk_peak_hours_utc ?? []).includes(nowHour);
  const adaptiveOn = (s?.bulk_consecutive_rate_limits ?? 0) > 0;
  const paused =
    s?.bulk_paused ||
    (s?.bulk_retry_after_until && new Date(s.bulk_retry_after_until) > new Date());
  const stuckCount = stuck.data ?? 0;
  const stuckTone = stuckCount === 0 ? "default" : stuckCount < 5 ? "secondary" : "destructive";
  const stateTone = paused ? "destructive" : adaptiveOn ? "secondary" : "default";

  const inCooldown = Boolean(
    s?.bulk_retry_after_until && new Date(s.bulk_retry_after_until) > new Date(),
  );

  const handleResume = async () => {
    setResuming(true);
    try {
      const { error } = await supabase.rpc("clear_email_lane_cooldown" as never, {
        p_lane: "bulk_emails",
      } as never);
      if (error) throw error;
      toast({ title: "Bulk lane resumed", description: "Pending emails will send within 5 seconds." });
      await qc.invalidateQueries({ queryKey: ["email", "bulk-lane-state"] });
      await qc.invalidateQueries({ queryKey: ["email", "stuck-pending"] });
    } catch (e) {
      toast({ title: "Could not resume bulk lane", description: String((e as Error)?.message ?? e), variant: "destructive" });
    } finally {
      setResuming(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="h-4 w-4" aria-hidden /> Bulk email lane
          <Badge variant={stateTone}>{paused ? "Paused" : adaptiveOn ? "Throttled" : "Normal"}</Badge>
          {isPeak && <Badge variant="outline">Peak hour (UTC {nowHour}:00)</Badge>}
          {inCooldown && (
            <Button
              size="sm"
              variant="outline"
              className="ml-auto"
              disabled={resuming}
              onClick={handleResume}
            >
              {resuming ? "Resuming…" : "Resume now"}
            </Button>
          )}
        </CardTitle>
        <CardDescription>
          Off-peak delay {s?.bulk_send_delay_ms ?? "—"}ms · Peak delay {s?.bulk_send_delay_peak_ms ?? "—"}ms ·
          Cap {s?.bulk_hourly_cap ?? "—"}/hr
          {inCooldown && s?.bulk_retry_after_until && (
            <> · Cooldown until {new Date(s.bulk_retry_after_until).toLocaleTimeString()}</>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-3 text-sm">
        <div>
          <p className="text-muted-foreground flex items-center gap-1">
            <Clock className="h-3 w-3" aria-hidden /> Consecutive rate-limits
          </p>
          <p className="text-2xl font-semibold">{s?.bulk_consecutive_rate_limits ?? 0}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Peak hours UTC</p>
          <p className="text-sm font-mono">{(s?.bulk_peak_hours_utc ?? []).join(", ") || "—"}</p>
        </div>
        <div>
          <p className="text-muted-foreground flex items-center gap-1">
            <MailWarning className="h-3 w-3" aria-hidden /> Stuck pending (10 min+)
          </p>
          <p className="text-2xl font-semibold">
            <Badge variant={stuckTone}>{stuckCount}</Badge>
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
