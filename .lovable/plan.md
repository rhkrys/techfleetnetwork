## Root cause

After `supabase.auth.updateUser({ password })` succeeds, the browser/password manager never sees a credential event, so it keeps autofilling the old saved password on next visit. GoTrue returns 401, the user thinks the reset failed, resets again, loop repeats. The server hash is correct every time — the bug is purely that we never told the browser "save this new password for this email."

## The fix (single layer, done correctly)

**1. `src/pages/ResetPasswordPage.tsx`** — immediately after `updatePassword` succeeds, before navigation:

```ts
if ('credentials' in navigator && 'PasswordCredential' in window) {
  try {
    const cred = new (window as any).PasswordCredential({
      id: email,           // pulled from the recovery session's user.email
      password,
      name: email,
    });
    await (navigator.credentials as any).store(cred);
  } catch { /* non-fatal */ }
}
```

This is the W3C Credential Management API. Chrome, Edge, Opera, Samsung Internet, and every Chromium-based password manager (1Password, Bitwarden, Dashlane, LastPass) honor it and update the saved entry in place. Safari/Firefox ignore it harmlessly — and on those browsers the existing `<form autoComplete="on">` + `name="password" autoComplete="new-password"` submit already triggers their native save prompt, so they're covered by what's already there.

**2. `src/components/auth/PasswordSetFields.tsx`** — ensure the inputs are inside a real `<form>` with `method="dialog"` (or a no-op submit handler) and that the email is rendered as a hidden `<input type="email" name="username" autoComplete="username" value={email} readOnly>` sibling. Safari/Firefox require the username field to be present in the same form as `new-password` to fire their save prompt. This is the part `PasswordSetFields` is missing today and is why even non-Chromium browsers don't prompt.

That's it. Two files. No dashboards, no RPCs, no smoke-test extension, no memory entry tracking loops, no recurring-reset detector. The browser saves the new password → next login autofills the correct password → loop is structurally impossible.

## Why this is permanent, not a band-aid

- The Credential Management `store()` call is the canonical, spec-defined way to tell a browser "this credential is now valid." It's not a workaround — it's the API designed for exactly this case (SPA password changes that don't go through a traditional `<form action>` POST).
- The hidden `username` field is the documented requirement from Apple, Mozilla, and Chromium for `autoComplete="new-password"` to be recognized as a credential-change form.
- Combined, every mainstream browser + password manager updates the stored credential the moment the reset succeeds. There is no scenario where the old password remains saved.

## Files touched

- `src/pages/ResetPasswordPage.tsx` — call `navigator.credentials.store` after successful update.
- `src/components/auth/PasswordSetFields.tsx` — wrap in `<form>` and add hidden username input bound to the recovery email.

Nothing else changes.
