import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Loader2, Plus } from "lucide-react";
import { format } from "date-fns";
import type { ColDef, ICellRendererParams, GridApi } from "ag-grid-community";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ThemedAgGrid } from "@/components/AgGrid";
import { useAllClasses } from "@/hooks/use-classes";
import { stripHtml } from "@/lib/strip-html";
import { ClassService, type ClassRow } from "@/services/class.service";
import { RequestChangesDialog } from "@/components/classes/RequestChangesDialog";
import { ArchiveDialog } from "@/components/classes/ArchiveDialog";
import { toast } from "sonner";
import { useQueryClient } from "@/lib/react-query";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const STATUS_FILTERS = [
  { value: "pending_review", label: "Pending review" },
  { value: "draft", label: "Drafts" },
  { value: "published", label: "Published" },
  { value: "archived", label: "Archived" },
  { value: "all", label: "All" },
] as const;

const STATUS_PILL: Record<string, string> = {
  draft: "bg-muted text-muted-foreground border-muted-foreground/20",
  pending_review: "bg-warning/10 text-warning border-warning/30",
  published: "bg-success/10 text-success border-success/30",
  archived: "bg-muted text-muted-foreground border-muted-foreground/20",
};

export default function AdminClassesPage() {
  const { data: classes = [], isLoading } = useAllClasses();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<(typeof STATUS_FILTERS)[number]["value"]>("pending_review");
  const [denyTarget, setDenyTarget] = useState<ClassRow | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<ClassRow | null>(null);
  const [approveTarget, setApproveTarget] = useState<ClassRow | null>(null);
  const [busy, setBusy] = useState(false);

  const counts = useMemo(() => {
    const c: Record<string, number> = {
      all: classes.length,
      pending_review: 0,
      draft: 0,
      published: 0,
      archived: 0,
    };
    for (const cls of classes) c[cls.status] = (c[cls.status] ?? 0) + 1;
    return c;
  }, [classes]);

  const filtered = useMemo(() => {
    return classes.filter((c) => {
      if (status !== "all" && c.status !== status) return false;
      if (!q.trim()) return true;
      const t = q.toLowerCase();
      return c.title.toLowerCase().includes(t) || stripHtml(c.summary).toLowerCase().includes(t);
    });
  }, [classes, q, status]);

  const approve = async () => {
    if (!approveTarget) return;
    setBusy(true);
    try {
      await ClassService.approveAndPublish(approveTarget.id);
      toast.success("Class published");
      queryClient.invalidateQueries({ queryKey: ["classes"] });
      setApproveTarget(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to approve");
    } finally {
      setBusy(false);
    }
  };

  const columnDefs = useMemo<ColDef<ClassRow>[]>(
    () => [
      {
        headerName: "Title",
        field: "title",
        flex: 2,
        minWidth: 200,
        cellRenderer: (p: ICellRendererParams<ClassRow>) => {
          if (!p.data) return null;
          return (
            <a
              href={`/teach/classes/${p.data.id}`}
              onClick={(e) => {
                e.preventDefault();
                navigate(`/teach/classes/${p.data!.id}`);
              }}
              className="text-primary hover:underline font-medium"
            >
              {p.data.title}
            </a>
          );
        },
      },
      {
        headerName: "Track",
        field: "track",
        minWidth: 130,
        valueFormatter: (p) => (p.value === "basic_training" ? "Basic" : "Advanced"),
      },
      {
        headerName: "Status",
        field: "status",
        minWidth: 140,
        cellRenderer: (p: ICellRendererParams<ClassRow>) => {
          const s = p.value as string;
          return (
            <Badge variant="outline" className={STATUS_PILL[s] ?? ""}>
              {s.replace("_", " ")}
            </Badge>
          );
        },
      },
      {
        headerName: "Submitted",
        field: "submitted_at",
        minWidth: 140,
        sort: "desc",
        valueFormatter: (p) => (p.value ? format(new Date(p.value), "MMM d, yyyy") : "—"),
      },
      {
        headerName: "Updated",
        field: "updated_at",
        minWidth: 130,
        valueFormatter: (p) => format(new Date(p.value), "MMM d, yyyy"),
      },
      {
        headerName: "Actions",
        colId: "actions",
        sortable: false,
        filter: false,
        resizable: false,
        minWidth: 280,
        cellRenderer: (p: ICellRendererParams<ClassRow>) => {
          if (!p.data) return null;
          const c = p.data;
          return (
            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                variant="ghost"
                onClick={(e) => {
                  e.stopPropagation();
                  navigate(`/teach/classes/${c.id}`);
                }}
              >
                Review
              </Button>
              {c.status === "pending_review" && (
                <>
                  <Button
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      setApproveTarget(c);
                    }}
                  >
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDenyTarget(c);
                    }}
                  >
                    Changes
                  </Button>
                </>
              )}
              {c.status !== "archived" && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={(e) => {
                    e.stopPropagation();
                    setArchiveTarget(c);
                  }}
                >
                  Archive
                </Button>
              )}
            </div>
          );
        },
      },
    ],
    [navigate]
  );

  return (
    <div className="container-app py-8 sm:py-12 space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">All Classes</h1>
          <p className="text-muted-foreground mt-1">
            Review submissions, approve, request changes, and manage published classes.
          </p>
        </div>
        <Button asChild className="self-start sm:self-auto">
          <Link to="/teach/classes/new" aria-label="Create a new class">
            <Plus className="h-4 w-4 mr-1.5" aria-hidden="true" />
            New Class
          </Link>
        </Button>
      </div>

      <div
        className="flex flex-wrap items-center gap-2"
        role="tablist"
        aria-label="Filter classes by status"
      >
        {STATUS_FILTERS.map((f) => {
          const active = status === f.value;
          const n = counts[f.value] ?? 0;
          return (
            <button
              key={f.value}
              role="tab"
              aria-selected={active}
              onClick={() => setStatus(f.value)}
              className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                active
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card text-foreground border-border hover:bg-muted"
              }`}
            >
              {f.label}
              <span className={`ml-1.5 text-xs ${active ? "opacity-90" : "text-muted-foreground"}`}>
                ({n})
              </span>
            </button>
          );
        })}
        <Input
          placeholder="Search classes…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-xs ml-auto"
          aria-label="Search classes"
        />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : (
        <ThemedAgGrid<ClassRow>
          gridId="admin-classes"
          height="600px"
          rowData={filtered}
          columnDefs={columnDefs}
          getRowId={(p) => p.data.id}
          pagination
          paginationPageSize={25}
          showExportCsv
          exportFileName="classes-admin"
          disableCellCopy
        />
      )}

      <RequestChangesDialog
        classId={denyTarget?.id ?? ""}
        open={!!denyTarget}
        onOpenChange={(o) => !o && setDenyTarget(null)}
      />
      <ArchiveDialog
        classId={archiveTarget?.id ?? ""}
        open={!!archiveTarget}
        onOpenChange={(o) => !o && setArchiveTarget(null)}
      />
      <AlertDialog
        open={!!approveTarget}
        onOpenChange={(o) => !busy && !o && setApproveTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Approve & publish "{approveTarget?.title}"?</AlertDialogTitle>
            <AlertDialogDescription>
              The class becomes visible in{" "}
              {approveTarget?.track === "basic_training" ? "Basic" : "Advanced"} Training, and any
              cohorts pending review will go live too.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                approve();
              }}
              disabled={busy}
            >
              {busy && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              Approve & publish
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
