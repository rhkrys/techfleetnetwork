// @edge-auth required
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireFreshAdmin2fa } from "../_shared/admin-step-up.ts";

import { withAuditWrapper } from "../_shared/audit.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(withAuditWrapper("admin-sign-out-all-users", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: callerData, error: callerError } = await userClient.auth.getUser();
  if (callerError || !callerData.user) return json({ error: "Unauthorized" }, 401);

  const admin = createClient(supabaseUrl, serviceKey);
  const { data: isAdmin, error: roleError } = await admin.rpc("has_role", {
    _user_id: callerData.user.id,
    _role: "admin",
  });
  if (roleError || isAdmin !== true) return json({ error: "Forbidden" }, 403);

  const stepUp = await requireFreshAdmin2fa(admin, authHeader, callerData.user.id, 10);
  if (!stepUp.ok) return json({ error: stepUp.error }, stepUp.status);

  const users: Array<{ id: string; email?: string }> = [];
  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) return json({ error: error.message }, 500);
    const batch = data?.users ?? [];
    users.push(...batch.map((u) => ({ id: u.id, email: u.email ?? undefined })));
    if (batch.length < 1000) break;
  }

  const revokedAt = new Date().toISOString();
  const revocations = users.map((u) => ({
    user_id: u.id,
    reason: "emergency_global_signout",
    revoked_by: callerData.user.id,
    revoked_at: revokedAt,
  }));
  if (revocations.length > 0) {
    const { error } = await admin.from("revoked_sessions").insert(revocations);
    if (error) return json({ error: error.message }, 500);
  }

  const failures: Array<{ user_id: string; error: string }> = [];
  for (const user of users) {
    const { error } = await admin.auth.admin.signOut(user.id, "global");
    if (error) failures.push({ user_id: user.id, error: error.message });
  }

  await admin.rpc("write_audit_log", {
    p_event_type: "emergency_global_signout",
    p_table_name: "auth.users",
    p_record_id: null,
    p_user_id: callerData.user.id,
    p_changed_fields: [`users:${users.length}`, `failures:${failures.length}`, `revoked_at:${revokedAt}`],
    p_error_message: failures.length ? JSON.stringify(failures.slice(0, 20)) : null,
  });

  return json({ success: failures.length === 0, users_revoked: users.length, failures });
}));