// @edge-public
import { getAdminClient } from "../_shared/admin-client.ts";
import { withAuditWrapper } from "../_shared/audit.ts";
import { errorResponse, handleCors, jsonResponse, parseJsonBody } from "../_shared/http.ts";

// @public-route Token-bound RFC 8058 unsubscribe endpoint. Authorization is the single-use unsubscribe token.

Deno.serve(
  withAuditWrapper("handle-email-unsubscribe", async (req) => {
    const cors = handleCors(req);
    if (cors) return cors;

    if (req.method !== "GET" && req.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    try {
      // Extract token from query params (GET) or body (POST)
      const url = new URL(req.url);
      let token: string | null = url.searchParams.get("token");

      if (req.method === "POST") {
        // Detect RFC 8058 one-click unsubscribe: POST with form-encoded body
        // containing "List-Unsubscribe=One-Click". Email clients (Gmail, Apple Mail,
        // etc.) send this when the user clicks "Unsubscribe" in the mail UI.
        const contentType = req.headers.get("content-type") ?? "";
        if (contentType.includes("application/x-www-form-urlencoded")) {
          const formText = await req.text();
          const params = new URLSearchParams(formText);
          // For one-click, token comes from query param (already set above).
          // Otherwise, token may be in the form body.
          if (!params.get("List-Unsubscribe")) {
            const formToken = params.get("token");
            if (formToken) {
              token = formToken;
            }
          }
        } else {
          // JSON body (from the app's unsubscribe page)
          try {
            const body = (await parseJsonBody(req, 4 * 1024)) as {
              token?: unknown;
            };
            if (typeof body.token === "string") {
              token = body.token;
            }
          } catch {
            // Fall through — token stays from query param
          }
        }
      }

      if (!token) {
        return jsonResponse({ error: "Token is required" }, 400);
      }

      const supabase = getAdminClient();

      // Look up the token
      const { data: tokenRecord, error: lookupError } = await supabase
        .from("email_unsubscribe_tokens")
        .select("*")
        .eq("token", token)
        .maybeSingle();

      if (lookupError || !tokenRecord) {
        return jsonResponse({ error: "Invalid or expired token" }, 404);
      }

      if (tokenRecord.used_at) {
        return jsonResponse({ valid: false, reason: "already_unsubscribed" });
      }

      // GET: Validate token (the app's unsubscribe page calls this on load)
      if (req.method === "GET") {
        return jsonResponse({ valid: true });
      }

      // POST: Process the unsubscribe
      // Atomic check-and-update to avoid TOCTOU race
      const { data: updated, error: updateError } = await supabase
        .from("email_unsubscribe_tokens")
        .update({ used_at: new Date().toISOString() })
        .eq("token", token)
        .is("used_at", null)
        .select()
        .maybeSingle();

      if (updateError) {
        console.error("Failed to mark token as used", {
          error: updateError,
        });
        return jsonResponse({ error: "Failed to process unsubscribe" }, 500);
      }

      if (!updated) {
        return jsonResponse({ success: false, reason: "already_unsubscribed" });
      }

      // Scope-aware unsubscribe (ADR-0018): this is the platform's Tier-1 service email
      // ("Opportunities and platform updates") unsubscribe. Turn off ONLY the Tier-1 opt-out —
      // NEVER add a global suppressed_emails row, which would also stop critical account email
      // (password resets, interview invites). Global suppression is reserved for hard bounce /
      // spam complaint (via the Resend webhook). Marketing unsubscribes are Email Octopus's, not
      // this endpoint (ADR-0017).
      const { error: prefError } = await supabase.rpc("set_email_opportunities_unsubscribed", {
        p_email: tokenRecord.email,
      });

      if (prefError) {
        console.error("Failed to apply unsubscribe preference", { error: prefError });
        return jsonResponse({ error: "Failed to process unsubscribe" }, 500);
      }

      console.log("Unsubscribed from opportunities email");

      return jsonResponse({ success: true });
    } catch (error) {
      console.error("Email unsubscribe failed", error);
      return errorResponse(error, "Failed to process unsubscribe");
    }
  })
);
