import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@/lib/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Badge } from "@/design-system";

import { Loader2, Target, Users, FolderKanban, BarChart3, ArrowRight } from "lucide-react";
import { PROJECT_TYPES, PROJECT_PHASES } from "@/data/project-constants";

const typeLabel = (v: string) => PROJECT_TYPES.find((t) => t.value === v)?.label ?? v;
const phaseLabel = (v: string) => PROJECT_PHASES.find((p) => p.value === v)?.label ?? v;

interface ProjectWithClient {
  id: string;
  project_type: string;
  phase: string;
  project_status: string;
  team_hats: string[];
  client_id: string;
  friendly_name?: string;
  clients: { name: string } | null;
}

export default function AdminRosterPage() {
  // Admin access is enforced by AdminRoute wrapper
  const { user } = useAuth();
  const navigate = useNavigate();

  const { data: projects, isLoading: projLoading } = useQuery({
    queryKey: ["recruiting-all-projects"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select(
          "id, project_type, phase, project_status, team_hats, client_id, friendly_name, clients(name)"
        )
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as ProjectWithClient[];
    },
    enabled: !!user,
  });

  const sortedProjects = useMemo(() => {
    if (!projects) return [];
    return [...projects].sort((a, b) => {
      const nameCompare = (a.clients?.name ?? "").localeCompare(b.clients?.name ?? "");
      if (nameCompare !== 0) return nameCompare;
      return a.phase.localeCompare(b.phase);
    });
  }, [projects]);

  const { data: appCounts } = useQuery({
    queryKey: ["recruiting-all-app-counts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_applications")
        .select("project_id, id")
        .eq("status", "completed");
      if (error) throw error;
      const counts = new Map<string, number>();
      for (const row of data ?? []) {
        counts.set(row.project_id, (counts.get(row.project_id) ?? 0) + 1);
      }
      return counts;
    },
    enabled: !!user,
  });

  if (projLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="container-app py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">Recruiting Center</h1>
        <p className="text-muted-foreground mt-1">
          Select a project to view application analysis and manage the team roster.
        </p>
      </div>

      {sortedProjects.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <FolderKanban className="h-12 w-12 mx-auto mb-4 opacity-40" aria-hidden="true" />
          <p className="text-lg font-medium">No projects yet</p>
          <p className="text-sm mt-1">
            Create projects from Clients and Projects to see them here.
          </p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {sortedProjects.map((project) => {
            const count = appCounts?.get(project.id) ?? 0;
            const isApplyNow = project.project_status === "apply_now";
            return (
              <button
                key={project.id}
                onClick={() => navigate(`/admin/roster/project/${project.id}`)}
                className="group rounded-lg border bg-card p-5 hover:shadow-md transition-shadow duration-200 flex flex-col text-left"
              >
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="h-9 w-9 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                    <BarChart3 className="h-4 w-4 text-primary" aria-hidden />
                  </div>
                  <div className="flex items-center gap-1.5">
                    {isApplyNow && (
                      <Badge variant="default" className="text-[10px] px-1.5 py-0 h-5">
                        Accepting Apps
                      </Badge>
                    )}
                    <Badge variant="secondary" className="text-xs">
                      {phaseLabel(project.phase)}
                    </Badge>
                  </div>
                </div>

                <h3 className="text-base font-semibold text-foreground mb-1">
                  {project.clients?.name ?? "Unknown Client"}
                  {project.friendly_name?.trim() && (
                    <span className="text-muted-foreground font-medium">
                      {" "}
                      — {project.friendly_name}
                    </span>
                  )}
                </h3>
                <p className="text-sm text-muted-foreground mb-3">
                  {typeLabel(project.project_type)}
                </p>

                <div className="flex items-center gap-4 text-sm text-muted-foreground mt-auto mb-3">
                  <span className="flex items-center gap-1.5">
                    <Users className="h-3.5 w-3.5" />
                    {count} {count === 1 ? "applicant" : "applicants"}
                  </span>
                  <span>{project.team_hats.length} hats</span>
                </div>

                <div className="flex items-center gap-1 text-sm font-medium text-primary group-hover:gap-2 transition-all">
                  View Details
                  <ArrowRight className="h-4 w-4" />
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
