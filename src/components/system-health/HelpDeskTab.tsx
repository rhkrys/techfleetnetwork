import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@/lib/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/design-system";

import { toast } from "sonner";

interface ProvRow {
  id: number;
  user_id: string;
  kind: string;
  freescout_id: string | null;
  status: string;
  attempts: number;
  last_error: string | null;
  created_at: string;
}

interface MonthlyRow {
  month: string;
  status: string;
  ticket_count: number;
}

export function HelpDeskTab() {
  const qc = useQueryClient();
  const [running, setRunning] = useState<"admins" | "members" | null>(null);

  const provLog = useQuery({
    queryKey: ["help-desk", "prov-log"] as const,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("support_provisioning_log")
        .select("id,user_id,kind,freescout_id,status,attempts,last_error,created_at")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as ProvRow[];
    },
    staleTime: 30_000,
  });

  const monthly = useQuery({
    queryKey: ["help-desk", "monthly"] as const,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_support_monthly_report");
      if (error) throw error;
      return (data ?? []) as MonthlyRow[];
    },
    staleTime: 5 * 60_000,
  });

  const backfill = useMutation({
    mutationFn: async (mode: "admins" | "members") => {
      setRunning(mode);
      const { data, error } = await supabase.rpc("support_backfill_provisioning", { _mode: mode });
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, mode) => {
      toast.success(`Backfill (${mode}) queued.`);
      qc.invalidateQueries({ queryKey: ["help-desk"] as const });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Backfill failed."),
    onSettled: () => setRunning(null),
  });

  const tone = (s: string) =>
    s === "success"
      ? "default"
      : s === "failed"
        ? "destructive"
        : s === "retry"
          ? "secondary"
          : "outline";

  const failuresCsv = () => {
    const rows = (provLog.data ?? []).filter((r) => r.status === "failed");
    if (rows.length === 0) {
      toast.info("No failed provisioning rows to export.");
      return;
    }
    const header = "user_id,kind,freescout_id,attempts,last_error,created_at\n";
    const body = rows
      .map((r) =>
        [
          r.user_id,
          r.kind,
          r.freescout_id ?? "",
          r.attempts,
          JSON.stringify(r.last_error ?? ""),
          r.created_at,
        ].join(",")
      )
      .join("\n");
    const blob = new Blob([header + body], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `help-desk-provisioning-failures-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const rows = provLog.data ?? [];
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const pending24 = rows.filter(
    (r) =>
      (r.status === "pending" || r.status === "retry") && new Date(r.created_at).getTime() > dayAgo
  ).length;
  const failed24 = rows.filter(
    (r) => r.status === "failed" && new Date(r.created_at).getTime() > dayAgo
  ).length;
  const retryRow = useMutation({
    mutationFn: async (id: number) => {
      const { error } = await supabase
        .from("support_provisioning_log")
        .update({ status: "retry", attempts: 0, last_error: null })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Re-enqueued for next retry tick.");
      qc.invalidateQueries({ queryKey: ["help-desk"] as const });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Retry failed."),
  });

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Pending provisioning (24h)</CardDescription>
            <CardTitle className="text-3xl">
              <Badge variant={pending24 === 0 ? "default" : "secondary"}>{pending24}</Badge>
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Failed provisioning (24h)</CardDescription>
            <CardTitle className="text-3xl">
              <Badge variant={failed24 === 0 ? "default" : "destructive"}>{failed24}</Badge>
            </CardTitle>
          </CardHeader>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Help Desk — Freescout provisioning</CardTitle>
          <CardDescription>
            New members and admins are provisioned automatically via DB triggers. Use the buttons
            below to backfill anyone the triggers missed.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button onClick={() => backfill.mutate("admins")} disabled={running !== null}>
            {running === "admins" ? "Running backfill…" : "Backfill admins"}
          </Button>
          <Button
            variant="outline"
            onClick={() => backfill.mutate("members")}
            disabled={running !== null}
          >
            {running === "members" ? "Resolving members…" : "Resolve existing members"}
          </Button>
          <Button variant="outline" onClick={failuresCsv}>
            Export failures (CSV)
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent provisioning activity</CardTitle>
          <CardDescription>Last 50 attempts across customers and admin users.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {provLog.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {!provLog.isLoading && (provLog.data ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">No provisioning activity yet.</p>
          )}
          {(provLog.data ?? []).length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground border-b">
                  <th className="py-2 pr-2">When</th>
                  <th className="py-2 pr-2">Kind</th>
                  <th className="py-2 pr-2">Status</th>
                  <th className="py-2 pr-2">Attempts</th>
                  <th className="py-2 pr-2">Freescout id</th>
                  <th className="py-2 pr-2">Error</th>
                  <th className="py-2 pr-2"></th>
                </tr>
              </thead>
              <tbody>
                {(provLog.data ?? []).map((r) => (
                  <tr key={r.id} className="border-b last:border-b-0">
                    <td className="py-2 pr-2 whitespace-nowrap">
                      {new Date(r.created_at).toLocaleString()}
                    </td>
                    <td className="py-2 pr-2">{r.kind}</td>
                    <td className="py-2 pr-2">
                      <Badge variant={tone(r.status) as any}>{r.status}</Badge>
                    </td>
                    <td className="py-2 pr-2">{r.attempts}</td>
                    <td className="py-2 pr-2 font-mono text-xs">{r.freescout_id ?? "—"}</td>
                    <td
                      className="py-2 pr-2 text-muted-foreground text-xs max-w-[24rem] truncate"
                      title={r.last_error ?? ""}
                    >
                      {r.last_error ?? "—"}
                    </td>
                    <td className="py-2 pr-2">
                      {r.status === "failed" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => retryRow.mutate(r.id)}
                          disabled={retryRow.isPending}
                        >
                          Retry now
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Monthly tickets</CardTitle>
          <CardDescription>
            Counts grouped by month and status. Updated every 4 hours.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {monthly.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {!monthly.isLoading && (monthly.data ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">No tickets yet.</p>
          )}
          {(monthly.data ?? []).length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground border-b">
                  <th className="py-2 pr-2">Month</th>
                  <th className="py-2 pr-2">Status</th>
                  <th className="py-2 pr-2">Tickets</th>
                </tr>
              </thead>
              <tbody>
                {(monthly.data ?? []).map((r, i) => (
                  <tr key={`${r.month}-${r.status}-${i}`} className="border-b last:border-b-0">
                    <td className="py-2 pr-2">
                      {new Date(r.month).toLocaleDateString(undefined, {
                        month: "long",
                        year: "numeric",
                      })}
                    </td>
                    <td className="py-2 pr-2 capitalize">{r.status}</td>
                    <td className="py-2 pr-2 font-medium">
                      {Number(r.ticket_count).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
