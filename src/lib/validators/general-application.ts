/**
 * Validation rules for the General Application form.
 * Extracted for testability and reuse across components.
 *
 * OWASP A3: All free-text fields enforce max length to prevent
 * oversized payloads and potential ReDoS/injection vectors.
 */

/** Max length for short text fields */
const MAX_SHORT = 500;
/** Max length for long-form text fields */
const MAX_LONG = 5000;

export interface AppFormData {
  // Section 1
  hours_commitment: string;
  portfolio_url: string;
  linkedin_url: string;
  // Section 2 (profile fields)
  country: string;
  timezone: string;
  discord_username: string;
  has_discord_account: boolean;
  experience_areas: string[];
  professional_goals: string;
  notify_training_opportunities: boolean;
  notify_announcements: boolean;
  education_background: string[];
  interests: string[];
  scheduling_url: string;
  // Section 3
  previous_engagement: string;
  previous_engagement_ways: string[];
  teammate_learnings: string;
  // Section 4
  agile_vs_waterfall: string;
  psychological_safety: string;
  agile_philosophies: string;
  collaboration_challenges: string;
  // Section 5
  service_leadership_definition: string;
  service_leadership_actions: string;
  service_leadership_challenges: string;
  service_leadership_situation: string;
}

export const EMPTY_FORM: AppFormData = {
  hours_commitment: "",
  portfolio_url: "",
  linkedin_url: "",
  country: "",
  timezone: "",
  discord_username: "",
  has_discord_account: true,
  experience_areas: [],
  professional_goals: "",
  notify_training_opportunities: false,
  notify_announcements: false,
  education_background: [],
  interests: [],
  scheduling_url: "",
  previous_engagement: "",
  previous_engagement_ways: [],
  teammate_learnings: "",
  agile_vs_waterfall: "",
  psychological_safety: "",
  agile_philosophies: "",
  collaboration_challenges: "",
  service_leadership_definition: "",
  service_leadership_actions: "",
  service_leadership_challenges: "",
  service_leadership_situation: "",
};

export const TOTAL_SECTIONS = 6;

export const SECTION_TITLES = [
  "Intro",
  "Profile",
  "Engagement",
  "Agile",
  "Service Leadership",
  "Review",
];

/** Length limits for each text field — used in validation and UI */
export const FIELD_MAX_LENGTHS: Partial<Record<keyof AppFormData, number>> = {
  hours_commitment: MAX_SHORT,
  portfolio_url: MAX_SHORT,
  linkedin_url: MAX_SHORT,
  scheduling_url: MAX_SHORT,
  professional_goals: MAX_LONG,
  teammate_learnings: MAX_LONG,
  agile_vs_waterfall: MAX_LONG,
  psychological_safety: MAX_LONG,
  agile_philosophies: MAX_LONG,
  collaboration_challenges: MAX_LONG,
  service_leadership_definition: MAX_LONG,
  service_leadership_actions: MAX_LONG,
  service_leadership_challenges: MAX_LONG,
  service_leadership_situation: MAX_LONG,
};

/** Validate a specific section's required fields — returns a map of field → error message */
export function getFieldErrors(form: AppFormData, section: number): Record<string, string> {
  const fieldErrors: Record<string, string> = {};

  // Check length limits for all text fields in the form
  for (const [key, maxLen] of Object.entries(FIELD_MAX_LENGTHS)) {
    const value = form[key as keyof AppFormData];
    if (typeof value === "string" && value.length > maxLen) {
      fieldErrors[key] = `Must be under ${maxLen} characters (currently ${value.length})`;
    }
  }

  if (section === 1) {
    if (!form.hours_commitment) fieldErrors.hours_commitment = "Please select an option";
  }
  if (section === 2) {
    if (!form.country.trim()) fieldErrors.country = "Country is required";
    if (!form.timezone.trim()) fieldErrors.timezone = "Timezone is required";
    if (form.experience_areas.length === 0) fieldErrors.experience_areas = "Please select at least one area or 'I'm not sure yet'";
    if (!form.professional_goals.trim()) fieldErrors.professional_goals = "Professional goals are required";
    if (form.education_background.length === 0) fieldErrors.education_background = "Please select at least one option";
  }
  if (section === 3) {
    if (!form.previous_engagement) fieldErrors.previous_engagement = "Please select an option";
    if (form.previous_engagement === "yes" && form.previous_engagement_ways.length === 0) {
      fieldErrors.previous_engagement_ways = "Please select at least one engagement type";
    }
  }
  if (section === 4) {
    if (!form.agile_vs_waterfall.trim()) fieldErrors.agile_vs_waterfall = "This field is required";
    if (!form.psychological_safety.trim()) fieldErrors.psychological_safety = "This field is required";
    if (!form.agile_philosophies.trim()) fieldErrors.agile_philosophies = "This field is required";
    if (!form.collaboration_challenges.trim()) fieldErrors.collaboration_challenges = "This field is required";
  }
  if (section === 5) {
    if (!form.service_leadership_definition.trim()) fieldErrors.service_leadership_definition = "This field is required";
    if (!form.service_leadership_actions.trim()) fieldErrors.service_leadership_actions = "This field is required";
    if (!form.service_leadership_challenges.trim()) fieldErrors.service_leadership_challenges = "This field is required";
    if (!form.service_leadership_situation.trim()) fieldErrors.service_leadership_situation = "This field is required";
  }

  return fieldErrors;
}

/** Check if a section has any user input */
export function getSectionHasInput(form: AppFormData, section: number): boolean {
  if (section === 1) return !!(form.hours_commitment || form.portfolio_url || form.linkedin_url);
  if (section === 2) return !!(form.country || form.timezone || form.experience_areas.length > 0 || form.professional_goals || form.education_background.length > 0);
  if (section === 3) return !!form.previous_engagement;
  if (section === 4) return !!(form.agile_vs_waterfall || form.psychological_safety || form.agile_philosophies || form.collaboration_challenges);
  if (section === 5) return !!(form.service_leadership_definition || form.service_leadership_actions || form.service_leadership_challenges || form.service_leadership_situation);
  if (section === 6) return true; // Review section always counts as "has input"
  return false;
}

/** Check if all sections pass validation (ready to submit) */
export function canSubmit(form: AppFormData): boolean {
  // Check content sections (1-5) have no errors; section 6 (review) has no fields
  const CONTENT_SECTIONS = 5;
  for (let s = 1; s <= CONTENT_SECTIONS; s++) {
    const errors = getFieldErrors(form, s);
    if (Object.keys(errors).length > 0) return false;
  }

  return !!(
    form.hours_commitment &&
    form.country.trim() &&
    form.timezone.trim() &&
    form.experience_areas.length > 0 &&
    form.professional_goals.trim() &&
    form.education_background.length > 0 &&
    form.previous_engagement &&
    (form.previous_engagement !== "yes" || form.previous_engagement_ways.length > 0) &&
    form.agile_vs_waterfall.trim() &&
    form.psychological_safety.trim() &&
    form.agile_philosophies.trim() &&
    form.collaboration_challenges.trim() &&
    form.service_leadership_definition.trim() &&
    form.service_leadership_actions.trim() &&
    form.service_leadership_challenges.trim() &&
    form.service_leadership_situation.trim()
  );
}
