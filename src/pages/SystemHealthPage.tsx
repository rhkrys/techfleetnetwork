import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Mail,
  RadioTower,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery } from "@/lib/react-query";
import { usePageHeader } from "@/contexts/PageHeaderContext";
import { useSystemHealthRealtime } from "@/hooks/use-system-health-realtime";
import { SystemHealthService, type EmailPipelineLog } from "@/services/system-health.service";
import { FleetyHealthTab } from "@/components/admin/FleetyHealthTab";
import { ContentGapsTab } from "@/components/admin/ContentGapsTab";
import { StatsControlsCard } from "@/components/admin/StatsControlsCard";
import { SilentFailuresTab } from "@/components/admin/SilentFailuresTab";
import { AuditPressureTab } from "@/components/system-health/AuditPressureTab";
import { TriageTab } from "@/components/system-health/TriageTab";
import { PerformanceTab } from "@/components/system-health/PerformanceTab";
import { PerformanceByBrowserTab } from "@/components/system-health/PerformanceByBrowserTab";
import { PrivacyRequestsTab } from "@/components/system-health/PrivacyRequestsTab";
import { IncidentsTab } from "@/components/system-health/IncidentsTab";
import { ProjectBlastsHealthCard } from "@/components/system-health/ProjectBlastsHealthCard";
import { EmailDeliverabilityCard } from "@/components/system-health/EmailDeliverabilityCard";
import { EmailDlqPanel } from "@/components/system-health/EmailDlqPanel";
import { EmailBulkThrottleCard } from "@/components/system-health/EmailBulkThrottleCard";
import { EmailControlCenterTab } from "@/components/system-health/EmailControlCenterTab";
import { DiscordRepairTab } from "@/components/system-health/DiscordRepairTab";
import { LoginHealthTab } from "@/components/system-health/LoginHealthTab";
import { ResetHealthTab } from "@/components/system-health/ResetHealthTab";
import { AuthFunnelTab } from "@/components/system-health/AuthFunnelTab";
import { TranslationsTab } from "@/components/admin/system-health/TranslationsTab";
import { HelpDeskTab } from "@/components/system-health/HelpDeskTab";
import { RefactorKpisTab } from "@/components/system-health/RefactorKpisTab";
import { EdgeFunctionsTab } from "@/components/system-health/EdgeFunctionsTab";
import { PageTitle } from "@/components/ui/typography";

const FIVE_MIN = 5 * 60 * 1000;

const statusVariant = (status: string) => {
  if (["sent", "healthy"].includes(status)) return "default" as const;
  if (["failed", "dlq", "bounced", "complained", "degraded", "overloaded"].includes(status))
    return "destructive" as const;
  return "secondary" as const;
};

function relativeTime(value: string | null | undefined) {
  if (!value) return "None";
  return `${formatDistanceToNow(new Date(value), { addSuffix: true })}`;
}

/**
 * StatCard with self-evident "Last updated" footnote. Every metric tells the
 * admin precisely when the underlying data was generated, satisfying Nielsen
 * Heuristic #1 (Visibility of System Status).
 */
function StatCard({
  label,
  value,
  detail,
  generatedAt,
  tone = "default",
}: {
  label: string;
  value: number | string;
  detail: string;
  generatedAt: string;
  tone?: "default" | "warning" | "danger";
}) {
  const toneClass =
    tone === "danger" ? "border-destructive/40" : tone === "warning" ? "border-warning/40" : "";
  return (
    <Card className={toneClass}>
      <CardContent className="p-5">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="mt-2 text-3xl font-bold text-foreground">{value}</p>
        <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
        <p
          className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground/80"
          aria-label={`Last updated ${relativeTime(generatedAt)}`}
        >
          <Clock className="h-3 w-3" aria-hidden /> Updated {relativeTime(generatedAt)}
        </p>
      </CardContent>
    </Card>
  );
}

