import { useState } from "react";
import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export interface ColumnDef {
  key: string;
  label: string;
  group: "core" | "general_app" | "project_app" | "profile";
}

const GROUP_LABELS: Record<string, string> = {
  core: "Core",
  profile: "Profile",
  general_app: "General Application",
  project_app: "Project Application",
};

export const ALL_COLUMNS: ColumnDef[] = [
  // Core
  { key: "applicant", label: "Applicant", group: "core" },
  { key: "email", label: "Email", group: "core" },
  { key: "client", label: "Client", group: "core" },
  { key: "project_friendly", label: "Project", group: "core" },
  { key: "project_type", label: "Project Type", group: "core" },
  { key: "phase", label: "Phase", group: "core" },
  { key: "project_status", label: "Project Status", group: "core" },
  { key: "previous_participant", label: "Previous Participant?", group: "core" },
  { key: "core_courses_completed", label: "Core Courses", group: "core" },
  { key: "other_active_apps", label: "Active Apps", group: "core" },
  { key: "date_submitted", label: "Date Submitted", group: "core" },
  { key: "team_hats_interest", label: "Team Hats Interest", group: "core" },

  // Profile
  { key: "p_country", label: "Country", group: "profile" },
  { key: "p_timezone", label: "Timezone", group: "profile" },
  { key: "p_discord", label: "Discord Username", group: "profile" },
  { key: "p_linkedin", label: "LinkedIn URL", group: "profile" },
  { key: "p_portfolio", label: "Portfolio URL", group: "profile" },
  { key: "p_experience_areas", label: "Experience Areas", group: "profile" },
  { key: "p_education", label: "Education Background", group: "profile" },
  { key: "p_goals", label: "Professional Goals", group: "profile" },
  { key: "p_background", label: "Professional Background", group: "profile" },
  { key: "p_bio", label: "Bio", group: "profile" },
  { key: "p_interests", label: "Interests", group: "profile" },

  // General Application
  
  { key: "ga_hours_commitment", label: "Hours Commitment", group: "general_app" },
  { key: "ga_previous_engagement", label: "Previous Engagement", group: "general_app" },
  { key: "ga_previous_engagement_ways", label: "Previous Engagement Ways", group: "general_app" },
  { key: "ga_teammate_learnings", label: "Teammate Learnings", group: "general_app" },
  { key: "ga_agile_vs_waterfall", label: "Agile vs Waterfall", group: "general_app" },
  { key: "ga_psychological_safety", label: "Psychological Safety", group: "general_app" },
  { key: "ga_agile_philosophies", label: "Agile Philosophies", group: "general_app" },
  { key: "ga_collaboration_challenges", label: "Collaboration Challenges", group: "general_app" },
  { key: "ga_servant_leadership_definition", label: "Service Leadership Definition", group: "general_app" },
  { key: "ga_servant_leadership_actions", label: "Service Leadership Actions", group: "general_app" },
  { key: "ga_servant_leadership_challenges", label: "Service Leadership Challenges", group: "general_app" },
  { key: "ga_servant_leadership_situation", label: "Service Leadership Situation", group: "general_app" },
  { key: "ga_status", label: "General App Status", group: "general_app" },
  { key: "ga_completed_at", label: "General App Completed Date", group: "general_app" },

  // Project Application
  { key: "pa_passion_for_project", label: "Passion for Project", group: "project_app" },
  { key: "pa_client_project_knowledge", label: "Client/Project Knowledge", group: "project_app" },
  { key: "pa_cross_functional_contribution", label: "Cross-Functional Contribution", group: "project_app" },
  { key: "pa_project_success_contribution", label: "Project Success Contribution", group: "project_app" },
  { key: "pa_prior_engagement_preparation", label: "Prior Engagement Preparation", group: "project_app" },
  { key: "pa_previous_phase_position", label: "Previous Phase Position", group: "project_app" },
  { key: "pa_previous_phase_learnings", label: "Previous Phase Learnings", group: "project_app" },
  { key: "pa_previous_phase_help", label: "Previous Phase Help Teammates", group: "project_app" },
];

export const DEFAULT_VISIBLE_KEYS = [
  "applicant",
  "client",
  "project_friendly",
  "project_type",
  "phase",
  "project_status",
  "previous_participant",
  "core_courses_completed",
  "other_active_apps",
  "date_submitted",
];

interface Props {
  visibleKeys: string[];
  onChange: (keys: string[]) => void;
}

export function AllApplicationsColumnPicker({ visibleKeys, onChange }: Props) {
  const [open, setOpen] = useState(false);

  const toggle = (key: string) => {
    onChange(
      visibleKeys.includes(key)
        ? visibleKeys.filter((k) => k !== key)
        : [...visibleKeys, key]
    );
  };

  const selectAll = () => onChange(ALL_COLUMNS.map((c) => c.key));
  const resetDefaults = () => onChange([...DEFAULT_VISIBLE_KEYS]);

  const groups = ["core", "profile", "general_app", "project_app"] as const;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5 h-9">
          <Settings2 className="h-4 w-4" />
          Columns ({visibleKeys.length})
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <div className="p-3 border-b flex items-center justify-between">
          <p className="text-sm font-medium">Visible Columns</p>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" className="text-xs h-7" onClick={selectAll}>All</Button>
            <Button variant="ghost" size="sm" className="text-xs h-7" onClick={resetDefaults}>Reset</Button>
          </div>
        </div>
        <ScrollArea className="h-80 p-3">
          {groups.map((group) => {
            const cols = ALL_COLUMNS.filter((c) => c.group === group);
            return (
              <div key={group} className="mb-4 last:mb-0">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  {GROUP_LABELS[group]}
                </p>
                <div className="space-y-1.5">
                  {cols.map((col) => (
                    <div key={col.key} className="flex items-center gap-2">
                      <Checkbox
                        id={`col-${col.key}`}
                        checked={visibleKeys.includes(col.key)}
                        onCheckedChange={() => toggle(col.key)}
                      />
                      <Label htmlFor={`col-${col.key}`} className="text-sm font-normal cursor-pointer">
                        {col.label}
                      </Label>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
