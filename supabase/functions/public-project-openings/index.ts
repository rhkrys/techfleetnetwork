// @edge-cron
import { applyWaf } from "../_shared/waf.ts";
import { scrubJson } from "../_shared/dlp.ts";
import { getAdminClient } from "../_shared/admin-client.ts";

import { withAuditWrapper } from "../_shared/audit.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const visibleStatuses = ["coming_soon", "apply_now", "recruiting", "team_onboarding", "project_in_progress"];

Deno.serve(withAuditWrapper("public-project-openings", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const blocked = await applyWaf(req, "public-project-openings");
  if (blocked) return blocked;

  try {
    const supabase = getAdminClient();
    const { data: projects, error: projectError } = await supabase
      .from("projects")
      .select("id, client_id, project_type, phase, project_status, team_hats, current_phase_milestones, friendly_name, description, created_at")
      .in("project_status", visibleStatuses)
      .order("created_at", { ascending: false })
      .limit(100);
    if (projectError) throw projectError;

    const projectRows = projects ?? [];
    const clientIds = [...new Set(projectRows.map((p) => p.client_id).filter(Boolean))];
    const projectIds = projectRows.map((p) => p.id);

    // NOTE: `kind` ('external' | 'internal') powers the Volunteer Openings tab partition on the
    // client. The enum is aliased to text via `kind::text` because PostgREST sometimes omits
    // custom enum columns when its schema cache hasn't picked up the type yet.
    const { data: clients, error: clientError } = clientIds.length
      ? await supabase.from("clients").select("id, name, logo_url, kind:kind::text").in("id", clientIds).eq("status", "active")
      : { data: [] as Array<{ id: string; name: string; logo_url: string | null; kind: "external" | "internal" }>, error: null };
    if (clientError) throw clientError;

    const { data: applicationStats, error: appError } = projectIds.length
      ? await supabase.from("project_applications").select("project_id, team_hats_interest").in("project_id", projectIds).eq("status", "completed")
      : { data: [], error: null };
    if (appError) throw appError;

    const applicationSummary = new Map<string, { project_id: string; total: number; hatCounts: Record<string, number> }>();
    for (const application of applicationStats ?? []) {
      const projectId = application.project_id as string;
      const entry = applicationSummary.get(projectId) ?? { project_id: projectId, total: 0, hatCounts: {} };
      entry.total += 1;
      for (const hat of application.team_hats_interest ?? []) {
        entry.hatCounts[hat] = (entry.hatCounts[hat] ?? 0) + 1;
      }
      applicationSummary.set(projectId, entry);
    }

    const stats = {
      projects_open_applications: projectRows.filter((p) => p.project_status === "apply_now").length,
      // Coming soon = pre-launch pipeline (announced, recruiting team, onboarding team).
      projects_coming_soon: projectRows.filter((p) => ["coming_soon", "recruiting", "team_onboarding"].includes(p.project_status as string)).length,
      projects_live: projectRows.filter((p) => p.project_status === "project_in_progress").length,
      projects_previously_completed: 0,
    };

    return new Response(scrubJson({ projects: projectRows, clients: clients ?? [], applicationStats: [...applicationSummary.values()], stats }, {
      uuids: [...projectIds, ...clientIds],
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("public-project-openings error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}));