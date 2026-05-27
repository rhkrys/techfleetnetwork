
# Pre-warmed Full-Coverage i18n — Final Plan (+ User-Generated Content)

Two distinct content classes, one unified architecture:

| Class | Examples | Strategy |
|---|---|---|
| **Static UI strings** | Buttons, labels, nav, toasts, emails | Build-time extract → prewarm all locales → CDN snapshot |
| **Dynamic UGC** | Client names/descriptions, project briefs, application essays, announcements, course/lesson content, profile bios | Write-time hook → translate-on-demand for active locales → cache → lazy-fill for cold locales |

---

## Database Architecture (additions for UGC)

### Existing (recap): `i18n_strings`, `i18n_translations`, `i18n_snapshots`, `i18n_prewarm_jobs`, `i18n_qa_failures`, `i18n_coverage_audit`, `i18n_banned_terms`

### New: `i18n_content_registry` — declares every translatable column in every table
| Column | Type | Purpose |
|---|---|---|
| `id` | uuid PK | |
| `table_name` | text | e.g. `clients`, `projects`, `applications`, `announcements`, `courses`, `lessons` |
| `column_name` | text | e.g. `description`, `essay_response` |
| `content_format` | text | `plain` \| `markdown` \| `html` \| `rich_text` |
| `priority` | text | `hot` (translate on write) \| `warm` (translate on first read) \| `cold` (lazy only) |
| `max_chars` | int | Skip translation above cap; show "Translate" button instead |
| `is_pii` | boolean | If true, skip translation (names, emails) |

Seeds: `clients.description`, `projects.title/description/brief`, `applications.essay_response`, `announcements.title/body`, `courses.title/description`, `lessons.title/body`, `profiles.bio`, etc.

### New: `ugc_translations` — cache for user-generated content (separate from `i18n_translations` to keep static catalog small + queryable)

| Column | Type | Purpose |
|---|---|---|
| `id` | uuid PK | |
| `entity_table` | text | e.g. `projects` |
| `entity_id` | uuid | Row PK |
| `column_name` | text | e.g. `description` |
| `source_locale` | text | Detected source language (CLD3 at write time) |
| `target_locale` | text | |
| `source_hash` | text | SHA-256 of source content — invalidates cache on edit |
| `translated_text` | text | |
| `content_format` | text | `plain` \| `markdown` \| `html` |
| `status` | text | `pending` \| `qa_passed` \| `qa_failed` \| `flagged` |
| `qa_report` | jsonb | Same 6-gate output |
| `is_admin_edited` | boolean | Locks vs AI |
| `created_at` / `updated_at` | | |

**Unique:** `(entity_table, entity_id, column_name, target_locale, source_hash)`.
**Indexes:** `(entity_table, entity_id, target_locale)` for read fanout, `(status)` partial, `(updated_at DESC)` for cache eviction.
**Partitioning:** PARTITION BY LIST (`entity_table`) — keeps `projects` separate from `applications` so hot tables stay small; auto-prune partitions when entity row is deleted via FK cascade trigger.

### New: `ugc_translation_jobs` — async queue (pgmq or table-based)
Drains via `prewarm-ugc-worker` edge fn. Priority lanes: `realtime` (hot writes), `batch` (warm fills), `backfill` (cold locales).

---

## Architecture Flow

```text
WRITE PATH (project/announcement/application created or edited)
─────────────────────────────────────────────────────────────────
  Insert/Update on registered table
              │
              ▼
   AFTER trigger: detect_source_language + compute source_hash
              │
              ▼
   Enqueue jobs into ugc_translation_jobs:
     - priority='realtime' for active locales (locales seen in last 7d)
     - priority='batch' for top-50 locales
     - cold locales skipped — translated on first read
              │
              ▼
   prewarm-ugc-worker (drains queue, 50 jobs/run, 30s cron)
     → AI Gateway → 6-gate QA → write to ugc_translations
     → on QA fail → status='qa_failed', read path falls back to source

READ PATH (user views a project in their locale)
─────────────────────────────────────────────────────────────────
   Component requests project.description in locale='ja-JP'
              │
              ▼
   useUgcTranslation(entity_table, entity_id, column, locale) hook
              │
              ▼
   1. React Query cache (memory, 5min)
   2. ugc_translations row (qa_passed, matching source_hash)
              │
        hit ──┴── miss
         │          │
         ▼          ▼
     return    Show source instantly + enqueue 'realtime' job
                  → next render (or via realtime subscription) swaps in translation
                  → optimistic "Translating…" badge

EDIT PATH (admin/owner updates a project description)
─────────────────────────────────────────────────────────────────
   Update row → new source_hash → trigger marks all
   ugc_translations rows for that (entity, column) STALE
   → re-enqueue active locales → snapshot UI reflects within seconds
```

