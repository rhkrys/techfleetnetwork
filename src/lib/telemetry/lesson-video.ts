import { supabase } from "@/integrations/supabase/client";
import { getUserSafe } from "@/lib/auth/session-port";

export type LessonVideoEvent =
  | "opened"
  | "play"
  | "pause"
  | "ended"
  | "seek"
  | "closed";

export interface LessonVideoEventInput {
  lessonId: string;
  youtubeId: string;
  event: LessonVideoEvent;
  lessonTitle?: string;
  positionSeconds?: number;
  courseSlug?: string;
}

/**
 * Append-only telemetry for course video playback so admins can verify what
 * a member watched even when session-replay tools can't capture the
 * cross-origin YouTube iframe. Fire-and-forget; never throws.
 */
export async function recordLessonVideoEvent(input: LessonVideoEventInput): Promise<void> {
  try {
    const user = await getUserSafe();
    if (!user) return;

    const courseSlug = input.courseSlug ?? deriveCourseSlug();

    await supabase.from("lesson_video_events").insert({
      user_id: user.id,
      course_slug: courseSlug,
      lesson_id: input.lessonId,
      lesson_title: input.lessonTitle ?? null,
      youtube_id: input.youtubeId,
      event: input.event,
      position_seconds: Number.isFinite(input.positionSeconds ?? NaN)
        ? Math.round((input.positionSeconds as number) * 100) / 100
        : null,
      client_ts: new Date().toISOString(),
    });
  } catch {
    // Telemetry must never break playback.
  }
}

function deriveCourseSlug(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const parts = window.location.pathname.split("/").filter(Boolean);
  return parts[parts.length - 1] || parts[parts.length - 2];
}
