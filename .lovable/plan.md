## Root cause

Get Help loads zero tickets even though Freescout has them. The smoking gun is in the data, not the UI:

- Last 12h of edge HTTP logs: **0** requests to `freescout-proxy` (every other function shows up: `process-freescout-events`, `record-web-vital`, `translate-strings`, etc.).
- Same window in `audit_log`: ~15 client-side `edge_invoke_failed` rows for `freescout-proxy` (`listMine`, `listAll`, `create`, `reply`), all with `reason:invoke_error` and — critically — **no `upstream:<status>` tag**.

`freescoutInvoke.ts` only attaches `upstream:` when `error.context` is a real `Response`. No context means the supabase-js call failed at transport — i.e., the Edge Functions gateway returned before the function ran. Combined with zero edge HTTP rows for that slug, the function isn't reachable in this deploy.

Why it isn't reachable: `freescout-proxy` (and `freescout-validate-secret`, `freescout-sync-customer`, `freescout-provision-admin`) have **no entry in `supabase/config.toml`**. Only `freescout-webhook` and `process-freescout-events` are pinned. Functions without a config block rely entirely on the deploy manifest, and at least `freescout-proxy` is currently not live. The source exists in `supabase/functions/freescout-proxy/index.ts` — it just isn't deployed.

This affects admins and members identically because `listMine`, `listAll`, `get`, `create`, and `reply` all go through the same proxy.

## Fix (root-cause, permanent — no band-aid)

### 1. Redeploy the missing Freescout edge functions

Deploy in one shot: `freescout-proxy`, `freescout-validate-secret`, `freescout-sync-customer`, `freescout-provision-admin`. (`freescout-webhook` and `process-freescout-events` are already live.) No code change needed — the source is already correct.

### 2. Pin Freescout functions in `supabase/config.toml`

Add explicit config blocks so intent is captured in source:

```
[functions.freescout-proxy]
  verify_jwt = true
[functions.freescout-validate-secret]
  verify_jwt = true
[functions.freescout-sync-customer]
  verify_jwt = true
[functions.freescout-provision-admin]
  verify_jwt = true
```

`verify_jwt=true` matches the existing behavior (every action in the proxy already calls `requireAuthenticatedRequest`); the explicit pin protects against silent default drift.

### 3. Make `invoke_error` self-describing for transport failures

In `src/lib/support/freescoutInvoke.ts`, when `error.context` is missing (no Response = transport-level failure), tag the audit row with `upstream:transport_error` and, when available, `error_name:<error.constructor.name>`. This means the next time a function disappears or the gateway 404s, the audit row is instantly diagnosable — no need to cross-reference edge HTTP logs to figure out "did it even run?".

Severity stays `warn` (per existing `Edge CORS Trace Header` memory).

### 4. CI guardrail: every function in `supabase/functions/` must be covered

Add `scripts/ci/check-edge-function-coverage.mjs` that fails CI when any directory under `supabase/functions/` (other than `_shared`) lacks either:

- a `[functions.<name>]` block in `supabase/config.toml`, **or**
- an entry on an explicit `KNOWN_DEFAULT_FUNCTIONS` allow-list in the script.

Wire it into the existing regression workflow (`.github/workflows/regression.yml`) alongside the other smoke checks. This is the durable invariant that turns "function silently undeployed" into a red CI build, not a production outage.

### 5. BDD coverage

Add three scenarios in `bdd_scenarios`:

- **HELP-DESK-040** — Member opens Get Help → `freescout-proxy` reachable → ticket list renders (`[UI]` items > 0 when DB pointers / Freescout has data, `[Code]` edge HTTP 200, `[DB]` `audit_log` has no `edge_invoke_failed` row for the request trace).
- **HELP-DESK-041** — Admin opens Get Help "All tickets" → `listAll` returns rows for `DEFAULT_MAILBOX_ID` (`[UI]` AG Grid populated, `[Code]` 200, `[DB]` no error audit row).
- **HELP-DESK-042** — Transport-level failure on `freescout-proxy` records `upstream:transport_error` on `audit_log.changed_fields` (`[Code]` `freescoutInvoke` augments extras when `error.context` is missing, `[DB]` audit row carries the tag, `[UI]` user sees the existing "We couldn't load your tickets" empty state with retry).

### 6. Memory update

Extend the existing `[Get Help Scale Contract]` / `[Get Help Secret Contract]` memory with a new core rule: **"Every edge function directory under `supabase/functions/` must be pinned in `supabase/config.toml` (excluding `_shared/`); enforced by `scripts/ci/check-edge-function-coverage.mjs`."** This makes the lesson reusable across all future functions, not just Freescout.

## Files

- `supabase/config.toml` — add 4 `[functions.freescout-*]` blocks
- `src/lib/support/freescoutInvoke.ts` — tag `upstream:transport_error` / `error_name:` when context missing
- `scripts/ci/check-edge-function-coverage.mjs` — new coverage script
- `.github/workflows/regression.yml` — invoke the new script
- `bdd_scenarios` — insert HELP-DESK-040..042
- `mem://index.md` — append the new core rule

## Definition of done

- `freescout-proxy` returns 200 for `listMine`/`listAll` on a logged-in session; Get Help renders tickets for both admins and members.
- Every Freescout edge function appears in `supabase/config.toml`.
- A future undeployed/unpinned function fails CI (`check-edge-function-coverage.mjs`).
- Any future transport-level `invoke_error` audit row carries `upstream:transport_error`.
- BDD HELP-DESK-040..042 inserted.
- Core memory rule added.
