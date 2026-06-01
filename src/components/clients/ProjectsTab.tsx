import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@/lib/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Plus, Pencil, Trash2, Loader2, FolderKanban,
  LayoutGrid, List,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { format } from "date-fns";
import {
  PROJECT_TYPES, PROJECT_PHASES, PROJECT_STATUSES,
} from "@/data/project-constants";
import { useMilestoneReference, computeMilestoneData } from "@/hooks/use-milestone-reference";
import type { Client } from "@/components/clients/ClientsTab";
import { ThemedAgGrid } from "@/components/AgGrid";
import type { ColDef } from "ag-grid-community";

interface Project {
  id: string;
  client_id: string;
  project_type: string;
  phase: string;
  team_hats: string[];
  project_status: string;
  current_phase_milestones: string[];
  friendly_name?: string;
  description?: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export function ProjectsTab() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [view, setView] = useState<"table" | "card">("card");
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);

  const { data: clients = [] } = useQuery({
    queryKey: ["clients"],
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("*").order("name");
      if (error) throw error;
      return (data ?? []) as unknown as Client[];
    },
  });

  const clientMap = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients]);

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: async () => {
      const { data, error } = await supabase.from("projects").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Project[];
    },
  });

  const { data: milestoneRefs = [] } = useMilestoneReference();

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("projects").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["projects"] }); toast.success("Project deleted."); setDeleteTarget(null); },
    onError: (err: Error) => toast.error(err.message),
  });

  const typeLabel = (v: string) => PROJECT_TYPES.find((t) => t.value === v)?.label ?? v;
  const phaseLabel = (v: string) => PROJECT_PHASES.find((p) => p.value === v)?.label ?? v;
  const statusLabel = (v: string) => PROJECT_STATUSES.find((s) => s.value === v)?.label ?? v;

  const statusBadgeColor = (status: string) => {
    switch (status) {
      case "project_complete": return "bg-success/10 text-success border-success/20";
      case "project_in_progress": return "bg-primary/10 text-primary border-primary/20";
      case "apply_now": case "recruiting": return "bg-warning/10 text-warning border-warning/20";
      default: return "";
    }
  };

  const columnDefs = useMemo<ColDef<Project>[]>(() => [
    {
      headerName: "Client",
      flex: 2,
      valueGetter: (params) => {
        const clientName = clientMap.get(params.data?.client_id ?? "")?.name ?? "Unknown";
        const nick = params.data?.friendly_name?.trim();
        return nick ? `${clientName} — ${nick}` : clientName;
      },
    },
    {
      headerName: "Type",
      flex: 1,
      valueGetter: (params) => typeLabel(params.data?.project_type ?? ""),
    },
    {
      headerName: "Phase",
      flex: 1,
      valueGetter: (params) => phaseLabel(params.data?.phase ?? ""),
    },
    {
      headerName: "Status",
      flex: 1,
      valueGetter: (params) => statusLabel(params.data?.project_status ?? ""),
    },
    {
      headerName: "Team Hats",
      flex: 2,
      valueGetter: (params) => (params.data?.team_hats ?? []).join(", "),
    },
    {
      headerName: "Updated",
      flex: 1,
      minWidth: 110,
      valueGetter: (params) => params.data?.updated_at,
      valueFormatter: (params) => params.value ? format(new Date(params.value), "MMM d, yyyy") : "—",
    },
  ], [clientMap]);

  if (isLoading) return <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <p className="text-muted-foreground">Manage projects across clients.</p>
        <div className="flex items-center gap-2">
          <div className="flex border rounded-md overflow-hidden">
            <Button variant={view === "card" ? "default" : "ghost"} size="sm" onClick={() => setView("card")} aria-label="Card view"><LayoutGrid className="h-4 w-4" /></Button>
            <Button variant={view === "table" ? "default" : "ghost"} size="sm" onClick={() => setView("table")} aria-label="Table view"><List className="h-4 w-4" /></Button>
          </div>
          <Button onClick={() => navigate("/admin/clients/projects/new")}><Plus className="h-4 w-4 mr-1" /> Add Project</Button>
        </div>
      </div>

      {projects.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <FolderKanban className="h-12 w-12 mx-auto mb-4 opacity-40" />
          <p className="text-lg font-medium">No projects yet</p>
          <p className="text-sm mt-1">Click "Add Project" to create your first project.</p>
        </div>
      ) : view === "table" ? (
        <ThemedAgGrid<Project>
          gridId="admin-projects"
          height="450px"
          rowData={projects}
          columnDefs={columnDefs}
          getRowId={(params) => params.data.id}
          onRowClicked={(params) => params.data && navigate(`/admin/clients/projects/${params.data.id}/edit`)}
          rowStyle={{ cursor: "pointer" }}
          pagination
          paginationPageSize={20}
          showExportCsv
          exportFileName="projects"
        />
      ) : (
        <div className="grid grid-cols-12 gap-4">
          {projects.map((p) => {
            const client = clientMap.get(p.client_id);
            const projComputed = computeMilestoneData(p.current_phase_milestones, milestoneRefs);
            const sectionLabel = "text-base font-semibold uppercase tracking-wider text-muted-foreground";
            return (
              <div key={p.id} className="col-span-12 xl:col-span-6">
                <Card data-card="project" className="flex flex-col h-full p-6">
                  {/* Identity block — status, client + project, type */}
                  <div className="space-y-3">
                    <Badge className={`${statusBadgeColor(p.project_status)} px-3 py-1.5 text-base font-semibold uppercase tracking-wide`}>
                      {statusLabel(p.project_status)}
                    </Badge>
                    <div className="space-y-1.5">
                      <h3 className="text-2xl font-bold text-foreground leading-tight">
                        {client?.name ?? "Unknown"}
                      </h3>
                      {p.friendly_name?.trim() && (
                        <p className="text-xl font-medium text-muted-foreground leading-snug">{p.friendly_name}</p>
                      )}
                    </div>
                    <p className="text-base font-semibold uppercase tracking-wider text-muted-foreground">
                      {typeLabel(p.project_type)}
                    </p>
                  </div>

                  {/* Meta sections */}
                  <div className="mt-5 pt-5 border-t space-y-5 flex-1">
                    <div className="space-y-1.5">
                      <p className={sectionLabel}>Phase</p>
                      <p className="text-base text-foreground">{phaseLabel(p.phase)}</p>
                    </div>

                    {p.description?.trim() && (
                      <div className="space-y-1.5">
                        <p className={sectionLabel}>Description</p>
                        <p className="text-base text-foreground whitespace-pre-wrap leading-relaxed line-clamp-3">{p.description}</p>
                      </div>
                    )}

                    {p.team_hats.length > 0 && (
                      <div className="space-y-1.5">
                        <p className={sectionLabel}>Team Hats</p>
                        <div className="flex flex-wrap gap-1.5">
                          {p.team_hats.map((h) => (
                            <Badge key={h} variant="outline" className="text-base font-normal px-2.5 py-0.5">{h}</Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    {p.current_phase_milestones.length > 0 && (
                      <div className="space-y-1.5">
                        <p className={sectionLabel}>Milestones</p>
                        <div className="flex flex-wrap gap-1.5">
                          {p.current_phase_milestones.map((m) => (
                            <Badge key={m} variant="secondary" className="text-base font-normal px-2.5 py-0.5">{m}</Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    {projComputed.deliverables.length > 0 && (
                      <div className="space-y-1.5">
                        <p className={sectionLabel}>Deliverables</p>
                        <div className="flex flex-wrap gap-1.5">
                          {projComputed.deliverables.slice(0, 6).map((d) => (
                            <Badge key={d} variant="outline" className="text-base font-normal px-2.5 py-0.5 bg-accent/50">{d}</Badge>
                          ))}
                          {projComputed.deliverables.length > 6 && (
                            <Badge variant="outline" className="text-base font-normal px-2.5 py-0.5">+{projComputed.deliverables.length - 6}</Badge>
                          )}
                        </div>
                      </div>
                    )}

                    <div className="space-y-1.5">
                      <p className={sectionLabel}>Updated</p>
                      <p className="text-base text-foreground">{format(new Date(p.updated_at), "MMM d, yyyy")}</p>
                    </div>
                  </div>

                  {/* Footer — full-width primary edit + secondary delete */}
                  <div className="mt-5 pt-5 border-t flex items-center gap-2">
                    <Button type="button" className="flex-1" onClick={() => navigate(`/admin/clients/projects/${p.id}/edit`)}>
                      Edit project
                    </Button>
                    <Button type="button" variant="outline" size="icon" onClick={() => setDeleteTarget(p)} aria-label="Delete project">
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </Card>
              </div>
            );
          })}
        </div>
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this project?</AlertDialogTitle>
            <AlertDialogDescription>This action cannot be undone. The project record will be permanently removed.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)} disabled={deleteMutation.isPending} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleteMutation.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
