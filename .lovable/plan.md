# Permanent fix for recurring login and account issues

You are right: this is not acceptable scalable auth architecture.

## Why this happened

The current code has three architectural gaps:

1. **Password/auth forms are duplicated per page.**
   Register has a confirm-password field, but Reset Password was built separately and only has one password field. That allowed a safety control to exist in one flow and be missing in another.

2. **The password reset flow trusts client UI too much.**
   `AuthService.updatePassword(newPassword)` calls the auth SDK directly. The SDK only knows the recovery session is valid; it cannot know whether the person mistyped what they meant to type. So a typo can be stored successfully, and the current recovery session makes the person appear logged in until the next sign-in.

3. **CI tests do not currently prove the full user promise.**
   Existing tests check pieces of auth UI and service behavior, but not the full round trip: request reset → open reset link → set password → sign out/close session → sign in with the new password.

## What I will change

### 1. Fix the immediate password-reset UX

- Add **Confirm new password** to `ResetPasswordPage.tsx`.
- Block submit unless:
  - password passes the shared `passwordSchema`
  - confirmation is present
  - password and confirmation match exactly
- Show an accessible inline mismatch message with `role="alert"`.
- Disable the submit button while invalid, not just after submit.
- Update success copy so members understand they are signed in now and should use the new password next time.

### 2. Replace page-by-page password fields with one shared component

Create `src/components/auth/PasswordSetFields.tsx` as the only approved way to collect a new password.

It will own:

- new password field
- confirm password field
- show/hide controls
- password requirements checklist
- exact-match validation
- accessible error text
- `autoComplete="new-password"`
- stable API: `{ password, isValid, errors }`

Then migrate:

- `ResetPasswordPage.tsx`
- `RegisterPage.tsx`

This removes the class of bug where one page forgets a safety field another page has.

### 3. Move credential mutation behind an app-owned invariant

Change `AuthService.updatePassword` from:

```ts
updatePassword(newPassword)
```

to:

```ts
updatePassword({ password, confirmPassword })
```

Then enforce the same invariant in the service layer before any backend call:

- both fields required
- schema-valid password
- exact match
- no direct SDK update from pages

If the invariant fails, no credential update request is made.

### 4. Add a backend password-update guard

Add an app backend function, `update-password-confirmed`, that:

- requires an authenticated recovery/current session
- validates `password` and `confirmPassword` server-side
- rejects mismatches before changing credentials
- updates the password only after validation
- records a non-sensitive audit event with `confirmed: true`
- preserves the current device session and revokes other sessions through the existing revocation path

This is the durable invariant layer. The UI can regress, but the backend will still reject unconfirmed password updates.

### 5. Add a CI lint guard so this cannot be reintroduced

Add a custom lint rule:

- forbid raw `supabase.auth.updateUser({ password })` outside `AuthService`
- forbid raw new-password inputs outside `PasswordSetFields`
- fail CI if a future page hand-rolls password setup again

This turns the architecture rule into an automated gate.

### 6. Add full round-trip auth tests

Add Playwright coverage for the real user promise:

- reset password with mismatched confirmation → cannot submit
- reset password with matching confirmation → succeeds
- sign out / clear session
- sign in with the new password → succeeds
- sign in with the old password → fails

Also add Vitest coverage that proves:

- `ResetPasswordPage` does not call `AuthService.updatePassword` on mismatch
- `AuthService.updatePassword` refuses mismatches
- the backend function rejects missing or false confirmation metadata

### 7. Add BDD scenarios and review checklist guardrail

Add BDD scenarios:

- **AUTH-RESET-010** — mismatched reset confirmation blocks submit at UI and service layer
- **AUTH-RESET-011** — matching reset password signs in successfully after a new session
- **AUTH-RESET-012** — direct unconfirmed password update path is rejected by backend/service guard

Update `docs/code-review-checklist.md` with an **Auth credential changes** section:

- shared password component required
- backend invariant required
- full round-trip test required
- no raw SDK password mutation from pages
- no password-change success copy without next-sign-in expectation

### 8. Save the architecture rule to project memory

Add a permanent memory rule:

> Credential mutation screens must use shared password primitives, app-owned service methods, backend confirmation guards, and round-trip E2E tests. No page may call password mutation SDKs directly.

## Files planned

- `src/components/auth/PasswordSetFields.tsx`
- `src/pages/ResetPasswordPage.tsx`
- `src/pages/RegisterPage.tsx`
- `src/services/auth.service.ts`
- `supabase/functions/update-password-confirmed/index.ts`
- `scripts/lint/eslint-plugin-auth-invariants.mjs`
- `eslint.config.js`
- `src/test/ui/ResetPasswordPage.test.tsx`
- `src/test/services/auth.service.test.ts`
- `e2e/auth/password-reset-roundtrip.e2e.ts`
- `.github/workflows/regression.yml`
- `docs/code-review-checklist.md`
- project memory + BDD scenario entries

## Definition of done

This is complete only when:

- Reset Password cannot submit mismatched passwords.
- No page directly mutates a password outside the auth service.
- Backend rejects unconfirmed password updates.
- CI fails if anyone reintroduces hand-rolled new-password fields.
- CI proves the full reset → sign out → sign in round trip.
- The architecture rule is documented in review checklist, BDD, and memory.