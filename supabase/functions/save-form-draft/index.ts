// @edge-auth
/**
 * save-form-draft — durable beacon target for useServerDraft.
 *
 * The hook prefers the supabase-js client. On `pagehide` / `visibilitychange=hidden`
 * / `lovable:pre-hmr-reload`, the browser may kill in-flight fetches before they
 * complete. This endpoint exists for that path:
 *   - navigator.sendBeacon POST (no custom headers → JWT comes in ?token=…)
 *   - or fetch({ keepalive: true }) with Authorization header
 *
 * Auth: requires a valid user JWT (header or ?token=). Writes via the user's
 * own RLS context — no service role.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import { withAuditWrapper } from "../_shared/audit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_PAYLOAD_BYTES = 262_144; // 256 KB — matches DB trigger cap
const MAX_KEY_LEN = 200;

interface DraftBody {
  draft_key: unknown;
  schema_version: unknown;
  payload: unknown;
}

function validate(
  body: DraftBody
):
  | { ok: true; draftKey: string; schemaVersion: number; payload: unknown }
  | { ok: false; error: string } {
  if (
    typeof body.draft_key !== "string" ||
    body.draft_key.length === 0 ||
    body.draft_key.length > MAX_KEY_LEN
  ) {
    return { ok: false, error: "draft_key must be a non-empty string ≤200 chars" };
  }
  if (
    typeof body.schema_version !== "number" ||
    !Number.isInteger(body.schema_version) ||
    body.schema_version < 1
  ) {
    return { ok: false, error: "schema_version must be a positive integer" };
  }
  if (body.payload === null || body.payload === undefined) {
    return { ok: false, error: "payload is required" };
  }
  return {
    ok: true,
    draftKey: body.draft_key,
    schemaVersion: body.schema_version,
    payload: body.payload,
  };
}

Deno.serve(
  withAuditWrapper("save-form-draft", async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    try {
      // JWT — header preferred, query param fallback for sendBeacon
      let token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
      if (!token) {
        const url = new URL(req.url);
        token = url.searchParams.get("token") ?? undefined;
      }
      if (!token) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Size guard before parsing
      const raw = await req.text();
      if (raw.length > MAX_PAYLOAD_BYTES) {
        return new Response(JSON.stringify({ error: "Payload exceeds 256 KB" }), {
          status: 413,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      let parsed: DraftBody;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return new Response(JSON.stringify({ error: "Invalid JSON" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const v = validate(parsed);
      if (!v.ok) {
        return new Response(JSON.stringify({ error: v.error }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
      const supabase = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { persistSession: false, autoRefreshToken: false },
      });

      const {
        data: { user },
        error: userErr,
      } = await supabase.auth.getUser();
      if (userErr || !user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { error: upsertErr } = await supabase.from("form_drafts").upsert(
        [
          {
            user_id: user.id,
            draft_key: v.draftKey,
            schema_version: v.schemaVersion,
            payload: v.payload as never,
          },
        ],
        { onConflict: "user_id,draft_key" }
      );

      if (upsertErr) {
        return new Response(JSON.stringify({ error: upsertErr.message }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: (err as Error).message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  })
);
