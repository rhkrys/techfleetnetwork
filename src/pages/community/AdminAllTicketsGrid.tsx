import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@/lib/react-query";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ThemedAgGrid } from "@/components/AgGrid";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type { ColDef } from "ag-grid-community";
import { invokeFreescout } from "@/lib/support/freescoutInvoke";

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

type Scope = "open-unassigned" | "open-assigned" | "all";

function useScopedTickets(scope: Scope) {
  return useQuery({
    queryKey: ["support", "admin-all", scope] as const,
    queryFn: async () => {
      const assigned = scope === "open-unassigned"
        ? "unassigned"
        : scope === "open-assigned"
          ? "assigned"
          : "any";
      const status = scope === "all" ? "all" : "open";
      const { data, error } = await invokeFreescout({
        action: "listAll", status, assigned, page: 1,
      });
      if (error) throw error;
      return (data?.items ?? []) as Row[];
    },
    staleTime: 60_000,
    gcTime: 300_000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });
}

export default function AdminAllTicketsGrid() {
  const [scope, setScope] = useState<Scope>("open-unassigned");
  const qc = useQueryClient();
  const { data: rows = [], isLoading } = useScopedTickets(scope);

  const runAction = async (conversationId: number, body: Record<string, unknown>, success: string) => {
    const { error } = await invokeFreescout({ conversationId, ...body });
    if (error) { toast.error("Could not update the ticket."); return; }
    toast.success(success);
    qc.invalidateQueries({ queryKey: ["support"] as const });
  };

  const columnDefs = useMemo<ColDef<Row>[]>(() => [
    { headerName: "#", field: "number", width: 90, sortable: true, filter: true },
    { headerName: "Subject", field: "subject", flex: 2, sortable: true, filter: true },
    { headerName: "Status", field: "status", width: 120, sortable: true, filter: true },
    {
      headerName: "Customer", width: 220,
      valueGetter: (p) => p.data?.customer?.email ?? "—",
      sortable: true, filter: true,
    },
    {
      headerName: "Assignee", width: 180,
      valueGetter: (p) => {
        const a = p.data?.assignee;
        return a ? `${a.firstName ?? ""} ${a.lastName ?? ""}`.trim() : "Unassigned";
      },
      sortable: true, filter: true,
    },
    {
      headerName: "Updated", field: "updatedAt", width: 180,
      valueFormatter: (p) => (p.value ? new Date(p.value).toLocaleString() : "—"),
      sortable: true, sort: "desc",
    },
    {
      headerName: "Actions", width: 360, sortable: false, filter: false,
      cellRenderer: (p: { data: Row }) => {
        const id = p.data?.id;
        if (!id) return null;
        return (
          <div className="flex items-center gap-2 h-full">
            <Button size="sm" variant="outline" onClick={() => runAction(id, { action: "assign", assigneeUserId: "self" }, "Assigned to you.")}>
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

  return (
    <div className="space-y-4">
      <Tabs value={scope} onValueChange={(v) => setScope(v as Scope)}>
        <TabsList>
          <TabsTrigger value="open-unassigned">Open · unassigned</TabsTrigger>
          <TabsTrigger value="open-assigned">Open · assigned</TabsTrigger>
          <TabsTrigger value="all">All</TabsTrigger>
        </TabsList>
      </Tabs>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading tickets…</p>
      ) : (
        <ThemedAgGrid
          rowData={rows}
          columnDefs={columnDefs}
          height="600px"
          gridId={`support-tickets-admin-${scope}`}
          exportFileName={`support-tickets-${scope}`}
        />
      )}
    </div>
  );
}
