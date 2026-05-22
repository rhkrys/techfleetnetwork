import { z } from "npm:zod@4.3.6";
import { withAuditWrapper } from "../_shared/audit.ts";
import {
  errorResponse,
  handleCors,
  jsonResponse,
  parseJsonBody,
} from "../_shared/http.ts";
import { isProductionOrigin, originHostFromRequest } from "../_shared/auth-hosts.ts";

const BodySchema = z.object({
  token: z.string().trim().min(20).max(4096),
  action: z.enum([
    "login",
    "register",
    "forgot_password",
    "signup_confirmation_resend",
  ]),
});

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

// @public-route Browser pre-auth verification endpoint. Authorization is the Cloudflare Turnstile token.

Deno.serve(withAuditWrapper("verify-turnstile", async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") {
    return jsonResponse({ success: false, error: "Method not allowed" }, 405);
  }

  // Production secret. For non-production origins (Lovable preview/sandbox/localhost)
  // we fall back to Cloudflare's "always passes" test secret so previews stay usable
  // without weakening production verification.
  const PROD_SECRET = Deno.env.get("TURNSTILE_SECRET_KEY");
  const TEST_SECRET = "1x0000000000000000000000000000000AA";

  const originHost = originHostFromRequest(req);
  const isProd = isProductionOrigin(originHost);
  const secret = isProd ? PROD_SECRET : (PROD_SECRET ?? TEST_SECRET);

  if (!secret) {
    return jsonResponse({
      success: false,
      error: "Verification is not configured",
    }, 500);
  }


  try {
    const parsed = BodySchema.safeParse(await parseJsonBody(req, 8 * 1024));
    if (!parsed.success) {
      return jsonResponse({
        success: false,
        error: "Complete the human verification before trying again.",
      }, 400);
    }
    const body = parsed.data;

    async function verifyWith(secretKey: string) {
      const form = new FormData();
      form.set("secret", secretKey);
      form.set("response", body.token);
      const r = await fetch(VERIFY_URL, { method: "POST", body: form });
      const j = await r.json().catch(() => ({})) as {
        success?: boolean;
        hostname?: string;
        "error-codes"?: string[];
      };
      return { ok: r.ok, status: r.status, body: j };
    }

    let result = await verifyWith(secret);

    // On non-production origins, the widget uses Cloudflare's test sitekey which
    // only validates against the matching test secret. Fall back transparently.
    if ((!result.ok || result.body.success !== true) && !isProductionOrigin && secret !== TEST_SECRET) {
      const fallback = await verifyWith(TEST_SECRET);
      if (fallback.ok && fallback.body.success === true) result = fallback;
    }

    if (!result.ok || result.body.success !== true) {
      console.warn("Turnstile verification failed", {
        action: body.action,
        status: result.status,
        errorCodes: result.body["error-codes"] ?? [],
        originHost,
      });
      return jsonResponse({
        success: false,
        error: "Complete the human verification before trying again.",
      }, 403);
    }


    return jsonResponse({ success: true });
  } catch (error) {
    console.error("Turnstile verification error", error);
    if (error instanceof Response) return error;
    return errorResponse(error, "Verification failed. Please try again.");
  }
}));
