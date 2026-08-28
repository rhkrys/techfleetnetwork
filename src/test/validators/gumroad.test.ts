import { describe, it, expect } from "vitest";
import {
  GUMROAD_ALLOWED_HOSTS,
  isAllowedGumroadUrl,
  gumroadUrlSchema,
  optionalGumroadUrlSchema,
} from "@/lib/validators/gumroad";

describe("Gumroad registration-link allowlist", () => {
  describe("accepts legitimate Tech Fleet store links", () => {
    it("accepts the public product link", () => {
      expect(isAllowedGumroadUrl("https://techfleet.gumroad.com/l/course")).toBe(true);
    });

    it("accepts the member link carrying the discount code", () => {
      expect(isAllowedGumroadUrl("https://techfleet.gumroad.com/l/course/tfmember")).toBe(true);
    });

    it("accepts query strings and trailing whitespace", () => {
      expect(isAllowedGumroadUrl("  https://techfleet.gumroad.com/l/course?wanted=true  ")).toBe(true);
    });
  });

  describe("rejects the host-confusion bypasses a regex check would admit", () => {
    // These are the reason this validator parses instead of pattern-matching.
    it("rejects a suffix-appended lookalike domain", () => {
      expect(isAllowedGumroadUrl("https://techfleet.gumroad.com.evil.com/l/course")).toBe(false);
    });

    it("rejects the allowlisted host smuggled in as userinfo", () => {
      expect(isAllowedGumroadUrl("https://techfleet.gumroad.com@evil.com/l/course")).toBe(false);
    });

    it("rejects a prefixed lookalike domain", () => {
      expect(isAllowedGumroadUrl("https://eviltechfleet.gumroad.com/l/course")).toBe(false);
    });

    it("rejects an attacker-owned Gumroad subdomain (why there is no wildcard)", () => {
      // Anyone can register a Gumroad store, so *.gumroad.com is not a
      // trust boundary.
      expect(isAllowedGumroadUrl("https://evil.gumroad.com/l/course")).toBe(false);
    });

    it("rejects the bare gumroad.com apex", () => {
      expect(isAllowedGumroadUrl("https://gumroad.com/l/course")).toBe(false);
    });
  });

  describe("rejects unsafe schemes and malformed input", () => {
    it("rejects http", () => {
      expect(isAllowedGumroadUrl("http://techfleet.gumroad.com/l/course")).toBe(false);
    });

    it("rejects javascript:", () => {
      expect(isAllowedGumroadUrl("javascript:alert(1)")).toBe(false);
    });

    it("rejects data:", () => {
      expect(isAllowedGumroadUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
    });

    it("rejects a scheme-less host", () => {
      // Unlike safeUrlSchema, this validator must NOT coerce to https —
      // coercion would silently manufacture a passing URL.
      expect(isAllowedGumroadUrl("techfleet.gumroad.com/l/course")).toBe(false);
    });

    it("rejects empty, whitespace, and non-strings", () => {
      expect(isAllowedGumroadUrl("")).toBe(false);
      expect(isAllowedGumroadUrl("   ")).toBe(false);
      expect(isAllowedGumroadUrl(null)).toBe(false);
      expect(isAllowedGumroadUrl(undefined)).toBe(false);
      expect(isAllowedGumroadUrl(42)).toBe(false);
    });
  });

  describe("the allowlist itself", () => {
    it("contains no wildcard entries", () => {
      for (const host of GUMROAD_ALLOWED_HOSTS) {
        expect(host).not.toContain("*");
      }
    });
  });

  describe("gumroadUrlSchema (required)", () => {
    it("parses an allowed link", () => {
      const parsed = gumroadUrlSchema("Registration URL").safeParse(
        "https://techfleet.gumroad.com/l/course",
      );
      expect(parsed.success).toBe(true);
    });

    it("fails an off-allowlist link", () => {
      const parsed = gumroadUrlSchema("Registration URL").safeParse("https://evil.com/l/course");
      expect(parsed.success).toBe(false);
    });

    it("fails empty input", () => {
      expect(gumroadUrlSchema("Registration URL").safeParse("").success).toBe(false);
    });

    it("enforces the length cap", () => {
      const long = `https://techfleet.gumroad.com/l/${"a".repeat(600)}`;
      expect(gumroadUrlSchema("Registration URL", 500).safeParse(long).success).toBe(false);
    });
  });

  describe("optionalGumroadUrlSchema", () => {
    it("allows empty / null / undefined", () => {
      const schema = optionalGumroadUrlSchema("Discount URL");
      expect(schema.safeParse("").success).toBe(true);
      expect(schema.safeParse(null).success).toBe(true);
      expect(schema.safeParse(undefined).success).toBe(true);
    });

    it("still rejects an off-allowlist link when one is supplied", () => {
      const schema = optionalGumroadUrlSchema("Discount URL");
      expect(schema.safeParse("https://evil.com/l/course").success).toBe(false);
    });

    it("accepts the member discount link", () => {
      const schema = optionalGumroadUrlSchema("Discount URL");
      expect(schema.safeParse("https://techfleet.gumroad.com/l/course/tfmember").success).toBe(true);
    });
  });
});
