import { useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { isUsableDiscordUsername } from "@/lib/discord/username";

const SESSION_FLAG = "tfn_discord_repair_attempted";
const NEG_CACHE_KEY = "tfn_discord_repair_miss";
const NEG_CACHE_TTL_MS = 5 * 60_000; // 5 minutes — matches DISCORD-LOOKUP-001..005

/**
 * Read the localStorage-backed negative cache for a given user id.
 * Returns `true` when a recent repair attempt missed and we should skip.
 */
function isNegCached(userId: string): boolean {
  try {
    const raw = localStorage.getItem(`${NEG_CACHE_KEY}:${userId}`);
    if (!raw) return false;
    const ts = Number(raw);
    if (!Number.isFinite(ts)) return false;
    if (Date.now() - ts > NEG_CACHE_TTL_MS) {
      localStorage.removeItem(`${NEG_CACHE_KEY}:${userId}`);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function recordNegCache(userId: string) {
  try { localStorage.setItem(`${NEG_CACHE_KEY}:${userId}`, String(Date.now())); } catch { /* private mode */ }
}

function clearNegCache(userId: string) {
  try { localStorage.removeItem(`${NEG_CACHE_KEY}:${userId}`); } catch { /* private mode */ }
}

/**
 * Self-heal hook: when a member signs in with a Discord link but a broken/empty
 * stored username, silently call repair-discord-username at most once per
 * session AND at most once per 5-minute window (negative cache).
 *
 * The 5-min cache prevents the retry-storm pattern seen in audit logs where
 * the same handle was looked up 3× in 60s across remounts.
 */
export function useDiscordUsernameRepair() {
  const { user, profile, refreshProfile } = useAuth();
  const attemptedRef = useRef(false);

  useEffect(() => {
    if (!user || !profile) return;
    if (attemptedRef.current) return;

    const linked = typeof profile.discord_user_id === "string" && profile.discord_user_id.trim().length > 0;
    if (!linked) return;
    if (isUsableDiscordUsername(profile.discord_username)) {
      clearNegCache(user.id); // success path — drop any stale miss
      return;
    }

    // Negative cache short-circuit — silent.
    if (isNegCached(user.id)) { attemptedRef.current = true; return; }

    try {
      if (sessionStorage.getItem(SESSION_FLAG) === user.id) return;
      sessionStorage.setItem(SESSION_FLAG, user.id);
    } catch { /* private mode */ }
    attemptedRef.current = true;

    void (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const res = await supabase.functions.invoke("repair-discord-username", {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const repaired = !res.error && (res.data as { repaired?: boolean })?.repaired;
        if (repaired) {
          clearNegCache(user.id);
          await refreshProfile();
        } else {
          // Miss or upstream error — record so we don't hammer for 5 min.
          recordNegCache(user.id);
        }
      } catch {
        recordNegCache(user.id);
      }
    })();
  }, [user, profile, refreshProfile]);
}
