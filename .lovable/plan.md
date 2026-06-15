## Evidence from the repo and live data

### Current repo state proves the prior cutover stayed additive
- `src/features/auth/ports/session.port.ts` is still a wrapper over legacy `AuthService`:
  - Lines 17–18 import legacy service + generated backend client.
  - Lines 22–38 bind `getSession`, `signOut`, `resetPassword`, `updatePassword`, `signUp`, and resend confirmation directly to `AuthService`.
- `src/services/auth.service.ts` still exists as a 625-line mixed responsibility file:
  - Lines 200–356 own signup and resend confirmation.
  - Lines 359–388 own password reset request.
  - Lines 407–452 own password update.
  - Lines 455–625 own sign-out/session lifecycle.
- `src/features/auth/adapters/supabase-session.adapter.ts` exists but is not the active session port:
  - Lines 34–87 define the intended adapter.
  - But `session.port.ts` does not import it.
- Google sign-in has multiple paths:
  - Active UI path: `src/components/GoogleSignInButton.tsx` lines 36–39 uses Lovable managed OAuth.
  - Dead/duplicate path: `src/features/auth/flows/sign-in-google.flow.ts` lines 24–29 calls direct backend OAuth.
  - Adapter duplicate: `src/features/auth/adapters/supabase-session.adapter.ts` lines 45–50 also has direct Google OAuth.
- Active auth routes are owned by feature screens in `src/App.tsx`:
  - `/login` → `SignInScreen` lines 50, 238.
  - `/register` → `RegisterScreen` lines 57, 239.
  - `/forgot-password` → `ForgotPasswordScreen` lines 68, 240.
  - `/reset-password` → `ResetPasswordScreen` lines 73, 241.
  - `/reset-password/confirm` → `ConfirmRecoveryLinkPage` lines 74, 242.
- Legacy comments still say old pages “stay on disk until Ship 5” in `src/App.tsx` lines 47–72, but the actual remaining risk is legacy service ownership, not route ownership.

### Current live data proves the password-reset email issue is real
- Email domain check: `notify.techfleet.org` is verified and ready.
- Auth email send log query for the last 7 days returned only old rows:
  - Last signup email row: `2026-06-11 06:00:14 UTC`.
  - Last recovery email row: `2026-06-11 00:36:30 UTC`.
  - No recovery/signup auth email rows after June 11.
- Recent auth-email function logs:
  - No matching `error` logs.
  - No matching “Received auth event” logs.
  - Analytics only showed one recent `OPTIONS` preflight, not a real webhook invocation.
- `useForgotPasswordEngine.ts` preserves anti-enumeration but hides operational failure:
  - Lines 103–106 set success after `sessionPort.resetPassword` resolves.
  - Lines 107–129 catch most failures and still call `setSubmitted(true)`.
  - It records only `auth_engine.forgot_failed`, not a delivery-contract failure that ops can page on.

### Existing quality gates are useful but incomplete
- Existing scripts:
  - `scripts/ci/check-auth-direct-signin.mjs` locks only password sign-in.
  - `scripts/ci/check-auth-layer-graph.mjs` checks auth feature import direction.
  - `scripts/ci/check-legacy-auth-importers.mjs` snapshot-locks old importer growth.
- Existing lint rules are not strict enough yet:
  - `eslint.config.js` lines 122–124 keep direct auth calls, counter calls, and auth storage literals at `warn`, not `error`.
- Existing backend broker exists but is not the active client owner:
  - `supabase/functions/auth-broker/index.ts` routes sign-in, sign-up, reset request, reset complete, sign-out, identity check.
  - Current active client flows still use mixed client SDK/service paths instead of broker-only ownership.

## Target architecture

```text
Auth screens
  ↓ presentation-only events
Auth engines
  ↓ typed Result<AuthOk, AuthErr>; no throws across boundary
Auth flows
  ↓ one call per use case
Auth application services
  ↓ one backend adapter only
Auth broker / managed OAuth / session adapter
  ↓ typed backend auth + telemetry + delivery contract
Database/ops events/email send log/probers
```

### One auth engine only
All login, signup, forgot password, reset password, captcha, lockout, session-write recovery, sign-out, and identity hint logic will route through `src/features/auth/**` only.

### Delete-first cutover rule
No wrapping old code. The cutover is only done when:
- `src/services/auth.service.ts` is deleted or reduced to a non-auth compatibility shell with zero auth logic.
- `session.port.ts` imports the real adapter/use-case layer, not `AuthService`.
- Duplicate Google OAuth flows are deleted.
- CI fails if any removed path comes back.

## Build plan

### Phase 1 — Freeze the current evidence as tests and BDD
- Add BDD rows `AUTH-ARCH-CUTOVER-001..012` with tri-layer `[UI]`, `[DB]`, `[Code]` Then clauses.
- Add tests before refactor for:
  - Forgot-password constant user copy + internal failure telemetry.
  - Signup success/known failure typed outcomes.
  - Reset-complete session-expired/weak/same/success outcomes.
  - Google sign-in single Lovable managed OAuth path.
  - No direct auth SDK use outside the adapter/broker boundary.

### Phase 2 — Create the real auth use-case layer
Add explicit use cases under `src/features/auth/services/`:
- `request-password-reset.service.ts`
- `complete-password-reset.service.ts`
- `sign-up.service.ts`
- `resend-signup-confirmation.service.ts`
- `sign-out.service.ts`
- `session.service.ts`
- `identity-hint.service.ts`
- `start-google-sign-in.service.ts`

