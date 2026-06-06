// @edge-public
import { withAuditWrapper } from "../_shared/audit.ts";
/**
 * dsar-submit — authenticated endpoint. The user submits a Data Subject Access
 * Request (access, portability, correction, erasure, restriction, objection,
 * appeal, human-review, withdraw_consent). We insert the row via the
 * SECURITY DEFINER `submit_dsar` function and notify info@techfleet.network.
 */
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ALLOWED_TYPES = new Set([
  "access","portability","correction","erasure","restrict","object",
  "appeal","human_review","withdraw_consent",
]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(withAuditWrapper("dsar-submit", async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }
  const type = String(body.type || "");
  if (!ALLOWED_TYPES.has(type)) return json({ error: "invalid_type" }, 400);
  const payload = body.payload && typeof body.payload === "object" ? body.payload : {};
  const jurisdiction = typeof body.jurisdiction === "string" ? body.jurisdiction.slice(0, 8) : null;

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  // Verify auth
  const { data: userData, error: authErr } = await userClient.auth.getUser();
  if (authErr || !userData.user) return json({ error: "unauthorized" }, 401);

  // Use SECURITY DEFINER RPC to insert
  const { data: rpcData, error: rpcErr } = await userClient.rpc("submit_dsar", {
    _type: type,
    _payload: payload,
    _jurisdiction: jurisdiction,
  });
  if (rpcErr) return json({ error: rpcErr.message }, 500);

  // Internal notification is handled by the admin Privacy Requests view +
  // existing audit_log row written inside submit_dsar(). No separate email
  // queue exists in this project.

  return new Response(JSON.stringify({ ok: true, id: rpcData, sla_days: 30 }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}));
