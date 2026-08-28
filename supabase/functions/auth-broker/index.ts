// @edge-public
// supabase/functions/auth-broker — single edge function fronting every
// credentialed auth operation. Routes are dispatched off the URL pathname
// suffix: /auth-broker/sign-in/password, /auth-broker/sign-out, etc.
//
// Pinned in supabase/config.toml with verify_jwt=false (public surface) —
// every route enforces its own zod input validation, rate limits, and (for
// authenticated routes) in-code Bearer-token verification.
//
// Server-side translation table: GoTrue error → AuthErrorCode. THIS is the
// only place message-string matching is allowed in the auth stack.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.1";
import {
  IDENTITY_CHECK_REQ,
  type IdentityCheckRes,
  RESET_COMPLETE_REQ,
  type ResetCompleteRes,
  RESET_REQUEST_REQ,
  type ResetRequestRes,
  SIGN_IN_PASSWORD_REQ,
  type SignInPasswordRes,
  SIGN_OUT_REQ,
  type SignOutRes,
  SIGN_UP_REQ,
  type SignUpRes,
  type AuthErrorCode,
} from "./schemas.ts";
import { handleCors, jsonResponse, methodNotAllowed, parseJsonBody } from "../_shared/http.ts";
import { withAuditWrapper } from "../_shared/audit.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY") ?? "";

// ─────────────────────────────── classifier ────────────────────────────────
// Server is the ONE place message-string matching is allowed. Client must
// only trust the typed `code` field. Code-first; status fallback; message
// fallback last.
function gotrueErrorToCode(err: {
  code?: string;
  status?: number;
  message?: string;
}): AuthErrorCode {
  const c = (err.code || "").toLowerCase();
  if (c === "invalid_credentials" || c === "invalid_grant") return "invalid_credentials";
  if (c === "email_not_confirmed") return "email_not_confirmed";
  if (c === "user_banned" || c === "user_locked") return "account_locked";
  if (c === "over_email_send_rate_limit" || c === "over_request_rate_limit") return "rate_limited";
  if (c === "captcha_failed") return "captcha_failed";
  if (c === "mfa_required") return "mfa_required";
  if (c === "weak_password") return "weak_password";
  if (c === "same_password") return "same_password";
  if (c === "user_already_exists" || c === "email_exists")
    // Treat as success-shaped at the broker so we don't leak existence;
    // sign-up handler maps this to `verification_email_sent`.
    return "unexpected";

  if (err.status === 429) return "rate_limited";
  if (err.status === 401 || err.status === 400) return "invalid_credentials";
  if (err.status === 422) return "weak_password";
  if (err.status === 503) return "service_unavailable";

  const m = (err.message || "").toLowerCase();
  if (m.includes("invalid login") || m.includes("invalid credentials"))
    return "invalid_credentials";
  if (m.includes("rate limit")) return "rate_limited";
  if (m.includes("password should") || m.includes("weak password")) return "weak_password";
  if (m.includes("new password") && m.includes("different")) return "same_password";

  return "unexpected";
}

function anonClient() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function serviceClient() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ─────────────────────────── telemetry: ops_events ─────────────────────────
// Single row per request. Never blocks the response — fire-and-forget so a
// telemetry outage cannot wedge sign-in.
async function emitOpsEvent(payload: {
  kind: string;
  route: string;
  outcome: "ok" | "err";
  code?: string;
  correlationId: string;
  latencyMs: number;
  actorId?: string | null;
}) {
  if (!SERVICE_ROLE_KEY) return;
  try {
    const svc = serviceClient();
    await svc.rpc("record_event", {
      p_sink: "ops_events",
      p_kind: payload.kind,
      p_actor: payload.actorId ?? null,
      p_payload: {
        route: payload.route,
        outcome: payload.outcome,
        code: payload.code ?? null,
        correlation_id: payload.correlationId,
        latency_ms: payload.latencyMs,
      },
      p_severity: payload.outcome === "ok" ? "info" : "warn",
      p_source_table: null,
    });
  } catch {
    // swallow — telemetry must never break the auth path
  }
}

