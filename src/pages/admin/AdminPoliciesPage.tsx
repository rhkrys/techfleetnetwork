import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { SEO } from "@/components/SEO";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";

interface PolicyVersionRow {
  id: string;
  policy_key: string;
  version: string;
  language: string;
  title: string;
  summary: string | null;
  is_current: boolean;
  effective_at: string;
  published_at: string | null;
  checksum: string;
}

const POLICY_KEYS = [
  "terms-and-conditions",
  "terms-of-use",
  "privacy",
  "cookies",
  "accessibility",
  "code-of-conduct",
] as const;

export default function AdminPoliciesPage() {
  const qc = useQueryClient();
  const [selectedKey, setSelectedKey] =
    useState<(typeof POLICY_KEYS)[number]>("terms-and-conditions");
  const [version, setVersion] = useState("");
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [bodyMd, setBodyMd] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: versions = [], isLoading } = useQuery<PolicyVersionRow[]>({
    queryKey: ["admin-policy-versions", selectedKey],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("policy_versions")
        .select(
          "id, policy_key, version, language, title, summary, is_current, effective_at, published_at, checksum"
        )
        .eq("policy_key", selectedKey)
        .order("effective_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as PolicyVersionRow[];
    },
  });

  const publish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!version.trim() || !title.trim() || !bodyMd.trim()) {
      toast.error("Version, title, and body are required.");
      return;
    }
    setBusy(true);
    const { error } = await supabase.rpc("publish_policy_version", {
      p_key: selectedKey,
      p_version: version.trim(),
      p_language: "en",
      p_title: title.trim(),
      p_summary: summary.trim() || null,
      p_body_md: bodyMd,
      p_body_html: null,
    });
    setBusy(false);
    if (error) {
      toast.error(`Could not publish version: ${error.message}`);
      return;
    }
    toast.success(`Published ${selectedKey} ${version}`);
    setVersion("");
    setTitle("");
    setSummary("");
    setBodyMd("");
    qc.invalidateQueries({ queryKey: ["admin-policy-versions", selectedKey] });
    qc.invalidateQueries({ queryKey: ["policy", selectedKey] });
  };

  return (
    <div className="container-app py-6 space-y-6">
      <SEO title="Admin · Policies" description="Publish and review legal policy versions." canonicalPath="/admin/policies" />
      <header>
        <h1 className="text-2xl font-bold">Policy versions</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Publish new legal policy versions without redeploying. Past versions stay in history for audit and acknowledgments.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <Card className="p-4 sm:p-6 space-y-4" data-no-card={false}>
          <div className="field-group">
            <Label htmlFor="policy-key">Policy</Label>
            <select
              id="policy-key"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={selectedKey}
              onChange={(e) => setSelectedKey(e.target.value as typeof selectedKey)}
            >
              {POLICY_KEYS.map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
          </div>

          <h2 className="text-base font-semibold">Version history</h2>
          {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {!isLoading && versions.length === 0 && (
            <p className="text-sm text-muted-foreground">No versions yet.</p>
          )}
          <ul className="space-y-2">
            {versions.map((v) => (
              <li
                key={v.id}
                className="rounded-md border p-3 text-sm flex items-start justify-between gap-3"
              >
                <div>
                  <div className="font-medium">
                    {v.version}{" "}
                    {v.is_current && (
                      <span className="ml-2 inline-flex items-center rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 px-2 py-0.5 text-xs">
                        Current
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {v.title} · {v.language} · effective {new Date(v.effective_at).toLocaleString()}
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5 font-mono">
                    {v.checksum.slice(0, 16)}…
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="p-4 sm:p-6" data-no-card={false}>
          <h2 className="text-base font-semibold">Publish new version</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Paste the full markdown. The checksum and timestamps are computed server-side.
          </p>
          <form onSubmit={publish} className="mt-4 grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="field-group">
                <Label htmlFor="pv-version">Version</Label>
                <Input
                  id="pv-version"
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
                  placeholder="e.g. 2026-06-01"
                  required
                />
              </div>
              <div className="field-group">
                <Label htmlFor="pv-title">Title</Label>
                <Input id="pv-title" value={title} onChange={(e) => setTitle(e.target.value)} required />
              </div>
            </div>
            <div className="field-group">
              <Label htmlFor="pv-summary">Summary (optional)</Label>
              <Input id="pv-summary" value={summary} onChange={(e) => setSummary(e.target.value)} />
            </div>
            <div className="field-group">
              <Label htmlFor="pv-body">Body (Markdown)</Label>
              <Textarea
                id="pv-body"
                value={bodyMd}
                onChange={(e) => setBodyMd(e.target.value)}
                rows={20}
                required
                className="font-mono text-xs"
              />
            </div>
            <div>
              <Button type="submit" disabled={busy}>
                {busy ? "Publishing…" : "Publish new version"}
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
}
