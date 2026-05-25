# Why your work vanished

Two bugs combined:

1. **`ProjectFormPage` only autosaves in *edit* mode** (`src/pages/ProjectFormPage.tsx` line 393 — `enabled: isEditing && initialized`). In create mode nothing is persisted while you type.
2. **`AuthContext` and `PageHeaderContext` force `window.location.reload()` on any HMR cascade** (`src/contexts/AuthContext.tsx` line 332–335, `src/contexts/PageHeaderContext.tsx` line 67–72). These exist to prevent duplicate-context crashes and must stay. A programmatic reload bypasses `beforeunload`, so unsaved state dies silently.

Same gap exists on every other create surface: `ClassFormPage`, `CohortFormPage`, `ProjectBlastComposer`, `BannerManagementPage` (announcement composer).

# Fix: one server-side draft system for the whole app

Persistent, per-user, cross-device, survives reloads/HMR/tab crashes/device swaps. Single table, single hook, applied to every create form.

## 1. Database — `form_drafts` table

One table covers every form. Keyed by `(user_id, draft_key)` so a user has at most one draft per form surface.

```sql
CREATE TABLE public.form_drafts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  draft_key     text NOT NULL,           -- e.g. 'project:new', 'class:new', 'project-blast:{projectId}'
  schema_version int  NOT NULL DEFAULT 1, -- bump when form shape changes; older drafts ignored
  payload       jsonb NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  UNIQUE (user_id, draft_key)
);
CREATE INDEX ON public.form_drafts (user_id, updated_at DESC);
CREATE INDEX ON public.form_drafts (expires_at);
```

- **RLS**: SELECT/INSERT/UPDATE/DELETE all gated by `auth.uid() = user_id`. No service-role paths needed from the client.
- **Size cap trigger**: reject payloads > 256 KB to keep the table bounded.
- **`updated_at` trigger** (reuses existing `update_updated_at_column()`).
- **Daily cron** (`pg_cron`): `DELETE FROM form_drafts WHERE expires_at < now();` — 14-day TTL keeps the table small without burdening users.
- **Touch-on-save**: any UPSERT extends `expires_at` by 14 days.
- **PII**: payloads may contain free text and recipient lists — table sits under the same encryption-at-rest posture as the rest of the schema; payloads are never logged.

## 2. Hook — `src/hooks/use-server-draft.ts`

Replaces ad-hoc state management for any create form. Single API:

```ts
const { value, setValue, status, restored, clearDraft, lastSavedAt }
  = useServerDraft<ProjectForm>({
      draftKey: "project:new",
      schemaVersion: 1,
      initialValue: EMPTY_FORM,
      enabled: !isEditing,             // only on create mode
      intervalMs: 30_000,              // fixed-interval batch (same rationale as use-autosave)
      label: "project-form",
    });
```

Behavior:
- **On mount**: SELECT existing draft for `(user_id, draft_key, schema_version)`. If present & not expired → hydrate `value`, set `restored = true`. If stale schema_version → ignore + delete.
- **On change**: mark dirty; flush every 30 s if dirty + not in-flight (same pattern as `useAutosave`). UPSERTs with `onConflict: 'user_id,draft_key'`.
- **On `visibilitychange=hidden`, `pagehide`, unmount, and the new `lovable:pre-hmr-reload` event** → synchronous best-effort flush via `navigator.sendBeacon`-style edge function (`save-form-draft`) so HMR-triggered reloads don't lose the last keystrokes.
- **On `clearDraft()`** → DELETE row; called from `mutation.onSuccess` of the real create and from an explicit "Discard draft" confirm dialog.
- **Backoff**: 1s/3s/8s on transient failures; reuses the policy already in `use-autosave.ts`.
- **Cost**: at 100k members each typing in ≤1 form actively, ceiling is ~2 writes/min/form. Idle forms cost 0.

## 3. Edge function — `save-form-draft`

Tiny JWT-validated function used only for the HMR-flush / unload-flush path where the supabase-js client may not finish a fetch before unload. Validates: JWT present, body schema, payload ≤256 KB. RLS still applies via user JWT — no service role.

## 4. HMR reload becomes lossless

Add to `AuthContext.tsx` and `PageHeaderContext.tsx`, immediately before `window.location.reload()`:

```ts
window.dispatchEvent(new Event("lovable:pre-hmr-reload"));
// give the synchronous beacon a tick
queueMicrotask(() => window.location.reload());
```

