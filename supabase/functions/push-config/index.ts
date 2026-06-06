// @edge-cron
import { withAuditWrapper } from "../_shared/audit.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(withAuditWrapper("push-config", async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const vapidPublic = Deno.env.get("VAPID_PUBLIC_KEY");

  if (!vapidPublic) {
    return new Response(
      JSON.stringify({ error: "VAPID public key not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  return new Response(
    JSON.stringify({ publicKey: vapidPublic }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}));