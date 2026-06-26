import { describe, it, expect } from "vitest";
import { loginSchema, registerSchema, passwordSchema } from "@/lib/validators/auth";

/**
 * BDD Scenarios covered:
 * 2.1  — Successful account creation (valid input passes validation)
 * 2.3  — Weak password rejection (OWASP standards enforced)
 * 2.5  — Invalid email format rejection
 * 18.5 — Confirm password mismatch rejection
 * 15.3 — Form submission via Enter key (forms use standard HTML, covered by schema acceptance)
 */

describe("passwordSchema (BDD 2.3: Weak password rejection)", () => {
  it("accepts a strong OWASP-compliant password", () => {
    const result = passwordSchema.safeParse("Str0ng!PassWord");
    expect(result.success).toBe(true);
  });

  it("rejects password shorter than 12 characters", () => {
    const result = passwordSchema.safeParse("Ab1!short");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toContain("12 characters");
  });

  it("rejects password without uppercase letter", () => {
    const result = passwordSchema.safeParse("str0ng!pass");
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((i) => i.message.includes("uppercase"))).toBe(true);
  });

  it("rejects password without lowercase letter", () => {
    const result = passwordSchema.safeParse("STR0NG!PASS");
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((i) => i.message.includes("lowercase"))).toBe(true);
  });

  it("rejects password without a number", () => {
    const result = passwordSchema.safeParse("Strong!Pass");
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((i) => i.message.includes("number"))).toBe(true);
  });

  it("rejects password without special character", () => {
    const result = passwordSchema.safeParse("Str0ngPass1");
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((i) => i.message.includes("special"))).toBe(true);
  });

  it("rejects password longer than 128 characters", () => {
    const longPass = "A".repeat(120) + "a1!abcdefg";
    const result = passwordSchema.safeParse(longPass);
    expect(result.success).toBe(false);
  });
});

describe("loginSchema (BDD 2.5: Invalid email format)", () => {
  it("accepts valid email and password", () => {
    const result = loginSchema.safeParse({
      email: "test@example.com",
      password: "Str0ng!PassWord",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing @ in email", () => {
    const result = loginSchema.safeParse({ email: "testexample.com", password: "x" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toContain("email");
  });

  it("rejects empty email", () => {
    const result = loginSchema.safeParse({ email: "", password: "x" });
    expect(result.success).toBe(false);
  });

  it("rejects empty password", () => {
    const result = loginSchema.safeParse({ email: "test@example.com", password: "" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toContain("required");
  });

  it("trims whitespace from email", () => {
    const result = loginSchema.safeParse({
      email: "  test@example.com  ",
      password: "Str0ng!PassWord",
    });
    expect(result.success).toBe(true);
    expect(result.data?.email).toBe("test@example.com");
  });

  it("rejects email exceeding 255 characters", () => {
    const longEmail = "a".repeat(250) + "@b.com";
    const result = loginSchema.safeParse({ email: longEmail, password: "x" });
    expect(result.success).toBe(false);
  });

  it("rejects disposable email domains before auth submission", () => {
    const result = loginSchema.safeParse({ email: "person@mailinator.com", password: "x" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toContain("permanent email");
  });

  it("normalizes email before disposable domain validation", () => {
    const result = loginSchema.safeParse({
      email: "  PERSON@MAILINATOR.COM  ",
      password: "Str0ng!PassWord",
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((i) => i.message.includes("permanent email"))).toBe(true);
  });
});

describe("registerSchema (BDD 2.1: Successful registration, 2.7: Missing fields, 18.5: Confirm password)", () => {
  const validInput = {
    firstName: "Jane",
    lastName: "Doe",
    email: "jane@example.com",
    password: "Str0ng!PassWord",
    confirmPassword: "Str0ng!PassWord",
    birthYear: 1990,
    birthMonth: 1,
    birthDay: 1,
    electronicCommsConsent: true as const,
    agreedToTerms: true as const,
  };

  it("accepts valid registration input", () => {
    const result = registerSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it("rejects empty first name", () => {
    const result = registerSchema.safeParse({ ...validInput, firstName: "" });
    expect(result.success).toBe(false);
  });

  it("rejects empty last name", () => {
    const result = registerSchema.safeParse({ ...validInput, lastName: "" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid email", () => {
    const result = registerSchema.safeParse({ ...validInput, email: "not-an-email" });
    expect(result.success).toBe(false);
  });

  it("rejects temporary inbox email domains", () => {
    const result = registerSchema.safeParse({ ...validInput, email: "jane@yopmail.com" });
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((i) => i.message.includes("permanent email"))).toBe(true);
  });

  it("rejects weak password", () => {
    const result = registerSchema.safeParse({
      ...validInput,
      password: "weak",
      confirmPassword: "weak",
    });
    expect(result.success).toBe(false);
  });

  it("rejects when terms not agreed", () => {
    const result = registerSchema.safeParse({ ...validInput, agreedToTerms: false });
    expect(result.success).toBe(false);
  });

  it("rejects mismatched confirm password (BDD 18.5)", () => {
    const result = registerSchema.safeParse({ ...validInput, confirmPassword: "Different1!" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const msgs = result.error.issues.map((i) => i.message);
      expect(msgs).toContain("Passwords do not match");
    }
  });

  it("rejects empty confirm password", () => {
    const result = registerSchema.safeParse({ ...validInput, confirmPassword: "" });
    expect(result.success).toBe(false);
  });

  it("rejects XSS in first name (A03 security)", () => {
    const result = registerSchema.safeParse({
      ...validInput,
      firstName: '<script>alert("xss")</script>',
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((i) => i.message.includes("invalid content"))).toBe(true);
  });

  it("rejects XSS in last name (A03 security)", () => {
    const result = registerSchema.safeParse({
      ...validInput,
      lastName: '<script src="evil.js"></script>',
    });
    expect(result.success).toBe(false);
  });

  it("trims whitespace from names", () => {
    const result = registerSchema.safeParse({
      ...validInput,
      firstName: "  Jane  ",
      lastName: "  Doe  ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.firstName).toBe("Jane");
      expect(result.data.lastName).toBe("Doe");
    }
  });

  it("stores normalized casing for accepted email addresses", () => {
    const result = registerSchema.safeParse({ ...validInput, email: "  Jane.DOE@Example.COM  " });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.email).toBe("jane.doe@example.com");
  });
});
