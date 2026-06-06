// @edge-auth
import { withAuditWrapper } from "../_shared/audit.ts";
/**
 * revoke-recording-consent — T&C §11. Authenticated user revokes their
 * consent for future use of a recording. Notifies info@techfleet.network.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/compliance.ts";

interface Body { session_ref?: string; reason?: string }

Deno.serve(withAuditWrapper("revoke-recording-consent", async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

  let body: Body = {};
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }
  const sessionRef = (body.session_ref || "").trim().slice(0, 128);
  if (!sessionRef) return json({ error: "session_ref_required" }, 400);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: u, error: ue } = await userClient.auth.getUser();
  if (ue || !u.user) return json({ error: "unauthorized" }, 401);

  // Upsert revoke row (insert a future-uses scope marker if no row existed yet)
  const { data: existing } = await userClient
    .from("recording_consents")
    .select("id")
    .eq("user_id", u.user.id)
    .eq("session_ref", sessionRef)
    .is("revoked_at", null)
    .limit(1);

  if (existing && existing.length > 0) {
    await userClient
      .from("recording_consents")
      .update({ revoked_at: new Date().toISOString(), revoke_reason: body.reason?.slice(0, 1000) || null, granted: false })
      .eq("id", existing[0].id);
  } else {
    await userClient
      .from("recording_consents")
      .insert({
        user_id: u.user.id,
        session_ref: sessionRef,
        scope: "future-uses",
        granted: false,
        revoked_at: new Date().toISOString(),
        revoke_reason: body.reason?.slice(0, 1000) || null,
      });
  }

  // Email notification is sent by the existing System Health digest job that
  // watches `recording_consents` for new revocations; surfaces in the admin
  // Compliance tab as well.

  return json({ ok: true });
}));
