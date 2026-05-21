## Bug

On `/login`, the password flow rejects with **"Email address is required"** even after the user has typed/autofilled their email. Google sign-in is unaffected because it doesn't read the email field.

## Root cause

`LoginPage.tsx` uses controlled `<Input>` for email and password. When Chrome/Safari/1Password autofills these fields (the most common path on a returning-user login), the browser writes the DOM `value` directly without dispatching a React-compatible `input` event. The `email`/`password` React state stays at `""`. On submit, `loginSchema.safeParse({ email: "", password: "" })` fails with "Email address is required" — even though the field visibly contains text.

This matches the screenshot: both fields show content, yet the inline "Email address is required" error appears the moment the user clicks **Sign in**.

## Fix

Two small, defensive changes in `src/pages/LoginPage.tsx` — no schema or service changes:

1. **Attach refs to the email + password `<Input>`s** and, at the top of `handleSubmit`, read `emailRef.current?.value` / `passwordRef.current?.value`. If the ref value differs from React state, sync state and use the ref value for validation. This guarantees autofilled content is captured even if `onChange` never fired.

2. **Add a Chrome-autofill detector** — a tiny `onAnimationStart` handler on both inputs that listens for the WebKit `onAutoFillStart` animation (triggered by a `:-webkit-autofill` CSS keyframe added to `index.css`). When it fires, push the current DOM value into state. This keeps the live-validation effect (`useEffect` on `[email, password, touched]`) in sync so the red "required" hint never flashes on a populated field.

3. **Keep existing flow intact** — Turnstile lazy mount, lockout/captcha logic, MFA gate, error-reporting all unchanged.

## Files

- `src/pages/LoginPage.tsx` — add refs, ref-read at submit, `onAnimationStart` handlers.
- `src/index.css` — add `@keyframes onAutoFillStart` + `input:-webkit-autofill { animation-name: onAutoFillStart; }` (scoped, no visual change).

## BDD (stored in `bdd_scenarios`)

- **LOGIN-AUTOFILL-001** Given returning user with saved credentials, when browser autofills email + password and user clicks Sign in, then form submits with autofilled values [UI] no "required" error, [Code] `loginSchema.safeParse` receives non-empty email, [DB] `record_failed_login` is not called.
- **LOGIN-AUTOFILL-002** Given autofill fires after mount, when `onAnimationStart` triggers, then React state syncs to DOM value within one render.
- **LOGIN-AUTOFILL-003** Given user types manually (no autofill), then submit behavior is unchanged (regression guard).

No DB migration, no edge function changes, no UX regression — fields look and behave identically.