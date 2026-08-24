import React from "react";
import { useQuery } from "@/lib/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@/design-system";

import { Loader2, Mail } from "lucide-react";
import { formatDateTime } from "@/lib/format/date";

type BlastRow = {
  id: string;
  subject: string;
  status: string;
  recipient_count: number | null;
  email_sent_count: number | null;
  email_failed_count: number | null;
  notification_sent_count: number | null;
  created_at: string;
  sent_at: string | null;
};

const statusVariant = (s: string): "default" | "secondary" | "destructive" | "outline" => {
  if (s === "sent") return "default";
  if (s === "partial") return "secondary";
  if (s === "failed") return "destructive";
  return "outline";
};

export default function ProjectBlastHistory({ projectId }: { projectId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["project-blasts-history", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_blasts")
        .select(
          "id, subject, status, recipient_count, email_sent_count, email_failed_count, notification_sent_count, created_at, sent_at"
        )
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(25);
      if (error) throw error;
      return (data ?? []) as BlastRow[];
    },
    enabled: !!projectId,
    staleTime: 30_000,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">Blast history</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading" />
          </div>
        )}
        {error && <p className="text-sm text-destructive">Could not load blast history.</p>}
        {!isLoading && !error && (data?.length ?? 0) === 0 && (
          <p className="text-sm text-muted-foreground">
            No blasts have been sent for this project yet.
          </p>
        )}
        {!isLoading && (data?.length ?? 0) > 0 && (
          <ul className="divide-y divide-border" role="list">
            {data!.map((b) => (
              <li key={b.id} className="py-3 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{b.subject}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {formatDateTime(b.sent_at ?? b.created_at)}
                    {" · "}
                    {b.recipient_count ?? 0} recipients
                    {" · "}
                    {b.email_sent_count ?? 0} sent
                    {(b.email_failed_count ?? 0) > 0 && (
                      <>
                        {" "}
                        · <span className="text-destructive">{b.email_failed_count} failed</span>
                      </>
                    )}
                  </p>
                </div>
                <Badge variant={statusVariant(b.status)} className="capitalize shrink-0">
                  {b.status}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
