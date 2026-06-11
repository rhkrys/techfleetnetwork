/**
 * AUTH-ENGINE — failure policy (canonical location per Ship 1).
 *
 * Re-exports the existing `auth-failure-policy` decision table so the engine
 * layer has a single import path. The legacy module under
 * `src/features/auth/services/auth-failure-policy.ts` stays in place as the
 * source of truth (and as the only module allowed to flip counter flags) until
 * Ship 5 collapses both into one file.
 *
 * VICHEA INVARIANT: `client_session_write_failed` MUST set every counter flag
 * to false. Verified by `auth-failure-policy.contract.test.ts`. Do not bypass.
 */
export {
  decideFailureActions,
  type FailureActions,
} from "@/features/auth/services/auth-failure-policy";
