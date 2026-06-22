## Root-cause layer

**DNS / hosting / edge config — not app code.**

The OAuth loop exists because the auth surface is reachable on TWO origins (`techfleet.network` apex and `www.techfleet.network`), and the Lovable OAuth broker only round-trips cleanly on `www`. Every client-side workaround we've shipped (`needsCanonicalRestart` click-time redirect, sessionStorage memory hack, and now `enforceCanonicalHost()` at boot) is a band-aid for a missing **301 redirect at the edge**. Per the auth-flow-lockdown skill, this MUST be fixed in hosting config, and the client guards MUST be deleted in the same change.

## What you (human) must change in Lovable hosting — I cannot do this from code

In **Project Settings → Domains**:

1. Keep BOTH `techfleet.network` and `www.techfleet.network` connected.
2. Set **`www.techfleet.network` as Primary**.
3. Confirm `techfleet.network` (apex) status shows it redirects to the primary. Lovable's custom-domain layer issues a 301 apex→www automatically when a non-primary domain is attached to the same project. If the apex is still serving the app directly (status "Active" but not redirecting), remove and re-add it with www as primary so the 301 is provisioned.
4. Verify with `curl -I https://techfleet.network/login` — expect `HTTP/2 301` and `location: https://www.techfleet.network/login`. If you don't see that, the rest of this plan cannot ship; tell me and I'll stop.

Once the edge 301 exists, the apex can never reach React, so no client guard is needed.

## Code changes (subtractive only — no new boot guards)

### Delete

- `src/lib/host-canonical.ts` — entire file.
- `enforceCanonicalHost()` import + call in `src/main.tsx` (boot block gets shorter by 2 lines + 1 import).
- `needsCanonicalRestart()` from `src/lib/auth/oauth-origin.ts` (already unused after last turn; confirm no callers).
- `src/test/lib/host-canonical.test.ts` — obsolete.

### Keep

- `getCanonicalOAuthOrigin()` in `oauth-origin.ts` — still useful as defense-in-depth for `redirect_uri` pinning, but it becomes a no-op in practice because the edge 301 means we're always on www.
- `GoogleSignInButton.tsx` — already cleaned last turn, no changes.
- `SignInScreen.tsx` — already cleaned last turn, no changes.

### Do NOT add

- No new `main.tsx` side-effect.
- No new sessionStorage/localStorage cross-origin coordination.
- No new fetch guard, no new redirect interceptor.

Net effect: boot sequence shrinks by one guard. That matches the lockdown rule "boot sequence must get shorter."

## Proof / contract tests

I'll wire the 8 contract flows from the auth-flow-lockdown skill into the existing Playwright suite under `e2e/auth/` and run them on Chromium AND Firefox. New/updated specs:

1. `e2e/auth/login-email.e2e.ts` — email+password → dashboard.
2. `e2e/auth/signup.e2e.ts` — signup → expected post-signup state.
3. `e2e/auth/password-reset-roundtrip.e2e.ts` — already exists, confirm green.
4. `e2e/auth/google-oauth.e2e.ts` — OAuth round-trip, no loop. (Stubbed at broker boundary; full provider hop runs in manual soak.)
5. **`e2e/auth/apex-canonical-edge.e2e.ts`** — `curl -I` style fetch of `https://techfleet.network/login` asserts `301` + `location: https://www.techfleet.network/login`. **This is the red-before/green-after test for the real fix.** It will be RED until you flip the Lovable domain setting.
6. `e2e/auth/oauth-callback.e2e.ts` — `?code=` / `#access_token=…` completes without redirect race.
7. `e2e/auth/mfa-single-challenge.e2e.ts` — verified factor < AAL2 → one clean challenge; wrong TOTP shows error, no retry storm.
8. `e2e/auth/session-recovery.e2e.ts` — single bad/expired token → clean re-auth, no refresh storm, no lock contention.

Gate: all 8 green on Chromium + Firefox before I claim done. BDD rows added for `AUTH-OAUTH-APEX-EDGE-301-001` and the contract suite IDs.

## Order of operations

1. **You** flip the Lovable domain primary to www and confirm `curl -I` shows the 301. Tell me when done.
2. **I** delete `host-canonical.ts`, its main.tsx wiring, the obsolete test, and `needsCanonicalRestart`. Single commit.
3. **I** add/verify the 8 contract specs and run them on both browsers.
4. **I** show you the diff and the test report. If any of the 8 are red, I say so plainly and do not claim done.

## What I cannot do

- I cannot change Lovable domain/DNS settings from this environment. Step 1 is yours.
- I cannot prove the 301 exists until step 1 is done; the apex-canonical test will be red until then. That is the correct red-before state.

## Honest gap

If Lovable's custom-domain layer does NOT auto-301 non-primary domains (I'm 90% confident it does based on the custom-domains doc, but haven't verified for this exact account), the real fix is to add a Cloudflare/edge rule in front, OR accept the client `enforceCanonicalHost()` as the stopgap and document it as such. I won't silently keep the band-aid — I'll tell you and we decide.
