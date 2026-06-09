/**
 * Triage tab — read-only queue of error fingerprints from agent_fix_queue.
 *
 * Admins can:
 *   - See top error fingerprints with occurrence counts and severity
 *   - Run AI triage (one-click, capped at 20/day across the tenant)
 *   - Dismiss noise, mark resolved, or open a Lovable chat deep link to apply a fix
 *
 * Cost discipline:
 *   - Polls only on user-initiated refresh (no realtime, no interval)
 *   - AI triage call is hard-capped server-side (claim_triage_budget RPC)
 */
import { useEffect, useState, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Sparkles, RefreshCw, ExternalLink, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { KnownIssuePanel } from "./KnownIssuePanel";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

type FixStatus = "pending" | "triaged" | "proposed" | "applied" | "dismissed" | "resolved";

interface FixQueueRow {
  id: string;
  fingerprint: string;
  event_type: string;
  source: string;
  error_message: string;
  severity: "info" | "warn" | "error";
  status: FixStatus;
  occurrence_count: number;
  first_seen_at: string;
  last_seen_at: string;
  root_cause_hypothesis: string | null;
  proposed_fix_summary: string | null;
  proposed_fix_files: Array<{ path: string; change_summary: string }>;
  triage_cost_estimate_usd: number | null;
  triaged_at: string | null;
}

interface TriageAuditRow {
  id: string;
  from_status: string | null;
  to_status: string;
  rule_name: string;
  matching_signal: string | null;
  actor_id: string | null;
  created_at: string;
}

const statusVariant: Record<FixStatus, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "destructive",
  triaged: "secondary",
  proposed: "default",
  applied: "default",
  dismissed: "outline",
  resolved: "outline",
};

function buildLovablePrompt(row: FixQueueRow): string {
  const filesList = row.proposed_fix_files.map((f) => `- ${f.path}: ${f.change_summary}`).join("\n");
  return [
    `Apply the following triaged fix from the System Health queue.`,
    ``,
    `Error fingerprint: ${row.fingerprint}`,
    `Event: ${row.event_type} (${row.occurrence_count}× occurrences)`,
    `Source: ${row.source}`,
    ``,
    `Root cause hypothesis:`,
    row.root_cause_hypothesis ?? "(none)",
    ``,
    `Proposed fix:`,
    row.proposed_fix_summary ?? "(none)",
    ``,
    `Files to change:`,
    filesList || "(none specified — investigate)",
    ``,
    `Original error message:`,
    row.error_message.slice(0, 1000),
  ].join("\n");
}

