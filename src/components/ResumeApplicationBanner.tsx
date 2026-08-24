// Resume application banner — Plan §2G1.
// Surfaces a one-tap path back to a draft general application so members
// don't abandon partial submissions. Hidden when no draft exists or the
// application is already submitted/completed.
//
// Non-intrusive: renders a single tf-card row above the dashboard widgets
// with verb+object CTA ("Resume application"). No new clicks on the happy
// path — only appears when the member has unfinished work.

import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { Button } from "@/design-system";

import { useDashboardOverview } from "@/hooks/use-dashboard-overview";
import { formatDate } from "@/lib/format/date";

const SECTION_LABELS = [
  "Basic info",
  "Profile",
  "Engagement",
  "Agile mindset",
  "Service leadership",
  "Review",
];

export function ResumeApplicationBanner() {
  const { data: overview } = useDashboardOverview();
  const app = overview?.general_application ?? null;

  if (!app || app.status !== "draft") return null;

  const section = Math.max(1, Math.min(app.current_section || 1, SECTION_LABELS.length));
  const sectionLabel = SECTION_LABELS[section - 1];
  let updatedLabel = "";
  try {
    updatedLabel = formatDate(app.updated_at);
  } catch {
    updatedLabel = "";
  }

  return (
    <aside
      className="tf-card flex flex-col sm:flex-row items-start sm:items-center gap-4 p-4 sm:p-5 border-l-4 border-l-primary"
      aria-labelledby="resume-app-heading"
    >
      <div className="flex-1 min-w-0">
        <h2 id="resume-app-heading" className="text-base font-semibold text-foreground">
          Pick up where you left off
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Your general application is saved as a draft on{" "}
          <span className="font-medium text-foreground">{sectionLabel}</span>
          {updatedLabel ? <> · last updated {updatedLabel}</> : null}.
        </p>
      </div>
      <Button asChild className="shrink-0">
        <Link to="/applications/general" aria-label="Resume general application">
          Resume application <ArrowRight className="h-4 w-4 ml-2" aria-hidden="true" />
        </Link>
      </Button>
    </aside>
  );
}
