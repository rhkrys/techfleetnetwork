// @edge-auth required — JWT-gated; re-checks active_participant on the owning project (or admin).
// handoff-download (Phase B3): issue a short-lived signed URL for a produced output file,
// AFTER re-checking that the caller is an active teammate on the owning project (or admin).
// The handoff-outputs bucket has NO blanket read policy — ownership is the control, not URL
// secrecy (threat-model T6 / IDOR). See handoff-download.feature.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { createEdgeLogger } from "../_shared/logger.ts";
import { applyWaf } from "../_shared/waf.ts";
import { withAuditWrapper } from "../_shared/audit.ts";
import { parseDownloadBody, SIGNED_URL_TTL_SECONDS } from "./download.ts";

const log = createEdgeLogger("handoff-download");
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
type SvcClient = SupabaseClient<any, "public", any>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(
  withAuditWrapper("handoff-download", async (req: Request) => {
    if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
    const blocked = await applyWaf(req, "handoff-download");
    if (blocked) return blocked;
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;

    const authHeader = req.headers.get("authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Authentication required" }, 401);
    const authClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
    } = await authClient.auth.getUser();
    if (!user) return json({ error: "Invalid or expired token" }, 401);

    const parsed = parseDownloadBody(await req.json().catch(() => null));
    if (!parsed.ok) return json({ error: parsed.error }, 400);

    const svc: SvcClient = createClient(SUPABASE_URL, SERVICE_KEY);

    // Look up the output file -> its production -> owning project.
    const { data: file } = await svc
      .from("handoff_output_files")
      .select("storage_path, format, production_id, handoff_productions!inner(project_id)")
      .eq("id", parsed.outputFileId)
      .maybeSingle();
    if (!file) return json({ error: "not found" }, 404); // don't distinguish missing vs forbidden

    const projectId = (file as { handoff_productions?: { project_id?: string } })
      .handoff_productions?.project_id;
    if (!projectId) return json({ error: "not found" }, 404);

    // Ownership re-check on THIS request (IDOR control), via the user's own client.
    const [{ data: isMember }, { data: isAdmin }] = await Promise.all([
      authClient.rpc("handoff_is_active_member", { p_project_id: projectId }),
      svc.rpc("has_role", { _user_id: user.id, _role: "admin" }),
    ]);
    if (!isMember && !isAdmin) {
      log.warn("idor", `download denied for user on non-member project`, { userId: user.id });
      return json({ error: "not found" }, 404); // same shape as missing — no oracle
    }

    const path = (file as { storage_path: string }).storage_path;
    const { data: signed, error: signErr } = await svc.storage
      .from("handoff-outputs")
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
    if (signErr || !signed) {
      log.error("sign", `createSignedUrl failed: ${signErr?.message ?? "unknown"}`);
      return json({ error: "could not create download link" }, 500);
    }

    return json({
      url: signed.signedUrl,
      format: (file as { format: string }).format,
      expires_in: SIGNED_URL_TTL_SECONDS,
    });
  })
);
