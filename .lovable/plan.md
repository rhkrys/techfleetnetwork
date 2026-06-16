# Why you got bounced back to the logged-out home page

Your auth logs from the last hour are full of this pattern:

```
GET /user → 403 bad_jwt
"token is malformed: token contains an invalid number of segments"
```

Many different AWS IPs, all hitting GoTrue's `/user` endpoint. That's a backend GoTrue / auth-proxy hiccup — not a problem with your account. This morning it was healthy, around the time you logged in it started returning `bad_jwt` sporadically.

We already have a documented protection for this exact case (memory: *AUTH-WEDGE: a single transient bad_jwt MUST NEVER sign out an active user*). But there's a hole in the implementation that exactly matches your three bounces.

# Root cause (proven from code, not guessed)

`src/contexts/AuthContext.tsx` (bootstrap, lines 297–337) runs this after Google OAuth returns:

```text
1. setSession(access_token, refresh_token)       ← stores fresh, valid tokens
2. supabase.auth.getUser()                       ← validates against GoTrue
   └─ returns bad_jwt 403  (GoTrue hiccup)
3. decidePurgeOnBadJwt() → shouldPurge = false   ← first strike, GOOD
4. supabase.auth.refreshSession()                ← IMMEDIATE retry
   └─ also returns a bad_jwt-class error
5. isUnrecoverableAuthError(refreshError) = true ← per classifyAuthError
6. purgeLocalAuthState() + signOut({local}) + setSession(null) + setUser(null)
   → app re-renders as logged-out → you land on `/`
```

Step 5 is the bug. The two-strike gate at step 3 correctly says "don't purge". But step 4 immediately fires a refresh against the same misbehaving GoTrue, and step 5 treats that second hiccup as unrecoverable — bypassing the two-strike protection in one round-trip.

`classifyAuthError` (`src/lib/auth/session-health.ts` lines 40–67) matches `bad_jwt`, `invalid jwt`, `invalid number of segments`, `token is malformed`, `parse or verify signature` → returns `jwt_corrupt` → `isUnrecoverableAuthError = true` → purge. So any backend hiccup that flaps `/user` AND `/token?refresh` (they share infra) deterministically signs you out, three logins in a row.

The stored token at step 1 is structurally fine (3 segments, unexpired). There is no actual corruption. The SDK's own background auto-refresh would have recovered on its next tick — but we never gave it that chance.

# The fix (root cause, one change, no band-aids)

Honor the two-strike contract literally: on the **first** transient `bad_jwt` against a stored token that is structurally valid and unexpired, do NOT immediately call `refreshSession()` against the same flapping backend. Trust the stored session and let:

- the GoTrue auto-refresh timer (already running in the SDK), and
- the next real API call (which will re-classify on its own strike)

heal the session. The two-strike window (15s) + fetch-guard already catch a true corruption on the second hit.

## Code change

**File:** `src/contexts/AuthContext.tsx` (lines 297–337, bootstrap self-heal block)

Replace the "first strike → immediate refresh → purge on refresh error" branch with "first strike → no-op, trust stored session". Keep:

- shape_invalid / expired / second-strike paths → purge (unchanged)
- `onAuthStateChange` SIGNED_OUT and TOKEN_REFRESHED handlers (unchanged)
- fetch-guard's own purge on second strike (unchanged)

Pseudocode of the new branch:

```text
if (resolvedSession?.access_token) {
  const { error } = await supabase.auth.getUser();
  if (error && isUnrecoverableAuthError(error)) {
    const decision = decidePurgeOnBadJwt();
    if (decision.shouldPurge) {
      // shape_invalid OR expired OR second strike → purge as today
      purgeLocalAuthState(...); signOut({local}); clear state; return;
    }
    // First transient strike with a structurally valid, unexpired token:
    // DO NOT call refreshSession() here. Background auto-refresh + the
    // 15s two-strike gate handle recovery. Just keep the user signed in.
    beacon("transient_bad_jwt", { source: "bootstrap", swallowed: true });
  }
}
```

This is a 12-line replacement of an existing 40-line block. No new state, no new storage keys, no new timers, no new dependencies.

## Why this is the permanent fix, not a band-aid

1. **Matches the documented contract** in memory `AUTH-WEDGE-001..012`: "a single transient bad_jwt NEVER signs an active user out."
2. **Symmetric with fetch-guard**: the runtime fetch guard already uses `decidePurgeOnBadJwt()` without a forced refresh — bootstrap was the lone outlier.
3. **Does not weaken security**: a truly corrupt stored token is caught at `getStoredAccessTokenHealth()` (shape_invalid / expired) BEFORE the two-strike branch, and a real second strike within 15s still purges.
4. **Does not hide real refresh failures**: when the access token genuinely expires, the SDK's auto-refresh runs on its own schedule; if THAT call returns refresh_invalid, the existing `onAuthStateChange("SIGNED_OUT")` and `TOKEN_REFRESHED` paths handle it cleanly.
5. **Closes the regression class**: any future GoTrue/edge hiccup that flaps `/user` + `/token` together can no longer sign users out in one round-trip.

## Guardrails to lock the bug class

- **Unit test** `src/lib/auth/__tests__/bootstrap-self-heal.test.ts`: simulate `getUser → bad_jwt` AND `refreshSession → bad_jwt` with a structurally valid stored token; assert session stays set, no `purgeLocalAuthState` call, beacon emits `transient_bad_jwt`.
- **Unit test**: same scenario twice within 15s → second call purges (existing two-strike path still works).
- **Unit test**: stored token shape_invalid → purges on first strike (unchanged behavior).
- **ESLint guard** (extend existing `eslint-plugin-no-focus-listener`-style local rule): forbid new `supabase.auth.refreshSession()` calls inside `AuthContext.tsx` bootstrap to prevent re-introduction.
- **BDD scenarios** (added to `bdd_scenarios` table per workspace rules):
  - `AUTH-WEDGE-013` Transient bad_jwt on bootstrap does not sign user out
  - `AUTH-WEDGE-014` Two transient bad_jwt within 15s purges as designed
  - `AUTH-WEDGE-015` Google OAuth + GoTrue /user 403 keeps user signed in

## Receipts after ship

- `git diff --stat` showing only `src/contexts/AuthContext.tsx` + new test file + BDD migration.
- Tests pass (existing AUTH-WEDGE suite + 3 new cases).
- Memory `AUTH-WEDGE-001..012` updated to `..015` with the bootstrap clarification.
- Beacon `transient_bad_jwt` visible in `ops_events` (already wired) so future hiccups are observable without being destructive.

## Out of scope

- The underlying GoTrue/edge `bad_jwt` flapping is a platform-side issue; we can't fix it from app code. This change makes the app survive it gracefully.
- No changes to login UI, OAuth provider config, RLS, profiles, MFA, captcha, or rate-limit tables.
