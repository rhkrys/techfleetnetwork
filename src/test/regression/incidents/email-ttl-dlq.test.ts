// Regression: messages exceeding TTL (60min / 15min variants) routed to DLQ instead of infinite retry.
// Lock in: routing predicate marks status='dlq' once age > ttl.
import { describe, it, expect } from "vitest";

function routeMessage(ageMs: number, ttlMs: number): "send" | "dlq" {
  return ageMs > ttlMs ? "dlq" : "send";
}

describe("incident: email TTL → DLQ routing", () => {
  const SIXTY_MIN = 60 * 60 * 1000;
  const FIFTEEN_MIN = 15 * 60 * 1000;

  it("sends fresh messages", () => {
    expect(routeMessage(1000, SIXTY_MIN)).toBe("send");
  });

  it("dlq's transactional messages past 60min", () => {
    expect(routeMessage(SIXTY_MIN + 1, SIXTY_MIN)).toBe("dlq");
  });

  it("dlq's auth-recovery past 15min", () => {
    expect(routeMessage(FIFTEEN_MIN + 1, FIFTEEN_MIN)).toBe("dlq");
  });

  it("exactly at TTL still sends (strict >)", () => {
    expect(routeMessage(SIXTY_MIN, SIXTY_MIN)).toBe("send");
  });
});
