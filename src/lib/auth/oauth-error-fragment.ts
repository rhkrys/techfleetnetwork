/**
 * OAuth broker error-fragment parser.
 *
 * The Lovable/Supabase OAuth broker returns failures as a top-level redirect
 * with `#error=<code>&error_description=<text>&state=<csrf>`. Without this
 * helper the app silently lands on the logged-out home and the user has no
 * signal about why sign-in failed.
 *
 * BDD: AUTH-OAUTH-ERROR-FRAGMENT-001..002
 */

export interface OAuthErrorFragment {
  error: string;
  description: string;
  state: string | null;
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    return value;
  }
}

export function readOAuthErrorFragment(hash: string = typeof window === "undefined" ? "" : window.location.hash): OAuthErrorFragment | null {
  if (!hash || hash.length < 2) return null;
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  // Only treat as OAuth error when `error=` is present at the start of a pair,
  // never on `#access_token=…` or `#type=recovery` fragments.
  if (!/(^|&)error=/.test(raw)) return null;
  const params = new URLSearchParams(raw);
  const error = params.get("error");
  if (!error) return null;
  return {
    error: decode(error),
    description: decode(params.get("error_description") ?? ""),
    state: params.get("state"),
  };
}

export function clearOAuthErrorFragment(): void {
  if (typeof window === "undefined") return;
  try {
    const url = `${window.location.pathname}${window.location.search}`;
    window.history.replaceState(null, "", url || "/");
  } catch {
    /* history disabled */
  }
}
