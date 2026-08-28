# PLAUSIBLE findings — verify-or-dismiss triage (Phase 0e)

The 2026-08 audit marked **85** of its 837 findings **PLAUSIBLE** (adversarially re-checked but
not fully confirmed). Before spending fix effort on them, each was verified against the **current
`main`** code by a read-only reviewer using one decisive test:

> **Could you write an automated test that FAILS on the current code because of this defect?**
> **Yes → REAL** (keep for fixing). **No → FALSE_POSITIVE** (dismiss with a code-grounded rationale).
> Genuinely uncertain after reading the code → **UNCERTAIN-REAL**, kept for fixing.

This is the "resolve = fixed **or** dismissed-with-rationale" contract from the hardening plan,
applied to the 85 so credits go only to real bugs.

## Result

| Verdict                              | Count |
| ------------------------------------ | ----- |
| **REAL** (confirmed defect)          | 54    |
| **UNCERTAIN-REAL** (kept for fixing) | 8     |
| **FALSE_POSITIVE** (dismissed)       | 23    |
| **Total**                            | 85    |

**→ 62 kept for the fix backlog · 23 dismissed.** Net confirmed real across the whole audit:
752 (already CONFIRMED) + 62 = **814 to fix**, 23 dismissed. One kept item (**P38**) is already
resolved by the redaction PR (#303) — see note below.

Dominant dismissal patterns (what the audit couldn't see without reading the server/caller):

- **"Client-only gate / permissive RLS"** security findings (P02, P05, P08) — the RLS policies are
  actually admin-/owner-scoped server-side (`has_role(...,'admin')`, `auth.uid()=user_id`,
  `is_class_learner()`), so the missing in-component check is defense-in-depth, not a hole.
- **"Not idempotent / no dedup"** (P16, P21, P71) — the edge fn / RPC already enforces it
  (`onConflict`, `UNIQUE` + return-existing, `FOR UPDATE SKIP LOCKED`).
- **"Unindexed / unsafe"** (P75, P23, P09) — covering indexes already exist; DB constraints
  neutralize the sink.

---

## Dismissed — FALSE_POSITIVE (23) · resolved with rationale, no fix

| id  | sev | rationale (grounded in the code read)                                                                                                                                                            |
| --- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P02 | Med | profiles SELECT is `auth.uid()=user_id` + admin; applications admin SELECT via `has_role(...,'admin')` — non-admin reads denied server-side. Missing in-component gate is defense-in-depth only. |
| P05 | Med | `class_module_sections`/`items` RLS = `status='published' AND is_class_learner(...)`; client `canSeeCurriculum` is display-only.                                                                 |
| P08 | Med | `audit_log` / `agent_fix_queue` SELECT are admin-only; profiles user-scoped+admin — non-admin replay returns 0 rows.                                                                             |
| P09 | Low | `agent_fix_queue.status` is a CHECK-constrained enum; interpolated value can only be that enum → nothing injectable reaches innerHTML.                                                           |
| P10 | Low | `projectIds` and `statusMap` both derive from the same `myApps`; the `?? "active_participant"` fallback branch is unreachable.                                                                   |
| P16 | Med | Edge upsert uses `onConflict:"url"` with a slug-derived url → re-upload updates in place, no duplicate row.                                                                                      |
| P21 | Med | Migration has `application_id UNIQUE` and the RPC re-checks + returns the existing row on conflict — idempotency already enforced.                                                               |
| P22 | Med | React-Query `invalidateQueries` is prefix-matching; the invalidation key matches the reader's `[key, id]`; roster key has no reader.                                                             |
| P23 | Low | `created_at`/`signed_at` are `NOT NULL` DB-serialized ISO timestamps → can't produce Invalid Date.                                                                                               |
| P24 | Med | Callers pass a stable `useState` setter as `onTokenChange`, so identity never changes and the effect never remounts.                                                                             |
| P28 | Low | `NoSsr` re-export is a harmless no-op in a CSR-only Vite SPA.                                                                                                                                    |
| P34 | Med | `ugc_translations` has a 5-column UNIQUE that the query filters by `eq` → at most one row; `maybeSingle` can't match multiple.                                                                   |
| P38 | Med | `account-activity.ts` already wraps `errorMessage` in `redactText(...)` — the "no redaction" premise is false. **Fixed by #303.**                                                                |
| P44 | Med | 40001/40P01 are genuinely retryable; routing `isTransientError` → `infra_transient` is by-design classification, not a defect.                                                                   |
| P48 | Med | `escapeValue:false` is standard react-i18next; no `t()→dangerouslySetInnerHTML` sink exists — latent, not exploitable.                                                                           |
| P52 | Low | handbooks/workshops query small curated tables correctly; absent `.limit` is pure scalability speculation.                                                                                       |
| P59 | Low | `discord_username` (narrow charset, service-role write) is React-escaped on render — no live XSS, hardening only.                                                                                |
| P64 | Low | Gumroad ping secret is already env-driven/rotatable; URL-param placement is Gumroad-mandated; fix is doc/log-scrubbing only.                                                                     |
| P69 | Med | `qa_failed` rows exist but member/public reads are RLS-restricted to `status IN ('qa_passed','approved')` and serving RPCs filter identically.                                                   |
| P71 | Med | The claim RPC atomically claims via `SELECT … FOR UPDATE SKIP LOCKED` + offset tracking; overlapping run gets NOT FOUND and skips.                                                               |
| P75 | Low | The exact composite indexes asked for already exist (`(user_id,created_at DESC)`, `(anon_id,created_at DESC)`).                                                                                  |
| P79 | Low | triage-error puts the user JWT in the Authorization header, so PostgREST runs as the user — RLS works; risk is latent/stylistic.                                                                 |
| P83 | Low | screen-sanctions regex permits `UA-43`; the "dead subdivision entries" are reachable via the real caller.                                                                                        |

---

## Kept — REAL / UNCERTAIN-REAL (62) · the refined fix backlog

_(UR = uncertain-real, kept for fixing. Feeds the phase burndown alongside the 752 CONFIRMED.)_

| id  | sev  | rationale (grounded in the code read)                                                                                                                                                 | failing-test idea                                             |
| --- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| P01 | Med  | DashboardPage skeleton branch has no `isError` path → infinite spinner when the overview RPC errors.                                                                                  | Mock overview RPC error; skeleton never clears                |
| P03 | Med  | ProjectFormPage update + autosave do full-row `update().eq("id")` with no version precondition → lost update.                                                                         | Two concurrent edits; second stale write clobbers first       |
| P04 | Low  | Project application submit sets `status="completed"` with no `project_status` re-check.                                                                                               | Submit to project not in `apply_now`; insert succeeds         |
| P06 | UR   | Reads cached EO mirror when local intent exists; external unsubscribe shows stale "Subscribed" until cron.                                                                            | mirror=subscribed, EO=unsubscribed → UI shows Subscribed      |
| P07 | Med  | ActivityLog pagination uses a planner **estimate** for total → real rows unreachable / empty pages.                                                                                   | estimate < actual; last page unreachable                      |
| P11 | UR   | `navigate(link_url)` with no scheme/allowlist; external URL breaks under react-router.                                                                                                | navigate("https://x") treated as in-app path                  |
| P12 | High | Two consent owners (first-party store + CookieYes) while analytics self-injects GA4/Clarity — dual ownership of the consent fact.                                                     | store analytics=true vs CookieYes rejected → divergence       |
| P13 | Med  | Empty CookieYes banner-load detail → all-false with `decidedAt=now()` POSTed to record-consent before any click.                                                                      | banner_load empty detail; asserts decidedAt/record fired      |
| P14 | Med  | stream-chat re-buffers a malformed `data:` frame every read; later lines never parse; flush drops it → silent truncation.                                                             | malformed frame mid-stream; later deltas dropped              |
| P15 | Low  | `chat_conversations.updated_at` client-written unchecked (should be a DB trigger) → stale ordering.                                                                                   | client updated_at write fails silently → stale order          |
| P17 | Low  | Translation coverage fetched with global `.order().limit(100)` then client-deduped → a locale's latest snapshot can fall outside the window.                                          | >100 audits; oldest locale drops from coverage                |
| P18 | Med  | Email "auth" lane Pause fires immediately with **no confirm dialog**.                                                                                                                 | Click Pause on auth lane; mutation fires, no confirm          |
| P19 | UR   | Certification tabs omit `.eq("user_id")`; RLS scopes today, so DoD-only — elevated by TFN's hand-applied-migration RLS-drift risk.                                                    | disable RLS in test DB; cross-user rows leak                  |
| P20 | Med  | Raw `.delete().eq("id")` with no dependency check; confirm copy hides FK cascade/error.                                                                                               | delete client with child projects; error/cascade surfaced     |
| P25 | Low  | Blast composer counts raw completed rows; edge fn dedupes by distinct user_id + requires email → displayed count overstates recipients.                                               | completed applicant w/o email; count ≠ emails sent            |
| P26 | Low  | Avatar fallback path has no accessible name (empty alt, bare-fragment fallback, no aria).                                                                                             | render fallback avatar; no accessible name                    |
| P27 | Med  | Input/Textarea spread `{...props}` onto the OutlinedInput **root**, not `inputProps` → aria-describedby/invalid land on the wrapper, not the `<input>`.                               | query `<input>`; missing aria-describedby                     |
| P29 | High | DS `primary.main` vs Tailwind `text-primary-text` differ on dark → links render different colors.                                                                                     | assert MuiLink dark color == --primary-text                   |
| P30 | Med  | `warning.contrastText` white on `warning.main` ≈ 2.1:1, below AA 4.5:1.                                                                                                               | contrast test over every {main,contrastText} pair             |
| P31 | Low  | Hero hover hardcodes `#4d8cff`; label stays dark → contrast ≈3.9:1, below AA.                                                                                                         | contrast(#333,#4d8cff) ≥ 4.5 fails                            |
| P32 | Med  | Membership realtime first UPDATE before profile seeds refs → toast+refreshProfile dropped.                                                                                            | UPDATE with refs null; refreshProfile not called              |
| P33 | Med  | admin-role/teacher-role hooks cache 2m with no invalidation anywhere ("auth state change → invalidation" is unwired).                                                                 | demote admin; hook still returns isAdmin=true                 |
| P35 | High | MFA `factorCache` module-global invalidated only on enroll/unenroll/verify; SIGNED_OUT never clears it → user B reads A's factors within 60s TTL.                                     | sign out A, sign in B <60s; listFactors returns A's           |
| P36 | Med  | explore.service "popular" tally has no user filter but RLS scopes to own rows → popularity computed per-user, silently.                                                               | two users' rows; A's popular counts only A                    |
| P37 | Med  | `write_audit_log` inserts client-supplied `p_user_id` verbatim (SECURITY DEFINER) → forge rows attributed to any user.                                                                | call with foreign p_user_id; row written under it             |
| P39 | High | Passive CookieYes reconcile stamps `decidedAt = prev ?? now()` → persists a fabricated consent decision timestamp.                                                                    | passive reconcile w/ decidedAt=null → now() recorded          |
| P40 | Med  | reset-telemetry `sendBeacon` sends no apikey/Authorization (only the fallback fetch does); beacon returns true, hiding a 401.                                                         | assert beacon body carries apikey (it doesn't)                |
| P41 | UR   | bad_jwt first strike stored per-tab in sessionStorage; single-request tab never reaches second strike after rotation.                                                                 | two tabs one bad_jwt each; neither purges                     |
| P42 | Med  | feedback RLS checks only `auth.uid()=user_id`; `turn_id` FK requires existence not ownership → upsert any turn_id → learning-loop poisoning.                                          | rate another user's turn_id; upsert succeeds                  |
| P43 | Low  | stream-chat breaks on done with no final `decoder.decode()` flush → trailing multibyte/partial line lost.                                                                             | stream ends mid-multibyte; final char dropped                 |
| P45 | Low  | Signup peek has no `.catch` → throw hits generic catch → punitive lockout; sign-in peek fails OPEN. Asymmetric.                                                                       | mock signup peek throw; lockout applied                       |
| P46 | UR   | `is_session_revoked` RPC fires every getSession, no cache/TTL — hot-path round-trip (revocation-on-read may be intentional).                                                          | two getSession within TTL invoke it twice                     |
| P47 | Med  | fetchProgress does `.eq("class_id")` with **no user_id filter** while hook caches per-user → cross-user rows in completedSet.                                                         | 2 learners; non-owner rows leak into completedSet             |
| P49 | Med  | invokeEdge throws-for-retry on `status===undefined`; withTransientRetry matches "Failed to fetch"/"FunctionsFetchError" → CORS/broken-deploy retried 3×.                              | mock invoke reject "Failed to fetch"; 3 attempts              |
| P50 | Low  | fetchProfile has no in-flight guard/request-id; slow bootstrap resolving late clobbers fresh with stale.                                                                              | 2 concurrent fetches, earlier resolves last → stale           |
| P51 | Low  | TOKEN_REFRESHED branch calls `setSession` only, not setUser/ref → session/user diverge.                                                                                               | emit TOKEN_REFRESHED; user/ref not updated                    |
| P53 | Med  | Auth prober sign-out stage uses the anon key + empty body; broker returns `{ok:true}` without real revocation → asserts nothing.                                                      | sign in, revoke w/ real token, follow-up call fails           |
| P54 | Med  | auth-email-hook validates origin only for `recovery`; signup/magiclink/invite/email_change use `redirect_to` verbatim, no allow-list.                                                 | buildConfirmationUrl('signup',…,'evil.com') keeps evil origin |
| P55 | High | refresh-email-health writes `email_send_state.bulk_paused`; v2 claim filters `email_lane_state.paused_by_admin` (different table) → pause never takes effect.                         | set bulk_paused=true; dispatchDue still sends                 |
| P56 | Low  | Email offender-lane = lastSentLane on 429; a later lane's first-send 429 writes a cooldown on the **auth** lane.                                                                      | auth fills quota, transactional 429 → auth cooldown           |
| P57 | High | send-announcement recipient query has **no `.range/.limit`**; ~1200 members vs PostgREST 1000-row cap → silent truncation.                                                            | seed >1000 opted-in; send truncates to ~1000                  |
| P58 | Med  | discordUserId only from `interaction.member.user.id`; `if (discordUserId && …)` short-circuits false when undefined → rate-limiter skipped.                                           | interaction with `interaction.user` only; limiter skipped     |
| P60 | UR   | sync-airtable is best-effort client PATCH with no server reconciliation/drift job → ownership drift.                                                                                  | mutate row; Airtable never reconciles                         |
| P61 | Med  | Gumroad resolution is email-only `ilike`; no unique link survives an email change → membership demoted.                                                                               | buy under emailA, change email → demoted to starter           |
| P62 | Med  | Gumroad backfill is serial N+1 with no page checkpoint under the 60s cron cap.                                                                                                        | 500 sales → no reproject on mid-loop timeout                  |
| P63 | Low  | Lifecycle patch falls back to `.eq("subscription_id")` for refund/dispute → stamps every charge row.                                                                                  | refund event w/ sub_id → all 3 rows get refunded_at           |
| P65 | Med  | `findCustomerByEmail` returns `list[0]` with no check that `emails[].value === email` before persisting freescout_customer_id.                                                        | Freescout returns non-matching customer → persisted           |
| P66 | Low  | profiles.email has no UNIQUE; `.eq('email').maybeSingle()` throws on duplicates → event DLQ'd.                                                                                        | two profiles same email → processOne throws, DLQ              |
| P67 | Low  | fleety-embed Mode A runs `embedText` before any admin/quota/rate-limit gate; only needs a member JWT → unmetered Gemini.                                                              | non-admin JWT posts {text} repeatedly; unmetered              |
| P68 | Med  | Upserts chunk at 200 but merge-lookup + re-select pass the full slug array → oversized GET URL at scale.                                                                              | ingest ~5k slugs → URL-length error                           |
| P70 | Low  | `raw_data: fields` stores the full Airtable record (email included) with no allow-list — over-collection (borderline).                                                                | assert raw_data keys ⊆ allow-list                             |
| P72 | UR   | project_applications has both `status` and `applicant_status` written by different subsystems → stale-cohort blast risk (distinct facts, ownership smell).                            | withdrawn applicant still receives blast                      |
| P73 | High | screen-sanctions only records+returns a decision; enforcement is client-side with fail-open catch; no server-side signup re-screen.                                                   | direct signup for embargoed country bypasses client           |
| P74 | Med  | dsar-submit claims it notifies but sends no email ("no email queue exists") → statutory SLA has no alert.                                                                             | DSAR submit enqueues a notification → none sent               |
| P76 | Med  | translate-strings batches all missing strings into ONE user message; output cached per-string with no status gate → co-batched injection steers a benign string's cached translation. | injection item alters cached translation of co-batched string |
| P77 | Low  | translate-bundle cache-read→LLM→upsert has no lock/dedup; N concurrent cold requests fan out N full LLM calls.                                                                        | N concurrent cold hits → N gateway calls                      |
| P78 | UR   | Probe folds every non-404 into "alive"; a boot-broken (5xx) function reads alive (partly by-design; genuine coverage gap).                                                            | classifyProbe(503,false) returns "alive"                      |
| P80 | Low  | client-ip returns null when all IP headers absent → all header-less traffic shares one rate-limit bucket ("unknown").                                                                 | two header-less requests share "unknown", throttled           |
| P81 | Med  | Audit hash-chain trigger reads latest row_hash with a plain SELECT (no advisory lock) → concurrent inserts fork the chain; verify reports BROKEN.                                     | two concurrent audit inserts → verify_audit_chain broken      |
| P82 | Med  | Migration does ALTER TYPE + full `profiles` rewrite (ACCESS EXCLUSIVE) with no explicit txn, hand-applied on prod.                                                                    | (operational) interrupt mid-rewrite leaves default missing    |
| P84 | Med  | Sitemap emits `/project-openings/${slug}`; detail page forwards it as `?projectId=`; edge requires a UUID → text slug 400s (wrong table too).                                         | sitemap slug URL round-trips to 400/404                       |
| P85 | Low  | Sitemap fetch of published openings has no limit/range → PostgREST max-rows caps silently, dropping rows with a green build.                                                          | >1000 openings → sitemap omits rows past cap                  |

---

## How this feeds the phases

- The **62 kept** join the CONFIRMED backlog and are fixed in their category's phase (security → Phase 2/OWASP; ownership → Phase 3; error-handling → Phase 1/5; a11y/contrast → Phase 6). Several **High** items surfaced here (P12, P29, P35, P39, P55, P57, P73) — route them with the other Highs.
- The **23 dismissed** are resolved: no fix, rationale on record. If a dismissal is also gate-relevant it becomes a permanent waiver with `reason`.
- **P38** is already fixed (#303) — mark resolved.
- A few dismissals are _defense-in-depth_ worth a **belt-and-suspenders** note but not a bug (P02/P08/P19 lean on RLS that TFN hand-applies — see the migration-applied gate, ADR-0020, which now guards exactly that drift).

_Method: 6 read-only reviewers verified the 85 against current `main` (each finding's cited code read directly), 2026-08-28. Verdicts are code-grounded; see the per-finding rationale above._
