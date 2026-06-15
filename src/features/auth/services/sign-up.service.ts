/**
 * AUTH-ARCH-CUTOVER-007 — single owner of new-account sign-up.
 *
 * Logic moved verbatim from the legacy `AuthService.signUp` (2026-06-15).
 * AuthService.signUp now delegates here; engines/ports call this directly via
 * sessionPort. This file is the ONLY allowed owner of `supabase.auth.signUp`
 * for credentialed flows (sign-in-google.flow was the other direct caller and
 * was deleted in AUTH-ARCH-CUTOVER-004).
 */
import { supabase } from "@/integrations/supabase/client";
import { createLogger } from "@/services/logger.service";
import { logAccountActivity } from "@/lib/account-activity";
import { emailInputSchema, passwordSchema } from "@/lib/validators/auth";
import { createAuthThrottleCaptchaError, isAuthThrottleCaptchaError } from "@/lib/auth-throttle-captcha";
import { validateEmailDomainExists } from "@/lib/email-domain-validation";

const log = createLogger("auth.sign-up.service");
const blockedAuthInputError = new Error("Enter a valid email address.");

export async function signUp(
  email: string,
  password: string,
  firstName: string,
  lastName: string,
  redirectTo: string,
  captchaToken: string,
  birthYear?: number,
) {
  const parsedEmail = emailInputSchema.safeParse(email);
  if (!parsedEmail.success || !passwordSchema.safeParse(password).success) {
    throw blockedAuthInputError;
  }
  const safeCaptchaToken = captchaToken.trim();
  if (!safeCaptchaToken) throw new Error("Complete the human verification before trying again.");
  const safeEmail = parsedEmail.data;
  const domainCheck = await validateEmailDomainExists(safeEmail);
  if (!domainCheck.valid) throw new Error(domainCheck.message ?? "Use an email address with a real domain.");
  void logAccountActivity("signup_attempt_started", { email: safeEmail, details: { hasName: Boolean(firstName && lastName) } });
  return log.track("signUp", `Registering new user ${safeEmail}`, { email: safeEmail, firstName, lastName }, async () => {
    const attempt = async () =>
      supabase.auth.signUp({
        email: safeEmail,
        password,
        options: {
          data: {
            full_name: `${firstName} ${lastName}`.trim(),
            first_name: firstName,
            last_name: lastName,
            ...(birthYear ? { birth_year: birthYear } : {}),
          },
          emailRedirectTo: redirectTo,
          captchaToken: safeCaptchaToken,
        },
      });

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Sign-up request timed out. Please try again.")), 30_000),
    );

    let lastErr: { message: string; status?: number; code?: string } | null = null;
    let data: any = null;
    for (let i = 0; i < 2; i++) {
      try {
        const res = await Promise.race([attempt(), timeoutPromise]);
        if (!res.error) { data = res.data; lastErr = null; break; }
        if (res.error.status === 429 || res.error.message.toLowerCase().includes("too many rapid auth attempts")) throw createAuthThrottleCaptchaError();
        lastErr = { message: res.error.message, status: res.error.status, code: (res.error as any).code };
        const transient = !res.error.status || res.error.status >= 500 || res.error.status === 0;
        if (!transient) break;
        await new Promise(r => setTimeout(r, 600 * (i + 1)));
      } catch (networkErr: any) {
        if (isAuthThrottleCaptchaError(networkErr)) throw networkErr;
        lastErr = { message: networkErr?.message ?? "Network error", status: 0 };
        void logAccountActivity("signup_network_error", { email: safeEmail, errorMessage: lastErr.message });
        break;
      }
    }

    if (lastErr) {
      log.error("signUp", `Registration failed for ${safeEmail}: [${lastErr.status ?? "?"}] ${lastErr.message}`,
        { email: safeEmail, errorCode: lastErr.status, errorName: lastErr.code }, lastErr as Error);
      void logAccountActivity("signup_supabase_error", {
        email: safeEmail,
        errorMessage: lastErr.message,
        errorCode: lastErr.status ?? lastErr.code ?? "unknown",
      });

      const m = (lastErr.message || "").toLowerCase();
      if (m.includes("already registered") || m.includes("already been registered") || m.includes("user already")) {
        const e: any = new Error("ACCOUNT_EXISTS");
        e.code = "ACCOUNT_EXISTS";
        throw e;
      }
      if (m.includes("pwned") || m.includes("compromised")) {
        throw new Error("This password has appeared in a known data breach. Please choose a different password.");
      }
      if (m.includes("weak") || m.includes("password should") || m.includes("password must")) {
        throw new Error(`Password rejected: ${lastErr.message}`);
      }
      if (m.includes("rate") || lastErr.status === 429) {
        throw new Error("Too many signup attempts from your network. Please wait a few minutes and try again.");
      }
      if (m.includes("invalid") && m.includes("email")) {
        throw new Error("That email address looks invalid. Please double-check and try again.");
      }
      if (m.includes("signup") && m.includes("disabled")) {
        throw new Error("Account creation is temporarily unavailable. Please contact support.");
      }
      if (lastErr.status && lastErr.status >= 500) {
        throw new Error("The signup service is temporarily unavailable. Please try again in a minute.");
      }
      throw new Error(lastErr.message || "Unable to create account. Please try again or use a different email.");
    }

    const looksLikeExistingUser =
      data?.user &&
      Array.isArray(data.user.identities) &&
      data.user.identities.length === 0 &&
      !data.session;
    if (looksLikeExistingUser) {
      log.info("signUp", `Signup blocked: account already exists for ${safeEmail}`, { email: safeEmail });
      void logAccountActivity("signup_blocked_existing_account", { email: safeEmail });
      const e: any = new Error("ACCOUNT_EXISTS");
      e.code = "ACCOUNT_EXISTS";
      throw e;
    }

    log.info("signUp", `User ${safeEmail} registered successfully, confirmation email sent`, {
      userId: data?.user?.id,
      confirmationRequired: !data?.session,
    });
    void logAccountActivity("signup_succeeded", {
      email: safeEmail,
      userId: data?.user?.id,
      details: { confirmationRequired: !data?.session },
    });
    return data;
  });
}

