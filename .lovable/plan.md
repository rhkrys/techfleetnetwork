## Root cause

The DevTools snapshot shows three RPCs stuck in `(pending)` forever:

- `list_pending_role_grants_for_user` (called from `useDiscordRoleRetry`)
- `admin_2fa_grace_active`
- `admin_2fa_grace_deadline` (both called from `AdminRoute` and `AdminTwoFactorGraceDialog`)

Database side is healthy (`pg_stat_activity` shows no long queries; only an idle realtime replication wait). The hang is on the PostgREST/edge transport — a transient hiccup that the supabase-js client never times out from.

Two real UX bugs surface this:

1. **`src/components/AdminRoute.tsx` line 57** blocks the entire admin page render with a spinner whenever `mfaState === null`. If either grace RPC never resolves, every `/admin/*` route is permanently stuck on the spinner the screenshot shows.
2. **`src/components/AdminTwoFactorGraceDialog.tsx`** re-fires the same two RPCs every 10s on a `setInterval`, with no abort and no per-attempt timeout. Pending requests pile up behind the wedged one and the supabase-js HTTP/2 stream stays congested.

`useDiscordRoleRetry` fires its RPC once per session, so it doesn't pile up, but it also has no timeout and silently hangs.

The screenshot's `/` route spinner is the same pattern in a different gate (`<Index>` and `AppLayout` waiting on auth-derived state that depends on the same client). Once these guards stop blocking on hanging RPCs, the visible spinner clears.

## Fix (frontend only — no DB / auth flow / policy changes)

### 1. New helper: `src/lib/db/rpc-with-timeout.ts`

Wrap a Supabase RPC promise with `AbortController` + `Promise.race` against a configurable timeout (default 8000 ms, 1 retry on transient timeout). Returns the standard `{ data, error }` shape so callers don't change. Unit-tested under `src/test/lib/`.

### 2. `AdminRoute.tsx` — fail open, never block forever

- Replace direct `(supabase as any).rpc(...)` with the timeout helper (8s).
- Change the render gate from `(isAdmin && mfaState === null)` to a finite "checking 2FA…" state with a hard ceiling: after 8s, set `mfaState` to a permissive default (`hasTotp: true, graceActive: null`) so admin children render. The dialog/banner will reconcile on the next successful poll.
- Beacon a `severity:warn` audit event (`reportError`) tagged `fingerprint:admin_2fa_rpc_timeout` so Triage sees the hiccup without paging.

### 3. `AdminTwoFactorGraceDialog.tsx` — no pile-ups

- Use the same helper with an 8s timeout.
- Guard the `setInterval` so a poll cannot start while the previous one is in-flight (in-flight ref).
- On timeout, keep last-known state instead of resetting to `null` (so a transient hiccup never re-shows or hides the modal incorrectly).

### 4. `useDiscordRoleRetry.ts` — bounded and non-blocking

- Apply the same 8s timeout to the `list_pending_role_grants_for_user` RPC and to `mark_discord_role_grant_result`.
- Already runs after a 1.5s delay; keep that. Already `triedRef`-guarded; keep that.

### 5. BDD scenarios (DB-first per workspace rules)

Insert into `bdd_scenarios` with tri-layer Then-clauses tagged `[UI]/[DB]/[Code]`:

- `ADMIN-2FA-TIMEOUT-001` Admin opens `/admin/*` while grace RPC hangs → page renders within 8s with permissive default; warn-severity audit row written; no `agent_fix_queue` row.
- `ADMIN-2FA-TIMEOUT-002` Grace dialog poll times out → dialog state unchanged; no duplicate in-flight requests.
- `DISCORD-RETRY-TIMEOUT-001` Pending role grants RPC times out → queue remains; no UI block.

### 6. Tests

- Vitest unit tests for `rpc-with-timeout` (resolves, rejects on timeout, retries once, AbortController fires).
- Vitest UI test for `AdminRoute` rendering children after timeout when `mfaState` never resolves.

## Out of scope

- No changes to `auth.users`, profiles, roles, MFA, RLS, or any auth/session machinery.
- No changes to the 3 RPC definitions themselves.
- No new auth entrypoints or providers.

## Files touched

```text
src/lib/db/rpc-with-timeout.ts                 NEW
src/components/AdminRoute.tsx                  EDIT (timeout + fail-open)
src/components/AdminTwoFactorGraceDialog.tsx   EDIT (timeout + in-flight guard)
src/hooks/use-discord-role-retry.ts            EDIT (timeout)
src/test/lib/rpc-with-timeout.test.ts          NEW
src/test/ui/admin-route-fail-open.test.tsx     NEW
supabase/migrations/<new>.sql                  NEW (BDD scenarios only)
```

Each step is independently revertible.
