/**
 * AnnouncementBanner
 *
 * Renders all published admin banners at the top of the authenticated layout.
 * Dismissals are tracked in the banner_dismissals table.
 * Banners with reopen_after_dismiss=true reappear on next page load.
 *
 * Accessibility: role="status", aria-live, close button with label.
 */

import { useState, useCallback } from "react";
import { X } from "lucide-react";
import { Button } from "@/design-system";

import { useAuth } from "@/contexts/AuthContext";
import { useQuery, useQueryClient } from "@/lib/react-query";
import { sanitizeHtml } from "@/lib/security";
import { linkifyHtml } from "@/lib/linkify";
import { normalizeRichTextHtml } from "@/lib/html";
import { useUgcTranslation } from "@/hooks/useUgcTranslation";
import {
  fetchPublishedBanners,
  fetchDismissedBannerIds,
  dismissBanner,
  type AdminBanner,
} from "@/services/banner.service";

function SingleBanner({
  banner,
  onDismiss,
}: {
  banner: AdminBanner;
  onDismiss: (id: string) => void;
}) {
  const [dismissing, setDismissing] = useState(false);

  const { text: translatedTitle } = useUgcTranslation({
    entityTable: "admin_banners",
    entityId: banner.id,
    columnName: "title",
    sourceText: banner.title,
    contentFormat: "plain",
  });

  const { text: translatedBody } = useUgcTranslation({
    entityTable: "admin_banners",
    entityId: banner.id,
    columnName: "body_html",
    sourceText: banner.body_html || "",
    contentFormat: "html",
  });

  const handleDismiss = useCallback(async () => {
    setDismissing(true);
    await onDismiss(banner.id);
    setDismissing(false);
  }, [banner.id, onDismiss]);

  if (dismissing) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="relative w-full"
      style={{ backgroundColor: "hsl(220, 60%, 15%)", color: "hsl(0, 0%, 100%)" }}
    >
      <div className="mx-auto flex w-full max-w-[1200px] items-start gap-3 px-4 py-3 sm:items-center sm:py-2.5">
        <div className="flex-1 min-w-0 space-y-0.5">
          <p className="text-sm font-semibold leading-snug break-words" data-no-translate>
            {translatedTitle}
          </p>
          <div
            className="text-xs leading-relaxed opacity-90 prose prose-xs prose-invert max-w-none break-words [overflow-wrap:anywhere] [&_a]:text-blue-300 [&_a]:underline [&_*]:max-w-full"
            data-no-translate
            dangerouslySetInnerHTML={{
              __html: sanitizeHtml(linkifyHtml(normalizeRichTextHtml(translatedBody || ""))),
            }}
          />
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={handleDismiss}
          aria-label={`Dismiss ${banner.title}`}
          className="shrink-0 h-7 w-7 rounded-full text-primary-foreground/80 hover:text-primary-foreground hover:bg-primary-foreground/15 focus-visible:ring-primary-foreground"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

export function AnnouncementBanner() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: banners = [] } = useQuery({
    queryKey: ["published-banners"],
    queryFn: fetchPublishedBanners,
    enabled: !!user,
    staleTime: 2 * 60 * 1000,
  });

  const { data: dismissedIds = [], isLoading } = useQuery({
    queryKey: ["banner-dismissals", user?.id],
    queryFn: () => fetchDismissedBannerIds(user!.id),
    enabled: !!user,
    staleTime: Infinity,
  });

  const handleDismiss = useCallback(
    async (bannerId: string) => {
      if (!user) return;
      try {
        await dismissBanner(bannerId, user.id);
        queryClient.setQueryData(["banner-dismissals", user.id], [...dismissedIds, bannerId]);
      } catch {
        /* degrade gracefully */
      }
    },
    [user, dismissedIds, queryClient]
  );

  // CLS guard: while banner data is loading, if the previous session saw a
  // banner, reserve the same vertical space so the page does not jump when
  // the real banner mounts. Stored as a single integer (px) in localStorage.
  const LAST_HEIGHT_KEY = "tf:lastBannerHeight";
  const reservedHeight = (() => {
    if (typeof window === "undefined") return 0;
    const raw = Number(window.localStorage.getItem(LAST_HEIGHT_KEY) || 0);
    return Number.isFinite(raw) && raw > 0 && raw < 200 ? raw : 0;
  })();

  if (!user || isLoading) {
    return reservedHeight > 0 ? (
      <div aria-hidden="true" style={{ height: reservedHeight }} />
    ) : null;
  }

  // Filter: show banners not dismissed, OR banners with reopen_after_dismiss
  const visibleBanners = banners.filter(
    (b) => !dismissedIds.includes(b.id) || b.reopen_after_dismiss
  );

  if (visibleBanners.length === 0) {
    // Persist "no banner" so next load also doesn't reserve space.
    if (typeof window !== "undefined") {
      window.localStorage.setItem(LAST_HEIGHT_KEY, "0");
    }
    return null;
  }

  return (
    <div
      ref={(el) => {
        // Persist measured height so next cold load can reserve the same space.
        if (el && typeof window !== "undefined") {
          window.localStorage.setItem(
            LAST_HEIGHT_KEY,
            String(Math.round(el.getBoundingClientRect().height))
          );
        }
      }}
    >
      {visibleBanners.map((banner) => (
        <SingleBanner key={banner.id} banner={banner} onDismiss={handleDismiss} />
      ))}
    </div>
  );
}
