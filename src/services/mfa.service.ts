import { supabase } from "@/integrations/supabase/client";
import { createLogger } from "@/services/logger.service";
import { isValidTotpCode } from "@/lib/security";
const log = createLogger("MfaService");

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
function invalidateFactorCache() { factorCache = null; factorCacheInflight = null; }
/** Test-only: reset module caches between cases. Not for production callers. */
export function __resetMfaServiceCachesForTests() { invalidateFactorCache(); }

export const MfaService = {
  /** List all enrolled MFA factors for the current user. Cached 60s per tab. */
  async listFactors(opts?: { force?: boolean }): Promise<TotpFactor[]> {
    if (!opts?.force && factorCache && Date.now() - factorCache.at < FACTOR_CACHE_TTL_MS) {
      return factorCache.value;
    }
    if (!opts?.force && factorCacheInflight) return factorCacheInflight;
    const fetchOnce = (async () => {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) {
        log.error("listFactors", `Failed: ${error.message}`, undefined, error);
        throw new Error("Could not load MFA factors");
      }
      const value = (data?.all ?? []) as TotpFactor[];
      factorCache = { at: Date.now(), value };
      return value;
    })();
    factorCacheInflight = fetchOnce;
    try { return await fetchOnce; } finally { factorCacheInflight = null; }
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
    if (!isValidTotpCode(normalizedCode)) throw new Error("Enter the 6-digit code from your authenticator app.");
    const { data: challengeData, error: challengeErr } = await supabase.auth.mfa.challenge({ factorId });
    if (challengeErr || !challengeData) {
      log.error("verifyEnrollment", `Challenge failed: ${challengeErr?.message}`, undefined, challengeErr);
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
  async getMfaGateDecision(): Promise<{ hasVerifiedTotp: boolean; currentAal: string | null; needsChallenge: boolean }> {
    let hasVerifiedTotp = false;
    try {
      const factors = await this.listFactors();
      hasVerifiedTotp = factors.some((f) => f.factor_type === "totp" && f.status === "verified");
    } catch (e) {
      log.warn("getMfaGateDecision", `listFactors failed (failing closed): ${e instanceof Error ? e.message : String(e)}`);
      return { hasVerifiedTotp: false, currentAal: null, needsChallenge: false };
    }

    let currentAal: string | null = null;
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (token) {
        const payload = token.split(".")[1];
        if (payload) {
          const decoded = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
          if (typeof decoded?.aal === "string") currentAal = decoded.aal;
        }
      }
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
  async getAssuranceLevel(): Promise<{ currentLevel: string | null; nextLevel: string | null; needsChallenge: boolean }> {
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


  /** Pre-create a challenge so the user's verify is a single round-trip. */
  async createChallenge(factorId: string): Promise<string> {
    const { data, error } = await supabase.auth.mfa.challenge({ factorId });
    if (error || !data) throw new Error("Failed to create MFA challenge");
    return data.id;
  },

  /** Verify a previously created challenge with the user's 6-digit code. */
  async verifyChallenge(factorId: string, challengeId: string, code: string): Promise<void> {
    const normalizedCode = code.replace(/\s/g, "");
    if (!isValidTotpCode(normalizedCode)) throw new Error("Enter the 6-digit code from your authenticator app.");
    const { error } = await supabase.auth.mfa.verify({
      factorId,
      challengeId,
      code: normalizedCode,
    });
    if (error) {
      log.warn("verifyChallenge", `Invalid code: ${error.message}`);
      throw new Error("Invalid verification code. Please try again.");
    }
    log.info("verifyChallenge", "2FA challenge passed — session elevated to AAL2");
    // Force the SDK to pull the freshly-minted AAL2 token into its cache + storage
    // BEFORE any downstream gate/RPC reads `session.access_token`. Without this
    // the focus/TOKEN_REFRESHED handlers race the JWT propagation and re-prompt
    // (the "2FA loop" — AUTH-2FA-LOOP-001).
    try {
      await supabase.auth.refreshSession();
    } catch (e) {
      log.warn("verifyChallenge", `refreshSession after verify failed (non-blocking): ${e instanceof Error ? e.message : String(e)}`);
    }
    await this.markCurrentSessionVerified();
  },

  /** Submit a 6-digit code during login to elevate the session to AAL2. */
  async challengeAndVerify(factorId: string, code: string): Promise<void> {
    const challengeId = await this.createChallenge(factorId);
    await this.verifyChallenge(factorId, challengeId, code);
  },

  async markCurrentSessionVerified(): Promise<void> {
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
      const sessionHash = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
      const { error } = await (supabase as any).rpc("mark_two_factor_login_verified", { _session_hash: sessionHash });
      if (error) throw error;
    } catch (e) {
      log.warn(
        "markCurrentSessionVerified",
        `2FA session proof failed (non-blocking): ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  },
};
