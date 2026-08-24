import { useQuery } from "@/lib/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
} from "@/design-system";

import { AlertTriangle, CheckCircle2, ShieldAlert } from "lucide-react";

interface DomainHealthRow {
  recipient_domain: string;
  window_start: string;
  window_end: string;
  sent_count: number;
  bounced_count: number;
  complained_count: number;
  bounce_rate: number;
  complaint_rate: number;
  created_at: string;
}

interface SendStateRow {
  bulk_hourly_cap: number | null;
  bulk_paused: boolean | null;
  bulk_warmup_started_at: string | null;
  auth_retry_after_until: string | null;
  transactional_retry_after_until: string | null;
  auth_consecutive_rate_limits: number | null;
  transactional_consecutive_rate_limits: number | null;
  updated_at: string;
}

/**
 * Deliverability card — shows 7-day rolling complaint/bounce rates per
 * recipient domain plus warm-up status. Auto-pause kicks in when complaint
 * rate exceeds 0.1% (Gmail bulk-sender threshold).
 */
export function EmailDeliverabilityCard() {
  const { data: health, isLoading: hLoading } = useQuery({
    queryKey: ["email-domain-health"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("email_domain_health" as any)
        .select(
          "recipient_domain, window_start, window_end, sent_count, bounced_count, complained_count, bounce_rate, complaint_rate, created_at"
        )
        .order("sent_count", { ascending: false })
        .limit(10);
      if (error) throw error;
      return (data as unknown as DomainHealthRow[]) ?? [];
    },
    staleTime: 60_000,
  });

  const { data: state, isLoading: sLoading } = useQuery({
    queryKey: ["email-send-state-warmup"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("email_send_state" as any)
        .select(
          "bulk_hourly_cap, bulk_paused, bulk_warmup_started_at, auth_retry_after_until, transactional_retry_after_until, auth_consecutive_rate_limits, transactional_consecutive_rate_limits, updated_at"
        )
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as SendStateRow | null;
    },
    staleTime: 60_000,
  });

  const { data: cappedBreakdown } = useQuery({
    queryKey: ["email-frequency-capped-24h"],
    queryFn: async () => {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from("email_send_log" as any)
        .select("template_name")
        .eq("status", "frequency_capped")
        .gte("created_at", since);
      if (error) throw error;
      const counts: Record<string, number> = {};
      for (const r of (data as unknown as { template_name: string }[]) ?? []) {
        counts[r.template_name] = (counts[r.template_name] ?? 0) + 1;
      }
      return counts;
    },
    staleTime: 60_000,
  });

  const cap = state?.bulk_hourly_cap ?? 50;
  const paused = !!state?.bulk_paused;
  const warmDays = state?.bulk_warmup_started_at
    ? Math.floor((Date.now() - new Date(state.bulk_warmup_started_at).getTime()) / 86_400_000)
    : 0;
  const cappedTotal = Object.values(cappedBreakdown ?? {}).reduce((a, b) => a + b, 0);
  const cappedEntries = Object.entries(cappedBreakdown ?? {}).sort((a, b) => b[1] - a[1]);

  const now = Date.now();
  const cooldowns = [
    {
      key: "auth_emails",
      label: "Auth emails",
      until: state?.auth_retry_after_until,
      count: state?.auth_consecutive_rate_limits ?? 0,
    },
    {
      key: "transactional_emails",
      label: "Transactional emails",
      until: state?.transactional_retry_after_until,
      count: state?.transactional_consecutive_rate_limits ?? 0,
    },
  ].map((c) => ({
    ...c,
    activeSecs: c.until ? Math.max(0, Math.floor((new Date(c.until).getTime() - now) / 1000)) : 0,
  }));
  const anyCooldown = cooldowns.some((c) => c.activeSecs > 0);

  return (
    <div className="space-y-4">
      <Card className={paused ? "border-destructive/40" : "border-success/40"}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {paused ? (
              <ShieldAlert className="h-5 w-5 text-destructive" />
            ) : (
              <CheckCircle2 className="h-5 w-5 text-success" />
            )}
            Bulk send warm-up
            <Badge variant={paused ? "destructive" : "secondary"}>
              {paused ? "Paused" : "Active"}
            </Badge>
          </CardTitle>
          <CardDescription>
            Current cap: <strong>{cap}/hour</strong> · Domain age:{" "}
            <strong>
              {warmDays} day{warmDays === 1 ? "" : "s"}
            </strong>
            {paused && " · Auto-paused due to complaint or bounce threshold breach"}
          </CardDescription>
        </CardHeader>
        {sLoading && (
          <CardContent>
            <Skeleton className="h-4 w-48" />
          </CardContent>
        )}
      </Card>

      <Card className={anyCooldown ? "border-warning/40" : undefined}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle
              className={anyCooldown ? "h-5 w-5 text-warning" : "h-5 w-5 text-muted-foreground"}
            />
            Rate-limit cooldowns
            <Badge variant={anyCooldown ? "destructive" : "secondary"}>
              {anyCooldown ? "Active" : "Clear"}
            </Badge>
          </CardTitle>
          <CardDescription>
            Per-queue cooldowns triggered by provider 429s. Each queue backs off independently so
            auth emails keep flowing during transactional bursts.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          {cooldowns.map((c) => (
            <div key={c.key} className="flex justify-between border-b last:border-b-0 py-1">
              <span className="font-medium">{c.label}</span>
              <span>
                {c.activeSecs > 0
                  ? `Cooling down ${c.activeSecs}s (consecutive 429s: ${c.count})`
                  : c.count > 0
                    ? `Recovering · consecutive 429s: ${c.count}`
                    : "Clear"}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className={cappedTotal > 0 ? "border-warning/40" : undefined}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle
              className={cappedTotal > 0 ? "h-5 w-5 text-warning" : "h-5 w-5 text-muted-foreground"}
            />
            Frequency-capped sends (last 24h)
            <Badge variant={cappedTotal > 0 ? "destructive" : "secondary"}>{cappedTotal}</Badge>
          </CardTitle>
          <CardDescription>
            Recipients dropped by the per-recipient cap on project-blast and fleety-coach-digest.
            Announcements are exempt.
          </CardDescription>
        </CardHeader>
        {cappedEntries.length > 0 && (
          <CardContent className="space-y-1 text-sm">
            {cappedEntries.map(([tpl, n]) => (
              <div key={tpl} className="flex justify-between border-b last:border-b-0 py-1">
                <span className="font-medium">{tpl}</span>
                <span>{n}</span>
              </div>
            ))}
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recipient domain health (7-day rolling)</CardTitle>
          <CardDescription>
            Pause thresholds — complaint rate &gt; 0.1%, bounce rate &gt; 2%
          </CardDescription>
        </CardHeader>
        <CardContent>
          {hLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : !health || health.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No domain health data yet. The first snapshot will appear after the next 15-minute
              refresh.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b text-left">
                  <tr>
                    <th className="px-2 py-2">Domain</th>
                    <th className="px-2 py-2 text-right">Sent</th>
                    <th className="px-2 py-2 text-right">Bounce %</th>
                    <th className="px-2 py-2 text-right">Complaint %</th>
                    <th className="px-2 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {health.map((row) => {
                    const bouncePct = Number(row.bounce_rate || 0) * 100;
                    const complaintPct = Number(row.complaint_rate || 0) * 100;
                    const bad = complaintPct > 0.1 || bouncePct > 2;
                    return (
                      <tr key={row.recipient_domain} className="border-b last:border-b-0">
                        <td className="px-2 py-2 font-medium">{row.recipient_domain}</td>
                        <td className="px-2 py-2 text-right">{row.sent_count}</td>
                        <td className="px-2 py-2 text-right">{bouncePct.toFixed(2)}%</td>
                        <td className="px-2 py-2 text-right">{complaintPct.toFixed(3)}%</td>
                        <td className="px-2 py-2">
                          {bad ? (
                            <Badge variant="destructive" className="gap-1">
                              <AlertTriangle className="h-3 w-3" /> Over threshold
                            </Badge>
                          ) : (
                            <Badge variant="secondary">Healthy</Badge>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
