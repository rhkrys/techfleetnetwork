import { describe, it, expect } from "vitest";
import {
  sanitizeText,
  stripHtml,
  isSafeUrl,
  maskPii,
  safeCompare,
  deepSanitize,
  isSafeExternalUrl,
  maskEmail,
  enforceMaxBytes,
  hasSqlInjectionPattern,
  safeJsonParse,
  generateCsrfToken,
  safeHref,
} from "@/lib/security";

describe("sanitizeText", () => {
  it("escapes HTML entities", () => {
    const result = sanitizeText('<script>alert("xss")</script>');
    expect(result).not.toContain("<script>");
    expect(result).toContain("&lt;script&gt;");
  });
  it("preserves plain text", () => {
    expect(sanitizeText("Hello World")).toBe("Hello World");
  });
});

describe("stripHtml", () => {
  it("removes HTML tags", () => {
    expect(stripHtml("<b>bold</b> text")).toBe("bold text");
  });
  it("removes script tags and their bodies", () => {
    expect(stripHtml('<script>alert("x")</script>')).toBe("");
  });
  it("preserves plain text", () => {
    expect(stripHtml("no tags here")).toBe("no tags here");
  });
});

describe("isSafeUrl", () => {
  it("allows https URLs", () => {
    expect(isSafeUrl("https://example.com")).toBe(true);
  });
  it("allows http URLs", () => {
    expect(isSafeUrl("http://example.com")).toBe(true);
  });
  it("allows mailto URLs", () => {
    expect(isSafeUrl("mailto:test@example.com")).toBe(true);
  });
  it("rejects javascript: protocol", () => {
    expect(isSafeUrl("javascript:alert(1)")).toBe(false);
  });
  it("rejects data: protocol", () => {
    expect(isSafeUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
  });
});

describe("maskPii", () => {
  it("masks all but last 4 characters", () => {
    expect(maskPii("test@example.com")).toBe("************.com");
  });
  it("fully masks short strings", () => {
    expect(maskPii("ab")).toBe("****");
  });
});

describe("safeCompare", () => {
  it("returns true for identical strings", () => {
    expect(safeCompare("abc", "abc")).toBe(true);
  });
  it("returns false for different strings of same length", () => {
    expect(safeCompare("abc", "abd")).toBe(false);
  });
  it("returns false for different length strings", () => {
    expect(safeCompare("abc", "abcd")).toBe(false);
  });
});

describe("deepSanitize", () => {
  it("strips script tags from nested strings", () => {
    const obj = { name: "ok", bio: "<script>alert(1)</script>Hello" };
    const result = deepSanitize(obj);
    expect(result.bio).not.toContain("<script");
    expect(result.bio).toContain("Hello");
    expect(result.name).toBe("ok");
  });
  it("strips onclick attribute when inside HTML, preserves bare text", () => {
    // deepSanitize strips HTML (via DOM parser) — bare text is not transformed.
    // Callers rendering HTML must use sanitizeHtml (DOMPurify).
    expect(deepSanitize('<div onclick="evil()">keep</div>')).toBe("keep");
  });
  it("blocks __proto__ keys", () => {
    const obj = { __proto__: { admin: true }, name: "safe" } as any;
    const result = deepSanitize(obj);
    expect(result.name).toBe("safe");
    expect(Object.keys(result)).not.toContain("__proto__");
  });
  it("handles arrays", () => {
    const arr = ["<script>x</script>", "safe"];
    const result = deepSanitize(arr);
    expect(result[0]).not.toContain("<script");
    expect(result[1]).toBe("safe");
  });
});

describe("isSafeExternalUrl", () => {
  it("blocks localhost", () => {
    expect(isSafeExternalUrl("http://localhost/admin")).toBe(false);
  });
  it("blocks 127.0.0.1", () => {
    expect(isSafeExternalUrl("http://127.0.0.1")).toBe(false);
  });
  it("blocks 10.x private range", () => {
    expect(isSafeExternalUrl("http://10.0.0.1")).toBe(false);
  });
  it("blocks AWS metadata endpoint", () => {
    expect(isSafeExternalUrl("http://169.254.169.254/latest/meta-data")).toBe(false);
  });
  it("allows legitimate external URL", () => {
    expect(isSafeExternalUrl("https://techfleet.org")).toBe(true);
  });
  it("rejects non-http protocols", () => {
    expect(isSafeExternalUrl("ftp://example.com")).toBe(false);
  });
});

describe("safeHref", () => {
  it("normalizes safe web and email links", () => {
    expect(safeHref("https://techfleet.org/about")).toBe("https://techfleet.org/about");
    expect(safeHref("mailto:test@example.com")).toBe("mailto:test@example.com");
  });
  it("rejects active content, header injection, malformed email, and private hosts", () => {
    expect(safeHref("javascript:alert(1)")).toBeUndefined();
    expect(safeHref("https://example.com/%0d%0aSet-Cookie:x=y")).toBeUndefined();
    expect(safeHref("mailto:not-an-email")).toBeUndefined();
    expect(safeHref("http://127.0.0.1/admin")).toBeUndefined();
  });
});

describe("maskEmail", () => {
  it("masks email preserving first char and domain", () => {
    expect(maskEmail("john@example.com")).toBe("j***@example.com");
  });
  it("handles short local part", () => {
    expect(maskEmail("a@b.com")).toBe("***@***");
  });
});

describe("enforceMaxBytes", () => {
  it("returns string as-is if within limit", () => {
    expect(enforceMaxBytes("hello", 100)).toBe("hello");
  });
  it("truncates string exceeding byte limit", () => {
    const long = "a".repeat(200);
    const result = enforceMaxBytes(long, 50);
    expect(new TextEncoder().encode(result).length).toBeLessThanOrEqual(50);
  });
});

describe("hasSqlInjectionPattern", () => {
  it("detects OR 1=1", () => {
    expect(hasSqlInjectionPattern("' OR 1=1 --")).toBe(true);
  });
  it("detects UNION SELECT", () => {
    expect(hasSqlInjectionPattern("UNION SELECT * FROM users")).toBe(true);
  });
  it("allows normal text", () => {
    expect(hasSqlInjectionPattern("I love learning agile methods")).toBe(false);
  });
  it("detects SQL comments after injection", () => {
    expect(hasSqlInjectionPattern("'; --")).toBe(true);
  });
});

describe("safeJsonParse", () => {
  it("parses valid JSON", () => {
    expect(safeJsonParse('{"name":"test"}')).toEqual({ name: "test" });
  });
  it("strips __proto__ keys", () => {
    const result = safeJsonParse('{"__proto__":{"admin":true},"name":"safe"}') as any;
    expect(result.name).toBe("safe");
    expect(result.__proto__?.admin).toBeUndefined();
  });
});

describe("generateCsrfToken", () => {
  it("generates a 64-char hex string", () => {
    const token = generateCsrfToken();
    expect(token).toHaveLength(64);
    expect(/^[0-9a-f]+$/.test(token)).toBe(true);
  });
  it("generates unique tokens", () => {
    expect(generateCsrfToken()).not.toBe(generateCsrfToken());
  });
});
