import { useEffect, useState, useCallback } from "react";
import { getUserSafe } from "@/lib/auth/session-port";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  ThumbsUp, ThumbsDown, Sparkles, AlertTriangle, Check, X, Loader2, Clock,
} from "lucide-react";
import { FleetyPlaybooksManager } from "@/components/admin/FleetyPlaybooksManager";
import { FleetyCostPanel } from "@/components/admin/FleetyCostPanel";

type Signal = {
  id: string;
  user_query: string;
  audience: string;
  kb_hit_count: number;
  framework_hit_count: number;
  web_hit_count: number;
  canned_answer_id: string | null;
  created_at: string;
  conversation_id: string | null;
};

type Canned = {
  id: string;
  question_pattern: string;
  answer_md: string;
  audience: string;
  enabled: boolean;
  created_at: string;
};

type Proposed = {
  id: string;
  from_entity: string;
  to_entity: string;
  description: string;
  inverse_description: string | null;
  status: string;
  created_at: string;
};

type PromptVersion = {
  id: string;
  label: string;
  notes: string | null;
  weight: number;
  is_default: boolean;
  created_at: string;
};

type PlaybookDraft = {
  id: string;
  slug: string;
  title: string;
  intent: string;
  audience: string;
  direct_answer: string;
  is_active: boolean;
  created_at: string;
};

/**
 * Fleety Coach panel — embedded in System Health.
 *
 * Surfaces last-7-days chat signals (turn count, knowledge gaps, thumbs),
 * lets admins one-click promote a turn to a canned answer, toggle existing
 * canned answers, and approve/reject Fleety's auto-proposed framework
 * relationships. RLS guarantees only admins see/manage these rows.
 */
