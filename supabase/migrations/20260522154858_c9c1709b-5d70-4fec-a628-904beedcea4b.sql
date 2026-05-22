
CREATE TABLE IF NOT EXISTS public.lesson_video_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  course_slug text,
  lesson_id text NOT NULL,
  lesson_title text,
  youtube_id text NOT NULL,
  event text NOT NULL CHECK (event IN ('opened','play','pause','ended','seek','closed')),
  position_seconds numeric,
  client_ts timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lesson_video_events_user_created_idx
  ON public.lesson_video_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS lesson_video_events_lesson_idx
  ON public.lesson_video_events (lesson_id, created_at DESC);

ALTER TABLE public.lesson_video_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lve self insert"
  ON public.lesson_video_events FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "lve self or admin read"
  ON public.lesson_video_events FOR SELECT
  USING (user_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role));