export function TriageTab() {
  const [rows, setRows] = useState<FixQueueRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [budgetUsed, setBudgetUsed] = useState<number | null>(null);
  const [detailRow, setDetailRow] = useState<FixQueueRow | null>(null);
  const [auditRows, setAuditRows] = useState<TriageAuditRow[] | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: queue, error: qErr }, { data: budget }] = await Promise.all([
        supabase
          .from("agent_fix_queue")
          .select("*")
          // Only actionable, severity=error rows surface in Triage. warn/info
          // rows are observability-only and live in System Health; the DB
          // trigger `block_non_actionable_fix_queue_inserts` also blocks
          // them from insert, so this filter is belt-and-suspenders.
          .eq("severity", "error")
          .in("status", ["pending", "triaged", "proposed"])
          .or("snoozed_until.is.null,snoozed_until.lt." + new Date().toISOString())
          .order("last_seen_at", { ascending: false })
          .limit(50),
        supabase
          .from("agent_triage_budget")
          .select("triage_calls_used,day")
          .eq("id", 1)
          .maybeSingle(),
      ]);
      if (qErr) throw qErr;
      setRows((queue ?? []) as unknown as FixQueueRow[]);
      const today = new Date().toISOString().slice(0, 10);
      setBudgetUsed(budget?.day === today ? (budget.triage_calls_used ?? 0) : 0);
    } catch (e) {
      toast.error("We couldn't load the triage queue.", { description: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchAll(); }, [fetchAll]);

  const openDetails = useCallback(async (row: FixQueueRow) => {
    setDetailRow(row);
    setAuditRows(null);
    setAuditLoading(true);
    try {
      const { data, error } = await supabase
        .from("triage_audit_log")
        .select("id,from_status,to_status,rule_name,matching_signal,actor_id,created_at")
        .eq("fix_queue_id", row.id)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      setAuditRows((data ?? []) as TriageAuditRow[]);
    } catch (e) {
      toast.error("We couldn't load resolution history.", { description: (e as Error).message });
      setAuditRows([]);
    } finally {
      setAuditLoading(false);
    }
  }, []);

  const runTriage = async (row: FixQueueRow) => {
    setBusyId(row.id);
    try {
      const { data, error } = await supabase.functions.invoke("triage-error", {
        body: { fix_queue_id: row.id },
      });
      if (error) {
        const status = (error as { context?: { status?: number } }).context?.status;
        if (status === 429) {
          toast.error("Daily AI triage cap reached (20/day).");
        } else {
          toast.error("Triage failed", { description: error.message });
        }
        return;
      }
      if (data?.auto_silenced) {
        toast.success("Auto-silenced", {
          description: data.reason === "opaque_script_error"
            ? "Opaque cross-origin script error (permanent backstop)."
            : `Known issue match: ${String(data.pattern ?? "").slice(0, 80)}`,
        });
      } else {
        toast.success("Triage complete", {
          description: `Cost ~$${(data?.cost_estimate_usd ?? 0).toFixed(4)}`,
        });
      }
      await fetchAll();
    } finally {
      setBusyId(null);
    }
  };

  const setStatus = async (row: FixQueueRow, status: FixStatus, reason?: string) => {
    setBusyId(row.id);
    try {
      const { error } = await supabase.rpc("set_fix_queue_status", {
        p_id: row.id,
        p_status: status,
        p_reason: reason ?? null,
      });
      if (error) throw error;
      toast.success(`Marked as ${status}`);
      setDetailRow(null);
      await fetchAll();
    } catch (e) {
      toast.error("Status update failed", { description: (e as Error).message });
    } finally {
      setBusyId(null);
    }
  };

  const snooze = async (row: FixQueueRow, days = 7) => {
    setBusyId(row.id);
    try {
      const { error } = await supabase.rpc("snooze_fix_queue_entry", { p_id: row.id, p_days: days });
      if (error) throw error;
      toast.success(`Snoozed ${days}d`);
      setDetailRow(null);
      await fetchAll();
    } catch (e) {
      toast.error("Snooze failed", { description: (e as Error).message });
    } finally {
      setBusyId(null);
    }
  };

  const rejectAsKnown = async (row: FixQueueRow) => {
    const reason = window.prompt("Why is this safe to silence permanently?", "Known noise");
    if (!reason) return;
    setBusyId(row.id);
    try {
      const { error } = await supabase.rpc("promote_fingerprint_to_known", {
        p_fix_queue_id: row.id,
        p_reason: reason,
      });
      if (error) throw error;
      toast.success("Added to known-issue catalog");
      setDetailRow(null);
      await fetchAll();
    } catch (e) {
      toast.error("Reject failed", { description: (e as Error).message });
    } finally {
      setBusyId(null);
    }
  };

  const openInLovable = (row: FixQueueRow) => {
    const prompt = buildLovablePrompt(row);
    void navigator.clipboard?.writeText(prompt).catch(() => undefined);
    toast.success("Prompt copied to clipboard", {
      description: "Paste into Lovable chat to apply the fix.",
    });
  };

  const summary = useMemo(() => {
    if (!rows) return { pending: 0, proposed: 0, total: 0 };
    return {
      pending: rows.filter((r) => r.status === "pending").length,
      proposed: rows.filter((r) => r.status === "proposed").length,
      total: rows.length,
    };
  }, [rows]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-lg">Error Triage Queue</CardTitle>
            <CardDescription>
              Deduplicated error fingerprints from the audit log. Run AI triage to get a root-cause hypothesis and proposed fix.
            </CardDescription>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant="outline">
              AI budget: {budgetUsed ?? 0} / 20 today
            </Badge>
            <Button size="sm" variant="outline" onClick={fetchAll} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <Stat label="Pending" value={summary.pending} tone="danger" />
            <Stat label="Proposed fixes" value={summary.proposed} tone="default" />
            <Stat label="Open total" value={summary.total} tone="default" />
          </div>

          {loading && !rows ? (
            <div className="space-y-2">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : rows && rows.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <CheckCircle2 className="h-10 w-10 mx-auto mb-2 text-emerald-500" />
              <p className="font-medium text-foreground">No open errors. Nice.</p>
              <p className="text-sm">When the error reporter logs an error, it'll show up here.</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {rows?.map((row) => (
                <li
                  key={row.id}
                  className="rounded-md border p-3 hover:bg-muted/30 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <Badge variant={statusVariant[row.status]}>{row.status}</Badge>
                        <Badge variant="outline">{row.event_type}</Badge>
                        <Badge variant="secondary">×{row.occurrence_count}</Badge>
                        <span className="text-xs text-muted-foreground truncate">
                          {row.source}
                        </span>
                      </div>
                      <p className="text-sm text-foreground truncate font-mono">
                        {row.error_message}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Last seen {formatDistanceToNow(new Date(row.last_seen_at), { addSuffix: true })}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openDetails(row)}
                      >
                        Details
                      </Button>
                      {row.status === "pending" && (
                        <Button
                          size="sm"
                          onClick={() => runTriage(row)}
                          disabled={busyId === row.id || (budgetUsed ?? 0) >= 20}
                          aria-label="Run AI triage"
                        >
                          <Sparkles className="h-4 w-4 mr-1" />
                          Triage
                        </Button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <KnownIssuePanel />

      <Dialog open={!!detailRow} onOpenChange={(open) => !open && setDetailRow(null)}>
        <DialogContent className="max-w-2xl">
          {detailRow && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">{detailRow.event_type}
                </DialogTitle>
                <DialogDescription className="font-mono text-xs">
                  {detailRow.source}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 max-h-[60vh] overflow-y-auto">
                <Section title="Error message">
                  <pre className="text-xs font-mono whitespace-pre-wrap break-words bg-muted/50 p-3 rounded">
                    {detailRow.error_message}
                  </pre>
                </Section>

                {detailRow.root_cause_hypothesis && (
                  <Section title="Root cause (AI hypothesis)">
                    <p className="text-sm">{detailRow.root_cause_hypothesis}</p>
                  </Section>
                )}

                {detailRow.proposed_fix_summary && (
                  <Section title="Proposed fix">
                    <p className="text-sm whitespace-pre-wrap">{detailRow.proposed_fix_summary}</p>
                  </Section>
                )}

                {detailRow.proposed_fix_files.length > 0 && (
                  <Section title="Files to change">
                    <ul className="space-y-1 text-sm">
                      {detailRow.proposed_fix_files.map((f, i) => (
                        <li key={i} className="border-l-2 border-primary pl-2">
                          <code className="text-xs">{f.path}</code>
                          <p className="text-xs text-muted-foreground">{f.change_summary}</p>
                        </li>
                      ))}
                    </ul>
                  </Section>
                )}

                <Section title="Resolution history">
                  {auditLoading ? (
                    <Skeleton className="h-12 w-full" />
                  ) : !auditRows || auditRows.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No status changes recorded yet.</p>
                  ) : (
                    <ol className="space-y-2">
                      {auditRows.map((a) => (
                        <li key={a.id} className="text-xs border-l-2 border-primary/40 pl-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge variant="outline" className="font-mono">{a.rule_name}</Badge>
                            <span className="text-muted-foreground">
                              {a.from_status ?? "—"} → <span className="text-foreground font-medium">{a.to_status}</span>
                            </span>
                            <span className="text-muted-foreground">
                              {formatDistanceToNow(new Date(a.created_at), { addSuffix: true })}
                            </span>
                          </div>
                          {a.matching_signal && (
                            <p className="mt-1 text-muted-foreground whitespace-pre-wrap break-words">
                              <span className="font-semibold">Signal:</span> {a.matching_signal}
                            </p>
                          )}
                        </li>
                      ))}
                    </ol>
                  )}
                </Section>
              </div>

              <DialogFooter className="flex-col sm:flex-row gap-2">
                <Button
                  variant="outline"
                  onClick={() => setStatus(detailRow, "dismissed", "Marked as noise")}
                  disabled={busyId === detailRow.id}
                >
                  <XCircle className="h-4 w-4 mr-1" /> Dismiss as noise
                </Button>
                <Button
                  variant="outline"
                  onClick={() => snooze(detailRow, 7)}
                  disabled={busyId === detailRow.id}
                >
                  Snooze 7d
                </Button>
                <Button
                  variant="outline"
                  onClick={() => rejectAsKnown(detailRow)}
                  disabled={busyId === detailRow.id}
                >
                  Reject + add to known
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setStatus(detailRow, "resolved")}
                  disabled={busyId === detailRow.id}
                >
                  <CheckCircle2 className="h-4 w-4 mr-1" /> Mark resolved
                </Button>
                {detailRow.status === "proposed" && (
                  <Button
                    onClick={() => openInLovable(detailRow)}
                    disabled={busyId === detailRow.id}
                  >
                    <ExternalLink className="h-4 w-4 mr-1" /> Copy fix prompt
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: "default" | "danger" }) {
  return (
    <div className={`rounded-md border p-3 ${tone === "danger" && value > 0 ? "border-destructive/40 bg-destructive/5" : ""}`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-2xl font-bold text-foreground">{value}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
        {title}
      </h4>
      {children}
    </div>
  );
}
