# Tech Fleet Network — Comprehensive Refactor, UX Audit & Refactor KPI Dashboard

Three parts, shipped together. Nothing removed from earlier plans; Part 3 (new) adds a System Health tab that proves every fix below is actually moving the needle, with daily DB snapshots.

---

## Headline metrics (tracked daily in `refactor_kpi_daily`)

| # | Metric | Today | Target | Owner section |
|---|---|---|---|---|
| 1 | Audit-log error-class % | 7.9% | <1.5% | 1.1, 1.6 |
| 2 | `profile_updated` writes / 30d | ~21,800 | ~6,500 (−70%) | 1.1, 1.2, 2A |
| 3 | Profile edits per user (p95 / max) | 27 / 34 | ≤3 / ≤6 | 2A1 |
| 4 | Profile edits within 5 min of create | 2,015 | <300 | 2A2 |
| 5 | Task uncompletion rate | 2.82% | <0.3% | 2B1 |
| 6 | General-app submit rate | 56.9% | ≥80% | 2G1 |
| 7 | Signup completion post-captcha | ~63% | ≥95% | 2E1 |
| 8 | Discord attempts per success | 2.35 | ≤1.1 | 2D1 |
| 9 | Admin notification peak / user / wk | 283 | ≤30 | 2F1, 1.2 |
| 10 | Avg time-to-first-task (min) | 567 | ≤10 | 2B2 |
| 11 | Notification fan-out duplicates | 1,015 | 0 | 1.2 |
| 12 | ServiceWorker noise rows | 387 | 0 | 1.6 |
| 13 | Chunk-load brick sessions | 36 | 0 | 1.5 |
| 14 | Email DLQ replay latency p95 | manual | <5 min | 1.3 |
| 15 | `[object Object]` log rows | 614 | 0 | 1.6 |

Plus ~10 secondary metrics seeded in `refactor_kpi_catalog` (provider misses, captcha-silent rate, announcement re-reads, avatar re-uploads, freescout transport errors, bulk-cap rejections, etc.).

---

# PART 1 — Systemic error refactor

## 1.1 Audit-log tri-partite sink architecture
One `audit_log` absorbs compliance, telemetry, and counters → 1,015 dup collisions and 7.9% error-class noise.

- New registry: `audit_sink_registry(table_name PK, mode CHECK ('semantic'|'generic'|'none'), sink CHECK ('audit_log'|'ops_events'|'ops_metrics'))`.
- Drop generic AFTER triggers on `profiles`, `projects`, `general_applications`, `project_applications`, `notifications`, `journey_progress`.
- Single SECURITY DEFINER write path: `record_event(sink, kind, actor, payload, severity)`. `REVOKE INSERT ON audit_log FROM anon, authenticated`.
- `audit_log` (compliance, hash-chained, never pruned — per memory). `ops_events` (telemetry, day-partitioned, 90-day retention). `ops_metrics` (daily-rolled counters).
- CI guard `scripts/ci/check-audit-sink-coverage.mjs` fails build on any public table without a registry row.

## 1.2 Idempotency engine (server + client)
773 rapid-repeat writes; 1,015 notification dupes; profile re-saves up to 34×.

- Server: `_shared/idempotency.ts` + `request_idempotency(key PK, user_id, request_hash, response_json, expires_at)`; every mutating edge fn wraps `withIdempotency`.
- Client: `useIdempotentMutation` attaches `X-Request-Id`, 250 ms debounce, single in-flight per key.
- DB safety nets (cannot bypass): partial unique indexes
  - `notifications_dedupe(user_id, kind, ref_id)` WHERE kind IN (...)
  - `email_queue_dedupe(recipient, template, ref_id)`
  - `journey_progress_unique(user_id, task_id)`
  - `announcement_reads_unique(user_id, announcement_id)`

## 1.3 Email pipeline overhaul
57 silent bulk-cap rejections; missing List-Unsubscribe; manual DLQ replay.

