/**
 * ResetHealthTab — admin visibility for the password-reset chain.
 *
 * Surfaces (without psql):
 *  1. Recovery email health (terminal status, ignores append-only pending rows)
 *  2. Latest auth.reset_smoke.* ops_events run (cron every 30 min)
 *  3. Recent auth.recovery.* beacon outcomes per branch
 *
 * Read-only. RLS / admin-only RPCs already restrict the data.
 */
import { useQuery } from "@/lib/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshCw } from "lucide-react";
import { Icon } from "@/components/ui/icon";
import { formatTimestamp } from "@/lib/format/date";

type RecoveryHealth = {
  healthy: boolean;
  window_minutes: number;
  total: number;
  sent: number;
  terminal_failures: number;
  last_sent_at: string | null;
  last_failure_at: string | null;
};

type OpsEvent = {
  kind: string;
  severity: string;
  occurred_at: string;
  payload: Record<string, unknown> | null;
};

export function ResetHealthTab() {
  const email = useQuery({
    queryKey: ["reset-health", "email"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_recovery_email_health", { p_window_minutes: 60 });
      if (error) throw error;
      return data as unknown as RecoveryHealth;
    },
    refetchInterval: 60_000,
  });

  const smoke = useQuery({
    queryKey: ["reset-health", "smoke"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ops_events")
        .select("kind, severity, occurred_at, payload")
        .in("kind", ["auth.reset_smoke.ok", "auth.reset_smoke.failed"])
        .order("occurred_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return (data ?? []) as OpsEvent[];
    },
    refetchInterval: 60_000,
  });

  const beacons = useQuery({
    queryKey: ["reset-health", "beacons"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ops_events")
        .select("kind, severity, occurred_at, payload")
        .like("kind", "auth.recovery.%")
        .order("occurred_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as OpsEvent[];
    },
    refetchInterval: 60_000,
  });

  const refetchAll = () => {
    email.refetch();
    smoke.refetch();
    beacons.refetch();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Password reset chain</h3>
          <p className="text-sm text-muted-foreground">
            Recovery email delivery, smoke probe (every 30 min), and per-branch reset telemetry.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refetchAll}>
          <Icon icon={RefreshCw} size="ui" /> Refresh data
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recovery email health (60 min)</CardTitle>
          <CardDescription>
            Terminal status per message — append-only pending rows are intentionally excluded.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {email.isLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : email.error ? (
            <p className="text-sm text-destructive">Failed to load: {(email.error as Error).message}</p>
          ) : email.data ? (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <Stat label="Status">
                <Badge variant={email.data.healthy ? "default" : "destructive"}>
                  {email.data.healthy ? "Healthy" : "Degraded"}
                </Badge>
              </Stat>
              <Stat label="Sent" value={email.data.sent} />
              <Stat label="Terminal failures" value={email.data.terminal_failures} />
              <Stat
                label="Last sent"
                value={email.data.last_sent_at ? formatTimestamp(email.data.last_sent_at) : "—"}
              />
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Smoke monitor (last 10 runs)</CardTitle>
          <CardDescription>
            End-to-end probe of beacon, identity gate, and email health. Failed runs page System Health Triage.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {smoke.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : (smoke.data?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">No smoke runs in the recorded window yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {smoke.data!.map((row, i) => {
                const ok = row.kind.endsWith(".ok");
                const failed = (row.payload as { failed?: string[] } | null)?.failed ?? [];
                return (
                  <li key={i} className="flex items-center justify-between py-2 text-sm">
                    <div className="flex items-center gap-2">
                      <Badge variant={ok ? "default" : "destructive"}>{ok ? "OK" : "FAIL"}</Badge>
                      <span className="text-muted-foreground">{formatTimestamp(row.occurred_at)}</span>
                    </div>
                    <span className="text-muted-foreground">
                      {ok ? "All checks passed" : `Failed: ${failed.join(", ") || "unknown"}`}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent reset branch telemetry</CardTitle>
          <CardDescription>
            Pre-auth beacon from `record-auth-recovery`. Shows the exact branch and outcome even when the user has no session.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {beacons.isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : (beacons.data?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">No beacons recorded yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {beacons.data!.map((row, i) => (
                <li key={i} className="flex items-center justify-between py-2 text-sm">
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={
                        row.severity === "error"
                          ? "destructive"
                          : row.severity === "warn"
                          ? "secondary"
                          : "outline"
                      }
                    >
                      {row.severity}
                    </Badge>
                    <code className="text-xs">{row.kind.replace("auth.recovery.", "")}</code>
                  </div>
                  <span className="text-muted-foreground">{formatTimestamp(row.occurred_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, children }: { label: string; value?: string | number; children?: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="mt-1 text-base font-medium">{children ?? value}</div>
    </div>
  );
}
