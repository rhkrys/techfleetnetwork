#!/usr/bin/env node
// Fails CI if an edge function authorizes on an UNVERIFIED JWT claim or on a
// substring match of a public key — the two auth-bypass classes from the
// 2026-08 audit (C1: unsigned service_role JWT; C2: anon-key .includes()).
//
// Rule A: a file that base64-decodes a token (`atob(`) AND trusts an unverified
//         `role === "service_role"` claim. Legit decoders (aal/iat/sub) don't
//         reference the service_role role, so this is specific to the bypass.
// Rule B: authorizing by `.includes(<ANON key>)` — the anon key is public.
//
// Correct pattern: exact, constant-time match against SUPABASE_SERVICE_ROLE_KEY
// (see supabase/functions/_shared/service-role-auth.ts), or a verified admin JWT.
// Escape hatch (written justification): put `// @safe-service-auth` in the file.
//
// Scan/fail-closed/zero-scan/evidence are owned by the shared harness (_guard.mjs)
// so this guard cannot produce a false green.
import { runScanGuard } from "./_guard.mjs";

const TRUSTS_ROLE =
  /\.role\s*[!=]==?\s*["']service_role["']|["']service_role["']\s*[!=]==?\s*[\w.?]*role/;
const ANON_INCLUDES = /\.includes\(\s*[^)]*ANON[^)]*\)/i;

runScanGuard({
  name: "check-no-unsigned-jwt-auth",
  roots: ["supabase/functions"],
  include: /\.ts$/,
  exclude: /\.test\.ts$/,
  rule(src) {
    if (/\/\/\s*@safe-service-auth/.test(src)) return [];
    const out = [];
    if (/\batob\s*\(/.test(src) && TRUSTS_ROLE.test(src)) {
      out.push({
        text: 'Decodes a JWT (atob) and trusts an UNVERIFIED role="service_role" claim — use an exact constant-time SUPABASE_SERVICE_ROLE_KEY match (authorizeServiceRoleRequest) or verify the signature.',
      });
    }
    if (ANON_INCLUDES.test(src)) {
      out.push({
        text: "Authorizes via .includes() of an ANON key — the anon key is PUBLIC and can never gate privilege; require an exact service-role match or a verified admin JWT.",
      });
    }
    return out;
  },
});
