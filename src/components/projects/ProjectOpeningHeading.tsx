import { cn } from "@/lib/utils";
import type { ElementType } from "react";

/**
 * Heading used everywhere a project opening surfaces:
 *   Line 1 — Client name (organization)
 *   Line 2 — Project friendly name (only if set)
 *
 * Accessibility floor: every text node renders at ≥ 1rem (16px). No `text-xs`,
 * no `text-sm`, no sub-16px arbitrary values anywhere in this component.
 * Visual hierarchy is achieved with weight, color, and tracking — never by
 * shrinking type below the accessibility minimum.
 */
interface ProjectOpeningHeadingProps {
  clientName: string | null | undefined;
  friendlyName: string | null | undefined;
  /** Visual size — controls clientName font size; friendly name auto-scales relative. */
  size?: "md" | "lg" | "xl" | "xl-stacked";
  /** Render the client name as h1, h2, h3, p, or span. Defaults to <p>. */
  as?: "h1" | "h2" | "h3" | "p" | "span" | "div";
  className?: string;
  /** Truncate long names instead of wrapping (cards). */
  truncate?: boolean;
}

const SIZE_CLASSES: Record<NonNullable<ProjectOpeningHeadingProps["size"]>, { client: string; project: string }> = {
  // md/lg both honor the 16px floor; differentiation comes from weight + leading.
  md: { client: "text-base font-semibold", project: "text-base text-muted-foreground" },
  lg: { client: "text-lg font-semibold leading-tight", project: "text-base text-muted-foreground" },
  xl: { client: "text-2xl sm:text-3xl font-bold", project: "text-lg sm:text-xl font-medium" },
  // xl-stacked: 4-tier card identity block — client (h3 24px bold), project name (20px medium muted)
  "xl-stacked": {
    client: "text-2xl font-bold text-foreground leading-tight",
    project: "text-xl font-medium text-muted-foreground leading-snug",
  },
};

export function ProjectOpeningHeading({
  clientName,
  friendlyName,
  size = "md",
  as = "p",
  className,
  truncate = false,
}: ProjectOpeningHeadingProps) {
  const safeClient = clientName?.trim() || "Project Opening";
  const friendly = friendlyName?.trim();
  const cls = SIZE_CLASSES[size];
  const Tag = as as ElementType;
  const stacked = size === "xl-stacked";

  return (
    <div className={cn("min-w-0", stacked ? "space-y-1.5" : null, className)}>
      <Tag className={cn(cls.client, "text-foreground", truncate && "truncate")}>
        {safeClient}
      </Tag>
      {friendly && (
        <p
          className={cn(cls.project, !stacked && "mt-0.5", truncate && "truncate")}
          aria-label={`Project: ${friendly}`}
        >
          {friendly}
        </p>
      )}
    </div>
  );
}
