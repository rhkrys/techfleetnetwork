import { createContext, useContext, type ReactNode } from "react";
import type { AuthMachineMode } from "./auth-machine.types";
import { useAuthMachine } from "./use-auth-machine";

/**
 * AuthProvider — scoped to a single auth screen (sign-in, sign-up,
 * reset). Hoisted above the form so dialogs (e.g. MFA challenge) can
 * read the same machine state via `useAuthScope()`.
 *
 * Global session state (current user, AAL, idle timeout) is owned by
 * the existing app-level provider — NOT this one. This context is
 * intentionally narrow: it owns one auth flow at a time.
 */

type AuthScopeValue = ReturnType<typeof useAuthMachine>;

const AuthScopeContext = createContext<AuthScopeValue | null>(null);

export function AuthScopeProvider({
  mode,
  children,
}: {
  mode: AuthMachineMode;
  children: ReactNode;
}) {
  const value = useAuthMachine(mode);
  return <AuthScopeContext.Provider value={value}>{children}</AuthScopeContext.Provider>;
}

export function useAuthScope(): AuthScopeValue {
  const ctx = useContext(AuthScopeContext);
  if (!ctx) {
    throw new Error("useAuthScope must be used inside <AuthScopeProvider mode=...>");
  }
  return ctx;
}
