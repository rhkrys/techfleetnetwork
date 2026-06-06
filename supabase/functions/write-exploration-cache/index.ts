// @edge-public
import { z } from "npm:zod@4.3.6";
import { getAdminClient } from "../_shared/admin-client.ts";
import { errorResponse, handleCors, jsonResponse, parseJsonBody } from "../_shared/http.ts";

import { withAuditWrapper } from "../_shared/audit.ts";

// M-01: Lenient shape guard. Existing per-field length/type checks below stay authoritative.
const BodySchema = z.object({
  query_normalized: z.string().optional(),
  response_markdown: z.string().optional(),
}).passthrough();

Deno.serve(withAuditWrapper("write-exploration-cache", async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    // Service-role only. The exploration cache is shared across all users,
    // so writes must originate from trusted server-side callers (techfleet-chat
    // edge fn, admin tooling). Any authenticated user calling this directly
    // could poison the L3 semantic cache served to other members.
    //
    // We compare against the env-injected service-role key (constant-time-ish
    // via length-checked === in JS). A JWT-decode fallback path is intentionally
    // omitted — it was previously bypassable by anyone who could craft a JWT
    // with role=service_role in the payload.
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length).trim()
      : "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!serviceRoleKey || !token || token !== serviceRoleKey) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    // Parse & validate body
    const rawBody = await parseJsonBody(req);
    const parsedBody = BodySchema.safeParse(rawBody);
    if (!parsedBody.success) return jsonResponse({ error: "Invalid body" }, 400);
    const body = parsedBody.data as Record<string, unknown>;
    const queryNormalized = typeof body.query_normalized === "string"
      ? body.query_normalized.trim().slice(0, 500)
      : "";
    const responseMarkdown = typeof body.response_markdown === "string"
      ? body.response_markdown.slice(0, 32_768)
      : "";

    if (!queryNormalized || !responseMarkdown) {
      return jsonResponse({ error: "query_normalized and response_markdown are required" }, 400);
    }

    const serviceClient = getAdminClient();

    const { error: upsertError } = await serviceClient
      .from("exploration_cache")
      .upsert(
        { query_normalized: queryNormalized, response_markdown: responseMarkdown },
        { onConflict: "query_normalized" },
      );

    if (upsertError) {
      console.error("write-exploration-cache upsert failed:", upsertError);
      return jsonResponse({ error: "Cache write failed" }, 500);
    }

    return jsonResponse({ success: true });
  } catch (err) {
    console.error("write-exploration-cache error:", err);
    return errorResponse(err);
  }
}));