---

## Coverage & Quality for UGC

**Coverage strategy** — Not "100% of all UGC × 75 locales" (would be wasteful and unbounded). Instead:
- **Active-locale guarantee:** Any locale with ≥1 user in the last 7d gets 100% of UGC translated proactively.
- **Cold locales:** Translated within 2–8s of first read, cached forever after (until source edited).
- **Coverage dashboard** shows per-locale UGC coverage: `translated / total registered rows`.

**Quality** — Same 6-gate QA pipeline reused from static (placeholders, language detection, denylist, back-translation cosine ≥ 0.82, native LLM reviewer, brand/glossary lock). Markdown/HTML preserved via format-aware prompts + structural diff check.

**Source-language detection** — CLD3 at write time stores `source_locale` so we never translate English→English or French→French. Mixed-language content (common in essays) flagged for chunked translation.

**Edit safety** — `source_hash` changes invalidate only that entity's translations, never the whole cache.

---

## Scalability & Cost (10,000 users)

### Sizing
- Active UGC rows × translatable columns ≈ 50,000 strings (projects, applications, announcements, etc.)
- Active locales (steady state): ~15 (top languages of actual members)
- **Hot cache:** 50,000 × 15 = **750k `ugc_translations` rows** — comfortable
- Cold-locale lazy fills: ~5,000 rows/mo

### Cost
| Component | Cost @ 10k users |
|---|---|
| Initial UGC backfill (50k × 15 locales) | one-time **~$8–$15** |
| Steady-state new content (50 writes/day × 15 locales) | ~$0.30/mo |
| Cold-locale lazy translations (5k/mo) | ~$0.10/mo |
| QA gates (back-translation + reviewer) | included above, ~30% overhead |
| Edge fn compute (worker every 30s) | ~$1/mo |
| DB storage (~750k rows, avg 500 bytes) | ~400 MB, negligible |
| **Total UGC i18n cost** | **~$2/mo steady** |

### Performance safeguards
- **Write amplification cap:** Max 15 jobs enqueued per write (active locales only). Cold locales never blocked at write.
- **Worker concurrency:** 1 worker, serial batches of 50, ~10s/batch → 300 translations/min sustained, 18k/hour peak.
- **Circuit breaker** on AI Gateway: trips after 5 consecutive failures, drains queue with exponential backoff, alerts admins.
- **Cost guard:** Hard cap 10,000 UGC translations/day. Excess deferred to next day with admin alert.
- **Read fanout:** Single SQL fetch with `(entity_table, entity_ids[], target_locale)` lookup — O(1) hash join.
- **Partitioning** by `entity_table` keeps hot reads on `projects` partition (small) instead of scanning all UGC.
- **Realtime subscription** on `ugc_translations` so the UI swaps source → translation without a page refresh.

### Scale ceiling
At 100k users / 500k UGC rows × 25 active locales = 12.5M rows. Partitioned table handles this with room to spare; storage ~6 GB; cost climbs to ~$15/mo. Linear in writes, not reads.

---

## Implementation Phases (ship in one pass)

1. **Schema** — Add `i18n_content_registry`, `ugc_translations` (partitioned), `ugc_translation_jobs`. Seed registry for all current user-facing tables.
2. **Write-side triggers** — AFTER INSERT/UPDATE on registered tables: detect source language, compute hash, enqueue jobs for active locales.
3. **`prewarm-ugc-worker` edge fn** — Drains queue, calls AI Gateway, runs 6-gate QA, writes results. Same QA module as static path.
4. **`useUgcTranslation` React hook + `<TranslatedText>` component** — Tries cache → DB → enqueues + shows source with "Translating…" badge → realtime swap on completion.
5. **Backfill job** — One-time admin action: enqueues all existing UGC × top 15 locales.
6. **Admin UGC Translations tab** — Same review/override UI as static; filter by entity type, source/translation/QA report side-by-side.
7. **Coverage + cost dashboard** — Per-locale UGC coverage %, cost guard status, queue depth.

---

## Verification

1. Create new project → within 30s, `ugc_translations` rows exist for all 15 active locales, all `status='qa_passed'`.
2. Edit project description → old translations marked stale, new ones generated within 30s, UI updates via realtime without refresh.
3. Visit project in a cold locale (e.g. Swahili) → source shown immediately, translation appears within 8s, cached for future visits.
4. Seeded bad UGC (profanity, broken markdown, wrong-language) → lands in `qa_failed`, source served instead, admin alerted.
5. Bulk create 200 projects → queue drains, cost guard not tripped, no AI Gateway 429s.
6. BDD scenarios: `I18N-UGC-001..014` in `bdd_scenarios` with tri-layer assertions.

---

Approve to ship all phases (static + UGC) in one pass.
