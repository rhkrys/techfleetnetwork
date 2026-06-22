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

    const TIMEOUT_SENTINEL = Symbol("signup_timeout");
    const timeoutPromise = new Promise<typeof TIMEOUT_SENTINEL>((resolve) =>
      setTimeout(() => resolve(TIMEOUT_SENTINEL), 30_000),
    );

    let lastErr: { message: string; status?: number; code?: string } | null = null;
    let indeterminate = false;
    let data: any = null;
    for (let i = 0; i < 2; i++) {
      try {
        const res = await Promise.race([attempt(), timeoutPromise]);
        if (res === TIMEOUT_SENTINEL) {
          indeterminate = true;
          lastErr = { message: "Sign-up request timed out.", status: 0, code: "timeout" };
          break;
        }
        if (!res.error) { data = res.data; lastErr = null; break; }
        if (res.error.status === 429 || res.error.message.toLowerCase().includes("too many rapid auth attempts")) throw createAuthThrottleCaptchaError();
        lastErr = { message: res.error.message, status: res.error.status, code: (res.error as any).code };
        const transient = !res.error.status || res.error.status >= 500 || res.error.status === 0;
        if (!transient) break;
        if (i === 1) { indeterminate = true; break; }
        await new Promise(r => setTimeout(r, 600 * (i + 1)));
      } catch (networkErr: any) {
        if (isAuthThrottleCaptchaError(networkErr)) throw networkErr;
        lastErr = { message: networkErr?.message ?? "Network error", status: 0 };
        void logAccountActivity("signup_network_error", { email: safeEmail, errorMessage: lastErr.message });
        indeterminate = true;
        break;
      }
    }

    // INDETERMINATE-RESOLVE: GoTrue may have created the auth row BEFORE the
    // 504 / timeout / network abort fired. Don't lie to the user — probe with
    // signInWithPassword to discover the true state and route accordingly.
    if (indeterminate) {
      void logAccountActivity("signup_indeterminate_timeout", {
        email: safeEmail,
        errorMessage: lastErr?.message ?? "timeout",
        errorCode: lastErr?.status ?? lastErr?.code ?? "unknown",
      });
      try {
        const probe = await supabase.auth.signInWithPassword({ email: safeEmail, password });
        if (!probe.error && probe.data?.session) {
          // Row exists AND confirmed → user is now signed in. Surface that
          // outcome to the engine via a dedicated coded error so the UI can
          // redirect to /dashboard instead of showing "Check your email".
          log.info("signUp", `Indeterminate signup resolved as signed-in for ${safeEmail}`, { email: safeEmail });
          void logAccountActivity("signup_indeterminate_resolved_signed_in", { email: safeEmail });
          const e: any = new Error("ACCOUNT_RECOVERED_SIGNED_IN");
          e.code = "ACCOUNT_RECOVERED_SIGNED_IN";
          throw e;
        }
        const probeCode = (probe.error as any)?.code ?? "";
        const probeMsg = (probe.error?.message ?? "").toLowerCase();
        if (probeCode === "email_not_confirmed" || probeMsg.includes("email not confirmed") || probeMsg.includes("not confirmed")) {
          // Row exists, awaiting verification → success path (Check your email).
          log.info("signUp", `Indeterminate signup resolved as email-not-confirmed for ${safeEmail}`, { email: safeEmail });
          void logAccountActivity("signup_indeterminate_resolved_unconfirmed", { email: safeEmail });
          const e: any = new Error("EMAIL_UNCONFIRMED");
          e.code = "EMAIL_UNCONFIRMED";
          throw e;
        }
        if (probeCode === "invalid_credentials" || probe.error?.status === 400) {
          // Row was NOT created — fall through to the normal error branch.
          log.info("signUp", `Indeterminate signup resolved as not-created for ${safeEmail}`, { email: safeEmail });
          void logAccountActivity("signup_indeterminate_resolved_not_created", { email: safeEmail });
        } else {
          // Probe itself failed (rate-limited, captcha required, etc.) — we
          // can't disambiguate. Tell the user the safe, accurate truth.
          log.warn("signUp", `Indeterminate signup probe inconclusive for ${safeEmail}: ${probe.error?.message ?? "unknown"}`, { email: safeEmail });
          void logAccountActivity("signup_indeterminate_probe_inconclusive", { email: safeEmail, errorMessage: probe.error?.message ?? "unknown" });
          throw new Error("Your sign-up may have been created but we couldn't confirm. Try signing in with your email and password, or use Forgot password.");
        }
      } catch (probeErr: any) {
        if (probeErr?.code === "ACCOUNT_RECOVERED_SIGNED_IN" || probeErr?.code === "EMAIL_UNCONFIRMED") throw probeErr;
        // signInWithPassword itself threw (network) — fall through to normal error path.
        log.warn("signUp", `Indeterminate signup probe threw for ${safeEmail}: ${probeErr?.message ?? "unknown"}`, { email: safeEmail });
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

      // Code-first duplicate detection (GoTrue email_exists / user_already_exists / 422).
      const serverCode = (lastErr.code ?? "").toLowerCase();
      const m = (lastErr.message || "").toLowerCase();
      const isDuplicate =
        serverCode === "email_exists" ||
        serverCode === "user_already_exists" ||
        serverCode === "email_address_already_registered" ||
        serverCode === "user_already_registered" ||
        (lastErr.status === 422 && (m.includes("already") || m.includes("exists"))) ||
        m.includes("already registered") || m.includes("already been registered") || m.includes("user already");
      if (isDuplicate) {
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
      if (indeterminate || lastErr.status === 0 || (lastErr.status && lastErr.status >= 500)) {
        throw new Error("Our sign-up service had a brief hiccup. Your account may already have been created — try signing in, or use Forgot password.");
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
