// @edge-auth
// Live per-user Email Octopus status read (ADR-0017). Returns the CALLER's own marketing
// subscription status as EO (the source of truth) currently sees it, so the platform reflects
// subscribes/unsubscribes made outside the platform (e.g. a blog newsletter signup) too.
//
// Self-only: the email is derived from the caller's authenticated identity (never a request
// parameter), so a member can only read their own status. EO is called server-side (key never in
// the browser). Never hard-fails: any EO problem returns {status:"unknown"} and the client falls
// back to the cached mirror (get_my_marketing_subscription).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

import { eoConfigFromEnv, fetchContactStatus } from "../_shared/email-octopus/client.ts";
import { withAuditWrapper } from "../_shared/audit.ts";
import { resolveMarketingStatus } from "./status-core.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(
  withAuditWrapper("eo-contact-status", async (req) => {
    if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

    const authHeader = req.headers.get("Authorization");
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const cfg = eoConfigFromEnv(Deno.env);
    const svc = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const result = await resolveMarketingStatus({
      // Resolve the caller from THEIR token — this is what makes the read self-only.
      getUserId: async () => {
        if (!authHeader) return null;
        const authClient = createClient(url, anon, {
          global: { headers: { Authorization: authHeader } },
        });
        const {
          data: { user },
        } = await authClient.auth.getUser();
        return user?.id ?? null;
      },
      eoEnabled: cfg !== null,
      getEmail: async (userId) => {
        const { data: prof } = await svc
          .from("profiles")
          .select("email")
          .eq("user_id", userId)
          .maybeSingle();
        const email = String(prof?.email ?? "")
          .trim()
          .toLowerCase();
        return email || null;
      },
      fetchStatus: async (email) => (await fetchContactStatus(cfg!, email)).status,
    });

    return json({ status: result.status, reason: result.reason }, result.http);
  })
);
