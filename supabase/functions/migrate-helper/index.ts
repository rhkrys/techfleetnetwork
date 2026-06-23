// @edge-auth required
import { corsHeaders } from "../_shared/http.ts";

Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  return new Response(JSON.stringify({ ok: true }), {
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
});
