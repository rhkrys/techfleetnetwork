/**
 * Read-only audit-log volume + pressure panel.
 *
 * - On-demand query (no polling). Loads when admin opens the tab.
 * - Surfaces current daily projection, pressure level, and top error
 *   fingerprints from the last 24h so admins can see what's burning writes.
 *
 * UX heuristic #1 (visibility of system status): clearly labels current
 * pressure with a colored badge and explains thresholds inline.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge, Card, CardContent, CardHeader, CardTitle, Skeleton } from "@/design-system";

type Pressure = "none" | "soft" | "medium" | "hard";

interface PressureMeta {
  audit_pressure?: Pressure;
  audit_writes_5m?: number;
  audit_projected_24h?: number;
  audit_pressure_updated_at?: string;
}

const THRESHOLDS: Record<Pressure, string> = {
  none: "Below 20k writes/day projected",
  soft: "20k–35k writes/day — caps tightened to 66%",
  medium: "35k–50k writes/day — caps tightened to 33%",
  hard: "Above 50k writes/day — caps tightened to 10%",
};

const BADGE_VARIANT: Record<Pressure, "default" | "secondary" | "destructive" | "outline"> = {
  none: "secondary",
  soft: "outline",
  medium: "default",
  hard: "destructive",
};

export function AuditPressureTab() {
  const { data: meta, isLoading: metaLoading } = useQuery({
    queryKey: ["system-health", "audit-pressure"],
    queryFn: async (): Promise<PressureMeta> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("system_health_state")
        .select("metadata")
        .eq("id", 1)
        .maybeSingle();
      if (error) throw error;
      return (data?.metadata ?? {}) as PressureMeta;
    },
    staleTime: 60_000,
  });

  const { data: top, isLoading: topLoading } = useQuery({
    queryKey: ["system-health", "audit-top-fingerprints"],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc("get_top_error_fingerprints", {
        p_hours: 24,
        p_limit: 10,
      });
      if (error) throw error;
      return (data ?? []) as Array<{
        fingerprint: string;
        event_type: string | null;
        occurrences: number;
        affected_users: number;
        last_seen: string;
        sample_message: string | null;
      }>;
    },
    staleTime: 60_000,
  });

  const pressure: Pressure = meta?.audit_pressure ?? "none";
  const projected = meta?.audit_projected_24h ?? 0;
  const writes5m = meta?.audit_writes_5m ?? 0;
  const updated = meta?.audit_pressure_updated_at;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <div>
            <CardTitle className="text-base">Audit log pressure</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Updates every 5 min via the email pipeline health cron. No new infrastructure.
            </p>
          </div>
          <Badge variant={BADGE_VARIANT[pressure]} className="uppercase tracking-wide">
            {pressure}
          </Badge>
        </CardHeader>
        <CardContent>
          {metaLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : (
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat label="Writes (last 5 min)" value={writes5m.toLocaleString()} />
              <Stat label="Projected / 24h" value={projected.toLocaleString()} />
              <Stat
                label="Last evaluated"
                value={updated ? new Date(updated).toLocaleString() : "—"}
              />
            </div>
          )}
          <p className="text-xs text-muted-foreground mt-4">{THRESHOLDS[pressure]}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Top error fingerprints (24h)</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            What's currently consuming write budget. Investigate top items first.
          </p>
        </CardHeader>
        <CardContent>
          {topLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : !top || top.length === 0 ? (
            <p className="text-sm text-muted-foreground">No error fingerprints in the last 24h.</p>
          ) : (
            <ul className="divide-y divide-border">
              {top.map((row) => (
                <li
                  key={row.fingerprint}
                  className="py-2 text-sm flex items-start justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="font-mono text-xs truncate">{row.event_type ?? "—"}</p>
                    <p className="text-muted-foreground truncate">
                      {row.sample_message ?? row.fingerprint}
                    </p>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <div className="font-medium">{row.occurrences.toLocaleString()}×</div>
                    <div className="text-xs text-muted-foreground">{row.affected_users} users</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold mt-1 break-words">{value}</div>
    </div>
  );
}
