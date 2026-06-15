/**
 * AUTH-ARCH-CUTOVER-008 — single owner of password-reset request.
 *
 * Logic moved verbatim from legacy `AuthService.resetPassword` (2026-06-15).
 * AuthService delegates here; sessionPort.resetPassword imports this directly.
 * Engines never throw across their boundary; they convert to typed results.
 */
import { supabase } from "@/integrations/supabase/client";
import { createLogger } from "@/services/logger.service";
import { logAccountActivity } from "@/lib/account-activity";
import { emailInputSchema } from "@/lib/validators/auth";
import { createAuthThrottleCaptchaError } from "@/lib/auth-throttle-captcha";
import { validateEmailDomainExists } from "@/lib/email-domain-validation";
import { GOOGLE_ONLY_ACCOUNT_CODE, GOOGLE_ONLY_ACCOUNT_MESSAGE } from "@/features/auth/domain/google-only-account";
import { checkAccountIdentity } from "@/features/auth/services/identity-hint.service";

const log = createLogger("auth.request-password-reset.service");
const blockedAuthInputError = new Error("Enter a valid email address.");

export async function requestPasswordReset(email: string, redirectTo: string, captchaToken?: string) {
  const parsedEmail = emailInputSchema.safeParse(email);
  if (!parsedEmail.success) throw blockedAuthInputError;
  const safeCaptchaToken = captchaToken?.trim();
  if (captchaToken !== undefined && !safeCaptchaToken) throw new Error("Complete the human verification before trying again.");
  const safeEmail = parsedEmail.data;
  const domainCheck = await validateEmailDomainExists(safeEmail);
  if (!domainCheck.valid) throw new Error(domainCheck.message ?? "Use an email address with a real domain.");
  return log.track("resetPassword", `Sending password reset for ${safeEmail}`, { email: safeEmail }, async () => {
    const identity = await checkAccountIdentity(safeEmail, safeCaptchaToken);
    if (identity.has_google && !identity.has_password) {
      void logAccountActivity("password_reset_google_only_blocked", { email: safeEmail });
      const err = new Error(GOOGLE_ONLY_ACCOUNT_MESSAGE) as Error & { code?: string };
      err.code = GOOGLE_ONLY_ACCOUNT_CODE;
      throw err;
    }

    const { error } = await supabase.auth.resetPasswordForEmail(safeEmail, {
      redirectTo,
      ...(safeCaptchaToken ? { captchaToken: safeCaptchaToken } : {}),
    });
    if (error) {
      log.warn("resetPassword", `Password reset request failed for ${safeEmail}: ${error.message}`, { email: safeEmail }, error);
      void logAccountActivity("password_reset_failed", { email: safeEmail, errorMessage: error.message, errorCode: error.status });
      if (error.status === 429 || error.message.toLowerCase().includes("too many rapid auth attempts")) throw createAuthThrottleCaptchaError();
      throw new Error("If an account exists with that email, a reset link has been sent.");
    }
    log.info("resetPassword", `Password reset email sent for ${safeEmail}`, { email: safeEmail });
    void logAccountActivity("password_reset_requested", { email: safeEmail });
  });
}
