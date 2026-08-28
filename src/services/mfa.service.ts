import { supabase } from "@/integrations/supabase/client";
import { createLogger } from "@/services/logger.service";
import { isValidTotpCode } from "@/lib/security";
import { withTransientRetry } from "@/lib/data/transient-retry";
import { withAuthLockRetry } from "@/lib/auth/auth-lock-retry";
import {
  classifyMfaError,
  MfaInvalidCodeError,
  MfaSessionEscalationError,
  MfaTransientError,
} from "@/services/errors/mfa-errors";
const log = createLogger("MfaService");

// Re-export for callers (dialogs) so they don't reach into services/errors/.
export { MfaInvalidCodeError, MfaTransientError, MfaSessionEscalationError };

export interface TotpFactor {
  id: string;
  friendly_name?: string;
  factor_type: "totp" | "phone";
  status: "verified" | "unverified";
  created_at: string;
  updated_at: string;
}

export interface EnrollTotpResult {
  factorId: string;
  qrCode: string; // SVG data URI
  secret: string; // Base32 secret for manual entry
  uri: string; // otpauth:// URI
}

/**
 * Industry-standard TOTP MFA service.
 * Uses Supabase's built-in auth.mfa API (RFC 6238 compliant).
 * Compatible with Google Authenticator, Authy, 1Password, Microsoft Authenticator, etc.
 */
// Module-level micro-cache for listFactors. The MFA gate runs on every auth
// state change + window focus, so we deduplicate listFactors() calls within a
// short window to avoid hammering the auth API. The cache is per-tab and
// invalidated on enroll/unenroll/verifyEnrollment so a freshly verified factor
// is observed by the next gate poll without waiting for TTL expiry.
const FACTOR_CACHE_TTL_MS = 60_000;
let factorCache: { at: number; value: TotpFactor[] } | null = null;
let factorCacheInflight: Promise<TotpFactor[]> | null = null;
// Bumped on every invalidation. An in-flight listFactors() captures the gen at
// request time and only seeds the cache if it still matches on resolution — so a
// fetch already awaiting when SIGNED_OUT (or enroll/unenroll/verify) fired can't
// re-seed the previous user's factors after the reset (audit P35 race).
let factorCacheGen = 0;
function invalidateFactorCache() {
  factorCache = null;
  factorCacheInflight = null;
  factorCacheGen++;
}
function decodeAalFromToken(token: string | undefined | null): string | null {
  if (!token) return null;
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const normalized = payload
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(payload.length / 4) * 4, "=");
    const decoded = JSON.parse(atob(normalized));
    return typeof decoded?.aal === "string" ? decoded.aal : null;
  } catch {
    return null;
  }
}
/** Test-only: reset module caches between cases. Not for production callers. */
export function __resetMfaServiceCachesForTests() {
  invalidateFactorCache();
}

/**
 * Clear per-tab MFA caches on sign-out. The factor list is a module-global cached
 * for 60s; without this, the NEXT user to sign in on the same tab within the TTL
 * would read the previous user's enrolled factors (audit P35). AuthContext calls
 * this from its SIGNED_OUT handler.
 */
export function resetMfaCachesForSignOut() {
  invalidateFactorCache();
}

