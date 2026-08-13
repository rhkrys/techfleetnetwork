// Admin Hand-Off Production — produce or review a hand-off for ANY project.
// The produce edge function + RLS already grant admins access to any project; this page is just the
// surface: pick a project + phase, then render the same HandoffPanel members use. Admins are subject
// to the SAME team budget (1 production + 1 retry) — no cost bypass.
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { useQuery } from "@/lib/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { HandoffPanel } from "@/components/HandoffPanel";

interface AdminProjectRow {
  id: string;
  phase: string;
  project_status: string;
  clients: { name: string } | null;
}

const PHASES: { value: string; label: string }[] = [
  { value: "phase_1", label: "Phase 1" },
  { value: "phase_2", label: "Phase 2" },
  { value: "phase_3", label: "Phase 3" },
  { value: "phase_4", label: "Phase 4" },
];

const PROJECT_STATUS_LABEL: Record<string, string> = {
  coming_soon: "Coming soon",
  apply_now: "Apply now",
  recruiting: "Recruiting",
  team_onboarding: "Onboarding",
  project_in_progress: "In progress",
  project_complete: "Complete",
};

export default function HandoffAdminPage() {
  const projects = useQuery({
    queryKey: ["admin-handoff-projects"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("id, phase, project_status, clients(name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as AdminProjectRow[];
    },
  });

  const [projectId, setProjectId] = useState("");
  const [phaseOverride, setPhaseOverride] = useState("");
  const selected = projects.data?.find((p) => p.id === projectId);
  const phase = phaseOverride || selected?.phase || "phase_1";

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">Hand-Off Production — admin</h1>
        <p className="text-muted-foreground">
          Produce or review a hand-off for any project — including <strong>completed</strong> ones
          (hand-offs are often finished after a project ends). You use the same tools and the same
          team budget (one production plus one re-create) as an active teammate.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pick a project and phase</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          {projects.isLoading ? (
            <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden="true" />
          ) : (
            <>
              <div className="w-72">
                <Select value={projectId} onValueChange={setProjectId}>
                  <SelectTrigger aria-label="Project">
                    <SelectValue placeholder="Select a project…" />
                  </SelectTrigger>
                  <SelectContent>
                    {(projects.data ?? []).map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.clients?.name ?? p.id.slice(0, 8)} · {p.phase} ·{" "}
                        {PROJECT_STATUS_LABEL[p.project_status] ?? p.project_status}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="w-40">
                <Select value={phase} onValueChange={setPhaseOverride} disabled={!projectId}>
                  <SelectTrigger aria-label="Phase">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PHASES.map((ph) => (
                      <SelectItem key={ph.value} value={ph.value}>
                        {ph.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {projectId ? (
        <HandoffPanel projectId={projectId} phase={phase} />
      ) : (
        <p className="text-sm text-muted-foreground">
          Select a project above to open its Hand-Off Center.
        </p>
      )}
    </div>
  );
}
