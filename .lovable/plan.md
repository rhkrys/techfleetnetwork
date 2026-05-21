## Root cause

The numbers are actually internally consistent — but two real bugs make them look impossible.

### What the cards actually show today

| Card | Source | Past-7d value | What it really counts |
|---|---|---|---|
| Platform Signups | `profiles.created_at` | 107 | New non-test profiles ✓ |
| Core Course Completions | `course_completions` filtered by `course_catalog.tier='core'` | 49 | **Only `tier='core'` courses** — excludes onboarding, connect-discord, etc. |
| General Applications | `general_application_submissions` | 11 | ✓ |
| Badges Earned | `badges_awarded` (all sources, excl. `phase_completed:*`) | 166 | **All** completed-course badges + apps + discord-linked |

### The 166 breakdown over the last 7 days (verified against the DB)

```text
44  discord_linked          ← BUG: uses profiles.updated_at, not actual link time
31  course_completed:connect-discord
31  course_completed:onboarding
12  course_completed:agile-mindset
11  application_submitted
 9  course_completed:project-training
 8  course_completed:volunteer-teams
 8  course_completed:agile-teamwork
 7  course_completed:discord-learning
 5  course_completed:observer-course
---
166
```

Of those, only 49 course-completion badges are for `tier='core'` courses; the other 62 are for non-core courses (onboarding tier, discord). That gap of 62 is what makes the headline look wrong.

### Two real bugs to fix

1. **`discord_linked` badge uses `profiles.updated_at` as `awarded_at`.** Every avatar change, name edit, MFA setup, or notification-preference toggle bumps `profiles.updated_at`, which then re-stamps the badge timestamp on the next recompute. The audit log shows **zero** actual Discord-link events in the last 7 days, yet 44 of those badges count as "past-7d." Inflates badges by ~25–40% week over week.
2. **"Core Course Completions" label is misleading.** It silently drops onboarding-tier courses that *do* award badges. Members see 49 completions but 111 course-completion badges and assume the system is broken.

A third minor issue: the `past_7d` snapshot row's `computed_at` is ~6 minutes older than the `all_time` row (different cron cadence), so a transient ~1–8 unit drift can appear. Not the cause of the 49↔166 gap but worth normalizing.

---

## Plan

### 1. Fix `discord_linked` awarded_at to be immutable and accurate

- Add `discord_linked_at timestamptz` column to `profiles`, backfilled from `MIN(created_at)` on existing `badges_awarded` rows where `badge_code='discord_linked'`, falling back to `updated_at` only when no badge exists.
- Set a trigger on `profiles` that sets `discord_linked_at = now()` only on the **transition** from NULL/empty → non-empty `discord_user_id` (never on subsequent edits).
- Update the `recompute_all_stats()` backfill to use `discord_linked_at` instead of `updated_at` when inserting the `discord_linked` badge.
- Re-stamp existing badge rows: `UPDATE badges_awarded SET awarded_at = p.discord_linked_at WHERE badge_code='discord_linked'` so the past-7d window stops showing stale members.

Expected outcome: past-7d `discord_linked` count drops from 44 → ~0 this week (matches audit log), and 166 → ~122 immediately.

### 2. Relabel + add transparency to the Course Completions card

- Add a new metric `all_course_completions_total` to `network_stats_snapshots` for both `all_time` and `past_7d` scopes, populated by the same `recompute_all_stats()` function (no tier filter).
- Surface it in `get_network_stats()` as `course_completions_total` and `prev_week_course_completions_total`.
- In `NetworkActivity.tsx`:
  - Keep the headline number as the **total** (all tiers) so it reconciles with badges.
  - Change the label from "Core Course Completions" to **"Course Completions"**.
  - Add a sublabel `"X core · Y onboarding"` so the breakdown is visible at a glance.
  - Add an `<InfoTooltip>` on the Badges Earned card explaining: "One badge per course completion, application submission, and Discord link."

### 3. Normalize snapshot freshness

- Make the cron job that calls `recompute_all_stats()` write **all** scope rows in the same transaction (it already does, in a single `INSERT … ON CONFLICT`). Fix the cron entry so only one job writes snapshots (currently two different cron entries are stamping `all_time` vs `past_7d` at different times). Consolidate to a single 15-min job.

### 4. BDD scenarios → `bdd_scenarios` table

Add `STATS-RECON-001..006`, tri-layered [UI]/[DB]/[Code]:

- 001 Course Completions card sums core + onboarding tiers and matches `count(course_completions)` for past-7d
- 002 `discord_linked` badge `awarded_at` equals `profiles.discord_linked_at`, never `profiles.updated_at`
- 003 Trigger sets `discord_linked_at` only on NULL→value transition (not on re-saves)
- 004 Badges Earned past-7d = course completions (all tiers) + applications + discord links — exact equality
- 005 `all_time` and `past_7d` snapshot rows share the same `computed_at` (single-transaction write)
- 006 InfoTooltip on Badges card lists exactly the three contributing sources

### 5. Smoke test

Extend `src/test/smoke/badge-parity.smoke.test.ts` with a "stats arithmetic reconciliation" assertion: `badges_earned == course_completions_total + applications_completed + discord_links_count` for both `all_time` and `past_7d`.

---

## Technical details

**Files touched**

- `supabase/migrations/<new>` — add `profiles.discord_linked_at`, backfill trigger, replace `recompute_all_stats()` body, add `all_course_completions_total` metric, restamp existing badges, consolidate cron entry, insert 6 BDD scenarios
- `src/services/stats.service.ts` — add `course_completions_total`, `prev_week_course_completions_total`, `core_course_completions`, `onboarding_course_completions` fields to `NetworkStats`, bump cache key to `v5`
- `src/components/NetworkActivity.tsx` — relabel card, add sublabel breakdown, add InfoTooltip on Badges Earned, render new fields
- `src/integrations/supabase/types.ts` — auto-regenerated
- `src/test/smoke/badge-parity.smoke.test.ts` — new reconciliation assertion
- `src/test/ui/NetworkActivity.test.tsx` — update label + sublabel expectations

**No edge-function redeploy needed** — all logic lives in the SQL recompute function and the React component.

**Backward compatibility**

- Cache key bumped from `v4` → `v5` so no client renders the old shape missing `course_completions_total`.
- `core_courses_active` field kept in the response (deprecated, still populated) so any external consumer doesn't break.

**Expected numerical result after rollout**

```text
Platform Signups:        107  (unchanged)
Course Completions:      111  (was "Core" 49; sublabel: "49 core · 62 onboarding")
General Applications:     11  (unchanged)
Badges Earned:           122  (drops from 166 once discord_linked timestamps are fixed)
                          =  111 + 11 + 0 actual discord links this week ✓
```
