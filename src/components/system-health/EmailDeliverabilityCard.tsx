import { useQuery } from "@/lib/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, CheckCircle2, ShieldAlert } from "lucide-react";

interface DomainHealthRow {
  recipient_domain: string;
  window_days: number;
  sent: number;
  bounced: number;
  complained: number;
  bounce_rate: number;
  complaint_rate: number;
  computed_at: string;
}

interface SendStateRow {
  bulk_hourly_cap: number | null;
  bulk_paused: boolean | null;
  bulk_warmup_started_at: string | null;
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
        .select("recipient_domain, window_days, sent, bounced, complained, bounce_rate, complaint_rate, computed_at")
        .order("sent", { ascending: false })
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
        .select("bulk_hourly_cap, bulk_paused, bulk_warmup_started_at, updated_at")
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as SendStateRow | null;
    },
    staleTime: 60_000,
  });

  const cap = state?.bulk_hourly_cap ?? 50;
  const paused = !!state?.bulk_paused;
  const warmDays = state?.bulk_warmup_started_at
    ? Math.floor((Date.now() - new Date(state.bulk_warmup_started_at).getTime()) / 86_400_000)
    : 0;

  return (
    <div className="space-y-4">
      <Card className={paused ? "border-destructive/40" : "border-success/40"}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {paused ? <ShieldAlert className="h-5 w-5 text-destructive" /> : <CheckCircle2 className="h-5 w-5 text-success" />}
            Bulk send warm-up
            <Badge variant={paused ? "destructive" : "secondary"}>
              {paused ? "Paused" : "Active"}
            </Badge>
          </CardTitle>
          <CardDescription>
            Current cap: <strong>{cap}/hour</strong> · Domain age: <strong>{warmDays} day{warmDays === 1 ? "" : "s"}</strong>
            {paused && " · Auto-paused due to complaint or bounce threshold breach"}
          </CardDescription>
        </CardHeader>
        {sLoading && <CardContent><Skeleton className="h-4 w-48" /></CardContent>}
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
            <p className="text-sm text-muted-foreground">No domain health data yet. The first snapshot will appear after the next 15-minute refresh.</p>
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
                        <td className="px-2 py-2 text-right">{row.sent}</td>
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
