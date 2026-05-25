# Fix the class review flow end-to-end

## Root cause of the error you're seeing

The four class-workflow database functions (`submit_class_for_review`, `approve_and_publish_class`, `request_class_changes`, `archive_class`) were created as SECURITY DEFINER but **EXECUTE was never granted to `authenticated`** — only `postgres` and `service_role` can call them. The browser calls them with a regular signed-in user token, so PostgREST returns:

> 42501: permission denied for function submit_class_for_review

That's why submitting a drafted class errors every time. Approve/Deny/Archive would fail the same way for the same reason. None of the notification or email code ever runs because the RPC is rejected before it executes.

On top of that, two things are missing from the existing flow:
- The in-app notification trigger only covers some transitions: it notifies admins on submit, the teacher on approve / changes-requested / archive — but it does NOT notify the teacher on submit (a confirmation), and does NOT notify admins on approve/deny (visibility for the other admins).
- There is no email path at all — admins and teachers only get in-app notifications today.

## Phase 1 — Unbrick the workflow (the actual fix for the error)

Migration that grants EXECUTE on the four RPCs to `authenticated`:

- `submit_class_for_review(uuid, uuid[])`
- `approve_and_publish_class(uuid)`
- `request_class_changes(uuid, text)`
- `archive_class(uuid, text)`

These functions already enforce their own access checks (owner-or-admin for submit, admin-only for approve/changes/archive), so granting EXECUTE to `authenticated` is safe — the inner checks gate who can actually mutate state.

After this single migration, "submit for review" works, admins see the class in the Submitted Courses queue (that page already exists and reads from `classes` with `status = 'pending_review'` via the admin SELECT policy), and the existing in-app notification trigger starts firing again.

## Phase 2 — Complete the in-app notification trigger

Update `trg_notify_class_status_change` so every action notifies both sides:

| Transition | Existing | Add |
|---|---|---|
| draft → pending_review | notifies all admins | also notify the teacher ("Your class is being reviewed") |
| pending_review → published | notifies the teacher | also notify all admins ("`<Admin>` approved `<title>`") |
| pending_review → draft (changes requested) | notifies the teacher | also notify all admins ("`<Admin>` requested changes on `<title>`") |
| * → archived | notifies the teacher | also notify all admins |

Also: replace the silent `EXCEPTION WHEN OTHERS THEN RETURN NEW` with `RAISE LOG` + `RETURN NEW` so we keep the transition resilient (notifications never block status changes) but failures show up in Postgres logs and the System Health Triage tab instead of vanishing.

## Phase 3 — Wire up emails to both admin and teacher

Use Lovable's built-in transactional email infrastructure (already set up — `send-transactional-email` exists). Two pieces:

1. **One new template**: `supabase/functions/_shared/transactional-email-templates/class-status-change.tsx`, registered in `registry.ts`. Accepts `templateData`:
   - `action`: `"submitted" | "approved" | "changes_requested" | "archived"`
   - `recipientName`, `recipientRole` (`"teacher" | "admin"`)
   - `classTitle`, `actorName`, `reason?`, `linkUrl`
   
   Subject and copy branch on `action` + `recipientRole` so the same template covers all six combinations (e.g. admin gets "New class submitted for review" while teacher gets "Your class is being reviewed").

2. **Two helper RPCs** so the client can resolve recipients without needing direct `auth.users` access:
   - `get_class_email_recipients(p_class_id uuid)` → returns `{ owner_user_id, owner_email, owner_name, class_title }`
   - `list_admin_email_recipients()` → returns rows of `{ user_id, email, full_name }`
   
   Both SECURITY DEFINER, EXECUTE granted to `authenticated`, internally gated to admins-or-class-owner.

3. **Client-side dispatch** in `src/services/class.service.ts`. After each of `submitForReview / approveAndPublish / requestChanges / archive` succeeds, call a new helper `sendClassStatusEmails(classId, action, reason?)` that:
   - Resolves owner + admin recipients via the RPCs above.
   - Fires `supabase.functions.invoke('send-transactional-email', …)` for each recipient with:
     - `templateName: 'class-status-change'`
     - One-recipient-per-invoke (no list looping into a single send — each is its own transactional send triggered by the same action)
     - `idempotencyKey: \`class-${action}-${classId}-${recipientUserId}\`` so retries are safe
     - `templateData` populated per recipient/role
   - Wrapped in try/catch so an email failure never breaks the UI flow (the in-app notification already covers that path; email is best-effort with the queue handling retries).

The send is invoked client-side because the action is always taken by a signed-in user (teacher or admin) and the queue handles delivery/retry/suppression. No new edge function is created — everything routes through the existing `send-transactional-email`.

## Files touched

- New migration: grants + trigger update + two recipient RPCs
- `supabase/functions/_shared/transactional-email-templates/class-status-change.tsx` (new)
- `supabase/functions/_shared/transactional-email-templates/registry.ts` (register new template)
- Redeploy `send-transactional-email`
- `src/services/class.service.ts` (call email helper after each of the four actions)
- New `src/services/class-emails.ts` (the `sendClassStatusEmails` helper + recipient resolution)

## Verification after shipping

1. Sign in as a teacher, submit a draft class → no error, toast says "Submitted for review".
2. The class appears in `/admin/classes` Submitted queue.
3. Teacher sees an in-app "Your class is being reviewed" notification.
4. All admins see an in-app "A teacher submitted …" notification.
5. Teacher receives a confirmation email; admins receive a review-request email (visible in `email_send_log` with `template_name = 'class-status-change'`).
6. Admin clicks Approve → teacher gets in-app + email; other admins get in-app + email. Same for Request changes (with reason) and Archive.