- `email_templates(slug PK, lane, purpose, default_headers jsonb, frequency_cap_applies, list_unsubscribe_path)` — callers pass only `(slug, recipient, vars)`; lane is derived server-side and cannot be overridden.
- `transactional-email.ts` injects `List-Unsubscribe`, `List-Unsubscribe-Post`, `Precedence: bulk` per template.
- New `replay-email-dlq` cron (every 5 min) with generation counter + escalate-to-admin after 3 replays.
- Resend warnings routed to `ops_events` only (no longer triage-noisy).
- Per-kind member email-prefs page with frequency-cap visibility.

## 1.4 Auth & session resilience
- AuthContext converted to reducer with explicit transitions: `bootstrap → authenticated → refreshed | revoked`; only `bootstrap → authenticated` emits `login_succeeded`.
- `revoked_sessions(session_id PK, revoked_at, reason)` is source of truth; clients self-terminate via realtime channel.
- Keeps two-strike `decidePurgeOnBadJwt` (memory: Auth Wedge Recovery) — never regress.

## 1.5 Frontend chunk-load & boundary stability
36 chunk-load failures + 20 `useAuth must be used within AuthProvider` whitescreens.

- New `src/lib/lazyWithRetry.ts` (3 retries: 250/500/1000 ms; on exhaustion show `<UpdateAvailableBanner/>` — never auto-reload).
- Codemod every `React.lazy(...)` → `lazyWithRetry(...)`; new ESLint rule `lazy/requires-retry`.
- `<AuthProvider>` hoisted above the router; safe sentinel `{status:'no-provider'}` renders `<AppShellFallback>`; ESLint rule `auth/use-auth-requires-provider`.
- `<ScopedErrorBoundary label>` on every top-level route + every lazy island.

## 1.6 Observability hygiene
614 `[object Object]`, 387 SW rows.

- `src/lib/reporter/format.ts` uses `safeStringify`; classifies SW / `Script error.` / `chrome-extension://` as `severity:info` → `ops_events` only.
- One-time `navigator.serviceWorker.getRegistrations().then(...unregister())` in `main.tsx` (memory: PWA disabled).
- `known_issue_catalog` 30-day backstop.
- CSP allowlist `*.hcaptcha.com` (`script-src`, `connect-src`, `frame-src`) + `*.discord.com` (`frame-src`).

## 1.7 Freescout / Get Help permanence
- `freescout-proxy` pinned in `config.toml` (memory: Edge Function Config Pinning).
- `assign` resolves `assigneeUserId:"self"` via `_shared/freescout-admin.ts` with inline provisioning.
- `auditedInvoke` / `freescoutInvoke` emit `upstream:<status> upstream_code:<code>` at `severity:warn`.

---

# PART 2 — UX-pattern refactor

## A — Onboarding & profile
- **A1 — 34× profile edits/user.** Replace per-field auto-save with explicit "Save changes" + universal `<SaveStatus>` ("Saved 2s ago / Saving / Unsaved changes"). Auto-derive `display_name` via DB trigger. Country = ISO dropdown, geo-IP is a suggestion only. Visible profile completeness meter.
- **A2 — 2,015 edits within 5 min of create.** New `/welcome` wizard route gated by `profiles.onboarded_at`. New view `v_profile_readiness(user_id, score, missing_fields[])` powers the meter + nudges.
- **A3 — 528 standalone country edits.** Default blank; wizard forces it once.

## B — Tasks & lessons
- **B1 — 203 uncompletions; 5–9 toggles/user.** Separate **Mark complete** CTA from auto-save progress. Re-click → `<ConfirmDialog actionLabel="Mark incomplete">`. DB trigger on `journey_progress` blocks `completed_at` reset unless `app.allow_uncomplete=true` is set by the confirm path. Visible completion banner with "View certificate" CTA.
- **B2 — median 4.7 min vs avg 567 min TTFT.** First-session dashboard shows only "Start here". `profiles.dashboard_layout_version` evolves the layout as user advances. 24h zero-completion nudge.

