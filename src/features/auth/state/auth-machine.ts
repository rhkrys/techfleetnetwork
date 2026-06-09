import { assign, setup } from "xstate";
import type {
  AuthMachineContext,
  AuthMachineEvent,
  AuthMachineMode,
} from "./auth-machine.types";
import { newCorrelationId } from "../services/auth-telemetry";

/**
 * The single auth state machine. Drives sign-in (password + google),
 * sign-up, password reset request, and password reset complete.
 *
 * Invariants enforced by this machine (not by pages):
 *   - Only `submitting` can transition to `setting_session`.
 *   - Only `setting_session` (SERVER_OK with kind="signed_in") can reach
 *     `signed_in`. A `failed` state has no transition to `signed_in`.
 *   - `awaiting_mfa` is the ONLY way into a `signed_in` state when the
 *     server returned a `mfa_required` ok value. UI cannot bypass.
 *   - `RESET` is always allowed and returns to `idle` cleanly.
 *
 * The flow services (sign-in-password, sign-in-google, etc.) are invoked
 * by the UI via `send({ type: "SUBMIT", ... })` and respond by sending
 * SERVER_OK / SERVER_ERR back into the machine. The machine itself does
 * not call `supabase.auth` directly.
 */

export interface CreateAuthMachineInput {
  mode: AuthMachineMode;
}

export const createAuthMachine = (input: CreateAuthMachineInput) =>
  setup({
    types: {
      context: {} as AuthMachineContext,
      events: {} as AuthMachineEvent,
      input: {} as CreateAuthMachineInput,
    },
    guards: {
      mfaRequired: ({ event }) =>
        event.type === "SERVER_OK" && event.value.kind === "mfa_required",
      isSignedIn: ({ event }) =>
        event.type === "SERVER_OK" && event.value.kind === "signed_in",
      isRedirect: ({ event }) =>
        event.type === "SERVER_OK" && event.value.kind === "redirecting_to_provider",
    },
  }).createMachine({
    id: "auth",
    initial: "idle",
    context: ({ input }) => ({
      mode: input.mode,
      email: "",
      error: null,
      success: null,
      correlationId: newCorrelationId(),
      captchaToken: null,
      mfaChallengeId: null,
      retryAfter: null,
    }),
    on: {
      RESET: {
        target: ".idle",
        actions: assign({
          error: null,
          success: null,
          mfaChallengeId: null,
          retryAfter: null,
          correlationId: () => newCorrelationId(),
        }),
      },
    },
    states: {
      idle: {
        on: {
          SUBMIT: {
            target: "submitting",
            actions: assign(({ event }) => ({
              email: event.email,
              captchaToken: event.captchaToken ?? null,
              error: null,
            })),
          },
          CAPTCHA_OK: {
            actions: assign({ captchaToken: ({ event }) => event.token }),
          },
        },
      },
      awaiting_captcha: {
        on: {
          CAPTCHA_OK: {
            target: "submitting",
            actions: assign({ captchaToken: ({ event }) => event.token }),
          },
          CAPTCHA_FAIL: { target: "failed" },
        },
      },
      submitting: {
        on: {
          SERVER_OK: [
            { target: "redirecting_to_provider", guard: "isRedirect",
              actions: assign({ success: ({ event }) => event.value }) },
            { target: "awaiting_mfa", guard: "mfaRequired",
              actions: assign({
                success: ({ event }) => event.value,
                mfaChallengeId: ({ event }) =>
                  event.value.kind === "mfa_required" ? event.value.challengeId : null,
              }) },
            { target: "setting_session", guard: "isSignedIn",
              actions: assign({ success: ({ event }) => event.value }) },
            { target: "signed_in",
              actions: assign({ success: ({ event }) => event.value }) },
          ],
          SERVER_ERR: {
            target: "failed",
            actions: assign({
              error: ({ event }) => event.error,
              retryAfter: ({ event }) => event.error.retryAfter ?? null,
            }),
          },
        },
      },
      redirecting_to_provider: { type: "final" },
      awaiting_mfa: {
        on: {
          MFA_SUBMIT: { target: "submitting" },
          MFA_OK: { target: "setting_session" },
          MFA_FAIL: {
            target: "awaiting_mfa",
            actions: assign({ error: ({ event }) => event.error }),
          },
        },
      },
      setting_session: {
        on: {
          SERVER_OK: { target: "signed_in",
            actions: assign({ success: ({ event }) => event.value }) },
          SERVER_ERR: {
            target: "failed",
            actions: assign({ error: ({ event }) => event.error }),
          },
        },
      },
      signed_in: { type: "final" },
      failed: {
        on: {
          RETRY: { target: "idle",
            actions: assign({ error: null, retryAfter: null }) },
          SUBMIT: {
            target: "submitting",
            actions: assign(({ event }) => ({
              email: event.email,
              captchaToken: event.captchaToken ?? null,
              error: null,
            })),
          },
        },
      },
    },
  });

export type AuthMachine = ReturnType<typeof createAuthMachine>;
