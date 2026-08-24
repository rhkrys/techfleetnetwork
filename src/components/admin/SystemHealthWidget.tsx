import { memo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@/lib/react-query";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  ShieldAlert,
  Wrench,
} from "lucide-react";
import { useAdmin } from "@/hooks/use-admin";
import { useSystemHealthRealtime } from "@/hooks/use-system-health-realtime";
import {
  SystemHealthService,
  type SystemHealthState,
  type ErrorFingerprint,
  type RemediationRule,
} from "@/services/system-health.service";
import { supabase } from "@/integrations/supabase/client";
import { Badge, Button, Skeleton } from "@/design-system";

import { toast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";

function StatusPill({ status }: { status: SystemHealthState["status"] }) {
  const map: Record<
    SystemHealthState["status"],
    { label: string; cls: string; Icon: typeof CheckCircle2 }
  > = {
    healthy: {
      label: "Healthy",
      cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
      Icon: CheckCircle2,
    },
    degraded: {
      label: "Degraded",
      cls: "bg-amber-500/15 text-amber-400 border-amber-500/30",
      Icon: AlertTriangle,
    },
    overloaded: {
      label: "Overloaded",
      cls: "bg-destructive/15 text-destructive border-destructive/30",
      Icon: ShieldAlert,
    },
  };
  const { label, cls, Icon } = map[status];
  return (
    <Badge variant="outline" className={`${cls} gap-1.5`} aria-label={`System status: ${label}`}>
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {label}
    </Badge>
  );
}

export const SystemHealthWidget = memo(function SystemHealthWidget() {
  const { isAdmin, loading: adminLoading } = useAdmin();

  // 5-minute cadence: System Health is observability — instant updates flow
  // through Supabase Realtime; polling is a safety net only.
  const FIVE_MIN = 5 * 60 * 1000;

  const healthQuery = useQuery({
    queryKey: ["system-health"],
    queryFn: () => SystemHealthService.getHealth(),
    enabled: isAdmin,
    refetchInterval: FIVE_MIN,
    staleTime: FIVE_MIN,
    refetchOnWindowFocus: false,
  });

  const errorsQuery = useQuery({
    queryKey: ["system-top-errors", 24],
    queryFn: () => SystemHealthService.getTopErrors(24, 10),
    enabled: isAdmin,
    refetchInterval: FIVE_MIN,
    staleTime: FIVE_MIN,
    refetchOnWindowFocus: false,
  });

  const remediationsQuery = useQuery({
    queryKey: ["system-remediations"],
    queryFn: () => SystemHealthService.getRemediations(),
    enabled: isAdmin,
    refetchInterval: FIVE_MIN,
    staleTime: FIVE_MIN,
    refetchOnWindowFocus: false,
  });

  // Triage queue summary — single cheap count query, 5-min stale
  const triageQuery = useQuery({
    queryKey: ["agent-fix-queue-summary"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agent_fix_queue")
        .select("status")
        .in("status", ["pending", "triaged", "proposed"]);
      if (error) throw error;
      const rows = data ?? [];
      return {
        pending: rows.filter((r) => r.status === "pending").length,
        proposed: rows.filter((r) => r.status === "proposed").length,
        total: rows.length,
      };
    },
    enabled: isAdmin,
    refetchInterval: FIVE_MIN,
    staleTime: FIVE_MIN,
    refetchOnWindowFocus: false,
  });

  // Subscribe to live changes — invalidates queries on the server-side push,
  // not on a client poll. Eliminates idle-tab traffic.
  useSystemHealthRealtime(isAdmin);

  if (adminLoading || !isAdmin) return null;

  const health = healthQuery.data;
  const errors: ErrorFingerprint[] = errorsQuery.data ?? [];
  const remediations: RemediationRule[] = remediationsQuery.data ?? [];

  const handleRunNow = async () => {
    try {
      const res = await SystemHealthService.runRemediationsNow();
      toast({ title: "Remediations run", description: `${res.ran} rule(s) executed.` });
      healthQuery.refetch();
      remediationsQuery.refetch();
      errorsQuery.refetch();
    } catch (err) {
      toast({
        title: "Could not run remediations",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  return (
    <section aria-labelledby="system-health-heading" className="card-elevated p-5 space-y-4">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-primary" aria-hidden />
          <div>
            <h2 id="system-health-heading" className="text-lg font-semibold">
              System Health
            </h2>
            <p className="text-sm text-muted-foreground">
              Auto-remediation, fingerprinted errors, and platform load — admin only.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {health && <StatusPill status={health.status} />}
          {(triageQuery.data?.total ?? 0) > 0 && (
            <Button asChild size="sm" variant="outline" aria-label="Open Triage tab">
              <Link to="/admin/system-health?tab=triage" className="gap-1.5">
                <Wrench className="h-4 w-4" aria-hidden />
                {triageQuery.data?.proposed
                  ? `${triageQuery.data.proposed} fix${triageQuery.data.proposed === 1 ? "" : "es"} ready`
                  : `${triageQuery.data?.total} to triage`}
              </Link>
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={handleRunNow}
            aria-label="Run remediations now"
          >
            Run now
          </Button>
        </div>
      </header>

      {healthQuery.isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : health ? (
        <div
          className={`rounded-md border p-3 text-sm ${
            health.status === "overloaded"
              ? "border-destructive/30 bg-destructive/10"
              : health.status === "degraded"
                ? "border-amber-500/30 bg-amber-500/10"
                : "border-emerald-500/20 bg-emerald-500/5"
          }`}
        >
          <p className="font-medium">{health.reason}</p>
          <p className="text-xs text-muted-foreground mt-1">
            Updated {formatDistanceToNow(new Date(health.updated_at), { addSuffix: true })}
            {health.pause_non_critical && " · non-critical jobs paused"}
          </p>
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Top errors (24h)
            </h3>
            {errorsQuery.dataUpdatedAt > 0 && (
              <span className="text-[10px] text-muted-foreground">
                Updated{" "}
                {formatDistanceToNow(new Date(errorsQuery.dataUpdatedAt), { addSuffix: true })}
              </span>
            )}
          </div>
          {errorsQuery.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : errors.length === 0 ? (
            <p className="text-sm text-muted-foreground">No errors in the past 24 hours.</p>
          ) : (
            <ul className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {errors.map((e) => (
                <li
                  key={e.fingerprint}
                  className="rounded-md border border-border/50 bg-muted/30 p-2.5"
                >
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-xs font-mono text-muted-foreground">
                      {e.event_type ?? "unknown"} · {e.table_name ?? "—"}
                    </span>
                    <Badge variant="secondary" className="text-xs">
                      {e.occurrences}× · {e.affected_users} user(s)
                    </Badge>
                  </div>
                  {e.sample_message && (
                    <p className="text-xs mt-1 line-clamp-2 break-words">{e.sample_message}</p>
                  )}
                  <p className="text-[10px] text-muted-foreground mt-1">
                    last {formatDistanceToNow(new Date(e.last_seen), { addSuffix: true })}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Active remediations
            </h3>
            {remediationsQuery.dataUpdatedAt > 0 && (
              <span className="text-[10px] text-muted-foreground">
                Updated{" "}
                {formatDistanceToNow(new Date(remediationsQuery.dataUpdatedAt), {
                  addSuffix: true,
                })}
              </span>
            )}
          </div>
          {remediationsQuery.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : remediations.length === 0 ? (
            <p className="text-sm text-muted-foreground">No remediation rules configured.</p>
          ) : (
            <ul className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {remediations.map((r) => (
                <li key={r.id} className="rounded-md border border-border/50 bg-muted/30 p-2.5">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-sm font-medium">
                      {r.description || r.remediation_function}
                    </span>
                    <Badge variant={r.enabled ? "secondary" : "outline"} className="text-xs">
                      {r.enabled ? "Enabled" : "Off"}
                    </Badge>
                  </div>
                  <p className="text-xs font-mono text-muted-foreground mt-1">
                    {r.remediation_function}() · runs {r.run_count}× · {r.success_count} ok
                  </p>
                  {r.last_run_at && (
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      last {r.last_status ?? "—"} ·{" "}
                      {formatDistanceToNow(new Date(r.last_run_at), { addSuffix: true })}
                      {r.last_error ? ` · ${r.last_error.slice(0, 80)}` : ""}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
});
