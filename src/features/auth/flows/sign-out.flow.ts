import { type AuthResult, ok } from "../domain/auth-result";
import { signOutSafe } from "../services/auth-flow.service";
import { purgeAuthOwnedStorage } from "../services/auth-storage.service";
import { emitAuthBeacon, newCorrelationId } from "../services/auth-telemetry";

/**
 * Typed sign-out flow. Best-effort; always resolves to `ok({ kind: "signed_out" })`.
 * Revocation row is owned by the existing SessionGuard subscription — this
 * flow does NOT decide revocation. Phase 3 broker route `sign-out` will
 * write the revocation row server-side first, then GoTrue signOut, then
 * storage purge, in that exact order.
 */
export async function signOut(): Promise<AuthResult> {
  const correlationId = newCorrelationId();
  await signOutSafe();
  purgeAuthOwnedStorage();
  await emitAuthBeacon("auth.signout.success", {
    correlationId,
    route: "signout",
    outcome: "ok",
  });
  return ok({ kind: "signed_out", correlationId });
}
