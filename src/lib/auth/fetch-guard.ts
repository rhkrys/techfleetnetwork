/**
 * Global fetch guard. Composes around `window.fetch` so that ANY 401/403
 * response from a Supabase endpoint that carries a "bad JWT" signal triggers
 * exactly one local recovery: purge sb-*-auth-token, sign out, and redirect
 * to /login?reason=session_expired.
 *
 * Why: after the 2026-06-01 GoTrue signing-key rotation the SDK auto-refresh
 * loop kept hammering /user with a dead access token. Every endpoint behind
 * it (REST, RPC, edge functions) returned the same `bad_jwt` and the user
 * was wedged until they manually cleared storage. This guard turns one bad
 * response into a clean recovery, no loop, no log flood.
 */

import { isUnrecoverableAuthError, purgeLocalAuthState } from "./session-health";

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string) ?? "";
const TRIGGER_RE = /bad_jwt|invalid number of segments|token is malformed|parse or verify signature|invalid jwt|jwt expired/i;
const RECOVERY_FLAG = "__tfn_auth_wedge_recovered__";

declare global {
  // eslint-disable-next-line no-var
  var __tfn_fetch_guard_installed__: boolean | undefined;
}

export function installAuthFetchGuard(): void {
  if (typeof window === "undefined") return;
  if ((globalThis as { __tfn_fetch_guard_installed__?: boolean }).__tfn_fetch_guard_installed__) return;
  (globalThis as { __tfn_fetch_guard_installed__?: boolean }).__tfn_fetch_guard_installed__ = true;

  const origFetch = window.fetch.bind(window);

  window.fetch = async function guardedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const res = await origFetch(input as RequestInfo, init);

    if (!SUPABASE_URL) return res;
    if (res.status !== 401 && res.status !== 403) return res;

    const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
    if (!url.startsWith(SUPABASE_URL)) return res;

    // Already recovered once this page-load? Don't loop.
    const w = window as unknown as Record<string, unknown>;
    if (w[RECOVERY_FLAG]) return res;

    // Peek body without consuming the original Response stream.
    let snippet = "";
    try {
      snippet = await res.clone().text();
    } catch {
      /* opaque or already-read — give up gracefully */
    }
    const hit = TRIGGER_RE.test(snippet) || /bad_jwt|bad-jwt/i.test(res.headers.get("x-supabase-error") ?? "");
    if (!hit && !isUnrecoverableAuthError(snippet)) return res;

    w[RECOVERY_FLAG] = true;
    try {
      purgeLocalAuthState({ reason: "jwt_corrupt", source: "fetch_guard" });
    } finally {
      // Defer the redirect so the calling code can still observe the failure
      // and unwind cleanly before the page transitions.
      queueMicrotask(() => {
        try {
          const current = `${window.location.pathname}${window.location.search}`;
          const target = `/login?reason=session_expired&next=${encodeURIComponent(current)}`;
          if (window.location.pathname !== "/login") {
            window.location.replace(target);
          }
        } catch {
          /* noop */
        }
      });
    }
    return res;
  };
}
