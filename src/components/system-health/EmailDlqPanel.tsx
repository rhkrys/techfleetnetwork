/**
 * EmailDlqPanel — Admin-only "Failed sends (DLQ)" panel.
 *
 * Lists transactional emails that landed in the dead-letter queue and lets an
 * admin re-enqueue them via the `replay-dlq-emails` edge function. Currently
 * only announcement DLQ rows are re-renderable; project-blast and
 * fleety-coach-digest entries surface but flow through the function's
 * `not_replayable` reason and are reported back to the admin.
 *
 * BDD: EML-DLQ-001..005
 */
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@/lib/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ThemedAgGrid } from "@/components/AgGrid";
import { Mailbox, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import type { ColDef, GridApi, SelectionChangedEvent } from "ag-grid-community";

interface DlqRow {
  message_id: string;
  template_name: string;
  recipient_email: string;
  error_message: string | null;
  created_at: string;
}

const TEMPLATE_FILTERS = [
  { value: "all", label: "All" },
  { value: "announcement", label: "Announcement" },
  { value: "project-blast", label: "Project blast" },
  { value: "fleety-coach-digest", label: "Fleety digest" },
] as const;

const AGE_FILTERS = [
  { value: 1, label: "24h" },
  { value: 7, label: "7d" },
] as const;

type TemplateFilter = (typeof TEMPLATE_FILTERS)[number]["value"];

const REPLAYABLE_TEMPLATES = new Set(["announcement"]);

export function EmailDlqPanel() {
  const queryClient = useQueryClient();
  const [templateFilter, setTemplateFilter] = useState<TemplateFilter>("all");
  const [ageDays, setAgeDays] = useState<number>(7);
  const [selected, setSelected] = useState<DlqRow[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [replaying, setReplaying] = useState(false);
  const [gridApi, setGridApi] = useState<GridApi<DlqRow> | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["email-dlq-panel", templateFilter, ageDays],
    queryFn: async () => {
      const sinceIso = new Date(Date.now() - ageDays * 24 * 60 * 60 * 1000).toISOString();
      let q = supabase
        .from("email_send_log")
        .select("message_id, template_name, recipient_email, error_message, created_at")
        .eq("status", "dlq")
        .gte("created_at", sinceIso)
        .order("created_at", { ascending: false })
        .limit(500);
      if (templateFilter !== "all") q = q.eq("template_name", templateFilter);
      const { data, error } = await q;
      if (error) throw error;
      // Dedup by recipient_email + template_name (latest only)
      const seen = new Set<string>();
      const deduped: DlqRow[] = [];
      for (const r of (data ?? []) as DlqRow[]) {
        const k = `${r.template_name}::${r.recipient_email.toLowerCase()}`;
        if (seen.has(k)) continue;
        seen.add(k);
        deduped.push(r);
      }
      return deduped;
    },
    staleTime: 30_000,
  });

  const rows = data ?? [];

  const columnDefs = useMemo<ColDef<DlqRow>[]>(
    () => [
      {
        headerCheckboxSelection: true,
        checkboxSelection: (params) => REPLAYABLE_TEMPLATES.has(params.data?.template_name ?? ""),
        width: 48,
        pinned: "left",
        sortable: false,
        filter: false,
        suppressMovable: true,
      },
      {
        headerName: "Template",
        field: "template_name",
        width: 170,
        cellRenderer: (params: { value: string }) => {
          const replayable = REPLAYABLE_TEMPLATES.has(params.value);
          return (
            <span className="inline-flex items-center gap-2">
              <span>{params.value}</span>
              {!replayable && (
                <Badge variant="outline" className="text-xs">Manual re-send</Badge>
              )}
            </span>
          );
        },
      },
      { headerName: "Recipient", field: "recipient_email", flex: 1, minWidth: 220 },
      {
        headerName: "Error",
        field: "error_message",
        flex: 1,
        minWidth: 200,
        cellRenderer: (params: { value: string | null }) => (
          <span className="text-muted-foreground">{params.value ?? "—"}</span>
        ),
      },
      {
        headerName: "When",
        field: "created_at",
        width: 160,
        valueFormatter: (p) => (p.value ? formatDistanceToNow(new Date(p.value as string), { addSuffix: true }) : ""),
      },
    ],
    [],
  );

  const replayableSelected = selected.filter((r) => REPLAYABLE_TEMPLATES.has(r.template_name));
  const previewList = replayableSelected.slice(0, 5);
  const overflow = replayableSelected.length - previewList.length;

  // Group selected replayable rows by template, then call the edge fn once per template
  async function runReplay(rowsToReplay: DlqRow[]) {
    const byTemplate = new Map<string, string[]>();
    for (const r of rowsToReplay) {
      if (!REPLAYABLE_TEMPLATES.has(r.template_name)) continue;
      const arr = byTemplate.get(r.template_name) ?? [];
      arr.push(r.message_id);
      byTemplate.set(r.template_name, arr);
    }
    if (byTemplate.size === 0) {
      toast.error("No replayable rows selected.", { position: "top-center", duration: 6000 });
      return;
    }

    setReplaying(true);
    let totalReplayed = 0;
    let totalSkipped = 0;
    const skipReasons = { suppressed: 0, already_delivered: 0, not_replayable: 0, source_missing: 0, error: 0 };
    let hadError = false;

    try {
      for (const [template, ids] of byTemplate) {
        const { data: res, error } = await supabase.functions.invoke("replay-dlq-emails", {
          body: { template_name: template, message_ids: ids },
        });
        if (error) {
          hadError = true;
          console.error("replay-dlq-emails failed:", error);
          continue;
        }
        const r = res as {
          replayed?: number;
          skipped?: number;
          reasons?: typeof skipReasons;
        };
        totalReplayed += r.replayed ?? 0;
        totalSkipped += r.skipped ?? 0;
        for (const k of Object.keys(skipReasons) as (keyof typeof skipReasons)[]) {
          skipReasons[k] += (r.reasons?.[k] ?? 0);
        }
      }

      if (hadError && totalReplayed === 0) {
        toast.error("Replay failed. Check System Health logs and try again.", {
          position: "top-center", duration: 30_000,
        });
      } else {
        const detail: string[] = [];
        if (skipReasons.suppressed) detail.push(`${skipReasons.suppressed} unsubscribed`);
        if (skipReasons.already_delivered) detail.push(`${skipReasons.already_delivered} already delivered`);
        if (skipReasons.not_replayable) detail.push(`${skipReasons.not_replayable} not replayable`);
        if (skipReasons.source_missing) detail.push(`${skipReasons.source_missing} source missing`);
        if (skipReasons.error) detail.push(`${skipReasons.error} errored`);
        toast.success(`Resent ${totalReplayed} email${totalReplayed === 1 ? "" : "s"}.`, {
          description: totalSkipped > 0 ? `${totalSkipped} skipped — ${detail.join(", ")}.` : undefined,
          position: "top-center",
          duration: 30_000,
        });
      }
    } finally {
      setReplaying(false);
      setConfirmOpen(false);
      setSelected([]);
      gridApi?.deselectAll();
      // Refresh this panel + adjacent email queries
      await refetch();
      await queryClient.invalidateQueries({ queryKey: ["email-pipeline-health"] });
      await queryClient.invalidateQueries({ queryKey: ["email-domain-health"] });
    }
  }

  function handleConfirm() {
    void runReplay(replayableSelected);
  }

  function handleResendAllVisible() {
    const all = rows.filter((r) => REPLAYABLE_TEMPLATES.has(r.template_name));
    if (all.length === 0) {
      toast.info("No replayable rows visible.", { position: "top-center" });
      return;
    }
    setSelected(all);
    setConfirmOpen(true);
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mailbox className="h-5 w-5 text-warning" aria-hidden="true" />
            Failed sends (DLQ)
            <Badge variant={rows.length > 0 ? "destructive" : "secondary"}>{rows.length}</Badge>
          </CardTitle>
          <CardDescription>
            Emails that exhausted retries or hit TTL. Announcement rows can be resent in place; project blasts and Fleety digests must be re-triggered from their source UI.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Filter chips */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-1" role="group" aria-label="Template filter">
              {TEMPLATE_FILTERS.map((f) => (
                <Button
                  key={f.value}
                  size="sm"
                  variant={templateFilter === f.value ? "default" : "outline"}
                  onClick={() => setTemplateFilter(f.value)}
                  aria-pressed={templateFilter === f.value}
                >
                  {f.label}
                </Button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1 ml-auto" role="group" aria-label="Age filter">
              {AGE_FILTERS.map((f) => (
                <Button
                  key={f.value}
                  size="sm"
                  variant={ageDays === f.value ? "default" : "outline"}
                  onClick={() => setAgeDays(f.value)}
                  aria-pressed={ageDays === f.value}
                >
                  {f.label}
                </Button>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              onClick={() => setConfirmOpen(true)}
              disabled={replayableSelected.length === 0 || replaying}
            >
              <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
              Resend selected ({replayableSelected.length})
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleResendAllVisible}
              disabled={rows.length === 0 || replaying}
            >
              Resend all visible
            </Button>
            {selected.length > 0 && (
              <span className="text-xs text-muted-foreground">
                {selected.length} selected
                {selected.length !== replayableSelected.length && ` · ${selected.length - replayableSelected.length} not replayable`}
              </span>
            )}
          </div>

          {/* Grid */}
          {isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : rows.length === 0 ? (
            <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
              No failed sends in this window. 🎉
            </div>
          ) : (
            <ThemedAgGrid<DlqRow>
              rowData={rows}
              columnDefs={columnDefs}
              rowSelection="multiple"
              suppressRowClickSelection
              height="420px"
              gridId="email-dlq-panel"
              exportFileName="email-dlq"
              onGridReady={(p) => setGridApi(p.api as GridApi<DlqRow>)}
              onSelectionChanged={(e: SelectionChangedEvent<DlqRow>) => {
                setSelected(e.api.getSelectedRows());
              }}
            />
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={(open) => !replaying && setConfirmOpen(open)}
        title={`Resend ${replayableSelected.length} email${replayableSelected.length === 1 ? "" : "s"}?`}
        consequence={
          <div className="space-y-2">
            <p>
              These recipients will receive a fresh copy of the original announcement. Unsubscribed and already-delivered addresses are filtered automatically.
            </p>
            <ul className="text-xs space-y-0.5 list-disc list-inside text-foreground/80">
              {previewList.map((r) => (
                <li key={r.message_id}>{r.recipient_email}</li>
              ))}
              {overflow > 0 && <li className="list-none italic">+ {overflow} more</li>}
            </ul>
          </div>
        }
        actionLabel="Resend emails"
        loading={replaying}
        onConfirm={handleConfirm}
      />
    </>
  );
}
