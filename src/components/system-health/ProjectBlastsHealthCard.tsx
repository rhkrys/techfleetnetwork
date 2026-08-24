import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/design-system";

import { Mail, Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface BlastHealth {
  totals: {
    window_days: number;
    total_blasts: number;
    total_recipients: number;
    total_sent: number;
    total_failed: number;
    total_suppressed: number;
    success_rate: number;
  };
  recent: Array<{
    id: string;
    subject: string;
    status: string;
    recipient_count: number;
    email_sent_count: number;
    email_failed_count: number;
    email_suppressed_count: number;
    notification_sent_count: number;
    created_at: string;
    sent_at: string | null;
    project_friendly_name: string | null;
    client_name: string | null;
    sender_name: string | null;
  }>;
  generated_at: string;
}

export function ProjectBlastsHealthCard() {
  const [data, setData] = useState<BlastHealth | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { data: rpcData, error: rpcErr } = await supabase.rpc(
        "get_project_blast_health" as any,
        { window_days: 30 }
      );
      if (cancelled) return;
      if (rpcErr) {
        setError(rpcErr.message);
        return;
      }
      setData(rpcData as unknown as BlastHealth);
    }
    load();
    const channel = supabase
      .channel("project-blasts-health")
      .on("postgres_changes", { event: "*", schema: "public", table: "project_blasts" }, () =>
        load()
      )
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, []);

  if (error) {
    return (
      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">Project blasts unavailable</CardTitle>
          <CardDescription>{error}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const t = data?.totals;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">Project blasts</CardTitle>
        <CardDescription className="flex items-center gap-1 text-xs">
          <Clock className="h-3 w-3" aria-hidden />
          Last {t?.window_days ?? 30} days · Updated{" "}
          {data ? formatDistanceToNow(new Date(data.generated_at), { addSuffix: true }) : "—"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <Stat label="Blasts" value={t?.total_blasts ?? 0} />
          <Stat label="Recipients" value={t?.total_recipients ?? 0} />
          <Stat label="Delivered" value={t?.total_sent ?? 0} tone="success" />
          <Stat
            label="Failed"
            value={t?.total_failed ?? 0}
            tone={t && t.total_failed > 0 ? "danger" : "default"}
          />
        </div>
        <div className="text-xs text-muted-foreground">
          Email success rate: <strong className="text-foreground">{t?.success_rate ?? 0}%</strong> ·
          Suppressed: {t?.total_suppressed ?? 0}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="text-left text-muted-foreground border-b">
              <tr>
                <th className="px-2 py-2">Sent</th>
                <th className="px-2 py-2">Project</th>
                <th className="px-2 py-2">Coordinator</th>
                <th className="px-2 py-2">Subject</th>
                <th className="px-2 py-2">Recipients</th>
                <th className="px-2 py-2">Delivered</th>
                <th className="px-2 py-2">Failed</th>
                <th className="px-2 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {data?.recent?.length ? (
                data.recent.map((r) => (
                  <tr key={r.id} className="border-b last:border-b-0">
                    <td className="px-2 py-2 text-muted-foreground">
                      {formatDistanceToNow(new Date(r.sent_at ?? r.created_at), {
                        addSuffix: true,
                      })}
                    </td>
                    <td className="px-2 py-2">
                      {r.client_name || "—"}
                      {r.project_friendly_name ? ` — ${r.project_friendly_name}` : ""}
                    </td>
                    <td className="px-2 py-2 text-muted-foreground">{r.sender_name || "—"}</td>
                    <td className="px-2 py-2 font-medium text-foreground truncate max-w-[220px]">
                      {r.subject}
                    </td>
                    <td className="px-2 py-2">{r.recipient_count}</td>
                    <td className="px-2 py-2 text-success">{r.email_sent_count}</td>
                    <td className="px-2 py-2 text-destructive">{r.email_failed_count}</td>
                    <td className="px-2 py-2">
                      <Badge
                        variant={
                          r.status === "sent"
                            ? "default"
                            : r.status === "partial"
                              ? "secondary"
                              : r.status === "failed"
                                ? "destructive"
                                : "outline"
                        }
                      >
                        {r.status}
                      </Badge>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={8} className="px-2 py-6 text-center text-muted-foreground">
                    No project blasts in this window.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "success" | "danger";
}) {
  const toneClass =
    tone === "danger"
      ? "text-destructive"
      : tone === "success"
        ? "text-success"
        : "text-foreground";
  return (
    <div className="rounded-md border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${toneClass}`}>{value}</p>
    </div>
  );
}
