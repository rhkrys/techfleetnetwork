import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useSyncedTableState, useSyncedScrollPosition } from "@/hooks/use-synced-table-state";


import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  Search,
  Loader2,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Download,
} from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { ThemedAgGrid } from "@/components/AgGrid";
import type { ColDef } from "ag-grid-community";

interface AuditLogEntry {
  id: string;
  event_type: string;
  table_name: string;
  record_id: string | null;
  user_id: string | null;
  actor_email: string | null;
  changed_fields: string[] | null;
  error_message: string | null;
  error_fingerprint: string | null;
  created_at: string;
}

type TriageState = { triage_status: string | null; silence_state: string | null; fix_queue_id: string | null };

const QUERY_TIMEOUT_MS = 15_000;

async function withTimeout<T>(promise: PromiseLike<T>, label: string): Promise<T> {
  let timeoutId: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(`${label} timed out`)), QUERY_TIMEOUT_MS);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId) window.clearTimeout(timeoutId);
  }
}

const EVENT_TYPE_CONFIG: Record<string, { label: string; variant: string }> = {
  profile_created: { label: "Profile Created", variant: "default" },
  profile_updated: { label: "Profile Updated", variant: "secondary" },
  role_granted: { label: "Role Granted", variant: "default" },
  role_revoked: { label: "Role Revoked", variant: "destructive" },
  task_completed: { label: "Task Completed", variant: "default" },
  task_uncompleted: { label: "Task Uncompleted", variant: "secondary" },
  application_created: { label: "Application Created", variant: "default" },
  application_status_changed: { label: "Application Status Changed", variant: "secondary" },
  application_submitted: { label: "Application Submitted", variant: "default" },
  conversation_created: { label: "Chat Started", variant: "secondary" },
  conversation_deleted: { label: "Chat Deleted", variant: "destructive" },
  invitation_created: { label: "Invitation Sent", variant: "default" },
  invitation_used: { label: "Invitation Used", variant: "default" },
  admin_promotion_initiated: { label: "Admin Promotion", variant: "default" },
  announcement_created: { label: "Announcement Created", variant: "default" },
  announcement_deleted: { label: "Announcement Deleted", variant: "destructive" },
  client_created: { label: "Client Created", variant: "default" },
  client_updated: { label: "Client Updated", variant: "secondary" },
  client_deleted: { label: "Client Deleted", variant: "destructive" },
  client_error: { label: "Client Error", variant: "destructive" },
  authn_admin_login_success: { label: "Admin Login", variant: "default" },
  authz_role_change: { label: "Role Change", variant: "secondary" },
  session_revoked: { label: "Session Revoked", variant: "destructive" },
  project_created: { label: "Project Created", variant: "default" },
  project_updated: { label: "Project Updated", variant: "secondary" },
  project_deleted: { label: "Project Deleted", variant: "destructive" },
  project_application_created: { label: "Project App Created", variant: "default" },
  project_application_status_changed: { label: "Project App Status Changed", variant: "secondary" },
  project_application_submitted: { label: "Project App Submitted", variant: "default" },
  error: { label: "Error", variant: "destructive" },
  // Email pipeline events
  email_queued: { label: "Email Queued", variant: "secondary" },
  email_sent: { label: "Email Sent", variant: "default" },
  email_failed: { label: "Email Failed", variant: "destructive" },
  email_dlq: { label: "Email Dead-Lettered", variant: "destructive" },
  email_rate_limited: { label: "Email Rate Limited", variant: "secondary" },
  email_suppressed: { label: "Email Suppressed", variant: "secondary" },
  email_bounced: { label: "Email Bounced", variant: "destructive" },
  email_complained: { label: "Email Complained", variant: "destructive" },
  // Discord integration events
  discord_invite_generated: { label: "Discord Invite Generated", variant: "default" },
  discord_bot_error: { label: "Discord Bot Error", variant: "destructive" },
  // Layer 1 frontend / Layer 2 edge / Layer 4 trace events
  client_error_overflow: { label: "Client Error Overflow", variant: "destructive" },
  ui_render_error: { label: "UI Render Error", variant: "destructive" },
  ui_chunk_load_failed: { label: "Chunk Load Failed", variant: "destructive" },
  edge_function_error: { label: "Edge Function Error", variant: "destructive" },
  edge_invoke_failed: { label: "Edge Invoke Failed", variant: "destructive" },
  external_api_failed: { label: "External API Failed", variant: "destructive" },
  authn_unauthorized: { label: "Auth Rejected", variant: "destructive" },
  authz_admin_denied: { label: "Admin Access Denied", variant: "destructive" },
  authz_check_failed: { label: "Authz Check Failed", variant: "destructive" },
  malicious_webhook_signature_invalid: { label: "Webhook Signature Invalid", variant: "destructive" },
  session_idle_timeout: { label: "Session Idle Timeout", variant: "secondary" },
  service_error: { label: "Service Error", variant: "destructive" },
  // Membership / Gumroad recognition events
  gumroad_ingestion_misconfigured: { label: "Gumroad Not Configured", variant: "destructive" },
  gumroad_api_error: { label: "Gumroad API Error", variant: "destructive" },
  gumroad_backfill_truncated: { label: "Gumroad Backfill Truncated", variant: "secondary" },
  gumroad_backfill_all_started: { label: "Membership Resync Started", variant: "secondary" },
  gumroad_backfill_all_completed: { label: "Membership Resync Completed", variant: "default" },
  gumroad_sale_attached: { label: "Gumroad Sale Attached", variant: "default" },
  gumroad_sale_persist_failed: { label: "Gumroad Sale Persist Failed", variant: "destructive" },
  gumroad_reconcile_failed: { label: "Gumroad Reconcile Failed", variant: "destructive" },
  membership_projection_failed: { label: "Membership Projection Failed", variant: "destructive" },
  membership_invariant_violation: { label: "Membership Invariant Violation", variant: "destructive" },
  membership_metadata_mismatch: { label: "Membership Metadata Mismatch", variant: "secondary" },
};

