import { Badge } from "@/design-system";

import { SafeExternalLink } from "@/components/security/SafeExternalLink";
import { TranslatedContent } from "@/components/i18n/TranslatedContent";
import type { ReactNode } from "react";

interface ReadOnlyFieldProps {
  label: string;
  value?: string | null;
  children?: ReactNode;
  /** When supplied with entityId + columnName, the value is translated via the UGC pipeline. */
  entityTable?: string;
  entityId?: string | null;
  columnName?: string;
  contentFormat?: "plain" | "markdown" | "html" | "rich_text";
}

/**
 * Standard read-only field display: label is larger/bolder (text-sm font-semibold),
 * value is smaller (text-xs) and indented (pl-3). Always stacks vertically.
 * If entityTable + entityId + columnName are provided, the value is auto-translated
 * into the viewer's locale (English passes through unchanged).
 */
export function ReadOnlyField({
  label,
  value,
  children,
  entityTable,
  entityId,
  columnName,
  contentFormat = "plain",
}: ReadOnlyFieldProps) {
  if (!children && (!value || !value.trim())) return null;
  const translatable = !children && entityTable && entityId && columnName;
  return (
    <div className="space-y-1">
      <p className="text-sm font-semibold text-foreground">{label}</p>
      {children ??
        (translatable ? (
          <TranslatedContent
            as="p"
            className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed pl-3"
            entityTable={entityTable!}
            entityId={entityId!}
            columnName={columnName!}
            sourceText={value ?? ""}
            contentFormat={contentFormat}
          />
        ) : (
          <p className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed pl-3">
            {value}
          </p>
        ))}
    </div>
  );
}

interface ReadOnlyLinkFieldProps {
  label: string;
  href: string;
  linkText?: string;
}

export function ReadOnlyLinkField({ label, href, linkText }: ReadOnlyLinkFieldProps) {
  if (!href) return null;
  return (
    <div className="space-y-1">
      <p className="text-sm font-semibold text-foreground">{label}</p>
      <SafeExternalLink
        href={href}
        fallback={<p className="text-xs text-muted-foreground pl-3">Unavailable</p>}
        className="text-xs text-primary hover:underline pl-3"
      >
        {linkText ?? href}
      </SafeExternalLink>
    </div>
  );
}

interface ReadOnlyArrayFieldProps {
  label: string;
  items: string[];
}

export function ReadOnlyArrayField({ label, items }: ReadOnlyArrayFieldProps) {
  if (!items || items.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-semibold text-foreground">{label}</p>
      <div className="flex flex-wrap gap-1.5 pl-3">
        {items.map((item) => (
          <Badge key={item} variant="outline" className="text-xs">
            {item}
          </Badge>
        ))}
      </div>
    </div>
  );
}
