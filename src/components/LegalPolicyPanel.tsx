import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { recordPolicyAcknowledgment } from "@/lib/policies";
import { usePolicy } from "@/hooks/usePolicy";

interface LegalPolicyPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAccepted: () => void;
  loading?: boolean;
  /** Sheet/dialog title, e.g. "Tech Fleet Privacy Policy" */
  title: string;
  /** Short description shown beneath the title */
  description: string;
  /** Preferred: policy key in the database (e.g. "privacy"). */
  policyKey?: string;
  /** Legacy fallback URL for callers not yet migrated. */
  markdownUrl?: string;
  /** In-app route for the full policy page, e.g. "/privacy" */
  downloadUrl: string;
  /** Used for resize key + checkbox id (e.g. "privacy-policy") */
  panelKey: string;
  /** Acknowledgment label (e.g. "Tech Fleet Privacy Policy") */
  acceptLabel: string;
}

const urlCache = new Map<string, string>();

export function LegalPolicyPanel({
  open,
  onOpenChange,
  onAccepted,
  loading,
  title,
  description,
  policyKey,
  markdownUrl,
  downloadUrl,
  panelKey,
  acceptLabel,
}: LegalPolicyPanelProps) {
  const [agreed, setAgreed] = useState(false);
  const usingDb = Boolean(policyKey);
  const policyQuery = usePolicy(policyKey ?? "__none__");

  const [urlContent, setUrlContent] = useState<string>(() =>
    markdownUrl ? urlCache.get(markdownUrl) ?? "" : ""
  );
  const [urlError, setUrlError] = useState(false);
  const [urlFetching, setUrlFetching] = useState(false);

  useEffect(() => {
    if (usingDb || !open || !markdownUrl) return;
    if (urlCache.has(markdownUrl)) {
      setUrlContent(urlCache.get(markdownUrl) || "");
      return;
    }
    let aborted = false;
    setUrlFetching(true);
    setUrlError(false);
    fetch(markdownUrl, { credentials: "omit" })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then((text) => {
        if (aborted) return;
        urlCache.set(markdownUrl, text);
        setUrlContent(text);
      })
      .catch(() => {
        if (!aborted) setUrlError(true);
      })
      .finally(() => {
        if (!aborted) setUrlFetching(false);
      });
    return () => {
      aborted = true;
    };
  }, [open, markdownUrl, usingDb]);

  const content = usingDb ? policyQuery.data?.body_md ?? "" : urlContent;
  const fetching = usingDb ? policyQuery.isLoading : urlFetching;
  const loadError = usingDb ? !!policyQuery.error : urlError;


  const handleAccept = () => {
    if (!agreed) return;
    recordPolicyAcknowledgment("checkbox");
    onAccepted();
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        resizeKey={panelKey}
        className="w-full sm:max-w-2xl flex flex-col p-0"
      >
        <SheetHeader className="px-6 pt-6 pb-4 border-b">
          <SheetTitle className="text-xl">{title}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
          <a
            href={downloadUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-primary-text underline hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm w-fit"
          >
            Open full policy page
          </a>
        </SheetHeader>

        <ScrollArea className="flex-1 px-6 py-4">
          {fetching && !content && (
            <div className="space-y-3" aria-label="Loading policy">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          )}
          {loadError && (
            <div className="text-sm text-destructive" role="alert">
              We couldn't load this policy right now.{" "}
              <a href={downloadUrl} target="_blank" rel="noopener noreferrer" className="underline">
                Open the full policy page
              </a>{" "}
              or try again in a moment.
            </div>
          )}
          {content && (
            <div className="prose prose-sm dark:prose-invert max-w-none prose-headings:text-foreground prose-p:text-muted-foreground prose-li:text-muted-foreground prose-strong:text-foreground prose-a:text-primary">
              <ReactMarkdown>{content}</ReactMarkdown>
            </div>
          )}
        </ScrollArea>

        <div className="border-t px-6 py-4 space-y-4">
          <div className="flex items-start gap-3">
            <Checkbox
              id={`agree-${panelKey}`}
              checked={agreed}
              onCheckedChange={(checked) => setAgreed(checked === true)}
              className="mt-0.5"
              disabled={!content && !loadError}
            />
            <label
              htmlFor={`agree-${panelKey}`}
              className="text-sm text-foreground leading-snug cursor-pointer"
            >
              I have read and agree to the {acceptLabel}.
            </label>
          </div>
          <Button
            onClick={handleAccept}
            disabled={!agreed || loading || (!content && !loadError)}
            className="w-full"
          >
            {loading ? "Saving…" : `Accept ${acceptLabel}`}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
