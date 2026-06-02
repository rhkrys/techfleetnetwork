## Root cause

Two distinct production bugs collapse onto the same `freescout-proxy reply invoke_error` line in triage, plus one missing notification leg the user explicitly called out.

### Bug A — `Assign me` sends a non-existent Freescout user id
`src/pages/community/AdminAllTicketsGrid.tsx:87` hard-codes `assigneeUserId: 0`. The proxy's `assign` action forwards `assignTo: 0` to Freescout, which 422s ("user does not exist"). Self-assignment has never worked from the admin grid.

### Bug B — Admin reply omits the required `user` field
`supabase/functions/freescout-proxy/index.ts:288-306` (case `reply`) submits `{ type: "message", text }` when the actor is an admin. Freescout requires a `user` field (the admin's Freescout user id) for `type: "message"` threads — it rejects with 422 `validation_failed: user`. Our wrapper catches the error and the frontend renders it as `invoke_error` with no actionable signal in triage.

Both depend on the same missing piece: **the admin's `profiles.freescout_user_id` is provisioned by `freescout-provision-admin` but never read at action time.** When `assigneeUserId === 0` (or unset), the proxy should resolve "self" by looking up `profiles.freescout_user_id` for the calling admin and refuse the call (with an actionable error) if it isn't provisioned. Same lookup feeds the reply path.

### Bug C — Member never receives email when an admin replies
`process-freescout-events` creates an in-app notification (line 80-90) but does NOT send a transactional email. The previous assumption ("Freescout sends the customer email automatically") is fragile — it depends on per-mailbox settings outside our control and produces unbranded mail. The user explicitly wants email + in-app every time an admin replies.

### Bug D — Upstream 4xx detail is invisible in triage
The proxy logs `level:error code:upstream_error msg body` to edge logs, but the `agent_fix_queue` row only carries `invoke_error` from the client wrapper. Future Freescout schema mismatches will recur opaquely. We must propagate the upstream error body into `audit_log.extraFields` so triage shows the real reason.

## Permanent fix

### 1. Provision-aware self-assign + admin user resolution
- **New helper** in `supabase/functions/_shared/freescout-admin.ts`:
  - `resolveAdminFreescoutUserId(userId)` → reads `profiles.freescout_user_id`; if null, calls `freescout-provision-admin` synchronously (it already exists, is idempotent, and returns the id). Throws `FreescoutError(412, "Admin not provisioned in Get Help. Try again in a moment.")` on persistent failure.
- **`freescout-proxy` `assign` action**: extend the Zod schema so `assigneeUserId` accepts the literal string `"self"` OR a positive integer. When `"self"`, resolve via the helper. Reject `0` outright with 400.
- **`freescout-proxy` `reply` action** (admin branch): call the helper, pass the returned id as `user` in the body to Freescout. Keep the customer branch unchanged.
- **`AdminAllTicketsGrid.tsx`**: change `assigneeUserId: 0` → `assigneeUserId: "self"`. Localize the toast on 412 to "Setting up your helpdesk account. Try again in a few seconds." and auto-retry once after 2s.

### 2. Surface upstream errors to triage
- In the proxy `catch` for `FreescoutError`, return JSON `{ error, upstream_code, upstream_body_excerpt }` (already partly done) AND emit a `console.error` line that `withAuditWrapper` mirrors into `audit_log.extra_fields`.
- In `src/lib/support/freescoutInvoke.ts`, when `result.error` includes a parsed body with `upstream_code`, append it as an extra audit field so triage shows `upstream:422 validation_failed: user`. No severity change — still `warn` per HELP-DESK-024.

### 3. Member email on admin reply (in addition to in-app)
- **`process-freescout-events`** — when `eventType` matches `convo.{thread.created,user.replied,customer.replied}` AND the new thread's `createdBy.type === "user"` (admin), AND a `customer_user_id` resolved:
  1. Insert the existing in-app `notifications` row (unchanged).
  2. Invoke `send-transactional-email` with template `support_ticket_reply` (new), payload `{ to: customer.email, subject: "Re: <ticket subject>", ticket_url: APP_URL + "/community/get-help?ticket=" + conversationId, preview: first 280 chars of plain-text thread body, replier_name }`. Idempotency key = `support-reply-${conversationId}-${threadId}`.
- **New React Email template** `supabase/functions/send-transactional-email/templates/support-ticket-reply.tsx` — reuses the existing branded shell (Tech Fleet logo, footer with deep-link to notification prefs per the Footer Deep Links rule), brand voice ("Hi <first name>, your support ticket got a new reply…"). Register in the TEMPLATES map.
- The transactional path already respects the 3-lane queue, suppression list, and React Email rendering — no infra changes needed.
- Frequency cap is not applied (per memory: transactional support replies are not bulk).

### 4. Defense-in-depth
- Add Zod refinement: `assigneeUserId` cannot be `0`.
- Add a smoke test `src/test/smoke/freescout-admin-actions.smoke.test.ts` that mocks `invokeFreescout` and asserts `AdminAllTicketsGrid`'s Assign-me button sends `"self"`.

### 5. Resolve the existing queue row
- Mark `agent_fix_queue.id='05576857-8ae8-410b-babf-c0a46a00919d'` as `status='resolved'` with `resolution_notes='Bug A+B+C fix: admin reply now passes user id, Assign me passes "self", member receives in-app + email; HELP-DESK-025/026/027/028.'`.

## BDD scenarios (insert into `bdd_scenarios`)

Each scenario carries the mandatory `[UI]` + `[DB]` + `[Code]` Then-clauses.

### HELP-DESK-025 — Admin self-assigns an unassigned ticket
- **Given** an admin views Get Help → Admin tickets → Open · unassigned tab AND their `profiles.freescout_user_id` is provisioned.
- **When** they click "Assign me" on row `T`.
- **Then [UI]** a success toast "Assigned to you." appears within 1s; the row moves to Open · assigned on next refetch.
- **And [DB]** `support_ticket_pointers.assignee_user_id` for `T.conversation_id` equals the admin's Freescout user id (string).
- **And [Code]** `freescout-proxy` receives `{action:"assign", assigneeUserId:"self"}`, resolves it to the admin's `freescout_user_id`, and forwards `PUT /api/conversations/{id} { assignTo: <int> }` returning 200.

### HELP-DESK-026 — Admin self-assigns while not yet provisioned
- **Given** an admin whose `profiles.freescout_user_id` is null clicks "Assign me".
- **Then [UI]** toast "Setting up your helpdesk account. Try again in a few seconds." appears and the action auto-retries once after 2s; on the second attempt the assignment succeeds.
- **And [DB]** after the retry, `profiles.freescout_user_id` is populated.
- **And [Code]** `resolveAdminFreescoutUserId` invoked `freescout-provision-admin` exactly once; second attempt reads the cached id without calling provision.

### HELP-DESK-027 — Admin replies to an open ticket
- **Given** the admin opens ticket `T` (they may or may not be the assignee) and types "Thanks, looking into this."
- **When** they click "Send reply".
- **Then [UI]** the reply textarea clears; toast "Reply sent." appears; the new thread appears in the conversation pane on next refetch.
- **And [DB]** `support_ticket_events` gains a row `event_type='user.replied'`, `actor_kind='user'`, `conversation_id=T`. `support_ticket_pointers.last_synced_at` advances.
- **And [Code]** `freescout-proxy` POSTs `/api/conversations/{T}/threads` with `{type:"message", text, user:<admin freescout_user_id>}` returning 201.

### HELP-DESK-028 — Member receives in-app + email when admin replies
- **Given** member `M` created ticket `T` and has `profiles.email = m@example.com`, notification prefs allow support emails.
- **When** an admin replies (HELP-DESK-027 completes) and `process-freescout-events` drains the resulting `user.replied` payload.
- **Then [UI]** within 30s `M` sees a header notification "New reply on your ticket – Re: <subject>" linking to `/community/get-help?ticket=T`; opening Get Help auto-selects the ticket and shows the new thread.
- **And [DB]** one `notifications` row exists with `user_id=M`, `category='support'`, `link='/community/get-help?ticket=T'`. One `email_send_log` row exists with `template_name='support_ticket_reply'`, `to_email='m@example.com'`, `status` progressing `pending`→`sent`, idempotency key `support-reply-T-<threadId>`.
- **And [Code]** processOne invoked `send-transactional-email` exactly once; a second drain of the same `event_id` does NOT enqueue a duplicate email (pgmq event dedupe + email idempotency key both hold).

### HELP-DESK-029 — Customer replies to their own ticket (regression)
- **Given** member `M` is signed in and has ticket `T` open.
- **When** `M` types a reply and clicks "Send reply".
- **Then [UI]** toast "Reply sent." appears; new thread appears in `M`'s view.
- **And [DB]** `support_ticket_events.event_type='customer.replied'`; no `email_send_log` row for `support_ticket_reply` is created (we only email the customer when an admin replies, not when the customer themselves does).
- **And [Code]** `freescout-proxy` POSTs `{type:"customer", text, customer:{email:M.email}}` — no `user` field.

### HELP-DESK-030 — Upstream Freescout error is actionable in triage
- **Given** Freescout returns 422 `{ error: "validation_failed: user" }` to an admin reply (simulated by stripping the freescout_user_id).
- **Then [UI]** the admin sees toast "Could not send your reply." (existing copy).
- **And [DB]** `agent_fix_queue` gains/updates a row with `event_type='edge_invoke_failed'`, `severity='warn'`, and `extra_fields` containing `upstream:422` and `upstream_code:validation_failed:user`.
- **And [Code]** the audit row preserves the trace id from the client wrapper so admins can correlate to the proxy edge log line.

### HELP-DESK-031 — Reply forbidden when not owner and not admin (security regression)
- **Given** member `B` is signed in and tries to POST `freescout-proxy {action:"reply", conversationId:T_of_A}` directly.
- **Then [Code]** proxy returns 403 `Forbidden`.
- **And [DB]** no `support_ticket_events` row is inserted; no email queued.
- **And [UI]** N/A (no UI path triggers this; covered by API contract test).

### HELP-DESK-032 — Cache invalidation after admin reply / assign
- **When** any of `reply | assign | close | reopen | setPrivate` succeeds.
- **Then [UI]** the AG Grid for Open · unassigned, Open · assigned, and the member's listMine all reflect the change on next focus (no manual refresh).
- **And [Code]** the proxy called `invalidateAll()` (admin views) and, for member-initiated mutations, `invalidateUser(auth.userId)`. React Query keys `["support","admin-all",*]` and `["support","mine",*]` are invalidated by the success path.

## Out of scope

- Replacing AG Grid actions column with a `<DropdownMenu>` — pure UX polish; ship separately if requested.
- Multi-mailbox routing — only `DEFAULT_MAILBOX_ID` is configured per the Get Help Secret Contract.
- Customer-side typing indicators / read receipts.

## Files touched

```text
src/pages/community/AdminAllTicketsGrid.tsx           (Assign me payload + retry-on-412)
src/lib/support/freescoutInvoke.ts                    (propagate upstream_code into audit extras)
supabase/functions/_shared/freescout-admin.ts         (NEW: resolveAdminFreescoutUserId)
supabase/functions/freescout-proxy/index.ts           (Zod refine, reply.user, assign self)
supabase/functions/process-freescout-events/index.ts  (queue support_ticket_reply email)
supabase/functions/send-transactional-email/templates/support-ticket-reply.tsx  (NEW)
supabase/functions/send-transactional-email/index.ts  (register template in TEMPLATES)
src/test/smoke/freescout-admin-actions.smoke.test.ts  (NEW)
bdd_scenarios                                          (HELP-DESK-025..032)
agent_fix_queue                                        (resolve existing row)
mem://features/get-help-scale-contract                 (note new admin user resolution + reply email)
```

## Verification

1. Deploy `freescout-proxy`, `process-freescout-events`, `send-transactional-email`.
2. As admin, click "Assign me" → toast success; check `support_ticket_pointers.assignee_user_id` populated.
3. As admin, send a reply → check Freescout UI shows the message thread and the member receives both the in-app notification and the branded email (verify via `email_send_log` row).
4. Re-run `bunx vitest run src/test/smoke/freescout-admin-actions.smoke.test.ts`.
5. Confirm `agent_fix_queue` shows no new `freescout-proxy reply invoke_error` rows over 24h.