`useServerDraft` listens for that event and flushes via beacon. Existing duplicate-context safety is preserved.

## 5. Wire create-mode forms (edit mode unchanged)

- `src/pages/ProjectFormPage.tsx` — `useServerDraft({ draftKey: "project:new" })` when `!isEditing`; clear in `createMutation.onSuccess`. Existing edit-mode `useAutosave` stays as-is (already writes to the real row).
- `src/pages/ClassFormPage.tsx` — `draftKey: "class:new"` create-mode only.
- `src/pages/CohortFormPage.tsx` — `draftKey: "cohort:new"` create-mode only.
- `src/components/recruiting/ProjectBlastComposer.tsx` — `draftKey: ` `` `project-blast:${projectId}` `` ; clear on send.
- `src/pages/BannerManagementPage.tsx` — `draftKey: "banner:new"` for the composer.

Edit-mode pages that already autosave server-side (`ProjectApplicationPage`, edit-mode `ProjectFormPage`) are untouched — they don't need drafts because the row itself is the draft.

## 6. UX — `src/components/forms/DraftRestoredBanner.tsx`

Inline banner at the top of the form when `restored === true`:

> "Draft from 3 minutes ago restored." [Discard draft]

- `<ConfirmDialog actionLabel="Discard draft">` per house rules.
- `role="status"`, sentence case, verb+object CTAs, no banned terms.
- Saved indicator reuses `src/components/ui/AutosaveStatus.tsx` so the same "Saved · 2:30 pm EST" affordance appears under every draft-enabled form.

## 7. BDD scenarios (insert into `bdd_scenarios`)

Tri-layer Then-clauses per house rules:

- `FORM-DRAFT-001` Create-project draft survives full reload — [UI] fields prefilled, banner shown / [DB] one `form_drafts` row, no premature `projects` row / [Code] `useServerDraft` returns `restored: true`.
- `FORM-DRAFT-002` Successful create deletes the draft — [UI] banner gone next visit / [DB] `projects` insert + `form_drafts` row deleted / [Code] `clearDraft()` called in `onSuccess`.
- `FORM-DRAFT-003` Discard draft requires confirm — [UI] ConfirmDialog with "Discard draft" / [DB] row deleted / [Code] localStorage untouched, table row gone.
- `FORM-DRAFT-004` HMR reload flushes mid-keystroke state via beacon — [UI] last typed char present after reload / [DB] `payload->>field` matches latest value / [Code] `lovable:pre-hmr-reload` listener fires `save-form-draft`.
- `FORM-DRAFT-005` Draft visible across devices — [UI] open new browser, banner shows / [DB] same row served / [Code] SELECT by `(user_id, draft_key)`.
- `FORM-DRAFT-006` Schema-version bump invalidates old drafts — [UI] empty form / [DB] stale row deleted / [Code] mismatch ignored.
- `FORM-DRAFT-007` 14-day TTL prunes via cron — [DB] expired row removed / [Code] cron job runs, count drops.
- `FORM-DRAFT-008` RLS isolates drafts per user — [DB] user B cannot SELECT user A's row / [Code] policy denial.
- `FORM-DRAFT-009` Payload >256 KB rejected — [UI] error toast with recovery copy / [DB] no row written / [Code] trigger raises exception.
- `FORM-DRAFT-010` Concurrent tabs converge — [UI] both tabs show latest on focus / [DB] last write wins, single row / [Code] UPSERT on conflict.

## Out of scope

- Multiple named drafts per form (only one in-progress draft per surface — Gmail-style).
- Diff/version history for drafts.
- Removing the HMR reload (it prevents a real crash class).

## Files

**New**
- `supabase/migrations/<ts>_form_drafts.sql`
- `supabase/functions/save-form-draft/index.ts`
- `src/hooks/use-server-draft.ts`
- `src/components/forms/DraftRestoredBanner.tsx`
- BDD inserts via `supabase--insert`

**Edit**
- `src/contexts/AuthContext.tsx`, `src/contexts/PageHeaderContext.tsx` (pre-reload event)
- `src/pages/ProjectFormPage.tsx`, `src/pages/ClassFormPage.tsx`, `src/pages/CohortFormPage.tsx`
- `src/components/recruiting/ProjectBlastComposer.tsx`
- `src/pages/BannerManagementPage.tsx`
