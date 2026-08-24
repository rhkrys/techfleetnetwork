/**
 * Pure presentational YouTube embed with cross-session position memory + telemetry.
 * Extracted from GenericCoursePage so the class-curriculum learner view and
 * future course surfaces can reuse the same player without duplicating the
 * iframe-API state machine.
 */
import { useEffect, useRef } from "react";
import { AspectRatio } from "@/design-system";

import { recordLessonVideoEvent } from "@/lib/telemetry/lesson-video";

type YouTubePlayerState = -1 | 0 | 1 | 2 | 3 | 5;

type YouTubePlayer = {
  getCurrentTime: () => number;
  getPlayerState: () => YouTubePlayerState;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  playVideo: () => void;
  destroy: () => void;
};

declare global {
  interface Window {
    YT?: {
      Player: new (
        element: HTMLIFrameElement,
        options: {
          events: {
            onReady: () => void;
            onStateChange: (event: { data: YouTubePlayerState }) => void;
          };
        }
      ) => YouTubePlayer;
      PlayerState?: { PLAYING: 1; PAUSED: 2 };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

const youtubeApiReady = (() => {
  let promise: Promise<void> | null = null;
  return () => {
    if (window.YT?.Player) return Promise.resolve();
    if (!promise) {
      promise = new Promise<void>((resolve) => {
        const previousReady = window.onYouTubeIframeAPIReady;
        window.onYouTubeIframeAPIReady = () => {
          previousReady?.();
          resolve();
        };
        if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
          const script = document.createElement("script");
          script.src = "https://www.youtube.com/iframe_api";
          script.async = true;
          document.head.appendChild(script);
        }
      });
    }
    return promise;
  };
})();

export interface CourseVideoEmbedProps {
  youtubeId: string;
  title: string;
  lessonId: string;
}

export function CourseVideoEmbed({ youtubeId, title, lessonId }: CourseVideoEmbedProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YouTubePlayer | null>(null);
  const lastTimeRef = useRef(0);
  const wasPlayingRef = useRef(false);
  const lastSeekLogRef = useRef(0);
  const storageKey = `course-video-position:${youtubeId}`;

  useEffect(() => {
    let cancelled = false;
    let restoreTimer: number | undefined;

    void recordLessonVideoEvent({ lessonId, youtubeId, lessonTitle: title, event: "opened" });

    const setPlaybackAttr = (state: "playing" | "paused" | "ended" | "buffering" | "idle") => {
      wrapperRef.current?.setAttribute("data-playback-state", state);
    };
    setPlaybackAttr("idle");

    const rememberPosition = () => {
      const player = playerRef.current;
      if (!player) return;
      try {
        const currentTime = player.getCurrentTime();
        const playerState = player.getPlayerState();
        if (Number.isFinite(currentTime) && currentTime > 0) {
          lastTimeRef.current = currentTime;
          sessionStorage.setItem(storageKey, String(currentTime));
        }
        wasPlayingRef.current = playerState === 1;
      } catch {
        /* iframe reflow: ignore */
      }
    };

    const restorePosition = () => {
      const player = playerRef.current;
      if (!player) return;
      const saved = Number(sessionStorage.getItem(storageKey) ?? lastTimeRef.current);
      if (!Number.isFinite(saved) || saved <= 0) return;
      try {
        player.seekTo(saved, true);
        if (wasPlayingRef.current) player.playVideo();
      } catch {
        /* retry on next tick */
      }
    };

    const handleResize = () => {
      rememberPosition();
      window.clearTimeout(restoreTimer);
      restoreTimer = window.setTimeout(restorePosition, 300);
    };

    youtubeApiReady().then(() => {
      if (cancelled || !iframeRef.current || !window.YT?.Player) return;
      playerRef.current = new window.YT.Player(iframeRef.current, {
        events: {
          onReady: restorePosition,
          onStateChange: ({ data }) => {
            const player = playerRef.current;
            const pos = (() => {
              try {
                return player?.getCurrentTime() ?? undefined;
              } catch {
                return undefined;
              }
            })();
            if (data === 1) {
              setPlaybackAttr("playing");
              rememberPosition();
              const now = Date.now();
              if (
                pos !== undefined &&
                Math.abs(pos - lastTimeRef.current) > 2 &&
                now - lastSeekLogRef.current > 1000
              ) {
                lastSeekLogRef.current = now;
                void recordLessonVideoEvent({
                  lessonId,
                  youtubeId,
                  lessonTitle: title,
                  event: "seek",
                  positionSeconds: pos,
                });
              }
              void recordLessonVideoEvent({
                lessonId,
                youtubeId,
                lessonTitle: title,
                event: "play",
                positionSeconds: pos,
              });
            } else if (data === 2) {
              setPlaybackAttr("paused");
              rememberPosition();
              void recordLessonVideoEvent({
                lessonId,
                youtubeId,
                lessonTitle: title,
                event: "pause",
                positionSeconds: pos,
              });
            } else if (data === 0) {
              setPlaybackAttr("ended");
              void recordLessonVideoEvent({
                lessonId,
                youtubeId,
                lessonTitle: title,
                event: "ended",
                positionSeconds: pos,
              });
            } else if (data === 3) {
              setPlaybackAttr("buffering");
            }
          },
        },
      });
    });

    const interval = window.setInterval(rememberPosition, 1000);
    window.addEventListener("resize", handleResize, { passive: true });
    window.addEventListener("orientationchange", handleResize, { passive: true });

    return () => {
      cancelled = true;
      rememberPosition();
      const pos = lastTimeRef.current || undefined;
      void recordLessonVideoEvent({
        lessonId,
        youtubeId,
        lessonTitle: title,
        event: "closed",
        positionSeconds: pos,
      });
      window.clearInterval(interval);
      window.clearTimeout(restoreTimer);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("orientationchange", handleResize);
      playerRef.current?.destroy();
      playerRef.current = null;
    };
  }, [storageKey, lessonId, youtubeId, title]);

  return (
    <AspectRatio ratio={16 / 9}>
      <div
        ref={wrapperRef}
        className="relative w-full h-full bg-black"
        data-lesson-id={lessonId}
        data-youtube-id={youtubeId}
        data-lesson-title={title}
        data-playback-state="idle"
      >
        <div
          aria-hidden="true"
          className="absolute inset-0 pointer-events-none flex items-end justify-start"
          style={{
            backgroundImage: `url("https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg")`,
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        >
          <div className="w-full bg-gradient-to-t from-black/80 to-transparent px-4 py-3 text-white">
            <p className="text-xs uppercase tracking-wide opacity-80">Course video</p>
            <p className="text-sm font-medium line-clamp-2">{title}</p>
          </div>
        </div>
        <iframe
          ref={iframeRef}
          src={`https://www.youtube.com/embed/${youtubeId}?enablejsapi=1&playsinline=1&rel=0&modestbranding=1&origin=${encodeURIComponent(window.location.origin)}`}
          title={title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
          allowFullScreen
          className="absolute inset-0 w-full h-full border-0"
        />
      </div>
    </AspectRatio>
  );
}

export default CourseVideoEmbed;
