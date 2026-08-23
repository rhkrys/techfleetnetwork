import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Skeleton } from "@/design-system";

import { usePolicy } from "@/hooks/usePolicy";

interface Props {
  title: string;
  effective?: string;
  contactEmail?: string;
  /** Preferred: policy key in the database (e.g. "terms-and-conditions"). */
  policyKey?: string;
  /** Legacy fallback for callers not yet migrated; fetches markdown from a public URL. */
  markdownUrl?: string;
}

const urlCache = new Map<string, string>();

/**
 * Renders a public policy markdown page. Prefer passing `policyKey` so the
 * content is sourced from `policy_versions` (DB-first, versioned, no redeploy
 * needed to publish updates). `markdownUrl` is a legacy fallback path.
 */
export function PolicyMarkdownView({
  title,
  effective,
  contactEmail,
  policyKey,
  markdownUrl,
}: Props) {
  const policyQuery = usePolicy(policyKey ?? "__none__");
  const usingDb = Boolean(policyKey);

  // Legacy URL fetch path (kept for any remaining callers).
  const [urlMd, setUrlMd] = useState<string>(() =>
    markdownUrl ? (urlCache.get(markdownUrl) ?? "") : ""
  );
  const [urlLoading, setUrlLoading] = useState<boolean>(
    () => !!markdownUrl && !urlCache.has(markdownUrl)
  );
  const [urlError, setUrlError] = useState(false);

  useEffect(() => {
    if (usingDb || !markdownUrl) return;
    if (urlCache.has(markdownUrl)) {
      setUrlMd(urlCache.get(markdownUrl) || "");
      setUrlLoading(false);
      return;
    }
    let aborted = false;
    setUrlLoading(true);
    setUrlError(false);
    fetch(markdownUrl, { credentials: "omit" })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then((text) => {
        if (aborted) return;
        urlCache.set(markdownUrl, text);
        setUrlMd(text);
      })
      .catch(() => {
        if (!aborted) setUrlError(true);
      })
      .finally(() => {
        if (!aborted) setUrlLoading(false);
      });
    return () => {
      aborted = true;
    };
  }, [markdownUrl, usingDb]);

  const md = usingDb ? (policyQuery.data?.body_md ?? "") : urlMd;
  const loading = usingDb ? policyQuery.isLoading : urlLoading;
  const error = usingDb ? !!policyQuery.error : urlError;

  return (
    <div className="container-app py-8 space-y-6">
      <header>
        <h1 className="text-2xl font-bold">{title}</h1>
        {(effective || contactEmail) && (
          <p className="text-sm text-muted-foreground mt-1">
            {effective && <>Effective {effective}</>}
            {effective && contactEmail && <> · </>}
            {contactEmail && (
              <>
                Questions:{" "}
                <a className="underline" href={`mailto:${contactEmail}`}>
                  {contactEmail}
                </a>
              </>
            )}
          </p>
        )}
      </header>
      <section
        aria-labelledby="policy-text"
        className="prose prose-sm dark:prose-invert max-w-none"
      >
        <h2 id="policy-text" className="sr-only">
          {title}
        </h2>
        {loading && (
          <div className="space-y-3" aria-label="Loading policy">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
          </div>
        )}
        {error && !md && (
          <div className="text-sm text-destructive" role="alert">
            We couldn't load this policy right now. Please refresh and try again.
          </div>
        )}
        {md && <ReactMarkdown>{md}</ReactMarkdown>}
      </section>
    </div>
  );
}
