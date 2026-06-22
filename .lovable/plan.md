## Goal

Teachers author class-scoped curriculum (sections → modules) with WYSIWYG content + embedded video, drag-drop reordering, and per-learner completion — mirroring the core-course experience on `GenericCoursePage`. Changes propagate to all cohorts of that class automatically (since curriculum lives at the class level).

## Architecture (enterprise, no spaghetti)

Three layers, one engine, server-authoritative.

### 1. Database (source of truth, RLS-locked)

New tables — all in `public`, all with GRANTs + RLS + `updated_at` trigger + `class_audit` hooks.

- `class_module_sections`
  - `id`, `class_id` → `classes.id` ON DELETE CASCADE
  - `title` (≤200), `summary` (≤500 nullable)
  - `position` int NOT NULL, `status` enum `draft|published|archived` default `draft`
  - `created_by`, `published_at`, `archived_at`, timestamps
  - UNIQUE(`class_id`, `position`) DEFERRABLE for atomic reorders

- `class_module_items` (the "lesson" equivalent)
  - `id`, `section_id` → sections ON DELETE CASCADE, `class_id` denormalized for RLS speed
  - `title` (≤200), `position` int
  - `content_html` text (server-sanitized; ≤200 KB)
  - `video_url` text nullable, `video_provider` enum `youtube|vimeo|google_meet|loom|other` (derived by trigger from URL)
  - `video_embed_url` text (computed/normalized by trigger; never trusts client)
  - `action_type` enum `read|watch|task` default `read`
  - `duration_minutes` int nullable, `required` bool default true
  - `status` enum `draft|published|archived` default `draft`
  - timestamps + `created_by`

- `class_module_progress`
  - `user_id`, `class_id`, `item_id`, `completed` bool, `completed_at`
  - PK (`user_id`, `item_id`); index (`user_id`,`class_id`)
  - Replaces any localStorage usage entirely.

- `class_module_audit` (append-only diff log, like `class_audit`)

**SECURITY DEFINER RPCs** (single write path, idempotent, transactional):
- `upsert_class_section(p_class_id, p_section_id?, p_title, p_summary, p_status)`
- `upsert_class_module_item(p_section_id, p_item_id?, p_title, p_content_html, p_video_url, p_action_type, p_duration_minutes, p_required, p_status)` — runs server-side sanitization via `sanitize_html_strict()` plpgsql/JS-port whitelist (no `<script>`, no `on*`, no `javascript:` URLs, allow iframes only from allowlist domains)
- `reorder_class_sections(p_class_id, p_ordered_ids uuid[])`
- `reorder_class_module_items(p_section_id, p_ordered_ids uuid[])` — both use temp-offset trick (`position = -position - 1` then renumber) for atomic conflict-free swaps
- `publish_class_curriculum(p_class_id)` — bulk publish drafts
- `toggle_class_module_completion(p_item_id, p_completed)` — checks enrollment, writes progress

All RPCs go through `withIdempotency` for client retries.

**RLS policies**
- Sections/items SELECT: class owner OR admin OR enrolled learner (via `cohort_registrations` → `cohorts.class_id`) AND `status='published'` for learners
- Sections/items INSERT/UPDATE/DELETE: class owner OR admin only — and only via the RPCs (table-level write privilege revoked from `authenticated`; granted to `service_role` + RPC owner)
- Progress: user reads/writes own only; RPC verifies enrollment
- Audit: SELECT for owner/admin; INSERT only via trigger

GRANTs follow the standard 4-step template.

### 2. Edge / API

No new edge functions required — RPCs handle writes. Server-side HTML sanitization lives in the RPC (uses a Postgres function backed by a strict tag/attr allowlist; we also keep a defense-in-depth DOMPurify pass on the client render).

### 3. Frontend (one engine, no duplicates)

New folder `src/features/class-curriculum/` (Service → Hooks → UI). No business logic in components.

