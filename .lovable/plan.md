## Do I know what the issue is?

Yes. This is not one bug; it is a chain of weak guarantees across reset-link delivery, recovery-session proof, and observability.

## What actually went wrong

- The reset email path was mostly working: recovery emails were accepted and sent.
- The repeated user-facing failure happens later, on `/reset-password`, when the page lets a member reach `updateUser()` without proving there is a fresh recovery session.
- The code currently treats `verifyOtp()` / `exchangeCodeForSession()` / `setSession()` success as valid if there is no error, but it does not require a real returned session or a successful `getUser()` check before showing the password form.
- The logs did not catch it because reset-page diagnostics use `write_audit_log`, which requires an authenticated session; when the reset session is missing or broken, the diagnostic write silently fails.
- Earlier fixes missed it because they targeted the reset-email/rate-limit layer and then the retired edge-function dependency, while the failing branch was the client recovery-session handoff.

## Hotfix plan

### 1. Make recovery proof a hard invariant

Build one reset-session gate used by `ResetPasswordPage`:

```text
recovery URL proof -> establish session -> validate current user -> unlock form
anything else      -> expired/invalid link -> do not call updateUser()
```

Implementation details:
- Add a helper like `establishPasswordRecoverySession()`.
- For `token_hash`, require `verifyOtp({ type: 'recovery', token_hash })` to return a session or produce one visible to `getSession()`.
- For PKCE `code`, require `exchangeCodeForSession(code)` to return a session or produce one visible to `getSession()`.
- For legacy hash, require `setSession()` plus `getUser()` success.
- If any branch has no verified session, show “Reset link expired” and never render the update form.
- In `handleSubmit`, add a second guard: if the recovery proof flag is not true, block and route to expired-link recovery.

### 2. Stop mislabeling missing sessions as service outages

Tighten `AuthService.updatePassword()` error classification:
- Missing/invalid auth session -> `session_expired`.
- Network/5xx only -> `service_unavailable`.
- Add exact mappings for common backend strings: `Auth session missing`, `Session not found`, `User from sub claim in JWT does not exist`, `JWT expired`, `invalid claim`.

Result: members get the right recovery action instead of “password service unavailable.”

### 3. Add reset observability that works before auth exists

Replace swallowed client-only diagnostics with a public, no-PII recovery telemetry path:
- Add `record-auth-recovery-event` as an explicitly public edge function.
- It accepts only safe fields: branch, outcome, error_class, URL shape booleans, app version, and trace id.
- It never accepts email, password, token, token hash, full URL, or user-entered text.
- It writes to `ops_events` / `record_event`, not raw console-only logs.
- Mount it on every reset branch: token_hash success/fail, code success/fail, hash success/fail, missing session, update error class, update success.

This is why logs were empty before; the page could not write auth-bound audit rows when auth was the broken thing.

### 4. Fix email status visibility so pending rows do not mislead us again

The email log is append-only: `pending` rows remain even after a later `sent` row, so raw counts looked scary while the pgmq queue was empty.

Hotfix:
- Add a latest-status query/view/RPC for email health that collapses by `message_id`.
- Update System Health / diagnostics to show terminal status, not raw append-only row counts.
- Add a recovery-email health assertion: if `pgmq.q_auth_emails` has aged recovery messages or latest status is failed/dlq, alert; old append-only pending rows alone should not page anyone.

### 5. Make reset-link generation fail loudly if shape is unsafe

Harden `auth-email-hook` recovery rewriting:
- Always prefer direct app URL: `/reset-password?token_hash=...&type=recovery`.
- If the hook cannot extract a token hash, emit a high-signal telemetry event with no token content.
- Add a smoke assertion that generated recovery links land on `/reset-password` with one supported recovery proof format.

### 6. Add tests for the actual failure mode

Add targeted tests that would have caught this days ago:
- `verifyOtp` returns no error but no usable session -> form stays locked and `updatePassword` is not called.
- `exchangeCodeForSession` returns no session -> expired-link recovery.
- `setSession` succeeds but `getUser` fails -> expired-link recovery.
- `updateUser` missing-session error -> `session_expired`, not `service_unavailable`.
- reset telemetry fires on every branch, including pre-auth failures.
- `check-account-identity` uses `identity_check`, not `login_attempt`.
- `auth-email-hook` rewrites recovery links to the expected shape.

### 7. Add a production smoke monitor for the full reset path

Create a safe smoke route/job that checks the chain without changing a real member password:

```text
identity gate reachable
recovery email hook link shape valid
email queue worker healthy
reset page can reject invalid/no-session links correctly
telemetry rows appear for each branch
```

If any part fails, it should create a System Health/Triage item within minutes.

### 8. Hotfix rollout verification

After implementation:
- Run targeted unit/UI/edge tests.
- Deploy affected edge functions.
- Verify live recovery-email latest status, not raw pending counts.
- Verify reset branch telemetry appears for an invalid/no-session probe.
- Verify no active `password_reset` or polluted `login_attempt` lockouts remain.
- Publish immediately after the checks pass.

## Files likely touched

- `src/pages/ResetPasswordPage.tsx`
- `src/services/auth.service.ts`
- `src/test/ui/ResetPasswordPage.test.tsx`
- `src/test/services/auth.service.test.ts`
- `supabase/functions/auth-email-hook/index.ts`
- New public safe telemetry edge function for reset diagnostics
- Email health SQL/view/RPC and BDD scenarios

## Success criteria

- The password update form is impossible to reach without a verified recovery session.
- “Password service unavailable” only appears for real network/5xx auth-service failures.
- Missing/expired recovery sessions show the reset-link recovery path.
- Logs show the exact reset branch even when auth is missing.
- Email health can no longer be misread from stale append-only `pending` rows.
- Regression tests cover the exact failure chain.

<presentation-actions>
  <presentation-open-history>View History</presentation-open-history>
</presentation-actions>

<presentation-actions>
<presentation-link url="https://docs.lovable.dev/tips-tricks/troubleshooting">Troubleshooting docs</presentation-link>
</presentation-actions>