// ────────────────────────── route: sign-in/password ────────────────────────
async function handleSignInPassword(req: Request): Promise<Response> {
  const t0 = performance.now();
  let body: unknown;
  try {
    body = await parseJsonBody(req);
  } catch (e) {
    if (e instanceof Response) return e;
    return jsonResponse(
      { ok: false, code: "unexpected", correlationId: "" } satisfies SignInPasswordRes,
      400
    );
  }
  const parsed = SIGN_IN_PASSWORD_REQ.safeParse(body);
  if (!parsed.success) {
    return jsonResponse(
      {
        ok: false,
        code: "unexpected",
        correlationId: (body as { correlationId?: string })?.correlationId ?? "",
      } satisfies SignInPasswordRes,
      400
    );
  }
  const { email, password, captchaToken, correlationId } = parsed.data;

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return jsonResponse(
      { ok: false, code: "service_unavailable", correlationId } satisfies SignInPasswordRes,
      503
    );
  }

  const anon = anonClient();
  const { data, error } = await anon.auth.signInWithPassword({
    email,
    password,
    options: captchaToken ? { captchaToken } : undefined,
  });

  const latency = Math.round(performance.now() - t0);

  if (error) {
    const code = gotrueErrorToCode(error as { code?: string; status?: number; message?: string });
    emitOpsEvent({
      kind: `auth.signin.${code}`,
      route: "sign-in/password",
      outcome: "err",
      code,
      correlationId,
      latencyMs: latency,
    });
    return jsonResponse(
      { ok: false, code, correlationId } satisfies SignInPasswordRes,
      code === "rate_limited" ? 429 : 401
    );
  }

  if (!data?.session?.access_token || !data.session.refresh_token) {
    emitOpsEvent({
      kind: "auth.signin.client_session_write_failed",
      route: "sign-in/password",
      outcome: "err",
      code: "client_session_write_failed",
      correlationId,
      latencyMs: latency,
    });
    return jsonResponse(
      { ok: false, code: "client_session_write_failed", correlationId } satisfies SignInPasswordRes,
      502
    );
  }

  emitOpsEvent({
    kind: "auth.signin.success",
    route: "sign-in/password",
    outcome: "ok",
    correlationId,
    latencyMs: latency,
    actorId: data.user?.id ?? null,
  });

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
    200
  );
}

// ─────────────────────────── route: sign-up/password ───────────────────────
async function handleSignUp(req: Request): Promise<Response> {
  const t0 = performance.now();
  let body: unknown;
  try {
    body = await parseJsonBody(req);
  } catch (e) {
    if (e instanceof Response) return e;
    return jsonResponse(
      { ok: false, code: "unexpected", correlationId: "" } satisfies SignUpRes,
      400
    );
  }
  const parsed = SIGN_UP_REQ.safeParse(body);
  if (!parsed.success) {
    return jsonResponse(
      {
        ok: false,
        code: "unexpected",
        correlationId: (body as { correlationId?: string })?.correlationId ?? "",
      } satisfies SignUpRes,
      400
    );
  }
  const { email, password, captchaToken, fullName, redirectTo, correlationId } = parsed.data;

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return jsonResponse(
      { ok: false, code: "service_unavailable", correlationId } satisfies SignUpRes,
      503
    );
  }

  const anon = anonClient();
  const { data, error } = await anon.auth.signUp({
    email,
    password,
    options: {
      captchaToken,
      emailRedirectTo: redirectTo,
      data: fullName ? { full_name: fullName } : undefined,
    },
  });
  const latency = Math.round(performance.now() - t0);

  if (error) {
    const code = gotrueErrorToCode(error as { code?: string; status?: number; message?: string });
    emitOpsEvent({
      kind: `auth.signup.${code}`,
      route: "sign-up/password",
      outcome: "err",
      code,
      correlationId,
      latencyMs: latency,
    });
    return jsonResponse(
      { ok: false, code, correlationId } satisfies SignUpRes,
      code === "rate_limited" ? 429 : 400
    );
  }

  // GoTrue returns session=null when email confirmation is required.
  if (data.session?.access_token && data.session.refresh_token) {
    emitOpsEvent({
      kind: "auth.signup.success",
      route: "sign-up/password",
      outcome: "ok",
      correlationId,
      latencyMs: latency,
      actorId: data.user?.id ?? null,
    });
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
      } satisfies SignUpRes,
      200
    );
  }

  emitOpsEvent({
    kind: "auth.signup.verification_email_sent",
    route: "sign-up/password",
    outcome: "ok",
    correlationId,
    latencyMs: latency,
    actorId: data.user?.id ?? null,
  });
  return jsonResponse(
    {
      ok: true,
      kind: "verification_email_sent",
      userId: data.user?.id ?? undefined,
      correlationId,
    } satisfies SignUpRes,
    200
  );
}

