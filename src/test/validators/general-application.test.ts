import { describe, it, expect } from "vitest";
import {
  getFieldErrors,
  getSectionHasInput,
  canSubmit,
  EMPTY_FORM,
  type AppFormData,
} from "@/lib/validators/general-application";

const filledForm: AppFormData = {
  ...EMPTY_FORM,
  hours_commitment: "yes",
  country: "United States",
  timezone: "America/New_York",
  experience_areas: ["Engineering"],
  professional_goals: "Learn agile",
  education_background: ["Bachelors"],
  previous_engagement: "no",
  agile_vs_waterfall: "Agile is iterative",
  psychological_safety: "Safe space",
  agile_philosophies: "Scrum",
  collaboration_challenges: "Communication",
  service_leadership_definition: "Serving others",
  service_leadership_actions: "Listening",
  service_leadership_challenges: "Ego",
  service_leadership_situation: "Talk to them",
};

describe("General Application Validation", () => {
  it("returns errors for empty section 1", () => {
    const errors = getFieldErrors(EMPTY_FORM, 1);
    expect(errors.hours_commitment).toBeDefined();
  });

  it("returns no errors for valid section 1", () => {
    const errors = getFieldErrors(filledForm, 1);
    expect(Object.keys(errors)).toHaveLength(0);
  });

  it("returns errors for empty section 2", () => {
    const errors = getFieldErrors(EMPTY_FORM, 2);
    expect(errors.country).toBeDefined();
    expect(errors.timezone).toBeDefined();
    expect(errors.experience_areas).toBeDefined();
    expect(errors.professional_goals).toBeDefined();
    expect(errors.education_background).toBeDefined();
  });

  it("detects section has input", () => {
    expect(getSectionHasInput(EMPTY_FORM, 1)).toBe(false);
    expect(getSectionHasInput(filledForm, 1)).toBe(true);
  });

  it("canSubmit returns false for empty form", () => {
    expect(canSubmit(EMPTY_FORM)).toBe(false);
  });

  it("canSubmit returns true for fully filled form", () => {
    expect(canSubmit(filledForm)).toBe(true);
  });

  it("section 3 requires engagement ways when previous_engagement is yes", () => {
    const form = { ...filledForm, previous_engagement: "yes", previous_engagement_ways: [] };
    const errors = getFieldErrors(form, 3);
    expect(errors.previous_engagement_ways).toBeDefined();
  });
});
