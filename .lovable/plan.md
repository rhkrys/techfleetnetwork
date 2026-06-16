# Permanent fix: bootstrap bad_jwt no longer signs users out

## Root cause (proven)
`src/contexts/AuthContext.tsx` bootstrap (lines 297–337):
1. `setSession()` stores valid tokens
2. `getUser()` → transient `bad_jwt` 403 (GoTrue hiccup)
3. `decidePurgeOnBadJwt()` returns `shouldPurge=false` (first strike — correct)
4. Bootstrap **then calls `refreshSession()`** against the same flapping backend
5. Refresh returns `bad_jwt` → `isUnrecoverableAuthError=true` → purge + signOut
6. User lands on `/`

Step 4 bypasses the documented two-strike contract (`AUTH-WEDGE-001..012`). The fetch-guard never does this — bootstrap is the lone outlier.

## The fix (one block, ~12 lines)
**File:** `src/contexts/AuthContext.tsx` — bootstrap self-heal block (lines 297–337)

Replace the "first strike → immediate `refreshSession()` → purge on refresh error" path with "first strike → trust stored session, beacon, return". Keep unchanged:
- `shape_invalid` / `expired` / second-strike → purge
- `onAuthStateChange('SIGNED_OUT' | 'TOKEN_REFRESHED')` handlers
- fetch-guard's own two-strike purge

New branch:
```ts
if (resolvedSession?.access_token) {
  const { error } = await supabase.auth.getUser();
  if (error && isUnrecoverableAuthError(error)) {
    const decision = decidePurgeOnBadJwt();
    if (decision.shouldPurge) {
      // shape_invalid | expired | second strike → purge (unchanged)
      purgeLocalAuthState(...); await supabase.auth.signOut({ scope: 'local' });
      setSession(null); setUser(null); return;
    }
    // First transient strike, structurally valid + unexpired stored token.
    // Do NOT call refreshSession() against the same flapping backend.
    // SDK auto-refresh + 15s two-strike gate + fetch-guard heal this.
    beacon('transient_bad_jwt', { source: 'bootstrap', swallowed: true });
  }
}
```

No new state, storage keys, timers, or deps.

## Why this is permanent, not a band-aid
- Matches documented `AUTH-WEDGE-001..012` contract literally.
- Symmetric with runtime fetch-guard (already uses `decidePurgeOnBadJwt` without forced refresh).
- Doesn't weaken security: `getStoredAccessTokenHealth()` still catches truly corrupt/expired tokens BEFORE the two-strike branch; real second strike within 15s still purges.
- Doesn't hide real refresh failures: SDK background auto-refresh + `onAuthStateChange('SIGNED_OUT')` handle genuine expiry.
- Closes the bug class: any future GoTrue flap that hits `/user` + `/token` together can no longer sign users out in one round-trip.

## Guardrails (lock the regression class)
1. `src/lib/auth/__tests__/bootstrap-self-heal.test.ts` (new):
   - `getUser→bad_jwt` + `refreshSession→bad_jwt` with valid stored token → session stays, no purge, beacon fires
   - Two strikes within 15s → second purges
   - `shape_invalid` stored token → purges on first strike
2. ESLint local rule: forbid `supabase.auth.refreshSession()` inside `AuthContext.tsx` bootstrap.
3. BDD scenarios inserted via migration into `bdd_scenarios`:
   - `AUTH-WEDGE-013` Transient bad_jwt on bootstrap does not sign user out
   - `AUTH-WEDGE-014` Two transient bad_jwt within 15s purges as designed
   - `AUTH-WEDGE-015` Google OAuth + GoTrue /user 403 keeps user signed in
4. Update memory `mem://features/auth/wedge-recovery` to `..015` noting bootstrap MUST NOT call `refreshSession()` on first transient strike.

## Receipts after ship
- `git diff --stat`: only `src/contexts/AuthContext.tsx`, new test file, ESLint rule, BDD migration, memory update.
- Existing AUTH-WEDGE suite + 3 new tests pass.
- `transient_bad_jwt` beacon visible in `ops_events` next time GoTrue flaps — observable, non-destructive.

## Out of scope
GoTrue `bad_jwt` flapping itself (platform-side). No changes to login UI, OAuth config, RLS, profiles, MFA, captcha, rate-limit tables.