export async function resendSignupConfirmation(email: string, redirectTo: string, captchaToken: string) {
  const parsedEmail = emailInputSchema.safeParse(email);
  if (!parsedEmail.success) throw blockedAuthInputError;
  const safeCaptchaToken = captchaToken.trim();
  if (!safeCaptchaToken) throw new Error("Complete the human verification before trying again.");
  const safeEmail = parsedEmail.data;
  const domainCheck = await validateEmailDomainExists(safeEmail);
  if (!domainCheck.valid) throw new Error(domainCheck.message ?? "Use an email address with a real domain.");
  void logAccountActivity("signup_confirmation_resend_requested", { email: safeEmail });
  return log.track("resendSignupConfirmation", `Requesting signup confirmation email for ${safeEmail}`, { email: safeEmail }, async () => {
    const { error } = await supabase.auth.resend({
      type: "signup",
      email: safeEmail,
      options: { emailRedirectTo: redirectTo, captchaToken: safeCaptchaToken },
    });

    if (error) {
      log.warn("resendSignupConfirmation", `Confirmation resend failed for ${safeEmail}: ${error.message}`, { email: safeEmail, errorCode: error.status }, error);
      void logAccountActivity("signup_confirmation_resend_failed", {
        email: safeEmail,
        errorMessage: error.message,
        errorCode: error.status,
      });

      const message = error.message.toLowerCase();
      if (message.includes("rate") || error.status === 429) {
        throw new Error("Too many verification email requests. Please wait a few minutes and try again.");
      }
      throw new Error("We could not resend the verification email right now. Please try again in a minute.");
    }

    log.info("resendSignupConfirmation", `Confirmation resend accepted for ${safeEmail}`, { email: safeEmail });
    void logAccountActivity("signup_confirmation_resend_succeeded", { email: safeEmail });
  });
}
