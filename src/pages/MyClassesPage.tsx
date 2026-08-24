import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, GraduationCap, Loader2, AlertTriangle } from "lucide-react";
import { format } from "date-fns";
import type { ColDef, ICellRendererParams } from "ag-grid-community";
import { Badge, Button } from "@/design-system";

import { ThemedAgGrid } from "@/components/AgGrid";
import { useMyClasses } from "@/hooks/use-classes";
import { ClassService, type ClassRow } from "@/services/class.service";
import { PreSubmitChecklist } from "@/components/classes/PreSubmitChecklist";
import { useQuery } from "@/lib/react-query";

const STATUS_FILTERS = [
  { value: "attention", label: "Needs your attention" },
  { value: "pending_review", label: "Pending review" },
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

function ChangesRequestedChip({ classId }: { classId: string }) {
  const { data = [] } = useQuery({
    queryKey: ["classes", "audit", classId] as const,
    queryFn: () => ClassService.listAuditHistory(classId),
  });
  const reason = data.find((d) => d.action === "request_changes")?.reason;
  if (!reason) return null;
  return (
    <Badge
      variant="outline"
      className="bg-warning/10 text-warning border-warning/30 cursor-help"
      title={reason}
    >
      <AlertTriangle className="h-3 w-3 mr-1" aria-hidden="true" />
      Changes requested
    </Badge>
  );
}

export default function MyClassesPage() {
  const { data: classes = [], isLoading } = useMyClasses();
  const navigate = useNavigate();
  const [status, setStatus] = useState<(typeof STATUS_FILTERS)[number]["value"]>("attention");
  const [submitTarget, setSubmitTarget] = useState<ClassRow | null>(null);

  const counts = useMemo(() => {
    const c: Record<string, number> = {
      all: classes.length,
      pending_review: 0,
      published: 0,
      archived: 0,
      attention: 0,
    };
    for (const cls of classes) {
      c[cls.status] = (c[cls.status] ?? 0) + 1;
      if (cls.status === "draft") c.attention += 1;
    }
    return c;
  }, [classes]);

  const filtered = useMemo(() => {
    return classes.filter((c) => {
      if (status === "all") return true;
      if (status === "attention") return c.status === "draft";
      return c.status === status;
    });
  }, [classes, status]);

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
            <div className="flex items-center gap-2">
              <a
                href={`/teach/classes/${p.data.id}`}
                onClick={(e) => {
                  e.preventDefault();
                  navigate(`/teach/classes/${p.data!.id}`);
                }}
                className="text-primary hover:underline font-medium truncate"
              >
                {p.data.title}
              </a>
              {p.data.status === "draft" && <ChangesRequestedChip classId={p.data.id} />}
            </div>
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
        valueFormatter: (p) => (p.value ? format(new Date(p.value), "MMM d, yyyy") : "—"),
      },
      {
        headerName: "Published",
        field: "published_at",
        minWidth: 140,
        valueFormatter: (p) => (p.value ? format(new Date(p.value), "MMM d, yyyy") : "—"),
      },
      {
        headerName: "Updated",
        field: "updated_at",
        minWidth: 130,
        sort: "desc",
        valueFormatter: (p) => format(new Date(p.value), "MMM d, yyyy"),
      },
      {
        headerName: "Actions",
        colId: "actions",
        sortable: false,
        filter: false,
        resizable: false,
        minWidth: 220,
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
                  navigate(`/teach/classes/${c.id}/edit`);
                }}
              >
                Edit
              </Button>
              {c.status === "draft" && (
                <Button
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSubmitTarget(c);
                  }}
                >
                  Submit
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">My Classes</h1>
          <p className="text-muted-foreground mt-1">
            Author, publish, and manage classes and their cohorts.
          </p>
        </div>
        <Button asChild>
          <Link to="/teach/classes/new">
            <Plus className="h-4 w-4 mr-2" aria-hidden="true" />
            New Class
          </Link>
        </Button>
      </div>

      {classes.length > 0 && (
        <div
          className="flex flex-wrap items-center gap-2"
          role="tablist"
          aria-label="Filter your classes"
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
                <span
                  className={`ml-1.5 text-xs ${active ? "opacity-90" : "text-muted-foreground"}`}
                >
                  ({n})
                </span>
              </button>
            );
          })}
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : classes.length === 0 ? (
        <div className="rounded-lg border bg-card p-10 text-center">
          <GraduationCap
            className="h-10 w-10 mx-auto text-muted-foreground mb-3"
            aria-hidden="true"
          />
          <p className="text-muted-foreground">You have not created any classes yet.</p>
          <Button asChild className="mt-4">
            <Link to="/teach/classes/new">Create your first class</Link>
          </Button>
        </div>
      ) : (
        <ThemedAgGrid<ClassRow>
          gridId="my-classes"
          height="600px"
          rowData={filtered}
          columnDefs={columnDefs}
          getRowId={(p) => p.data.id}
          pagination
          paginationPageSize={25}
          showExportCsv
          exportFileName="my-classes"
          disableCellCopy
        />
      )}

      {submitTarget && (
        <PreSubmitChecklist
          cls={submitTarget}
          open={!!submitTarget}
          onOpenChange={(o) => !o && setSubmitTarget(null)}
        />
      )}
    </div>
  );
}
