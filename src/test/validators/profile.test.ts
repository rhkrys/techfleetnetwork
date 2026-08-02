import { describe, it, expect } from "vitest";
import { profileSchema, ACTIVITY_OPTIONS } from "@/lib/validators/profile";

/**
 * BDD Scenarios covered:
 * 2.6  — Successful profile setup completion (valid input passes)
 * 2.7  — Unsuccessful profile setup due to missing mandatory fields
 * 3.1  — First Steps completion (profile task validation)
 */

describe("profileSchema (BDD 2.6: Profile setup completion)", () => {
  const validInput = {
    firstName: "Jane",
    lastName: "Doe",
    country: "United States",
    timezone: "America/New_York",
    discordUsername: "janedoe",
    interests: ["Take classes", "Get mentorship"],
  };

  it("accepts valid profile input with all fields", () => {
    const result = profileSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it("accepts profile without discord username", () => {
    const result = profileSchema.safeParse({ ...validInput, discordUsername: "" });
    expect(result.success).toBe(true);
  });

  it("accepts profile without interests (defaults to empty array)", () => {
    const { interests: _interests, ...rest } = validInput;
    const result = profileSchema.safeParse(rest);
    expect(result.success).toBe(true);
    expect(result.data?.interests).toEqual([]);
  });

  it("accepts profile with omitted discordUsername (defaults to empty string)", () => {
    const { discordUsername: _discordUsername, ...rest } = validInput;
    const result = profileSchema.safeParse(rest);
    expect(result.success).toBe(true);
    expect(result.data?.discordUsername).toBe("");
  });
});

describe("profileSchema (BDD 2.7: Missing mandatory fields)", () => {
  it("rejects empty first name", () => {
    const result = profileSchema.safeParse({
      firstName: "",
      lastName: "Doe",
      country: "US",
      timezone: "America/New_York",
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toContain("required");
  });

  it("rejects empty last name", () => {
    const result = profileSchema.safeParse({
      firstName: "Jane",
      lastName: "",
      country: "US",
      timezone: "America/New_York",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty country", () => {
    const result = profileSchema.safeParse({
      firstName: "Jane",
      lastName: "Doe",
      country: "",
      timezone: "America/New_York",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty timezone", () => {
    const result = profileSchema.safeParse({
      firstName: "Jane",
      lastName: "Doe",
      country: "US",
      timezone: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects whitespace-only first name", () => {
    const result = profileSchema.safeParse({
      firstName: "   ",
      lastName: "Doe",
      country: "US",
      timezone: "America/New_York",
    });
    expect(result.success).toBe(false);
  });
});

describe("profileSchema — Discord username validation", () => {
  it("accepts valid discord username with letters and dots", () => {
    const result = profileSchema.safeParse({
      firstName: "Jane",
      lastName: "Doe",
      country: "US",
      timezone: "America/New_York",
      discordUsername: "jane.doe",
    });
    expect(result.success).toBe(true);
  });

  it("accepts valid discord username with underscores", () => {
    const result = profileSchema.safeParse({
      firstName: "Jane",
      lastName: "Doe",
      country: "US",
      timezone: "America/New_York",
      discordUsername: "jane_doe_123",
    });
    expect(result.success).toBe(true);
  });

  it("rejects discord username with special characters", () => {
    const result = profileSchema.safeParse({
      firstName: "Jane",
      lastName: "Doe",
      country: "US",
      timezone: "America/New_York",
      discordUsername: "jane@doe#1234",
    });
    expect(result.success).toBe(false);
  });

  it("rejects discord username with spaces", () => {
    const result = profileSchema.safeParse({
      firstName: "Jane",
      lastName: "Doe",
      country: "US",
      timezone: "America/New_York",
      discordUsername: "jane doe",
    });
    expect(result.success).toBe(false);
  });
});

describe("profileSchema — XSS prevention (A03 security)", () => {
  it("rejects script tags in first name", () => {
    const result = profileSchema.safeParse({
      firstName: '<script>alert("xss")</script>',
      lastName: "Doe",
      country: "US",
      timezone: "America/New_York",
    });
    expect(result.success).toBe(false);
    // Validator now returns an actionable classification instead of the generic
    // "invalid content" (shared-input classifyUnsafe): "…looks like an
    // HTML/script tag — remove angle brackets and try again".
    expect(result.error?.issues.some((i) => i.message.includes("HTML/script tag"))).toBe(true);
  });

  it("rejects script tags in country", () => {
    const result = profileSchema.safeParse({
      firstName: "Jane",
      lastName: "Doe",
      country: '<script src="evil"></script>',
      timezone: "America/New_York",
    });
    expect(result.success).toBe(false);
  });

  it("rejects script tags in discord username", () => {
    const result = profileSchema.safeParse({
      firstName: "Jane",
      lastName: "Doe",
      country: "US",
      timezone: "America/New_York",
      discordUsername: "<script>hack</script>",
    });
    expect(result.success).toBe(false);
  });
});

describe("profileSchema — Field length limits", () => {
  it("rejects first name exceeding 100 characters", () => {
    const result = profileSchema.safeParse({
      firstName: "A".repeat(101),
      lastName: "Doe",
      country: "US",
      timezone: "America/New_York",
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toContain("100");
  });

  it("rejects last name exceeding 100 characters", () => {
    const result = profileSchema.safeParse({
      firstName: "Jane",
      lastName: "D".repeat(101),
      country: "US",
      timezone: "America/New_York",
    });
    expect(result.success).toBe(false);
  });

  it("rejects discord username exceeding 100 characters", () => {
    const result = profileSchema.safeParse({
      firstName: "Jane",
      lastName: "Doe",
      country: "US",
      timezone: "America/New_York",
      discordUsername: "a".repeat(101),
    });
    expect(result.success).toBe(false);
  });
});

describe("ACTIVITY_OPTIONS constant", () => {
  it("contains expected activity options", () => {
    expect(ACTIVITY_OPTIONS).toContain("Take classes");
    expect(ACTIVITY_OPTIONS).toContain("Get mentorship");
    expect(ACTIVITY_OPTIONS).toContain("Train on project teams");
    expect(ACTIVITY_OPTIONS.length).toBe(7);
  });
});
