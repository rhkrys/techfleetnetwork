/**
 * CompletedCoursesPanel
 *
 * Recruiting Center surface that shows admins which Core and Basic (onboarding)
 * courses an applicant has completed and which are still missing. Used in two
 * places:
 *   - Roster grid (variant="compact"): just the count badge; the parent wraps
 *     it in a Popover that re-renders this component with variant="full".
 *   - Applicant review page (variant="full"): inline card with all pills.
 */
import { memo, useMemo } from "react";
import { Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icon";
import type { PrepCatalog, PrepCourseRow } from "@/hooks/use-course-catalog-prep";

interface CompletedCoursesPanelProps {
  completedKeys: Set<string>;
  catalog: PrepCatalog;
  variant?: "full" | "compact";
  headingId?: string;
}

interface GroupProps {
  title: string;
  groupId: string;
  rows: PrepCourseRow[];
  completedKeys: Set<string>;
}

const Group = memo(function Group({ title, groupId, rows, completedKeys }: GroupProps) {
  if (rows.length === 0) return null;
  const completedCount = rows.filter((r) => completedKeys.has(r.course_key)).length;
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <h4
          id={groupId}
          className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
        >
          {title}
        </h4>
        <span className="text-xs tabular-nums text-muted-foreground">
          {completedCount} / {rows.length}
        </span>
      </div>
      <ul role="list" aria-labelledby={groupId} className="flex flex-wrap gap-1.5">
        {rows.map((row) => {
          const done = completedKeys.has(row.course_key);
          return (
            <li key={row.course_key}>
              {done ? (
                <Badge
                  className="gap-1 border-transparent bg-success/15 text-success hover:bg-success/20"
                  aria-label={`${row.display_label} — completed`}
                >
                  <Icon icon={Check} size="micro" />
                  <span>{row.display_label}</span>
                </Badge>
              ) : (
                <Badge
                  variant="outline"
                  className="border-dashed text-muted-foreground"
                  aria-label={`${row.display_label} — not completed`}
                >
                  {row.display_label}
                </Badge>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
});

export const CompletedCoursesPanel = memo(function CompletedCoursesPanel({
  completedKeys,
  catalog,
  variant = "full",
  headingId,
}: CompletedCoursesPanelProps) {
  const { completed, total } = useMemo(() => {
    let n = 0;
    for (const k of catalog.allKeys) if (completedKeys.has(k)) n += 1;
    return { completed: n, total: catalog.total };
  }, [catalog, completedKeys]);

  const fallbackHeadingId = headingId ?? "completed-courses-heading";

  if (catalog.total === 0) {
    return (
      <div className="space-y-2">
        <h3 id={fallbackHeadingId} className="text-base font-semibold">
          Completed courses
        </h3>
        <p className="text-sm text-muted-foreground">No required courses configured yet.</p>
      </div>
    );
  }

  if (variant === "compact") {
    return (
      <span className="inline-flex items-center gap-1 text-sm font-medium tabular-nums">
        <span>{completed}</span>
        <span className="text-muted-foreground">/ {total}</span>
      </span>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 id={fallbackHeadingId} className="text-base font-semibold">
          Completed courses
        </h3>
        <Badge variant="secondary" className="tabular-nums">
          {completed} / {total}
        </Badge>
      </div>
      <div className="space-y-4">
        <Group
          title="Core courses"
          groupId={`${fallbackHeadingId}-core`}
          rows={catalog.core}
          completedKeys={completedKeys}
        />
        <Group
          title="Basic courses"
          groupId={`${fallbackHeadingId}-basic`}
          rows={catalog.onboarding}
          completedKeys={completedKeys}
        />
      </div>
    </div>
  );
});