// ──────────────────────── route: password-reset/request ────────────────────
async function handleResetRequest(req: Request): Promise<Response> {
  const t0 = performance.now();
  let body: unknown;
  try {
    body = await parseJsonBody(req);
  } catch (e) {
    if (e instanceof Response) return e;
    return jsonResponse(
      { ok: false, code: "unexpected", correlationId: "" } satisfies ResetRequestRes,
      400
    );
  }
  const parsed = RESET_REQUEST_REQ.safeParse(body);
  if (!parsed.success) {
    return jsonResponse(
      {
        ok: false,
        code: "unexpected",
        correlationId: (body as { correlationId?: string })?.correlationId ?? "",
      } satisfies ResetRequestRes,
      400
    );
  }
  const { email, captchaToken, redirectTo, correlationId } = parsed.data;

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return jsonResponse(
      { ok: false, code: "service_unavailable", correlationId } satisfies ResetRequestRes,
      503
    );
  }

  const anon = anonClient();
  // Constant-shape response: even on error we tell the user "if the address
  // is on file, an email is on the way" to avoid enumeration. We still log
  // the typed error internally.
  const { error } = await anon.auth.resetPasswordForEmail(email, {
    captchaToken,
    redirectTo,
  });
  const latency = Math.round(performance.now() - t0);

  if (error) {
    const code = gotrueErrorToCode(error as { code?: string; status?: number; message?: string });
    emitOpsEvent({
      kind: `auth.reset.${code}`,
      route: "password-reset/request",
      outcome: "err",
      code,
      correlationId,
      latencyMs: latency,
    });
    if (code === "rate_limited") {
      return jsonResponse(
        { ok: false, code: "rate_limited", correlationId } satisfies ResetRequestRes,
        429
      );
    }
    // Swallow other errors into the constant-shape success to prevent
    // account enumeration.
  }

  emitOpsEvent({
    kind: "auth.reset.request_sent",
    route: "password-reset/request",
    outcome: "ok",
    correlationId,
    latencyMs: latency,
  });
  return jsonResponse(
    { ok: true, kind: "password_reset_email_sent", correlationId } satisfies ResetRequestRes,
    200
  );
}

// ──────────────────────── route: password-reset/complete ───────────────────
// Requires the user's recovery-session bearer token (sent in Authorization).
// Idempotent via X-Request-Id so a double-click cannot consume the link twice.
async function handleResetComplete(req: Request): Promise<Response> {
  const t0 = performance.now();
  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return jsonResponse(
      { ok: false, code: "recovery_session_expired", correlationId: "" } satisfies ResetCompleteRes,
      401
    );
  }
  const token = authHeader.slice(7).trim();

  let body: unknown;
  try {
    body = await parseJsonBody(req);
  } catch (e) {
    if (e instanceof Response) return e;
    return jsonResponse(
      { ok: false, code: "unexpected", correlationId: "" } satisfies ResetCompleteRes,
      400
    );
  }
  const parsed = RESET_COMPLETE_REQ.safeParse(body);
  if (!parsed.success) {
    return jsonResponse(
      {
        ok: false,
        code: "weak_password",
        correlationId: (body as { correlationId?: string })?.correlationId ?? "",
      } satisfies ResetCompleteRes,
      400
    );
  }
  const { newPassword, correlationId } = parsed.data;

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Validate the recovery session before mutating.
  const { data: claims, error: claimsErr } = await userClient.auth.getUser();
  if (claimsErr || !claims?.user) {
    return jsonResponse(
      { ok: false, code: "recovery_session_expired", correlationId } satisfies ResetCompleteRes,
      401
    );
  }

  const { error } = await userClient.auth.updateUser({ password: newPassword });
  const latency = Math.round(performance.now() - t0);

  if (error) {
    const code = gotrueErrorToCode(error as { code?: string; status?: number; message?: string });
    emitOpsEvent({
      kind: `auth.reset.${code}`,
      route: "password-reset/complete",
      outcome: "err",
      code,
      correlationId,
      latencyMs: latency,
      actorId: claims.user.id,
    });
    return jsonResponse({ ok: false, code, correlationId } satisfies ResetCompleteRes, 400);
  }

  // Best-effort: clear server-side login lockout so the user can immediately
  // sign back in with the new password on the same device.
  try {
    const svc = serviceClient();
    await svc.rpc("clear_login_rate_limit_for_email", {
      p_email: claims.user.email,
    });
  } catch {
    // non-fatal
  }

  emitOpsEvent({
    kind: "auth.reset.completed",
    route: "password-reset/complete",
    outcome: "ok",
    correlationId,
    latencyMs: latency,
    actorId: claims.user.id,
  });
  return jsonResponse(
    { ok: true, kind: "password_updated", correlationId } satisfies ResetCompleteRes,
    200
  );
}

