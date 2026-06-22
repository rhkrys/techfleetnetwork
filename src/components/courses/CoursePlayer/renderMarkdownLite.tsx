/**
 * Pure renderer for the lightweight markdown variant used across course pages
 * (paragraphs, **bold**, bullet lists, numbered lists). Extracted from
 * GenericCoursePage so the class-curriculum learner view and future surfaces
 * can render identical content without re-implementing the rules.
 */
import type { ReactNode } from "react";

export function renderMarkdownLite(content: string): ReactNode[] {
  return content.split("\n\n").map((paragraph, i) => {
    if (paragraph.startsWith("**") && paragraph.endsWith("**")) {
      return (
        <h3 key={i} className="text-sm font-bold text-foreground mt-4 first:mt-0">
          {paragraph.slice(2, -2)}
        </h3>
      );
    }
    if (paragraph.includes("\n•") || paragraph.startsWith("•")) {
      const items = paragraph.split("\n").filter((l) => l.startsWith("•"));
      return (
        <ul key={i} className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
          {items.map((item, j) => (
            <li key={j}>{item.slice(2)}</li>
          ))}
        </ul>
      );
    }
    if (/^\d+\./.test(paragraph.trim())) {
      const items = paragraph.split("\n").filter((l) => /^\d+\./.test(l.trim()));
      return (
        <ol key={i} className="list-decimal list-inside space-y-1 text-sm text-muted-foreground">
          {items.map((item, j) => (
            <li key={j}>{item.replace(/^\d+\.\s*/, "")}</li>
          ))}
        </ol>
      );
    }
    const parts = paragraph.split(/(\*\*[^*]+\*\*)/g);
    return (
      <p key={i} className="text-sm text-muted-foreground leading-relaxed">
        {parts.map((part, j) =>
          part.startsWith("**") && part.endsWith("**") ? (
            <strong key={j} className="text-foreground font-semibold">
              {part.slice(2, -2)}
            </strong>
          ) : (
            part
          )
        )}
      </p>
    );
  });
}