## C — Announcements
- **C1 — re-read up to 7×.** Tri-state card (unread / read / acted). New `announcement_actions(user_id, announcement_id, action, at)` powers "acted". `UNIQUE(user_id, announcement_id)` on `announcement_reads` with `ON CONFLICT DO UPDATE`. Archive affordance.

## D — Discord
- **D1 — 2.35 attempts/success.** OAuth-first; username search hidden behind disclosure. Debounced typeahead. Post-connect confirmation card with the linked handle.

## E — Signup & login
- **E1 — 25/29 captcha-silent.** CSP allowlist (1.6). Submit disabled until widget `ready`; 10s timeout → magic-link fallback. Live password checklist. Terms link above Submit.
- **E2 — ~10% login retries.** 2-fail inline "Forgot password"; 3-fail magic-link offer. Google primary (memory).

## F — Notifications
- **F1 — 283/wk peak.** DB-level dedupe (1.2). In-app digest collapses >5/kind/10min into one stack. Per-kind settings page. Triggers no-op when `notification_prefs[kind]='off'`.

## G — Applications
- **G1 — 56.9% submit rate.** Draft autosave + `<SaveStatus>` (state in `general_applications.draft_state jsonb`). "Resume application" dashboard banner. Sticky progress meter + Submit footer. 48h reminder via email catalog.
- **G2 — status flip-flops.** Verb-explicit `<ConfirmDialog>` ("Move to interview" not "Yes"). New "Pending review" holding state. 60s Undo toast. `application_status_changed` records `from → to`.

## H — Browser kinks
- **H1.** SW unregister + reporter classification (1.6).
- **H2 — `Failed to load announcements`.** localStorage cache (24h TTL) graceful degradation; inline retry CTA; `<Suspense>` skeletons.
- **H3 — useAuth provider misses.** Provider hoist + ESLint + safe sentinel (1.5).
- **H4 — translator extension noise.** Suppressed; one-time `installDomTranslator()` tip (memory).

## I — Email UX
- **I1 — bulk-cap silence.** Member prefs page shows "Next bulk send: Jun 4".
- **I2 — Resend warnings.** Routed to ops_events only; visible in System Health > Email.

## J — Self-service
- **J1 — avatar 70× re-uploads.** In-browser cropper (512×512), EXIF normalization, preview ring before save.
- **J2 — discord_username 250× edits.** Resolved by A1 + D1.

## Cross-cutting spine
1. `<SaveStatus>` is universal (ESLint: `forms-have-save-status`).
2. `useIdempotentMutation` is the only mutation path (ESLint guard).
3. `v_profile_readiness` is single source of truth for nudges & meters.
4. `<ConfirmDialog>` on every reversal (verb+object, never OK/Yes — memory).
5. Inline error recovery — every toast ends in a verb CTA.
6. `profiles.dashboard_layout_version` drives dashboard evolution.

---

# PART 3 — NEW: Refactor KPIs dashboard in System Health

New tab **"Refactor KPIs"** in `/admin/system-health` that visualizes every metric above, snapshots daily into the DB, and shows progress vs target with sparklines + status chips.

## 3.1 DB schema

