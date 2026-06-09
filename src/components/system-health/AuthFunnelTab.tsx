/**
 * AuthFunnelTab — real-time funnel + synthetic prober health for the enterprise
 * auth rebuild (Phase 3, §9 "Observability + post-deploy verification").
 *
 * Reads `get_auth_funnel_counts(window)` (aggregates `ops_events` into pipeline
 * stages: submit → captcha → broker → mfa → session set → signed in) and
 * `get_auth_prober_health()` (latest outcome per probed stage with a 2-strike
 * flag). Admin-only via the RPC's own role check; tab visibility is already
 * gated by SystemHealthPage.
 *
 * Read-only: no actions, no writes. Vichea-class regressions surface here as
 * `session_write_failed` count > 0 without a matching `invalid_credentials`.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@/lib/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Activity, RefreshCw, ShieldCheck, AlertTriangle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

type FunnelRow = { stage: string; count: number };
type ProberRow = {
  stage: string;
  latest_outcome: string | null;
  latest_error_code: string | null;
  latest_latency_ms: number | null;
  latest_at: string | null;
  two_strike: boolean | null;
};

// Stage ordering for the funnel display. Anything not in this list falls to
// the bottom in count order, preserving discoverability of new event kinds.
const FUNNEL_ORDER = [
  "submit",
  "captcha",
  "captcha_failed",
  "mfa",
  "mfa_failed",
  "signed_in",
  "session_write_failed",
  "invalid_credentials",
  "rate_limited",
  "account_locked",
  "other_failure",
  "other",
];

const STAGE_LABELS: Record<string, string> = {
  submit: "Submit",
  captcha: "Captcha required",
  captcha_failed: "Captcha failed",
  mfa: "MFA required",
  mfa_failed: "MFA failed",
  signed_in: "Signed in",
  session_write_failed: "Session write failed",
  invalid_credentials: "Invalid credentials",
  rate_limited: "Rate limited",
  account_locked: "Account locked",
  other_failure: "Other failure",
  other: "Other",
};

const FAILURE_STAGES = new Set([
  "captcha_failed",
  "mfa_failed",
  "session_write_failed",
  "invalid_credentials",
  "rate_limited",
  "account_locked",
  "other_failure",
]);

export function AuthFunnelTab() {
  const [windowStr, setWindowStr] = useState<"1h" | "24h" | "7d">("24h");

  const funnel = useQuery({
    queryKey: ["auth-funnel", windowStr],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_auth_funnel_counts", {
        p_window: windowStr,
      });
      if (error) throw error;
      return (data ?? []) as FunnelRow[];
    },
    refetchInterval: 60_000,
  });

  const prober = useQuery({
    queryKey: ["auth-prober-health"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_auth_prober_health");
      if (error) throw error;
      return (data ?? []) as ProberRow[];
    },
    refetchInterval: 60_000,
  });

  const orderedFunnel = useMemo(() => {
    const rows = funnel.data ?? [];
    const byStage = new Map(rows.map((r) => [r.stage, r]));
    const ordered: FunnelRow[] = [];
    for (const stage of FUNNEL_ORDER) {
      const row = byStage.get(stage);
      if (row) ordered.push(row);
      byStage.delete(stage);
    }
    // Tail: unknown stages (so a newly-emitted event kind still shows up).
    for (const row of byStage.values()) ordered.push(row);
    return ordered;
  }, [funnel.data]);

  const totalSubmit =
    orderedFunnel.find((r) => r.stage === "submit")?.count ?? 0;
  const totalSignedIn =
    orderedFunnel.find((r) => r.stage === "signed_in")?.count ?? 0;
  const sessionWriteFailed =
    orderedFunnel.find((r) => r.stage === "session_write_failed")?.count ?? 0;
  const invalidCreds =
    orderedFunnel.find((r) => r.stage === "invalid_credentials")?.count ?? 0;

  // Vichea-class alarm: session writes failing without matching credential
  // rejections from the broker. In a healthy world this row is always 0.
  const vicheaRisk = sessionWriteFailed > 0 && invalidCreds === 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Auth Funnel</h2>
          <p className="text-sm text-muted-foreground">
            Drop-off across submit → captcha → broker → MFA → session set →
            signed in. Powered by ops_events.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={windowStr}
            onValueChange={(v) => setWindowStr(v as typeof windowStr)}
          >
            <SelectTrigger className="w-[120px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1h">Last 1h</SelectItem>
              <SelectItem value="24h">Last 24h</SelectItem>
              <SelectItem value="7d">Last 7d</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              funnel.refetch();
              prober.refetch();
            }}
          >
            <RefreshCw className="mr-2 h-4 w-4" /> Refresh
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Submits</CardDescription>
            <CardTitle className="text-3xl">{totalSubmit.toLocaleString()}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            Sign-in attempts started in window
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Signed in</CardDescription>
            <CardTitle className="text-3xl">
              {totalSignedIn.toLocaleString()}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {totalSubmit > 0
              ? `${Math.round((totalSignedIn / totalSubmit) * 100)}% conversion`
              : "—"}
          </CardContent>
        </Card>
        <Card className={vicheaRisk ? "border-destructive" : undefined}>
          <CardHeader className="pb-2">
            <CardDescription>Session-write failures</CardDescription>
            <CardTitle className="text-3xl">
              {sessionWriteFailed.toLocaleString()}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs">
            {vicheaRisk ? (
              <span className="flex items-center gap-1 font-medium text-destructive">
                <AlertTriangle className="h-3 w-3" /> No matching invalid-credentials — investigate
              </span>
            ) : (
              <span className="text-muted-foreground">
                Vichea-class guard (should stay at zero)
              </span>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4" /> Pipeline stages
          </CardTitle>
          <CardDescription>
            Counts of {`ops_events`} rows matching each auth pipeline stage in
            the selected window.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {funnel.isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : funnel.error ? (
            <p className="text-sm text-destructive">
              Failed to load funnel:{" "}
              {(funnel.error as Error).message ?? "unknown error"}
            </p>
          ) : orderedFunnel.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No auth events recorded in this window.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Stage</TableHead>
                  <TableHead className="text-right">Count</TableHead>
                  <TableHead className="text-right">% of submits</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orderedFunnel.map((row) => {
                  const pct =
                    totalSubmit > 0 ? (row.count / totalSubmit) * 100 : 0;
                  const isFailure = FAILURE_STAGES.has(row.stage);
                  return (
                    <TableRow key={row.stage}>
                      <TableCell className="font-medium">
                        {STAGE_LABELS[row.stage] ?? row.stage}{" "}
                        {isFailure && (
                          <Badge variant="destructive" className="ml-2">
                            failure
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.count.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {totalSubmit > 0 ? `${pct.toFixed(1)}%` : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4" /> Synthetic prober (last 24h)
          </CardTitle>
          <CardDescription>
            Reset → sign-out → sign-in is executed every 5 minutes from a
            sealed test account. Two consecutive same-stage failures page
            admins via Triage Critical Push.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {prober.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : prober.error ? (
            <p className="text-sm text-destructive">
              Failed to load prober health:{" "}
              {(prober.error as Error).message ?? "unknown error"}
            </p>
          ) : (prober.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No prober samples in the last 24 hours. Verify the cron job and
              the AUTH_PROBER_* secrets.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Stage</TableHead>
                  <TableHead>Outcome</TableHead>
                  <TableHead>Error</TableHead>
                  <TableHead className="text-right">Latency</TableHead>
                  <TableHead>Last run</TableHead>
                  <TableHead>2-strike</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(prober.data ?? []).map((row) => {
                  const ok = row.latest_outcome === "ok";
                  return (
                    <TableRow key={row.stage}>
                      <TableCell className="font-medium">{row.stage}</TableCell>
                      <TableCell>
                        <Badge variant={ok ? "default" : "destructive"}>
                          {row.latest_outcome ?? "—"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {row.latest_error_code ?? "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.latest_latency_ms != null
                          ? `${row.latest_latency_ms} ms`
                          : "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {row.latest_at
                          ? formatDistanceToNow(new Date(row.latest_at), {
                              addSuffix: true,
                            })
                          : "—"}
                      </TableCell>
                      <TableCell>
                        {row.two_strike ? (
                          <Badge variant="destructive">paging</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            clear
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
