// @edge-auth required
// Admin-only utility: hard-delete an auth.users row by email (and any cascading
// public-schema records). Solves the "ghost account" problem where a manual
// SQL wipe of public.profiles cannot touch auth.users (no SQL grant on the auth
// schema), leaving an orphan that makes Supabase Auth reject re-registration
// with "User already registered" and silently refuses password recovery.
//
// Caller must be an authenticated admin. The function re-verifies the role
// server-side via has_role() — never trust client claims.

import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@4.3.6";
import { requireFreshAdmin2fa } from "../_shared/admin-step-up.ts";

// M-01: Lenient shape guard. Existing email regex + 320-char cap below stay authoritative.
const BodySchema = z.object({ email: z.string().optional() }).passthrough();

import { withAuditWrapper } from "../_shared/audit.ts";

const RATE_LIMIT_PEPPER = "::tfn-rate-limit-v1";
const textEncoder = new TextEncoder();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function hashRateLimitIdentifier(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    textEncoder.encode(value + RATE_LIMIT_PEPPER)
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(
  withAuditWrapper("admin-purge-auth-user", async (req) => {
    if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
    if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;

    // 1) Verify caller is an authenticated admin.
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return jsonResponse({ error: "Unauthorized" }, 401);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return jsonResponse({ error: "Unauthorized" }, 401);

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: isAdmin, error: roleErr } = await admin.rpc("has_role", {
      _user_id: userData.user.id,
      _role: "admin",
    });
    if (roleErr || isAdmin !== true) return jsonResponse({ error: "Forbidden" }, 403);

    const stepUp = await requireFreshAdmin2fa(admin, authHeader, userData.user.id, 10);
    if (!stepUp.ok) return jsonResponse({ error: stepUp.error }, stepUp.status);

    // 2)) Parse + validate input.
    let email: string;
    try {
      const rawBody = await req.json();
      const parsedBody = BodySchema.safeParse(rawBody);
      if (!parsedBody.success) return jsonResponse({ error: "Invalid body" }, 400);
      email = String(parsedBody.data?.email ?? "")
        .trim()
        .toLowerCase();
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, 400);
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) {
      return jsonResponse({ error: "A valid email is required" }, 400);
    }

    // 3) Look the user up via the auth admin API (paginate up to 10k accounts).
    let target: { id: string; email: string } | null = null;
    for (let page = 1; page <= 10; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) {
        console.error("[admin-purge-auth-user] listUsers failed:", error);
        return jsonResponse({ error: "Failed to query users" }, 500);
      }
      const users = data?.users ?? [];
      const hit = users.find((u) => (u.email ?? "").toLowerCase() === email);
      if (hit) {
        target = { id: hit.id, email: hit.email ?? email };
        break;
      }
      if (users.length < 1000) break;
    }

    // 4) Best-effort cleanup of related public-schema rows so a fresh signup is clean.
    //    We do NOT fail the whole request on per-table errors — log + continue.
    const cleanupResults: Record<string, string> = {};

    if (target) {
      if (target.id === userData.user.id) {
        return jsonResponse({ error: "Admins cannot delete their own account." }, 400);
      }

      const { data: targetIsAdmin, error: targetRoleErr } = await admin.rpc("has_role", {
        _user_id: target.id,
        _role: "admin",
      });
      if (targetRoleErr) {
        console.error("[admin-purge-auth-user] has_role check failed:", targetRoleErr);
        return jsonResponse({ error: "Role check failed" }, 500);
      }
      if (targetIsAdmin === true) {
        const { count: remainingAdmins, error: adminCountErr } = await admin
          .from("user_roles")
          .select("id", { head: true, count: "exact" })
          .eq("role", "admin")
          .neq("user_id", target.id);
        if (adminCountErr) {
          console.error("[admin-purge-auth-user] admin count failed:", adminCountErr);
          return jsonResponse({ error: "Admin count check failed" }, 500);
        }
        if ((remainingAdmins ?? 0) < 1) {
          return jsonResponse({ error: "Cannot delete the last remaining admin account." }, 400);
        }
      }

      // NOTE: We deliberately no longer delete user_id-keyed rows here.
      // The DB trigger `on_auth_user_deleted` (BEFORE DELETE on auth.users)
      // cascades to every public.* table referencing this user inside one
      // transaction. Doing it here too created a partial-purge window
      // (profile gone, auth row left behind => "ghost account" blocking
      // re-signup with the same email).
      cleanupResults.user_id_cascade = "handled-by-trigger";
    }

    // Always try to clear email-keyed records (covers cases where there is no
    // auth row but suppression / log entries exist).
    const tablesByEmail = [
      "suppressed_emails",
      "failed_login_attempts",
      "email_unsubscribe_tokens",
    ];
    for (const t of tablesByEmail) {
      const { error } = await admin.from(t).delete().eq("email", email);
      cleanupResults[t] = error ? `error: ${error.message}` : "ok";
    }

    const hashedRateLimitIdentifier = await hashRateLimitIdentifier(email);
    const { error: rateLimitError } = await admin
      .from("rate_limits")
      .delete()
      .in("identifier", [hashedRateLimitIdentifier, email])
      .in("action", ["signup_attempt", "password_reset", "login_attempt"]);
    cleanupResults.rate_limits = rateLimitError ? `error: ${rateLimitError.message}` : "ok";

    // 5) Hard-delete the auth user (uses service role; bypasses the SQL grant gap).
    let authDeleted = false;
    if (target) {
      const { error: delErr } = await admin.auth.admin.deleteUser(target.id);
      if (delErr) {
        return jsonResponse(
          { error: `Auth delete failed: ${delErr.message}`, cleanupResults },
          500
        );
      }
      authDeleted = true;
    }

    // 6) Audit trail so admins can see who purged whom and why.
    await admin.rpc("write_audit_log", {
      p_event_type: "admin_purge_auth_user",
      p_table_name: "auth.users",
      p_record_id: target?.id ?? null,
      p_user_id: userData.user.id,
      p_changed_fields: [`email:${email}`, `auth_deleted:${authDeleted}`],
      p_error_message: null,
    });

    return jsonResponse({
      ok: true,
      email,
      auth_deleted: authDeleted,
      auth_user_id: target?.id ?? null,
      cleanup: cleanupResults,
      note: target
        ? "Auth account and related app data removed."
        : "No auth account existed for this email; only email-keyed records were checked.",
    });
  })
);
