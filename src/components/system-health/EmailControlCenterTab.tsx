/**
 * EmailControlCenterTab — System Health > Email v2 console (Phase 5).
 *
 * Single screen replacing the scattered Deliverability / Throttle / DLQ cards
 * for the v2 pipeline. Surfaces:
 *   - Per-lane circuit state, pause state, recent 429s, consecutive success
 *   - Outbox depth + age by status × lane
 *   - Per-lane v2 flag (bitmask 1=auth, 2=transactional, 4=bulk)
 *   - Last 50 outbox rows (payload scrubbed via get_email_outbox RPC)
 *   - Admin actions: Pause / Resume lane
 *
 * All reads go through service-role-protected SECURITY DEFINER RPCs:
 *   - get_email_outbox(p_lane, p_status, p_limit, p_offset)
 *   - pause_email_lane(p_lane, p_reason)
 *   - resume_email_lane(p_lane)
 *
 * See mem://features/email-subsystem-v2 + docs/runbooks/email-subsystem-v2.md.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@/lib/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, CircleSlash, PauseCircle, PlayCircle, Zap } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

type Lane = "auth" | "transactional" | "bulk";
type CircuitState = "closed" | "open" | "half_open";

interface LaneState {
  lane: Lane;
  circuit_state: CircuitState;
  opened_at: string | null;
  probe_at: string | null;
  recent_429_count: number;
  consecutive_success: number;
  paused_by_admin: boolean;
  paused_reason: string | null;
  updated_at: string;
}

interface OutboxRow {
  id: string;
  lane: Lane;
  template: string;
  recipient: string;
  status: string;
  attempts: number;
  next_attempt_at: string | null;
  sent_at: string | null;
  dlq_at: string | null;
  dlq_reason: string | null;
  last_error: string | null;
  last_status_code: number | null;
  created_at: string;
}

interface DepthRow {
  lane: Lane;
  status: string;
  count: number;
  oldest: string | null;
}

const LANES: Lane[] = ["auth", "transactional", "bulk"];

function rel(value: string | null | undefined) {
  if (!value) return "—";
  return formatDistanceToNow(new Date(value), { addSuffix: true });
}

function circuitVariant(state: CircuitState, paused: boolean) {
  if (paused) return "destructive" as const;
  if (state === "open") return "destructive" as const;
  if (state === "half_open") return "secondary" as const;
  return "default" as const;
}

function CircuitIcon({ state, paused }: { state: CircuitState; paused: boolean }) {
  if (paused) return <PauseCircle className="h-4 w-4 text-destructive" aria-hidden />;
  if (state === "open") return <CircleSlash className="h-4 w-4 text-destructive" aria-hidden />;
  if (state === "half_open") return <Zap className="h-4 w-4 text-warning" aria-hidden />;
  return <CheckCircle2 className="h-4 w-4 text-success" aria-hidden />;
}

export function EmailControlCenterTab() {
  const qc = useQueryClient();
  const [laneFilter, setLaneFilter] = useState<"all" | Lane>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // 1. Lane state — circuit + pause + 429 counters
  const laneQuery = useQuery({
    queryKey: ["email-v2", "lane-state"],
    queryFn: async (): Promise<LaneState[]> => {
      const { data, error } = await supabase
        .from("email_lane_state")
        .select(
          "lane,circuit_state,opened_at,probe_at,recent_429_count,consecutive_success,paused_by_admin,paused_reason,updated_at"
        )
        .order("lane");
      if (error) throw error;
      return (data ?? []) as LaneState[];
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  // 2. Outbox depth per (lane, status)
  const depthQuery = useQuery({
    queryKey: ["email-v2", "outbox-depth"],
    queryFn: async (): Promise<DepthRow[]> => {
      const { data, error } = await supabase
        .from("email_outbox")
        .select("lane,status,created_at")
        .in("status", ["pending", "sending", "dlq", "expired"])
        .order("created_at", { ascending: true })
        .limit(5000);
      if (error) throw error;
      const buckets = new Map<string, DepthRow>();
      for (const row of (data ?? []) as { lane: Lane; status: string; created_at: string }[]) {
        const k = `${row.lane}|${row.status}`;
        const existing = buckets.get(k);
        if (existing) existing.count++;
        else buckets.set(k, { lane: row.lane, status: row.status, count: 1, oldest: row.created_at });
      }
      return Array.from(buckets.values());
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  // 3. Recent outbox rows (payload scrubbed by RPC)
  const outboxQuery = useQuery({
    queryKey: ["email-v2", "outbox", laneFilter, statusFilter],
    queryFn: async (): Promise<OutboxRow[]> => {
      const { data, error } = await supabase.rpc("get_email_outbox", {
        p_lane: laneFilter === "all" ? null : laneFilter,
        p_status: statusFilter === "all" ? null : statusFilter,
        p_limit: 50,
        p_offset: 0,
      });
      if (error) throw error;
      return (data ?? []) as OutboxRow[];
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  // 4. v2 enable bitmask
  const flagQuery = useQuery({
    queryKey: ["email-v2", "flag"],
    queryFn: async (): Promise<number> => {
      const { data, error } = await supabase
        .from("email_send_state")
        .select("pipeline_v2_lanes_bitmask")
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return Number(data?.pipeline_v2_lanes_bitmask ?? 0);
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const pauseMut = useMutation({
    mutationKey: ["email-v2", "pause-lane"],
    mutationFn: async ({ lane, reason }: { lane: Lane; reason: string }) => {
      const { error } = await supabase.rpc("pause_email_lane", { p_lane: lane, p_reason: reason });
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      toast.success(`Paused ${vars.lane} lane`);
      qc.invalidateQueries({ queryKey: ["email-v2", "lane-state"] });
    },
    onError: (e: Error) => toast.error(`Pause failed: ${e.message}`),
  });

  const resumeMut = useMutation({
    mutationKey: ["email-v2", "resume-lane"],
    mutationFn: async (lane: Lane) => {
      const { error } = await supabase.rpc("resume_email_lane", { p_lane: lane });
      if (error) throw error;
    },
    onSuccess: (_d, lane) => {
      toast.success(`Resumed ${lane} lane`);
      qc.invalidateQueries({ queryKey: ["email-v2", "lane-state"] });
    },
    onError: (e: Error) => toast.error(`Resume failed: ${e.message}`),
  });

  const depthByLane = useMemo(() => {
    const map = new Map<Lane, DepthRow[]>();
    for (const row of depthQuery.data ?? []) {
      const arr = map.get(row.lane) ?? [];
      arr.push(row);
      map.set(row.lane, arr);
    }
    return map;
  }, [depthQuery.data]);

  const bitmask = flagQuery.data ?? 0;
  const laneFlagOn = (lane: Lane) =>
    (lane === "auth" && (bitmask & 1) !== 0) ||
    (lane === "transactional" && (bitmask & 2) !== 0) ||
    (lane === "bulk" && (bitmask & 4) !== 0);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">Email pipeline v2 control center</CardTitle>
          <CardDescription>
            Single source of truth for lane health, circuit-breaker state, and the v2 Outbox.
            Pause stops claiming new emails on a lane; Resume closes the circuit and clears 429 counters.
          </CardDescription>
        </CardHeader>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        {LANES.map((lane) => {
          const state = laneQuery.data?.find((s) => s.lane === lane);
          const depth = depthByLane.get(lane) ?? [];
          const pending = depth.find((d) => d.status === "pending")?.count ?? 0;
          const dlq = depth.find((d) => d.status === "dlq")?.count ?? 0;
          const sending = depth.find((d) => d.status === "sending")?.count ?? 0;
          return (
            <Card key={lane} className={state?.paused_by_admin ? "border-destructive/40" : ""}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-2 text-base capitalize">
                  <span className="flex items-center gap-2">
                    {state ? <CircuitIcon state={state.circuit_state} paused={state.paused_by_admin} /> : null}
                    {lane}
                  </span>
                  {laneQuery.isLoading ? (
                    <Skeleton className="h-5 w-16" />
                  ) : (
                    <Badge variant={circuitVariant(state?.circuit_state ?? "closed", !!state?.paused_by_admin)}>
                      {state?.paused_by_admin ? "paused" : (state?.circuit_state ?? "—")}
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription className="text-xs">
                  v2 routing: <span className={laneFlagOn(lane) ? "text-success font-medium" : "text-muted-foreground"}>
                    {laneFlagOn(lane) ? "on" : "off (legacy)"}
                  </span>
                  {state?.paused_reason ? ` · paused — ${state.paused_reason}` : null}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <p className="text-2xl font-semibold">{pending}</p>
                    <p className="text-xs text-muted-foreground">pending</p>
                  </div>
                  <div>
                    <p className="text-2xl font-semibold">{sending}</p>
                    <p className="text-xs text-muted-foreground">sending</p>
                  </div>
                  <div>
                    <p className="text-2xl font-semibold text-destructive">{dlq}</p>
                    <p className="text-xs text-muted-foreground">dlq</p>
                  </div>
                </div>
                <div className="text-xs text-muted-foreground">
                  Recent 429s: <strong>{state?.recent_429_count ?? 0}</strong> ·
                  consecutive sends: <strong>{state?.consecutive_success ?? 0}</strong>
                  {state?.opened_at ? <> · opened {rel(state.opened_at)}</> : null}
                  {state?.probe_at ? <> · probe {rel(state.probe_at)}</> : null}
                </div>
                <div className="flex gap-2 pt-1">
                  {state?.paused_by_admin ? (
                    <Button
                      size="sm"
                      variant="default"
                      onClick={() => resumeMut.mutate(lane)}
                      disabled={resumeMut.isPending}
                      aria-label={`Resume ${lane} lane`}
                    >
                      <PlayCircle className="mr-1 h-4 w-4" aria-hidden /> Resume lane
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => pauseMut.mutate({ lane, reason: "Paused from System Health" })}
                      disabled={pauseMut.isPending}
                      aria-label={`Pause ${lane} lane`}
                    >
                      <PauseCircle className="mr-1 h-4 w-4" aria-hidden /> Pause lane
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-2 text-base">
            <span>Outbox (last 50)</span>
            <div className="flex gap-2">
              <Select value={laneFilter} onValueChange={(v) => setLaneFilter(v as typeof laneFilter)}>
                <SelectTrigger className="w-36" aria-label="Filter by lane">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All lanes</SelectItem>
                  <SelectItem value="auth">Auth</SelectItem>
                  <SelectItem value="transactional">Transactional</SelectItem>
                  <SelectItem value="bulk">Bulk</SelectItem>
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-36" aria-label="Filter by status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="sending">Sending</SelectItem>
                  <SelectItem value="sent">Sent</SelectItem>
                  <SelectItem value="dlq">DLQ</SelectItem>
                  <SelectItem value="expired">Expired</SelectItem>
                  <SelectItem value="suppressed">Suppressed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardTitle>
          <CardDescription>
            Payloads are scrubbed by <code>get_email_outbox</code>. Recipients shown for admin triage.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {outboxQuery.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : outboxQuery.data && outboxQuery.data.length > 0 ? (
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="px-3 py-2">Lane</th>
                  <th className="px-3 py-2">Template</th>
                  <th className="px-3 py-2">Recipient</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Attempts</th>
                  <th className="px-3 py-2">Updated</th>
                  <th className="px-3 py-2">Error</th>
                </tr>
              </thead>
              <tbody>
                {outboxQuery.data.map((row) => (
                  <tr key={row.id} className="border-b last:border-b-0">
                    <td className="px-3 py-2 capitalize">{row.lane}</td>
                    <td className="px-3 py-2 font-medium text-foreground">{row.template}</td>
                    <td className="px-3 py-2 text-muted-foreground">{row.recipient}</td>
                    <td className="px-3 py-2">
                      <Badge
                        variant={
                          row.status === "sent"
                            ? "default"
                            : row.status === "dlq" || row.status === "expired"
                            ? "destructive"
                            : "secondary"
                        }
                      >
                        {row.status}
                      </Badge>
                    </td>
                    <td className="px-3 py-2">{row.attempts}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {rel(row.sent_at ?? row.dlq_at ?? row.next_attempt_at ?? row.created_at)}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {row.dlq_reason ?? row.last_error ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <AlertTriangle className="h-4 w-4" aria-hidden /> No v2 Outbox rows match the current filter.
              {bitmask === 0 ? " (v2 routing is off — flip the per-lane bitmask in email_send_state.)" : null}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default EmailControlCenterTab;
