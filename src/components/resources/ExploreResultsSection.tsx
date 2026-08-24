/**
 * ExploreResultsSection — renders AI recommendations and web search results.
 *
 * Memoised to prevent re-renders when parent state changes unrelated to results.
 * URL safety is enforced at the card level via isSafeUrl.
 */

import { memo, useMemo } from "react";
import { Sparkles, Globe, RotateCcw } from "lucide-react";
import { Badge, Button } from "@/design-system";

import ExploreRecommendationCard, { type RecommendationData } from "./ExploreRecommendationCard";
import { sanitizeText } from "@/lib/security";

export interface WebSearchResult {
  title: string;
  description: string;
  url: string;
}

interface ExploreResultsSectionProps {
  query: string;
  recommendations: RecommendationData[];
  webResults?: WebSearchResult[];
  onReset?: () => void;
}

const ExploreResultsSection = memo(function ExploreResultsSection({
  query,
  recommendations,
  webResults = [],
  onReset,
}: ExploreResultsSectionProps) {
  const hasRecs = recommendations.length > 0;
  const hasWeb = webResults.length > 0;

  // Convert web results to card format with sanitisation
  const onlineCards: RecommendationData[] = useMemo(
    () =>
      webResults.slice(0, 3).map((r) => ({
        title: sanitizeText(r.title || "Untitled"),
        type: "web" as const,
        description: sanitizeText(r.description || "External resource found via web search."),
        reason: "",
        link: r.url,
      })),
    [webResults]
  );

  // Sort recommendations alphabetically (stable)
  const sortedRecs = useMemo(
    () => [...recommendations].sort((a, b) => a.title.localeCompare(b.title)),
    [recommendations]
  );

  const totalCount = recommendations.length + onlineCards.length;

  if (!hasRecs && !hasWeb) return null;

  return (
    <section className="space-y-6" aria-label="Recommended resources">
      {/* Search context banner */}
      <div className="rounded-lg bg-primary/5 border border-primary/15 px-5 py-4 space-y-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <Sparkles className="h-5 w-5 text-primary shrink-0" />
          <h2 className="text-base font-semibold text-foreground">Results for:</h2>
        </div>
        <p className="text-lg font-medium text-foreground leading-snug">&ldquo;{query}&rdquo;</p>
        <p className="text-sm text-muted-foreground">
          {totalCount} {totalCount === 1 ? "resource" : "resources"} found — here are the most
          relevant picks for you.
        </p>
        {onReset && (
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 mt-2"
            onClick={onReset}
            aria-label="Reset search"
          >
            <RotateCcw className="h-4 w-4" />
            Reset
          </Button>
        )}
      </div>

      {/* Tech Fleet recommendations */}
      {hasRecs && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {sortedRecs.map((rec, idx) => (
            <ExploreRecommendationCard key={`${rec.title}-${idx}`} {...rec} />
          ))}
        </div>
      )}

      {/* Online search results */}
      {hasWeb && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">From the Web</h3>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {onlineCards.map((card, idx) => (
              <ExploreRecommendationCard key={`web-${idx}`} {...card} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
});

export default ExploreResultsSection;