/**
 * Infer the producing layer of an audit_log row from its event_type +
 * table_name. Used purely for filtering — the source is also stored
 * explicitly as `source:edge.<fn>` / `source:frontend.<feature>` in
 * `changed_fields` for the rows that pass through Layer 1/2 helpers.
 */
function inferLayer(entry: { event_type: string; table_name: string | null; changed_fields: string[] | null }): "frontend" | "edge" | "db" | "auth" {
  const explicit = entry.changed_fields?.find((f) => f.startsWith("source:"));
  if (explicit?.startsWith("source:edge")) return "edge";
  if (explicit?.startsWith("source:frontend")) return "frontend";
  const ev = entry.event_type;
  if (ev.startsWith("authn_") || ev.startsWith("authz_") || ev.startsWith("login_") || ev.startsWith("signup_") || ev.startsWith("password_reset")) return "auth";
  if (ev === "edge_function_error" || ev === "external_api_failed" || ev === "malicious_webhook_signature_invalid") return "edge";
  if (ev === "client_error" || ev.startsWith("client_error") || ev.startsWith("ui_") || ev === "session_idle_timeout" || ev === "edge_invoke_failed" || ev === "service_error") return "frontend";
  return "db";
}

function inferSeverity(entry: { event_type: string; error_message: string | null; changed_fields: string[] | null }): "info" | "warn" | "error" {
  const explicit = entry.changed_fields?.find((f) => f.startsWith("severity:"))?.slice("severity:".length);
  if (explicit === "info" || explicit === "warn" || explicit === "error") return explicit;
  if (entry.error_message) return "error";
  if (/_failed$|_error$|_denied$|invalid|complained|bounced|dlq|violation|misconfigured/i.test(entry.event_type)) return "error";
  if (/timeout|rate_limited|suppressed|overflow|truncated/i.test(entry.event_type)) return "warn";
  return "info";
}

const PAGE_SIZE = 50;

const getFieldValue = (fields: string[] | null | undefined, key: string) => {
  const prefix = `${key}:`;
  return fields?.find((field) => field.startsWith(prefix))?.slice(prefix.length) ?? null;
};

