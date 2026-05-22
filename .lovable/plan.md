## Why this happens (root cause)

Course videos are embedded as YouTube iframes (`https://www.youtube.com/embed/{id}`) in `src/components/GenericCoursePage.tsx`. Session replays are produced by an **rrweb-style DOM recorder** (Lovable's replay tool). rrweb records DOM mutations in *your* origin only — it **cannot record the contents of cross-origin iframes** (YouTube, Vimeo, Loom). The browser's same-origin policy blocks it. So during playback the replay just shows an empty rectangle where the player should be. This is not a bug in our code and there is no setting that makes YouTube's pixels appear in a replay — but we can give admins a recognizable picture of what the member was watching, plus a precise log.

## Fix in two layers

### 1. Replay-visible YouTube backplate (UI)

Wrap the `<iframe>` in `CourseVideoEmbed` with a poster image we own, so rrweb captures something meaningful even when the iframe is opaque:

- Render `<img src="https://i.ytimg.com/vi/{youtubeId}/hqdefault.jpg">` absolutely positioned behind the iframe, with the lesson title overlaid.
- Add `data-lesson-id`, `data-youtube-id`, `data-lesson-title` attributes on the wrapper so the replay DOM clearly shows which video and which lesson.
- Add a small "playing" / "paused" badge on the wrapper that toggles a `data-playback-state` attribute on YT `onStateChange`. rrweb captures attribute mutations, so the replay will show the badge flipping between Playing / Paused / Ended in sync with what the member actually did.
- Keep the iframe interactive on top; the backplate is purely decorative and only visible in replays where the iframe is blank.

### 2. Structured playback telemetry (Code + DB)

Add a lightweight, append-only log so admins can verify what was watched without relying on the replay tool:

- New table `public.lesson_video_events` (`id`, `user_id`, `course_slug`, `lesson_id`, `youtube_id`, `event` ∈ {`opened`,`play`,`pause`,`ended`,`seek`}, `position_seconds`, `client_ts`, `created_at`).
- RLS: members can insert their own rows; admins (and the member themselves) can read.
- Wire `CourseVideoEmbed` to call a thin `recordLessonVideoEvent()` helper from existing `onStateChange` + on mount/unmount. Debounce `seek` (no more than 1/sec). Use `keepalive: true` fetch so it survives navigation.
- Surface the recent events for a member in the existing admin profile view (small "Recent video activity" card) — out of scope to ship a new page.

### Out of scope (will not change)

- Switching providers (Vimeo / self-hosted) — fixes the replay issue but is a bigger product call. Mentioning so you know it exists.
- Recording YouTube playback pixels — impossible from a third-party site.

## Files

- `src/components/GenericCoursePage.tsx` — refactor `CourseVideoEmbed` to add backplate + telemetry hooks.
- `src/lib/telemetry/lesson-video.ts` (new) — `recordLessonVideoEvent()` helper.
- `supabase/migrations/<ts>_lesson_video_events.sql` (new) — table + RLS + indexes.
- `src/components/admin/MemberVideoActivityCard.tsx` (new) — admin-visible recent events for a member.
- BDD scenarios `LV-001…005` in `bdd_scenarios` covering: backplate renders, attribute flips on play/pause, opened event inserted on mount, RLS blocks cross-member reads, admin can read all.

## Verification

- Open a lesson in the preview, play/pause/seek, then watch the session replay: you should see the lesson title + YouTube thumbnail + Playing/Paused badge moving — and a matching event trail in `lesson_video_events`.
