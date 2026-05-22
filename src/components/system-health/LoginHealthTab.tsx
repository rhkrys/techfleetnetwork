import { useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { AlertTriangle, CheckCircle2, RefreshCw, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";

type Outcome = string;

interface LoginHealthPayload {
  generated_at: string;
  kpis: {
    window_minutes: number;
    started: number;
    redirected: number;
    edge_entered: number;
    success_rate: number | null;
    p95_duration_ms: number;
    unique_failed_members: number;
  };
  buckets: Array<{ bucket_start: string; outcome: Outcome; count: number }>;
  branches: Array<{
    outcome: Outcome;
    count: number;
    last_seen: string;
    sample_request_id: string | null;
  }>;
  top_failing_domains: Array<{ domain: string; count: number }>;
  recent_failures: Array<{
    created_at: string;
    outcome: Outcome;
    branch: string | null;
    http_status: number | null;
    duration_ms: number | null;
    email_domain: string | null;
    request_id: string | null;
  }>;
  alerts: {
    success_rate_low: boolean;
    edge_unreachable: boolean;
    captcha_blocked_high: boolean;
    server_or_session_errors_high: boolean;
  };
}

const WINDOW_OPTIONS: Array<{ label: string; minutes: number }> = [
  { label: "Last 1 hour", minutes: 60 },
  { label: "Last 6 hours", minutes: 360 },
  { label: "Last 24 hours", minutes: 1440 },
  { label: "Last 7 days", minutes: 10080 },
];

const FAILURE_OUTCOMES = new Set([
  "captcha_blocked",
  "captcha_failed",
  "domain_reject",
  "auth_throttle",
  "invalid_credentials",
  "session_incomplete",
  "network_error",
  "server_error",
  "magic_link_failed",
]);

function outcomeTone(outcome: Outcome): "default" | "secondary" | "destructive" {
  if (outcome === "redirected" || outcome === "session_set" || outcome === "magic_link_sent") return "default";
  if (FAILURE_OUTCOMES.has(outcome)) return "destructive";
  return "secondary";
}

function relativeTime(value: string | null | undefined): string {
  if (!value) return "None";
  return formatDistanceToNow(new Date(value), { addSuffix: true });
}

export function LoginHealthTab() {
  const [windowMinutes, setWindowMinutes] = useState(1440);
  const [data, setData] = useState<LoginHealthPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      const { data: payload, error: fnErr } = await supabase.rpc("get_login_health", {
        p_window_minutes: windowMinutes,
      });
      if (cancelled) return;
      if (fnErr) {
        setError(fnErr.message);
        setLoading(false);
        return;
      }
      setData(payload as unknown as LoginHealthPayload);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [windowMinutes, refreshKey]);

  if (loading && !data) {
    return (
      <div className="grid gap-4 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-4 w-4" aria-hidden /> Couldn't load login health
          </CardTitle>
          <CardDescription>{error}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => setRefreshKey((k) => k + 1)} size="sm">Try again</Button>
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const k = data.kpis;
  const successRateLabel = k.success_rate == null ? "—" : `${k.success_rate}%`;
  const successRateTone =
    k.success_rate == null
      ? "text-muted-foreground"
      : k.success_rate >= 95
      ? "text-emerald-600 dark:text-emerald-400"
      : k.success_rate >= 80
      ? "text-amber-600 dark:text-amber-400"
      : "text-destructive";

  const anyAlert =
    data.alerts.success_rate_low ||
    data.alerts.edge_unreachable ||
    data.alerts.captcha_blocked_high ||
    data.alerts.server_or_session_errors_high;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Login health</h2>
          <p className="text-xs text-muted-foreground">
            Updated {relativeTime(data.generated_at)} · window {k.window_minutes / 60}h
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={String(windowMinutes)} onValueChange={(v) => setWindowMinutes(Number(v))}>
            <SelectTrigger className="h-9 w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WINDOW_OPTIONS.map((opt) => (
                <SelectItem key={opt.minutes} value={String(opt.minutes)}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={() => setRefreshKey((x) => x + 1)}>
            <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden /> Refresh
          </Button>
        </div>
      </div>

      {anyAlert && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-destructive">
              <ShieldAlert className="h-4 w-4" aria-hidden /> Login alerts
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {data.alerts.success_rate_low && <p>· Success rate below 95% in the current window.</p>}
            {data.alerts.edge_unreachable && <p>· Login attempts started but the login function is not being reached.</p>}
            {data.alerts.captcha_blocked_high && <p>· More than 5% of recent attempts are blocked at human verification.</p>}
            {data.alerts.server_or_session_errors_high && <p>· Server or session errors above 1% in the last 15 minutes.</p>}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Success rate</CardDescription>
            <CardTitle className={`text-3xl ${successRateTone}`}>{successRateLabel}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {k.redirected} of {k.started} attempts redirected
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Attempts started</CardDescription>
            <CardTitle className="text-3xl">{k.started.toLocaleString()}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {k.edge_entered.toLocaleString()} reached the server
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>P95 server duration</CardDescription>
            <CardTitle className="text-3xl">{k.p95_duration_ms} ms</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">Across login-with-captcha</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Members hitting failures</CardDescription>
            <CardTitle className="text-3xl">{k.unique_failed_members.toLocaleString()}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">Unique hashed identities</CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Branch breakdown</CardTitle>
            <CardDescription>Outcomes recorded in this window</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto" data-no-card>
              <table className="w-full text-sm">
                <thead className="text-muted-foreground">
                  <tr className="text-left">
                    <th className="py-2 pr-3">Outcome</th>
                    <th className="py-2 pr-3">Count</th>
                    <th className="py-2 pr-3">Last seen</th>
                  </tr>
                </thead>
                <tbody>
                  {data.branches.length === 0 && (
                    <tr>
                      <td colSpan={3} className="py-3 text-muted-foreground">
                        No login activity yet in this window.
                      </td>
                    </tr>
                  )}
                  {data.branches.map((b) => (
                    <tr key={b.outcome} className="border-t border-border/40">
                      <td className="py-2 pr-3">
                        <Badge variant={outcomeTone(b.outcome)}>{b.outcome}</Badge>
                      </td>
                      <td className="py-2 pr-3 font-medium">{b.count.toLocaleString()}</td>
                      <td className="py-2 pr-3 text-muted-foreground">{relativeTime(b.last_seen)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top failing domains</CardTitle>
            <CardDescription>Helps spot one-off vs platform-wide breakage</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto" data-no-card>
              <table className="w-full text-sm">
                <thead className="text-muted-foreground">
                  <tr className="text-left">
                    <th className="py-2 pr-3">Domain</th>
                    <th className="py-2 pr-3">Failures</th>
                  </tr>
                </thead>
                <tbody>
                  {data.top_failing_domains.length === 0 && (
                    <tr>
                      <td colSpan={2} className="py-3 text-muted-foreground">
                        No failures recorded.
                      </td>
                    </tr>
                  )}
                  {data.top_failing_domains.map((d) => (
                    <tr key={d.domain} className="border-t border-border/40">
                      <td className="py-2 pr-3 font-mono text-xs">{d.domain}</td>
                      <td className="py-2 pr-3 font-medium">{d.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-muted-foreground" aria-hidden /> Recent failures
          </CardTitle>
          <CardDescription>Up to 50 most recent non-success events</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto" data-no-card>
            <table className="w-full text-sm">
              <thead className="text-muted-foreground">
                <tr className="text-left">
                  <th className="py-2 pr-3">When</th>
                  <th className="py-2 pr-3">Outcome</th>
                  <th className="py-2 pr-3">Branch</th>
                  <th className="py-2 pr-3">HTTP</th>
                  <th className="py-2 pr-3">Duration</th>
                  <th className="py-2 pr-3">Domain</th>
                  <th className="py-2 pr-3">Request id</th>
                </tr>
              </thead>
              <tbody>
                {data.recent_failures.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-3 text-muted-foreground">
                      No failures in this window. Things look healthy.
                    </td>
                  </tr>
                )}
                {data.recent_failures.map((r, i) => (
                  <tr key={`${r.created_at}-${i}`} className="border-t border-border/40">
                    <td className="py-2 pr-3 whitespace-nowrap text-muted-foreground">{relativeTime(r.created_at)}</td>
                    <td className="py-2 pr-3">
                      <Badge variant={outcomeTone(r.outcome)}>{r.outcome}</Badge>
                    </td>
                    <td className="py-2 pr-3 text-muted-foreground">{r.branch ?? "—"}</td>
                    <td className="py-2 pr-3">{r.http_status ?? "—"}</td>
                    <td className="py-2 pr-3">{r.duration_ms != null ? `${r.duration_ms} ms` : "—"}</td>
                    <td className="py-2 pr-3 font-mono text-xs">{r.email_domain ?? "—"}</td>
                    <td className="py-2 pr-3 font-mono text-xs">
                      {r.request_id ? (
                        <button
                          type="button"
                          onClick={() => navigator.clipboard?.writeText(r.request_id!)}
                          className="hover:underline"
                          title="Copy request id"
                        >
                          {r.request_id}
                        </button>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
