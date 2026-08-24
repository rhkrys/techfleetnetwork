import { memo } from "react";
import { CheckCircle2, Clock, Trophy } from "lucide-react";
import { Badge } from "@/design-system";

interface Props {
  status: string;
  applicantStatus?: string;
}

/**
 * Shared badge component for application statuses.
 * Used on the dashboard, application list, and status pages.
 */
export const ApplicationStatusBadge = memo(function ApplicationStatusBadge({
  status,
  applicantStatus,
}: Props) {
  if (status === "draft") {
    return (
      <Badge
        variant="outline"
        className="bg-warning/10 text-warning border-warning/20 text-xs flex-shrink-0 gap-1"
      >
        <Clock className="h-3 w-3" />
        In Progress
      </Badge>
    );
  }

  if (status !== "completed") return null;

  switch (applicantStatus) {
    case "invited_to_interview":
    case "interview_scheduled":
      return (
        <Badge
          variant="outline"
          className="bg-primary/10 text-primary border-primary/20 text-xs flex-shrink-0 gap-1"
        >
          🎉 Interview
        </Badge>
      );
    case "not_selected":
      return (
        <Badge
          variant="outline"
          className="bg-destructive/10 text-destructive border-destructive/20 text-xs flex-shrink-0 gap-1"
        >
          Not Selected
        </Badge>
      );
    case "active_participant":
      return (
        <Badge
          variant="outline"
          className="bg-success/10 text-success border-success/20 text-xs flex-shrink-0 gap-1"
        >
          <Trophy className="h-3 w-3" />
          Active Teammate
        </Badge>
      );
    case "left_the_project":
      return (
        <Badge
          variant="outline"
          className="bg-muted text-muted-foreground border-border text-xs flex-shrink-0 gap-1"
        >
          Left Project
        </Badge>
      );
    default:
      return (
        <Badge
          variant="outline"
          className="bg-success/10 text-success border-success/20 text-xs flex-shrink-0 gap-1"
        >
          <CheckCircle2 className="h-3 w-3" />
          Submitted
        </Badge>
      );
  }
});
