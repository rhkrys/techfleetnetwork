import { ExternalLink, Video } from "lucide-react";
import { Button } from "@/design-system";

import type { ClassModuleItem } from "../types";

interface Props {
  item: Pick<ClassModuleItem, "title" | "video_url" | "video_embed_url" | "video_provider">;
}

/**
 * Renders a sandboxed iframe for providers we trust (YouTube, Vimeo, Loom),
 * or a "Join meeting" CTA for Google Meet links which cannot be iframed.
 */
export function ClassModuleVideoEmbed({ item }: Props) {
  if (!item.video_url) return null;

  if (item.video_provider === "google_meet") {
    return (
      <div className="rounded-md border border-border bg-muted/30 p-4 flex items-center gap-3">
        <Video className="h-5 w-5 text-primary" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <div className="font-medium text-foreground truncate">Google Meet session</div>
          <div className="text-xs text-muted-foreground truncate">{item.video_url}</div>
        </div>
        <Button asChild size="sm">
          <a href={item.video_url} target="_blank" rel="noopener noreferrer">
            Join meeting <ExternalLink className="h-3 w-3 ml-1" aria-hidden="true" />
          </a>
        </Button>
      </div>
    );
  }

  if (
    item.video_embed_url &&
    (item.video_provider === "youtube" ||
      item.video_provider === "vimeo" ||
      item.video_provider === "loom")
  ) {
    return (
      <div
        className="relative w-full overflow-hidden rounded-md border border-border bg-black"
        style={{ aspectRatio: "16 / 9" }}
      >
        <iframe
          src={item.video_embed_url}
          title={`Video for ${item.title}`}
          className="absolute inset-0 h-full w-full"
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
        />
      </div>
    );
  }

  // Fallback: untrusted provider — show link only.
  return (
    <a
      href={item.video_url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-sm text-primary underline-offset-2 hover:underline"
    >
      Open video <ExternalLink className="h-3 w-3" aria-hidden="true" />
    </a>
  );
}
