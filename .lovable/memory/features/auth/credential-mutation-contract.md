---
name: Auth credential mutation contract
description: Password/credential changes require shared UI, service-owned validation, backend confirmation guard, and round-trip tests
type: feature
---
Credential mutation screens MUST use `<PasswordSetFields>` for new-password collection and must call `AuthService.updatePassword({ password, confirmPassword })`; pages may not call password mutation SDKs directly.

`AuthService.updatePassword` must validate both fields, exact match, and password strength before calling `supabase.auth.updateUser({ password })` from the verified recovery/current session.

Do not reintroduce an edge function between a verified recovery session and the password update. The old `update-password-confirmed` function is retired because its deploy availability became a single point of failure. Post-update cleanup is best-effort: clear auth rate-limit rows and revoke other devices while keeping the current recovery session signed in.

CI must block regressions with auth-invariant ESLint rules and reset → sign out/clear session → sign in with new password coverage.