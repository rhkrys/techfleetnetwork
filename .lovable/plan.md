## Goal

Make sign-in and session handling so resilient that **no backend hiccup, proxy timeout, or transient bad-JWT can ever bounce a logged-in member to the login page again** — and prove it with tests + CI guards so it can't quietly come back.

---

## "Unguarded auth path" — 5th-grade version

Your app is a house. The **front door** is the Google button + AuthContext bootstrap we already hardened with safety locks (bad-JWT two-strike gate, OAuth callback watchdog, deferred redirects).

A quick scan found **40+ side doors** — other files that still talk to the auth system directly (`supabase.auth.getSession`, `signOut`, `setSession`, `getUser`). Most just *peek* (safe-ish), but a few can *kick the user out* (`signOut`, `setSession`, raw `getUser`) when the backend stutters. Those are the unguarded paths.

We're going to **make every door go through the same hardened front door**, and put an alarm on any new door someone tries to add.

---

## The 6 hardening layers

### Layer 1 — One canonical session port (the only front door)
Create `src/lib/auth/session-port.ts` exposing:
- `getSessionSafe()` — cached, never throws, returns `null` on transient errors instead of bubbling
- `getUserSafe()` — same, with bad-JWT classifier wired in (reuses `decidePurgeOnBadJwt`)
- `signOutSafe({ scope, reason })` — always best-effort, logs reason, never throws
- `setSessionSafe()` — only callable from AuthContext + OAuth callback module

Everything else in `src/` must import from here.

### Layer 2 — Migrate the 40+ side doors
Sweep all `supabase.auth.*` callsites outside `src/integrations/**`, `src/features/auth/**`, `src/contexts/AuthContext.tsx`, and `src/lib/auth/**` to use the port. Highest-risk first:
- `signOut` callers (EditProfilePage, ProfileEditPanel, MfaEnforcementGuard, AdminTwoFactorGraceDialog) → `signOutSafe`
- `setSession` callers (mfa.service) → `setSessionSafe` via port
- `getSession`/`getUser` callers (~35 files) → `getSessionSafe`/`getUserSafe`

### Layer 3 — Expand the ESLint guardrail
Tighten `eslint-plugin-auth-invariants/no-direct-supabase-auth` so it bans **all** `supabase.auth.*` and `lovable.auth.*` outside:
- `src/integrations/**` (generated)
- `src/lib/auth/**` (the port)
- `src/contexts/AuthContext.tsx` (bootstrap)
- `src/components/GoogleSignInButton.tsx` (managed OAuth entrypoint)

CI fails on any new violation. Existing violations get migrated in Layer 2, not allow-listed.

### Layer 4 — Network-level resilience
Wrap the supabase auth client's underlying fetch with:
- **Retry with jitter** on `/token` and `/user` for 5xx / network errors (max 2 retries, 250ms + 500ms)
- **Circuit breaker** per endpoint (existing `CircuitBreaker` util) — when open, return cached session instead of failing
- **Transient bad-JWT classifier** already exists (`decidePurgeOnBadJwt`); make sure it's the ONLY place that decides to purge a session

Result: a backend hiccup becomes invisible to the user — the app waits, retries, and keeps them logged in.

### Layer 5 — Always-on alarms
- **Beacon `auth_flap_detected`** when `getSessionSafe` sees a transient failure that resolves on retry. Fires into `ops_events` (telemetry sink, 90d retention).
- **System Health → Auth tab** counter: flaps/hr, OAuth callback timeouts/hr, forced signouts/hr.
- **Critical-push rule:** if forced-signout-rate > 5/min platform-wide → page admins (reuses existing critical-push cron).

So if it *ever* starts flaking again, you find out in minutes, not after a member complains.

### Layer 6 — Regression tests + BDD
- Unit tests for `session-port.ts` covering: transient 5xx, bad-JWT shapes, network timeout, circuit-open replay.
- Regression test: "transient `/user` 403 during bootstrap does NOT sign user out" (extends `oauth-callback-pending-defers-redirect.test.ts` pattern).
- BDD scenarios `AUTH-RESILIENCE-001..006` in `bdd_scenarios` table with tri-layer [UI]/[DB]/[Code] expected results.

---

## What this does NOT change

- No changes to `accounts`, `profiles`, `sessions`, `auth.users`, `user_roles`, `revoked_sessions`, `login_rate_limits`, or any MFA table.
- No changes to OAuth provider config — Google managed OAuth stays as-is.
- No changes to login UX — same button, same redirects, same speed.
- No edge functions added or modified for the user-facing path.

---

## Receipts you'll get after build

1. **Auth entrypoints list** — every file that still touches auth, and which port function it now uses.
2. **Removed/guarded paths** — diff of `supabase.auth.*` callsites (before vs after).
3. **CI proof** — ESLint rule output showing 0 violations; test suite output showing all new tests green.
4. **Beacon proof** — sample `auth_flap_detected` row in `ops_events` from a simulated transient failure.
5. **Zero-schema-change proof** — `git diff supabase/migrations/` showing only the BDD-scenarios insert migration.

---

## Why this finally stops the 2-day pattern

The previous fix hardened the **bootstrap** and **Google callback** — the loudest doors. The remaining flakiness comes from quieter doors (a `getSession` in a side panel, a `signOut` in a settings page) that still react to a hiccup by signing the user out or showing a broken state.

After this plan: **one door, one lock, one alarm**. A backend stutter becomes a logged warning, not a logout.
