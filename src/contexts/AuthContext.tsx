import { createContext, useContext, useEffect, useState, useMemo, useCallback, useRef, type ReactNode } from "react";
import { toast } from "sonner";
import { AuthService } from "@/services/auth.service";
import { ProfileService, type Profile } from "@/services/profile.service";
import { DiscordNotifyService } from "@/services/discord-notify.service";
import { clearOAuthUiMarker, hasFreshOAuthUiMarker, isRootOAuthCallback, stripRootOAuthCallbackUrl } from "@/lib/oauth-ui-guard";
import i18n, { ensureLocale } from "@/i18n";
import type { User, Session } from "@supabase/supabase-js";

/**
 * One-time "linked Google to your existing account" toast.
 * Triggered when an OAuth sign-in lands on a user that ALREADY has a password
 * identity — meaning Supabase auto-linked Google to a pre-existing email/password
 * account. Reassures the user that nothing was duplicated. Shown at most once
 * per user_id, persisted in localStorage.
 */
const OAUTH_LINK_TOAST_KEY = "tfn_oauth_link_toast_shown_v1";
function maybeShowGoogleLinkToast(currentUser: User) {
  try {
    const identities = (currentUser as unknown as { identities?: Array<{ provider?: string }> }).identities;
    if (!Array.isArray(identities) || identities.length < 2) return;
    const providers = new Set(identities.map((i) => (i.provider ?? "").toLowerCase()));
    if (!providers.has("google") || !providers.has("email")) return;

    const raw = localStorage.getItem(OAUTH_LINK_TOAST_KEY);
    const shown: string[] = raw ? JSON.parse(raw) : [];
    if (shown.includes(currentUser.id)) return;

    toast.success(
      "Linked Google to your existing account. You can now sign in with either your password or Google.",
      { duration: 30000, position: "top-center" },
    );
    shown.push(currentUser.id);
    localStorage.setItem(OAUTH_LINK_TOAST_KEY, JSON.stringify(shown.slice(-50)));
  } catch {
    /* non-critical */
  }
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  profileLoaded: boolean;
  signOut: () => Promise<void>;
  signOutAllDevices: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

// Stash the context on globalThis so HMR re-imports of this module reuse the
// SAME context instance. Without this, Vite's hot-reload can produce two
// distinct React contexts in memory: AuthProvider writes to one, useAuth reads
// from the other, and consumers throw "useAuth must be used within AuthProvider"
// — surfaced to users as "authorization failed" on the login screen.
const GLOBAL_KEY = "__tfn_auth_context__";
const GLOBAL_VALUE_KEY = "__tfn_auth_context_value__";
const SESSION_STARTED_AT_KEY = "session_started_at";
type GlobalWithCtx = typeof globalThis & {
  [GLOBAL_KEY]?: React.Context<AuthContextType | undefined>;
  [GLOBAL_VALUE_KEY]?: AuthContextType;
};
const g = globalThis as GlobalWithCtx;
const existingAuthCtx = g[GLOBAL_KEY];
const freshAuthCtx = existingAuthCtx ?? createContext<AuthContextType | undefined>(undefined);

// Dev-time duplicate-context detector: surfaces HMR module duplication
// instantly instead of letting it silently break auth for users.
if (import.meta.env?.DEV && existingAuthCtx && existingAuthCtx !== freshAuthCtx) {
  throw new Error(
    "[AuthContext] Duplicate context instance detected on globalThis. " +
      "This usually means HMR loaded two copies of AuthContext.tsx. " +
      "Check for non-canonical import paths (must be @/contexts/AuthContext)."
  );
}

const AuthContext: React.Context<AuthContextType | undefined> = freshAuthCtx;
g[GLOBAL_KEY] = AuthContext;

function isInvalidRefreshTokenAuthError(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error ?? "").toLowerCase();
  return message.includes("refresh token") &&
    (message.includes("invalid") ||
      message.includes("not found") ||
      message.includes("missing") ||
      message.includes("expired") ||
      message.includes("revoked") ||
      message.includes("already used") ||
      message.includes("reuse"));
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const authEventSessionRef = useRef<Session | null>(null);
  const sessionRestoreSettledRef = useRef(false);

  const fetchProfile = useCallback(async (userId: string) => {
    try {
      // Race against a 10s safety timeout so a stalled network call can never
      // pin profileLoaded=false forever (which used to strand users behind a
      // full-page spinner on /dashboard, /updates, etc.).
      const data = await Promise.race([
        ProfileService.fetch(userId),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 10_000)),
      ]);
      // Only update profile if we got data — never null-out an existing profile during re-fetches
      if (data) {
        setProfile(data);
      }
      return data;
    } catch {
      return null;
    } finally {
      setProfileLoaded(true);
    }
  }, []);

  /** For Google OAuth users, sync their Google metadata to the profile if names are empty */
  const syncOAuthProfile = useCallback(async (currentUser: User, currentProfile: Profile | null) => {
    if (!currentProfile) return;
    const meta = currentUser.user_metadata;
    if (!meta) return;

    const needsNameSync = !currentProfile.first_name || !currentProfile.last_name;
    const needsEmailSync = !currentProfile.email && currentUser.email;

    if (!needsNameSync && !needsEmailSync) return;

    const firstName = meta.given_name || meta.first_name || "";
    const lastName = meta.family_name || meta.last_name || "";

    if (!needsNameSync && needsEmailSync) {
      try {
        await ProfileService.updateNames(currentUser.id, currentProfile.first_name, currentProfile.last_name, currentUser.email);
        await fetchProfile(currentUser.id);
      } catch { /* Non-critical */ }
      return;
    }

    if (!firstName && !lastName && !needsEmailSync) return;

    try {
      await ProfileService.updateNames(currentUser.id, firstName, lastName, currentUser.email || undefined);
      await fetchProfile(currentUser.id);
    } catch {
      // Non-critical
    }
  }, [fetchProfile]);

  const refreshProfile = useCallback(async () => {
    if (user) await fetchProfile(user.id);
  }, [user, fetchProfile]);

  // Restore the user's saved language whenever their profile loads — without
  // this, picking a language only persists; sign-in on another device would
  // not surface the preference. Skip when no preference, or when it already
  // matches the active i18next language. Best-effort: never throws.
  useEffect(() => {
    const pref = profile?.preferred_language;
    if (!pref) return;
    const current = (i18n.language || "en").toLowerCase();
    if (current === pref.toLowerCase()) return;
    void (async () => {
      try {
        await ensureLocale(pref, "common");
        await i18n.changeLanguage(pref);
        try { localStorage.setItem("tf_lang", pref); } catch { /* private mode */ }
      } catch { /* non-critical */ }
    })();
  }, [profile?.preferred_language]);

  useEffect(() => {
    const { data: { subscription } } = AuthService.onAuthStateChange(
      async (_event, session) => {
        if (_event === "SIGNED_OUT") {
          AuthService.clearLocalAuthState();
        }

        // Note: We previously force-signed-out users on SIGNED_IN at the root
        // OAuth callback URL when the local "UI initiated" marker was missing.
        // That guard was redundant — Supabase already validates the OAuth code
        // / PKCE state cryptographically before emitting SIGNED_IN — and it
        // caused real users to bounce to the logged-out home page whenever the
        // marker was lost (cross-origin redirects between apex/www, Safari ITP
        // partitioning sessionStorage during the third-party bounce, private
        // browsing modes, etc.). We now just clean the URL and continue.
        if (_event === "SIGNED_IN" && isRootOAuthCallback() && !hasFreshOAuthUiMarker()) {
          stripRootOAuthCallbackUrl();
        }

        // Firefox can emit INITIAL_SESSION before storage-backed getSession()
        // has finished restoring tokens. Do not mark auth as ready from that
        // early event or protected routes can bounce/reload during sign-in.
        if (_event === "INITIAL_SESSION" && !sessionRestoreSettledRef.current) {
          authEventSessionRef.current = session;
          if (session?.user) {
            setSession(session);
            setUser(session.user);
            void fetchProfile(session.user.id);
          }
          return;
        }

        // For token refreshes, only update session/user if the user ID actually changed
        if (_event === "TOKEN_REFRESHED") {
          setSession((prev) => {
            if (prev?.access_token === session?.access_token) return prev;
            return session;
          });
          return;
        }

        authEventSessionRef.current = session;
        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) {
          if (_event === "SIGNED_IN") {
            if (isRootOAuthCallback()) {
              clearOAuthUiMarker();
              stripRootOAuthCallbackUrl();
            }
            if (!sessionStorage.getItem(SESSION_STARTED_AT_KEY)) {
              sessionStorage.setItem(
                SESSION_STARTED_AT_KEY,
                JSON.stringify({ version: 1, userId: session.user.id, startedAtMs: Date.now() }),
              );

              const createdAt = session.user.created_at ? new Date(session.user.created_at).getTime() : 0;
              const isNewAccount = Date.now() - createdAt < 2 * 60 * 1000;
              if (isNewAccount) {
                const meta = session.user.user_metadata;
                const name = meta?.full_name || meta?.first_name || session.user.email || "Someone";
                DiscordNotifyService.userSignedUp(name);
              }

            }
          }
          setTimeout(async () => {
            const p = await fetchProfile(session.user.id);
            if (_event === "SIGNED_IN") {
              await syncOAuthProfile(session.user, p);
              maybeShowGoogleLinkToast(session.user);
            }
          }, 0);
        } else {
          setProfile(null);
          // No user → nothing to load. Mark loaded so guards proceed to redirect
          // instead of spinning forever on logged-out / expired-session loads.
          setProfileLoaded(true);
        }
        setLoading(false);
      }
    );

    AuthService.getSession()
      .then((initialSession) => {
        sessionRestoreSettledRef.current = true;
        const freshEventSession = authEventSessionRef.current;
        const resolvedSession = initialSession ?? freshEventSession;

        setSession(resolvedSession);
        setUser(resolvedSession?.user ?? null);
        if (resolvedSession?.user) {
          void fetchProfile(resolvedSession.user.id);
        } else {
          setProfile(null);
          setProfileLoaded(true);
        }
      })
      .catch((error) => {
        sessionRestoreSettledRef.current = true;
        if (isInvalidRefreshTokenAuthError(error)) {
          AuthService.clearLocalAuthState();
        }
        setSession(null);
        setUser(null);
        setProfile(null);
        setProfileLoaded(true);
      })
      .finally(() => setLoading(false));

    return () => subscription.unsubscribe();
  }, [fetchProfile, syncOAuthProfile]);

  const signOut = useCallback(async () => {
    await AuthService.signOut();
    setUser(null);
    setSession(null);
    setProfile(null);
    setProfileLoaded(true);
  }, []);

  const signOutAllDevices = useCallback(async () => {
    await AuthService.signOutAllDevices();
    setUser(null);
    setSession(null);
    setProfile(null);
    setProfileLoaded(true);
  }, []);

  const contextValue = useMemo(
    () => ({ user, session, profile, loading, profileLoaded, signOut, signOutAllDevices, refreshProfile }),
    [user, session, profile, loading, profileLoaded, signOut, signOutAllDevices, refreshProfile]
  );

  // Resolve the canonical context from globalThis at render time so HMR can't
  // make AuthProvider write to a different instance than useAuth reads from.
  const Canonical = (globalThis as GlobalWithCtx)[GLOBAL_KEY] ?? AuthContext;
  (globalThis as GlobalWithCtx)[GLOBAL_VALUE_KEY] = contextValue;
  return (
    <Canonical.Provider value={contextValue}>
      {children}
    </Canonical.Provider>
  );
}

export function useAuth() {
  // Always resolve the context from globalThis at call time. This guarantees we
  // read from the SAME context instance the AuthProvider is writing to, even
  // after Vite HMR re-evaluates one of the modules involved.
  const globals = globalThis as GlobalWithCtx;
  const canonical = globals[GLOBAL_KEY] ?? AuthContext;
  const ctx = useContext(canonical) ?? globals[GLOBAL_VALUE_KEY];
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

if (import.meta.hot) {
  import.meta.hot.accept(() => {
    // Let draft/autosave hooks flush via beacon before the page goes away.
    try { window.dispatchEvent(new Event("lovable:pre-hmr-reload")); } catch { /* noop */ }
    // Give the synchronous beacon a tick before reloading.
    queueMicrotask(() => window.location.reload());
  });
}
