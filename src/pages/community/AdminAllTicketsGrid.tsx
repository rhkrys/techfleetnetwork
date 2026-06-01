import { useMemo, useState } from "react";
import { useQuery } from "@/lib/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ThemedAgGrid } from "@/components/AgGrid";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type { ColDef } from "ag-grid-community";

interface Row {
  id: number;
  number?: number;
  subject?: string;
  status?: string;
  customer?: { id: number; email?: string };
  assignee?: { id: number; firstName?: string; lastName?: string } | null;
  createdAt?: string;
  updatedAt?: string;
}

export default function AdminAllTicketsGrid() {
  const [refreshKey, setRefreshKey] = useState(0);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["support", "admin-all", refreshKey] as const,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("freescout-proxy", {
        body: { action: "listAll", status: "all", page: 1 },
      });
      if (error) throw error;
      return (data?.items ?? []) as Row[];
    },
    staleTime: 30_000,
  });

  const runAction = async (conversationId: number, body: any, success: string) => {
    const { error } = await supabase.functions.invoke("freescout-proxy", { body: { conversationId, ...body } });
    if (error) { toast.error("Could not update the ticket."); return; }
    toast.success(success);
    setRefreshKey((k) => k + 1);
  };

  const columnDefs = useMemo<ColDef<Row>[]>(() => [
    { headerName: "#", field: "number", width: 90, sortable: true, filter: true },
    { headerName: "Subject", field: "subject", flex: 2, sortable: true, filter: true },
    { headerName: "Status", field: "status", width: 120, sortable: true, filter: true },
    {
      headerName: "Customer",
      width: 220,
      valueGetter: (p) => p.data?.customer?.email ?? "—",
      sortable: true,
      filter: true,
    },
    {
      headerName: "Assignee",
      width: 180,
      valueGetter: (p) => {
        const a = p.data?.assignee;
        return a ? `${a.firstName ?? ""} ${a.lastName ?? ""}`.trim() : "Unassigned";
      },
      sortable: true,
      filter: true,
    },
    {
      headerName: "Updated",
      field: "updatedAt",
      width: 180,
      valueFormatter: (p) => (p.value ? new Date(p.value).toLocaleString() : "—"),
      sortable: true,
      sort: "desc",
    },
    {
      headerName: "Actions",
      width: 360,
      sortable: false,
      filter: false,
      cellRenderer: (p: { data: Row }) => {
        const id = p.data?.id;
        if (!id) return null;
        return (
          <div className="flex items-center gap-2 h-full">
            <Button size="sm" variant="outline" onClick={() => runAction(id, { action: "assign", assigneeUserId: 0 }, "Assigned to you.")}>
              Assign me
            </Button>
            <Button size="sm" variant="outline" onClick={() => runAction(id, { action: "setPrivate", isPrivate: true }, "Marked private.")}>
              Mark private
            </Button>
            {p.data.status !== "closed" ? (
              <Button size="sm" variant="outline" onClick={() => runAction(id, { action: "close" }, "Ticket closed.")}>Close</Button>
            ) : (
              <Button size="sm" variant="outline" onClick={() => runAction(id, { action: "reopen" }, "Ticket reopened.")}>Reopen</Button>
            )}
          </div>
        );
      },
    },
  ], []);

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading tickets…</p>;

  return (
    <ThemedAgGrid
      rowData={rows}
      columnDefs={columnDefs}
      height="600px"
      gridId="support-tickets-admin"
      exportFileName="support-tickets"
    />
  );
}
