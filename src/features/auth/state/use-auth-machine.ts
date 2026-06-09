import { useMachine } from "@xstate/react";
import { useMemo } from "react";
import { createAuthMachine } from "./auth-machine";
import type { AuthMachineMode } from "./auth-machine.types";
import { signInWithPassword } from "../flows/sign-in-password.flow";
import { signInWithGoogle } from "../flows/sign-in-google.flow";
import { signUp, type SignUpInput } from "../flows/sign-up.flow";
import { requestPasswordReset } from "../flows/request-password-reset.flow";
import { completePasswordReset } from "../flows/complete-password-reset.flow";

/**
 * useAuthMachine — typed hook for auth screens. Owns the machine actor,
 * wires SUBMIT events to the right flow service, and forwards typed
 * `Result<AuthOk, AuthErr>` back into the machine via SERVER_OK / SERVER_ERR.
 *
 * Pages MUST consume `state.value` for rendering. Booleans like
 * `isLoading` are forbidden in UI (ESLint `no-auth-booleans-in-ui`).
 */
export function useAuthMachine(mode: AuthMachineMode) {
  const machine = useMemo(() => createAuthMachine({ mode }), [mode]);
  const [state, send] = useMachine(machine, { input: { mode } });

  const correlationId = state.context.correlationId;

  const submitPassword = async (email: string, password: string, captchaToken?: string) => {
    send({ type: "SUBMIT", email, password, captchaToken });
    const result = await signInWithPassword({ email, password, captchaToken, correlationId });
    if (result.ok) send({ type: "SERVER_OK", value: result.value });
    else send({ type: "SERVER_ERR", error: (result as { error: import("../domain/auth-result").AuthErr }).error });
    return result;
  };

  const submitGoogle = async (redirectTo?: string) => {
    send({ type: "SUBMIT", email: "" });
    const result = await signInWithGoogle({ redirectTo, correlationId });
    if (result.ok) send({ type: "SERVER_OK", value: result.value });
    else send({ type: "SERVER_ERR", error: (result as { error: import("../domain/auth-result").AuthErr }).error });
    return result;
  };

  const submitSignUp = async (input: Omit<SignUpInput, "correlationId">) => {
    send({ type: "SUBMIT", email: input.email, password: input.password });
    const result = await signUp({ ...input, correlationId });
    if (result.ok) send({ type: "SERVER_OK", value: result.value });
    else send({ type: "SERVER_ERR", error: (result as { error: import("../domain/auth-result").AuthErr }).error });
    return result;
  };

  const submitResetRequest = async (email: string, redirectTo?: string) => {
    send({ type: "SUBMIT", email });
    const result = await requestPasswordReset({ email, redirectTo, correlationId });
    if (result.ok) send({ type: "SERVER_OK", value: result.value });
    else send({ type: "SERVER_ERR", error: (result as { error: import("../domain/auth-result").AuthErr }).error });
    return result;
  };

  const submitResetComplete = async (newPassword: string) => {
    send({ type: "SUBMIT", email: state.context.email, password: newPassword });
    const result = await completePasswordReset({ newPassword, correlationId });
    if (result.ok) send({ type: "SERVER_OK", value: result.value });
    else send({ type: "SERVER_ERR", error: (result as { error: import("../domain/auth-result").AuthErr }).error });
    return result;
  };

  const reset = () => send({ type: "RESET" });

  return {
    state,
    send,
    reset,
    submitPassword,
    submitGoogle,
    submitSignUp,
    submitResetRequest,
    submitResetComplete,
  };
}
