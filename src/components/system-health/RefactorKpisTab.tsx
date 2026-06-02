import { useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Clock, Loader2, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery, useQueryClient } from "@/lib/react-query";
import { LineChart, Line, ResponsiveContainer, YAxis } from "recharts";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { SystemHealthService, type RefactorKpi, type RefactorKpiStatus } from "@/services/system-health.service";
import { useAuth } from "@/contexts/AuthContext";

const CATEGORY_LABEL: Record<RefactorKpi["category"], string> = {
  errors: "Errors",
  ux: "Member experience",
  email: "Email pipeline",
  infra: "Infrastructure",
  auth: "Sign-in & signup",
};

const STATUS_LABEL: Record<RefactorKpiStatus, string> = {
  met: "Goal met",
  on_track: "On track",
  at_risk: "At risk",
  off_track: "Off track",
  no_data: "No data yet",
};

function statusClasses(status: RefactorKpiStatus) {
  switch (status) {
    case "met":       return "bg-success/15 text-success border-success/30";
    case "on_track":  return "bg-primary/15 text-primary border-primary/30";
    case "at_risk":   return "bg-warning/15 text-warning border-warning/30";
    case "off_track": return "bg-destructive/15 text-destructive border-destructive/30";
    default:          return "bg-muted text-muted-foreground border-border";
  }
}

function formatValue(value: number | null, unit: RefactorKpi["unit"]): string {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  const n = Number(value);
  switch (unit) {
    case "percent": return `${n.toFixed(n < 10 ? 2 : 1)}%`;
    case "minutes": return n >= 60 ? `${(n / 60).toFixed(1)} hr` : `${n.toFixed(1)} min`;
    case "seconds": return n >= 60 ? `${(n / 60).toFixed(1)} min` : `${n.toFixed(0)} s`;
    case "ratio":   return `${n.toFixed(2)}×`;
    default:        return n >= 1000 ? n.toLocaleString() : String(Math.round(n));
  }
}

function relativeTime(value: string | null) {
  if (!value) return "never";
  return formatDistanceToNow(new Date(value), { addSuffix: true });
}

