import { useMachine } from "@xstate/react";
import { useEffect, useMemo } from "react";
import { createAuthMachine } from "./auth-machine";
import type { AuthMachineMode } from "./auth-machine.types";
import { signInWithPassword } from "../flows/sign-in-password.flow";

/**
 * useAuthMachine — typed hook for auth screens. Owns the machine actor,
 * wires the SUBMIT event to the right flow service, and forwards the
 * typed Result back into the machine via SERVER_OK / SERVER_ERR.
 *
 * Pages MUST consume `state.value` (a string union) for rendering.
 * Booleans like `isLoading` are forbidden in UI (ESLint).
 */
export function useAuthMachine(mode: AuthMachineMode) {
  const machine = useMemo(() => createAuthMachine({ mode }), [mode]);
  const [state, send, actor] = useMachine(machine, { input: { mode } });

  // Bridge: when machine enters `submitting` from SUBMIT, run the
  // appropriate flow and dispatch the typed Result back.
  useEffect(() => {
    const sub = actor.subscribe((snapshot) => {
      // no-op subscriber keeps the actor alive across re-renders
      void snapshot;
    });
    return () => sub.unsubscribe();
  }, [actor]);

  const submitPassword = async (email: string, password: string, captchaToken?: string) => {
    send({ type: "SUBMIT", email, password, captchaToken });
    const result = await signInWithPassword({
      email,
      password,
      captchaToken,
      correlationId: state.context.correlationId,
    });
    if (result.ok) send({ type: "SERVER_OK", value: result.value });
    else send({ type: "SERVER_ERR", error: result.error });
    return result;
  };

  return { state, send, submitPassword };
}
