import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@/lib/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ThemedAgGrid } from "@/components/AgGrid";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal, UserPlus, Users, Tags, EyeOff, XCircle, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import type { ColDef, CellClickedEvent } from "ag-grid-community";
import { invokeFreescout } from "@/lib/support/freescoutInvoke";
import TicketDetail from "./TicketDetail";

interface Agent {
  user_id: string;
  display_name: string | null;
  email: string | null;
}

interface Category {
  id: string;
  label: string;
}

/** Admin roster for the "Assign to …" picker (admin-gated RPC). */
function useAgents() {
  return useQuery({
    queryKey: ["support", "agents"] as const,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("support_list_agents");
      if (error) throw error;
      return (data ?? []) as Agent[];
    },
    staleTime: 300_000,
    gcTime: 600_000,
    refetchOnWindowFocus: false,
  });
}

/** Active support categories, admin taxonomy order. */
function useCategories() {
  return useQuery({
    queryKey: ["support", "categories"] as const,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("support_categories")
        .select("id, label")
        .eq("is_active", true)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Category[];
    },
    staleTime: 300_000,
    gcTime: 600_000,
    refetchOnWindowFocus: false,
  });
}

function agentLabel(a: Agent): string {
  return a.display_name?.trim() || a.email || "Unknown admin";
}

interface Row {
  id: number;
  number?: number;
  subject?: string;
  status?: string;
  customer?: { id: number; email?: string };
  assignee?: { id: number; firstName?: string; lastName?: string } | null;
  category?: string | null;
  categoryId?: string | null;
  isPrivate?: boolean;
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
    refetchOnMount: "always",
  });
}

export default function AdminAllTicketsGrid({ scope: fixedScope }: { scope?: Scope } = {}) {
  const [internalScope, setInternalScope] = useState<Scope>("open-unassigned");
  const scope = fixedScope ?? internalScope;
  const qc = useQueryClient();
  const { data: rows = [], isLoading } = useScopedTickets(scope);
  const { data: agents = [] } = useAgents();
  const { data: categories = [] } = useCategories();
  const [openId, setOpenId] = useState<number | null>(null);

  const runAction = async (conversationId: number, body: Record<string, unknown>, success: string) => {
    const { error } = await invokeFreescout({ conversationId, ...body });
    if (error) { toast.error("Could not update the ticket."); return; }
    toast.success(success);
    qc.invalidateQueries({ queryKey: ["support"] as const });
  };

  const columnDefs = useMemo<ColDef<Row>[]>(() => [
    { headerName: "#", field: "number", width: 90, sortable: true, filter: true },
    { headerName: "Subject", field: "subject", flex: 2, minWidth: 240, sortable: true, filter: true },
    { headerName: "Status", field: "status", width: 120, sortable: true, filter: true },
    {
      headerName: "Category", width: 150,
      valueGetter: (p) => p.data?.category ?? "—",
      sortable: true, filter: true,
    },
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
      headerName: "", width: 70, sortable: false, filter: false,
      resizable: false, suppressMenu: true, suppressSizeToFit: true,
      cellRenderer: (p: { data: Row }) => {
        const id = p.data?.id;
        if (!id) return null;
        const isClosed = p.data.status === "closed";
        const label = `Actions for ticket ${p.data.number ?? id}`;
        return (
          <div className="flex items-center h-full">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" aria-label={label}>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={() => runAction(id, { action: "assign", assigneeUserId: "self" }, "Assigned to you.")}>
                  <UserPlus className="h-4 w-4 mr-2" />
                  Assign me
                </DropdownMenuItem>
                {agents.length > 0 && (
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <Users className="h-4 w-4 mr-2" />
                      Assign to…
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="max-h-72 overflow-y-auto">
                      {agents.map((a) => (
                        <DropdownMenuItem
                          key={a.user_id}
                          onClick={() =>
                            runAction(
                              id,
                              { action: "assign", assigneeUserId: a.user_id },
                              `Assigned to ${agentLabel(a)}.`
                            )
                          }
                        >
                          {agentLabel(a)}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                )}
                {categories.length > 0 && (
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <Tags className="h-4 w-4 mr-2" />
                      Set category…
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="max-h-72 overflow-y-auto">
                      {categories.map((c) => (
                        <DropdownMenuItem
                          key={c.id}
                          onClick={() =>
                            runAction(id, { action: "setCategory", categoryId: c.id }, `Category set to ${c.label}.`)
                          }
                        >
                          {c.label}
                        </DropdownMenuItem>
                      ))}
                      {p.data.categoryId && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() =>
                              runAction(id, { action: "setCategory", categoryId: null }, "Category cleared.")
                            }
                          >
                            Clear category
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                )}
                <DropdownMenuItem onClick={() => runAction(id, { action: "setPrivate", isPrivate: true }, "Marked private.")}>
                  <EyeOff className="h-4 w-4 mr-2" />
                  Mark private
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {isClosed ? (
                  <DropdownMenuItem onClick={() => runAction(id, { action: "reopen" }, "Ticket reopened.")}>
                    <RotateCcw className="h-4 w-4 mr-2" />
                    Reopen ticket
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onClick={() => runAction(id, { action: "close" }, "Ticket closed.")}>
                    <XCircle className="h-4 w-4 mr-2" />
                    Close ticket
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      },
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [agents, categories]);

  return (
    <div className="space-y-4">
      {!fixedScope && (
        <Tabs value={scope} onValueChange={(v) => setInternalScope(v as Scope)}>
          <TabsList>
            <TabsTrigger value="open-unassigned">Open · unassigned</TabsTrigger>
            <TabsTrigger value="open-assigned">Open · assigned</TabsTrigger>
            <TabsTrigger value="all">All</TabsTrigger>
          </TabsList>
        </Tabs>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading tickets…</p>
      ) : (
        <ThemedAgGrid
          rowData={rows}
          columnDefs={columnDefs}
          height="600px"
          gridId={`support-tickets-admin-${scope}`}
          exportFileName={`support-tickets-${scope}`}
          // Open the ticket thread on click — but not when the click lands in the
          // actions column (empty headerName), which owns the kebab menu.
          onCellClicked={(e: CellClickedEvent<Row>) => {
            if (e.colDef.headerName === "") return;
            const id = e.data?.id;
            if (id) setOpenId(id);
          }}
        />
      )}

      {openId !== null && (
        <TicketDetail conversationId={openId} viewerRole="admin" onClose={() => setOpenId(null)} />
      )}
    </div>
  );
}
