import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Body, SectionTitle } from "@/components/ui/typography";
import { auditedInvoke } from "@/integrations/supabase/audited-invoke";
import { toast } from "sonner";
import manifest from "@/generated/edge-functions.manifest.json";

interface FnEntry {
  name: string;
  verify_jwt: boolean;
  kind: "auth" | "public" | "cron";
  critical?: boolean;
  declared?: boolean;
}

const entries = (manifest as { functions: FnEntry[]; generated_at: string }).functions;
const generatedAt = (manifest as { generated_at: string }).generated_at;

export function EdgeFunctionsTab() {
  const [filter, setFilter] = useState("");
  const [probing, setProbing] = useState(false);
  const [results, setResults] = useState<Record<string, { status: number; ok: boolean }>>({});

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return entries.filter((e) => !q || e.name.includes(q) || e.kind.includes(q));
  }, [filter]);

  const counts = useMemo(() => ({
    total: entries.length,
    auth: entries.filter((e) => e.kind === "auth").length,
    public: entries.filter((e) => e.kind === "public").length,
    cron: entries.filter((e) => e.kind === "cron").length,
    critical: entries.filter((e) => e.critical).length,
    undeclared: entries.filter((e) => !e.declared).length,
  }), []);

  async function probeNow() {
    setProbing(true);
    try {
      const { data, error } = await auditedInvoke<{
        checked: number;
        not_deployed: string[];
        ok: boolean;
      }>("edge-deploy-smoke", { method: "POST" });
      if (error) throw error;
      // Re-shape into a quick map: anything in not_deployed is 404.
      const next: Record<string, { status: number; ok: boolean }> = {};
      const bad = new Set(data?.not_deployed ?? []);
      for (const e of entries) {
        if (e.name === "edge-deploy-smoke") continue;
        next[e.name] = bad.has(e.name)
          ? { status: 404, ok: false }
          : { status: 200, ok: true };
      }
      setResults(next);
      if (data?.ok) toast.success(`All ${data.checked} edge functions deployed`);
      else toast.error(`${data?.not_deployed?.length ?? 0} function(s) not deployed`);
    } catch (e) {
      toast.error("Probe failed", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setProbing(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <SectionTitle>Edge functions</SectionTitle>
          <Body className="text-muted-foreground text-sm">
            Manifest source of truth — {counts.total} pinned ({counts.auth} auth, {counts.public} public,
            {" "}{counts.cron} cron, {counts.critical} critical).
            {counts.undeclared > 0 && ` ${counts.undeclared} undeclared kind (add @edge-* comment).`}
            {" "}Generated {new Date(generatedAt).toLocaleString()}.
          </Body>
        </div>
        <div className="flex items-center gap-2">
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by name or kind"
            className="w-56"
          />
          <Button onClick={probeNow} disabled={probing} variant="default">
            {probing ? "Probing…" : "Probe now"}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-4">Function</th>
                <th className="py-2 pr-4">Kind</th>
                <th className="py-2 pr-4">verify_jwt</th>
                <th className="py-2 pr-4">Critical</th>
                <th className="py-2 pr-4">Declared</th>
                <th className="py-2 pr-4">Last probe</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => {
                const r = results[e.name];
                return (
                  <tr key={e.name} className="border-b border-border/50">
                    <td className="py-2 pr-4 font-mono text-xs">{e.name}</td>
                    <td className="py-2 pr-4">
                      <Badge variant={e.kind === "auth" ? "default" : "secondary"}>{e.kind}</Badge>
                    </td>
                    <td className="py-2 pr-4">{String(e.verify_jwt)}</td>
                    <td className="py-2 pr-4">{e.critical ? "yes" : ""}</td>
                    <td className="py-2 pr-4">{e.declared ? "yes" : <span className="text-muted-foreground">no</span>}</td>
                    <td className="py-2 pr-4">
                      {r ? (
                        <Badge variant={r.ok ? "default" : "destructive"}>
                          {r.ok ? "OK" : `${r.status || "transport"}`}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

export default EdgeFunctionsTab;