function Sparkline({ trend, direction }: { trend: number[]; direction: RefactorKpi["direction"] }) {
  const data = useMemo(() => trend.map((v, i) => ({ i, v: Number(v) })), [trend]);
  if (data.length < 2) {
    return <div className="text-xs text-muted-foreground">Not enough history yet</div>;
  }
  const stroke = direction === "lower_is_better"
    ? "hsl(var(--destructive))"
    : "hsl(var(--success))";
  return (
    <div className="h-12 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          <YAxis hide domain={["auto", "auto"]} />
          <Line type="monotone" dataKey="v" stroke={stroke} strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function KpiCard({ kpi }: { kpi: RefactorKpi }) {
  const delta = useMemo(() => {
    if (kpi.current_value == null || kpi.previous_value == null) return null;
    const d = Number(kpi.current_value) - Number(kpi.previous_value);
    if (d === 0) return null;
    const better = kpi.direction === "lower_is_better" ? d < 0 : d > 0;
    return { value: d, better };
  }, [kpi]);

  return (
    <Card className="tf-card">
      <CardContent className="p-5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1 min-w-0">
            <Badge variant="outline" className={statusClasses(kpi.status)}>{STATUS_LABEL[kpi.status]}</Badge>
            <h3 className="text-base font-semibold text-foreground">{kpi.label}</h3>
            <p className="text-sm text-muted-foreground">{kpi.description}</p>
          </div>
          <span className="text-[11px] text-muted-foreground whitespace-nowrap">{kpi.related_section}</span>
        </div>

        <div className="grid grid-cols-3 gap-3 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Current</p>
            <p className="text-2xl font-bold text-foreground">{formatValue(kpi.current_value, kpi.unit)}</p>
            {delta && (
              <p className={`text-xs ${delta.better ? "text-success" : "text-destructive"}`}>
                {delta.value > 0 ? "▲" : "▼"} {formatValue(Math.abs(delta.value), kpi.unit)} vs yesterday
              </p>
            )}
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Target</p>
            <p className="text-lg font-semibold text-foreground">{formatValue(kpi.target_value, kpi.unit)}</p>
            <p className="text-xs text-muted-foreground">{kpi.direction === "lower_is_better" ? "Lower is better" : "Higher is better"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Baseline</p>
            <p className="text-lg font-semibold text-muted-foreground">{formatValue(kpi.baseline_value, kpi.unit)}</p>
            <p className="text-xs text-muted-foreground">Where we started</p>
          </div>
        </div>

        <Sparkline trend={kpi.trend ?? []} direction={kpi.direction} />

        <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <Clock className="h-3 w-3" aria-hidden /> Updated {relativeTime(kpi.last_updated)}
          {kpi.current_window ? ` · window: ${kpi.current_window.replace("_", " ")}` : ""}
        </p>
      </CardContent>
    </Card>
  );
}

function CategorySection({ title, kpis }: { title: string; kpis: RefactorKpi[] }) {
  if (!kpis.length) return null;
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {kpis.map((k) => <KpiCard key={k.metric_key} kpi={k} />)}
      </div>
    </section>
  );
}

export function RefactorKpisTab() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [running, setRunning] = useState(false);

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["refactor-kpis", 30],
    queryFn: () => SystemHealthService.getRefactorKpis(30),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  // Realtime: refresh when daily snapshots change
  useMemo(() => {
    if (!user) return;
    const channel = supabase
      .channel("refactor-kpis-daily")
      .on("postgres_changes", { event: "*", schema: "public", table: "refactor_kpi_daily" },
        () => qc.invalidateQueries({ queryKey: ["refactor-kpis", 30] }))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user, qc]);

  const summary = useMemo(() => {
    const out = { met: 0, on_track: 0, at_risk: 0, off_track: 0, no_data: 0 };
    (data ?? []).forEach((k) => { out[k.status] += 1; });
    return out;
  }, [data]);

  const grouped = useMemo(() => {
    const map: Record<RefactorKpi["category"], RefactorKpi[]> = { errors: [], ux: [], email: [], infra: [], auth: [] };
    (data ?? []).forEach((k) => map[k.category].push(k));
    return map;
  }, [data]);

  const lastUpdated = useMemo(() => {
    const ts = (data ?? []).map((k) => k.last_updated).filter(Boolean) as string[];
    if (!ts.length) return null;
    return ts.sort().slice(-1)[0];
  }, [data]);

  async function handleRunNow() {
    try {
      setRunning(true);
      const n = await SystemHealthService.runRefactorKpisSnapshot();
      toast.success("Snapshot complete", { description: `Refreshed ${n} metric rows.` });
      await refetch();
    } catch (e) {
      toast.error("Snapshot failed", { description: (e as Error).message });
    } finally {
      setRunning(false);
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-56 w-full" />)}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle>Could not load refactor KPIs</CardTitle>
          <CardDescription>{(error as Error).message}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => refetch()} variant="outline">Try again</Button>
        </CardContent>
      </Card>
    );
  }

  const total = (data ?? []).length;

  return (
    <div className="space-y-6">
      <Card className="tf-card">
        <CardHeader>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="space-y-1">
              <CardTitle>Refactor progress</CardTitle>
              <CardDescription>
                Daily snapshots of every metric the audit-log refactor and UX overhaul are designed to move.
                Snapshots run automatically each day at 02:30 UTC.
              </CardDescription>
              <p className="flex items-center gap-1 text-xs text-muted-foreground pt-1">
                <Clock className="h-3 w-3" aria-hidden />
                Last snapshot {relativeTime(lastUpdated)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
                <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} /> Refresh view
              </Button>
              <Button size="sm" onClick={handleRunNow} disabled={running}>
                {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                Run snapshot now
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <SummaryStat label="Goal met"    value={summary.met}       total={total} tone="success" />
            <SummaryStat label="On track"    value={summary.on_track}  total={total} tone="primary" />
            <SummaryStat label="At risk"     value={summary.at_risk}   total={total} tone="warning" />
            <SummaryStat label="Off track"   value={summary.off_track} total={total} tone="danger" />
            <SummaryStat label="No data yet" value={summary.no_data}   total={total} tone="muted" />
          </div>
        </CardContent>
      </Card>

      <CategorySection title={CATEGORY_LABEL.errors} kpis={grouped.errors} />
      <CategorySection title={CATEGORY_LABEL.ux}     kpis={grouped.ux} />
      <CategorySection title={CATEGORY_LABEL.email}  kpis={grouped.email} />
      <CategorySection title={CATEGORY_LABEL.infra}  kpis={grouped.infra} />
      <CategorySection title={CATEGORY_LABEL.auth}   kpis={grouped.auth} />
    </div>
  );
}

function SummaryStat({ label, value, total, tone }: {
  label: string; value: number; total: number;
  tone: "success" | "primary" | "warning" | "danger" | "muted";
}) {
  const toneClass = {
    success: "text-success",
    primary: "text-primary",
    warning: "text-warning",
    danger:  "text-destructive",
    muted:   "text-muted-foreground",
  }[tone];
  return (
    <div className="rounded-lg border border-border bg-background/40 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-2xl font-bold ${toneClass}`}>{value}</p>
      <p className="text-[11px] text-muted-foreground">of {total} metrics</p>
    </div>
  );
}
