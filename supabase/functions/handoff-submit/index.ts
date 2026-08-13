// @edge-auth required — JWT-gated; requires active_participant on the project (or admin).
// handoff-submit (Phase B1): the single hardened intake endpoint. Every deliverable — text,
// link, or file — is validated server-side before storage. Auth: active_participant on the
// project (or admin). Files are typed by MAGIC BYTES (validate.ts), stored under a random name
// via service role; links are SSRF/host checked; text is capped. Mass-assignment safe:
// created_by is ALWAYS the authenticated user, never the body. See handoff-submit.feature.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { createEdgeLogger } from "../_shared/logger.ts";
import { applyWaf } from "../_shared/waf.ts";
import { withAuditWrapper } from "../_shared/audit.ts";
import { checkSubmissionUrl, checkText, checkUpload, safeObjectName } from "./validate.ts";

const log = createEdgeLogger("handoff-submit");
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const MAX_BODY_BYTES = 72 * 1024 * 1024; // allows a 50MB file (+ base64/multipart overhead)
const PHASES = new Set(["phase_1", "phase_2", "phase_3", "phase_4"]);
const LINK_TYPES = new Set(["figma", "figjam", "url"]);
type SvcClient = SupabaseClient<any, "public", any>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(
  withAuditWrapper("handoff-submit", async (req: Request) => {
    if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
    // Pass the upload cap so the WAF's 1 MB default doesn't 413 a legitimate file before the
    // handler's own magic-byte + size validation runs.
    const blocked = await applyWaf(req, "handoff-submit", { maxBodyBytes: MAX_BODY_BYTES });
    if (blocked) return blocked;
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    // DoS: reject oversized bodies up front.
    const contentLength = parseInt(req.headers.get("content-length") || "0", 10);
    if (contentLength > MAX_BODY_BYTES) return json({ error: "Request body too large" }, 413);

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

    // ── Parse input: multipart (file) OR JSON (text/link). Mass-assignment allow-list only. ──
    let projectId = "",
      phase = "",
      componentSlug = "",
      type = "";
    let text = "",
      externalUrl = "",
      fileName = "";
    let fileBytes: Uint8Array | null = null;
    const ct = req.headers.get("content-type") || "";
    try {
      if (ct.includes("multipart/form-data")) {
        const form = await req.formData();
        projectId = String(form.get("project_id") ?? "");
        phase = String(form.get("phase") ?? "");
        componentSlug = String(form.get("component_slug") ?? "");
        type = String(form.get("type") ?? "file");
        const f = form.get("file");
        if (f && f instanceof File) {
          fileName = f.name;
          fileBytes = new Uint8Array(await f.arrayBuffer());
        }
      } else {
        const b = await req.json();
        projectId = String(b.project_id ?? "");
        phase = String(b.phase ?? "");
        componentSlug = String(b.component_slug ?? "");
        type = String(b.type ?? "");
        text = typeof b.text === "string" ? b.text : "";
        externalUrl = typeof b.external_url === "string" ? b.external_url : "";
      }
    } catch {
      return json({ error: "Invalid request body" }, 400);
    }

    if (!/^[0-9a-f-]{36}$/i.test(projectId)) return json({ error: "invalid project_id" }, 400);
    if (!PHASES.has(phase)) return json({ error: "invalid phase" }, 400);
    if (!componentSlug) return json({ error: "component_slug required" }, 400);

    const svc: SvcClient = createClient(SUPABASE_URL, SERVICE_KEY);

    // ── AuthZ: active teammate on THIS project (member-scoped via the user's client) or admin ──
    const [{ data: isMember }, { data: isAdmin }] = await Promise.all([
      authClient.rpc("handoff_is_active_member", { p_project_id: projectId }),
      svc.rpc("has_role", { _user_id: user.id, _role: "admin" }),
    ]);
    if (!isMember && !isAdmin)
      return json({ error: "Only active teammates on this project can submit." }, 403);

    // Component must be one of the real 26 hand-off components (reject arbitrary slugs).
    const { data: comp } = await svc
      .from("spf_entity")
      .select("slug")
      .eq("entity_type", "handoff_component")
      .eq("slug", componentSlug)
      .maybeSingle();
    if (!comp) return json({ error: "unknown hand-off component" }, 400);

    // ── Validate + build the row per type ──
    const row: Record<string, unknown> = {
      project_id: projectId,
      phase,
      component_slug: componentSlug,
      created_by: user.id, // created_by NEVER from body
    };

    if (type === "text") {
      const c = checkText(text);
      if (!c.ok) return json({ error: c.error }, 400);
      row.submission_type = "text";
      row.text_content = text.trim();
    } else if (LINK_TYPES.has(type)) {
      const c = checkSubmissionUrl(type as "figma" | "figjam" | "url", externalUrl);
      if (!c.ok) return json({ error: c.error }, 400);
      row.submission_type = type;
      row.external_url = externalUrl;
    } else if (type === "file") {
      if (!fileBytes) return json({ error: "no file provided" }, 400);
      const c = checkUpload(fileBytes);
      if (!c.ok) return json({ error: c.error }, 400);
      const objectName = safeObjectName(c.category, crypto.randomUUID());
      const path = `${projectId}/${phase}/${componentSlug}/${objectName}`;
      const { error: upErr } = await svc.storage
        .from("handoff-deliverables")
        .upload(path, fileBytes, {
          contentType: c.mime,
          upsert: false,
        });
      if (upErr) {
        log.error("upload", `storage upload failed: ${upErr.message}`);
        return json({ error: "could not store file" }, 500);
      }
      row.submission_type = "file";
      row.file_path = path;
      row.file_name = (fileName || objectName).slice(0, 200);
    } else {
      return json({ error: "invalid submission type" }, 400);
    }

    const { data: inserted, error: insErr } = await svc
      .from("handoff_deliverable_submissions")
      .insert(row)
      .select("id")
      .single();
    if (insErr) {
      log.error("insert", `submission insert failed: ${insErr.message}`);
      return json({ error: "could not record submission" }, 500);
    }

    const { data: completeness } = await svc.rpc("handoff_completeness", {
      p_project_id: projectId,
      p_phase: phase,
    });
    return json({ submission_id: (inserted as { id: string }).id, completeness }, 201);
  })
);
