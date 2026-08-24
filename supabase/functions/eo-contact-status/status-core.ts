// Pure decision core for the eo-contact-status edge function (self-only live EO read). All I/O is
// injected so the auth/enabled/no-email/live-status branches are unit-testable offline. index.ts
// wires the real Supabase auth + profile lookup + EO client; tests wire fakes.
import type { EoContactStatus } from "../_shared/email-octopus/client.ts";

export interface StatusDeps {
  getUserId: () => Promise<string | null>; // the CALLER's id from their token (null = unauthenticated)
  eoEnabled: boolean; // EO secrets present
  getEmail: (userId: string) => Promise<string | null>; // caller's own email (self-only)
  fetchStatus: (email: string) => Promise<EoContactStatus>; // live EO read
}

export interface StatusResult {
  status: EoContactStatus;
  reason?: string;
  http: number;
}

/**
 * Resolve the caller's live marketing status. Self-only: the email comes from the authenticated
 * identity, never from the request. Soft-fails to "unknown" (HTTP 200) when EO is disabled or the
 * caller has no email, so the client falls back to the cached mirror; only a missing identity is 401.
 */
export async function resolveMarketingStatus(deps: StatusDeps): Promise<StatusResult> {
  const uid = await deps.getUserId();
  if (!uid) return { status: "unknown", reason: "unauthenticated", http: 401 };
  if (!deps.eoEnabled) return { status: "unknown", reason: "disabled", http: 200 };
  const email = await deps.getEmail(uid);
  if (!email) return { status: "unknown", reason: "no_email", http: 200 };
  return { status: await deps.fetchStatus(email), http: 200 };
}
