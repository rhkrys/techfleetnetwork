# Fix ticket creation for morgandenner1@gmail.com (and everyone else)

## Root cause

`supabase/functions/freescout-proxy/index.ts` looks up the caller's profile with `.eq("id", userId)` in 4 places (lines 77, 108, 132, 209, 220). But `userId` is `auth.uid()`, and on `public.profiles` the auth uid lives in the `user_id` column — `id` is the row PK. I verified: across all 628 profile rows, `id` never equals `user_id`.

So for **every** member without a pre-existing `freescout_customer_id`, the proxy:
1. Fails to find their profile row (`prof = null`)
2. Falls through to auth-admin email lookup, creates a Freescout customer
3. Skips writing `freescout_customer_id` back to the profile (`if (prof)` guard is false)
4. Returns 500/400 or creates an orphan customer on subsequent calls

Morgan (`profile.id=9ed919…`, `user_id=cd9cad…`, `freescout_customer_id=NULL`) hits this every time she tries to open a ticket.

## Fix (single file: `supabase/functions/freescout-proxy/index.ts`)

Change all 4 profile lookups + the update to key on `user_id`:

```text
L77   .eq("id", userId)       → .eq("user_id", userId)
L108  .eq("id", userId)       → .eq("user_id", userId)
L132  .eq("id", userId)       → .eq("user_id", userId)
L209  .eq("id", auth.userId)  → .eq("user_id", auth.userId)
L220  .eq("id", auth.userId)  → .eq("user_id", auth.userId)
```

Also normalize the `support_provisioning_log` insert in `ensureCustomerForUser` (L110) to use `prof.id` (profile PK) when present, matching the convention used by the DB trigger and `support-provisioning-retry` (which both key the log on `profiles.id`, not auth uid).

## One-shot backfill for Morgan

After deploying the fix, the next time she opens Get Help her customer record will auto-provision. No DB migration required for her specifically — the fix alone unblocks her.

## Out of scope (noted, not fixed here)

- 653 rows in `support_provisioning_log` are stuck `status='retry'` (backfill queued 2026-06-03, plus 25 "Bad Request" failures). The retry worker keys correctly on `profiles.id`, so it's a separate issue — likely Freescout API throttling or a payload bug. Worth a follow-up task, but not blocking morgan's ticket.
- The same `.eq("id", userId)` pattern exists in other edge functions (`freescout-provision-customer`, `freescout-provision-admin`, `support-provisioning-retry`, `_shared/freescout-admin.ts`, `process-freescout-events`). Those functions are called with `profiles.id` (not auth uid) from the trigger/retry paths, so they happen to be consistent. Leaving them as-is to avoid breaking the retry pipeline.

## Verification

1. Redeploy `freescout-proxy`.
2. Impersonation test via SQL: confirm `select * from profiles where user_id = 'cd9cad81-…'` returns the row (already verified).
3. Ask user to retry Get Help → new ticket should create and `freescout_customer_id` should populate on her profile.