Every use case returns a typed result, never raw thrown provider errors.

### Phase 3 — Replace `session.port.ts`
- Remove all `AuthService.*.bind(...)` calls.
- Point `sessionPort` to the new use cases and adapter.
- Keep only generic session methods that non-auth code still needs: get session, auth-state subscription, get user, clear local state, sign out.
- Move password reset/signup/update out of the generic session port into auth-specific flows so session and credential operations stop being mixed.

### Phase 4 — Cut password reset to the delivery contract
- Forgot password keeps anti-enumeration UI copy, but internally records distinct outcomes:
  - `auth_engine.forgot_started`
  - `auth_engine.forgot_accepted`
  - `auth_engine.forgot_email_delivery_unverified`
  - `auth_engine.forgot_rate_limited`
  - `auth_engine.forgot_google_only_blocked`
- Add a backend health contract that alerts when reset/signup attempts happen but no auth email send-log row appears in the expected window.
- Keep `/reset-password/confirm` as the inert link-preview-safe route.
- Add `/reset-password/*` fallback to preserve old reset links and stop legacy 404s.

### Phase 5 — Cut signup/resend to typed use cases
- Move signup and resend out of legacy service.
- Preserve existing UI states:
  - existing account path
  - verification email sent path
  - resend confirmation path
  - captcha/lockout behavior
  - domain validation
  - sanctions fail-open behavior
- Internally record email-delivery-unverified when the auth system accepts but no send-log row follows.

### Phase 6 — Cut sign-in/session/sign-out ownership
- Keep the already improved password sign-in path, but remove remaining legacy session/sign-out ownership.
- Ensure `client_session_write_failed` remains non-punitive.
- Keep MFA behavior unchanged.
- Keep session revocation behavior unchanged.
- No changes to accounts, profiles, roles, MFA, audit, or rate-limit tables.

### Phase 7 — Delete duplicate Google paths
- Keep one Google path: `GoogleSignInButton` → `start-google-sign-in.service.ts` → Lovable managed OAuth.
- Delete `src/features/auth/flows/sign-in-google.flow.ts` if unused.
- Remove `signInGoogle` from `supabase-session.adapter.ts`.
- Add a “Trouble with Google?” help link/copy path without changing OAuth mechanics.

### Phase 8 — Delete or neutralize legacy service
- Delete `src/services/auth.service.ts` if all importers are gone.
- If non-auth modules still need session helpers, create a tiny compatibility file that re-exports `sessionPort` only and contains zero direct auth SDK calls.
- Update `scripts/ci/legacy-auth-importers.snapshot.json` downward, not upward.

### Phase 9 — Make regression impossible to merge
Promote/add CI rules that fail on:
- Any `AuthService` import.
- Any `src/services/auth.service.ts` auth logic returning.
- Any direct `supabase.auth.*`/backend auth SDK call outside the one adapter/broker boundary.
- Any direct Google OAuth call except Lovable managed OAuth.
- Any auth screen importing backend clients, ports, rate-limit services, captcha libs, lockout libs, or flows directly.
- Any auth engine catch block that swallows an error without telemetry.
- Any hard-coded auth storage key outside `auth-storage-keys.ts`.
- Any direct captcha/lockout counter mutation outside auth failure policy.

## Why this prevents the recurring bug classes

- **No silent reset-email failures:** forgot/signup flows will still avoid account enumeration, but ops gets typed evidence when email delivery is unverified.
- **No duplicate Google paths:** one managed OAuth entrypoint means no stale direct-provider code can be accidentally revived.
- **No legacy service gravity:** deleting `AuthService` removes the 625-line mixed-responsibility file that keeps pulling new work back into spaghetti.
- **No counter inflation:** only the failure policy can increment captcha/lockout/rate-limit counters, preserving the Vichea/session-write invariant.
- **No route drift:** route ownership stays in `App.tsx`, with tests proving reset and legacy reset paths render the right screens.
- **No “warn-only” architecture:** guardrails become hard failures, so future changes cannot merge with old imports/direct SDK calls.

## Why this is the recommended architecture

- It separates presentation, state, use cases, provider adapters, and monitoring.
- It uses typed results instead of thrown provider strings across UI boundaries.
- It preserves OWASP anti-enumeration while adding internal observability.
- It follows the existing repo’s own intended pattern: `src/features/auth/README.md` already says only auth services should own auth calls, storage, failures, and flows.
- It turns incidents into BDD + CI contracts, which matches the project rule that every feature/fix must be represented in `bdd_scenarios`.

## Receipts I will provide after implementation

- Deleted/neutralized files list, especially `src/services/auth.service.ts` and duplicate Google flow files.
- Remaining auth entrypoint inventory with file:line ownership.
- `rg` proof:
  - zero `AuthService` imports
  - zero direct Google backend OAuth calls
  - zero direct auth SDK calls outside allowed boundary
  - zero auth screens importing services/ports/backend clients directly
- BDD rows inserted and query count for `AUTH-ARCH-CUTOVER-*`.
- CI guard outputs and test outputs.
- Live data proof:
  - new forgot-password attempt creates telemetry
  - recovery/signup auth email send-log rows appear again, or delivery-unverified alert fires
  - no new live reset/login failure pattern appears in auth/edge logs after refresh

## Explicit non-goals / safety rails

- No account/profile/role/session/MFA table rewrites.
- No changes to profile emails.
- No RLS loosening.
- No new auth provider.
- No auto-confirm signup.
- No manual secret handling.
- No deleting audit or rate-limit history.
- No UX regression or extra member clicks.