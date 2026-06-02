---
name: Auth credential mutation contract
description: Password/credential changes require shared UI, service-owned validation, backend confirmation guard, and round-trip tests
type: feature
---
Credential mutation screens MUST use `<PasswordSetFields>` for new-password collection and must call `AuthService.updatePassword({ password, confirmPassword })`; pages may not call password mutation SDKs directly.

`AuthService.updatePassword` must validate both fields, exact match, and password strength before invoking `update-password-confirmed`.

`update-password-confirmed` is the backend invariant: authenticated request only, validates password + confirmation server-side, updates the password, writes `password_updated` audit metadata with `confirmed:true`, and records cross-device revocation without signing out the current device.

CI must block regressions with auth-invariant ESLint rules and reset → sign out/clear session → sign in with new password coverage.