// supabase/functions/auth-broker — single edge function fronting every
// credentialed auth operation. Routes are dispatched off the URL pathname
// suffix: /auth-broker/sign-in/password, /auth-broker/sign-out, etc.
//
// Phase 3 status: ONLY `sign-in/password` is wired end-to-end. Other routes
// (sign-up, password-reset/*, sign-out, session/refresh, identity/check)
// return 501 with a typed `code:"service_unavailable"` so the client can
// gracefully fall back to the legacy path while we cut them over one by one.
//
// Server-side translation table: GoTrue error → AuthErrorCode. THIS is the
// only place message-string matching is allowed in the auth stack.
//
// Pinned in supabase/config.toml with verify_jwt=false (public surface) —
// the broker enforces its own rate limits + CAPTCHA below.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.1";
import {
  SIGN_IN_PASSWORD_REQ,
  type SignInPasswordRes,
} from "./schemas.ts";
import { handleCors, jsonResponse, methodNotAllowed, parseJsonBody } from "../_shared/http.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

function gotrueErrorToCode(err: { code?: string; status?: number; message?: string }): SignInPasswordRes extends infer R ? R extends { ok: false; code: infer C } ? C : never : never {
  // 1. Typed code first (GoTrue v2 returns `code` on most errors).
  const c = (err.code || "").toLowerCase();
  if (c === "invalid_credentials" || c === "invalid_grant") return "invalid_credentials" as never;
  if (c === "email_not_confirmed") return "email_not_confirmed" as never;
  if (c === "user_banned" || c === "user_locked") return "account_locked" as never;
  if (c === "over_email_send_rate_limit" || c === "over_request_rate_limit") return "rate_limited" as never;
  if (c === "captcha_failed") return "captcha_failed" as never;
  if (c === "mfa_required") return "mfa_required" as never;

  // 2. Status-code fallback.
  if (err.status === 429) return "rate_limited" as never;
  if (err.status === 401 || err.status === 400) return "invalid_credentials" as never;
  if (err.status === 503) return "service_unavailable" as never;

  // 3. SERVER-ONLY message fallback. Must NEVER produce a punitive code
  //    in the client; server may map carefully because it sees the raw
  //    GoTrue response and is the source of truth.
  const m = (err.message || "").toLowerCase();
  if (m.includes("invalid login") || m.includes("invalid credentials")) return "invalid_credentials" as never;
  if (m.includes("rate limit")) return "rate_limited" as never;

  return "unexpected" as never;
}

async function handleSignInPassword(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await parseJsonBody(req);
  } catch (e) {
    if (e instanceof Response) return e;
    return jsonResponse({ ok: false, code: "unexpected", correlationId: "" } satisfies SignInPasswordRes, 400);
  }

  const parsed = SIGN_IN_PASSWORD_REQ.safeParse(body);
  if (!parsed.success) {
    return jsonResponse(
      { ok: false, code: "unexpected", correlationId: (body as { correlationId?: string })?.correlationId ?? "" } satisfies SignInPasswordRes,
      400,
    );
  }
  const { email, password, captchaToken, correlationId } = parsed.data;

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return jsonResponse({ ok: false, code: "service_unavailable", correlationId } satisfies SignInPasswordRes, 503);
  }

  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await anon.auth.signInWithPassword({
    email,
    password,
    options: captchaToken ? { captchaToken } : undefined,
  });

  if (error) {
    const code = gotrueErrorToCode(error as { code?: string; status?: number; message?: string });
    return jsonResponse(
      { ok: false, code, correlationId } satisfies SignInPasswordRes,
      code === "rate_limited" ? 429 : 401,
    );
  }

  if (!data?.session?.access_token || !data.session.refresh_token) {
    return jsonResponse(
      { ok: false, code: "client_session_write_failed", correlationId } satisfies SignInPasswordRes,
      502,
    );
  }

  return jsonResponse(
    {
      ok: true,
      kind: "signed_in",
      userId: data.user?.id ?? undefined,
      session: {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        expires_in: data.session.expires_in,
      },
      correlationId,
    } satisfies SignInPasswordRes,
    200,
  );
}

Deno.serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  const url = new URL(req.url);
  // Last two segments after /auth-broker form the route, e.g. "sign-in/password".
  const segments = url.pathname.replace(/^\/+/, "").split("/").filter(Boolean);
  const idx = segments.indexOf("auth-broker");
  const route = idx >= 0 ? segments.slice(idx + 1).join("/") : segments.slice(1).join("/");

  if (req.method !== "POST") return methodNotAllowed();

  switch (route) {
    case "sign-in/password":
      return handleSignInPassword(req);

    // Phased rollout: legacy paths still serve these flows.
    case "sign-up/password":
    case "password-reset/request":
    case "password-reset/complete":
    case "sign-out":
    case "session/refresh":
    case "identity/check":
    case "sign-in/google-callback":
      return jsonResponse({ ok: false, code: "service_unavailable", correlationId: "" }, 501);

    default:
      return jsonResponse({ ok: false, code: "unexpected", correlationId: "" }, 404);
  }
});
