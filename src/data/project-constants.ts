/** Enums and option lists for the Projects feature */

export const PROJECT_TYPES = [
  { value: "website_design", label: "Website Design" },
  { value: "website", label: "Website" },
  { value: "service_design", label: "Service Design" },
  { value: "application_design", label: "Application Design" },
  { value: "mobile_application", label: "Mobile Application" },
  { value: "web_application", label: "Web Application" },
  { value: "strategy", label: "Strategy" },
  { value: "discovery", label: "Discovery" },
  { value: "marketing", label: "Marketing" },
  { value: "content_management", label: "Content Management" },
  { value: "branding", label: "Branding" },
  { value: "community_operations", label: "Community Operations" },
  { value: "nonprofit_operations", label: "Nonprofit Operations" },
  { value: "program_design", label: "Program Design" },
  { value: "systems_design", label: "Systems Design" },
  { value: "development_and_qa", label: "Development and QA" },
  { value: "data_infrastructure", label: "Data Infrastructure" },
] as const;

export const PROJECT_PHASES = [
  { value: "phase_1", label: "Phase 1" },
  { value: "phase_2", label: "Phase 2" },
  { value: "phase_3", label: "Phase 3" },
  { value: "phase_4", label: "Phase 4" },
] as const;

export const PROJECT_STATUSES = [
  { value: "coming_soon", label: "Coming Soon" },
  { value: "apply_now", label: "Accepting Applications" },
  { value: "recruiting", label: "Recruiting" },
  { value: "team_onboarding", label: "Team Onboarding" },
  { value: "project_in_progress", label: "Project In Progress" },
  { value: "project_complete", label: "Project Complete" },
] as const;

export const TEAM_HATS = [
  "UX Design",
  "UX Research",
  "UX Writing",
  "Project Management",
  "Product Management",
  "Development",
  "Systems Design",
  "Business Analysis",
  "Scrum Master",
  "Account Manager",
  "QA",
] as const;

export const MILESTONE_OPTIONS = [
  "Intake",
  "Discovery",
  "Requirements",
  "Vision",
  "Scope",
  "Experience Design",
  "Development",
  "Acceptance",
] as const;

export const TIMEZONE_RANGES = [
  { value: "EDT +/-5", label: "EDT ±5" },
  { value: "PST +/-5", label: "PST ±5" },
  { value: "UTC +/-5", label: "UTC ±5" },
  { value: "IST +/-5", label: "IST ±5" },
] as const;

export type ProjectTypeValue = (typeof PROJECT_TYPES)[number]["value"];
export type ProjectPhaseValue = (typeof PROJECT_PHASES)[number]["value"];
export type ProjectStatusValue = (typeof PROJECT_STATUSES)[number]["value"];
export type TimezoneRangeValue = (typeof TIMEZONE_RANGES)[number]["value"];
