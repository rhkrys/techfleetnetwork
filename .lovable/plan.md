## Goal

Today's incident (Cameron + many others wedged after the 19:32 UTC GoTrue rotation) happened because three small weaknesses lined up:

1. The "is this a recoverable auth error?" check lived in **two places** and only recognised refresh-token strings — not `bad_jwt` / malformed access tokens.
2. Auth bootstrap trusted whatever was in `localStorage` and never asked GoTrue "is this token still valid?".
3. Once a dead token was in storage, the Supabase SDK auto-refresh loop kept hammering `/user`, drowning the user (and our logs) instead of bailing out.

The hot-fix I shipped already closes #1 and #2. This refactor turns that into a permanent, single-source-of-truth pattern so no future rotation, JWT-shape change, key swap, or stale-storage bug can wedge users again.

## Phases (ship all in one shipment)

### Phase 1 — One classifier, one purger

- New module `src/lib/auth/session-health.ts` exporting:
  - `classifyAuthError(err): "refresh_invalid" | "jwt_corrupt" | "revoked" | "ok"`
  - `purgeLocalAuthState({ reason })` — single implementation that clears every `sb-*-auth-token`, the marker, MFA flags, revocation cache, and the captcha cache.
- Delete the duplicate `isInvalidRefreshTokenAuthError` in `AuthContext.tsx` and `clearLocalAuthArtifacts` in `auth.service.ts`; both import from the new module.
- All call-sites (AuthContext bootstrap, AuthService.getSession/signInWithPassword, MfaService, `audited-invoke`, the OAuth broker wrapper in `src/integrations/lovable/index.ts`) route through these two functions.

### Phase 2 — Bootstrap validation gate (formalised)

- AuthContext **always** validates a restored session against `/user` before exposing it to the app (today's hot-fix becomes the canonical path, not a special case).
- Add a small `auth_client_fingerprint` row to localStorage = `hash(VITE_SUPABASE_PUBLISHABLE_KEY + VITE_SUPABASE_URL)`. On boot, if the stored fingerprint ≠ current → purge before even calling `getSession()`. This catches the "publishable key rotated, old session is now garbage" case without a round-trip.
- Pre-`setSession` shape check: reject any token that isn't 3 base64url segments before writing it to storage. Stops upstream bugs from ever planting a malformed token.

### Phase 3 — Global fetch guard (kills the refresh storm)

- Wrap the Supabase client's `global.fetch` (configured in `src/integrations/supabase/client.ts` via a thin wrapper file we own — the auto-generated client itself is untouched, we just compose around it).
- On any response where `status === 403` AND body matches `bad_jwt` / `invalid number of segments` / `unable to parse or verify signature`:
  1. Emit a one-shot `auth:wedged` window event (debounced 5s).
  2. Call `purgeLocalAuthState({ reason: "jwt_corrupt" })`.
  3. `supabase.auth.signOut({ scope: "local" })`.
  4. Redirect to `/login?reason=session_expired` with a friendly toast ("Your session ended. Please sign in again.").
- Net effect: one bad response → clean recovery, no loop, no log flood.

### Phase 4 — Sign-in hygiene

- On every successful sign-in (password + OAuth callback), call `purgeLocalAuthState({ keepCurrent: true })` **before** writing new tokens, so residual `sb-*-auth-token` rows from a prior session can't race the new ones (the existing comment at `auth.service.ts:212` admits this race; this removes it).
- Same guard in `src/integrations/lovable/index.ts` before `supabase.auth.setSession(result.tokens)`.

### Phase 5 — Observability

- New tiny edge fn `record-auth-wedge` (verify_jwt=false, rate-limited by IP) that bumps an `auth_wedge_events` counter table.
- Hook `auth:wedged` → fire-and-forget beacon.
- System Health → new "Auth Wedge" card, and a Triage rule: >10 events / 5 min ⇒ `agent_fix_queue.severity='error'` + admin push (same path as Triage Critical Push). We'll see the next rotation within minutes, not customer complaints.

### Phase 6 — Tests + BDD

- Unit: `classifyAuthError` covers every observed message variant.
- Unit: pre-`setSession` shape check rejects non-JWT, accepts JWT.
- Integration (RTL): seed localStorage with a non-JWT access token → `<AuthProvider>` settles to logged-out, no infinite re-render, no spinner-lock.
- Playwright: stub `/user` 403 bad_jwt mid-session → redirect to `/login?reason=session_expired`, toast shown, storage cleared, no further `/user` calls in next 5s.
- BDD scenarios `AUTH-WEDGE-001..007` in `bdd_scenarios` (tri-layer Then-clauses: UI redirect, DB wedge counter row, code `purgeLocalAuthState` invocation).

## Technical detail (for reference)

```text
src/lib/auth/session-health.ts        NEW  classifier + purger (single source)
src/lib/auth/jwt-shape.ts             NEW  isLikelyJwt(token): boolean
src/lib/auth/fetch-guard.ts           NEW  wrap supabase global fetch
src/contexts/AuthContext.tsx          EDIT use session-health; keep bootstrap probe
src/services/auth.service.ts          EDIT delegate to session-health; purge-before-write
src/integrations/lovable/index.ts     EDIT shape-check + purge-before-setSession
src/integrations/supabase/audited-invoke.ts  EDIT classify via session-health
src/services/mfa.service.ts           EDIT classify via session-health
supabase/functions/record-auth-wedge/ NEW  observability beacon
migrations: auth_wedge_events table + Triage rule
src/test/lib/session-health.test.ts   NEW
src/test/ui/AuthProvider.wedge.test.tsx NEW
e2e/auth/wedge-recovery.e2e.ts        NEW
bdd_scenarios rows AUTH-WEDGE-001..007
```

## Risk / rollback

- Zero schema change to existing tables; one new counter table + one new edge fn.
- Fetch guard is additive (composes around the auto-generated Supabase client — we never edit `client.ts`).
- If the guard misfires, flipping a feature flag `auth_wedge_guard_enabled` in `app_config` disables it without a deploy.

## Out of scope

- No changes to MFA, RLS, or session-revocation flows.
- No new auth providers, no UI redesign of `/login`.