function LogRow({ log }: { log: EmailPipelineLog }) {
  return (
    <tr className="border-b last:border-b-0">
      <td className="px-3 py-3 font-medium text-foreground">{log.template_name}</td>
      <td className="px-3 py-3 text-muted-foreground">{log.recipient_email}</td>
      <td className="px-3 py-3">
        <Badge variant={statusVariant(log.status)}>{log.status}</Badge>
      </td>
      <td className="px-3 py-3 text-muted-foreground">{relativeTime(log.created_at)}</td>
      <td className="px-3 py-3 text-muted-foreground">{log.error_message || "—"}</td>
    </tr>
  );
}

export default function SystemHealthPage() {
  const { setHeader } = usePageHeader();
  const [hours, setHours] = useState("24");

  useEffect(() => {
    setHeader({
      title: "System Health",
      description: "Email pipeline visibility and platform troubleshooting",
      breadcrumbs: [{ label: "Admin" }, { label: "System Health" }],
    });
    return () => setHeader(null);
  }, [setHeader]);

  // 5-minute polling — Realtime push handles instant updates, the poll is a
  // safety net only. Prior 60s cadence drove ~5× more backend traffic than
  // needed and contributed to client-side throttle false positives.
  const { data, isLoading, isError, error, refetch, isFetching, dataUpdatedAt } = useQuery({
    queryKey: ["system-health", "email-pipeline", hours],
    queryFn: () => SystemHealthService.getEmailPipelineHealth(Number(hours), 50),
    staleTime: FIVE_MIN,
    refetchInterval: FIVE_MIN,
    refetchOnWindowFocus: false,
  });

  const { data: reconciler } = useQuery({
    queryKey: ["system-health", "email-reconciler"],
    queryFn: () => SystemHealthService.getEmailReconcilerStatus(),
    staleTime: FIVE_MIN,
    refetchInterval: FIVE_MIN,
    refetchOnWindowFocus: false,
  });

  // Realtime: invalidate cache whenever the source-of-truth row changes.
  useSystemHealthRealtime(true);

  const totals = data?.delivery_totals;
  const failureRate = useMemo(() => {
    if (!totals?.total) return 0;
    return Math.round(((totals.failed + totals.bounced + totals.complained) / totals.total) * 100);
  }, [totals]);

  const generatedAt = data?.generated_at ?? new Date(dataUpdatedAt || Date.now()).toISOString();
  const lastClientFetch = new Date(dataUpdatedAt || Date.now()).toISOString();

  // The reconciler is scheduled every 5 min; treat >15 min (3 missed ticks) or
  // never-run as STALLED. This is the staleness signal whose absence let the
  // cutover outage (dead reconciler cron) render as a mild amber number.
  const reconcilerStale =
    !reconciler?.last_run_at ||
    Date.now() - new Date(reconciler.last_run_at).getTime() > 15 * 60 * 1000;

  if (isLoading && !data) {
    return (
      <section className="container-app py-8" aria-labelledby="system-health-heading">
        <Skeleton className="h-9 w-56 mb-6" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-32 rounded-lg" />
          ))}
        </div>
      </section>
    );
  }

  if (isError || !data) {
    return (
      <section className="container-app py-8" aria-labelledby="system-health-heading">
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle id="system-health-heading" className="flex items-center gap-2">
              System Health unavailable
            </CardTitle>
            <CardDescription>
              {error instanceof Error ? error.message : "The health dashboard could not load."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Retry
            </Button>
          </CardContent>
        </Card>
      </section>
    );
  }

  return (
    <section className="container-app py-8 space-y-6" aria-labelledby="system-health-heading">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <PageTitle id="system-health-heading">System Health</PageTitle>
          <p className="text-sm text-muted-foreground flex items-center gap-2 flex-wrap">
            <span>Snapshot generated {relativeTime(data.generated_at)}</span>
            <span aria-hidden>·</span>
            <span>Client refreshed {relativeTime(lastClientFetch)}</span>
            <span aria-hidden>·</span>
            <span className="inline-flex items-center gap-1 text-success">
              <RadioTower className="h-3.5 w-3.5" aria-hidden /> Live updates on
            </span>
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Select value={hours} onValueChange={setHours}>
            <SelectTrigger className="w-full sm:w-40" aria-label="Time range">
              <SelectValue placeholder="Time range" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">Last hour</SelectItem>
              <SelectItem value="24">Last 24 hours</SelectItem>
              <SelectItem value="168">Last 7 days</SelectItem>
              <SelectItem value="720">Last 30 days</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            onClick={() => refetch()}
            disabled={isFetching}
            aria-label="Refresh now"
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      <Card
        className={data.health.status === "healthy" ? "border-success/40" : "border-destructive/40"}
      >
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {data.health.status === "healthy" ? (
              <CheckCircle2 className="h-5 w-5 text-success" />
            ) : (
              <AlertTriangle className="h-5 w-5 text-destructive" />
            )}
            Email Pipeline Status{" "}
            <Badge variant={statusVariant(data.health.status)}>{data.health.status}</Badge>
          </CardTitle>
          <CardDescription>{data.health.reason}</CardDescription>
          <p className="text-xs text-muted-foreground flex items-center gap-1 pt-1">
            <Clock className="h-3 w-3" aria-hidden /> Updated{" "}
            {relativeTime(data.send_state?.updated_at ?? generatedAt)}
          </p>
        </CardHeader>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Unique Emails"
          value={totals.total}
          detail={`Deduplicated over ${data.window_hours}h`}
          generatedAt={generatedAt}
        />
        <StatCard
          label="Sent"
          value={totals.sent}
          detail="Successfully handed to the sender"
          generatedAt={generatedAt}
        />
        <StatCard
          label="Pending"
          value={totals.pending}
          detail="Waiting or still processing"
          generatedAt={generatedAt}
          tone={totals.pending > 0 ? "warning" : "default"}
        />
        <StatCard
          label="Failure Rate"
          value={`${failureRate}%`}
          detail={`${totals.failed} failed or dead-lettered`}
          generatedAt={generatedAt}
          tone={failureRate > 0 ? "danger" : "default"}
        />
        <StatCard
          label="Stuck pending (>10 min)"
          value={reconciler?.stuck_pending ?? 0}
          detail={
            reconciler?.last_run_at
              ? `${reconcilerStale ? "⚠ Reconciler STALLED — " : ""}Last ran ${relativeTime(reconciler.last_run_at)} · terminal ${reconciler.last_run?.reconciled_terminal ?? 0} · requeued ${reconciler.last_run?.requeued ?? 0} · dlq ${reconciler.last_run?.dlq_lost ?? reconciler.last_run?.marked_dlq ?? 0}`
              : "⚠ Reconciler has never run — expected every 5 min"
          }
          generatedAt={generatedAt}
          tone={
            reconcilerStale
              ? "danger"
              : (reconciler?.stuck_pending ?? 0) > 0
                ? "warning"
                : "default"
          }
        />
      </div>

      <SystemHealthTabs>
        <TabsList aria-label="System health sections">
          <TabsTrigger value="refactor-kpis">Refactor KPIs</TabsTrigger>
          <TabsTrigger value="queues">Queues</TabsTrigger>
          <TabsTrigger value="delivery">Delivery</TabsTrigger>
          <TabsTrigger value="email-v2">Email v2</TabsTrigger>
          <TabsTrigger value="deliverability">Deliverability</TabsTrigger>
          <TabsTrigger value="blasts">Project Blasts</TabsTrigger>
          <TabsTrigger value="errors">Errors</TabsTrigger>
          <TabsTrigger value="triage">Triage</TabsTrigger>
          <TabsTrigger value="silent">Silent failures</TabsTrigger>
          <TabsTrigger value="performance">Performance</TabsTrigger>
          <TabsTrigger value="login">Login</TabsTrigger>
          <TabsTrigger value="reset">Password reset</TabsTrigger>
          <TabsTrigger value="auth-funnel">Auth funnel</TabsTrigger>
          <TabsTrigger value="fleety">Fleety</TabsTrigger>
          <TabsTrigger value="content">Content</TabsTrigger>
          <TabsTrigger value="translations">Translations</TabsTrigger>
          <TabsTrigger value="privacy">Privacy</TabsTrigger>
          <TabsTrigger value="incidents">Incidents</TabsTrigger>
          <TabsTrigger value="audit">Audit</TabsTrigger>
          <TabsTrigger value="discord">Discord</TabsTrigger>
          <TabsTrigger value="help-desk">Help desk</TabsTrigger>
          <TabsTrigger value="edge-functions">Edge functions</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="refactor-kpis">
          <RefactorKpisTab />
        </TabsContent>

        <TabsContent value="queues" className="grid gap-4 md:grid-cols-2">
          {data.queue_stats.map((queue) => (
            <Card key={queue.queue_name}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {queue.queue_name.replace(/_/g, " ")}
                </CardTitle>
                <CardDescription className="flex items-center gap-1 text-xs">
                  <Clock className="h-3 w-3" aria-hidden /> Updated {relativeTime(generatedAt)}
                </CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-muted-foreground">Queued</p>
                  <p className="text-2xl font-semibold">{queue.queued}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Ready</p>
                  <p className="text-2xl font-semibold">{queue.ready}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Retrying</p>
                  <p className="text-2xl font-semibold">{queue.delayed_or_inflight}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Max attempts</p>
                  <p className="text-2xl font-semibold">{queue.max_attempts}</p>
                </div>
                <div className="col-span-2 text-muted-foreground">
                  Oldest queued: {relativeTime(queue.oldest_enqueued_at)}
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="delivery">
          <LogTable logs={data.recent_logs} generatedAt={generatedAt} />
        </TabsContent>
        <TabsContent value="email-v2">
          <EmailControlCenterTab />
        </TabsContent>
        <TabsContent value="deliverability" className="space-y-4">
          <EmailBulkThrottleCard />
          <EmailDeliverabilityCard />
          <EmailDlqPanel />
        </TabsContent>
        <TabsContent value="blasts">
          <ProjectBlastsHealthCard />
        </TabsContent>
        <TabsContent value="errors">
          <ErrorList errors={data.recent_errors} generatedAt={generatedAt} />
        </TabsContent>
        <TabsContent value="triage">
          <TriageTab />
        </TabsContent>
        <TabsContent value="silent">
          <SilentFailuresTab />
        </TabsContent>
        <TabsContent value="performance" className="space-y-4">
          <PerformanceTab />
          <PerformanceByBrowserTab />
        </TabsContent>
        <TabsContent value="login">
          <LoginHealthTab />
        </TabsContent>
        <TabsContent value="reset">
          <ResetHealthTab />
        </TabsContent>
        <TabsContent value="auth-funnel">
          <AuthFunnelTab />
        </TabsContent>
        <TabsContent value="fleety">
          <FleetyHealthTab />
        </TabsContent>
        <TabsContent value="content">
          <ContentGapsTab />
        </TabsContent>
        <TabsContent value="translations">
          <TranslationsTab />
        </TabsContent>
        <TabsContent value="privacy">
          <PrivacyRequestsTab />
        </TabsContent>
        <TabsContent value="incidents">
          <IncidentsTab />
        </TabsContent>
        <TabsContent value="audit">
          <AuditPressureTab />
        </TabsContent>
        <TabsContent value="discord">
          <DiscordRepairTab />
        </TabsContent>
        <TabsContent value="help-desk">
          <HelpDeskTab />
        </TabsContent>
        <TabsContent value="edge-functions">
          <EdgeFunctionsTab />
        </TabsContent>
        <TabsContent value="settings" className="space-y-4">
          <StatsControlsCard />
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">Processing controls</CardTitle>
              <CardDescription className="flex items-center gap-1 text-xs">
                <Clock className="h-3 w-3" aria-hidden /> Updated{" "}
                {relativeTime(data.send_state?.updated_at ?? generatedAt)}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 text-sm">
              <div>
                <p className="text-muted-foreground">Batch size</p>
                <p className="text-xl font-semibold">{data.send_state?.batch_size ?? "—"}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Delay between sends</p>
                <p className="text-xl font-semibold">{data.send_state?.send_delay_ms ?? "—"}ms</p>
              </div>
              <div>
                <p className="text-muted-foreground">Rate limit pause</p>
                <p className="text-xl font-semibold">
                  {relativeTime(data.send_state?.retry_after_until)}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Auth email TTL</p>
                <p className="text-xl font-semibold">
                  {data.send_state?.auth_email_ttl_minutes ?? "—"} min
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">App email TTL</p>
                <p className="text-xl font-semibold">
                  {data.send_state?.transactional_email_ttl_minutes ?? "—"} min
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </SystemHealthTabs>
    </section>
  );
}

function LogTable({ logs, generatedAt }: { logs: EmailPipelineLog[]; generatedAt: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent email activity</CardTitle>
        <CardDescription className="flex items-center gap-1 text-xs">
          <Clock className="h-3 w-3" aria-hidden /> Updated {relativeTime(generatedAt)} · One row
          per unique email, showing the latest status.
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="px-3 py-2">Template</th>
              <th className="px-3 py-2">Recipient</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Updated</th>
              <th className="px-3 py-2">Error</th>
            </tr>
          </thead>
          <tbody>
            {logs.length ? (
              logs.map((log) => <LogRow key={log.message_id} log={log} />)
            ) : (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                  No email activity in this window.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function ErrorList({
  errors,
  generatedAt,
}: {
  errors: Array<{ error_message: string; status: string; occurrences: number; last_seen: string }>;
  generatedAt: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent errors</CardTitle>
        <CardDescription className="flex items-center gap-1 text-xs">
          <Clock className="h-3 w-3" aria-hidden /> Updated {relativeTime(generatedAt)} · Grouped
          failures and dead-lettered email events.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {errors.length ? (
          errors.map((item) => (
            <div
              key={`${item.status}-${item.error_message}-${item.last_seen}`}
              className="rounded-lg border p-4"
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <Badge variant={statusVariant(item.status)}>{item.status}</Badge>
                <span className="text-xs text-muted-foreground">
                  {item.occurrences} occurrences · {relativeTime(item.last_seen)}
                </span>
              </div>
              <p className="mt-2 text-sm text-foreground">{item.error_message}</p>
            </div>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">No recent email errors in this window.</p>
        )}
      </CardContent>
    </Card>
  );
}

const VALID_HEALTH_TABS = [
  "refactor-kpis",
  "queues",
  "delivery",
  "email-v2",
  "deliverability",
  "blasts",
  "errors",
  "triage",
  "silent",
  "performance",
  "login",
  "fleety",
  "content",
  "translations",
  "privacy",
  "incidents",
  "audit",
  "discord",
  "help-desk",
  "settings",
] as const;

function SystemHealthTabs({ children }: { children: React.ReactNode }) {
  const [params, setParams] = useSearchParams();
  const initial = params.get("tab");
  const value = (VALID_HEALTH_TABS as readonly string[]).includes(initial ?? "")
    ? (initial as string)
    : "queues";
  return (
    <Tabs
      value={value}
      onValueChange={(v) => {
        params.set("tab", v);
        setParams(params, { replace: true });
      }}
      className="space-y-4"
    >
      {children}
    </Tabs>
  );
}
