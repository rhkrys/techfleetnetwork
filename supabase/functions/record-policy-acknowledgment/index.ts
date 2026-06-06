// @edge-auth required
import { withAuditWrapper } from "../_shared/audit.ts";
/**
 * record-policy-acknowledgment — server-side audit of policy acceptance.
 * T&C §23 / ToU §19. Stores method, IP, UA, electronic-comms consent.
 *
 * Auth: optional. Anonymous visitors may record acceptance during signup
 * (anon_id is the client-generated browser ID); authenticated users record
 * acceptance after sign-in via the version-gate.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, json, clientIp } from "../_shared/compliance.ts";

interface Body {
  policy_keys?: string[];
  version?: string;
  method?: "checkbox" | "google-oauth" | "re-accept" | "registration";
  electronic_comms?: boolean;
  anon_id?: string;
}

const VALID_KEYS = new Set([
  "terms-and-conditions",
  "terms-of-use",
  "privacy",
  "cookies",
  "accessibility",
  "code-of-conduct",
]);
const VALID_METHODS = new Set(["checkbox", "google-oauth", "re-accept", "registration"]);

Deno.serve(withAuditWrapper("record-policy-acknowledgment", async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: Body = {};
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }

  const keys = (body.policy_keys || []).filter((k) => VALID_KEYS.has(k));
  if (keys.length === 0) return json({ error: "no_valid_policy_keys" }, 400);
  if (!body.version || body.version.length > 32) return json({ error: "invalid_version" }, 400);
  if (!body.method || !VALID_METHODS.has(body.method)) return json({ error: "invalid_method" }, 400);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const authHeader = req.headers.get("authorization");
  const client = createClient(supabaseUrl, anonKey, {
    global: authHeader ? { headers: { Authorization: authHeader } } : undefined,
    auth: { persistSession: false },
  });

  const { error } = await client.rpc("record_policy_ack", {
    p_policy_keys: keys,
    p_version: body.version,
    p_method: body.method,
    p_ip: clientIp(req),
    p_user_agent: (req.headers.get("user-agent") || "").slice(0, 512),
    p_electronic_comms: !!body.electronic_comms,
    p_anon_id: body.anon_id?.slice(0, 64) ?? null,
  });
  if (error) return json({ error: error.message }, 500);

  return json({ ok: true });
}));
