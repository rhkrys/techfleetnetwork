/**
 * ExploreRecommendationCard — individual recommendation card.
 *
 * Security: All text props are rendered via React's JSX text nodes
 * (auto-escaped). Links are validated via isSafeUrl before rendering.
 */

import { memo } from "react";
import { ExternalLink, Globe } from "lucide-react";
import { Badge } from "@/design-system";

import { isSafeUrl } from "@/lib/security";

export interface RecommendationData {
  title: string;
  type: "course" | "template" | "user guide" | "project" | "web";
  description: string;
  reason: string;
  link?: string;
}

const ExploreRecommendationCard = memo(function ExploreRecommendationCard({
  title,
  type,
  description,
  reason,
  link,
}: RecommendationData) {
  const isWeb = type === "web";
  const safeLink = link && isSafeUrl(link) ? link : undefined;

  return (
    <div className="rounded-lg border bg-card text-card-foreground shadow-sm hover:shadow-md transition-shadow duration-200 flex flex-col p-5 gap-3">
      {/* Title + type badge */}
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-lg font-semibold text-foreground leading-snug">{title}</h2>
        <Badge
          variant="outline"
          className="shrink-0 gap-1 text-xs border-primary/40 text-primary capitalize"
        >
          {isWeb && <Globe className="h-3 w-3" />}
          {type}
        </Badge>
      </div>

      {/* Description */}
      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Description
        </p>
        <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
      </div>

      {/* Why we recommend - only for non-web */}
      {!isWeb && reason && (
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            🌟 Why We Recommend
          </p>
          <p className="text-sm text-muted-foreground leading-relaxed">{reason}</p>
        </div>
      )}

      {/* Link — validated for safe protocols */}
      {safeLink && (
        <a
          href={safeLink}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-auto inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline pt-1"
          aria-label={`Open ${title}`}
        >
          <ExternalLink className="h-3.5 w-3.5 shrink-0" />
          {isWeb ? "Visit Source" : "Open Resource"}
        </a>
      )}
    </div>
  );
});

export default ExploreRecommendationCard;