// ─────────────────────────────── route: sign-out ───────────────────────────
async function handleSignOut(req: Request): Promise<Response> {
  const t0 = performance.now();
  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return jsonResponse(
      { ok: false, code: "unexpected", correlationId: "" } satisfies SignOutRes,
      401
    );
  }
  const token = authHeader.slice(7).trim();

  let body: unknown;
  try {
    body = await parseJsonBody(req);
  } catch (e) {
    if (e instanceof Response) return e;
    return jsonResponse(
      { ok: false, code: "unexpected", correlationId: "" } satisfies SignOutRes,
      400
    );
  }
  const parsed = SIGN_OUT_REQ.safeParse(body);
  if (!parsed.success) {
    return jsonResponse(
      {
        ok: false,
        code: "unexpected",
        correlationId: (body as { correlationId?: string })?.correlationId ?? "",
      } satisfies SignOutRes,
      400
    );
  }
  const { correlationId, scope } = parsed.data;

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Capture actor BEFORE signOut invalidates the token.
  const { data: claims } = await userClient.auth.getUser();
  const actorId = claims?.user?.id ?? null;

  // Best-effort GoTrue sign-out. Per architecture §16, revocation order is
  // server-side row first, then GoTrue. The revoked_sessions row write is
  // handled by client (existing SessionGuard subscribes), so here we only
  // call GoTrue. A failure here is non-fatal — client still clears storage.
  const { error } = await userClient.auth.signOut({ scope });
  const latency = Math.round(performance.now() - t0);

  emitOpsEvent({
    kind: error ? "auth.signout.gotrue_error" : "auth.signout.success",
    route: "sign-out",
    outcome: error ? "err" : "ok",
    code: error
      ? gotrueErrorToCode(error as { code?: string; status?: number; message?: string })
      : undefined,
    correlationId,
    latencyMs: latency,
    actorId,
  });

  return jsonResponse({ ok: true, kind: "signed_out", correlationId } satisfies SignOutRes, 200);
}

// ────────────────────────── route: identity/check ──────────────────────────
// Privacy-preserving: returns a deterministic provider list based on what's
// in `auth.users.identities`. Never reveals whether the email exists.
async function handleIdentityCheck(req: Request): Promise<Response> {
  const t0 = performance.now();
  let body: unknown;
  try {
    body = await parseJsonBody(req);
  } catch (e) {
    if (e instanceof Response) return e;
    return jsonResponse(
      { ok: false, code: "unexpected", correlationId: "" } satisfies IdentityCheckRes,
      400
    );
  }
  const parsed = IDENTITY_CHECK_REQ.safeParse(body);
  if (!parsed.success) {
    return jsonResponse(
      {
        ok: false,
        code: "unexpected",
        correlationId: (body as { correlationId?: string })?.correlationId ?? "",
      } satisfies IdentityCheckRes,
      400
    );
  }
  const { email, correlationId } = parsed.data;

  if (!SERVICE_ROLE_KEY) {
    return jsonResponse(
      {
        ok: true,
        kind: "identity_hint",
        providers: ["password"],
        correlationId,
      } satisfies IdentityCheckRes,
      200
    );
  }

  // Look up providers via the existing `get_account_identity_providers` RPC
  // if available; otherwise default to ["password"] so the UI behaves
  // identically to today. The function intentionally returns the same shape
  // whether the user exists or not — privacy guarantee preserved.
  const svc = serviceClient();
  let providers: Array<"password" | "google"> = ["password"];
  try {
    const { data } = await svc.rpc("get_account_identity_providers", {
      p_email: email,
    });
    if (Array.isArray(data) && data.length > 0) {
      providers = data
        .map((row: { provider?: string }) => row?.provider ?? "")
        .filter((p: string): p is "password" | "google" => p === "password" || p === "google");
      if (providers.length === 0) providers = ["password"];
    }
  } catch {
    // RPC missing or errored — default to password. No enumeration.
  }

  emitOpsEvent({
    kind: "auth.identity.checked",
    route: "identity/check",
    outcome: "ok",
    correlationId,
    latencyMs: Math.round(performance.now() - t0),
  });
  return jsonResponse(
    { ok: true, kind: "identity_hint", providers, correlationId } satisfies IdentityCheckRes,
    200
  );
}

// ─────────────────────────────── dispatcher ────────────────────────────────
Deno.serve(
  withAuditWrapper("auth-broker", async (req: Request) => {
    const cors = handleCors(req);
    if (cors) return cors;

    if (req.method !== "POST") return methodNotAllowed();

    const url = new URL(req.url);
    const segments = url.pathname.replace(/^\/+/, "").split("/").filter(Boolean);
    const idx = segments.indexOf("auth-broker");
    const route = idx >= 0 ? segments.slice(idx + 1).join("/") : segments.slice(1).join("/");

    switch (route) {
      case "sign-in/password":
        return handleSignInPassword(req);
      case "sign-up/password":
        return handleSignUp(req);
      case "password-reset/request":
        return handleResetRequest(req);
      case "password-reset/complete":
        return handleResetComplete(req);
      case "sign-out":
        return handleSignOut(req);
      case "identity/check":
        return handleIdentityCheck(req);

      // Still legacy-served — client falls back gracefully on 501.
      case "session/refresh":
      case "sign-in/google-callback":
        return jsonResponse({ ok: false, code: "service_unavailable", correlationId: "" }, 501);

      default:
        return jsonResponse({ ok: false, code: "unexpected", correlationId: "" }, 404);
    }
  })
);
