// Pure decision logic for the admin/teacher role-confirmation endpoints, split
// out so every security branch is unit-testable without Deno.serve or network.
//
// Audit Wave 1:
//   H12 — expiry + single-use consumption (expires_at + atomic claim in the fn).
//   H13 — hashed verify (the caller passes the row returned by the hashed RPC).
//   T-G — POST + caller-JWT ownership proof: a bare GET, an email prefetch
//         (SafeLinks/AV, which carries no session), or a signed-in NON-owner can
//         never grant a role. This is the core fix for "GET auto-confirms."

export interface PromotionRow {
  id: string;
  user_id: string;
  confirmed_at: string | null;
  expires_at: string | null;
}

export type ConfirmDecision =
  | { kind: "method_not_allowed"; status: 405 }
  | { kind: "forbidden_origin"; status: 403 }
  | { kind: "unauthenticated"; status: 401 }
  | { kind: "bad_token"; status: 400 }
  | { kind: "not_found"; status: 404 }
  | { kind: "already_confirmed"; status: 200 }
  | { kind: "expired"; status: 410 }
  | { kind: "not_owner"; status: 403 }
  | { kind: "grant"; status: 200 };

// 32 bytes hex — matches encode(gen_random_bytes(32), 'hex').
export const TOKEN_RE = /^[0-9a-f]{64}$/i;

/**
 * A missing Origin is allowed (server-to-server / same-origin invoke may omit
 * it); a PRESENT Origin must be in the allow-list. The bearer-JWT ownership
 * check below is the primary CSRF defense — an attacker page cannot read the
 * victim's access token to forge the Authorization header — so this is
 * defense-in-depth against a browser POST from an unexpected origin.
 */
export function isAllowedOrigin(origin: string | null, allowed: Set<string>): boolean {
  if (!origin) return true;
  try {
    return allowed.has(new URL(origin).origin);
  } catch {
    return false;
  }
}

export function evaluateConfirmation(input: {
  method: string;
  origin: string | null;
  allowedOrigins: Set<string>;
  callerId: string | null; // resolved from a verified JWT; null if unauthenticated
  token: string | null;
  promotion: PromotionRow | null; // row from the hashed verify RPC (or null)
  nowMs: number;
}): ConfirmDecision {
  const { method, origin, allowedOrigins, callerId, token, promotion, nowMs } = input;

  // Order matters: cheap/identity gates first so we never disclose promotion
  // state to an unauthenticated or wrong-method caller.
  if (method !== "POST") return { kind: "method_not_allowed", status: 405 };
  if (!isAllowedOrigin(origin, allowedOrigins)) return { kind: "forbidden_origin", status: 403 };
  if (!callerId) return { kind: "unauthenticated", status: 401 };
  if (!token || !TOKEN_RE.test(token)) return { kind: "bad_token", status: 400 };
  if (!promotion) return { kind: "not_found", status: 404 };
  if (promotion.confirmed_at) return { kind: "already_confirmed", status: 200 };
  if (promotion.expires_at && Date.parse(promotion.expires_at) < nowMs) {
    return { kind: "expired", status: 410 };
  }
  // Ownership proof (T-G + H11-style binding): the signed-in caller MUST be the
  // user the promotion was issued for.
  if (promotion.user_id !== callerId) return { kind: "not_owner", status: 403 };
  return { kind: "grant", status: 200 };
}
