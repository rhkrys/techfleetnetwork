-- Wave 8: idempotency DB safety nets (Part 1 §1.2 last bullet) + announcement de-dupe (Part 2 §C1).
-- Partial unique indexes that backstop dedupe even if app code misfires.

-- Announcement reads: one row per (user, announcement). Existing dupes get folded.
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id, announcement_id ORDER BY read_at ASC, id ASC) AS rn
  FROM public.announcement_reads
)
DELETE FROM public.announcement_reads ar
USING ranked
WHERE ar.id = ranked.id AND ranked.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS announcement_reads_user_announcement_unique
  ON public.announcement_reads (user_id, announcement_id);

-- Notifications: dedupe by (user_id, notification_type, idempotency_key) when key is set.
-- Pre-clean duplicates first.
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY user_id, notification_type, idempotency_key
    ORDER BY created_at ASC, id ASC
  ) AS rn
  FROM public.notifications
  WHERE idempotency_key IS NOT NULL
)
DELETE FROM public.notifications n
USING ranked
WHERE n.id = ranked.id AND ranked.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS notifications_user_type_idempotency_unique
  ON public.notifications (user_id, notification_type, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Speedy lookup for the in-app digest "collapse >5/kind/10min" rule (Part 2 §F1).
CREATE INDEX IF NOT EXISTS notifications_user_type_created_idx
  ON public.notifications (user_id, notification_type, created_at DESC);