export default function ActivityLogPage() {
  // Admin access is enforced by AdminRoute wrapper
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [profiles, setProfiles] = useState<Map<string, { email: string; name: string }>>(new Map());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [triageMap, setTriageMap] = useState<Map<string, TriageState>>(new Map());
  const [exporting, setExporting] = useState(false);

  // ACTIVITY-LOG-STATE-001 — page/filter/search/scroll survive a hard reload
  // OR a remount (UpdateAvailableBanner refresh, auth redirect, Suspense
  // retry, browser refresh). Hydration order: URL → sessionStorage → defaults.
  const [tableState, setTableState] = useSyncedTableState("activity-log", {
    search: "",
    eventFilter: "all",
    layerFilter: "all",
    severityFilter: "all",
    dateFrom: "",
    dateTo: "",
    page: 0,
  });
  const { search, eventFilter, layerFilter, severityFilter, dateFrom, dateTo, page } = tableState;
  const setSearch = (v: string) => setTableState({ search: v });
  const setEventFilter = (v: string) => setTableState({ eventFilter: v, page: 0 });
  const setLayerFilter = (v: string) => setTableState({ layerFilter: v, page: 0 });
  const setSeverityFilter = (v: string) => setTableState({ severityFilter: v, page: 0 });
  const setDateFrom = (v: string) => setTableState({ dateFrom: v, page: 0 });
  const setDateTo = (v: string) => setTableState({ dateTo: v, page: 0 });
  const setPage = (next: number | ((prev: number) => number)) =>
    setTableState((prev) => ({ page: typeof next === "function" ? (next as (p: number) => number)(prev.page as number) : next }));
  const [totalCount, setTotalCount] = useState(0);
  const [countEstimated, setCountEstimated] = useState(false);

  // Restore scroll position once entries land (so the rendered grid has height).
  useSyncedScrollPosition("activity-log", entries.length > 0);


  const fetchProfiles = async () => {
      const { data } = await withTimeout<{ data: Array<{ user_id: string; email: string; first_name: string; last_name: string; display_name: string }> | null }>(
        supabase.from("profiles").select("user_id, email, first_name, last_name, display_name") as unknown as PromiseLike<{ data: Array<{ user_id: string; email: string; first_name: string; last_name: string; display_name: string }> | null }>,
        "Profile lookup"
      );
    if (data) {
      const map = new Map<string, { email: string; name: string }>();
      data.forEach((p) => {
        const name = p.first_name || p.last_name
          ? `${p.first_name} ${p.last_name}`.trim()
          : p.display_name || "Unknown";
        map.set(p.user_id, { email: p.email, name });
      });
      setProfiles(map);
    }
  };

  const applyRangeFilters = <T extends { gte: (col: string, v: string) => T; lte: (col: string, v: string) => T; eq: (col: string, v: string) => T }>(q: T): T => {
    let out = q;
    if (eventFilter !== "all") out = out.eq("event_type", eventFilter);
    if (dateFrom) out = out.gte("created_at", new Date(dateFrom).toISOString());
    if (dateTo) {
      // include the whole "to" day
      const end = new Date(dateTo);
      end.setHours(23, 59, 59, 999);
      out = out.lte("created_at", end.toISOString());
    }
    return out;
  };

  const fetchLogs = async () => {
    setLoading(true);
    setLoadError("");
    try {
      // Rows are the must-have. Count is best-effort — never block the page on it.
      const query = applyRangeFilters(
        supabase
          .from("audit_log")
          .select("*")
          .order("created_at", { ascending: false })
          .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1) as never
      );
      const rowsPromise = withTimeout<{ data: unknown[] | null; error: Error | null }>(
        query as unknown as PromiseLike<{ data: unknown[] | null; error: Error | null }>,
        "Activity log load",
      );

      // Fast-count RPC: O(1) estimate when unfiltered, exact only when filtered narrow.
      const countPromise = withTimeout<{ data: number | null; error: unknown }>(
        (supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: number | null; error: unknown }>)(
          "audit_log_count_fast",
          {
            p_event_type: eventFilter !== "all" ? eventFilter : null,
            p_from: dateFrom ? new Date(dateFrom).toISOString() : null,
            p_to: dateTo
              ? (() => { const e = new Date(dateTo); e.setHours(23, 59, 59, 999); return e.toISOString(); })()
              : null,
          },
        ),
        "Activity log count",
      );

      const [rowsResult, countResult] = await Promise.allSettled([rowsPromise, countPromise]);

      if (rowsResult.status === "rejected") throw rowsResult.reason;
      const { data, error } = rowsResult.value;
      if (error) throw error;
      const rows = (data || []) as unknown as AuditLogEntry[];
      setEntries(rows);

      if (countResult.status === "fulfilled" && !countResult.value.error && typeof countResult.value.data === "number") {
        setTotalCount(countResult.value.data);
        // Unfiltered count always comes from planner estimate; filtered may be exact.
        const isUnfiltered = eventFilter === "all" && !dateFrom && !dateTo;
        setCountEstimated(isUnfiltered);
      } else {
        // Degrade gracefully: rows render, pagination uses hasMore from page size.
        setTotalCount(Math.max((page + 1) * PAGE_SIZE + (rows.length === PAGE_SIZE ? PAGE_SIZE : 0), rows.length));
        setCountEstimated(true);
      }

      // Hydrate triage state for visible fingerprints (admin-only by RLS)
      const fps = Array.from(new Set(rows.map((r) => r.error_fingerprint).filter(Boolean) as string[]));
      if (fps.length > 0) {
        const { data: triageRows } = await supabase
          .from("agent_fix_queue")
          .select("fingerprint,status,id")
          .in("fingerprint", fps);
        const m = new Map<string, TriageState>();
        triageRows?.forEach((t) => {
          m.set(t.fingerprint as string, {
            triage_status: t.status as string,
            silence_state: null,
            fix_queue_id: t.id as string,
          });
        });
        setTriageMap(m);
      } else {
        setTriageMap(new Map());
      }
    } catch (err) {
      console.error("Failed to fetch audit logs:", err);
      setLoadError(err instanceof Error ? err.message : "Activity log could not load.");
    } finally {
      setLoading(false);
    }
  };

  const csvEscape = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "string" ? v : Array.isArray(v) ? v.join(" | ") : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const handleExportAll = async () => {
    setExporting(true);
    try {
      const BATCH = 1000;
      let from = 0;
      const all: AuditLogEntry[] = [];
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const q = applyRangeFilters(
          supabase
            .from("audit_log")
            .select("*")
            .order("created_at", { ascending: false })
            .range(from, from + BATCH - 1) as never
        );
        const { data, error } = await (q as unknown as PromiseLike<{ data: unknown[] | null; error: Error | null }>);
        if (error) throw error;
        const batch = (data || []) as unknown as AuditLogEntry[];
        all.push(...batch);
        if (batch.length < BATCH) break;
        from += BATCH;
        if (all.length > 250_000) break; // safety cap
      }

      const headers = ["created_at","event_type","table_name","record_id","user_id","actor_email","changed_fields","error_message","error_fingerprint","id"];
      const lines = [headers.join(",")];
      for (const e of all) {
        lines.push([
          e.created_at,
          e.event_type,
          e.table_name,
          e.record_id,
          e.user_id,
          e.actor_email || (e.user_id ? profiles.get(e.user_id)?.email : null),
          e.changed_fields,
          e.error_message,
          e.error_fingerprint,
          e.id,
        ].map(csvEscape).join(","));
      }
      const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const rangeLabel = dateFrom || dateTo ? `_${dateFrom || "start"}_to_${dateTo || "now"}` : "_all";
      a.href = url;
      a.download = `activity-log${rangeLabel}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(`Exported ${all.length.toLocaleString()} records`);
    } catch (err) {
      console.error("Activity log export failed:", err);
      toast.error(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  useEffect(() => {
    fetchProfiles();
  }, []);

  useEffect(() => {
    fetchLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, eventFilter, dateFrom, dateTo]);

  const filteredEntries = useMemo(() => {
    const q = search.trim().toLowerCase();
    const traceMatch = q.startsWith("trace:") ? q.slice("trace:".length) : null;
    return entries.filter((e) => {
      if (layerFilter !== "all" && inferLayer(e) !== layerFilter) return false;
      if (severityFilter !== "all" && inferSeverity(e) !== severityFilter) return false;

      if (!q) return true;
      if (traceMatch) {
        return e.changed_fields?.some(
          (f) => f.toLowerCase().includes(`trace:${traceMatch}`),
        ) ?? false;
      }

      const userInfo = e.user_id ? profiles.get(e.user_id) : null;
      const attemptedEmail = getFieldValue(e.changed_fields, "attempted_email");
      return (
        e.event_type.toLowerCase().includes(q) ||
        e.table_name.toLowerCase().includes(q) ||
        (attemptedEmail?.toLowerCase().includes(q)) ||
        (e.actor_email?.toLowerCase().includes(q)) ||
        (userInfo?.email?.toLowerCase().includes(q)) ||
        (userInfo?.name?.toLowerCase().includes(q)) ||
        (e.error_message?.toLowerCase().includes(q)) ||
        (e.changed_fields?.some((f) => f.toLowerCase().includes(q)))
      );
    });
  }, [entries, search, profiles, layerFilter, severityFilter]);

  const uniqueEventTypes = useMemo(() => {
    const types = new Set(entries.map((e) => e.event_type));
    Object.keys(EVENT_TYPE_CONFIG).forEach((t) => types.add(t));
    return Array.from(types).sort();
  }, [entries]);

  const getEventConfig = (eventType: string) =>
    EVENT_TYPE_CONFIG[eventType] || {
      label: eventType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      variant: "secondary",
    };

  const formatChangedFields = (fields: string[] | null, eventType: string) => {
    if (!fields || fields.length === 0) return "";
    if (eventType === "password_reset_requested" || eventType === "password_reset_failed") {
      const attemptedEmail = getFieldValue(fields, "attempted_email");
      return attemptedEmail ? `Attempted email: ${attemptedEmail}` : fields.filter((field) => !field.startsWith("email_hash:")).join(", ");
    }
    if (eventType.startsWith("email_")) {
      const [template, recipient, status] = fields;
      return [template, recipient, status].filter(Boolean).join(" · ");
    }
    if (eventType === "task_completed" || eventType === "task_uncompleted") return `${fields[0]} → ${fields[1] || ""}`;
    if (eventType === "application_status_changed" && fields.length >= 2) return `${fields[0]} → ${fields[1]}`;
    return fields.join(", ");
  };

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  const columnDefs = useMemo<ColDef<AuditLogEntry>[]>(() => [
    {
      headerName: "Date",
      field: "created_at",
      flex: 1,
      minWidth: 140,
      valueFormatter: (params) =>
        params.value ? format(new Date(params.value), "MMM d, yyyy HH:mm") : "—",
    },
    {
      headerName: "Actor Email",
      flex: 2,
      minWidth: 220,
      valueGetter: (params) => {
        const e = params.data;
        if (!e?.user_id) return getFieldValue(e?.changed_fields, "attempted_email") || "System";
        const info = profiles.get(e.user_id);
        return e.actor_email || info?.email || e.user_id;
      },
    },
    {
      headerName: "Event",
      field: "event_type",
      flex: 1,
      minWidth: 140,
      valueFormatter: (params) => getEventConfig(params.value).label,
    },
    {
      headerName: "Table",
      field: "table_name",
      flex: 1,
      minWidth: 100,
    },
    {
      headerName: "Details",
      flex: 1,
      valueGetter: (params) => {
        const e = params.data;
        if (!e) return "";
        return formatChangedFields(e.changed_fields, e.event_type);
      },
    },
    {
      headerName: "Error",
      field: "error_message",
      flex: 1,
      minWidth: 120,
      cellStyle: (params) => params.value ? { color: "hsl(var(--destructive))" } : undefined,
      valueFormatter: (params) => params.value || "—",
    },
    {
      headerName: "Triage",
      field: "error_fingerprint",
      width: 130,
      valueGetter: (params) => {
        const fp = params.data?.error_fingerprint;
        if (!fp) return "—";
        const t = triageMap.get(fp);
        if (!t) return params.data?.error_message ? "queued" : "—";
        return t.triage_status ?? "—";
      },
      cellRenderer: (params: { value: string }) => {
        const v = params.value;
        if (!v || v === "—") return v;
        const tone =
          v === "pending" ? "bg-destructive/10 text-destructive" :
          v === "proposed" ? "bg-primary/10 text-primary" :
          v === "applied" || v === "resolved" ? "bg-emerald-500/10 text-emerald-600" :
          v === "dismissed" ? "bg-muted text-muted-foreground" :
          "bg-muted text-foreground";
        return `<span class="inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${tone}">${v}</span>`;
      },
    },
  ], [profiles, triageMap]);

  // Admin access is enforced by AdminRoute wrapper

  return (
    <div className="container-app py-8 sm:py-12 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Activity Log</h1>
        <p className="text-muted-foreground mt-1">
          Failures, security events, and privileged actions across the platform.
          Routine activity (notifications, chat, journey progress, profile edits) lives on the source pages.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <div className="relative w-full flex-1 sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search events, users, errors… or trace:&lt;id&gt;"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            aria-label="Search activity log (supports trace:id)"
          />
        </div>
        <Select value={layerFilter} onValueChange={(v) => { setLayerFilter(v); setPage(0); }}>
          <SelectTrigger className="w-full sm:w-[160px]" aria-label="Filter by layer">
            <SelectValue placeholder="All layers" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Layers</SelectItem>
            <SelectItem value="frontend">Frontend</SelectItem>
            <SelectItem value="edge">Edge Functions</SelectItem>
            <SelectItem value="db">Database</SelectItem>
            <SelectItem value="auth">Auth</SelectItem>
          </SelectContent>
        </Select>
        <Select value={severityFilter} onValueChange={(v) => { setSeverityFilter(v); setPage(0); }}>
          <SelectTrigger className="w-full sm:w-[140px]" aria-label="Filter by severity">
            <SelectValue placeholder="All severities" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Severities</SelectItem>
            <SelectItem value="info">Info</SelectItem>
            <SelectItem value="warn">Warn</SelectItem>
            <SelectItem value="error">Error</SelectItem>
          </SelectContent>
        </Select>
        <Select value={eventFilter} onValueChange={(v) => { setEventFilter(v); setPage(0); }}>
          <SelectTrigger className="w-full sm:w-[220px]" aria-label="Filter by event type">
            <SelectValue placeholder="All events" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Events</SelectItem>
            {uniqueEventTypes.map((t) => (
              <SelectItem key={t} value={t}>
                {getEventConfig(t).label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2 ml-auto">
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => { setDateFrom(e.target.value); setPage(0); }}
            className="w-[160px]"
            aria-label="From date"
            max={dateTo || undefined}
          />
          <span className="text-muted-foreground text-sm">to</span>
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => { setDateTo(e.target.value); setPage(0); }}
            className="w-[160px]"
            aria-label="To date"
            min={dateFrom || undefined}
          />
          {(dateFrom || dateTo) && (
            <Button variant="ghost" size="sm" onClick={() => { setDateFrom(""); setDateTo(""); setPage(0); }}>
              Clear
            </Button>
          )}
        </div>
        <Badge
          variant="secondary"
          className="text-xs whitespace-nowrap"
          title={countEstimated ? "Estimated total. Filter or refresh for an exact count." : undefined}
        >
          {countEstimated ? "~" : ""}{totalCount.toLocaleString()} events
        </Badge>
        <Button
          variant="outline"
          size="sm"
          onClick={handleExportAll}
          disabled={exporting || totalCount === 0}
          className="whitespace-nowrap"
        >
          {exporting ? (
            <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Exporting…</>
          ) : (
            <><Download className="h-4 w-4 mr-1" /> Download CSV ({totalCount.toLocaleString()})</>
          )}
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : loadError ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive" role="alert">
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-medium">Activity log did not finish loading.</p>
              <p className="mt-1">{loadError}</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={fetchLogs}>Try again</Button>
            </div>
          </div>
        </div>
      ) : (
        <>
          <ThemedAgGrid<AuditLogEntry>
            gridId="activity-log"
            height="500px"
            rowData={filteredEntries}
            columnDefs={columnDefs}
            getRowId={(params) => params.data.id}
            rowClassRules={{
              "bg-destructive/5": (params) => !!params.data?.error_message,
            }}
          />

          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Page {page + 1} of {totalPages}
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                  <ChevronLeft className="h-4 w-4 mr-1" /> Previous
                </Button>
                <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>
                  Next <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
