/**
 * Render a translated user-generated content field with a "Translating…" badge
 * during the brief window before the cache fills.
 *
 * Usage:
 *   <TranslatedContent
 *     entityTable="projects" entityId={project.id}
 *     columnName="description" sourceText={project.description}
 *   />
 */
import { useMemo, type ElementType } from "react";
import { useUgcTranslation } from "@/hooks/useUgcTranslation";
import { sanitizeHtml } from "@/lib/security";
import { Loader2 } from "lucide-react";

interface Props {
  entityTable: string;
  entityId: string | null | undefined;
  columnName: string;
  sourceText: string | null | undefined;
  contentFormat?: "plain" | "markdown" | "html" | "rich_text";
  as?: keyof JSX.IntrinsicElements;
  className?: string;
}

export function TranslatedContent({
  entityTable, entityId, columnName, sourceText, contentFormat = "plain",
  as: Tag = "span", className,
}: Props) {
  const { text, isTranslating } = useUgcTranslation({ entityTable, entityId, columnName, sourceText, contentFormat });
  const TagAny = Tag as ElementType;
  // Wave 1 SEC-W1-004: sanitize before innerHTML to close the only DOM-insertion
  // site that bypassed DOMPurify.
  const safeHtml = useMemo(
    () => (contentFormat === "html" ? sanitizeHtml(text ?? "") : ""),
    [contentFormat, text],
  );
  return (
    <TagAny className={className} data-no-translate>
      {contentFormat === "html"
        ? <span dangerouslySetInnerHTML={{ __html: safeHtml }} />
        : text}
      {isTranslating && (
        <span className="ml-2 inline-flex items-center gap-1 text-xs text-muted-foreground align-middle">
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
          <span>Translating…</span>
        </span>
      )}
    </TagAny>
  );
}