export const MfaService = {
  /** List all enrolled MFA factors for the current user. Cached 60s per tab. */
  async listFactors(opts?: { force?: boolean }): Promise<TotpFactor[]> {
    if (!opts?.force && factorCache && Date.now() - factorCache.at < FACTOR_CACHE_TTL_MS) {
      return factorCache.value;
    }
    if (!opts?.force && factorCacheInflight) return factorCacheInflight;
    const gen = factorCacheGen;
    const fetchOnce = (async () => {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) {
        log.error("listFactors", `Failed: ${error.message}`, undefined, error);
        throw new Error("Could not load MFA factors");
      }
      const value = (data?.all ?? []) as TotpFactor[];
      // Only seed if no invalidation (e.g. SIGNED_OUT) happened while in flight,
      // so we never re-cache a signed-out user's factors (audit P35 race).
      if (gen === factorCacheGen) {
        factorCache = { at: Date.now(), value };
      }
      return value;
    })();
    factorCacheInflight = fetchOnce;
    try {
      return await fetchOnce;
    } finally {
      factorCacheInflight = null;
    }
  },

  /** Begin TOTP enrollment. Returns QR code + secret to display to the user. */
  async enrollTotp(friendlyName: string): Promise<EnrollTotpResult> {
    // Clean up any prior unverified factors with the same name to avoid conflicts
    const existing = await this.listFactors();
    for (const f of existing) {
      if (f.factor_type === "totp" && f.status === "unverified") {
        await supabase.auth.mfa.unenroll({ factorId: f.id });
      }
    }

    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: friendlyName || `Authenticator ${new Date().toLocaleDateString()}`,
    });
    if (error || !data) {
      log.error("enrollTotp", `Failed: ${error?.message}`, undefined, error);
      throw new Error(error?.message || "Failed to start MFA enrollment");
    }
    invalidateFactorCache();
    return {
      factorId: data.id,
      qrCode: data.totp.qr_code,
      secret: data.totp.secret,
      uri: data.totp.uri,
    };
  },

  /** Verify the 6-digit code from the authenticator app to activate the factor. */
  async verifyEnrollment(factorId: string, code: string): Promise<void> {
    const normalizedCode = code.replace(/\s/g, "");
    if (!isValidTotpCode(normalizedCode))
      throw new Error("Enter the 6-digit code from your authenticator app.");
    const { data: challengeData, error: challengeErr } = await supabase.auth.mfa.challenge({
      factorId,
    });
    if (challengeErr || !challengeData) {
      log.error(
        "verifyEnrollment",
        `Challenge failed: ${challengeErr?.message}`,
        undefined,
        challengeErr
      );
      throw new Error("Failed to create challenge");
    }
    const { error: verifyErr } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challengeData.id,
      code: normalizedCode,
    });
    if (verifyErr) {
      log.warn("verifyEnrollment", `Invalid code: ${verifyErr.message}`);
      throw new Error("Invalid verification code. Please try again.");
    }
    invalidateFactorCache();
    log.info("verifyEnrollment", "TOTP factor enrolled successfully");
  },

  /** Remove an MFA factor. */
  async unenroll(factorId: string): Promise<void> {
    const { error } = await supabase.auth.mfa.unenroll({ factorId });
    if (error) {
      log.error("unenroll", `Failed: ${error.message}`, undefined, error);
      throw new Error("Could not remove MFA factor");
    }
    invalidateFactorCache();
    log.info("unenroll", "MFA factor removed");
  },

  /**
   * Authoritative MFA gate decision used by both LoginPage and MfaEnforcementGuard.
   *
   * Why this exists: `supabase.auth.mfa.getAuthenticatorAssuranceLevel()` reads
   * AAL/AMR claims from the JWT, which can be stale (especially after signing-key
   * rotation) and report `currentLevel: aal1, nextLevel: aal1` even when the
   * user has a verified TOTP factor. That stale state caused the dialog to
   * silently skip enforcement. We now derive the decision from two sources we
   * trust:
   *   1. `listFactors()` — the source of truth for enrollment.
   *   2. The `aal` claim decoded directly from `session.access_token`.
   *
   * Result: any user (admin or member) with a verified TOTP factor whose current
   * session is below AAL2 will be challenged. Users without a verified factor
   * are never prompted. No reliance on `nextLevel`.
   */
  async getMfaGateDecision(): Promise<{
    hasVerifiedTotp: boolean;
    currentAal: string | null;
    needsChallenge: boolean;
  }> {
    let hasVerifiedTotp = false;
    try {
      const factors = await this.listFactors();
      hasVerifiedTotp = factors.some((f) => f.factor_type === "totp" && f.status === "verified");
    } catch (e) {
      log.warn(
        "getMfaGateDecision",
        `listFactors failed (failing closed): ${e instanceof Error ? e.message : String(e)}`
      );
      return { hasVerifiedTotp: false, currentAal: null, needsChallenge: false };
    }

    let currentAal: string | null = null;
    try {
      // Wrap in auth-lock retry: ProfileService.fetch and this call race
      // for GoTrue's Web Lock during identity bootstrap and one can throw
      // `AbortError: Lock broken by another request with the 'steal' option`.
      const { data } = await withAuthLockRetry(() => supabase.auth.getSession());
      currentAal = decodeAalFromToken(data.session?.access_token);
    } catch {
      currentAal = null;
    }

    const needsChallenge = hasVerifiedTotp && currentAal !== "aal2";
    return { hasVerifiedTotp, currentAal, needsChallenge };
  },

  /**
   * Backward-compatible wrapper. Delegates to `getMfaGateDecision` so all
   * callers benefit from the resilient logic.
   */
  async getAssuranceLevel(): Promise<{
    currentLevel: string | null;
    nextLevel: string | null;
    needsChallenge: boolean;
  }> {
    const decision = await this.getMfaGateDecision();
    return {
      currentLevel: decision.currentAal,
      nextLevel: decision.needsChallenge ? "aal2" : decision.currentAal,
      needsChallenge: decision.needsChallenge,
    };
  },

  async hasVerifiedTotp(): Promise<boolean> {
    const factors = await this.listFactors();
    return factors.some((f) => f.factor_type === "totp" && f.status === "verified");
  },

  /**
   * Pre-create a challenge. DEPRECATED for the login/step-up flow — dialogs
   * should call `challengeAndVerifyResilient` so the challenge is created
   * microseconds before verify and cannot expire while the user types. Kept
   * for `verifyEnrollment` and tests.
   */
  async createChallenge(factorId: string): Promise<string> {
    const { data, error } = await withTransientRetry(
      async () => {
        const out = await supabase.auth.mfa.challenge({ factorId });
        if (out.error) throw out.error;
        return out;
      },
      { retries: 2, baseDelayMs: 400, maxDelayMs: 1500 }
    );
    if (error || !data) throw new Error("Failed to create MFA challenge");
    return data.id;
  },

  /**
   * DEPRECATED — use `challengeAndVerifyResilient`. Kept only so an existing
   * pre-created challenge can still be verified directly (test paths). New
   * UI code MUST NOT pre-create challenges: a stale challenge is the root
   * cause of "Invalid TOTP code" 422s for codes the user typed correctly.
   */
  async verifyChallenge(factorId: string, challengeId: string, code: string): Promise<void> {
    const normalizedCode = code.replace(/\s/g, "");
    if (!isValidTotpCode(normalizedCode))
      throw new MfaInvalidCodeError("Enter the 6-digit code from your authenticator app.");
    const { data, error } = await supabase.auth.mfa.verify({
      factorId,
      challengeId,
      code: normalizedCode,
    });
    if (error) {
      log.warn("verifyChallenge", `verify failed: ${error.message}`);
      throw classifyMfaError(error);
    }
    await this.persistAal2Session(data);
  },

  /**
   * Resilient login/step-up MFA. Single round-trip via GoTrue's
   * `challengeAndVerify` (challenge is created microseconds before verify,
   * cannot expire). Wrapped in transient retry that retries ONLY on
   * 504/timeout/network/AbortError — NEVER on 422 (a real "invalid code"
   * must not be silently retried, would burn TOTP attempts and rate-limit).
   *
   * Throws one of: MfaInvalidCodeError | MfaTransientError |
   * MfaSessionEscalationError. UI dialogs map these to friendly toasts.
   */
  async challengeAndVerifyResilient(factorId: string, code: string): Promise<void> {
    const normalizedCode = code.replace(/\s/g, "");
    if (!isValidTotpCode(normalizedCode)) {
      throw new MfaInvalidCodeError("Enter the 6-digit code from your authenticator app.");
    }

    let lastClassified: unknown = null;
    const result = await withTransientRetry(
      async () => {
        // Hard client-side ceiling — GoTrue self-times-out at 11s, so 20s
        // gives us 9s of network/edge headroom and prevents a hung socket
        // from blocking the dialog indefinitely if the server never replies.
        const ac = new AbortController();
        const timer = setTimeout(
          () => ac.abort(new DOMException("MFA verify timed out", "AbortError")),
          20_000
        );
        try {
          const callPromise = supabase.auth.mfa.challengeAndVerify({
            factorId,
            code: normalizedCode,
          });
          const out = await Promise.race([
            callPromise,
            new Promise<never>((_, reject) => {
              ac.signal.addEventListener(
                "abort",
                () => reject(ac.signal.reason ?? new Error("aborted")),
                { once: true }
              );
            }),
          ]);
          if (out.error) throw out.error;
          return out;
        } finally {
          clearTimeout(timer);
        }
      },
      {
        retries: 2,
        baseDelayMs: 400,
        maxDelayMs: 1500,
        // Critical: NEVER retry MfaInvalidCodeError — would burn the user's
        // TOTP attempts on a real wrong code. Only retry transient blips.
        shouldRetry: (err) => {
          const classified = classifyMfaError(err);
          lastClassified = classified;
          return classified instanceof MfaTransientError;
        },
        onRetry: (err) => {
          log.warn(
            "challengeAndVerifyResilient",
            `Transient MFA failure, retrying: ${(err as Error)?.message ?? String(err)}`
          );
        },
      }
    ).catch((err) => {
      // Re-throw as typed error. `lastClassified` captures the final
      // classification so callers always get the right MfaError subclass.
      throw lastClassified ?? classifyMfaError(err);
    });

    await this.persistAal2Session(result.data);
  },

  /** Back-compat alias. Routes through the resilient implementation. */
  async challengeAndVerify(factorId: string, code: string): Promise<void> {
    return this.challengeAndVerifyResilient(factorId, code);
  },

  /** Persist the AAL2 tokens returned by mfa.verify into the local session. */
  async persistAal2Session(
    data: { access_token?: string; refresh_token?: string } | null | undefined
  ): Promise<void> {
    const aalFromVerify = decodeAalFromToken(data?.access_token);
    if (!data?.access_token || !data?.refresh_token || aalFromVerify !== "aal2") {
      log.error("persistAal2Session", "verify did not return AAL2 session");
      throw new MfaSessionEscalationError();
    }
    const { error: setSessionError } = await supabase.auth.setSession({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
    });
    if (setSessionError) {
      log.error(
        "persistAal2Session",
        `Failed to persist AAL2 session: ${setSessionError.message}`,
        undefined,
        setSessionError
      );
      throw new MfaSessionEscalationError();
    }
    log.info("persistAal2Session", "Session elevated to AAL2");
    await this.markCurrentSessionVerified();
  },

  async markCurrentSessionVerified(): Promise<void> {
    try {
      const { data } = await withAuthLockRetry(() => supabase.auth.getSession());
      const token = data.session?.access_token;
      if (!token) return;
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
      const sessionHash = Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      const { error } = await (supabase as any).rpc("mark_two_factor_login_verified", {
        _session_hash: sessionHash,
      });
      if (error) throw error;
    } catch (e) {
      log.warn(
        "markCurrentSessionVerified",
        `2FA session proof failed (non-blocking): ${e instanceof Error ? e.message : String(e)}`
      );
    }
  },
};
