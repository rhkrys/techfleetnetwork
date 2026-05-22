## Problem

A non-admin user with an enrolled TOTP factor enters a valid 6-digit code, the dialog briefly closes, then immediately reopens — over and over.

## Root cause

`MfaService.verifyChallenge()` calls `supabase.auth.mfa.verify(...)`, which is supposed to upgrade the session to AAL2, but it does NOT eagerly refresh the cached JWT/`session.access_token` in every path. Meanwhile `MfaEnforcementGuard` has two re-evaluators that fire almost immediately after the dialog closes:

1. `window` `focus` handler — wipes `lastCheckedToken.current` and re-runs the gate.
2. `onAuthStateChange("TOKEN_REFRESHED")` — re-runs the gate.

If either fires before the new AAL2 token is persisted to the SDK cache, `MfaService.getMfaGateDecision()` decodes the still-AAL1 token, sees `currentAal !== "aal2"`, and opens the dialog again. The user re-verifies, same race, same loop.

This affects any TOTP-enrolled user (memory: "enforced for enrolled users"), but is most visible to non-admins who don't expect the prompt at all and report it as broken.

## Fix

### 1. `src/services/mfa.service.ts` — force a session refresh after every successful verify
In `verifyChallenge()` (and therefore `challengeAndVerify()`), after `supabase.auth.mfa.verify(...)` returns OK and BEFORE `markCurrentSessionVerified()`:

```ts
await supabase.auth.refreshSession();
```

This guarantees the SDK cache + storage hold the AAL2 token before any downstream code (gate, RPC, navigation) reads it. Wrap in try/catch and log warn — never block the success path.

### 2. `src/components/MfaEnforcementGuard.tsx` — quiet window after success
Add a `recentlyVerifiedAtRef = useRef<number>(0)` set in `onSuccess`. In `runCheck`, early-return when `Date.now() - recentlyVerifiedAtRef.current < 10_000`. This absorbs the 1–3 race window during which TOKEN_REFRESHED and focus events fire while the new JWT propagates.

Also: replace the `focus` handler's `lastCheckedToken.current = null; runCheck(session.access_token)` with `runCheck(currentFreshToken)` where the token is re-read from `supabase.auth.getSession()` rather than the stale closure `session.access_token`. Prevents racing the React state update.

### 3. `src/components/MfaChallengeDialog.tsx` — no behavior change, but verify path
Confirm `onSuccess` is called only after `verifyChallenge` resolves (already true). No edit unless inspection finds a regression.

### Optional safety (in scope)
- After `markCurrentSessionVerified`, do one more `supabase.auth.refreshSession()` is **not** needed — the first refresh already pulled the AAL2 token; the RPC merely records the hash.

## Out of scope

- The policy of enforcing TOTP on non-admins who enrolled themselves. Memory rule "enforced for enrolled users" stands; the user asked to fix the loop, not change who is gated.
- LoginPage MFA flow — uses the same `MfaService`, so it inherits the fix automatically.
- Admin grace dialog (`AdminTwoFactorGraceDialog`) — unaffected.
- `markCurrentSessionVerified` RPC — already wrapped in try/catch and non-blocking.

## BDD scenarios (to insert into `bdd_scenarios`)

- **AUTH-2FA-LOOP-001** — Given a TOTP-enrolled non-admin signed in at AAL1, When they enter a valid 6-digit code in MfaChallengeDialog, Then `MfaService.verifyChallenge` calls `supabase.auth.mfa.verify` followed by `supabase.auth.refreshSession()` [Code] AND the session's `access_token` `aal` claim decodes to `aal2` within 500 ms [Code/DB] AND `MfaChallengeDialog` does not reopen within the next 10 seconds [UI].
- **AUTH-2FA-LOOP-002** — Given the user just passed MFA, When `window` fires a `focus` event within 10 seconds, Then `MfaEnforcementGuard.runCheck` short-circuits via `recentlyVerifiedAtRef` and does not invoke `getMfaGateDecision` [Code] AND no dialog opens [UI].
- **AUTH-2FA-LOOP-003** — Given the focus handler fires after the 10-second quiet window, When it calls `runCheck`, Then it re-reads the access token from `supabase.auth.getSession()` (not the stale closure) [Code] AND if `aal === "aal2"`, no dialog opens [UI].

## Verification

- `bunx vitest run src/test/ui/MfaEnforcementGuard.test.tsx src/test/services/mfa.service.test.ts`
- Manual: log in as a non-admin TOTP-enrolled user, enter valid code, confirm dialog stays closed across page focus and route changes.
