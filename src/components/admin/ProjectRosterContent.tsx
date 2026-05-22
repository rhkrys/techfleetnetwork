import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@/lib/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAdmin } from "@/hooks/use-admin";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, FolderKanban } from "lucide-react";
import { ThemedAgGrid } from "@/components/AgGrid";
import { format } from "date-fns";
import type { ColDef, ICellRendererParams } from "ag-grid-community";
import { applicantStatusLabel } from "@/components/admin/ApplicantStatusDropdown";
import { AgreementResendButton } from "@/components/agreements/AgreementResendButton";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CompletedCoursesPanel } from "@/components/admin/CompletedCoursesPanel";
import { useCourseCatalogPrep } from "@/hooks/use-course-catalog-prep";

interface ProfileRow {
  user_id: string;
  display_name: string;
  first_name: string;
  last_name: string;
  email: string;
}

interface AppRow {
  id: string;
  user_id: string;
  project_id: string;
  status: string;
  applicant_status: string;
  team_hats_interest: string[];
  completed_at: string | null;
  created_at: string;
  community_agreement_required_at: string | null;
  community_agreement_signed_at: string | null;
}

interface EnrichedApp extends AppRow {
  applicantName: string;
  applicantFirstName: string;
  applicantEmail: string;
  hats: string;
  agreementStatus: "not_required" | "pending" | "signed";
}

interface ProjectRosterContentProps {
  projectId: string;
}

export default function ProjectRosterContent({ projectId }: ProjectRosterContentProps) {
  const { user } = useAuth();
  const { isAdmin } = useAdmin();
  const navigate = useNavigate();

  const { data: apps, isLoading: appsLoading } = useQuery({
    queryKey: ["roster-project-apps", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_applications")
        .select("id, user_id, project_id, status, applicant_status, team_hats_interest, completed_at, created_at, community_agreement_required_at, community_agreement_signed_at")
        .eq("project_id", projectId)
        .eq("status", "completed");
      if (error) throw error;
      return (data ?? []) as unknown as AppRow[];
    },
    enabled: !!projectId && !!user && isAdmin,
  });

  const userIds = useMemo(
    () => [...new Set((apps ?? []).map((a) => a.user_id))],
    [apps]
  );

  const { data: profiles } = useQuery({
    queryKey: ["roster-project-profiles", userIds],
    queryFn: async () => {
      if (userIds.length === 0) return [];
      const { data, error } = await supabase
        .from("profiles")
        .select("user_id, display_name, first_name, last_name, email")
        .in("user_id", userIds);
      if (error) throw error;
      return (data ?? []) as ProfileRow[];
    },
    enabled: userIds.length > 0,
  });

  const profileMap = useMemo(() => {
    const m = new Map<string, ProfileRow>();
    for (const p of profiles ?? []) m.set(p.user_id, p);
    return m;
  }, [profiles]);

  const enrichedApps = useMemo<EnrichedApp[]>(() => {
    return (apps ?? []).map((app) => {
      const profile = profileMap.get(app.user_id);
      const agreementStatus: EnrichedApp["agreementStatus"] = !app.community_agreement_required_at
        ? "not_required"
        : app.community_agreement_signed_at
          ? "signed"
          : "pending";
      return {
        ...app,
        applicantName: profile?.display_name || `${profile?.first_name ?? ""} ${profile?.last_name ?? ""}`.trim() || "Unknown",
        applicantFirstName: profile?.first_name ?? "",
        applicantEmail: profile?.email ?? "",
        hats: app.team_hats_interest.join(", "),
        agreementStatus,
      };
    });
  }, [apps, profileMap]);

  const ViewCellRenderer = useMemo(() => {
    const Renderer = (params: ICellRendererParams<EnrichedApp>) => (
      <button
        className="text-sm font-medium text-primary hover:underline"
        onClick={() => navigate(`/admin/roster/project/${projectId}/applicant/${params.data!.id}`)}
      >
        View
      </button>
    );
    Renderer.displayName = "ViewCellRenderer";
    return Renderer;
  }, [navigate, projectId]);

  const AgreementCellRenderer = useMemo(() => {
    const Renderer = (params: ICellRendererParams<EnrichedApp>) => {
      const row = params.data!;
      if (row.agreementStatus === "not_required") {
        return <span className="text-xs text-muted-foreground">—</span>;
      }
      if (row.agreementStatus === "signed") {
        return (
          <Badge variant="outline" className="border-emerald-500/40 text-emerald-700 dark:text-emerald-300">
            Signed {row.community_agreement_signed_at ? format(new Date(row.community_agreement_signed_at), "MMM d, yyyy") : ""}
          </Badge>
        );
      }
      return (
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-300">
            Pending{row.community_agreement_required_at ? ` since ${format(new Date(row.community_agreement_required_at), "MMM d")}` : ""}
          </Badge>
          <AgreementResendButton applicationId={row.id} />
        </div>
      );
    };
    Renderer.displayName = "AgreementCellRenderer";
    return Renderer;
  }, []);

  const columnDefs = useMemo<ColDef<EnrichedApp>[]>(() => [
    { headerName: "Applicant", field: "applicantName", flex: 2, minWidth: 150, filter: true },
    { headerName: "Email", field: "applicantEmail", flex: 2, minWidth: 180, filter: true },
    { headerName: "Hats of Interest", field: "hats", flex: 2.5, minWidth: 200, filter: true },
    {
      headerName: "Status", field: "applicant_status", flex: 1.5, minWidth: 140, filter: true,
      valueFormatter: (p) => applicantStatusLabel(p.value ?? "pending_review"),
    },
    {
      headerName: "Agreement", field: "agreementStatus", flex: 1.6, minWidth: 220, filter: true,
      cellRenderer: AgreementCellRenderer,
    },
    {
      headerName: "Submitted", field: "completed_at", flex: 1.2, minWidth: 130,
      valueFormatter: (p) => p.value ? format(new Date(p.value), "MMM d, yyyy") : "—",
    },
    {
      headerName: "", field: "id", width: 80, pinned: "right", sortable: false, filter: false,
      cellRenderer: ViewCellRenderer,
    },
  ], [ViewCellRenderer, AgreementCellRenderer]);

  if (appsLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-primary" aria-label="Loading" />
      </div>
    );
  }

  return (
    <Card>
      <CardContent className="pt-6">
        {enrichedApps.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <FolderKanban className="h-10 w-10 mx-auto mb-3 opacity-40" aria-hidden="true" />
            <p className="text-sm">No completed applications for this project yet.</p>
          </div>
        ) : (
          <ThemedAgGrid<EnrichedApp>
            gridId={`roster-detail-${projectId}`}
            height={enrichedApps.length <= 5 ? "360px" : "640px"}
            rowData={enrichedApps}
            columnDefs={columnDefs}
            getRowId={(p) => p.data.id}
            pagination
            paginationPageSize={15}
            showExportCsv
            exportFileName={`roster-${projectId}`}
            hideResetButton
          />
        )}
      </CardContent>
    </Card>
  );
}
