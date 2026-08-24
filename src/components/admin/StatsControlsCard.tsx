import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/design-system";

import { toast } from "@/hooks/use-toast";
import { Loader2, RefreshCw, ScanSearch } from "lucide-react";
import { useQueryClient } from "@/lib/react-query";

/**
 * Network-stats admin controls (System Health → Settings).
 *
 * - Recompute now: rebuilds every row in network_stats_snapshots from source.
 *   Idempotent; guarded by an advisory lock inside the SQL function.
 * - Reconcile parity: verifies course_completions ↔ course_completed badges
 *   and snapshot total ↔ sum of per-course stats. Any drift is logged to
 *   stats_drift_log and auto-corrected by a follow-up recompute.
 *
 * Both call admin-only SECURITY DEFINER RPCs that throw 'forbidden' if the
 * caller is not an admin — UI gating is a UX nicety, not the security
 * boundary.
 */
export function StatsControlsCard() {
  const qc = useQueryClient();
  const [recomputing, setRecomputing] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [lastReport, setLastReport] = useState<string | null>(null);

  async function handleRecompute() {
    setRecomputing(true);
    try {
      const { error } = await supabase.rpc("admin_recompute_stats");
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: ["network-stats"] });
      setLastReport(`Recomputed at ${new Date().toLocaleString()}`);
      toast({
        title: "Stats recomputed",
        description: "Network activity numbers rebuilt from source.",
        variant: "default",
      });
    } catch (err) {
      toast({
        title: "Recompute failed",
        description: (err as Error)?.message ?? "Unknown error",
        variant: "destructive",
      });
    } finally {
      setRecomputing(false);
    }
  }

  async function handleReconcile() {
    setReconciling(true);
    try {
      const { data, error } = await supabase.rpc("admin_reconcile_parity");
      if (error) throw error;
      const report = data as { drift_count?: number; auto_recomputed?: boolean } | null;
      const drift = report?.drift_count ?? 0;
      if (drift === 0) {
        setLastReport(`Parity verified at ${new Date().toLocaleString()} — no drift.`);
        toast({
          title: "Parity verified",
          description: "Course completions, badges, and snapshots all agree.",
          variant: "default",
        });
      } else {
        await qc.invalidateQueries({ queryKey: ["network-stats"] });
        setLastReport(
          `Drift detected (${drift}) and auto-corrected at ${new Date().toLocaleString()}.`
        );
        toast({
          title: "Drift corrected",
          description: `${drift} check(s) failed — snapshots rebuilt.`,
          variant: "default",
        });
      }
    } catch (err) {
      toast({
        title: "Reconcile failed",
        description: (err as Error)?.message ?? "Unknown error",
        variant: "destructive",
      });
    } finally {
      setReconciling(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Network stats controls</CardTitle>
        <CardDescription>
          Rebuild snapshot totals or verify the per-course / badge ledger parity. Both run
          server-side; safe to invoke on demand.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:flex-wrap">
        <Button onClick={handleRecompute} disabled={recomputing} variant="outline">
          {recomputing ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          Recompute stats now
        </Button>
        <Button onClick={handleReconcile} disabled={reconciling} variant="outline">
          {reconciling ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <ScanSearch className="mr-2 h-4 w-4" />
          )}
          Reconcile course ↔ badge parity
        </Button>
        {lastReport ? (
          <p className="text-xs text-muted-foreground sm:ml-2" aria-live="polite">
            {lastReport}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
