/**
 * Admin System Health > Translations tab.
 * Shows per-locale coverage %, queue depth, recent QA failures,
 * and a one-click backfill button.
 */
import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw, Languages, AlertTriangle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface SummaryRow {
  locale: string;
  queue_pending: number;
  queue_failed: number;
  translated_ok: number;
  qa_failed: number;
  last_qa_failure_at: string | null;
}

interface CoverageRow {
  locale: string;
  coverage_pct: number;
  ugc_coverage_pct: number;
  audited_at: string;
}

interface QaFailureRow {
  id: string;
  entity_table: string | null;
  column_name: string | null;
  locale: string;
  source_text: string;
  attempted_text: string | null;
  gate_failed: string;
  created_at: string;
}

export function TranslationsTab() {
  const { toast } = useToast();
  const [summary, setSummary] = useState<SummaryRow[]>([]);
  const [coverage, setCoverage] = useState<CoverageRow[]>([]);
  const [failures, setFailures] = useState<QaFailureRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [backfilling, setBackfilling] = useState(false);
  const [seedLocales, setSeedLocales] = useState("es,fr,de,pt,ja,zh,ar,hi,ko,it,nl,pl,tr,vi,sw");
  const [seeding, setSeeding] = useState(false);

  async function load() {
    setLoading(true);
    const [{ data: s }, { data: c }, { data: f }] = await Promise.all([
      supabase.from("ugc_translation_summary").select("*"),
      supabase
        .from("i18n_coverage_audit")
        .select("locale, coverage_pct, ugc_coverage_pct, audited_at")
        .order("audited_at", { ascending: false })
        .limit(100),
      supabase
        .from("i18n_qa_failures")
        .select("id, entity_table, column_name, locale, source_text, attempted_text, gate_failed, created_at")
        .order("created_at", { ascending: false })
        .limit(25),
    ]);
    setSummary((s ?? []) as SummaryRow[]);
    // Dedupe to latest per locale
    const latestByLocale = new Map<string, CoverageRow>();
    for (const row of (c ?? []) as CoverageRow[]) {
      if (!latestByLocale.has(row.locale)) latestByLocale.set(row.locale, row);
    }
    setCoverage([...latestByLocale.values()]);
    setFailures((f ?? []) as QaFailureRow[]);
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  async function runBackfill() {
    setBackfilling(true);
    const { data, error } = await supabase.rpc("backfill_ugc_translations", { p_table: null });
    setBackfilling(false);
    if (error) {
      toast({ title: "Backfill failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Backfill enqueued", description: `Queued translations for active locales: ${JSON.stringify(data)}` });
    void load();
  }

  async function runSeed() {
    const locales = seedLocales.split(",").map((s) => s.trim()).filter(Boolean);
    if (locales.length === 0) {
      toast({ title: "Pick at least one language", variant: "destructive" });
      return;
    }
    setSeeding(true);
    const { data, error } = await supabase.rpc("backfill_ugc_translations_for_locales", {
      p_locales: locales,
      p_table: null,
    });
    setSeeding(false);
    if (error) {
      toast({ title: "Seed failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Seed enqueued", description: `Queued ${(data as { enqueued?: number })?.enqueued ?? 0} jobs across ${locales.length} languages.` });
    void load();
  }

  async function runAudit() {
    const { error } = await supabase.rpc("audit_i18n_coverage");
    if (error) {
      toast({ title: "Audit failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Coverage audit complete" });
    void load();
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading translations data…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Languages className="h-4 w-4" aria-hidden /> Seed languages
          </CardTitle>
          <CardDescription>
            Pre-translate all existing content into specific languages — useful before any member has chosen a language.
            Use BCP-47 codes separated by commas (e.g. es, fr, de, ja).
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={seedLocales}
            onChange={(e) => setSeedLocales(e.target.value)}
            aria-label="Languages to seed"
            placeholder="es, fr, de, ja"
          />
          <Button onClick={runSeed} disabled={seeding} aria-label="Seed translations for chosen languages">
            {seeding ? <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden /> : <Languages className="mr-1 h-3 w-3" aria-hidden />}
            Seed translations
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Languages className="h-4 w-4" aria-hidden /> Per-locale coverage
            </CardTitle>
            <CardDescription>Latest snapshot of static UI + user-generated content coverage.</CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={runAudit} aria-label="Run coverage audit">
              <RefreshCw className="mr-1 h-3 w-3" aria-hidden /> Refresh audit
            </Button>
            <Button size="sm" onClick={runBackfill} disabled={backfilling} aria-label="Translate all existing content">
              {backfilling ? <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden /> : <Languages className="mr-1 h-3 w-3" aria-hidden />}
              Translate everything now
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {summary.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active non-English locales yet. Use the seed box above or wait for members to choose a language.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="p-2">Locale</th>
                    <th className="p-2">UI coverage</th>
                    <th className="p-2">UGC coverage</th>
                    <th className="p-2">Queued</th>
                    <th className="p-2">Failed</th>
                    <th className="p-2">QA failed</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.map((row) => {
                    const cov = coverage.find((c) => c.locale === row.locale);
                    return (
                      <tr key={row.locale} className="border-t">
                        <td className="p-2 font-mono">{row.locale}</td>
                        <td className="p-2">{cov ? `${cov.coverage_pct}%` : "—"}</td>
                        <td className="p-2">{cov ? `${cov.ugc_coverage_pct}%` : "—"}</td>
                        <td className="p-2">{row.queue_pending}</td>
                        <td className="p-2">{row.queue_failed > 0 ? <Badge variant="destructive">{row.queue_failed}</Badge> : 0}</td>
                        <td className="p-2">{row.qa_failed > 0 ? <Badge variant="secondary">{row.qa_failed}</Badge> : 0}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" aria-hidden /> Recent QA failures
          </CardTitle>
          <CardDescription>Translations that did not pass the quality gates. Source text was served instead.</CardDescription>
        </CardHeader>
        <CardContent>
          {failures.length === 0 ? (
            <p className="text-sm text-muted-foreground">No recent QA failures.</p>
          ) : (
            <ul className="space-y-3">
              {failures.map((f) => (
                <li key={f.id} className="border-l-2 border-destructive pl-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{f.gate_failed}</Badge>
                    <span className="font-mono text-xs">{f.locale}</span>
                    {f.entity_table && <span className="text-xs text-muted-foreground">{f.entity_table}.{f.column_name}</span>}
                    <span className="text-xs text-muted-foreground">{new Date(f.created_at).toLocaleString()}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">Source: {f.source_text.slice(0, 160)}</p>
                  {f.attempted_text && <p className="text-xs">Attempted: {f.attempted_text.slice(0, 160)}</p>}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
