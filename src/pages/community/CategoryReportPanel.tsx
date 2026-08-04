import { useMemo, useState } from "react";
import { useQuery } from "@/lib/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";

interface Row { month: string; category: string; ticket_count: number }

/** Support tickets grouped by category over the last 12 months — surfaces the
 *  trending / most-common support topics the PRD asks admins to measure. */
export default function CategoryReportPanel() {
  const [refresh, setRefresh] = useState(0);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["support", "category-report", refresh] as const,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_support_category_report");
      if (error) throw error;
      return (data ?? []) as Row[];
    },
    staleTime: 60_000,
  });

  // Total tickets per category across the window, most-common first.
  const chartData = useMemo(() => {
    const byCat = new Map<string, number>();
    for (const r of rows) {
      byCat.set(r.category, (byCat.get(r.category) ?? 0) + Number(r.ticket_count));
    }
    return Array.from(byCat.entries())
      .map(([category, ticket_count]) => ({ category, ticket_count }))
      .sort((a, b) => b.ticket_count - a.ticket_count);
  }, [rows]);

  const exportCsv = () => {
    const header = "month,category,ticket_count\n";
    const body = rows.map((r) => `${r.month},${r.category},${r.ticket_count}`).join("\n");
    const blob = new Blob([header + body], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `support-categories-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 flex-wrap">
        <div>
          <CardTitle>Tickets by category</CardTitle>
          <CardDescription>Most common support topics over the last 12 months.</CardDescription>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setRefresh((k) => k + 1)}>Refresh</Button>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={!rows.length}>Export CSV</Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading report…</p>
        ) : !chartData.length ? (
          <p className="text-sm text-muted-foreground">No categorized tickets yet. Tag tickets to populate this report.</p>
        ) : (
          <div style={{ width: "100%", height: 360 }}>
            <ResponsiveContainer>
              <BarChart data={chartData} layout="vertical" margin={{ left: 24 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis type="number" stroke="hsl(var(--muted-foreground))" allowDecimals={false} />
                <YAxis type="category" dataKey="category" width={140} stroke="hsl(var(--muted-foreground))" />
                <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))" }} />
                <Bar dataKey="ticket_count" fill="hsl(var(--primary))" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