```sql
-- Append-only daily snapshots (never updated in place)
CREATE TABLE public.refactor_kpi_daily (
  id            BIGSERIAL PRIMARY KEY,
  snapshot_date DATE NOT NULL,
  metric_key    TEXT NOT NULL,
  metric_value  NUMERIC NOT NULL,
  metric_unit   TEXT NOT NULL,              -- percent | count | minutes | ratio
  numerator     BIGINT,
  denominator   BIGINT,
  window_label  TEXT NOT NULL,              -- last_24h | last_7d | last_30d
  computed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (snapshot_date, metric_key, window_label)
);
GRANT SELECT ON public.refactor_kpi_daily TO authenticated;
GRANT ALL    ON public.refactor_kpi_daily TO service_role;
ALTER TABLE  public.refactor_kpi_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read refactor_kpi_daily"
  ON public.refactor_kpi_daily FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Static metric catalog (label, target, direction, owner section)
CREATE TABLE public.refactor_kpi_catalog (
  metric_key      TEXT PRIMARY KEY,
  label           TEXT NOT NULL,
  description     TEXT NOT NULL,
  unit            TEXT NOT NULL,
  baseline_value  NUMERIC NOT NULL,
  target_value    NUMERIC NOT NULL,
  direction       TEXT NOT NULL CHECK (direction IN ('lower_is_better','higher_is_better')),
  category        TEXT NOT NULL,            -- errors | ux | email | infra | auth
  related_section TEXT NOT NULL,            -- 'Part 1 §1.1' etc.
  sort_order      INT NOT NULL DEFAULT 100
);
GRANT SELECT ON public.refactor_kpi_catalog TO authenticated;
GRANT ALL    ON public.refactor_kpi_catalog TO service_role;
```

Seed catalog with the 15 headline + ~10 secondary metrics.

## 3.2 Snapshot RPC

`public.snapshot_refactor_kpis()` — SECURITY DEFINER, callable by service role and admins. Computes each metric for windows `last_24h` and `last_7d`, upserts into `refactor_kpi_daily` (unique constraint = idempotent). Examples:

- `audit_log_error_pct` — `100.0 * count(*) FILTER (WHERE 'severity:error' = ANY(changed_fields)) / NULLIF(count(*),0)`
- `profile_updates_30d` — `count(*) WHERE event_type='profile_updated'`
- `profile_edits_per_user_p95` — percentile over per-user counts
- `profile_edits_within_5min` — paired `profile_created`/`profile_updated` within 300s
- `task_uncompletion_pct` — `task_uncompleted / (task_completed + task_uncompleted)`
- `general_app_submit_rate` — `submitted / started`
- `signup_post_captcha_completion_pct` — `signup_succeeded / signup_attempted_after_captcha_ready`
- `discord_attempts_per_success` — `lookup_count / link_success_count`
- `admin_notification_peak_per_user_per_week`
- `time_to_first_task_avg_minutes`
- `notification_fanout_duplicates` — from `ops_events` (unique-index rejections)
- `serviceworker_noise_rows`, `chunk_load_brick_sessions`
- `email_dlq_replay_latency_p95_seconds` — failed→sent delta in `email_send_log`
- `object_object_log_rows` — `audit_log` rows matching `[object Object]`

## 3.3 Daily cron

```sql
SELECT cron.schedule(
  'snapshot-refactor-kpis-daily', '30 2 * * *',
  $$SELECT public.snapshot_refactor_kpis();$$
);
```

Admin-visible "Run snapshot now" button calls the same RPC; the unique key makes the call idempotent within a day.

## 3.4 Read API

```sql
CREATE FUNCTION public.get_refactor_kpis(p_days INT DEFAULT 30)
RETURNS TABLE (
  metric_key TEXT, label TEXT, description TEXT, category TEXT, unit TEXT,
  baseline_value NUMERIC, target_value NUMERIC, direction TEXT,
  current_value NUMERIC, previous_value NUMERIC,
  trend NUMERIC[],                        -- last N daily points
  status TEXT                              -- met | on_track | at_risk | off_track
) ...
```

Status rule: distance baseline→target. `met` when current crosses target; `on_track` ≥50% of the way; `at_risk` 0–50%; `off_track` regressed past baseline.

## 3.5 UI — new "Refactor KPIs" tab

- Route: extend existing `SystemHealthPage` — add `<TabsTrigger value="refactor-kpis">Refactor KPIs</TabsTrigger>`.
- Component: `src/components/system-health/RefactorKpisTab.tsx`.
- Layout: category sections (Errors · UX · Email · Infra · Auth). Each row is a `tf-card` (iconless, stacked-left, ≥1rem text — memory):
  - Label + plain-English description (7th-grade reading — memory).
  - Big current value · target · baseline.
  - 30-day sparkline (Recharts).
  - Status chip (Met = Growth Green, On track = Action Blue, At risk = Alert Orange, Off track = Alert Red).
  - "Open evidence" disclosure → SQL used + last 7 daily rows table.