- `services/classCurriculum.service.ts` — single port; wraps RPCs via `useIdempotentMutation`
- `hooks/useClassCurriculum.ts` — React Query: sections+items in one query keyed by `class_id`
- `hooks/useClassModuleProgress.ts` — keyed by `(user_id, class_id)`, 750ms debounced writes (matches our journey_progress pattern)
- `components/`
  - `CurriculumEditor.tsx` — teacher-only; `@dnd-kit/sortable` for sections + items; autosave on blur, optimistic + rollback
  - `SectionEditorRow.tsx`, `ItemEditorDialog.tsx` (title, action type, video URL, WYSIWYG, required, status)
  - `WysiwygEditor.tsx` — reuse the existing TipTap editor used by Announcements; same toolbar; sanitization on submit
  - `VideoEmbed.tsx` — normalizes YouTube / Vimeo / Loom / Google Meet links; Google Meet shows a styled "Join meeting" card (Meet can't be iframed — we render a CTA, not a broken embed) — eliminates a foot-gun the user didn't anticipate
  - `LearnerCurriculumView.tsx` — renders the **same** `CourseSection`/`CourseLesson` shape consumed by `GenericCoursePage` so visual parity is structural, not copy-pasted. We extract the existing presentational pieces from `GenericCoursePage` into `src/components/courses/CoursePlayer/` (pure props, no data fetching) and both the core-course page and the class learner view consume them.

- `pages/ClassDetailPage.tsx` — add `Curriculum` tab:
  - Teachers/admins: `<CurriculumEditor classId=…/>`
  - Enrolled learners: `<LearnerCurriculumView classId=…/>`
  - Everyone else: locked card

Routing already exists (`/classes/:classId`); no new routes needed.

### Reordering UX

dnd-kit `SortableContext` with vertical strategy. On drop:
1. Optimistic local reorder
2. Call `reorder_class_*` RPC with ordered ID array
3. On error: rollback + toast

The RPC swaps positions atomically inside one transaction (deferrable unique). No N writes from the client — one round trip.

### Propagation to cohorts

Curriculum lives at `class_id`, never at `cohort_id`. All `cohorts` of a class share one curriculum row-set. New cohort registrations immediately see published modules — no copy/sync job needed. This is the requested "updated for any class already registered."

## Security (OWASP coverage)

- **A01 Broken Access**: RLS + RPC ownership checks + table-write revocation
- **A03 Injection**: Server-side HTML sanitizer (strict allowlist), URL allowlist for video providers, parameterized RPCs only
- **A04 Insecure Design**: Single write port, idempotency keys, audit log
- **A05 Misconfig**: GRANTs explicit; default-deny RLS
- **A07 Auth**: RPCs check `auth.uid()` + `has_role`; no anon access
- **A08 Data Integrity**: deferrable unique on position; trigger-derived `video_provider`/`video_embed_url` so client can't spoof
- **A09 Logging**: `class_module_audit` append-only hash-chain entries
- **A10 SSRF**: We never fetch the video URL server-side; provider parsing is regex-only

## Accessibility (WCAG 2/3)

- dnd-kit keyboard sortable strategy (Arrow keys + Space)
- All interactive items have visible focus + `aria-grabbed`/`aria-describedby` live regions
- WYSIWYG: TipTap with proper headings (no skipped levels), alt text required for inserted images
- Video embeds carry `title` attr and a transcript field (optional but linted)

## BDD scenarios (stored in `bdd_scenarios`)

Feature `class-curriculum`:
- CC-001 Teacher creates section → row in DB, audit entry, appears in editor [UI/DB/Code]
- CC-002 Teacher adds module with WYSIWYG + YouTube URL → sanitized HTML stored, `video_provider='youtube'`, `video_embed_url` normalized [UI/DB/Code]
- CC-003 Teacher embeds `<script>` → stripped server-side, audit logs sanitization [UI/DB/Code]
- CC-004 Teacher drags section to new position → `reorder_class_sections` RPC, positions renumbered atomically [UI/DB/Code]
- CC-005 Teacher drags item across sections → item.section_id + position updated transactionally [UI/DB/Code]
- CC-006 Non-owner teacher attempts edit → RLS denies, no audit row [UI/DB/Code]
- CC-007 Enrolled learner sees only `published` modules [UI/DB/Code]
- CC-008 Unenrolled member gets locked card, RLS denies direct query [UI/DB/Code]
- CC-009 Learner toggles completion → `class_module_progress` upserted; progress bar updates [UI/DB/Code]
- CC-010 Google Meet URL renders CTA card, not iframe [UI/Code]
- CC-011 Reorder during concurrent edit → deferrable unique resolves; no constraint violation [DB]
- CC-012 Publish curriculum makes all draft items visible to existing cohort registrants without re-registration [UI/DB]
- CC-013 Class deleted → curriculum + progress cascade-delete; audit retained [DB]
- CC-014 Idempotent retry of `upsert_class_module_item` returns same row [Code/DB]
- CC-015 Keyboard-only user can reorder sections (Arrow+Space) [UI a11y]

## Out of scope (explicit)

- Quizzes / graded assessments (future)
- File attachments (future; can reuse `class-resources` bucket later)
- Per-cohort overrides (intentional: curriculum is class-level by your spec)
- Course-catalog migration of teacher modules into core curriculum

## Shipment order (one PR per phase, each independently revertible)

1. Migration: tables, enums, RPCs, RLS, audit triggers, GRANTs
2. Extract `CoursePlayer` presentational components from `GenericCoursePage`
3. `class-curriculum` service + hooks
4. `CurriculumEditor` + dnd-kit + WYSIWYG + VideoEmbed
5. `LearnerCurriculumView` + Curriculum tab on `ClassDetailPage`
6. BDD scenarios inserted; vitest unit tests for sanitizer + reorder math; Playwright happy-path
