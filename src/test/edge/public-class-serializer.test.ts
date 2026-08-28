import { describe, it, expect } from "vitest";
// Imports the SAME module the edge function loads at runtime, so these
// assertions exercise the real serializer rather than a copy of it.
import {
  serializePublicClass,
  serializePublicCohort,
  isPublishableRegistrationUrl,
  PUBLIC_REGISTRATION_HOSTS,
} from "../../../supabase/functions/_shared/public-class";

const RAW_COHORT = {
  id: "c1",
  label: "Spring 2026",
  start_date: "2026-03-01",
  end_date: "2026-04-30",
  timezone: "America/New_York",
  registration_url: "https://techfleet.gumroad.com/l/course",
  // Fields that must never reach an anonymous visitor:
  capacity: 25,
  discount_registration_url: "https://techfleet.gumroad.com/l/course/tfmember",
  meeting_url: "https://zoom.us/j/secret",
  status: "published",
};

const RAW_CLASS = {
  id: "k1",
  slug: "ux-foundations",
  title: "UX Foundations",
  summary: "Learn the basics",
  description: "<p>Full description</p>",
  track: "basic_training",
  hero_image_url: "https://cdn.example.com/hero.png",
  outcomes: ["a", "b"],
  skills: ["research"],
  prerequisites: [],
  published_at: "2026-01-01T00:00:00Z",
  owner_user_id: "user-123",
  internal_notes: "do not publish",
  cohorts: [RAW_COHORT],
};

describe("public course serializer — field allowlist", () => {
  it("never publishes the member discount link", () => {
    const out = serializePublicCohort(RAW_COHORT) as Record<string, unknown>;
    expect(out).not.toHaveProperty("discount_registration_url");
    expect(JSON.stringify(out)).not.toContain("tfmember");
  });

  it("never publishes the private meeting link", () => {
    const out = serializePublicCohort(RAW_COHORT) as Record<string, unknown>;
    expect(out).not.toHaveProperty("meeting_url");
    expect(JSON.stringify(out)).not.toContain("zoom.us");
  });

  it("never publishes raw capacity", () => {
    const out = serializePublicCohort(RAW_COHORT) as Record<string, unknown>;
    expect(out).not.toHaveProperty("capacity");
  });

  it("never publishes operational class fields", () => {
    const out = serializePublicClass(RAW_CLASS) as Record<string, unknown>;
    expect(out).not.toHaveProperty("owner_user_id");
    expect(out).not.toHaveProperty("internal_notes");
    expect(JSON.stringify(out)).not.toContain("do not publish");
  });

  it("does not leak a column the table gains later", () => {
    // The regression guard for `{ ...row }`. The RLS policy is column-blind, so
    // a future column is anon-readable the moment it exists; explicit
    // construction is what keeps it private.
    const withNewColumn = { ...RAW_CLASS, secret_new_column: "leaked" };
    const out = serializePublicClass(withNewColumn) as Record<string, unknown>;
    expect(out).not.toHaveProperty("secret_new_column");
    expect(JSON.stringify(out)).not.toContain("leaked");
  });

  it("publishes exactly the intended cohort keys", () => {
    const out = serializePublicCohort(RAW_COHORT);
    expect(Object.keys(out).sort()).toEqual(
      ["end_date", "id", "label", "registration_url", "start_date", "timezone"].sort(),
    );
  });
});

describe("public course serializer — registration link allowlist", () => {
  it("publishes an allowlisted Gumroad link", () => {
    const out = serializePublicCohort(RAW_COHORT);
    expect(out.registration_url).toBe("https://techfleet.gumroad.com/l/course");
  });

  it("drops a legacy non-Gumroad link instead of rendering it", () => {
    // The DB CHECK is NOT VALID, so historical rows can still hold these.
    const out = serializePublicCohort({
      ...RAW_COHORT,
      registration_url: "https://eventbrite.com/e/12345",
    });
    expect(out.registration_url).toBeNull();
  });

  it("drops host-confusion lookalikes", () => {
    for (const bad of [
      "https://techfleet.gumroad.com.evil.com/l/course",
      "https://techfleet.gumroad.com@evil.com/l/course",
      "https://evil.gumroad.com/l/course",
      "http://techfleet.gumroad.com/l/course",
      "javascript:alert(1)",
    ]) {
      expect(serializePublicCohort({ ...RAW_COHORT, registration_url: bad }).registration_url).toBeNull();
    }
  });

  it("matches the frontend validator's allowlist decisions", () => {
    expect(isPublishableRegistrationUrl("https://techfleet.gumroad.com/l/x")).toBe(true);
    expect(isPublishableRegistrationUrl("https://evil.gumroad.com/l/x")).toBe(false);
    expect(PUBLIC_REGISTRATION_HOSTS).not.toContain("*");
  });
});

describe("public course serializer — shape", () => {
  it("sorts cohorts by start date", () => {
    const out = serializePublicClass({
      ...RAW_CLASS,
      cohorts: [
        { ...RAW_COHORT, id: "late", start_date: "2026-09-01" },
        { ...RAW_COHORT, id: "early", start_date: "2026-01-15" },
      ],
    });
    expect(out.cohorts.map((c) => c.id)).toEqual(["early", "late"]);
  });

  it("tolerates a class with no cohorts", () => {
    const out = serializePublicClass({ ...RAW_CLASS, cohorts: undefined });
    expect(out.cohorts).toEqual([]);
  });

  it("defaults array fields rather than emitting undefined", () => {
    const out = serializePublicClass({ id: "x" });
    expect(out.outcomes).toEqual([]);
    expect(out.skills).toEqual([]);
    expect(out.prerequisites).toEqual([]);
  });
});
