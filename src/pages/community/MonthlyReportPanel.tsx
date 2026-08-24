import { useMemo, useState } from "react";
import { useQuery } from "@/lib/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/design-system";

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from "recharts";

interface Row {
  month: string;
  status: string;
  ticket_count: number;
}

export default function MonthlyReportPanel() {
  const [_refresh, setRefresh] = useState(0);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["support", "monthly-report", _refresh] as const,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_support_monthly_report");
      if (error) throw error;
      return (data ?? []) as Row[];
    },
    staleTime: 60_000,
  });

  const chartData = useMemo(() => {
    const byMonth = new Map<string, Record<string, number | string>>();
    for (const r of rows) {
      const key = new Date(r.month).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
      });
      const bucket = byMonth.get(key) ?? { month: key };
      bucket[r.status || "unknown"] = (Number(bucket[r.status || "unknown"]) || 0) + r.ticket_count;
      byMonth.set(key, bucket);
    }
    return Array.from(byMonth.values());
  }, [rows]);

  const statuses = useMemo(
    () => Array.from(new Set(rows.map((r) => r.status || "unknown"))),
    [rows]
  );

  const exportCsv = () => {
    const header = "month,status,ticket_count\n";
    const body = rows.map((r) => `${r.month},${r.status},${r.ticket_count}`).join("\n");
    const blob = new Blob([header + body], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `support-monthly-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const colors = [
    "hsl(var(--primary))",
    "hsl(var(--secondary))",
    "hsl(var(--muted-foreground))",
    "hsl(var(--accent))",
  ];

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 flex-wrap">
        <div>
          <CardTitle>Monthly report</CardTitle>
          <CardDescription>Tickets by status over the last 12 months.</CardDescription>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setRefresh((k) => k + 1)}>
            Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={!rows.length}>
            Export CSV
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading report…</p>
        ) : !chartData.length ? (
          <p className="text-sm text-muted-foreground">
            No data yet. Reports populate as tickets are created.
          </p>
        ) : (
          <div style={{ width: "100%", height: 320 }}>
            <ResponsiveContainer>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" />
                <YAxis stroke="hsl(var(--muted-foreground))" allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border))",
                  }}
                />
                <Legend />
                {statuses.map((s, i) => (
                  <Bar key={s} dataKey={s} stackId="a" fill={colors[i % colors.length]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
