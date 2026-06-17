import { useEffect, useState, useCallback } from "react";
import { getUserSafe } from "@/lib/auth/session-port";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { DollarSign, Gauge, Loader2, RefreshCw, ShieldAlert, ShieldCheck } from "lucide-react";

type Projection = {
  today_usd: number;
  yesterday_usd: number;
  last_7d_usd: number;
  last_30d_usd: number;
  projected_30d_usd: number;
  turns_today: number;
  cache_hit_rate: number;
  canned_hit_rate: number;
  guard_step: "none" | "soft" | "medium" | "hard";
  guard_mode: "auto" | "force_off" | "force_soft" | "force_medium" | "force_hard";
};

type DailyRow = { day: string; turns: number; cache_hits: number; canned_hits: number; tokens_in: number; tokens_out: number; est_usd: number };
type TopRow = { user_query: string; hits: number; est_usd: number };

const STEP_TONE: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
  none:   { label: "Healthy",        cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30", icon: <ShieldCheck className="h-3.5 w-3.5" /> },
  soft:   { label: "Soft cap active",   cls: "bg-amber-500/15 text-amber-300 border-amber-500/30",  icon: <ShieldAlert className="h-3.5 w-3.5" /> },
  medium: { label: "Medium cap active", cls: "bg-orange-500/15 text-orange-300 border-orange-500/30", icon: <ShieldAlert className="h-3.5 w-3.5" /> },
  hard:   { label: "Hard cap active",   cls: "bg-red-500/15 text-red-300 border-red-500/30",       icon: <ShieldAlert className="h-3.5 w-3.5" /> },
};

const fmt = (n: number) => `$${(n ?? 0).toFixed(2)}`;

export function FleetyCostPanel() {
  const [proj, setProj] = useState<Projection | null>(null);
  const [daily, setDaily] = useState<DailyRow[]>([]);
  const [top, setTop] = useState<TopRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingMode, setSavingMode] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [p, d, t] = await Promise.all([
      supabase.rpc("fleety_cost_projection"),
      supabase.from("fleety_cost_daily").select("*").limit(14),
      supabase.rpc("fleety_top_expensive_turns", { _limit: 10 }),
    ]);
    if (p.error) toast.error(p.error.message);
    else setProj(((p.data ?? []) as Projection[])[0] ?? null);
    if (!d.error) setDaily((d.data ?? []) as DailyRow[]);
    if (!t.error) setTop((t.data ?? []) as TopRow[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const setMode = async (mode: Projection["guard_mode"]) => {
    setSavingMode(true);
    const user = await getUserSafe();
    const { error } = await supabase
      .from("fleety_cost_guard_state")
      .update({ mode, updated_at: new Date().toISOString(), updated_by: user?.id ?? null })
      .eq("id", 1);
    setSavingMode(false);
    if (error) toast.error(error.message);
    else { toast.success(`Guard mode set to ${mode}.`); load(); }
  };

  if (loading && !proj) {
    return (
      <Card>
        <CardContent className="py-8 flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading cost telemetry…
        </CardContent>
      </Card>
    );
  }

  const step = proj?.guard_step ?? "none";
  const tone = STEP_TONE[step] ?? STEP_TONE.none;

  return (
    <div className="space-y-4">
      {/* Status banner */}
      <Card className={step === "none" ? "" : "border-amber-500/40"}>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="flex items-center gap-2">Fleety Cost Guard
              </CardTitle>
              <CardDescription>
                Live spend telemetry. Guard auto-tightens caching/RAG when 30-day projection exceeds budget.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className={`gap-1 ${tone.cls}`}>{tone.icon}{tone.label}</Badge>
              <Button variant="ghost" size="sm" onClick={load} aria-label="Refresh cost data">
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Stat label="Today"           value={fmt(proj?.today_usd ?? 0)}      />
          <Stat label="Yesterday"       value={fmt(proj?.yesterday_usd ?? 0)}  />
          <Stat label="Last 7 days"     value={fmt(proj?.last_7d_usd ?? 0)}    />
          <Stat label="30-day projection" value={fmt(proj?.projected_30d_usd ?? 0)} highlight={step !== "none"} />
          <Stat label="Turns today"     value={String(proj?.turns_today ?? 0)} />
        </CardContent>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-0">
          <Stat label="Cache hit rate (30d)"  value={`${proj?.cache_hit_rate ?? 0}%`}  />
          <Stat label="Canned hit rate (30d)" value={`${proj?.canned_hit_rate ?? 0}%`} />
          <Stat label="30-day spend"          value={fmt(proj?.last_30d_usd ?? 0)} />
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <p className="text-xs text-muted-foreground mb-1">Guard mode</p>
              <Select value={proj?.guard_mode ?? "auto"} onValueChange={(v) => setMode(v as Projection["guard_mode"])} disabled={savingMode}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto (recommended)</SelectItem>
                  <SelectItem value="force_off">Force off</SelectItem>
                  <SelectItem value="force_soft">Force soft</SelectItem>
                  <SelectItem value="force_medium">Force medium</SelectItem>
                  <SelectItem value="force_hard">Force hard</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Daily table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">Daily spend (last 14 days)
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr><th className="text-left py-1">Day</th><th className="text-right">Turns</th><th className="text-right">Cache</th><th className="text-right">Canned</th><th className="text-right">Tokens in</th><th className="text-right">Tokens out</th><th className="text-right">Est USD</th></tr>
            </thead>
            <tbody>
              {daily.map((d) => (
                <tr key={d.day} className="border-t border-border/50">
                  <td className="py-1">{new Date(d.day).toLocaleDateString()}</td>
                  <td className="text-right">{d.turns}</td>
                  <td className="text-right">{d.cache_hits}</td>
                  <td className="text-right">{d.canned_hits}</td>
                  <td className="text-right">{d.tokens_in.toLocaleString()}</td>
                  <td className="text-right">{d.tokens_out.toLocaleString()}</td>
                  <td className="text-right font-mono">{fmt(d.est_usd)}</td>
                </tr>
              ))}
              {daily.length === 0 && (
                <tr><td colSpan={7} className="py-3 text-center text-muted-foreground">No telemetry yet.</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Top expensive queries */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Top repeated queries (7d) — promotion candidates</CardTitle>
          <CardDescription>High-volume queries are prime candidates for canned answers.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {top.map((t, i) => (
            <div key={i} className="flex items-start justify-between gap-3 text-sm">
              <p className="flex-1 break-words">{t.user_query}</p>
              <Badge variant="outline">{t.hits} hits</Badge>
              <Badge variant="outline" className="font-mono">{fmt(t.est_usd)}</Badge>
            </div>
          ))}
          {top.length === 0 && <p className="text-sm text-muted-foreground">No repeated queries yet.</p>}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-md border p-3 ${highlight ? "border-amber-500/40 bg-amber-500/5" : "border-border/60"}`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );
}
