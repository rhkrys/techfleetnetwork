import { useEffect, useState } from "react";
import { safeRpc } from "@/lib/supabase/safe-rpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/design-system";

interface ContinentRow {
  continent: string;
  platform_count: number;
  external_count: number;
  total_count: number;
}

export function MemberContinentBreakdown() {
  const [rows, setRows] = useState<ContinentRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data, error } = await safeRpc<ContinentRow[]>(
        "get_member_continent_distribution",
        undefined,
        { source: "MemberContinentBreakdown.load", severity: "warn" }
      );
      if (!active) return;
      if (!error && data) setRows(data);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  const total = rows.reduce((s, r) => s + r.total_count, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Members by continent</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-base text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-base text-muted-foreground">No data yet.</p>
        ) : (
          <div className="space-y-3">
            <ul className="divide-y divide-border">
              {rows.map((r) => {
                const pct = total > 0 ? Math.round((r.total_count / total) * 100) : 0;
                return (
                  <li key={r.continent} className="flex items-baseline justify-between py-2">
                    <span className="text-base font-medium text-foreground">{r.continent}</span>
                    <span className="text-base text-foreground tabular-nums">
                      {r.total_count.toLocaleString()}{" "}
                      <span className="text-muted-foreground text-sm">({pct}%)</span>
                    </span>
                  </li>
                );
              })}
            </ul>
            <div className="flex items-baseline justify-between border-t border-border pt-3">
              <span className="text-base font-semibold text-foreground">Total</span>
              <span className="text-base font-semibold text-foreground tabular-nums">
                {total.toLocaleString()}
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