- Top hero strip: "X of 25 metrics met · Y on track · Z at risk · W off track" + "Run snapshot now" (admin-only) + "Last snapshot: <relative time>".
- Realtime: subscribes to `refactor_kpi_daily` so on-demand snapshots refresh the tab live.
- Service: `src/services/system-health.service.ts` gains `getRefactorKpis(days)` and `runRefactorKpisSnapshot()`.
- Tests: `src/test/ui/RefactorKpisTab.test.tsx` (renders categories, chips, sparkline; admin-gated).

## 3.6 BDD

- `KPI-DASH-001` admin sees Refactor KPIs tab in System Health.
- `KPI-DASH-002` non-admin cannot see or query.
- `KPI-DASH-003` cron writes one row per metric / window / day; uniqueness prevents dupes.
- `KPI-DASH-004` "Run snapshot now" upserts and broadcasts realtime.
- `KPI-DASH-005..029` one per seeded metric (baseline → target math + status classification).

## 3.7 Memory

- New: `mem://features/system-health/refactor-kpis`.
- Index line: "Refactor KPIs tab in System Health is source of truth for refactor progress; daily snapshots in `refactor_kpi_daily`, append-only."

---

# CI / smoke / BDD (cross-part)

- `check-audit-sink-coverage.mjs`, existing `check-edge-function-coverage.mjs`, `forms-have-save-status` ESLint rule, `lazy/requires-retry`, `auth/use-auth-requires-provider`.
- Smoke: onboarding-completeness, task-toggle-confirm, announcement-tri-state, discord-oauth-default, signup-captcha-readiness, notification-dedupe, email-catalog-lane, **refactor-kpis-snapshot**.
- BDD: `AUDIT-SINK-001..010`, `IDEMP-001..008`, `EMAIL-CATALOG/DLQ/UNSUB`, `AUTH-REDUCER/REVOKE/PROVIDER`, `LAZY-RETRY`, `OBS-NOISE`, UX-* (per Part 2), `KPI-DASH-001..029`.

# Files touched

**New migrations:** `audit_sink_architecture.sql`, `idempotency_engine.sql`, `notification_email_dedupe.sql`, `journey_progress_uncomplete_guard.sql`, `profile_readiness_view.sql`, `email_templates_catalog.sql`, `announcement_reads_dedupe_and_actions.sql`, **`refactor_kpi_dashboard.sql`** (table + catalog seed + `snapshot_refactor_kpis` + `get_refactor_kpis` + cron).

**Edge functions:** `_shared/idempotency.ts`, `_shared/record-event.ts`, `replay-email-dlq` (cron), `process-avatar` (EXIF), `transactional-email.ts` (catalog), unchanged `auth-email-hook.ts`.

**Frontend new:** `lazyWithRetry.ts`, `useIdempotentMutation.ts`, `SaveStatus.tsx`, `WelcomeWizard.tsx`, `/welcome` route, `CompletenessMeter.tsx`, notification `SettingsPanel.tsx`, avatar `CropperDialog.tsx`, **`RefactorKpisTab.tsx`**.

**Frontend edited:** `AuthContext.tsx` (reducer), `session-health.ts`/`fetch-guard.ts` (keep wedge guard), `Profile.tsx`, `Signup.tsx`, `Login.tsx`, `AnnouncementCard.tsx`, `LessonCompletionToggle.tsx`, `GeneralApplicationForm.tsx`, `DiscordLinkCard.tsx`, `reporter/format.ts`, `main.tsx`, **`SystemHealthPage.tsx`** (new tab), **`system-health.service.ts`** (new methods).

# Out of scope

- Re-enabling PWA. Replacing hCaptcha. Learning-path content edits. Anything that adds clicks or surprises on existing happy paths.
