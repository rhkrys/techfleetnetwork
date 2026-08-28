// @edge-auth
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

import { corsHeaders } from "../_shared/http.ts";
import { authorizeServiceRoleRequest } from "../_shared/service-role-auth.ts";
import { withAuditWrapper } from "../_shared/audit.ts";

Deno.serve(
  withAuditWrapper("reconcile-stuck-emails", async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    const auth = authorizeServiceRoleRequest(req);
    if (!auth.ok) {
      return new Response(JSON.stringify({ error: auth.error }), {
        status: auth.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(JSON.stringify({ error: "Server configuration error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { data, error } = await supabase.rpc("reconcile_stuck_emails");
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true, result: data }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  })
);