export function FleetyHealthTab() {
  const [loading, setLoading] = useState(true);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [canned, setCanned] = useState<Canned[]>([]);
  const [proposed, setProposed] = useState<Proposed[]>([]);
  const [stats, setStats] = useState({ total: 0, gaps: 0, thumbsUp: 0, thumbsDown: 0 });
  const [draft, setDraft] = useState({ pattern: "", answer: "", audience: "all", sourceTurnId: "" });
  const [generatedAt, setGeneratedAt] = useState<string>(new Date().toISOString());
  const [practicalGaps, setPracticalGaps] = useState<Array<{ id: string; user_query: string; audience: string; created_at: string; practical_score: number | null; playbook_hits: number; chips_clicked: number }>>([]);
  const [versions, setVersions] = useState<PromptVersion[]>([]);
  const [drafts, setDrafts] = useState<PlaybookDraft[]>([]);
  const [activeTab, setActiveTab] = useState<string>("gaps");

  const load = useCallback(async () => {
    setLoading(true);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const [sigsRes, cansRes, propsRes, upRes, dnRes, pgapsRes, versionsRes, draftsRes] = await Promise.all([
      supabase.from("fleety_turn_signals").select("*").gte("created_at", sevenDaysAgo).order("created_at", { ascending: false }).limit(200),
      supabase.from("fleety_canned_answers").select("*").order("created_at", { ascending: false }).limit(100),
      supabase.from("fleety_proposed_relationships").select("*").eq("status", "pending").order("created_at", { ascending: false }),
      supabase.from("fleety_message_feedback").select("*", { count: "exact", head: true }).eq("rating", 1).gte("created_at", sevenDaysAgo),
      supabase.from("fleety_message_feedback").select("*", { count: "exact", head: true }).eq("rating", -1).gte("created_at", sevenDaysAgo),
      supabase.from("fleety_turn_signals")
        .select("id, user_query, audience, created_at, practical_score, playbook_hits, chips_clicked")
        .gte("created_at", sevenDaysAgo)
        .or("intent.eq.how_to,intent.eq.troubleshoot,intent.eq.decision")
        .lte("practical_score", 0.3)
        .order("created_at", { ascending: false })
        .limit(50),
      supabase.from("fleety_prompt_versions").select("*").order("is_default", { ascending: false }).order("weight", { ascending: false }),
      supabase.from("fleety_playbooks").select("id, slug, title, intent, audience, direct_answer, is_active, created_at").eq("is_active", false).order("created_at", { ascending: false }).limit(50),
    ]);
    const all = (sigsRes.data ?? []) as Signal[];
    setSignals(all);
    setCanned((cansRes.data ?? []) as Canned[]);
    setProposed((propsRes.data ?? []) as Proposed[]);
    setPracticalGaps((pgapsRes.data ?? []) as typeof practicalGaps);
    setVersions((versionsRes.data ?? []) as PromptVersion[]);
    setDrafts((draftsRes.data ?? []) as PlaybookDraft[]);
    setStats({
      total: all.length,
      gaps: all.filter((s) => s.kb_hit_count === 0 && s.framework_hit_count === 0).length,
      thumbsUp: upRes.count ?? 0,
      thumbsDown: dnRes.count ?? 0,
    });
    setGeneratedAt(new Date().toISOString());
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const authorPlaybookFromGap = (q: string) => {
    // Hand off to the Practical Content tab with the question pre-filled in clipboard
    // and a toast hint — playbook authoring lives in FleetyPlaybooksManager which has its own dialog.
    void navigator.clipboard?.writeText(q).catch(() => {});
    toast.success("Question copied. Opening Practical Content — paste into 'When to use'.");
    setActiveTab("practical");
  };

  const promoteFromTurn = (s: Signal) =>
    setDraft({ pattern: s.user_query, answer: "", audience: s.audience, sourceTurnId: s.id });

  const saveCanned = async () => {
    if (!draft.pattern.trim() || !draft.answer.trim()) {
      toast.error("Question pattern and answer are required.");
      return;
    }
    const user = await getUserSafe();
    const { error } = await supabase.from("fleety_canned_answers").insert({
      question_pattern: draft.pattern.trim(),
      answer_md: draft.answer.trim(),
      audience: draft.audience,
      source_turn_id: draft.sourceTurnId || null,
      created_by: user?.id ?? null,
    });
    if (error) toast.error(error.message);
    else {
      toast.success("Canned answer saved. Fleety will use it on matching questions.");
      setDraft({ pattern: "", answer: "", audience: "all", sourceTurnId: "" });
      load();
    }
  };

  const toggleCanned = async (c: Canned) => {
    const { error } = await supabase.from("fleety_canned_answers").update({ enabled: !c.enabled }).eq("id", c.id);
    if (error) toast.error(error.message); else load();
  };

  const approveRel = async (id: string) => {
    const { error } = await supabase.rpc("fleety_approve_relationship", { p_id: id });
    if (error) toast.error(error.message);
    else { toast.success("Relationship approved and added to the framework."); load(); }
  };

  const rejectRel = async (id: string) => {
    const { error } = await supabase.from("fleety_proposed_relationships").update({ status: "rejected" }).eq("id", id);
    if (error) toast.error(error.message); else load();
  };

  const approveDraft = async (d: PlaybookDraft) => {
    const { error } = await supabase.from("fleety_playbooks").update({ is_active: true }).eq("id", d.id);
    if (error) toast.error(error.message);
    else { toast.success(`Draft "${d.title}" promoted to active.`); load(); }
  };
  const rejectDraft = async (d: PlaybookDraft) => {
    const { error } = await supabase.from("fleety_playbooks").delete().eq("id", d.id);
    if (error) toast.error(error.message); else { toast.success("Draft removed."); load(); }
  };

  const setDefaultVersion = async (v: PromptVersion) => {
    // Clear other defaults then set this one. Weights remain manually managed.
    const { error: clearErr } = await supabase.from("fleety_prompt_versions").update({ is_default: false }).neq("id", v.id);
    if (clearErr) { toast.error(clearErr.message); return; }
    const { error } = await supabase.from("fleety_prompt_versions").update({ is_default: true }).eq("id", v.id);
    if (error) toast.error(error.message); else { toast.success(`"${v.label}" is now the default prompt.`); load(); }
  };
  const [bulkLoading, setBulkLoading] = useState(false);
  const bulkDraft = async (entity: "deliverable" | "milestone" | "workshop") => {
    setBulkLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("fleety-bulk-draft-playbooks", { body: { entity, limit: 5 } });
      if (error) toast.error(error.message);
      else toast.success(`Drafted ${data?.drafted ?? 0} ${entity}(s). Review them in this tab.`);
      load();
    } finally {
      setBulkLoading(false);
    }
  };

  const updateWeight = async (v: PromptVersion, weight: number) => {
    const { error } = await supabase.from("fleety_prompt_versions").update({ weight }).eq("id", v.id);
    if (error) toast.error(error.message); else load();
  };

  const updatedRel = (() => {
    const ago = Math.round((Date.now() - new Date(generatedAt).getTime()) / 1000);
    if (ago < 60) return `${ago}s ago`;
    return `${Math.round(ago / 60)}m ago`;
  })();

  if (loading) {
    return (
      <Card>
        <CardContent className="py-10 flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading Fleety insights…
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">Fleety Learning
          </CardTitle>
          <CardDescription className="flex items-center gap-1 text-xs">
            <Clock className="h-3 w-3" aria-hidden /> Updated {updatedRel} · Last 7 days of Fleety chat signals.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Turns" value={stats.total} />
          <Stat label="Knowledge gaps" value={stats.gaps} icon={<AlertTriangle className="h-3.5 w-3.5 text-warning" />} tone={stats.gaps > 0 ? "warning" : "default"} />
          <Stat label="Thumbs up" value={stats.thumbsUp} icon={<ThumbsUp className="h-3.5 w-3.5 text-success" />} />
          <Stat label="Thumbs down" value={stats.thumbsDown} icon={<ThumbsDown className="h-3.5 w-3.5 text-destructive" />} tone={stats.thumbsDown > 0 ? "warning" : "default"} />
        </CardContent>
      </Card>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList aria-label="Fleety learning sections">
          <TabsTrigger value="cost">Cost</TabsTrigger>
          <TabsTrigger value="gaps">Gaps ({stats.gaps})</TabsTrigger>
          <TabsTrigger value="playbook-gaps">Playbook Gaps ({practicalGaps.length})</TabsTrigger>
          <TabsTrigger value="recent">Recent</TabsTrigger>
          <TabsTrigger value="canned">Canned ({canned.length})</TabsTrigger>
          <TabsTrigger value="proposed">Proposed ({proposed.length})</TabsTrigger>
          <TabsTrigger value="drafts">Drafts ({drafts.length})</TabsTrigger>
          <TabsTrigger value="versions">Prompt Versions ({versions.length})</TabsTrigger>
          <TabsTrigger value="compose">+ Canned Answer</TabsTrigger>
          <TabsTrigger value="practical">Practical Content</TabsTrigger>
        </TabsList>

        <TabsContent value="cost" className="mt-3">
          <FleetyCostPanel />
        </TabsContent>

        <TabsContent value="gaps" className="space-y-2 mt-3">
          {signals.filter((s) => s.kb_hit_count === 0 && s.framework_hit_count === 0).map((s) => (
            <Card key={s.id}>
              <CardContent className="pt-4 flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium break-words">{s.user_query}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {new Date(s.created_at).toLocaleString()} · audience: {s.audience}
                  </p>
                </div>
                <Button size="sm" onClick={() => promoteFromTurn(s)}>Save as canned answer</Button>
              </CardContent>
            </Card>
          ))}
          {stats.gaps === 0 && <p className="text-sm text-muted-foreground">No knowledge gaps in the last 7 days. 🎉</p>}
        </TabsContent>

        <TabsContent value="playbook-gaps" className="space-y-2 mt-3">
          <p className="text-xs text-muted-foreground">
            Operational questions where users didn't take an action within 10 minutes (low practical_score).
            Author or refine a playbook so Fleety gives clearer next steps.
          </p>
          {practicalGaps.map((g) => (
            <Card key={g.id}>
              <CardContent className="pt-4 flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium break-words">{g.user_query}</p>
                  <div className="flex flex-wrap gap-1 mt-2">
                    <Badge variant="outline">score: {g.practical_score?.toFixed(2) ?? "—"}</Badge>
                    <Badge variant="outline">playbooks: {g.playbook_hits}</Badge>
                    <Badge variant="outline">chips clicked: {g.chips_clicked}</Badge>
                    <Badge variant="outline">{g.audience}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{new Date(g.created_at).toLocaleString()}</p>
                </div>
                <Button size="sm" onClick={() => authorPlaybookFromGap(g.user_query)}>Author playbook</Button>
              </CardContent>
            </Card>
          ))}
          {practicalGaps.length === 0 && (
            <p className="text-sm text-muted-foreground">No low-action operational questions in the last 7 days. 🎉</p>
          )}
        </TabsContent>

        <TabsContent value="recent" className="space-y-2 mt-3">
          {signals.slice(0, 50).map((s) => (
            <Card key={s.id}>
              <CardContent className="pt-4 flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm break-words">{s.user_query}</p>
                  <div className="flex flex-wrap gap-1 mt-2">
                    <Badge variant="outline">KB: {s.kb_hit_count}</Badge>
                    <Badge variant="outline">Framework: {s.framework_hit_count}</Badge>
                    <Badge variant="outline">Web: {s.web_hit_count}</Badge>
                    <Badge variant="outline">{s.audience}</Badge>
                    {s.canned_answer_id && <Badge>canned</Badge>}
                  </div>
                </div>
                <Button size="sm" variant="outline" onClick={() => promoteFromTurn(s)}>Promote</Button>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="canned" className="space-y-2 mt-3">
          {canned.map((c) => (
            <Card key={c.id} className={c.enabled ? "" : "opacity-60"}>
              <CardContent className="pt-4 flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold break-words">{c.question_pattern}</p>
                  <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap line-clamp-3">{c.answer_md}</p>
                  <div className="flex gap-1 mt-2">
                    <Badge variant="outline">{c.audience}</Badge>
                    <Badge variant={c.enabled ? "default" : "secondary"}>{c.enabled ? "active" : "disabled"}</Badge>
                  </div>
                </div>
                <Button size="sm" variant="outline" onClick={() => toggleCanned(c)}>
                  {c.enabled ? "Disable" : "Enable"}
                </Button>
              </CardContent>
            </Card>
          ))}
          {canned.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No canned answers yet. Promote a great turn from Recent or Gaps to seed one.
            </p>
          )}
        </TabsContent>

        <TabsContent value="proposed" className="space-y-2 mt-3">
          {proposed.map((p) => (
            <Card key={p.id}>
              <CardContent className="pt-4 flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium break-words">{p.from_entity} → {p.to_entity}</p>
                  <p className="text-xs text-muted-foreground mt-1">{p.description}</p>
                  {p.inverse_description && (
                    <p className="text-xs text-muted-foreground mt-1 italic">↩ {p.inverse_description}</p>
                  )}
                </div>
                <div className="flex gap-1">
                  <Button size="sm" onClick={() => approveRel(p.id)}>
                    <Check className="h-3 w-3 mr-1" /> Approve
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => rejectRel(p.id)}>
                    <X className="h-3 w-3 mr-1" /> Reject
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
          {proposed.length === 0 && <p className="text-sm text-muted-foreground">No pending relationship proposals.</p>}
        </TabsContent>

        <TabsContent value="compose" className="mt-3">
          <Card>
            <CardHeader>
              <CardTitle>Compose canned answer</CardTitle>
              <CardDescription>Saved answers take retrieval priority over the LLM's own writing.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label htmlFor="fleety-pattern">Question pattern (canonical phrasing)</Label>
                <Input
                  id="fleety-pattern"
                  value={draft.pattern}
                  onChange={(e) => setDraft({ ...draft, pattern: e.target.value })}
                  placeholder="e.g. how do I start my first Tech Fleet project"
                />
              </div>
              <div>
                <Label htmlFor="fleety-answer">Answer (markdown)</Label>
                <Textarea
                  id="fleety-answer"
                  value={draft.answer}
                  onChange={(e) => setDraft({ ...draft, answer: e.target.value })}
                  rows={10}
                  placeholder="The exact phrasing Fleety should start from. Include sources and links."
                />
              </div>
              <div className="flex gap-2 items-end">
                <div className="flex-1">
                  <Label htmlFor="fleety-audience">Audience</Label>
                  <select
                    id="fleety-audience"
                    value={draft.audience}
                    onChange={(e) => setDraft({ ...draft, audience: e.target.value })}
                    className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
                  >
                    <option value="all">All</option>
                    <option value="member">Trainee/Member</option>
                    <option value="teacher">Teacher</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <Button onClick={saveCanned}>Save canned answer</Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="drafts" className="space-y-2 mt-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <p className="text-xs text-muted-foreground flex-1 min-w-[240px]">
              Auto-drafted playbooks from the learning loop and the framework bulk drafter
              (uncovered deliverables, milestones, workshops). Approve to make Fleety use them,
              or remove if off-base.
            </p>
            <div className="flex gap-1 flex-wrap">
              <Button size="sm" variant="outline" onClick={() => bulkDraft("deliverable")} disabled={bulkLoading}>
                {bulkLoading ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Sparkles className="h-3 w-3 mr-1" />}
                Draft 5 deliverables
              </Button>
              <Button size="sm" variant="outline" onClick={() => bulkDraft("milestone")} disabled={bulkLoading}>
                {bulkLoading ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Sparkles className="h-3 w-3 mr-1" />}
                Draft 5 milestones
              </Button>
              <Button size="sm" variant="outline" onClick={() => bulkDraft("workshop")} disabled={bulkLoading}>
                {bulkLoading ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Sparkles className="h-3 w-3 mr-1" />}
                Draft 5 workshops
              </Button>
            </div>
          </div>
          {drafts.map((d) => (
            <Card key={d.id}>
              <CardContent className="pt-4 flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold break-words">{d.title}</p>
                  <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap line-clamp-3">{d.direct_answer}</p>
                  <div className="flex flex-wrap gap-1 mt-2">
                    <Badge variant="outline">{d.intent}</Badge>
                    <Badge variant="outline">{d.audience}</Badge>
                    <Badge variant="secondary">draft</Badge>
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button size="sm" onClick={() => approveDraft(d)}>
                    <Check className="h-3 w-3 mr-1" /> Approve
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => rejectDraft(d)}>
                    <X className="h-3 w-3 mr-1" /> Discard
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
          {drafts.length === 0 && <p className="text-sm text-muted-foreground">No playbook drafts pending.</p>}
        </TabsContent>

        <TabsContent value="versions" className="space-y-2 mt-3">
          <p className="text-xs text-muted-foreground">
            Prompt versions are weighted-randomly assigned at request time. Default is the safe fallback when no
            version is sampled. Each turn in <code>fleety_signals_view</code> is tagged with its version for A/B analysis.
          </p>
          {versions.map((v) => (
            <Card key={v.id} className={v.is_default ? "border-primary/40" : ""}>
              <CardContent className="pt-4 flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold break-words">{v.label}</p>
                  {v.notes && <p className="text-xs text-muted-foreground mt-1">{v.notes}</p>}
                  <div className="flex flex-wrap gap-1 mt-2">
                    {v.is_default && <Badge>default</Badge>}
                    <Badge variant="outline">weight: {v.weight}</Badge>
                  </div>
                </div>
                <div className="flex gap-1 items-center">
                  <Label htmlFor={`w-${v.id}`} className="text-xs">Weight</Label>
                  <Input
                    id={`w-${v.id}`}
                    type="number"
                    min={0}
                    defaultValue={v.weight}
                    className="h-8 w-20"
                    onBlur={(e) => {
                      const n = parseInt(e.target.value, 10);
                      if (!Number.isNaN(n) && n !== v.weight) updateWeight(v, n);
                    }}
                  />
                  {!v.is_default && (
                    <Button size="sm" variant="outline" onClick={() => setDefaultVersion(v)}>
                      Set default
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
          {versions.length === 0 && <p className="text-sm text-muted-foreground">No prompt versions configured.</p>}
        </TabsContent>

        <TabsContent value="practical" className="mt-3">
          <FleetyPlaybooksManager />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Stat({ label, value, icon, tone = "default" }: { label: string; value: number; icon?: React.ReactNode; tone?: "default" | "warning" }) {
  const toneClass = tone === "warning" ? "border-warning/40" : "";
  return (
    <Card className={toneClass}>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground flex items-center gap-1">{icon}{label}</p>
        <p className="mt-1 text-2xl font-bold text-foreground">{value}</p>
      </CardContent>
    </Card>
  );
}
